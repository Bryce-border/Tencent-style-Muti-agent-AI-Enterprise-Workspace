from __future__ import annotations

from typing import Any
import hashlib
import math
import re
import unicodedata
from datetime import datetime, timezone
import httpx

from .config import Settings


def content_key(text: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text)).casefold()


def usable_content(text: str) -> bool:
    compact = content_key(text)
    if not compact:
        return False
    # Reject fixture-like runs and repeated phrases, not ordinary repeated terms.
    runs = re.findall(r"(.)\1{31,}", compact)
    if runs and max(compact.count(char) for char in runs) / len(compact) > 0.25:
        return False
    repetitions = list(re.finditer(r"(.{2,40}?)\1{7,}", compact))
    return sum(len(match[0]) for match in repetitions) <= len(compact) * 0.5


def cited_sources(output: str, candidates: list[dict]) -> list[dict]:
    markers = {value.strip() for value in re.findall(r"\[来源\s*[:：]\s*([^\]]+)\]", output)}
    result, seen = [], set()
    for item in candidates:
        key = content_key(item.get("content", ""))
        if (markers.intersection({item.get("chunkId"), item.get("title")})
                and usable_content(item.get("content", "")) and key not in seen
                and not item.get("metadata", {}).get("retrieval_excluded")):
            result.append(item)
            seen.add(key)
    return result


def input_only(prompt: str) -> bool:
    return bool(re.search(r"(?:仅|只)(?:根据|依据|使用|基于)(?:以下|下列|上述|所给|(?:本次|当前)(?:资料|提供|输入|所给)|提供的|我提供|用户提供)|不要(?:检索|搜索)|不(?:使用|引用)(?:知识库|外部)", prompt))


class EmbeddingProvider:
    """OpenAI-compatible embeddings with a deterministic local fallback."""

    def __init__(self, settings: Settings):
        self.settings = settings

    def _local(self, text: str) -> list[float]:
        dims = max(8, self.settings.embedding_dim)
        values = [0.0] * dims
        tokens = re.findall(r"[a-z0-9_]+|[\u4e00-\u9fff]", text.lower())
        for token in tokens:
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            for offset in range(0, len(digest), 2):
                index = int.from_bytes(digest[offset:offset + 2], "big") % dims
                values[index] += 1.0 if digest[offset] & 1 else -1.0
        norm = math.sqrt(sum(value * value for value in values)) or 1.0
        return [round(value / norm, 7) for value in values]

    async def embed(self, text: str) -> list[float]:
        if not self.settings.embedding_model or not self.settings.llm_api_key:
            return self._local(text)
        base_url = self.settings.embedding_base_url or self.settings.llm_base_url
        headers = {"Authorization": f"Bearer {self.settings.llm_api_key}"}
        payload = {"model": self.settings.embedding_model, "input": text}
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(f"{base_url.rstrip('/')}/embeddings", json=payload, headers=headers)
            response.raise_for_status()
            vector = response.json()["data"][0]["embedding"]
        if len(vector) != self.settings.embedding_dim:
            raise ValueError(f"embedding dimension {len(vector)} != configured {self.settings.embedding_dim}")
        return vector


class KnowledgeStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.embedder = EmbeddingProvider(settings)

    async def ensure_index(self) -> None:
        mapping = {"mappings": {"properties": {"chunkId": {"type": "keyword"}, "workspaceId": {"type": "keyword"}, "documentId": {"type": "keyword"}, "title": {"type": "text"}, "content": {"type": "text"}, "embedding": {"type": "dense_vector", "dims": self.settings.embedding_dim, "index": True, "similarity": "cosine"}, "metadata": {"type": "object", "enabled": True}, "createdAt": {"type": "date"}}}}
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.put(f"{self.settings.elasticsearch_url}/{self.settings.elasticsearch_index}", json=mapping)
                if response.status_code not in (200, 201, 400):
                    response.raise_for_status()
        except httpx.HTTPError:
            return

    async def index_document(self, workspace_id: str, document_id: str, title: str, content: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        if not usable_content(content):
            raise ValueError("文档内容为空或包含过量占位、重复文本")
        size, overlap = 1200, 150
        chunks = []
        start = 0
        while start < len(content) or (not content and not chunks):
            end = min(len(content), start + size)
            text = content[start:end]
            chunk_no = len(chunks) + 1
            chunks.append({"chunkId": f"{document_id}-{chunk_no}", "workspaceId": workspace_id, "documentId": document_id, "title": title, "content": text, "embedding": await self.embedder.embed(f"{title}\n{text}"), "metadata": {**(metadata or {}), "chunk_index": chunk_no}, "createdAt": datetime.now(timezone.utc).isoformat()})
            if end >= len(content):
                break
            start = end - overlap
        async with httpx.AsyncClient(timeout=10) as client:
            indexed_ids = []
            for chunk in chunks:
                storage_id = hashlib.sha256(f"{workspace_id}\0{chunk['chunkId']}".encode()).hexdigest()
                response = await client.put(f"{self.settings.elasticsearch_url}/{self.settings.elasticsearch_index}/_doc/{storage_id}", json=chunk)
                response.raise_for_status()
                indexed_ids.append(storage_id)
            response = await client.post(f"{self.settings.elasticsearch_url}/{self.settings.elasticsearch_index}/_refresh")
            response.raise_for_status()
            # Remove obsolete chunks only after all replacements were embedded and written.
            response = await client.post(f"{self.settings.elasticsearch_url}/{self.settings.elasticsearch_index}/_delete_by_query?refresh=true", json={
                "query": {"bool": {"filter": [{"term": {"workspaceId": workspace_id}}, {"term": {"documentId": document_id}}],
                    "must_not": [{"ids": {"values": indexed_ids}}]}}})
            response.raise_for_status()
            if response.json().get("failures"):
                raise RuntimeError("obsolete knowledge chunks could not be removed")
        return {"documentId": document_id, "workspaceId": workspace_id, "chunks": chunks, "chunk_count": len(chunks)}

    async def search(self, workspace_id: str, query: str, limit: int = 5) -> list[dict[str, Any]]:
        if not query.strip():
            return []
        limit = min(max(limit, 1), 20)
        pool_size = max(50, limit * 10)
        scope = {"bool": {"filter": [{"term": {"workspaceId": workspace_id}}],
            "must_not": [{"term": {"metadata.retrieval_excluded": True}}]}}
        body: dict[str, Any] = {"size": pool_size, "_source": {"excludes": ["embedding"]}}
        semantic = bool(self.settings.embedding_model and self.settings.llm_api_key)
        if semantic:
            vector = await self.embedder.embed(query)
            body["knn"] = {"field": "embedding", "query_vector": vector, "k": pool_size,
                "num_candidates": max(100, pool_size), "filter": scope,
                "similarity": self.settings.knowledge_min_similarity}
        else:
            # Hash embeddings are not semantic: local mode uses lexical phrases.
            terms = re.findall(r"[a-zA-Z0-9_]+|[\u4e00-\u9fff]+", query)
            phrases = list(dict.fromkeys(part for term in terms for part in
                ([term] if not re.search(r"[\u4e00-\u9fff]", term) or len(term) < 3 else
                 [term[i:i + 2] for i in range(len(term) - 1)])))[:128]
            if not phrases:
                return []
            body["query"] = {"bool": {"filter": [scope], "minimum_should_match": "60%",
                "should": [{"multi_match": {"query": term, "type": "phrase", "fields": ["title^2", "content"]}} for term in phrases]}}
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(f"{self.settings.elasticsearch_url}/{self.settings.elasticsearch_index}/_search", json=body)
            response.raise_for_status()
            hits = response.json().get("hits", {}).get("hits", [])
            # Never send the dense vector back to the browser. It is only used
            # by Elasticsearch for retrieval and can be several kilobytes per hit.
            fields = ("chunkId", "workspaceId", "documentId", "title", "content", "metadata", "createdAt")
            results, seen = [], set()
            best_similarity = None
            for hit in hits:
                source = hit.get("_source", {})
                key = content_key(source.get("content", ""))
                if (source.get("workspaceId") != workspace_id or source.get("metadata", {}).get("retrieval_excluded")
                        or not usable_content(source.get("content", "")) or key in seen):
                    continue
                if semantic:
                    similarity = 2 * hit.get("_score", 0) - 1
                    if similarity < self.settings.knowledge_min_similarity:
                        continue
                    if best_similarity is None:
                        best_similarity = similarity
                    if similarity < best_similarity - self.settings.knowledge_similarity_window:
                        continue
                seen.add(key)
                results.append({key: source[key] for key in fields if key in source} | {"score": hit.get("_score")})
                if len(results) >= limit:
                    break
            return results

    async def stats(self, workspace_id: str) -> dict[str, int]:
        """Count indexed chunks and unique documents for the workspace."""
        body = {
            "size": 0,
            "query": {"bool": {"filter": [{"term": {"workspaceId": workspace_id}}],
                "must_not": [{"term": {"metadata.retrieval_excluded": True}}]}},
            "aggs": {"documents": {"cardinality": {"field": "documentId"}}},
        }
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.post(f"{self.settings.elasticsearch_url}/{self.settings.elasticsearch_index}/_search", json=body)
            response.raise_for_status()
            data = response.json()
        total_hits = data.get("hits", {}).get("total", 0)
        if isinstance(total_hits, dict):
            total_hits = total_hits.get("value", 0)
        return {
            "documents": int(data.get("aggregations", {}).get("documents", {}).get("value", 0)),
            "chunks": int(total_hits),
            "available": True,
        }
