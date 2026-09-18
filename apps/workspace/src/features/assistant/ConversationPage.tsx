import { useEffect, useRef, useState, type FormEvent } from "react";
import { applicationIcon } from "../../branding";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  FileText,
  LoaderCircle,
  PanelRight,
  Paperclip,
  Pencil,
  Plus,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { api, useResource } from "../../api";
import { useSession } from "../../auth";
import { Button } from "../../components/ui/button";
import type { Task } from "../../types";
import {
  conversationsChanged,
  taskStatus,
  type Conversation,
  type OutputDraft,
} from "./contracts";
import { PreviewCard, PreviewEditor } from "./OutputPreview";
import { Markdown, Progress, TaskPanel, text } from "./TaskPanel";

const templates = [
  {
    title: "项目方案",
    goal: "帮我设计一个项目开发方案，包含目标、产品需求、技术架构和验收标准。项目背景：",
  },
  {
    title: "需求文档",
    goal: "帮我撰写一份需求文档，明确用户、功能范围和验收标准。需求背景：",
  },
  {
    title: "数据分析",
    goal: "请基于我提供的数据，分析趋势、异常和下一步建议。数据与口径：",
  },
  {
    title: "会议纪要",
    goal: "请整理会议纪要，提取决策、负责人和行动项。会议记录：",
  },
];

export function AssistantWorkbench() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const id = params.get("conversation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [goal, setGoal] = useState("");
  const readonly = useSession().role === "VIEWER";
  async function start(e: FormEvent) {
    e.preventDefault();
    if (!goal.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const c = await api<Conversation>("/v1/conversations", {
        method: "POST",
        body: JSON.stringify({ title: "新会话", employee_id: "ai_assistant" }),
      });
      conversationsChanged();
      navigate(`/?conversation=${c.id}`, { state: { initialGoal: goal } });
      setGoal("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  if (id) return <ConversationView key={id} id={id} />;
  return (
    <section className="gui-conversation gui-welcome">
      <header className="gui-conversation-header">
        <span>新会话</span>
        <span className="gui-subtle-label">先规划，再执行</span>
      </header>
      <div className="gui-welcome-body">
        <div className="gui-hero-icon">
          <img src={applicationIcon} alt="" />
        </div>
        <span className="gui-eyebrow">YOUR AI WORKSPACE</span>
        <h1>今天想完成什么？</h1>
        <p>描述你的目标，剩下的交给 AI。</p>
        <Composer
          value={goal}
          onChange={setGoal}
          onSubmit={start}
          busy={busy}
          disabled={readonly}
          welcome
        />
        <div className="gui-suggestions">
          {templates.map((t) => (
            <button key={t.title} onClick={() => setGoal(t.goal)}>
              <FileText size={15} />
              {t.title}
              <ChevronRight size={13} />
            </button>
          ))}
        </div>
        {error && (
          <p className="gui-error" role="alert">
            {error}
          </p>
        )}
        <small>AI 会先整理预计输出，确认后再开始工作。</small>
      </div>
      <footer className="gui-welcome-footer">让复杂的工作，变得简单。</footer>
    </section>
  );
}

function Composer({
  value,
  onChange,
  onSubmit,
  busy,
  disabled,
  welcome,
  pending,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  busy: boolean;
  disabled: boolean;
  welcome?: boolean;
  pending?: boolean;
}) {
  const [templatesOpen, setTemplatesOpen] = useState(false);
  return (
    <form
      className={`gui-composer ${welcome ? "large" : ""}`}
      onSubmit={onSubmit}
    >
      <textarea
        aria-label="工作目标与补充要求"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={pending ? 1000 : 4000}
        required
        disabled={disabled || busy}
        rows={welcome ? 4 : 3}
        placeholder={
          pending
            ? "输入修改要求，调整预计输出…"
            : "输入你的目标，或继续修改输出要求…"
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (!disabled && !busy && value.trim())
              e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="gui-composer-tools">
        <Link
          to="/knowledge"
          title="上传并管理知识文件"
          aria-label="上传并管理知识文件"
        >
          <Paperclip size={17} />
        </Link>
        <div className="gui-template-control">
          <button
            type="button"
            aria-expanded={templatesOpen}
            disabled={disabled || busy}
            onClick={() => setTemplatesOpen(!templatesOpen)}
          >
            <Plus size={14} />
            使用模板
          </button>
          {templatesOpen && (
            <div className="gui-template-menu">
              {templates.map((t) => (
                <button
                  key={t.title}
                  type="button"
                  onClick={() => {
                    onChange(t.goal);
                    setTemplatesOpen(false);
                  }}
                >
                  {t.title}
                </button>
              ))}
            </div>
          )}
        </div>
        <span>{busy ? "正在理解目标…" : "Ctrl + Enter 发送"}</span>
        <button
          className="gui-send"
          type="submit"
          aria-label={pending ? "修改预计输出" : "发送目标"}
          disabled={disabled || busy || !value.trim()}
        >
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <ArrowUp size={19} />
          )}
        </button>
      </div>
    </form>
  );
}

function ConversationView({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const initialGoal =
    (location.state as { initialGoal?: string } | null)?.initialGoal || "";
  const resource = useResource<{ conversation: Conversation; turns: Task[] }>(
    `/v1/conversations/${id}`,
    4000,
  );
  const [value, setValue] = useState(initialGoal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<
    "details" | "execution" | "artifact" | null
  >(null);
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  const started = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const readonly = useSession().role === "VIEWER";
  const c = resource.data?.conversation;
  const turns = resource.data?.turns || [];
  const task = turns.find((t) => t.task_id === selected) || turns.at(-1);
  const activeTask = turns.find((t) =>
    ["PENDING", "RUNNING", "PENDING_CONFIRMATION"].includes(t.status),
  );
  let draft: OutputDraft | undefined;
  try {
    if (c?.output_draft) draft = JSON.parse(c.output_draft);
  } catch {
    /* Invalid historical JSON does not break the page. */
  }
  const pending = !!draft && !c?.approved_task_id;
  const showingDraft = pending && !selected;
  const archived = !!c?.archived;
  async function generate(goal: string, changes = "") {
    if (!c || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/v1/conversations/${id}/preview`, {
        method: "POST",
        body: JSON.stringify({ goal, changes, revision: c.draft_revision }),
      });
      setValue("");
      setEditing(false);
      setSelected(undefined);
      setPanel(null);
      resource.reload();
      conversationsChanged();
    } catch (e) {
      setError(String(e));
      resource.reload();
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      c &&
      initialGoal &&
      !started.current &&
      !c.output_draft &&
      !turns.length
    ) {
      started.current = true;
      void generate(initialGoal);
      navigate(`/?conversation=${id}`, { replace: true, state: null });
    }
  }, [c?.id]);
  useEffect(() => {
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns.length, c?.draft_revision, busy]);
  async function approve() {
    if (!c) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<Task>(`/v1/conversations/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ revision: c.draft_revision }),
      });
      setSelected(result.task_id);
      resource.reload();
      conversationsChanged();
    } catch (e) {
      setError(String(e));
      resource.reload();
    } finally {
      setBusy(false);
    }
  }
  async function action(target: Task, action: "cancel" | "confirm" | "retry") {
    setBusy(true);
    setError("");
    try {
      await api(`/v1/tasks/${target.task_id}/${action}`, { method: "POST" });
      resource.reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function rename(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/v1/conversations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      setRenaming(false);
      resource.reload();
      conversationsChanged();
    } catch (e) {
      setError(String(e));
    }
  }
  if (!c)
    return (
      <div className="gui-blank">
        {resource.error ? (
          <p className="gui-error" role="alert">
            {resource.error}
            <Button onClick={resource.reload}>重试</Button>
          </p>
        ) : (
          <>
            <LoaderCircle className="spin" />
            <p>加载会话…</p>
          </>
        )}
      </div>
    );
  return (
    <div className={`gui-workspace ${panel ? "with-panel" : ""}`}>
      <section className="gui-conversation">
        <header className="gui-conversation-header">
          <Link to="/" aria-label="返回新会话">
            <ArrowLeft size={17} />
          </Link>
          {renaming ? (
            <form className="gui-rename" onSubmit={rename}>
              <input
                aria-label="会话标题"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                required
              />
              <button type="submit" aria-label="保存标题">
                <Check size={16} />
              </button>
              <button
                type="button"
                aria-label="取消修改标题"
                onClick={() => setRenaming(false)}
              >
                <X size={16} />
              </button>
            </form>
          ) : (
            <>
              <h1>{c.title}</h1>
              <button
                aria-label="修改会话标题"
                disabled={readonly}
                onClick={() => {
                  setTitle(c.title);
                  setRenaming(true);
                }}
              >
                <Pencil size={14} />
              </button>
            </>
          )}
          <button
            className="gui-open-panel"
            aria-label="查看任务详情"
            aria-expanded={!!panel}
            onClick={() => {
              setSelected(undefined);
              setPanel(panel ? null : "details");
            }}
          >
            <PanelRight size={17} />
            <span>任务详情</span>
          </button>
        </header>
        <div className="gui-chat-scroll" ref={scroll}>
          {!turns.length && !draft && !busy && (
            <div className="gui-blank">
              <Sparkles size={28} />
              <h2>从目标开始</h2>
              <p>先明确预计交付，再开始协作执行。</p>
            </div>
          )}
          {turns.map((t) => (
            <div className="gui-turn" key={t.task_id}>
              <div className="gui-message user">
                <div className="gui-person-avatar">我</div>
                <div className="gui-bubble">
                  <p>{t.prompt}</p>
                  <small>
                    {new Date(t.created_at).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </div>
              </div>
              <div className="gui-message assistant">
                <div className="gui-ai-avatar">
                  <Sparkles size={17} />
                </div>
                <div className="gui-answer">
                  <div className="gui-answer-heading">
                    <strong>
                      {t.status === "SUCCESS"
                        ? "工作已完成"
                        : t.status === "FAILED"
                          ? "本次工作遇到了问题"
                          : t.status === "CANCELLED"
                            ? "本次工作已停止"
                            : "正在为你处理"}
                    </strong>
                    <span className={`gui-chip ${t.status.toLowerCase()}`}>
                      {taskStatus[t.status]}
                    </span>
                  </div>
                  {t.result?.data.output && !["RUNNING", "PENDING"].includes(t.status) ? (
                    <>
                      {t.result.data.document ? (
                        <div className="gui-document-summary">
                          <p>{t.result.data.document.complete ? "章节已生成" : "当前为未完成草稿"} · {t.result.data.document.chapters.length} / {t.result.data.document.total} 章</p>
                          <ol>{t.result.data.document.chapters.map((chapter) => <li key={chapter.chapter_id}>{chapter.title}</li>)}</ol>
                          <p>打开成果可按章节阅读正文、查看共享事实和审核意见。</p>
                        </div>
                      ) : <Markdown value={t.result.data.output} />}
                      <div className="gui-artifact-card">
                        <span className="gui-file-icon">
                          <FileText size={21} />
                        </span>
                        <div>
                          <strong>
                            {(c.approved_task_id === t.task_id
                              ? draft?.title
                              : undefined) || text(t.result.data.output).match(/^#\s+(.+)$/m)?.[1] || c.title}
                            .md
                          </strong>
                          <small>
                            Markdown ·{" "}
                            {Array.from(
                              text(t.result.data.output),
                            ).length.toLocaleString()}{" "}
                            字符 ·{" "}
                            {t.status === "SUCCESS" ? "已归档" : t.result.data.document?.complete === false ? "未完成草稿" : "待审核稿件"}
                          </small>
                        </div>
                        <button
                          onClick={() => {
                            setSelected(t.task_id);
                            setPanel("artifact");
                          }}
                        >
                          打开
                        </button>
                        <a
                          href={`/v1/tasks/${t.task_id}/export`}
                          title="下载 Markdown"
                          aria-label={`下载 ${t.task_id} 成果`}
                        >
                          <ArrowDownToLine size={17} />
                        </a>
                      </div>
                    </>
                  ) : (
                    <Progress task={t} />
                  )}
                  {t.result?.error && (
                    <p className="gui-error" role="alert">
                      {t.result.error}
                    </p>
                  )}
                  {t.status === "FAILED" && draft?.generation_mode === "chapters" && c.approved_task_id === t.task_id && (
                    <Button disabled={busy || readonly || archived} variant="outline" onClick={() => action(t, "retry")}>
                      重试并复用已完成章节
                    </Button>
                  )}
                  {t.status === "PENDING_CONFIRMATION" && (
                    <div className="gui-review-note">
                      <p>
                        {t.result?.data.review?.feedback ||
                          "请检查成果后继续。"}
                      </p>
                      {t.result?.next_action === "REVIEW_DELIVERABLE" && (
                        <Button
                          disabled={busy || readonly}
                          onClick={() => action(t, "confirm")}
                        >
                          接受交付
                        </Button>
                      )}
                    </div>
                  )}
                  <button
                    className="gui-text-action"
                    onClick={() => {
                      setSelected(t.task_id);
                      setPanel("execution");
                    }}
                  >
                    查看执行详情
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {pending && draft && (
            <div className="gui-turn">
              <div className="gui-message user">
                <div className="gui-person-avatar">我</div>
                <div className="gui-bubble">
                  <p>{draft.goal}</p>
                </div>
              </div>
              <div className="gui-message assistant">
                <div className="gui-ai-avatar">
                  <Sparkles size={17} />
                </div>
                <div className="gui-answer">
                  <strong>我已理解你的需求</strong>
                  <p className="gui-answer-intro">
                    先确认这次的交付内容，你也可以修改目录和输出要求。
                  </p>
                  <PreviewCard draft={draft} />
                  {editing && !readonly && !archived ? (
                    <PreviewEditor
                      key={c.draft_revision}
                      draft={draft}
                      revision={c.draft_revision}
                      id={id}
                      onCancel={() => setEditing(false)}
                      onSaved={() => {
                        setEditing(false);
                        resource.reload();
                        conversationsChanged();
                      }}
                    />
                  ) : (
                    <div className="gui-preview-actions">
                      <Button
                        disabled={busy || readonly || archived}
                        onClick={approve}
                      >
                        <Check size={15} />
                        确认执行
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || readonly || archived}
                        onClick={() => setEditing(true)}
                      >
                        <Pencil size={14} />
                        修改输出
                      </Button>
                      <button
                        className="gui-text-action"
                        onClick={() => {
                          setSelected(undefined);
                          setPanel("details");
                        }}
                      >
                        查看详情
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {busy && (
            <div className="gui-thinking" role="status">
              <Sparkles size={18} />
              <span>正在处理你的要求</span>
              <LoaderCircle size={14} className="spin" />
            </div>
          )}
        </div>
        <div className="gui-composer-dock">
          {(error || resource.error) && (
            <p className="gui-error" role="alert">
              {error || resource.error}
            </p>
          )}
          {archived && (
            <p className="gui-muted">
              此会话已归档，请从左侧归档列表恢复后继续。
            </p>
          )}
          {activeTask && (
            <div className="gui-running-bar">
              <span>
                <span className="gui-pulse" />
                {activeTask.status === "PENDING_CONFIRMATION"
                  ? "检查成果后接受交付，或取消本轮任务"
                  : "工作正在进行，完成后可以继续追问。"}
              </span>
              <button
                disabled={busy || readonly}
                onClick={() => action(activeTask, "cancel")}
              >
                <Square size={12} />
                停止
              </button>
            </div>
          )}
          <Composer
            value={value}
            onChange={setValue}
            busy={busy}
            disabled={readonly || archived || !!activeTask}
            pending={pending}
            onSubmit={(e) => {
              e.preventDefault();
              void generate(
                pending ? draft!.goal : value,
                pending ? value : "",
              );
            }}
          />
          <p className="gui-composer-hint">
            AI 可能产生错误，请核对重要信息。
            {pending ? " 批准前不会开始执行。" : ""}
          </p>
        </div>
      </section>
      {panel && (
        <TaskPanel
          tab={panel}
          setTab={setPanel}
          onClose={() => setPanel(null)}
          task={showingDraft ? undefined : task}
          draft={
            showingDraft || c.approved_task_id === task?.task_id ? draft : undefined
          }
          pending={showingDraft}
          title={c.title}
        />
      )}
    </div>
  );
}
