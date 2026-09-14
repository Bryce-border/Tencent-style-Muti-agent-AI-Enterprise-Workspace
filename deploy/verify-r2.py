"""Exercise the deployed gateway, real MySQL/Redis/RabbitMQ, and tenant boundaries."""
import json
import secrets
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import httpx


def main():
    base = "http://localhost:8080"
    checks = []
    credentials = []
    headers = {"X-Workspace-Request": "1", "Origin": base}
    clients = [httpx.Client(base_url=base, headers=headers, timeout=35) for _ in range(2)]

    def check(name, condition):
        assert condition, name
        checks.append(name)
        print("PASS", name, flush=True)

    def call(client, method, path, expected=200, **kwargs):
        response = client.request(method, path, **kwargs)
        assert response.status_code == expected, f"{method} {path}: {response.status_code} {response.text[:160]}"
        return response

    check("anonymous blocked", httpx.get(base + "/v1/tasks").status_code == 401)
    check("internal API absent from gateway", httpx.get(base + "/internal/tasks/none").status_code == 404)
    check("Python requires service credentials", httpx.get("http://localhost:8000/v1/tasks").status_code == 401)
    profiles = []
    for index, client in enumerate(clients):
        credential = {"username": f"r2_demo_{uuid4().hex[:8]}", "password": secrets.token_urlsafe(24), "workspace_name": f"R2 验收空间 {index + 1}"}
        response = call(client, "POST", "/auth/register", json=credential)
        check(f"secure cookie attributes {index}", "HttpOnly" in response.headers["set-cookie"] and "SameSite=Lax" in response.headers["set-cookie"])
        profiles.append(response.json())
        credentials.append(credential)
    a, b = clients
    check("distinct tenant IDs", profiles[0]["workspace_id"] != profiles[1]["workspace_id"])
    body = {"prompt": "发送项目报告：仅测试外部操作阻断", "employee_id": "document_expert", "workspace_id": profiles[1]["workspace_id"]}
    key = uuid4().hex
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: call(a, "POST", "/v1/tasks", 202, json=body, headers={"Idempotency-Key": key}).json(), range(2)))
    task = results[0]
    check("concurrent idempotent creation", task["task_id"] == results[1]["task_id"])
    check("body workspace ignored", task["workspace_id"] == profiles[0]["workspace_id"])
    call(a, "POST", "/v1/tasks", 409, json={**body, "prompt": "changed"}, headers={"Idempotency-Key": key})
    for suffix in ("", "/events", "/stream", "/export"):
        call(b, "GET", f"/v1/tasks/{task['task_id']}{suffix}", 404)
    for action in ("cancel", "confirm"):
        call(b, "POST", f"/v1/tasks/{task['task_id']}/{action}", 404)
    check("task read/write/SSE/export isolation", True)
    check("query tenant spoof blocked", call(b, "GET", f"/v1/tasks?workspace_id={profiles[0]['workspace_id']}").json() == [])
    for _ in range(30):
        task = call(a, "GET", f"/v1/tasks/{task['task_id']}").json()
        if task["status"] not in ("PENDING", "RUNNING"):
            break
        time.sleep(1)
    check("Java outbox to Python worker", task["status"] == "PENDING_CONFIRMATION" and task["result"]["next_action"] == "CONNECTOR_REQUIRED")
    call(a, "POST", f"/v1/tasks/{task['task_id']}/confirm", 409)
    call(a, "POST", f"/v1/tasks/{task['task_id']}/cancel")
    check("external write cannot be approved", True)
    events = call(a, "GET", f"/v1/tasks/{task['task_id']}/events").json()
    stream = call(a, "GET", f"/v1/tasks/{task['task_id']}/stream", headers={"Last-Event-ID": str(events[-2]["id"])}).text
    check("SSE resumes after cursor", f"id:{events[-1]['id']}" in stream and f"id:{events[0]['id']}\n" not in stream)
    for index, client in enumerate(clients):
        call(client, "POST", "/v1/knowledge/documents", json={"document_id": "same-policy", "title": f"R2 tenant {index} policy", "content": f"R2 tenant {index} policy marker tenant-{index}-exclusive"})
    for index, client in enumerate(clients):
        hits = call(client, "GET", "/v1/knowledge/search?q=policy").json()
        check(f"Elasticsearch namespace isolation {index}", bool(hits) and all(hit["workspaceId"] == profiles[index]["workspace_id"] for hit in hits) and all(f"tenant-{1-index}-exclusive" not in hit["content"] for hit in hits))
    call(a, "POST", "/v1/admin/members", json={"username": credentials[1]["username"], "role": "VIEWER"})
    call(b, "POST", "/auth/workspace", json={"workspace_id": profiles[0]["workspace_id"]})
    check("workspace switch persists session", call(b, "GET", "/auth/me").json()["role"] == "VIEWER")
    call(b, "POST", "/v1/tasks", 403, json=body)
    call(b, "GET", "/v1/admin/members", 403)
    call(b, "POST", "/v1/knowledge/documents", 403, json={"content": "denied"})
    check("viewer write and administration denied", True)
    call(a, "POST", "/v1/admin/members", json={"username": credentials[1]["username"], "role": "MEMBER"})
    check("role changes apply to existing JWT", call(b, "GET", "/auth/me").json()["role"] == "MEMBER")
    check("audit is populated", len(call(a, "GET", "/v1/admin/audit").json()) >= 4)
    cookie = b.cookies.get("workspace_session")
    call(b, "POST", "/auth/logout")
    check("logout revokes stolen session copy", httpx.get(base + "/auth/me", cookies={"workspace_session": cookie}).status_code == 401)
    artifact = Path(__file__).parent.parent / ".tools" / "r2-demo-credentials.json"
    artifact.write_text(json.dumps(credentials, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"passed": len(checks), "demo_username": credentials[0]["username"], "credentials_file": str(artifact)}, ensure_ascii=False), flush=True)
    for client in clients:
        client.close()


if __name__ == "__main__":
    main()
