import asyncio
import json
import importlib
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError
from fastapi import HTTPException

from app.config import Settings
from app.execution import ExecutionPlan, Review, WorkspaceRuntime
from app.schemas import Task, TaskResult
from app.store import TaskStore


class PlanTests(unittest.TestCase):
    def test_rejects_cycles_unknown_employees_and_missing_dependencies(self):
        for steps in (
            [{"node_id": "a", "employee_id": "ai_engineer", "objective": "实现方案", "depends_on": ["b"]}],
            [{"node_id": "a", "employee_id": "invented_agent", "objective": "实现方案"}],
            [{"node_id": "a", "employee_id": "ai_engineer", "objective": "实现方案", "depends_on": ["a"]}],
            [{"node_id": "delivery", "employee_id": "ai_engineer", "objective": "实现方案"}],
        ):
            with self.subTest(steps=steps), self.assertRaises(ValidationError):
                ExecutionPlan(steps=steps)

    def test_out_of_order_dependencies_are_valid(self):
        plan = ExecutionPlan(steps=[
            {"node_id": "second", "employee_id": "ai_engineer", "objective": "实现方案", "depends_on": ["first"]},
            {"node_id": "first", "employee_id": "product_designer", "objective": "需求方案"},
        ])
        self.assertEqual(len(plan.steps), 2)


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = WorkspaceRuntime(Settings(llm_model="test-model", llm_api_key="test-only", _env_file=None))

    async def test_actual_handoff_and_review_revisions(self):
        calls = []
        events = []
        reviews = iter([Review(decision="REVISE", feedback="补充假设"), Review(decision="PASS", feedback="已补充")])

        def worker(employee, description, expected, schema=None):
            calls.append((employee, description))
            if schema == Review:
                return next(reviews)
            return f"{employee} 的真实测试输出"

        task = Task(workspace_id="tenant-a", prompt="生成产品开发方案", employee_id="product_designer")
        with patch.object(self.engine, "_call", side_effect=worker), patch("app.execution.KnowledgeStore.search", new_callable=AsyncMock, return_value=[]):
            result = await self.engine.execute(task, lambda name, payload: events.append(name))
        self.assertEqual(result.status, "SUCCESS")
        self.assertIn("product_designer 的真实测试输出", calls[1][1])
        self.assertIn("补充假设", calls[3][1])
        self.assertEqual(events.count("review.feedback"), 1)
        self.assertEqual(events.count("review.started"), 2)
        self.assertLess(events.index("revision.started"), events.index("revision.completed"))
        self.assertLess(events.index("revision.completed"), len(events) - 1)
        self.assertEqual(result.data["review"]["decision"], "PASS")

    async def test_revision_failure_reports_stage_without_false_completion(self):
        calls = iter(["原稿", Review(decision="REVISE", feedback="补充来源"), ValueError("invalid response")])
        records = []
        def worker(*args):
            value = next(calls)
            if isinstance(value, Exception):
                raise value
            return value
        task = Task(workspace_id="tenant-a", prompt="仅根据所给事实生成摘要", employee_id="document_expert")
        with patch.object(self.engine, "_call", side_effect=worker):
            result = await self.engine.execute(task, lambda name, payload: records.append((name, payload)))
        self.assertEqual(result.status, "PENDING_CONFIRMATION")
        self.assertEqual(result.data["output"], "原稿")
        self.assertNotIn("revision.completed", [name for name, _ in records])
        self.assertEqual(records[-1][1]["stage"], "revision")
        self.assertEqual(records[-1][1]["reason"], "ValueError")

    async def test_cancellation_stops_new_workers(self):
        with self.assertRaises(asyncio.CancelledError):
            await self.engine.execute(Task(workspace_id="default", prompt="生成文档"), is_cancelled=lambda: True)

    async def test_document_worker_delivers_without_duplicate_summary(self):
        calls = []

        def worker(employee, description, expected, schema=None):
            calls.append(schema)
            return Review(decision="PASS", feedback="符合目标") if schema == Review else "完成工作台；下周开发会议管理。"

        task = Task(workspace_id="default", prompt="仅根据所给事实写50字以内摘要", employee_id="document_expert")
        with patch.object(self.engine, "_call", side_effect=worker), patch("app.execution.KnowledgeStore.search", new_callable=AsyncMock, return_value=[]) as search:
            result = await self.engine.execute(task)
        search.assert_not_awaited()
        self.assertEqual(calls, [None, Review])
        self.assertEqual(len(task.plan), 1)
        self.assertEqual(result.data["output"], "完成工作台；下周开发会议管理。")
        self.assertEqual(result.status, "SUCCESS")

    async def test_review_revision_reselects_citations_even_if_reviewer_fails(self):
        source = {"chunkId": "travel-1", "title": "报销制度", "content": "30天内报销。"}
        calls = iter(["30天。[来源: travel-1]", Review(decision="REVISE", feedback="无需引用"), "仅保留用户事实。", TimeoutError()])
        def worker(*args):
            value = next(calls)
            if isinstance(value, Exception):
                raise value
            return value
        task = Task(workspace_id="default", prompt="整理出差情况", employee_id="document_expert")
        with patch.object(self.engine, "_call", side_effect=worker), patch("app.execution.KnowledgeStore.search", new_callable=AsyncMock, return_value=[source]):
            result = await self.engine.execute(task)
        self.assertEqual(result.status, "PENDING_CONFIRMATION")
        self.assertEqual(result.citations, [])
        self.assertEqual(result.data["retrieval_candidates"], [source])
        self.assertEqual(result.data["node_results"][0]["citations"], [source])
        self.assertEqual(result.data["output"], "仅保留用户事实。")

    async def test_review_failure_preserves_delivery_for_human_acceptance(self):
        def worker(employee, description, expected, schema=None):
            if schema == Review:
                raise TimeoutError("provider unavailable")
            return "# 已生成成果"
        task = Task(workspace_id="default", prompt="生成工作摘要", employee_id="document_expert")
        with patch.object(self.engine, "_call", side_effect=worker), patch("app.execution.KnowledgeStore.search", new_callable=AsyncMock, return_value=[]):
            result = await self.engine.execute(task)
        self.assertEqual(result.status, "PENDING_CONFIRMATION")
        self.assertEqual(result.next_action, "REVIEW_DELIVERABLE")
        self.assertEqual(result.data["output"], "# 已生成成果")

    async def test_missing_model_does_not_fabricate_success(self):
        engine = WorkspaceRuntime(Settings(llm_model="", llm_api_key="", _env_file=None))
        result = await engine.execute(Task(workspace_id="default", prompt="生成文档"))
        self.assertEqual(result.status, "FAILED")
        self.assertEqual(result.next_action, "CONFIGURE_LLM")

    async def test_external_write_is_not_executed(self):
        with patch.object(self.engine, "_call") as worker:
            result = await self.engine.execute(Task(workspace_id="default", prompt="发送项目报告"))
        self.assertEqual(result.status, "PENDING_CONFIRMATION")
        self.assertEqual(result.next_action, "CONNECTOR_REQUIRED")
        worker.assert_not_called()


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        test_root = Path(__file__).parent / ".test-data"
        test_root.mkdir(exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(dir=test_root)
        self.path = str(Path(self.directory.name) / "test.db")
        self.store = TaskStore(self.path)

    def tearDown(self):
        self.store.db.close()
        self.directory.cleanup()

    def test_reports_are_idempotent_scoped_and_only_real_results(self):
        task = Task(workspace_id="tenant-a", prompt="生成项目需求", employee_id="product_designer")
        task.result = TaskResult(task_id=task.task_id, agent="product_designer", status="SUCCESS", data={"mode": "crewai", "output": "# 项目需求\n具体工作成果"})
        self.store.save(task)
        self.assertEqual(self.store.reports("tenant-a"), [])
        task.status = "SUCCESS"
        self.store.save(task)
        self.store.save(task)
        self.assertEqual(len(self.store.reports("tenant-a")), 1)
        self.assertEqual(self.store.reports("tenant-b"), [])
        self.assertIsNone(self.store.report(task.task_id, "tenant-b"))
        self.assertEqual(self.store.get(task.task_id).employee_id, "product_designer")

    def test_duplicate_queue_delivery_claims_once(self):
        task = Task(workspace_id="default", prompt="生成项目需求")
        self.store.save(task)
        other = TaskStore(self.path)
        try:
            self.assertTrue(self.store.claim(task.task_id))
            self.assertFalse(other.claim(task.task_id))
        finally:
            other.db.close()

    def test_stale_worker_cannot_overwrite_cancel_or_archive_report(self):
        task = Task(workspace_id="default", prompt="生成需求方案")
        self.store.save(task)
        stale = self.store.get(task.task_id)
        task.status = "CANCELLED"
        self.store.save(task)
        stale.status = "SUCCESS"
        stale.result = TaskResult(task_id=task.task_id, agent="test", status="SUCCESS", data={"mode": "crewai", "output": "stale result"})
        self.assertFalse(self.store.save(stale))
        self.assertEqual(self.store.get(task.task_id).status, "CANCELLED")
        self.assertEqual(self.store.reports("default"), [])

    def test_messages_are_workspace_scoped_and_filter_vectors(self):
        task = Task(workspace_id="tenant-a", prompt="生成项目需求")
        self.store.save(task)
        self.store.add_event(task.task_id, "test", {"embedding": [1,2,3]})
        self.assertEqual(self.store.messages("tenant-b"), [])
        self.assertEqual(self.store.messages("tenant-a")[0]["payload"], {})

    def test_legacy_schema_is_migrated_without_losing_tasks(self):
        self.store.db.close()
        legacy_path = str(Path(self.directory.name) / "legacy.db")
        connection = sqlite3.connect(legacy_path)
        connection.execute("CREATE TABLE tasks (task_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL, plan TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")
        connection.execute("INSERT INTO tasks VALUES ('old', 'default', '历史任务', 'SUCCESS', '[]', NULL, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')")
        connection.commit()
        connection.close()
        self.store = TaskStore(legacy_path)
        self.assertEqual(self.store.get("old").employee_id, "ai_assistant")
        self.assertEqual(self.store.get("old").prompt, "历史任务")


class ApprovalTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        with patch("app.config.get_settings", return_value=Settings(database_path=":memory:", _env_file=None)):
            cls.api = importlib.import_module("app.main")

    def setUp(self):
        self.store = TaskStore(":memory:")
        self.store_patch = patch.object(self.api, "store", self.store)
        self.store_patch.start()

    def tearDown(self):
        self.store_patch.stop()
        self.store.db.close()

    async def test_confirm_cannot_fake_an_external_write(self):
        task = Task(workspace_id="default", prompt="发送报告", status="PENDING_CONFIRMATION")
        task.result = TaskResult(task_id=task.task_id, agent="test", status="PENDING_CONFIRMATION", next_action="CONNECTOR_REQUIRED")
        self.store.save(task)
        with self.assertRaises(HTTPException) as caught:
            await self.api.confirm_task(task.task_id)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(self.store.get(task.task_id).status, "PENDING_CONFIRMATION")

    async def test_accept_delivery_archives_real_output(self):
        task = Task(workspace_id="default", prompt="审核报告", status="PENDING_CONFIRMATION")
        task.result = TaskResult(task_id=task.task_id, agent="test", status="PENDING_CONFIRMATION", next_action="REVIEW_DELIVERABLE", data={"mode": "crewai", "output": "# 审核成果"})
        self.store.save(task)
        confirmed = await self.api.confirm_task(task.task_id)
        self.assertEqual(confirmed.status, "SUCCESS")
        self.assertEqual(len(self.store.reports("default")), 1)


if __name__ == "__main__":
    unittest.main()
