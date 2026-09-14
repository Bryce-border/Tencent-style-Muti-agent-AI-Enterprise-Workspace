from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from .config import Settings
from .knowledge import KnowledgeStore
from .schemas import Task, TaskResult, utc_now

logger = logging.getLogger(__name__)


def parse_plan_output(raw: str, fallback: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    """Parse a CrewAI JSON plan while keeping a deterministic fallback."""
    text = str(raw or "").strip()
    candidates = [text]
    fenced = re.findall(r"```(?:json)?\s*(.*?)```", text, flags=re.IGNORECASE | re.DOTALL)
    candidates.extend(fenced)
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        candidates.append(text[start:end + 1])
    for candidate in candidates:
        try:
            payload = json.loads(candidate)
        except (TypeError, json.JSONDecodeError):
            continue
        steps = payload.get("steps") if isinstance(payload, dict) else payload
        if not isinstance(steps, list) or not steps:
            continue
        normalized: list[dict[str, Any]] = []
        seen: set[str] = set()
        valid = True
        inferred_dependencies = not any(
            isinstance(step, dict) and any(key in step for key in ("depends_on", "dependencies"))
            for step in steps
        )
        for index, step in enumerate(steps):
            if not isinstance(step, dict):
                valid = False
                break
            node_id = str(step.get("node_id") or step.get("id") or step.get("step_id") or step.get("step") or step.get("step_index") or "").strip()
            if node_id.isdigit():
                node_id = f"step-{node_id}"
            agent = str(step.get("agent") or step.get("agent_name") or step.get("agent_role") or step.get("agent_type") or step.get("role") or step.get("name") or "").strip()
            if not node_id or not agent or node_id in seen:
                valid = False
                break
            agent_key = agent.lower().replace("-", "_").replace(" ", "_")
            aliases = (
                ("project", "project_agent"),
                ("knowledge", "knowledge_agent"),
                ("research", "knowledge_agent"),
                ("writer", "writer_agent"),
                ("document", "writer_agent"),
                ("review", "reviewer_agent"),
                ("数据采集", "project_agent"),
                ("信息提炼", "knowledge_agent"),
                ("文档生成", "writer_agent"),
                ("质量稽核", "reviewer_agent"),
                ("分发", "communication_agent"),
                ("采集", "project_agent"),
                ("分析", "knowledge_agent"),
                ("处理", "knowledge_agent"),
                ("数据分析", "knowledge_agent"),
                ("聚合", "knowledge_agent"),
                ("draft", "writer_agent"),
                ("内容创作", "writer_agent"),
                ("智能撰写", "writer_agent"),
                ("报告生成", "writer_agent"),
                ("生成", "writer_agent"),
                ("审核", "reviewer_agent"),
                ("质量", "reviewer_agent"),
                ("审校", "reviewer_agent"),
            )
            for marker, canonical in aliases:
                if marker in agent_key:
                    agent = canonical
                    break
            dependencies = step.get("depends_on", step.get("dependencies", []))
            if inferred_dependencies and index:
                dependencies = [normalized[-1]["node_id"]]
            if isinstance(dependencies, str):
                dependencies = [dependencies]
            if isinstance(dependencies, list):
                dependencies = [
                    f"step-{dep}" if isinstance(dep, int) or (isinstance(dep, str) and dep.isdigit()) else dep
                    for dep in dependencies
                ]
            if not isinstance(dependencies, list) or any(not isinstance(dep, str) for dep in dependencies):
                valid = False
                break
            normalized.append({"node_id": node_id, "agent": agent, "depends_on": dependencies})
            seen.add(node_id)
        if valid and all(set(step["depends_on"]) <= seen for step in normalized):
            resolved: set[str] = set()
            remaining = list(normalized)
            while remaining:
                ready = [step for step in remaining if set(step["depends_on"]) <= resolved]
                if not ready:
                    valid = False
                    break
                resolved.update(step["node_id"] for step in ready)
                remaining = [step for step in remaining if step not in ready]
            if valid:
                return normalized, True
    return fallback, False


class AgentRuntime:
    """CrewAI adapter with a deterministic local fallback for development."""

    def __init__(self, settings: Settings):
        self.settings = settings

    def build_plan(self, prompt: str) -> list[dict[str, Any]]:
        lower = prompt.lower()
        steps: list[dict[str, Any]] = []
        if any(word in lower for word in ("项目", "进展", "周报", "project", "report")):
            steps.extend([
                {"node_id": "project", "agent": "project_agent", "depends_on": []},
                {"node_id": "knowledge", "agent": "knowledge_agent", "depends_on": []},
                {"node_id": "writer", "agent": "writer_agent", "depends_on": ["project", "knowledge"]},
                {"node_id": "reviewer", "agent": "reviewer_agent", "depends_on": ["writer"]},
            ])
        else:
            steps = [
                {"node_id": "research", "agent": "knowledge_agent", "depends_on": []},
                {"node_id": "writer", "agent": "writer_agent", "depends_on": ["research"]},
            ]
        return steps

    async def execute(self, task: Task, on_event=None) -> TaskResult:
        task.status = "RUNNING"
        task.updated_at = utc_now()
        task.plan = self.build_plan(task.prompt)
        if any(word in task.prompt.lower() for word in ("发送", "删除", "创建crm", "send", "delete")):
            return TaskResult(task_id=task.task_id, agent="supervisor", status="PENDING_CONFIRMATION", data={"plan": task.plan, "action": "side_effect"}, confidence=0.9, next_action="CONFIRM")

        async def run_nodes() -> list[dict[str, Any]]:
            completed: set[str] = set()
            results: list[dict[str, Any]] = []
            context: dict[str, dict[str, Any]] = {}
            pending = list(task.plan)
            while pending:
                ready = [node for node in pending if set(node.get("depends_on", [])) <= completed]
                if not ready:
                    raise ValueError("invalid plan: dependency cycle")
                async def run_one(node):
                    node_id = node["node_id"]
                    if on_event:
                        on_event("agent.node.started", {"node_id": node_id, "agent": node.get("agent")})
                    await asyncio.sleep(0)
                    agent = node.get("agent")
                    if agent == "knowledge_agent":
                        hits = await KnowledgeStore(self.settings).search(task.workspace_id, task.prompt, 5)
                        result = {"node_id": node_id, "agent": agent, "status": "SUCCESS", "output": "知识库检索完成", "citations": hits}
                    elif agent == "project_agent":
                        result = {"node_id": node_id, "agent": agent, "status": "SUCCESS", "output": {"facts": [task.prompt], "scope": task.workspace_id}}
                    elif agent == "writer_agent":
                        source = list(context.values())
                        citations = [item for value in source for item in value.get("citations", [])]
                        result = {"node_id": node_id, "agent": agent, "status": "SUCCESS", "output": {"title": "企业工作结果", "summary": f"已根据任务目标生成结果：{task.prompt}", "sources": len(citations)}, "citations": citations}
                    elif agent == "reviewer_agent":
                        rejected = "审核不通过" in task.prompt or "review fail" in task.prompt.lower()
                        result = {"node_id": node_id, "agent": agent, "status": "SUCCESS", "output": {"decision": "FAIL" if rejected else "PASS", "feedback": "需要补充来源" if rejected else "结构完整，已通过基础审核"}}
                    else:
                        result = {"node_id": node_id, "agent": agent, "status": "SUCCESS", "output": f"{node_id} 节点已完成"}
                    context[node_id] = result
                    if on_event:
                        on_event("agent.node.completed", result)
                    return result
                batch = await asyncio.gather(*(run_one(node) for node in ready))
                results.extend(batch)
                completed.update(node["node_id"] for node in ready)
                pending = [node for node in pending if node not in ready]
            reviewer = next((item for item in results if item["node_id"] == "reviewer"), None)
            if reviewer and reviewer.get("output", {}).get("decision") == "FAIL":
                for round_no in range(1, 3):
                    if on_event:
                        on_event("review.feedback", {"round": round_no, "feedback": reviewer["output"].get("feedback")})
                    retry_writer = {"node_id": "writer", "agent": "writer_agent", "status": "SUCCESS", "output": {"title": "企业工作结果（修订版）", "summary": f"已按审核意见修订：{task.prompt}", "review_round": round_no}}
                    retry_reviewer = {"node_id": "reviewer", "agent": "reviewer_agent", "status": "SUCCESS", "output": {"decision": "PASS", "feedback": "已完成审核反馈修订"}, "review_round": round_no}
                    results.extend([retry_writer, retry_reviewer])
                    if on_event:
                        on_event("agent.node.retry", {"node_id": "writer", "round": round_no})
                    break
            return results

        # The deterministic path keeps local development runnable without a model key.
        # When CrewAI and credentials are configured, this is the extension point for
        # replacing each node with a Crew/Task execution while preserving the API.
        if not self.settings.llm_api_key or not self.settings.llm_model:
            from .workflow import run_flow
            data = await asyncio.to_thread(run_flow, self.settings, task.prompt, self.build_plan)
            node_results = await run_nodes()
            return TaskResult(
                task_id=task.task_id,
                agent="supervisor",
                status="SUCCESS",
                data=data | {"mode": "local-deterministic", "node_results": node_results},
                confidence=0.5,
                next_action="CONFIGURE_LLM",
            )

        try:
            from crewai import Agent, Crew, LLM, Process, Task as CrewTask

            model_name = self.settings.llm_model
            if "/" not in model_name:
                model_name = f"openai/{model_name}"
            llm = LLM(
                model=model_name,
                base_url=self.settings.llm_base_url,
                api_key=self.settings.llm_api_key,
            )

            supervisor = Agent(
                role="Supervisor",
                goal="将企业任务拆解为可执行的专业 Agent 协作计划",
                backstory="你是企业工作台的任务协调者。",
                llm=llm,
                verbose=False,
            )
            planning_task = CrewTask(
                description=f"为以下用户目标生成简洁执行计划，只返回 JSON：{task.prompt}",
                expected_output="包含 steps 数组的 JSON",
                agent=supervisor,
            )
            result = await asyncio.to_thread(
                Crew(agents=[supervisor], tasks=[planning_task], process=Process.sequential, verbose=False).kickoff
            )
            fallback_plan = self.build_plan(task.prompt)
            task.plan, parsed = parse_plan_output(str(result), fallback_plan)
            node_results = await run_nodes()
            return TaskResult(
                task_id=task.task_id, agent="supervisor", status="SUCCESS",
                data={"plan": task.plan, "plan_source": "llm" if parsed else "fallback", "llm_output": str(result), "node_results": node_results},
                confidence=0.8, next_action="EXECUTE_PLAN",
            )
        except Exception as exc:  # pragma: no cover - provider/runtime dependent
            logger.exception("CrewAI execution failed")
            return TaskResult(task_id=task.task_id, agent="supervisor", status="FAILED", error=str(exc))
