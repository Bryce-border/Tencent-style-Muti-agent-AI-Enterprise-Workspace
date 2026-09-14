import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.config import Settings
from app.knowledge import KnowledgeStore, cited_sources, input_only, usable_content


class KnowledgeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.store = KnowledgeStore(Settings(llm_api_key="test-only", embedding_model="test", embedding_dim=8, _env_file=None))
        self.store.embedder.embed = AsyncMock(return_value=[1.0] + [0.0] * 7)
        self.requests = []

    def client(self, handler):
        real_client = httpx.AsyncClient
        def handle(request):
            self.requests.append((request, json.loads(request.content) if request.content else {}))
            return handler(request)
        return patch("app.knowledge.httpx.AsyncClient", side_effect=lambda **kwargs: real_client(transport=httpx.MockTransport(handle), **kwargs))

    async def test_semantic_search_can_abstain_and_is_scoped_before_knn(self):
        with self.client(lambda r: httpx.Response(200, json={"hits": {"hits": []}})):
            self.assertEqual(await self.store.search("tenant-a", "火星探测器轨道计算"), [])
        query = self.requests[0][1]
        self.assertEqual(query["knn"]["similarity"], 0.42)
        self.assertIn({"term": {"workspaceId": "tenant-a"}}, query["knn"]["filter"]["bool"]["filter"])
        self.assertIn("retrieval_excluded", json.dumps(query))
        self.assertEqual(query["_source"], {"excludes": ["embedding"]})

    async def test_dedup_and_quality_do_not_hide_later_valid_hits(self):
        def hit(doc, text, space="tenant-a", metadata=None):
            return {"_score": 0.9, "_source": {"documentId": doc, "workspaceId": space, "content": text, "metadata": metadata or {}, "embedding": [1, 2]}}
        hits = [hit("one", "差旅报销需在30天内提交。"), hit("copy", "差旅报销需在３０天内提交。\n"),
                hit("noise", "x" * 1200), hit("repeat", "差旅报销制度 " * 120),
                hit("excluded", "财务申请", metadata={"retrieval_excluded": True}), hit("other", "other tenant", "tenant-b"),
                hit("two", "住宿发票需附行程单。")]
        with self.client(lambda r: httpx.Response(200, json={"hits": {"hits": hits}})):
            result = await self.store.search("tenant-a", "差旅报销", 2)
        self.assertEqual([item["documentId"] for item in result], ["one", "two"])
        self.assertNotIn("embedding", result[0])

    async def test_weaker_and_below_threshold_hits_do_not_fill_the_limit(self):
        hits = [{"_score": score, "_source": {"documentId": str(score), "workspaceId": "tenant-a", "content": text}}
                for score, text in [(0.83, "差旅报销时限为30天。"), (0.725, "年假按工龄折算。"), (0.65, "本周完成项目。")]]
        with self.client(lambda r: httpx.Response(200, json={"hits": {"hits": hits}})):
            result = await self.store.search("tenant-a", "差旅报销")
        self.assertEqual(len(result), 1)

    async def test_es_errors_are_not_silently_replaced_with_unrelated_lexical_hits(self):
        with self.client(lambda r: httpx.Response(400, json={"error": "dimension mismatch"})):
            with self.assertRaises(httpx.HTTPStatusError):
                await self.store.search("tenant-a", "报销")
        self.assertEqual(len(self.requests), 1)

    async def test_local_mode_uses_scoped_phrases_without_semantic_embeddings(self):
        self.store.settings.embedding_model = ""
        with self.client(lambda r: httpx.Response(200, json={"hits": {"hits": []}})):
            await self.store.search("tenant-a", "差旅报销")
        self.store.embedder.embed.assert_not_awaited()
        body = self.requests[0][1]
        self.assertNotIn("knn", body)
        self.assertIn("tenant-a", json.dumps(body))
        self.assertEqual(len(body["query"]["bool"]["should"]), 3)

    async def test_index_replacement_removes_old_chunks_and_namespaces_storage_ids(self):
        with self.client(lambda r: httpx.Response(200, json={})):
            await self.store.index_document("tenant-a", "policy", "差旅", "出差结束后30天内报销。")
            await self.store.index_document("tenant-b", "policy", "差旅", "出差结束后30天内报销。")
        writes = [request.url.path for request, body in self.requests if request.method == "PUT"]
        self.assertNotEqual(writes[0], writes[1])
        cleanups = [body for request, body in self.requests if "_delete_by_query" in request.url.path]
        self.assertEqual(len(cleanups), 2)
        for index, space in enumerate(["tenant-a", "tenant-b"]):
            query = cleanups[index]["query"]["bool"]
            self.assertIn({"term": {"workspaceId": space}}, query["filter"])
            self.assertIn({"term": {"documentId": "policy"}}, query["filter"])
            self.assertEqual(query["must_not"][0]["ids"]["values"], [writes[index].split("/")[-1]])

    async def test_invalid_text_is_rejected_before_embedding_or_writes(self):
        for text in ["", "x" * 1200, "差旅报销制度 " * 120]:
            with self.assertRaises(ValueError):
                await self.store.index_document("tenant-a", "bad", "制度", text)
        self.store.embedder.embed.assert_not_awaited()
        self.assertTrue(usable_content("差旅报销需在30天内提交。"))


class EvidenceTests(unittest.TestCase):
    def test_only_explicit_backed_markers_are_selected_and_duplicates_removed(self):
        candidates = [{"chunkId": "travel-1", "title": "报销制度", "content": "30天内提交。"},
                      {"chunkId": "copy-1", "title": "报销制度", "content": "３０天内提交。\n"},
                      {"chunkId": "leave-1", "title": "年假制度", "content": "提前3天申请。"}]
        self.assertEqual(cited_sources("本周完成工作台。", candidates), [])
        self.assertEqual(cited_sources("30天。[来源：报销制度] [来源: 不存在的制度]", candidates), candidates[:1])
        self.assertEqual(cited_sources("请提前申请。[来源: leave-1]", candidates), candidates[2:])

    def test_input_only_does_not_disable_explicit_policy_lookup(self):
        self.assertTrue(input_only("仅根据以下事实写周报：完成工作台"))
        self.assertTrue(input_only("不要检索知识库，整理会议记录"))
        self.assertFalse(input_only("仅根据公司报销制度回答出差住宿标准"))
