from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4
from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TaskCreate(BaseModel):
    prompt: str = Field(min_length=3, max_length=4000)
    workspace_id: str = Field(default="default", min_length=1, max_length=128)
    employee_id: str = Field(default="ai_assistant", min_length=1, max_length=64)


class TaskResult(BaseModel):
    task_id: str
    agent: str
    status: Literal["SUCCESS", "FAILED", "PENDING_CONFIRMATION"]
    data: dict[str, Any] = Field(default_factory=dict)
    citations: list[dict[str, Any]] = Field(default_factory=list)
    confidence: float = 0.0
    next_action: str | None = None
    error: str | None = None


class Task(BaseModel):
    task_id: str = Field(default_factory=lambda: f"T-{uuid4().hex[:12]}")
    workspace_id: str
    prompt: str
    employee_id: str = "ai_assistant"
    status: Literal["PENDING", "RUNNING", "SUCCESS", "FAILED", "CANCELLED", "PENDING_CONFIRMATION"] = "PENDING"
    plan: list[dict[str, Any]] = Field(default_factory=list)
    result: TaskResult | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
