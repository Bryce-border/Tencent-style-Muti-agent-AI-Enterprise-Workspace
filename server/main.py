"""Small, dependency-free API gateway for the v1 workspace.

The browser demo can run without this process. When it is started, the UI can
save provider settings here and use /api/chat as a server-side proxy so API
keys do not need to be sent back to the browser in plain text.
"""

from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


SERVER_ROOT = Path(__file__).resolve().parent
DATA_ROOT = SERVER_ROOT / ".data"
SETTINGS_FILE = DATA_ROOT / "provider-settings.json"
SETTINGS_LOCK = threading.Lock()
DEFAULT_SETTINGS: dict[str, Any] = {
    "providerName": "OpenAI Compatible",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "",
    "model": "gpt-4o-mini",
    "temperature": 0.2,
}


def read_settings() -> dict[str, Any]:
    with SETTINGS_LOCK:
        if not SETTINGS_FILE.exists():
            return DEFAULT_SETTINGS.copy()
        try:
            saved = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return DEFAULT_SETTINGS.copy()
    return {**DEFAULT_SETTINGS, **saved}


def save_settings(settings: dict[str, Any]) -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    temporary = SETTINGS_FILE.with_suffix(".tmp")
    with SETTINGS_LOCK:
        temporary.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(SETTINGS_FILE)


def public_settings(settings: dict[str, Any]) -> dict[str, Any]:
    key = str(settings.get("apiKey", ""))
    return {
        "providerName": settings.get("providerName", DEFAULT_SETTINGS["providerName"]),
        "baseUrl": settings.get("baseUrl", DEFAULT_SETTINGS["baseUrl"]),
        "model": settings.get("model", DEFAULT_SETTINGS["model"]),
        "temperature": settings.get("temperature", DEFAULT_SETTINGS["temperature"]),
        "hasApiKey": bool(key),
        "apiKeyPreview": f"{key[:4]}••••••••{key[-4:]}" if len(key) > 8 else ("已设置" if key else "尚未设置"),
    }


def validate_settings(payload: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    base_url = str(payload.get("baseUrl", current["baseUrl"])).strip().rstrip("/")
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Base URL 必须是完整的 http(s) 地址")

    model = str(payload.get("model", current["model"])).strip()
    if not model:
        raise ValueError("Model Name 不能为空")

    try:
        temperature = float(payload.get("temperature", current["temperature"]))
    except (TypeError, ValueError) as error:
        raise ValueError("Temperature 必须是 0 到 1 之间的数字") from error
    if not 0 <= temperature <= 1:
        raise ValueError("Temperature 必须是 0 到 1 之间的数字")

    next_settings = {
        "providerName": str(payload.get("providerName", current["providerName"])).strip() or DEFAULT_SETTINGS["providerName"],
        "baseUrl": base_url,
        "apiKey": str(payload["apiKey"]) if "apiKey" in payload else str(current.get("apiKey", "")),
        "model": model,
        "temperature": temperature,
    }
    return next_settings


def provider_request(settings: dict[str, Any], path: str, body: dict[str, Any] | None = None, timeout: int = 20) -> tuple[int, dict[str, Any]]:
    api_key = str(settings.get("apiKey", ""))
    if not api_key:
        return 400, {"message": "请先在工作空间设置中填写 API Key"}
    url = f"{str(settings['baseUrl']).rstrip('/')}/{path.lstrip('/')}"
    headers = {"Accept": "application/json", "Authorization": f"Bearer {api_key}"}
    request_body = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        request_body = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=request_body, headers=headers, method="POST" if body is not None else "GET")
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return response.status, json.loads(raw) if raw else {}
    except HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"message": f"模型服务返回 HTTP {error.code}"}
        return error.code, payload
    except (URLError, TimeoutError, OSError) as error:
        return 502, {"message": f"无法连接模型服务：{error.reason if isinstance(error, URLError) else error}"}


class WorkspaceHandler(BaseHTTPRequestHandler):
    server_version = "AIWorkspace/0.1"

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(encoded)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 2_000_000:
            raise ValueError("请求体过大")
        raw = self.rfile.read(length).decode("utf-8")
        payload = json.loads(raw or "{}")
        if not isinstance(payload, dict):
            raise ValueError("请求体必须是 JSON 对象")
        return payload

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_json(204, {})

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json(200, {"ok": True, "service": "workspace-api", "version": "0.1.0"})
            return
        if path == "/api/settings":
            self.send_json(200, public_settings(read_settings()))
            return
        self.send_json(404, {"message": "Not found"})

    def do_PUT(self) -> None:  # noqa: N802
        if urlparse(self.path).path != "/api/settings":
            self.send_json(404, {"message": "Not found"})
            return
        try:
            payload = self.read_json()
            settings = validate_settings(payload, read_settings())
            save_settings(settings)
            self.send_json(200, public_settings(settings))
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(400, {"message": str(error)})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            payload = self.read_json()
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(400, {"message": str(error)})
            return

        if path == "/api/provider/test":
            try:
                settings = validate_settings(payload, read_settings())
            except ValueError as error:
                self.send_json(400, {"message": str(error)})
                return
            status, response = provider_request(settings, "/models", timeout=8)
            if 200 <= status < 300:
                self.send_json(200, {"ok": True, "message": f"连接成功，{settings['model']} 可用"})
            else:
                message = response.get("error", {}).get("message") if isinstance(response.get("error"), dict) else response.get("message")
                self.send_json(status, {"message": message or f"连接测试失败（HTTP {status}）"})
            return

        if path == "/api/chat":
            messages = payload.get("messages")
            if not isinstance(messages, list) or not messages:
                self.send_json(400, {"message": "messages 不能为空"})
                return
            settings = read_settings()
            request = {"model": settings["model"], "messages": messages, "temperature": settings["temperature"]}
            status, response = provider_request(settings, "/chat/completions", request)
            if not 200 <= status < 300:
                message = response.get("error", {}).get("message") if isinstance(response.get("error"), dict) else response.get("message")
                self.send_json(status, {"message": message or f"模型调用失败（HTTP {status}）"})
                return
            content = ""
            choices = response.get("choices")
            if isinstance(choices, list) and choices and isinstance(choices[0], dict):
                message = choices[0].get("message", {})
                if isinstance(message, dict):
                    content = str(message.get("content", ""))
            self.send_json(200, {"content": content, "model": settings["model"]})
            return

        self.send_json(404, {"message": "Not found"})


def main() -> None:
    port = int(os.environ.get("WORKSPACE_API_PORT", "8787"))
    server = ThreadingHTTPServer(("127.0.0.1", port), WorkspaceHandler)
    print(f"AI Workspace API listening on http://127.0.0.1:{port}")
    print("Provider settings are managed from the workspace UI; no CLI secret is required.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping workspace API")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
