import asyncio
import unittest
from unittest.mock import patch

from app.config import Settings
from app.execution import WorkspaceRuntime
from app.long_document import ChapterDraft, DocumentBrief, DocumentReview, clean_body
from app.schemas import Task
from app.telemetry import record_usage


class LongDocumentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.runtime = WorkspaceRuntime(Settings(llm_model="test", llm_api_key="test", _env_file=None))
        self.task = Task(workspace_id="private", prompt="仅使用本次资料：星舟项目角色为管理员与员工。")
        self.spec = {"generation_mode": "chapters", "title": "星舟方案", "sections": ["需求", "架构"], "length": "1000字"}
        self.events = []
        self.calls = []

    def emit(self, name, payload):
        self.events.append((name, payload))

    def worker(self, employee, description, expected, schema):
        self.calls.append((schema, description))
        record_usage({"total_tokens": 40, "prompt_tokens": 25, "completion_tokens": 15})
        if schema is DocumentBrief:
            return DocumentBrief(facts=["星舟角色为管理员与员工"], constraints=["不得增加角色"])
        if schema is DocumentReview:
            return DocumentReview(decision="PASS", feedback="结构与事实一致")
        chapter = "需求" if "本次只写第1章" in description else "架构"
        return ChapterDraft(content=f"## {chapter}\n星舟：管理员与员工。", summary=f"{chapter}摘要：固定两个角色")

    async def run_doc(self, worker=None, checkpoint=None, spec=None, cancel=None):
        context = {"output_spec": spec or self.spec, "document_checkpoint": checkpoint or {},
                   "memories": [{"content": "SECRET_MEMORY"}], "turns": [{"user": "SECRET_HISTORY"}]}
        with patch.object(self.runtime, "_call", side_effect=worker or self.worker):
            return await self.runtime.execute(self.task, self.emit, cancel, context)

    async def test_chapters_use_shared_context_and_assemble_without_extra_generation(self):
        result = await self.run_doc()
        self.assertEqual(result.status, "SUCCESS")
        self.assertEqual([s for s, _ in self.calls], [DocumentBrief, ChapterDraft, ChapterDraft, DocumentReview])
        self.assertIn("需求摘要", self.calls[2][1])
        self.assertIn("不得增加角色", self.calls[2][1])
        self.assertTrue(all("SECRET_" not in prompt for _, prompt in self.calls))
        self.assertEqual(result.data["output"].count("## 需求"), 1)
        self.assertEqual(result.data["metrics"]["reported_tokens"], 160)
        self.assertEqual(result.data["metrics"]["agent_calls"], 4)
        self.assertTrue(result.data["document"]["complete"])

    async def test_failed_second_chapter_resumes_only_with_matching_task_context(self):
        def failing(*args):
            if args[-1] is ChapterDraft and "本次只写第2章" in args[1]:
                raise TimeoutError()
            return self.worker(*args)
        result = await self.run_doc(failing)
        self.assertEqual(result.status, "FAILED")
        self.assertEqual(result.next_action, "RETRY_DOCUMENT")
        self.assertEqual(len(result.data["document"]["chapters"]), 1)
        checkpoint = [p for name, p in self.events if name == "document.checkpoint"][-1]
        self.calls.clear()
        result = await self.run_doc(checkpoint=checkpoint)
        self.assertEqual(result.status, "SUCCESS")
        self.assertEqual([s for s, _ in self.calls], [ChapterDraft, DocumentReview])
        self.assertEqual(result.data["metrics"]["reused_chapters"], 1)
        self.calls.clear()
        await self.run_doc(checkpoint=checkpoint, spec={**self.spec, "length": "2000字"})
        self.assertEqual(self.calls[0][0], DocumentBrief)
        self.task = Task(workspace_id="other", prompt=self.task.prompt)
        self.calls.clear()
        await self.run_doc(checkpoint=checkpoint)
        self.assertEqual(self.calls[0][0], DocumentBrief)

    async def test_targeted_revision_preserves_other_chapter_and_rechecks_full_text(self):
        reviews = 0
        def worker(*args):
            nonlocal reviews
            if args[-1] is DocumentReview:
                reviews += 1
                if reviews == 1:
                    return DocumentReview(decision="REVISE", feedback="细化架构", issues=[{"chapter_id": "chapter-2", "feedback": "细化权限"}])
                self.assertIn("修订后的架构正文", args[1])
                return DocumentReview(decision="PASS", feedback="通过")
            if args[-1] is ChapterDraft and "仅修订以下章节" in args[1]:
                return ChapterDraft(content="修订后的架构正文", summary="权限已细化")
            return self.worker(*args)
        result = await self.run_doc(worker)
        self.assertEqual(result.status, "SUCCESS")
        self.assertEqual(result.data["document"]["chapters"][0]["content"], "星舟：管理员与员工。")
        self.assertEqual(result.data["document"]["chapters"][1]["content"], "修订后的架构正文")
        self.assertIn("document.chapter.revision.completed", [n for n, _ in self.events])

    async def test_unknown_review_chapter_requires_human_instead_of_modifying_wrong_content(self):
        def worker(*args):
            if args[-1] is DocumentReview:
                return DocumentReview(decision="REVISE", feedback="修订", issues=[{"chapter_id": "foreign", "feedback": "错误ID"}])
            return self.worker(*args)
        result = await self.run_doc(worker)
        self.assertEqual(result.status, "PENDING_CONFIRMATION")
        self.assertEqual(result.next_action, "REVIEW_DELIVERABLE")
        self.assertEqual(len(result.data["document"]["chapters"]), 2)
        self.assertNotIn("revision.started", [n for n, _ in self.events])

    async def test_cancellation_does_not_launch_next_chapter(self):
        cancelled = False
        def worker(*args):
            nonlocal cancelled
            result = self.worker(*args)
            if args[-1] is ChapterDraft:
                cancelled = True
            return result
        with self.assertRaises(asyncio.CancelledError):
            await self.run_doc(worker, cancel=lambda: cancelled)
        self.assertEqual(len(self.calls), 2)

    async def test_reviewer_outage_preserves_whole_document_for_human_review(self):
        def worker(*args):
            if args[-1] is DocumentReview:
                raise TimeoutError()
            return self.worker(*args)
        result = await self.run_doc(worker)
        self.assertEqual(result.status, "PENDING_CONFIRMATION")
        self.assertTrue(result.data["document"]["complete"])
        self.assertEqual(result.data["metrics"]["failed_calls"], 1)

    async def test_extensive_revision_is_deferred_without_unbounded_model_calls(self):
        sections = ["需求", "架构", "验收", "发布"]
        def worker(*args):
            if args[-1] is DocumentReview:
                return DocumentReview(decision="REVISE", feedback="需要逐章人工核对",
                    issues=[{"chapter_id": f"chapter-{i + 1}", "feedback": "核对角色范围"} for i in range(4)])
            return self.worker(*args)
        result = await self.run_doc(worker, spec={**self.spec, "sections": sections})
        self.assertEqual(result.status, "PENDING_CONFIRMATION")
        self.assertTrue(result.data["document"]["complete"])
        self.assertEqual(result.data["metrics"]["agent_calls"], 6)
        self.assertIn("revision.deferred", [name for name, _ in self.events])
        self.assertNotIn("revision.started", [name for name, _ in self.events])

    def test_empty_body_rejected_and_code_heading_is_not_rewritten(self):
        with self.assertRaises(ValueError):
            clean_body("## 需求", "需求")
        self.assertEqual(clean_body("```md\n# code\n```\n# extra", "需求"), "```md\n# code\n```\n### extra")
