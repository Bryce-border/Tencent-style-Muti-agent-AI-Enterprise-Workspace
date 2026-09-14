from __future__ import annotations

import asyncio
import base64
import json
import hmac
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .employees import list_employees
from .knowledge import KnowledgeStore, cited_sources
from .documents import DocumentFiles
from .execution import WorkspaceRuntime
from .schemas import Task, TaskCreate, TaskResult, utc_now
from .store import TaskStore, _without_embeddings
from .remote_store import RemoteTaskStore

settings = get_settings()
runtime = WorkspaceRuntime(settings)
store = (RemoteTaskStore(settings.workspace_service_url, settings.workspace_internal_token)
         if settings.workspace_service_url else TaskStore(settings.database_path))
knowledge = KnowledgeStore(settings)
active_tasks: set[str] = set()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await knowledge.ensure_index()
    yield


app = FastAPI(title="AI Enterprise Workspace Agent Runtime", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins.split(","), allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")


@app.middleware("http")
async def internal_boundary(request: Request, call_next):
    if settings.workspace_service_url and request.url.path != "/health":
        token = request.headers.get("X-Internal-Token", "")
        if not hmac.compare_digest(token, settings.workspace_internal_token):
            return JSONResponse({"detail": "service authentication required"}, status_code=401)
        if request.url.path not in ("/v1/employees", "/v1/dashboard", "/v1/knowledge/search", "/v1/knowledge/documents", "/v1/model-defaults", "/v1/files/store", "/v1/files/index", "/v1/files/download", "/v1/files/exclude"):
            return JSONResponse({"detail": "business API moved to workspace-service"}, status_code=410)
    return await call_next(request)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}


@app.get("/v1/model-defaults")
async def model_defaults(request: Request) -> dict:
    # This endpoint contains a credential and is never available in standalone mode.
    if not settings.workspace_internal_token or not hmac.compare_digest(request.headers.get("X-Internal-Token", ""), settings.workspace_internal_token):
        raise HTTPException(status_code=403, detail="service authentication required")
    return {"base_url": settings.llm_base_url, "model": settings.llm_model, "api_key": settings.llm_api_key,
            "temperature": settings.llm_temperature, "max_tokens": settings.llm_max_tokens}


@app.post("/v1/files/{action}")
async def document_files(action: str, payload: dict, request: Request) -> dict:
    if not settings.workspace_internal_token or not hmac.compare_digest(request.headers.get("X-Internal-Token", ""), settings.workspace_internal_token):
        raise HTTPException(status_code=403, detail="service authentication required")
    files = DocumentFiles(settings)
    try:
        if action == "store":
            return await asyncio.to_thread(files.store, payload)
        if action == "download":
            return {"content_base64": base64.b64encode(await asyncio.to_thread(files.read, payload)).decode("ascii")}
        if action == "index":
            return await asyncio.wait_for(files.index(payload), timeout=180)
        if action == "exclude":
            return await files.exclude(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="文件处理失败，请检查文件格式和存储、索引服务后重试") from exc
    raise HTTPException(status_code=404, detail="unknown file action")


@app.get("/v1/employees")
async def get_employees() -> list[dict]:
    configured = bool(settings.llm_api_key and settings.llm_model)
    return [employee | {"status": "available" if configured else "unconfigured", "execution_scope": "text_and_knowledge"} for employee in list_employees()]


@app.get("/v1/dashboard")
async def dashboard(workspace_id: str = "default") -> dict:
    task_stats = store.stats(workspace_id) if not settings.workspace_service_url else {}
    try:
        knowledge_stats = await knowledge.stats(workspace_id)
    except Exception:
        # Dashboard remains useful while Elasticsearch is starting or offline.
        knowledge_stats = {"documents": 0, "chunks": 0, "available": False}
    return {
        "workspace_id": workspace_id,
        "tasks": task_stats,
        "knowledge": knowledge_stats,
        "employee_count": len(list_employees()),
        "employees_available": len(list_employees()) if settings.llm_api_key and settings.llm_model else 0,
        "reports": len(store.reports(workspace_id)) if not settings.workspace_service_url else 0,
        "runtime": {"configured": bool(settings.llm_api_key and settings.llm_model), "model": settings.llm_model},
    }


@app.post("/v1/tasks", response_model=Task, status_code=202)
async def create_task(payload: TaskCreate) -> Task:
    if payload.employee_id not in {employee["employee_id"] for employee in list_employees()}:
        raise HTTPException(status_code=422, detail="unknown employee")
    task = Task(prompt=payload.prompt, workspace_id=payload.workspace_id, employee_id=payload.employee_id)
    store.save(task)
    store.add_event(task.task_id, "task.created", task.model_dump(mode="json"))
    if settings.task_queue_enabled:
        try:
            from .queue import publish_task
            await publish_task(settings, task.task_id)
        except Exception:
            asyncio.create_task(run_task(task.task_id))
    else:
        asyncio.create_task(run_task(task.task_id))
    return task


@app.get("/v1/tasks", response_model=list[Task])
async def list_tasks(workspace_id: str = "default", limit: int = 20) -> list[Task]:
    return store.list(workspace_id, limit)


@app.get("/v1/messages")
async def messages(workspace_id: str = "default") -> list[dict]:
    return store.messages(workspace_id)


@app.get("/v1/reports")
async def reports(workspace_id: str = "default") -> list[dict]:
    return store.reports(workspace_id)


@app.get("/v1/reports/{task_id}")
async def report(task_id: str, workspace_id: str = "default") -> dict:
    value = store.report(task_id, workspace_id)
    if value is None:
        raise HTTPException(status_code=404, detail="report not found")
    return value


async def run_task(task_id: str) -> None:
    if task_id in active_tasks:
        return
    task = store.get(task_id)
    if task is None or task.status in ("SUCCESS", "FAILED", "CANCELLED", "PENDING_CONFIRMATION"):
        return
    if not store.claim(task_id):
        return
    active_tasks.add(task_id)
    lease_lost = asyncio.Event()

    async def renew_lease():
        while True:
            await asyncio.sleep(20)
            try:
                if not await asyncio.to_thread(store.heartbeat, task_id):
                    lease_lost.set()
                    return
            except Exception:
                lease_lost.set()
                return

    heartbeat = asyncio.create_task(renew_lease()) if isinstance(store, RemoteTaskStore) else None
    try:
        task.status = "RUNNING"
        task.updated_at = utc_now()
        store.add_event(task.task_id, "task.started", {"status": task.status})
        result = None
        execution_runtime = None
        model_info = {}
        for attempt in range(settings.max_task_retries + 1):
            task.result = None
            store.add_event(task.task_id, "task.attempt.started", {"attempt": attempt + 1})
            try:
                if execution_runtime is None:
                    configuration = await asyncio.to_thread(store.model_settings, task_id) if isinstance(store, RemoteTaskStore) else {}
                    effective = settings.model_copy(update={
                        "llm_base_url": configuration["base_url"], "llm_api_key": configuration["api_key"],
                        "llm_model": configuration["model"], "llm_temperature": configuration["temperature"],
                        "llm_max_tokens": configuration["max_tokens"],
                    }) if configuration else settings
                    execution_runtime = WorkspaceRuntime(effective, settings) if configuration else runtime
                    model_info = {"name": effective.llm_model, "source": "workspace" if configuration else "environment", "revision": configuration.get("revision")}
                    store.add_event(task.task_id, "model.selected", model_info)
                def on_event(event, payload):
                    if event == "plan.created":
                        store.update_plan(task.task_id, payload["plan"])
                    store.add_event(task.task_id, event, payload)

                def is_cancelled():
                    if lease_lost.is_set():
                        return True
                    current = store.get(task_id)
                    return current is not None and current.status == "CANCELLED"

                result = await asyncio.wait_for(execution_runtime.execute(task, on_event, is_cancelled), timeout=settings.max_task_seconds)
            except asyncio.CancelledError:
                if lease_lost.is_set():
                    return
                current = store.get(task_id)
                if current and current.status == "CANCELLED":
                    return
                raise
            except asyncio.TimeoutError:
                result = task.result or TaskResult(task_id=task.task_id, agent="runtime", status="FAILED", error=f"task timeout after {settings.max_task_seconds}s")
            except Exception as exc:  # defensive boundary for background tasks
                result = TaskResult(task_id=task.task_id, agent="runtime", status="FAILED", error=f"AI 执行失败（{type(exc).__name__}），请检查模型服务配置后重试。")
            if result.status != "FAILED" or attempt >= settings.max_task_retries:
                break
            store.add_event(task.task_id, "task.retry.scheduled", {"attempt": attempt + 1, "next_attempt": attempt + 2, "error": result.error})
        current = store.get(task_id)
        if current and current.status == "CANCELLED":
            store.add_event(task.task_id, "task.finished_after_cancel", result.model_dump(mode="json"))
            return
        result.data["model"] = model_info
        task.result = result
        task.status = result.status
        task.updated_at = utc_now()
        if not store.save(task):
            return
        event_type = "task.completed" if result.status == "SUCCESS" else ("task.approval.required" if result.status == "PENDING_CONFIRMATION" else "task.failed")
        store.add_event(task.task_id, event_type, result.model_dump(mode="json"))
    finally:
        if heartbeat:
            heartbeat.cancel()
        if isinstance(store, RemoteTaskStore):
            store.release(task_id)
        active_tasks.discard(task_id)


@app.get("/v1/tasks/{task_id}", response_model=Task)
async def get_task(task_id: str) -> Task:
    task = store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@app.get("/v1/tasks/{task_id}/events")
async def get_events(task_id: str) -> list[dict]:
    if store.get(task_id) is None:
        raise HTTPException(status_code=404, detail="task not found")
    return store.events(task_id)


@app.get("/v1/tasks/{task_id}/export", response_class=PlainTextResponse)
async def export_task(task_id: str) -> PlainTextResponse:
    """Export the structured task result as a portable Markdown artifact."""
    task = store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    if task.result is None:
        raise HTTPException(status_code=409, detail="task has no result yet")
    data = task.result.data or {}
    lines = [f"# {task.prompt}", "", f"- 任务 ID：`{task.task_id}`", f"- 状态：`{task.status}`", ""]
    output = data.get("output") if isinstance(data, dict) else None
    if output:
        lines.extend(["## 结果", "", output if isinstance(output, str) else json.dumps(output, ensure_ascii=False, indent=2), ""])
    if data.get("node_results"):
        lines.extend(["## 节点结果", ""])
        for node in data["node_results"]:
            lines.extend([f"### {node.get('node_id', 'node')}", "", json.dumps(node.get("output", node), ensure_ascii=False, indent=2), ""])
    citations = cited_sources(str(output or ""), task.result.citations)
    if citations:
        lines.extend(["## 引用来源", ""])
        for citation in citations:
            lines.extend([f"- **{citation.get('title') or citation.get('documentId') or '知识片段'}**：{citation.get('content', '')}"])
    if task.result.error:
        lines.extend(["## 错误", "", task.result.error, ""])
    content = "\n".join(lines).strip() + "\n"
    return PlainTextResponse(content=content, media_type="text/markdown", headers={"Content-Disposition": f'attachment; filename="{task.task_id}.md"'})


@app.get("/v1/tasks/{task_id}/stream")
async def stream_events(task_id: str) -> StreamingResponse:
    if store.get(task_id) is None:
        raise HTTPException(status_code=404, detail="task not found")

    async def generator():
        sent = 0
        for _ in range(60):
            events = store.events(task_id)
            for event in events[sent:]:
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            sent = len(events)
            task = store.get(task_id)
            if task and task.status in ("SUCCESS", "FAILED", "CANCELLED", "PENDING_CONFIRMATION") and sent:
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(generator(), media_type="text/event-stream")


@app.post("/v1/tasks/{task_id}/cancel", response_model=Task)
async def cancel_task(task_id: str) -> Task:
    task = store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    if task.status in ("SUCCESS", "FAILED", "CANCELLED"):
        return task
    task.status = "CANCELLED"
    task.updated_at = utc_now()
    if not store.save(task):
        return store.get(task_id)
    store.add_event(task.task_id, "task.cancelled", {"status": task.status})
    return task


@app.post("/v1/tasks/{task_id}/confirm", response_model=Task)
async def confirm_task(task_id: str) -> Task:
    task = store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    if task.status != "PENDING_CONFIRMATION":
        raise HTTPException(status_code=409, detail="task is not awaiting confirmation")
    if not task.result or task.result.next_action != "REVIEW_DELIVERABLE":
        raise HTTPException(status_code=409, detail="尚未接入外部执行连接器；不能确认或声称已执行发送、删除等操作。")
    task.status = "SUCCESS"
    if task.result:
        task.result.status = "SUCCESS"
        task.result.next_action = "READ_REPORT"
    task.updated_at = utc_now()
    if not store.save(task):
        raise HTTPException(status_code=409, detail="任务状态已变化，请刷新后重试")
    store.add_event(task.task_id, "task.confirmed", {"status": task.status, "next_action": "READ_REPORT"})
    return task


@app.post("/v1/knowledge/documents")
async def index_document(payload: dict) -> dict:
    required = ("workspace_id", "document_id", "title", "content")
    if any(not payload.get(key) for key in required):
        raise HTTPException(status_code=422, detail=f"required fields: {', '.join(required)}")
    try:
        return _without_embeddings(await knowledge.index_document(payload["workspace_id"], payload["document_id"], payload["title"], payload["content"], payload.get("metadata")))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"elasticsearch unavailable: {exc}") from exc


@app.get("/v1/knowledge/search")
async def search_knowledge(workspace_id: str, q: str, limit: int = 5) -> list[dict]:
    try:
        return await knowledge.search(workspace_id, q, min(max(limit, 1), 20))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"elasticsearch unavailable: {exc}") from exc


@app.get("/", include_in_schema=False)
async def web_app() -> FileResponse:
    return FileResponse(Path(__file__).parent / "static" / "index.html")
