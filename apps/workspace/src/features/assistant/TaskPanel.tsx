import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  ChevronRight,
  FileText,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useResource } from "../../api";
import { Workflow } from "../../workflow";
import { buildWorkflow, stateNames, employeeNames } from "../../workflow-model";
import type { Event, Task } from "../../types";
import { Button } from "../../components/ui/button";
import { taskStatus, type OutputDraft } from "./contracts";
export const text = (value: unknown) =>
  typeof value === "string" ? value : "";
export function Markdown({ value }: { value: unknown }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text(value)}</ReactMarkdown>
    </div>
  );
}

export function Progress({ task }: { task: Task }) {
  const events = useResource<Event[]>(
    `/v1/tasks/${task.task_id}/events`,
    ["RUNNING", "PENDING"].includes(task.status) ? 3000 : 0,
  );
  const graph = buildWorkflow(task, events.data || []);
  const chapterNodes = graph.nodes.filter((n) => n.stepId?.startsWith("chapter-"));
  const reviewIds = graph.nodes.filter((n) => n.id.startsWith("revision:") ||
    ["sys:review", "sys:revision", "sys:recheck", "sys:assembly", "sys:human", "sys:archive"].includes(n.id)).map((n) => n.id);
  const phases = chapterNodes.length ? [
    { name: "统一事实、术语与约束", ids: ["worker:document-memory"] },
    ...chapterNodes.map((n) => ({ name: n.objective, ids: [n.id] })),
    { name: "一致性审核与交付", ids: reviewIds },
  ] : [
    { name: "理解需求与任务规划", ids: ["sys:planner"] },
    { name: "资料检索与准备", ids: ["sys:knowledge"] },
    {
      name: "内容生成与整理",
      ids: graph.nodes
        .filter((n) => n.id.startsWith("worker:"))
        .map((n) => n.id),
    },
    { name: "检查与交付", ids: reviewIds },
  ];
  return (
    <div className="gui-progress">
      {phases.map((p) => {
        const nodes = graph.nodes.filter((n) => p.ids.includes(n.id));
        const done =
          nodes.length > 0 &&
          nodes.every((n) => ["done", "skipped"].includes(n.status));
        const running = nodes.some((n) => n.status === "running");
        return (
          <div
            key={p.name}
            className={done ? "done" : running ? "running" : ""}
          >
            {done ? (
              <Check size={14} />
            ) : running ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <span className="gui-progress-dot" />
            )}
            <span>{p.name}</span>
            <small>
              {done
                ? "已完成"
                : running
                  ? "进行中"
                  : ["FAILED", "CANCELLED"].includes(task.status)
                    ? "未完成"
                    : "等待中"}
            </small>
          </div>
        );
      })}
      {events.error && <small role="alert">执行记录暂时不可用</small>}
    </div>
  );
}
export function TaskPanel({
  tab,
  setTab,
  onClose,
  task,
  draft,
  pending,
  title,
}: {
  tab: "details" | "execution" | "artifact";
  setTab: (v: "details" | "execution" | "artifact") => void;
  onClose: () => void;
  task?: Task;
  draft?: OutputDraft;
  pending: boolean;
  title: string;
}) {
  const panel = useRef<HTMLElement>(null);
  const panelId = useId();
  const [overlay, setOverlay] = useState(() => window.matchMedia("(max-width: 980px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 980px)");
    const update = () => setOverlay(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab" && window.matchMedia("(max-width: 980px)").matches) {
        const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled):not([tabindex="-1"]), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary',
        ) || []).filter((element) => element.getClientRects().length > 0);
        const first = elements[0];
        const last = elements.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <aside
      className="gui-task-panel"
      role={overlay ? "dialog" : "complementary"}
      aria-modal={overlay || undefined}
      aria-label="任务侧面板"
      tabIndex={-1}
      ref={panel}
    >
      <header>
        <div role="tablist" aria-label="任务详情标签">
          {(
            [
              ["details", "任务详情"],
              ["execution", "执行过程"],
              ["artifact", "产出结果"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              id={`${panelId}-${id}`}
              aria-controls={`${panelId}-content`}
              tabIndex={tab === id ? 0 : -1}
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              onKeyDown={(e) => {
                const tabs = ["details", "execution", "artifact"] as const;
                const index = tabs.indexOf(id);
                const next = e.key === "ArrowRight" ? (index + 1) % 3
                  : e.key === "ArrowLeft" ? (index + 2) % 3
                    : e.key === "Home" ? 0 : e.key === "End" ? 2 : -1;
                if (next < 0) return;
                e.preventDefault();
                setTab(tabs[next]);
                document.getElementById(`${panelId}-${tabs[next]}`)?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button aria-label="关闭任务面板" onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <div className="gui-panel-content" role="tabpanel" id={`${panelId}-content`} aria-labelledby={`${panelId}-${tab}`} tabIndex={0}>
        {tab === "details" ? (
          <>
            <section className="gui-detail-card">
              <div className="gui-detail-heading">
                <h2>{pending ? draft?.title : title}</h2>
                <span className="gui-chip">
                  {pending
                    ? "待批准"
                    : task
                      ? taskStatus[task.status]
                      : "待开始"}
                </span>
              </div>
              {task && !pending && (
                <small>
                  创建于 {new Date(task.created_at).toLocaleString("zh-CN")}
                </small>
              )}
            </section>
            <section className="gui-detail-card">
              <h3>任务目标</h3>
              <p>
                {pending
                  ? draft?.goal
                  : task?.prompt || "描述目标后，AI 将为你整理输出方案。"}
              </p>
            </section>
            {draft && (
              <section className="gui-detail-card">
                <h3>预计输出{pending ? "" : " · 最近批准方案"}</h3>
                <dl>
                  <div>
                    <dt>类型</dt>
                    <dd>{draft.output_type}</dd>
                  </div>
                  <div>
                    <dt>篇幅目标</dt>
                    <dd>{draft.length}</dd>
                  </div>
                  <div>
                    <dt>格式</dt>
                    <dd>{draft.format}</dd>
                  </div>
                </dl>
                <ol>
                  {draft.sections.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </section>
            )}
            {task && !pending && (
              <section className="gui-detail-card">
                <h3>协作分工</h3>
                {task.plan.length ? (
                  task.plan.map((p) => (
                    <div className="gui-agent-row" key={p.node_id}>
                      <span className="gui-mini-icon">
                        <Sparkles size={13} />
                      </span>
                      <div>
                        <strong>
                          {employeeNames[p.employee_id || ""] || "专业助手"}
                        </strong>
                        <small>{p.objective}</small>
                      </div>
                    </div>
                  ))
                ) : (
                  <p>任务开始后展示实际分工。</p>
                )}
              </section>
            )}
            <section className="gui-detail-card">
              <h3>资料与记忆</h3>
              <p>当前工作空间的知识文件与个人确认的记忆，可作为上下文使用。</p>
              <Link to="/knowledge">
                管理知识文件
                <ChevronRight size={13} />
              </Link>
              <Link to="/memory">
                管理个人记忆
                <ChevronRight size={13} />
              </Link>
            </section>
          </>
        ) : tab === "execution" ? (
          task && !pending ? (
            <ExecutionDetail task={task} />
          ) : (
            <div className="gui-blank">
              <Sparkles size={26} />
              <p>确认预计输出后，这里将展示实时执行过程。</p>
            </div>
          )
        ) : !pending && task && !["PENDING", "RUNNING"].includes(task.status) && task.result?.data.output ? (
          <>
            <section className="gui-detail-card">
              <h3>{draft?.title || text(task.result.data.output).match(/^#\s+(.+)$/m)?.[1] || title}.md</h3>
              <p>
                {Array.from(
                  text(task.result.data.output),
                ).length.toLocaleString()}{" "}
                字符 · Markdown
              </p>
              <a
                className="gui-download"
                href={`/v1/tasks/${task.task_id}/export`}
              >
                <ArrowDownToLine size={16} />
                下载成果
              </a>
            </section>
            {task.result.data.document ? (
              <>
                <section className="gui-detail-card">
                  <h3>{task.result.data.document.complete ? "章节目录" : "未完成草稿"} · {task.result.data.document.chapters.length}/{task.result.data.document.total}</h3>
                  <p>{task.result.data.review?.feedback}</p>
                </section>
                {task.result.data.document.chapters.map((chapter, index) => (
                  <details className="gui-chapter" key={chapter.chapter_id} open={index === 0}>
                    <summary>{chapter.title}</summary>
                    <Markdown value={chapter.content} />
                  </details>
                ))}
                <details className="gui-detail-card">
                  <summary>共享文档记忆 · 事实与约束</summary>
                  {Object.entries(task.result.data.document.brief).map(([key, values]) => (
                    <div key={key}><h3>{{ facts: "已知事实", terminology: "统一术语", constraints: "约束", unknowns: "待确认事项" }[key] || key}</h3>
                      <ul>{values.map((value, index) => <li key={index}>{value}</li>)}</ul></div>
                  ))}
                </details>
              </>
            ) : <Markdown value={task.result.data.output} />}
            {task.result.citations.length > 0 && (
              <section className="gui-detail-card">
                <h3>引用来源</h3>
                {task.result.citations.map((c, i) => (
                  <details key={i}>
                    <summary>{c.title || c.documentId}</summary>
                    <p>{c.content}</p>
                  </details>
                ))}
              </section>
            )}
          </>
        ) : (
          <div className="gui-blank">
            <FileText size={28} />
            <p>交付成果将在这里显示。</p>
          </div>
        )}
      </div>
    </aside>
  );
}
function ExecutionDetail({ task }: { task: Task }) {
  const events = useResource<Event[]>(
    `/v1/tasks/${task.task_id}/events`,
    ["PENDING", "RUNNING"].includes(task.status) ? 2500 : 0,
  );
  const graph = buildWorkflow(task, events.data || []);
  const [expanded, setExpanded] = useState(false);
  const calls = graph.events.filter((event) => event.type === "document.call.completed");
  const metrics = !["PENDING", "RUNNING"].includes(task.status) ? task.result?.data.metrics : undefined;
  return (
    <>
      {(calls.length > 0 || metrics) && <section className="gui-detail-card">
        <h3>本轮执行统计</h3>
        <p>Agent 调用 {calls.length || metrics?.agent_calls || 0} 次 · 失败/中断 {calls.length ? calls.filter((e) => e.payload.status !== "SUCCESS").length : metrics?.failed_calls || 0} 次</p>
        <p>模型回报 Token：{metrics?.usage_reported_calls ? metrics.reported_tokens.toLocaleString() : "未回报或执行中"}</p>
        {metrics && <p>本轮耗时 {(metrics.elapsed_ms / 1000).toFixed(1)} 秒 · 复用 {metrics.reused_chapters} 章</p>}
        <small>Token 来自模型回报，未回报不计作零；未配置单价，不估算费用。统计不包含此前执行轮次。</small>
        {calls.length > 0 && <details><summary>各次调用耗时</summary>{calls.map((e, i) => <p key={i}>{text(e.payload.node_id)} · {(Number(e.payload.elapsed_ms) / 1000).toFixed(1)} 秒 · {text(e.payload.status)}</p>)}</details>}
      </section>}
      <section className="gui-detail-card">
        <h3>执行进度</h3>
        <div className="gui-execution-timeline">
          {graph.nodes.map((n) => (
            <details key={n.id}>
              <summary>
                <span className={`gui-node-state ${n.status}`}>
                  {n.status === "done" ? (
                    <Check size={12} />
                  ) : n.status === "running" ? (
                    <LoaderCircle size={12} className="spin" />
                  ) : (
                    <span />
                  )}
                </span>
                <span>{n.title}</span>
                <small>{stateNames[n.status]}</small>
              </summary>
              <p>{n.objective}</p>
              {n.note && <p>{n.note}</p>}
              {n.output !== undefined && (
                <Markdown
                  value={
                    typeof n.output === "string"
                      ? n.output
                      : "```json\n" +
                        JSON.stringify(n.output, null, 2) +
                        "\n```"
                  }
                />
              )}
            </details>
          ))}
        </div>
      </section>
      <Button variant="outline" onClick={() => setExpanded(!expanded)}>
        {expanded ? "收起协作流程图" : "展开协作流程图"}
      </Button>
      {expanded && (
        <Workflow
          task={task}
          events={events.data || []}
          loading={events.loading}
          error={events.error}
        />
      )}
    </>
  );
}
