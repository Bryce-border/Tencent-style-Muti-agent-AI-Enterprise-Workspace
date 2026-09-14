"""Import a stopped R1 SQLite snapshot and verify every record via Java's service API."""
import argparse
import json
import sqlite3
from pathlib import Path

import httpx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True)
    parser.add_argument("--service-url", default="http://localhost:8081")
    args = parser.parse_args()
    env = dict(line.split("=", 1) for line in Path(__file__).with_name(".env.r2").read_text().splitlines() if "=" in line)
    db = sqlite3.connect(f"file:{Path(args.database).resolve().as_posix()}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    tasks = []
    for row in db.execute("SELECT * FROM tasks"):
        task = dict(row)
        task["plan"] = json.loads(task["plan"])
        task["result"] = json.loads(task["result"]) if task["result"] else None
        task.setdefault("employee_id", "ai_assistant")
        tasks.append(task)
    events = {}
    for row in db.execute("SELECT * FROM task_events ORDER BY id"):
        events.setdefault(row["task_id"], []).append({"type": row["event_type"], "payload": json.loads(row["payload"]), "created_at": row["created_at"]})
    reports = [dict(row) for row in db.execute("SELECT * FROM reports")]
    payload = {"tasks": tasks, "events": events, "reports": reports}
    with httpx.Client(base_url=args.service_url, headers={"X-Internal-Token": env["WORKSPACE_INTERNAL_TOKEN"]}, timeout=60) as client:
        response = client.post("/internal/migration", json=payload)
        response.raise_for_status()
        counts = response.json()
        for task in tasks:
            actual = client.get(f"/internal/tasks/{task['task_id']}")
            actual.raise_for_status()
            value = actual.json()
            for key in ("workspace_id", "prompt", "employee_id", "plan", "result", "created_at"):
                assert value[key] == task[key], f"Mismatch: {task['task_id']} {key}"
        summary = {"source": {"tasks": len(tasks), "events": sum(map(len, events.values())), "reports": len(reports)}, "destination": counts, "verified_tasks": len(tasks)}
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    db.close()


if __name__ == "__main__":
    main()
