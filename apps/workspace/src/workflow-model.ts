import type { Event, Step, Task } from "./types";

export type NodeStatus = "waiting" | "running" | "done" | "warning" | "failed" | "cancelled" | "skipped" | "unknown";
export const stateNames: Record<NodeStatus, string> = { waiting: "等待执行", running: "执行中", done: "已完成", warning: "需要关注", failed: "执行失败", cancelled: "已中断", skipped: "已跳过", unknown: "未记录" };
export const employeeNames: Record<string, string> = {
  ai_assistant: "AI 管家", data_analyst: "数据分析师", document_expert: "文档专家", meeting_secretary: "会议秘书",
  hr_assistant: "HR 助手", crm_assistant: "CRM 助手", knowledge_expert: "企业知识专家", product_designer: "产品设计师", ai_engineer: "AI 开发工程师",
};
export const eventNames: Record<string, string> = {
  "document.planned": "文档共享事实与目录就绪", "document.checkpoint": "章节进度已保存", "document.call.completed": "文档模型调用完成",
  "document.chapter.revision.started": "开始定向修订章节", "document.chapter.revision.completed": "章节修订完成", "document.assembled": "文档按目录组装完成", "task.retry.requested": "用户请求章节续作",
  "memory.loaded": "个人记忆与会话上下文已加载",
  "task.created": "接收工作目标", "task.started": "工作开始执行", "task.attempt.started": "开始本轮执行", "task.retry.scheduled": "准备重试", "model.selected": "已选定执行模型",
  "task.recovered": "执行租约失效，重新排队", "task.completed": "工作已完成", "task.failed": "工作执行失败", "task.cancelled": "用户取消工作", "task.confirmed": "人工接受交付",
  "planner.started": "AI 管家开始规划", "planner.fallback": "切换为预置协作计划", "plan.created": "协作计划就绪",
  "knowledge.started": "开始检索企业知识", "knowledge.retrieved": "知识检索完成", "knowledge.skipped": "仅使用用户资料，跳过检索", "knowledge.unavailable": "知识检索不可用",
  "agent.node.started": "员工开始执行", "agent.node.completed": "员工交付成果", "agent.node.failed": "员工执行失败",
  "review.started": "开始质量审核", "review.feedback": "初审要求修订", "revision.started": "文档专家开始修订", "revision.completed": "修订稿已交付",
  "review.completed": "质量审核结束", "review.unavailable": "审核流程未完成", "task.approval.required": "进入人工处理",
  "revision.deferred": "章节修订转人工处理",
};
export interface FlowNode {
  id: string; title: string; owner: string; objective: string; depends: string[]; status: NodeStatus;
  events: Event[]; output?: unknown; note?: string; stepId?: string; column: number; row: number;
}
export interface Attempt { start: number; end: number; label: string }
export function getAttempts(events: Event[]): Attempt[] {
  const starts = events.flatMap((event, index) => event.type === "task.attempt.started" ? [index] : []);
  if (!starts.length) return [{ start: 0, end: events.length, label: "执行记录" }];
  return starts.map((start, i) => ({ start, end: starts[i + 1] ?? events.length, label: `第 ${i + 1} 轮执行` }));
}
const text = (value: unknown) => typeof value === "string" ? value : "";
function planFrom(value: unknown): Step[] {
  if (!Array.isArray(value)) return [];
  return value.filter((s): s is Step => !!s && typeof s.node_id === "string" && Array.isArray(s.depends_on));
}

/** Project persisted events into a graph; never merge results from separate attempts. */
export function buildWorkflow(task: Task, allEvents: Event[], attemptIndex?: number) {
  const attempts = getAttempts(allEvents);
  const index = Math.min(Math.max(attemptIndex ?? attempts.length - 1, 0), attempts.length - 1);
  const attempt = attempts[index];
  const latest = index === attempts.length - 1;
  const events = allEvents.slice(attempt.start, attempt.end);
  const find = (type: string) => events.find(e => e.type === type);
  const last = (type: string) => events.filter(e => e.type === type).at(-1);
  const planned = last("plan.created");
  // A fresh retry must not show an old snapshot's plan or output while it is planning.
  const plan = planned ? planFrom(planned.payload.plan) : allEvents.some(e => e.type === "task.attempt.started") ? [] : task.plan;
  const result = latest && task.status !== "RUNNING" && task.status !== "PENDING" ? task.result : null;
  const closed = !latest || ["SUCCESS", "FAILED", "CANCELLED", "PENDING_CONFIRMATION"].includes(task.status) || !!find("task.recovered") || !!find("task.retry.scheduled");
  const cancelled = latest && task.status === "CANCELLED";
  const nodes: FlowNode[] = [];
  function add(id: string, title: string, owner: string, objective: string, depends: string[], matched: Event[], status: NodeStatus, extra: Partial<FlowNode> = {}) {
    if (closed && status === "running") status = "cancelled";
    const node: FlowNode = { id, title, owner, objective, depends, events: matched, status, column: 0, row: 0, ...extra };
    nodes.push(node); return node;
  }
  const category = (prefix: string) => events.filter(e => e.type.startsWith(prefix));
  add("sys:request", "接收工作目标", "工作空间", "记录用户目标、负责员工及工作空间，等待执行器领取。", [],
    allEvents.filter(e => e.type === "task.created"), "done", { output: task.prompt });
  add("sys:runtime", "任务执行器 · 领取任务与模型准备", "Worker / 模型服务", "领取执行租约，读取空间模型配置，开始本轮任务。", ["sys:request"],
    events.filter(e => ["task.started", "task.attempt.started", "model.selected"].includes(e.type)),
    find("model.selected") || planned || find("planner.started") ? "done" : find("task.attempt.started") || find("task.started") ? "running" : "waiting",
    { output: find("model.selected") ? { model: find("model.selected")?.payload.name, source: find("model.selected")?.payload.source, revision: find("model.selected")?.payload.revision } : undefined });
  if (find("memory.loaded")) add("sys:memory", "记忆管理 · 召回个人上下文", "Memory Manager", "按空间、用户、员工隔离召回会话历史与用户确认记忆；当前指令优先。", ["sys:runtime"], category("memory."), "done", { output: find("memory.loaded")?.payload });
  add("sys:planner", task.employee_id === "ai_assistant" ? "AI 管家 · 目标拆解与协作规划" : "任务调度 · 指定员工与依赖编排", "Supervisor / Planner",
    "选择专业员工、明确节点目标，校验依赖关系并形成协作计划。", [find("memory.loaded") ? "sys:memory" : "sys:runtime"], [...category("planner."), ...category("plan.")],
    planned || plan.length ? (find("planner.fallback") ? "warning" : "done") : find("planner.started") ? "running" : "waiting",
    { output: planned?.payload.plan, note: planned ? ({ approved_outline: "按用户批准目录逐章执行", supervisor: "由 AI 管家生成计划", employee: "按指定员工编排", fallback: "规划失败，采用预置流程" }[text(planned.payload.source)] ?? "协作计划已记录") : "计划就绪后自动展开员工节点。" });
  const knowledge = category("knowledge.");
  add("sys:knowledge", "企业知识库 · 检索与证据准备", "Elasticsearch / RAG", "检索当前空间的相关资料，供员工判断和引用；检索候选不自动视为结论依据。", ["sys:planner"], knowledge,
    find("knowledge.skipped") ? "skipped" : find("knowledge.unavailable") ? "warning" : find("knowledge.retrieved") ? "done" : find("knowledge.started") ? "running" : "waiting",
    { note: find("knowledge.retrieved") ? `命中 ${find("knowledge.retrieved")?.payload.count ?? 0} 个候选片段` : find("knowledge.skipped") ? "用户要求仅依据输入资料，未执行检索。" : undefined });
  for (const step of plan) {
    const matched = events.filter(e => (e.type.startsWith("agent.node.") || e.type === "document.call.completed") && e.payload.node_id === step.node_id);
    const end = matched.filter(e => e.type.startsWith("agent.node.")).at(-1);
    const saved = result?.data.node_results?.find(s => s.node_id === step.node_id);
    const owner = employeeNames[step.employee_id || step.agent || ""] || step.employee_id || step.agent || "历史员工";
    add(`worker:${step.node_id}`, step.node_id === "delivery" ? "文档专家 · 汇总最终交付" : `${owner} · ${step.objective || "执行专业任务"}`, owner,
      step.objective || "按本节点职责交付成果。", step.depends_on.length ? step.depends_on.map(id => `worker:${id}`) : ["sys:knowledge"], matched,
      end?.type === "agent.node.failed" ? "failed" : end?.type === "agent.node.completed" || saved ? "done" : end?.type === "agent.node.started" ? "running" : "waiting",
      { stepId: step.node_id, output: matched.filter(e => e.type === "agent.node.completed").at(-1)?.payload.output ?? saved?.output,
        note: end?.payload.reused ? "已核对当前任务、目录、上下文与模型，复用已保存章节。" : undefined });
  }
  const leaves = plan.filter(s => !plan.some(other => other.depends_on.includes(s.node_id))).map(s => `worker:${s.node_id}`);
  const feedback = find("review.feedback");
  const unavailable = find("review.unavailable");
  const reviewEnd = last("review.completed");
  const initial = events.filter(e => e.type === "review.feedback" || e.type === "review.started" && Number(e.payload.round || 1) === 1 ||
    !feedback && ["review.completed", "review.unavailable"].includes(e.type));
  add("sys:review", "AI 管家 · 初稿质量审核", "质量审核员", "核查目标、格式、事实来源和未执行操作，决定通过、修订或转人工。", leaves.length ? leaves : ["sys:knowledge"], initial,
    feedback ? "warning" : reviewEnd ? (reviewEnd.payload.decision === "PASS" ? "done" : "warning") : unavailable ? "warning" : find("review.started") ? "running" : "waiting",
    { output: feedback?.payload.feedback ?? (!feedback ? reviewEnd?.payload.feedback : undefined) });
  let afterReview = "sys:review";
  const deferred = find("revision.deferred");
  if (feedback && deferred) {
    add("sys:revision", "文档专家 · 定向修订转人工", "文档专家", text(feedback.payload.feedback), ["sys:review"], [deferred], "skipped", { note: text(deferred.payload.reason) });
    afterReview = "sys:revision";
  } else if (feedback) {
    const revisionEvents = events.filter(e => e.type.startsWith("revision.") || e.type === "review.unavailable" && e.payload.stage === "revision");
    const revised = find("revision.completed");
    const recheck = events.filter(e => e.type === "review.started" && Number(e.payload.round) === 2 || e.type === "review.completed" || e.type === "review.unavailable" && e.payload.stage === "recheck");
    const legacy = !revisionEvents.length && !recheck.some(e => e.type === "review.started");
    add("sys:revision", "文档专家 · 按审核意见修订", "文档专家", text(feedback.payload.feedback), ["sys:review"], revisionEvents,
      revised ? "done" : unavailable?.payload.stage === "revision" ? "failed" : find("revision.started") ? "running" : legacy ? "unknown" : "waiting",
      { output: revised?.payload.output, note: legacy ? "历史任务未记录独立修订事件，无法还原该节点的准确执行状态。" : undefined });
    const chapterRevisions = events.filter(e => e.type === "document.chapter.revision.started");
    let revisionParent = "sys:revision";
    for (const started of chapterRevisions) {
      const chapterId = text(started.payload.chapter_id);
      const matched = events.filter(e => e.type.startsWith("document.chapter.revision.") && e.payload.chapter_id === chapterId || e.type === "document.call.completed" && e.payload.node_id === chapterId + "-revision");
      const completed = matched.find(e => e.type === "document.chapter.revision.completed");
      const failed = matched.find(e => e.type === "document.call.completed" && e.payload.status === "FAILED");
      const id = `revision:${chapterId}`;
      add(id, `文档专家 · 修订 ${text(started.payload.title)}`, "文档专家", text(started.payload.feedback), [revisionParent], matched,
        completed ? "done" : failed ? "failed" : "running", { output: completed?.payload.output });
      revisionParent = id;
    }
    add("sys:recheck", "AI 管家 · 修订稿复核", "质量审核员", "复核修改是否解决初审问题，再决定归档或转人工。", [revisionParent], recheck,
      reviewEnd ? (reviewEnd.payload.decision === "PASS" ? "done" : "warning") : unavailable?.payload.stage === "recheck" ? "warning" : recheck.some(e => e.type === "review.started") ? "running" : legacy ? "unknown" : "waiting",
      { output: reviewEnd?.payload.feedback, note: legacy ? "旧版本未记录复核开始时间。" : undefined });
    afterReview = "sys:recheck";
  }
  const assembled = find("document.assembled");
  if (assembled) {
    add("sys:assembly", "文档交付 · 按批准目录组装全文", "文档组装器", "保留各章完整正文并按目录拼接，避免再次摘要压缩。", [afterReview], [assembled], "done", { output: assembled.payload });
    afterReview = "sys:assembly";
  }
  const humanEvents = events.filter(e => ["task.approval.required", "task.confirmed"].includes(e.type));
  const human = humanEvents.length > 0 || result?.next_action === "REVIEW_DELIVERABLE" || result?.next_action === "CONNECTOR_REQUIRED";
  if (human) {
    add("sys:human", result?.next_action === "CONNECTOR_REQUIRED" ? "人工处理 · 外部连接器未配置" : "人工审核 · 确认或取消交付", "工作空间成员", "人工检查交付内容，再通过页面接受交付或取消任务。", [afterReview], humanEvents,
      find("task.confirmed") ? "done" : cancelled ? "cancelled" : "warning", { output: result?.error || result?.data.review?.feedback });
    afterReview = "sys:human";
  }
  const completion = events.filter(e => ["task.completed", "task.confirmed", "task.failed", "task.cancelled", "task.recovered", "task.retry.scheduled"].includes(e.type));
  const archived = latest && task.status === "SUCCESS" && result?.data.mode === "crewai" && !!result.data.output;
  add("sys:archive", "工作空间 · 交付与报告归档", "任务与报告服务", "仅在审核通过或人工接受后归档真实成果；失败或取消不归档。", [afterReview], completion,
    archived ? "done" : cancelled || !latest || find("task.recovered") ? "cancelled" : latest && task.status === "FAILED" ? "failed" : "waiting",
    { output: archived ? result?.data.output : undefined, note: result?.error || (archived ? "成果已归档，可从报告入口查看。" : "等待合格交付，尚未归档。") });
  // Topological columns support plans returned out of order; guard malformed historical DAGs.
  const remaining = new Set(nodes.map(n => n.id));
  const placed = new Map<string, FlowNode>();
  for (let pass = 0; pass < nodes.length && remaining.size; pass++) {
    for (const node of nodes) {
      if (!remaining.has(node.id) || !node.depends.every(id => placed.has(id))) continue;
      node.column = node.depends.length ? Math.max(...node.depends.map(id => placed.get(id)!.column)) + 1 : 0;
      placed.set(node.id, node); remaining.delete(node.id);
    }
  }
  for (const node of nodes.filter(n => remaining.has(n.id))) { node.column = 3; node.note = "历史依赖记录不完整，无法可靠还原布局。"; }
  const columns = Math.max(...nodes.map(n => n.column)) + 1;
  const counts = Array.from({ length: columns }, (_, col) => nodes.filter(n => n.column === col).length);
  const rows = Math.max(...counts);
  for (let col = 0; col < columns; col++) nodes.filter(n => n.column === col).forEach((n, i) => { n.row = i + (rows - counts[col]) / 2; });
  nodes.sort((a, b) => a.column - b.column || a.row - b.row);
  return { nodes, attempts, index, latest, events, columns, rows };
}
