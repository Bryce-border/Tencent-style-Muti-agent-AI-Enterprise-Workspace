from uuid import uuid4

import httpx

from .schemas import Task


class RemoteTaskStore:
    """Java owns business records; workers mutate only the task lease they claimed."""

    def __init__(self, url: str, token: str):
        if len(token) < 32:
            raise ValueError("WORKSPACE_INTERNAL_TOKEN must contain at least 32 characters")
        self.client = httpx.Client(base_url=url.rstrip("/"), timeout=10,
                                   headers={"X-Internal-Token": token})
        self.leases: dict[str, str] = {}

    def _request(self, method, task_id, suffix="", body=None):
        response = self.client.request(method, f"/internal/tasks/{task_id}{suffix}",
            headers={"X-Lease-Token": self.leases.get(task_id, "")}, json=body)
        response.raise_for_status()
        return response.json()

    def get(self, task_id: str):
        try:
            return Task.model_validate(self._request("GET", task_id))
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return None
            raise

    def claim(self, task_id: str) -> bool:
        self.leases[task_id] = str(uuid4())
        return self._request("POST", task_id, "/claim")["ok"]

    def heartbeat(self, task_id: str) -> bool:
        return self._request("POST", task_id, "/heartbeat")["ok"]

    def model_settings(self, task_id: str) -> dict:
        return self._request("GET", task_id, "/model-settings")

    def context(self, task_id: str) -> dict:
        return self._request("GET", task_id, "/context")

    def save(self, task: Task) -> bool:
        return self._request("PUT", task.task_id, body=task.model_dump(mode="json"))["ok"]

    def update_plan(self, task_id: str, plan: list):
        return self._request("PUT", task_id, "/plan", plan)["ok"]

    def add_event(self, task_id: str, event_type: str, payload: dict):
        return self._request("POST", task_id, "/events", {"type": event_type, "payload": payload})["ok"]

    def release(self, task_id: str):
        self.leases.pop(task_id, None)
