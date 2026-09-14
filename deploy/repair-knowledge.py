"""Back up/quarantine verified R1 fixtures and seed explicitly simulated policies."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import dotenv_values


ROOT = Path(__file__).resolve().parent
FIXTURE_IDS = ["http-check-20260913-1", "chunk-check-1", "chunk-check-2", "chunk-check-3", "chunk-check-4", "ui-doc-1", "ui-doc2-1"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Back up and quarantine old fixtures, then import simulations")
    args = parser.parse_args()
    env = dotenv_values(ROOT / ".env")
    auth = dotenv_values(ROOT / ".env.r2")
    index = env.get("ELASTICSEARCH_INDEX", "knowledge_chunks_v3")
    with httpx.Client(base_url=f"http://localhost:9200/{index}", timeout=30) as es:
        response = es.post("/_search", json={"size": 20, "query": {"bool": {"filter": [
            {"term": {"workspaceId": "default"}}, {"ids": {"values": FIXTURE_IDS}}]}}})
        response.raise_for_status()
        hits = response.json()["hits"]["hits"]
        print(f"Verified fixture chunks in default: {len(hits)}")
        if not args.apply:
            return
        backup = ROOT / "backups" / ("knowledge-fixtures-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".json")
        backup.parent.mkdir(exist_ok=True)
        backup.write_text(json.dumps({"index": index, "hits": hits}, ensure_ascii=False), encoding="utf-8")
        for hit in hits:
            response = es.post(f"/_update/{hit['_id']}", json={"doc": {"metadata": {
                "retrieval_excluded": True, "exclusion_reason": "legacy development fixture"}}})
            response.raise_for_status()
        response = es.post("/_refresh")
        response.raise_for_status()
        print(f"Backup: {backup.name}; quarantined: {len(hits)}")
    base = "http://localhost:8080"
    with httpx.Client(base_url=base, timeout=60, headers={"X-Workspace-Request": "1", "Origin": base}) as client:
        response = client.post("/auth/login", json={"username": "admin", "password": auth["BOOTSTRAP_PASSWORD"]})
        response.raise_for_status()
        if response.json()["workspace_id"] != "default":
            raise RuntimeError("Refusing to seed a different workspace")
        for doc in json.loads((ROOT.parent / "docs/fixtures/business-knowledge.json").read_text(encoding="utf-8")):
            response = client.post("/v1/knowledge/documents", json=doc)
            response.raise_for_status()
            print("Imported simulation:", doc["document_id"])


if __name__ == "__main__":
    main()
