"""Verify real indexing replacement, deduplication, and workspace isolation."""
import json
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import dotenv_values


ROOT = Path(__file__).resolve().parent


def main():
    accounts = json.loads((ROOT.parent / ".tools/r2-demo-credentials.json").read_text(encoding="utf-8"))
    account = accounts[0]
    base = "http://localhost:8080"
    env = dotenv_values(ROOT / ".env")
    with httpx.Client(base_url=base, timeout=60, headers={"X-Workspace-Request": "1", "Origin": base}) as client:
        response = client.post("/auth/login", json={"username": account["username"], "password": account["password"]})
        response.raise_for_status()
        profile = response.json()
        space = next(item["id"] for item in profile["workspaces"] if item["name"] == account["workspace_name"] and item["role"] == "ADMIN")
        assert space != "default", "Use an isolated test workspace"
        response = client.post("/auth/workspace", json={"workspace_id": space})
        response.raise_for_status()
        local_id = "rag-lifecycle-" + uuid4().hex[:10]
        def index(doc_id, content, status=200):
            response = client.post("/v1/knowledge/documents", json={"document_id": doc_id, "title": "模拟差旅报销测试", "content": content, "metadata": {"simulated": True}})
            assert response.status_code == status, f"index: HTTP {response.status_code}"
            return response.json()
        def chunks():
            response = httpx.post("http://localhost:9200/" + env["ELASTICSEARCH_INDEX"] + "/_search", json={
                "size": 20, "_source": {"excludes": ["embedding"]}, "query": {"bool": {"filter": [
                    {"term": {"workspaceId": space}}, {"term": {"documentId": space + "_" + local_id}}]}}}, timeout=10)
            response.raise_for_status()
            return response.json()["hits"]["hits"]
        text = "\n".join(f"第{i}条模拟项目记录：项目编号PRJ-{i:04d}，本次差旅预算为{1000 + i * 30}元，负责人需在月底前核对发票金额与采购记录，完成预算复核。" for i in range(1, 36))
        first = index(local_id, text)
        assert first["chunk_count"] > 1
        assert len(chunks()) == first["chunk_count"]
        short = "本制度是隔离测试数据。差旅报销需在出差结束后30天内提交发票和审批单，住宿标准按实际城市核定。"
        assert index(local_id, short)["chunk_count"] == 1
        assert len(chunks()) == 1 and chunks()[0]["_source"]["content"] == short
        print("PASS shorter reindex removes obsolete chunks")
        index(local_id + "-copy", short)
        response = client.get("/v1/knowledge/search", params={"q": "出差结束后多少天内报销发票", "workspace_id": "default"})
        response.raise_for_status()
        hits = response.json()
        assert len([hit for hit in hits if hit["content"] == short]) == 1
        assert all(hit["workspaceId"] == space for hit in hits)
        print("PASS duplicate content across document IDs; tenant spoof rejected")
        index(local_id + "-invalid", "x" * 1200, 422)
        print("PASS low-information upload rejected through Java gateway")
        # Keep test records inspectable but excluded from future retrieval.
        response = httpx.post("http://localhost:9200/" + env["ELASTICSEARCH_INDEX"] + "/_update_by_query?refresh=true", json={
            "query": {"bool": {"filter": [{"term": {"workspaceId": space}}, {"terms": {"documentId": [space + "_" + local_id, space + "_" + local_id + "-copy"]}}]}},
            "script": {"source": "ctx._source.metadata.retrieval_excluded = true"}}, timeout=30)
        response.raise_for_status()
        assert not response.json().get("failures")
        print("PASS lifecycle fixtures isolated after validation")


if __name__ == "__main__":
    main()
