"""Evaluate realistic Chinese retrieval queries against the deployed business API."""
import argparse
import json
from pathlib import Path

import httpx
from dotenv import dotenv_values


ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scores", action="store_true", help="Inspect raw cosine scores to calibrate the embedding threshold")
    args = parser.parse_args()
    env = dotenv_values(ROOT / ".env")
    auth = dotenv_values(ROOT / ".env.r2")
    cases = json.loads((ROOT.parent / "docs/fixtures/knowledge-queries.json").read_text(encoding="utf-8"))
    failures = []
    base = "http://localhost:8080"
    with httpx.Client(base_url=base, timeout=60, headers={"X-Workspace-Request": "1", "Origin": base}) as client:
        response = client.post("/auth/login", json={"username": "admin", "password": auth["BOOTSTRAP_PASSWORD"]})
        response.raise_for_status()
        for case in cases:
            if args.scores:
                response = httpx.post((env.get("EMBEDDING_BASE_URL") or env["LLM_BASE_URL"]).rstrip("/") + "/embeddings",
                    headers={"Authorization": "Bearer " + env["LLM_API_KEY"]},
                    json={"model": env["EMBEDDING_MODEL"], "input": case["query"]}, timeout=30)
                response.raise_for_status()
                response = httpx.post("http://localhost:9200/" + env["ELASTICSEARCH_INDEX"] + "/_search", json={
                    "size": 5, "_source": ["documentId"], "knn": {"field": "embedding", "query_vector": response.json()["data"][0]["embedding"],
                    "k": 5, "num_candidates": 100, "filter": {"bool": {"filter": [{"term": {"workspaceId": "default"}}],
                        "must_not": [{"term": {"metadata.retrieval_excluded": True}}]}}}}, timeout=30)
                response.raise_for_status()
                print(case["query"], [(hit["_source"]["documentId"], round(2 * hit["_score"] - 1, 3)) for hit in response.json()["hits"]["hits"]], flush=True)
                continue
            response = client.get("/v1/knowledge/search", params={"q": case["query"]})
            response.raise_for_status()
            hits = response.json()
            expected = case["expected"]
            ok = bool(hits) and hits[0]["documentId"] == "default_" + expected if expected else not hits
            ok = ok and len({hit["content"] for hit in hits}) == len(hits)
            ok = ok and all(hit["workspaceId"] == "default" and hit.get("metadata", {}).get("simulated") and "embedding" not in hit for hit in hits)
            print("PASS" if ok else "FAIL", case["query"], [hit["documentId"] for hit in hits], flush=True)
            if not ok:
                failures.append(case["query"])
        if args.scores:
            return
        response = client.get("/v1/tasks/T-1119bb16c9e4")
        response.raise_for_status()
        assert response.json()["result"]["citations"] == [], "Legacy report still exposes unused candidates"
        response = client.get("/v1/tasks/T-1119bb16c9e4/export")
        response.raise_for_status()
        assert "xxxxxxxx" not in response.text and "检索参考候选" not in response.text, "Legacy export still polluted"
        print("PASS legacy task and Markdown export")
        assert not failures, f"Failed queries: {failures}"
        print(f"PASS {len(cases)} retrieval scenarios")


if __name__ == "__main__":
    main()
