from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from threading import Lock
from typing import Any

from .schemas import Task, TaskResult, utc_now


def _without_embeddings(value: Any) -> Any:
    """Keep vectors out of task payloads; they belong in Elasticsearch only."""
    if isinstance(value, dict):
        return {key: _without_embeddings(item) for key, item in value.items() if key.lower() != "embedding"}
    if isinstance(value, list):
        return [_without_embeddings(item) for item in value]
    return value


class TaskStore:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = Lock()
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            self.db.execute("CREATE TABLE IF NOT EXISTS tasks (task_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL, plan TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")
            self.db.execute("CREATE TABLE IF NOT EXISTS task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)")
            columns = {row[1] for row in self.db.execute("PRAGMA table_info(tasks)")}
            if "employee_id" not in columns:
                self.db.execute("ALTER TABLE tasks ADD COLUMN employee_id TEXT NOT NULL DEFAULT 'ai_assistant'")
            self.db.execute("CREATE TABLE IF NOT EXISTS reports (task_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)")
            self.db.execute("CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id, id)")

    def save(self, task: Task) -> bool:
        result_json = None
        if task.result:
            result_json = json.dumps(_without_embeddings(task.result.model_dump(mode="json")), ensure_ascii=False)
        with self.lock, self.db:
            self.db.execute("BEGIN IMMEDIATE")
            existing = self.db.execute("SELECT status FROM tasks WHERE task_id = ?", (task.task_id,)).fetchone()
            if existing and existing["status"] == "CANCELLED" and task.status != "CANCELLED":
                return False
            if existing and existing["status"] in ("SUCCESS", "FAILED") and task.status == "CANCELLED":
                return False
            self.db.execute("INSERT OR REPLACE INTO tasks (task_id, workspace_id, prompt, status, plan, result, created_at, updated_at, employee_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (task.task_id, task.workspace_id, task.prompt, task.status, json.dumps(_without_embeddings(task.plan), ensure_ascii=False), result_json, task.created_at.isoformat(), task.updated_at.isoformat(), task.employee_id))
            if task.status == "SUCCESS" and task.result and task.result.data.get("mode") == "crewai":
                output = task.result.data.get("output")
                if isinstance(output, str) and output.strip():
                    self.db.execute("INSERT OR IGNORE INTO reports VALUES (?, ?, ?, ?, ?)", (task.task_id, task.workspace_id, task.prompt, output, task.updated_at.isoformat()))
        return True

    def get(self, task_id: str) -> Task | None:
        row = self.db.execute("SELECT * FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
        if row is None:
            return None
        result = _without_embeddings(json.loads(row["result"])) if row["result"] else None
        return Task(task_id=row["task_id"], workspace_id=row["workspace_id"], prompt=row["prompt"], employee_id=row["employee_id"], status=row["status"], plan=_without_embeddings(json.loads(row["plan"])), result=TaskResult.model_validate(result) if result else None, created_at=row["created_at"], updated_at=row["updated_at"])

    def list(self, workspace_id: str = "default", limit: int = 20) -> list[Task]:
        rows = self.db.execute("SELECT * FROM tasks WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?", (workspace_id, min(max(limit, 1), 100))).fetchall()
        tasks = []
        for row in rows:
            result = _without_embeddings(json.loads(row["result"])) if row["result"] else None
            tasks.append(Task(task_id=row["task_id"], workspace_id=row["workspace_id"], prompt=row["prompt"], employee_id=row["employee_id"], status=row["status"], plan=_without_embeddings(json.loads(row["plan"])), result=TaskResult.model_validate(result) if result else None, created_at=row["created_at"], updated_at=row["updated_at"]))
        return tasks

    def stats(self, workspace_id: str = "default") -> dict[str, int]:
        """Return dashboard counters without loading full task results."""
        row = self.db.execute(
            """SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status IN ('PENDING', 'RUNNING') THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status = 'PENDING_CONFIRMATION' THEN 1 ELSE 0 END) AS pending_confirmation,
                SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success,
                SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed
            FROM tasks WHERE workspace_id = ?""",
            (workspace_id,),
        ).fetchone()
        return {
            "total": int(row["total"] or 0),
            "active": int(row["active"] or 0),
            "pending_confirmation": int(row["pending_confirmation"] or 0),
            "success": int(row["success"] or 0),
            "failed": int(row["failed"] or 0),
        }

    def add_event(self, task_id: str, event_type: str, payload: dict[str, Any]) -> None:
        with self.lock, self.db:
            self.db.execute("INSERT INTO task_events(task_id,event_type,payload,created_at) VALUES (?, ?, ?, ?)", (task_id, event_type, json.dumps(payload, ensure_ascii=False), utc_now().isoformat()))

    def events(self, task_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT event_type,payload,created_at FROM task_events WHERE task_id = ? ORDER BY id", (task_id,)).fetchall()
        return [{"type": row["event_type"], "payload": json.loads(row["payload"]), "created_at": row["created_at"]} for row in rows]

    def reports(self, workspace_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT task_id, title, created_at FROM reports WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100", (workspace_id,)).fetchall()
        return [dict(row) for row in rows]

    def report(self, task_id: str, workspace_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM reports WHERE task_id = ? AND workspace_id = ?", (task_id, workspace_id)).fetchone()
        return dict(row) if row else None

    def messages(self, workspace_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT e.id, e.task_id, e.event_type, e.payload, e.created_at, t.prompt FROM task_events e JOIN tasks t ON t.task_id = e.task_id WHERE t.workspace_id = ? ORDER BY e.id DESC LIMIT 100", (workspace_id,)).fetchall()
        return [{"id": row["id"], "task_id": row["task_id"], "type": row["event_type"], "prompt": row["prompt"], "payload": _without_embeddings(json.loads(row["payload"])), "created_at": row["created_at"]} for row in rows]

    def claim(self, task_id: str) -> bool:
        with self.lock, self.db:
            changed = self.db.execute("UPDATE tasks SET status = 'RUNNING', updated_at = ? WHERE task_id = ? AND status = 'PENDING'", (utc_now().isoformat(), task_id))
            return changed.rowcount == 1

    def update_plan(self, task_id: str, plan: list[dict]) -> None:
        with self.lock, self.db:
            self.db.execute("UPDATE tasks SET plan = ? WHERE task_id = ?", (json.dumps(plan, ensure_ascii=False), task_id))
