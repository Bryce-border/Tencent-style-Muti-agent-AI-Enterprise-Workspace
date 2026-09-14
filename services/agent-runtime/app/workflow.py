from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field
from crewai.flow.flow import Flow, listen, start

from .config import Settings


class WorkspaceState(BaseModel):
    prompt: str = ""
    plan: list[dict[str, Any]] = Field(default_factory=list)
    result: dict[str, Any] = Field(default_factory=dict)


class EnterpriseFlow(Flow[WorkspaceState]):
    """CrewAI Flow skeleton for the enterprise supervisor pipeline."""

    def __init__(self, settings: Settings, plan_builder):
        super().__init__()
        self.settings = settings
        self.plan_builder = plan_builder

    @start()
    def plan_task(self):
        self.state.plan = self.plan_builder(self.state.prompt)

    @listen(plan_task)
    def execute_workers(self):
        # Worker execution is represented as structured data at this boundary;
        # RabbitMQ workers can consume the same plan later.
        self.state.result = {
            "summary": f"已生成执行计划：{self.state.prompt}",
            "plan": self.state.plan,
            "mode": "crewai-flow",
        }
        return self.state.result


def run_flow(settings: Settings, prompt: str, plan_builder) -> dict[str, Any]:
    flow = EnterpriseFlow(settings, plan_builder)
    flow.kickoff(inputs={"prompt": prompt})
    return flow.state.result
