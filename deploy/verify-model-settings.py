"""Exercise a workspace model override without printing API credentials."""
import time
from pathlib import Path
import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent


def main():
    auth = dotenv_values(ROOT / ".env.r2")
    base = "http://localhost:8080"
    with httpx.Client(base_url=base, timeout=35, headers={"X-Workspace-Request": "1", "Origin": base}) as client:
        def call(method, path, **kwargs):
            response = client.request(method, path, **kwargs)
            response.raise_for_status()
            return response.json()
        call("POST", "/auth/login", json={"username": "admin", "password": auth["BOOTSTRAP_PASSWORD"]})
        config = call("GET", "/v1/model-settings")
        assert "api_key" not in config and "encrypted_key" not in config
        assert config["source"] == "environment", "Preserve an existing custom configuration; verify in a separate space"
        values = {"base_url": config["base_url"], "model": "kimi-k3", "temperature": 0.2, "max_tokens": 1800, "use_environment_key": True}
        try:
            response = call("POST", "/v1/model-settings/test", json=values)
            assert response["ok"]
            print("PASS provider connection", response["model"], flush=True)
            saved = call("PUT", "/v1/model-settings", json=values)
            assert saved["model"] == "kimi-k3" and saved["has_key"] and "api_key" not in saved
            print("PASS encrypted configuration saved and masked", flush=True)
            task = call("POST", "/v1/tasks", json={"employee_id": "document_expert", "prompt": "仅根据以下事实写一句话：模型配置测试完成。不要扩展。"})
            print("TASK", task["task_id"], flush=True)
            for _ in range(60):
                task = call("GET", "/v1/tasks/" + task["task_id"])
                if task["status"] not in ["RUNNING", "PENDING"]:
                    break
                time.sleep(3)
            assert task["status"] in ["SUCCESS", "PENDING_CONFIRMATION"], task["result"].get("error", task["status"])
            assert task["result"]["data"]["model"]["name"] == "kimi-k3"
            assert task["result"]["data"]["output"] and not task["result"]["citations"]
            print("PASS task uses the workspace model and returns a real result", task["status"], flush=True)
        finally:
            call("DELETE", "/v1/model-settings")
            print("Restored deployment default", flush=True)


if __name__ == "__main__":
    main()
