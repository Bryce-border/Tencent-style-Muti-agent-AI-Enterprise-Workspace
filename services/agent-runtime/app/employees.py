from __future__ import annotations

from typing import Any


# These are product-level employee profiles. Runtime agent implementations may
# evolve independently while the workspace keeps a stable user-facing catalog.
EMPLOYEES: tuple[dict[str, Any], ...] = (
    {
        "employee_id": "ai_assistant",
        "name": "AI 管家",
        "title": "全能工作助手",
        "description": "理解业务目标，拆解任务并协调其他 AI 员工完成工作。",
        "capabilities": ["任务规划", "多智能体协作", "结果汇总"],
        "agent_type": "supervisor_agent",
        "status": "available",
    },
    {
        "employee_id": "data_analyst",
        "name": "数据分析师",
        "title": "数据洞察与分析",
        "description": "分析业务数据，提炼关键指标、趋势和管理层结论。",
        "capabilities": ["指标分析", "趋势识别", "管理层报告"],
        "agent_type": "data_agent",
        "status": "available",
    },
    {
        "employee_id": "document_expert",
        "name": "文档专家",
        "title": "内容整理与写作",
        "description": "将资料和知识库内容整理为结构清晰、可交付的文档。",
        "capabilities": ["周报生成", "文档改写", "结构化输出"],
        "agent_type": "writer_agent",
        "status": "available",
    },
    {
        "employee_id": "meeting_secretary",
        "name": "会议秘书",
        "title": "会议纪要与跟进",
        "description": "提炼会议决定、行动项和负责人，帮助团队持续跟进。",
        "capabilities": ["会议总结", "行动项提取", "任务创建"],
        "agent_type": "meeting_agent",
        "status": "planned",
    },
    {
        "employee_id": "hr_assistant",
        "name": "HR 助手",
        "title": "人力资源服务",
        "description": "基于企业制度和员工信息，提供可追溯的人力资源问答。",
        "capabilities": ["制度问答", "员工服务", "知识检索"],
        "agent_type": "hr_agent",
        "status": "planned",
    },
    {
        "employee_id": "crm_assistant",
        "name": "CRM 助手",
        "title": "客户关系与销售支持",
        "description": "整理客户信息和销售进展，辅助跟进与机会分析。",
        "capabilities": ["客户摘要", "商机分析", "跟进建议"],
        "agent_type": "crm_agent",
        "status": "planned",
    },
    {
        "employee_id": "knowledge_expert",
        "name": "企业知识专家",
        "title": "企业知识检索",
        "description": "在权限范围内检索企业资料，并返回带来源的答案依据。",
        "capabilities": ["向量检索", "全文检索", "来源引用"],
        "agent_type": "knowledge_agent",
        "status": "available",
    },
    {
        "employee_id": "product_designer",
        "name": "产品设计师",
        "title": "需求与方案设计",
        "description": "把业务想法整理为需求、流程和可执行的产品方案。",
        "capabilities": ["需求拆解", "流程设计", "方案评审"],
        "agent_type": "product_agent",
        "status": "planned",
    },
    {
        "employee_id": "ai_engineer",
        "name": "AI 开发工程师",
        "title": "自动化与技术实现",
        "description": "协助设计自动化流程、工具调用和技术实现方案。",
        "capabilities": ["技术方案", "工具编排", "自动化设计"],
        "agent_type": "engineering_agent",
        "status": "planned",
    },
)


def list_employees() -> list[dict[str, Any]]:
    return [dict(employee) for employee in EMPLOYEES]
