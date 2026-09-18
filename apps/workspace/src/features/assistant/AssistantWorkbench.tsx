import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, useResource } from "../../api";
import { useSession } from "../../auth";
import { Button } from "../../components/ui/button";
import { Workflow } from "../../workflow";
import type { Employee, Event, Task } from "../../types";
import "./workbench.css";

interface Conversation {
  id: string;
  title: string;
  employee_id: string;
}
interface Memory {
  id: string;
  kind: string;
  content: string;
  source_task_id?: string;
}
const status: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "执行中",
  SUCCESS: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
  PENDING_CONFIRMATION: "等待确认",
};
const md = (value: unknown) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]}>
    {typeof value === "string" ? value : ""}
  </ReactMarkdown>
);

export function AssistantWorkbench() {
  const [params, setParams] = useSearchParams();
  const sessions = useResource<Conversation[]>("/v1/conversations");
  const employees = useResource<Employee[]>("/v1/employees");
  const [employee, setEmployee] = useState(
    params.get("employee") || "ai_assistant",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const session = useSession();
  const id = params.get("conversation");
  async function create() {
    setBusy(true);
    setError("");
    try {
      const result = await api<Conversation>("/v1/conversations", {
        method: "POST",
        body: JSON.stringify({
          employee_id: employee,
          title: `${employees.data?.find((e) => e.employee_id === employee)?.name || "总智能体"} · ${new Date().toLocaleString("zh-CN")}`,
        }),
      });
      setParams({ conversation: result.id });
      sessions.reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="agent-workbench">
      <header className="page-heading">
        <div>
          <h1>AI 工作台</h1>
          <p>描述工作目标，查看协作过程，持续完善交付成果。</p>
        </div>
      </header>
      {(error || sessions.error || employees.error) && (
        <p className="error-box" role="alert">
          {error || sessions.error || employees.error}
        </p>
      )}
      <div className="conversation-bar">
        <select
          aria-label="历史会话"
          value={id || ""}
          onChange={(e) =>
            setParams(e.target.value ? { conversation: e.target.value } : {})
          }
        >
          <option value="">选择会话</option>
          {sessions.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <select
          aria-label="新会话负责员工"
          value={employee}
          onChange={(e) => setEmployee(e.target.value)}
        >
          {employees.data?.map((e) => (
            <option key={e.employee_id} value={e.employee_id}>
              {e.employee_id === "ai_assistant"
                ? "总智能体 · 自动规划"
                : e.name}
            </option>
          ))}
        </select>
        <Button onClick={create} disabled={busy || session.role === "VIEWER"}>
          新建会话
        </Button>
      </div>
      {id ? (
        <ConversationView key={id} id={id} />
      ) : (
        <div className="empty-state">
          <h2>从一个完整的工作目标开始</h2>
          <p>例如：分析销售趋势，并生成管理层汇报。默认由总智能体拆解任务。</p>
          <p>会话和记忆仅本人可见；企业知识仍由工作空间共享。</p>
          <Button onClick={create} disabled={busy || session.role === "VIEWER"}>
            开始工作
          </Button>
        </div>
      )}
    </section>
  );
}

function ConversationView({ id }: { id: string }) {
  const resource = useResource<{ conversation: Conversation; turns: Task[] }>(
    `/v1/conversations/${id}`,
    3000,
  );
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [selected, setSelected] = useState<string>();
  const session = useSession();
  const data = resource.data;
  const task =
    data?.turns.find((t) => t.task_id === selected) || data?.turns.at(-1);
  const pending = data?.turns.some((t) =>
    ["PENDING", "RUNNING", "PENDING_CONFIRMATION"].includes(t.status),
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || pending) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<Task>(`/v1/conversations/${id}/turns`, {
        method: "POST",
        headers: { "Idempotency-Key": requestKey },
        body: JSON.stringify({ prompt }),
      });
      setPrompt("");
      setRequestKey(crypto.randomUUID());
      setSelected(result.task_id);
      resource.reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  if (resource.error)
    return (
      <p className="error-box" role="alert">
        {resource.error}
        <Button onClick={resource.reload}>重试</Button>
      </p>
    );
  if (!data) return <p role="status">加载会话…</p>;
  return (
    <>
      <div className="workbench-columns">
        <section className="workbench-chat">
          <h2>工作会话</h2>
          <p className="muted">
            每次续问携带最近 6 轮成功结果及最多 8 条个人记忆。
          </p>
          <div className="conversation-turns">
            {data.turns.length === 0 && (
              <p>输入目标开始工作。后续可直接提出修改要求。</p>
            )}
            {data.turns.map((t) => (
              <article
                key={t.task_id}
                className={
                  task?.task_id === t.task_id ? "turn selected" : "turn"
                }
              >
                <button
                  className="turn-heading"
                  onClick={() => setSelected(t.task_id)}
                >
                  <strong>{t.prompt}</strong>
                  <span>{status[t.status]}</span>
                </button>
                <div className="markdown">{md(t.result?.data.output)}</div>
                {t.result?.error && <p role="alert">{t.result.error}</p>}
                <Link to={`/tasks/${t.task_id}`}>完整任务与人工确认 →</Link>
              </article>
            ))}
          </div>
          <form className="work-form" onSubmit={submit}>
            <label htmlFor="conversation-goal">工作目标／继续修改</label>
            <textarea
              id="conversation-goal"
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setRequestKey(crypto.randomUUID());
              }}
              rows={4}
              maxLength={4000}
              required
              disabled={busy}
              placeholder="继续上轮工作，或描述一个新目标…"
            />
            <Button
              disabled={
                busy || pending || !prompt.trim() || session.role === "VIEWER"
              }
            >
              {pending
                ? "等待当前工作完成或确认"
                : busy
                  ? "提交中…"
                  : "发送给智能体"}
            </Button>
          </form>
          {error && (
            <p className="error-box" role="alert">
              {error}
            </p>
          )}
        </section>
        <section className="workbench-execution">
          <h2>执行过程</h2>
          {task ? (
            <Execution task={task} />
          ) : (
            <p>工作开始后，这里展示可点击的执行节点。</p>
          )}
        </section>
        <aside className="workbench-artifacts">
          <h2>当前成果</h2>
          {task?.result?.data.output ? (
            <>
              <p>
                {status[task.status]} · {task.task_id}
              </p>
              <a href={`/v1/tasks/${task.task_id}/export`}>下载 Markdown</a>
              <div className="markdown artifact-preview">
                {md(task.result.data.output)}
              </div>
            </>
          ) : (
            <p>成果生成后会在这里展示。</p>
          )}
          <MemoryPanel
            employee={data.conversation.employee_id}
            source={task?.task_id}
          />
        </aside>
      </div>
    </>
  );
}

function Execution({ task }: { task: Task }) {
  const events = useResource<Event[]>(
    `/v1/tasks/${task.task_id}/events`,
    ["RUNNING", "PENDING"].includes(task.status) ? 2000 : 0,
  );
  return (
    <Workflow
      task={task}
      events={events.data || []}
      loading={events.loading}
      error={events.error}
    />
  );
}

function MemoryPanel({
  employee,
  source,
}: {
  employee: string;
  source?: string;
}) {
  const memory = useResource<Memory[]>(
    `/v1/memories?employee_id=${encodeURIComponent(employee)}`,
  );
  const [content, setContent] = useState("");
  const [kind, setKind] = useState("preference");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const viewer = useSession().role === "VIEWER";
  async function mutate(id?: string) {
    setBusy(true);
    setError("");
    try {
      await api(id ? `/v1/memories/${id}` : "/v1/memories", {
        method: id ? "DELETE" : "POST",
        ...(!id
          ? {
              body: JSON.stringify({
                employee_id: employee,
                kind,
                content,
                source_task_id: source,
              }),
            }
          : {}),
      });
      if (!id) setContent("");
      memory.reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="memory-panel">
      <h2>个人记忆</h2>
      <p>
        仅用于当前员工。由你确认保存；删除后，后续执行不再召回。已生成成果会保留。
      </p>
      {(error || memory.error) && <p role="alert">{error || memory.error}</p>}
      {memory.data?.map((m) => (
        <article key={m.id}>
          <span className="small-badge">
            {{ preference: "偏好", fact: "事实", decision: "决策" }[m.kind]}
          </span>
          <p>{m.content}</p>
          {m.source_task_id && (
            <Link to={`/tasks/${m.source_task_id}`}>来源任务</Link>
          )}
          <Button
            variant="ghost"
            disabled={busy || viewer}
            onClick={() => mutate(m.id)}
          >
            忘记
          </Button>
        </article>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void mutate();
        }}
      >
        <label htmlFor="memory-kind">记忆类型</label>
        <select
          id="memory-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="preference">输出偏好</option>
          <option value="fact">用户确认的事实</option>
          <option value="decision">已确认决策</option>
        </select>
        <label htmlFor="memory-content">希望长期保留的内容</label>
        <textarea
          id="memory-content"
          maxLength={1000}
          rows={3}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="例如：管理层汇报先给结论，再附数据依据。"
        />
        <Button disabled={busy || viewer || !content.trim()}>保存记忆</Button>
      </form>
    </section>
  );
}
