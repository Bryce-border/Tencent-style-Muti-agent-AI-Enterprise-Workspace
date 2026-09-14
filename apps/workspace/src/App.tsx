import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  FileBarChart2,
  FileText,
  House,
  Library,
  LoaderCircle,
  Menu,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Users,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, useResource } from "./api";
import { useSession, SessionControls } from "./auth";
import { Members } from "./members";
import { ModelSettings } from "./model-settings";
import { Documents } from "./documents";
import { Button } from "./components/ui/button";
import type {
  Citation,
  Dashboard,
  Employee,
  Event,
  Message,
  Report,
  Status,
  Task,
} from "./types";

const statusNames: Record<Status, string> = {
  PENDING: "等待执行",
  RUNNING: "执行中",
  SUCCESS: "已完成",
  FAILED: "执行失败",
  CANCELLED: "已取消",
  PENDING_CONFIRMATION: "待人工处理",
};
const navigation = [
  { path: "/", name: "总览", icon: House },
  { path: "/assistant", name: "AI Assistant", icon: Bot },
  { path: "/employees", name: "AI 员工", icon: Users },
  { path: "/tasks", name: "任务中心", icon: CheckCheck },
  { path: "/messages", name: "协作消息", icon: MessageSquare },
  { path: "/knowledge", name: "知识库", icon: Library },
  { path: "/documents", name: "Documents", icon: FileText },
  { path: "/reports", name: "报告", icon: FileBarChart2 },
];
const date = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const asText = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2) || "";
function StatusBadge({ value }: { value: Status }) {
  return (
    <span className={`badge status-${value.toLowerCase()}`}>
      {statusNames[value] || value}
    </span>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <CircleHelp size={24} />
      <p>{children}</p>
    </div>
  );
}
function Loading() {
  return (
    <div className="empty-state" role="status">
      <LoaderCircle className="spin" size={20} />
      正在加载
    </div>
  );
}
function Failure({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <span>{message}</span>
      {retry && (
        <Button variant="outline" onClick={retry}>
          <RefreshCw size={14} />
          重试
        </Button>
      )}
    </div>
  );
}
function PageHeading({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
}
function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
function Reload({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      title="刷新"
      aria-label="刷新"
      onClick={onClick}
    >
      <RefreshCw size={16} />
    </Button>
  );
}

export function App() {
  const session = useSession();
  const [menu, setMenu] = useState(false);
  const health = useResource<{ status: string }>("/health", 30000);
  return (
    <div className="shell">
      <aside className={`sidebar ${menu ? "is-open" : ""}`}>
        <Link className="brand" to="/" onClick={() => setMenu(false)}>
          <img src="/application-icon.png" alt="" />
          <span>
            Enterprise<span className="brand-sub">AI WORKSPACE</span>
          </span>
        </Link>
        <div className="workspace-label">
          <BriefcaseBusiness size={16} />
          <span>
            {
              session.workspaces.find(
                (space) => space.id === session.workspace_id,
              )?.name
            }
          </span>
          <span className="small-badge">本地</span>
        </div>
        <Button asChild className="new-work">
          <Link to="/assistant" onClick={() => setMenu(false)}>
            <Plus size={16} />
            新建工作
          </Link>
        </Button>
        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="主导航">
          {navigation.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              onClick={() => setMenu(false)}
              className={({ isActive }) =>
                `nav-link ${isActive ? "selected" : ""}`
              }
            >
              <item.icon size={17} />
              <span>{item.name}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <NavLink
            to="/admin"
            className="nav-link"
            onClick={() => setMenu(false)}
          >
            <Settings2 size={17} />
            系统与开发状态
          </NavLink>
          <SessionControls />
        </div>
      </aside>
      {menu && (
        <button
          className="menu-backdrop"
          aria-label="关闭导航"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <Button
            variant="ghost"
            size="icon"
            className="mobile-menu"
            aria-label={menu ? "关闭导航" : "打开导航"}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X size={18} /> : <Menu size={18} />}
          </Button>
          <span className="breadcrumb">
            Workspace <ChevronRight size={13} />{" "}
            {
              session.workspaces.find(
                (space) => space.id === session.workspace_id,
              )?.name
            }
          </span>
          <div className="topbar-right">
            <span className={`connection ${health.error ? "offline" : ""}`}>
              <i />
              {health.loading
                ? "连接中"
                : health.error
                  ? "服务不可用"
                  : "服务已连接"}
            </span>
            <Link to="/assistant" className="topbar-command" title="新建工作">
              <Plus size={17} />
            </Link>
          </div>
        </header>
        <main className="page">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="/employees" element={<Employees />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/tasks/:taskId" element={<TaskDetail />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/knowledge" element={<Knowledge />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/reports/:taskId" element={<ReportDetail />} />
            <Route path="/admin" element={<Admin />} />
            <Route
              path="*"
              element={
                <>
                  <PageHeading title="页面不存在" />
                  <Button asChild>
                    <Link to="/">返回总览</Link>
                  </Button>
                </>
              }
            />
          </Routes>
        </main>
        <footer className="statusbar">
          <span>
            <ShieldCheck size={12} />
            本地开发环境
          </span>
          <span>Enterprise Workspace · 0.3</span>
        </footer>
      </div>
    </div>
  );
}

function Overview() {
  const stats = useResource<Dashboard>("/v1/dashboard", 15000);
  const tasks = useResource<Task[]>("/v1/tasks?limit=5", 5000);
  return (
    <>
      <PageHeading
        title="工作空间总览"
        subtitle={new Date().toLocaleDateString("zh-CN", {
          year: "numeric",
          month: "long",
          day: "numeric",
          weekday: "long",
        })}
        actions={
          <Button asChild>
            <Link to="/assistant">
              <Plus size={16} />
              新建工作
            </Link>
          </Button>
        }
      />
      {stats.error && <Failure message={stats.error} retry={stats.reload} />}
      {stats.loading ? (
        <Loading />
      ) : (
        stats.data && (
          <div className="metrics">
            {[
              [
                Users,
                "AI 员工",
                stats.data.employees_available,
                `${stats.data.employee_count} 个预置角色`,
              ],
              [
                Activity,
                "执行中任务",
                stats.data.tasks.active,
                `累计 ${stats.data.tasks.total} 项任务`,
              ],
              [
                Library,
                "知识库文档",
                stats.data.knowledge.documents,
                stats.data.knowledge.available
                  ? `${stats.data.knowledge.chunks} 个知识片段`
                  : "检索暂不可用",
              ],
              [
                FileBarChart2,
                "已归档报告",
                stats.data.reports,
                `${stats.data.tasks.pending_confirmation} 项待人工处理`,
              ],
            ].map(([Icon, label, count, note]) => {
              const MetricIcon = Icon as typeof Users;
              return (
                <div className="metric" key={String(label)}>
                  <div>
                    <span>{String(label)}</span>
                    <MetricIcon size={17} />
                  </div>
                  <strong>{String(count)}</strong>
                  <small>{String(note)}</small>
                </div>
              );
            })}
          </div>
        )
      )}
      <section className="section">
        <div className="section-title">
          <h2>我的应用</h2>
          <span>工作空间</span>
        </div>
        <div className="app-launcher">
          <Link className="desktop-app" to="/assistant">
            <img src="/application-icon.png" alt="AI Assistant" />
            <span>AI Assistant</span>
          </Link>
          {[
            { to: "/employees", name: "AI 员工", icon: Users, color: "green" },
            { to: "/tasks", name: "任务中心", icon: CheckCheck, color: "blue" },
            { to: "/knowledge", name: "知识库", icon: Library, color: "rose" },
            {
              to: "/reports",
              name: "报告",
              icon: FileBarChart2,
              color: "amber",
            },
            {
              to: "/messages",
              name: "协作消息",
              icon: MessageSquare,
              color: "gray",
            },
          ].map((item) => (
            <Link className="desktop-app" to={item.to} key={item.to}>
              <span className={`app-icon ${item.color}`}>
                <item.icon size={24} strokeWidth={1.7} />
              </span>
              <span>{item.name}</span>
            </Link>
          ))}
        </div>
      </section>
      <section className="section">
        <div className="section-title">
          <h2>最近工作</h2>
          <Link to="/tasks">
            全部任务 <ArrowRight size={14} />
          </Link>
        </div>
        {tasks.error ? (
          <Failure message={tasks.error} retry={tasks.reload} />
        ) : tasks.loading ? (
          <Loading />
        ) : (
          <TaskRows tasks={tasks.data || []} />
        )}
      </section>
      <div className="overview-bottom">
        <span>
          <Bot size={17} />
          AI 团队
        </span>
        <p>
          {stats.data?.runtime.configured
            ? `当前模型：${stats.data.runtime.model}`
            : "模型未配置"}
        </p>
        <Link to="/employees">
          查看员工 <ArrowRight size={14} />
        </Link>
      </div>
    </>
  );
}

function Assistant() {
  const session = useSession();
  const employees = useResource<Employee[]>("/v1/employees");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState(
    params.get("employee") || "ai_assistant",
  );
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = employees.data?.find((item) => item.employee_id === employee);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || session.role === "VIEWER") return;
    setError("");
    setBusy(true);
    try {
      const task = await api<Task>("/v1/tasks", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          prompt: prompt.trim(),
          employee_id: employee,
        }),
      });
      navigate(`/tasks/${task.task_id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading title="AI Assistant" subtitle="新建工作" />
      <div className="assistant-layout">
        <div className="assistant-primary">
          <div className="assistant-identity">
            <img src="/application-icon.png" alt="" />
            <div>
              <h2>{active?.name || "AI 管家"}</h2>
              <p>{active?.title || "企业工作助手"}</p>
            </div>
          </div>
          {employees.error && (
            <Failure message={employees.error} retry={employees.reload} />
          )}
          <form className="work-form" onSubmit={submit}>
            <label htmlFor="employee">负责员工</label>
            <select
              id="employee"
              value={employee}
              onChange={(event) => setEmployee(event.target.value)}
              disabled={busy || employees.loading}
            >
              {(employees.data || []).map((item) => (
                <option value={item.employee_id} key={item.employee_id}>
                  {item.name}
                  {item.status === "unconfigured" ? "（模型未配置）" : ""}
                </option>
              ))}
            </select>
            <label htmlFor="goal">工作目标与资料</label>
            <textarea
              id="goal"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              required
              minLength={3}
              maxLength={4000}
              rows={9}
              placeholder="例如：设计一个企业知识库产品，输出 MVP 需求和开发计划。"
            />
            <div className="composer-footer">
              <span>{prompt.length} / 4000</span>
              <Button
                type="submit"
                disabled={
                  busy ||
                  session.role === "VIEWER" ||
                  prompt.trim().length < 3 ||
                  active?.status !== "available"
                }
              >
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <ArrowUp size={16} />
                )}
                提交工作
              </Button>
            </div>
          </form>
          {error && <Failure message={error} />}
        </div>
        <aside className="assistant-side">
          <h2>常用工作</h2>
          {[
            {
              name: "产品与技术方案",
              employee: "ai_assistant",
              text: "设计一个企业 AI 知识库产品，面向 50 人团队，输出 MVP 需求、技术方案和分阶段开发计划。",
            },
            {
              name: "项目周报",
              employee: "document_expert",
              text: "根据以下进展整理项目周报，区分本周完成、风险与下周计划。进展：",
            },
            {
              name: "制度查询",
              employee: "knowledge_expert",
              text: "查询企业知识库中的报销制度，列出申请步骤与来源。",
            },
            {
              name: "会议纪要",
              employee: "meeting_secretary",
              text: "根据以下会议记录整理决策和行动项，负责人及日期缺失时标记待确认。会议记录：",
            },
          ].map((item) => (
            <button
              className="scenario"
              key={item.name}
              onClick={() => {
                setEmployee(item.employee);
                setPrompt(item.text);
              }}
            >
              <FileText size={17} />
              <span>{item.name}</span>
              <ArrowRight size={15} />
            </button>
          ))}
          <div className="employee-note">
            <span className="small-badge">当前工作范围</span>
            <p>
              文本资料与企业知识。附件、会议同步、数据文件计算及外部发送尚未接入。
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

function Employees() {
  const employees = useResource<Employee[]>("/v1/employees");
  return (
    <>
      <PageHeading title="AI 员工" subtitle="企业专业团队" />
      {employees.error ? (
        <Failure message={employees.error} retry={employees.reload} />
      ) : employees.loading ? (
        <Loading />
      ) : (
        <div className="employee-grid">
          {employees.data?.map((employee, index) => (
            <article className="employee-card" key={employee.employee_id}>
              <div className="employee-card-head">
                <span className={`employee-avatar tone-${index % 4}`}>
                  <Bot size={23} />
                </span>
                <span
                  className={`badge ${employee.status === "available" ? "status-success" : ""}`}
                >
                  {employee.status === "available" ? "已接入" : "未配置模型"}
                </span>
              </div>
              <h2>{employee.name}</h2>
              <span className="employee-title">{employee.title}</span>
              <p>{employee.description}</p>
              <div className="capabilities">
                {employee.capabilities.map((value) => (
                  <span key={value}>{value}</span>
                ))}
              </div>
              <Button asChild variant="outline">
                <Link to={`/assistant?employee=${employee.employee_id}`}>
                  发起工作 <ArrowRight size={14} />
                </Link>
              </Button>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function TaskRows({ tasks }: { tasks: Task[] }) {
  if (!tasks.length) return <Empty>暂无工作记录</Empty>;
  return (
    <div className="task-rows">
      {tasks.map((task) => (
        <Link
          key={task.task_id}
          to={`/tasks/${task.task_id}`}
          className="task-row"
        >
          <span className="row-icon">
            <FileText size={17} />
          </span>
          <div className="task-row-copy">
            <strong>{task.prompt}</strong>
            <small>
              {task.task_id} · {date(task.updated_at)}
            </small>
          </div>
          <StatusBadge value={task.status} />
          <ChevronRight size={16} />
        </Link>
      ))}
    </div>
  );
}

function Tasks() {
  const tasks = useResource<Task[]>("/v1/tasks?limit=100", 5000);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const filtered =
    tasks.data?.filter(
      (task) =>
        (status === "all" || task.status === status) &&
        task.prompt.toLowerCase().includes(query.toLowerCase()),
    ) || [];
  return (
    <>
      <PageHeading
        title="任务中心"
        actions={
          <>
            <Reload onClick={tasks.reload} />
            <Button asChild>
              <Link to="/assistant">
                <Plus size={16} />
                新建工作
              </Link>
            </Button>
          </>
        }
      />
      <div className="filter-toolbar">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="搜索任务"
            placeholder="搜索最近 100 项任务"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          aria-label="任务状态"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">全部状态</option>
          {Object.entries(statusNames).map(([key, value]) => (
            <option key={key} value={key}>
              {value}
            </option>
          ))}
        </select>
      </div>
      {tasks.error && <Failure message={tasks.error} retry={tasks.reload} />}
      {tasks.loading ? <Loading /> : <TaskRows tasks={filtered} />}
    </>
  );
}

function TaskDetail() {
  const session = useSession();
  const { taskId = "" } = useParams();
  const encoded = encodeURIComponent(taskId);
  const task = useResource<Task>(`/v1/tasks/${encoded}`, 3000);
  const events = useResource<Event[]>(`/v1/tasks/${encoded}/events`, 3000);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"result" | "activity">("result");
  const current = task.data;
  useEffect(() => {
    if (!current || !["RUNNING", "PENDING"].includes(current.status)) return;
    const stream = new EventSource(`/v1/tasks/${encoded}/stream`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    stream.onmessage = () => {
      if (!timer)
        timer = setTimeout(() => {
          events.reload();
          task.reload();
          timer = undefined;
        }, 500);
    };
    return () => {
      stream.close();
      clearTimeout(timer);
    };
  }, [encoded, current?.status, events.reload, task.reload]);
  async function action(name: string) {
    setBusy(true);
    setActionError("");
    try {
      await api(`/v1/tasks/${encoded}/${name}`, { method: "POST" });
      task.reload();
      events.reload();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setBusy(false);
    }
  }
  if (task.error && !current)
    return <Failure message={task.error} retry={task.reload} />;
  if (!current) return <Loading />;
  const activity = events.data || [];
  const attemptStart = activity.reduce(
    (latest, event, index) =>
      event.type === "task.attempt.started" ? index : latest,
    0,
  );
  const draft =
    current.status === "RUNNING"
      ? activity
          .slice(attemptStart)
          .find(
            (event) =>
              event.type === "agent.node.completed" &&
              event.payload.node_id ===
                current.plan[current.plan.length - 1]?.node_id,
          )?.payload.output
      : undefined;
  const output = current.result?.data.output || draft;
  const citations = current.result?.citations || [];
  const markers = new Set(Array.from(String(output || "").matchAll(/\[来源\s*[:：]\s*([^\]]+)\]/g), match => match[1].trim()));
  const unique = citations.filter(
    (citation, index) =>
      (markers.has(citation.chunkId || "") || markers.has(citation.title || "")) &&
      citations.findIndex(
        (item) =>
          item.content?.normalize("NFKC").replace(/\s+/g, "").toLowerCase() ===
          citation.content?.normalize("NFKC").replace(/\s+/g, "").toLowerCase(),
      ) === index,
  );
  return (
    <>
      <Link className="back-link" to="/tasks">
        <ArrowLeft size={15} />
        任务中心
      </Link>
      <PageHeading
        title="工作详情"
        subtitle={`${current.task_id} · ${date(current.created_at)}`}
        actions={
          <>
            <StatusBadge value={current.status} />
            {current.result && (
              <Button asChild variant="outline">
                <a href={`/v1/tasks/${encoded}/export`} title="导出 Markdown">
                  <ArrowDownToLine size={16} />
                  导出
                </a>
              </Button>
            )}
            {session.role !== "VIEWER" &&
              ["PENDING", "RUNNING", "PENDING_CONFIRMATION"].includes(
                current.status,
              ) && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => action("cancel")}
                >
                  <Square size={14} />
                  取消
                </Button>
              )}
          </>
        }
      />
      <div className="request-block">
        <span>工作目标</span>
        <p>{current.prompt}</p>
      </div>
      {task.error && <Failure message={task.error} retry={task.reload} />}
      {actionError && <Failure message={actionError} />}
      {current.result?.error && <Failure message={current.result.error} />}
      {session.role !== "VIEWER" &&
        current.status === "PENDING_CONFIRMATION" &&
        current.result?.next_action === "REVIEW_DELIVERABLE" && (
          <div className="review-banner">
            <span>
              {current.result.data.review?.feedback || "交付结果需要人工审核"}
            </span>
            <Button disabled={busy} onClick={() => action("confirm")}>
              <Check size={16} />
              接受交付
            </Button>
          </div>
        )}
      <div className="execution-layout">
        <section className="delivery">
          <div className="tabs" role="tablist" aria-label="工作详情">
            <button
              role="tab"
              aria-selected={tab === "result"}
              onClick={() => setTab("result")}
            >
              交付结果
            </button>
            <button
              role="tab"
              aria-selected={tab === "activity"}
              onClick={() => setTab("activity")}
            >
              协作记录 <span>{events.data?.length || 0}</span>
            </button>
          </div>
          {tab === "result" ? (
            <div role="tabpanel">
              {output ? (
                <>
                  {draft && !current.result?.data.output ? (
                    <p className="legacy-note" role="status">
                      待审核草稿
                    </p>
                  ) : null}
                  <Markdown>{asText(output)}</Markdown>
                </>
              ) : current.result?.data.node_results?.length ? (
                <>
                  <p className="legacy-note">历史版本记录</p>
                  {current.result.data.node_results.map((node, index) => (
                    <details key={`${node.node_id}-${index}`}>
                      <summary>
                        {node.employee_id || node.agent || node.node_id}
                      </summary>
                      <Markdown>{asText(node.output)}</Markdown>
                    </details>
                  ))}
                </>
              ) : (
                <Empty>
                  {["RUNNING", "PENDING"].includes(current.status)
                    ? "团队正在处理，成果将在此显示"
                    : "此任务没有可交付成果"}
                </Empty>
              )}
              {unique.length > 0 && (
                <div className="sources">
                  <h2>引用来源</h2>
                  {unique.map((source, index) => (
                    <details key={index}>
                      <summary>{source.title || source.documentId}{source.chunkId ? ` · ${source.chunkId}` : ""}</summary>
                      <p>{source.content}</p>
                    </details>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div role="tabpanel">
              {events.error && (
                <Failure message={events.error} retry={events.reload} />
              )}
              {events.data?.map((event, index) => (
                <div className="event" key={index}>
                  <span className="event-dot" />
                  <div>
                    <strong>{eventName(event.type)}</strong>
                    <time>{date(event.created_at)}</time>
                    <details>
                      <summary>查看记录</summary>
                      <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                    </details>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <aside className="execution-sidebar">
          <h2>协作流程</h2>
          {!current.plan.length && <p className="muted">尚未生成计划</p>}
          {current.plan.map((step) => {
            const done = events.data?.some(
              (e) =>
                e.type === "agent.node.completed" &&
                e.payload.node_id === step.node_id,
            );
            const started = events.data?.some(
              (e) =>
                e.type === "agent.node.started" &&
                e.payload.node_id === step.node_id,
            );
            return (
              <div className={`step ${done ? "done" : ""}`} key={step.node_id}>
                <span>
                  {done ? (
                    <Check size={14} />
                  ) : started && current.status === "RUNNING" ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Bot size={14} />
                  )}
                </span>
                <div>
                  <strong>{step.employee_id || step.agent}</strong>
                  <p>{step.objective || step.node_id}</p>
                  {step.depends_on.length > 0 && (
                    <small>依赖：{step.depends_on.join(", ")}</small>
                  )}
                </div>
              </div>
            );
          })}
          {current.status === "SUCCESS" &&
            current.result?.data.mode === "crewai" && (
              <Button asChild variant="outline">
                <Link to={`/reports/${encoded}`}>
                  <FileBarChart2 size={15} />
                  归档报告
                </Link>
              </Button>
            )}
        </aside>
      </div>
    </>
  );
}

function eventName(value: string) {
  const names: Record<string, string> = {
    "task.created": "工作已创建",
    "task.started": "开始执行",
    "task.completed": "工作已完成",
    "task.failed": "执行失败",
    "task.cancelled": "任务已取消",
    "task.confirmed": "交付已确认",
    "planner.started": "AI 管家正在规划",
    "planner.fallback": "已采用预置流程",
    "plan.created": "协作计划已生成",
    "agent.node.started": "员工开始工作",
    "agent.node.completed": "员工已交付",
    "agent.node.failed": "员工执行失败",
    "review.started": "开始审核",
    "review.feedback": "审核要求修订",
    "review.completed": "审核已结束",
    "knowledge.retrieved": "企业知识检索完成",
    "knowledge.unavailable": "知识检索暂不可用",
    "task.approval.required": "等待人工处理",
    "task.attempt.started": "开始执行尝试",
    "task.retry.scheduled": "已安排重试",
  };
  return names[value] || value;
}

function Messages() {
  const messages = useResource<Message[]>("/v1/messages", 5000);
  return (
    <>
      <PageHeading
        title="协作消息"
        subtitle="最近 100 条工作记录"
        actions={<Reload onClick={messages.reload} />}
      />
      {messages.error && (
        <Failure message={messages.error} retry={messages.reload} />
      )}
      {messages.loading ? (
        <Loading />
      ) : !messages.data?.length ? (
        <Empty>暂无协作记录</Empty>
      ) : (
        <div className="message-feed">
          {messages.data.map((message) => (
            <Link
              className="message"
              to={`/tasks/${message.task_id}`}
              key={message.id}
            >
              <span className="message-icon">
                <MessageSquare size={17} />
              </span>
              <div>
                <strong>{eventName(message.type)}</strong>
                <p>{message.prompt}</p>
                <small>
                  {typeof message.payload.employee_id === "string"
                    ? message.payload.employee_id + " · "
                    : ""}
                  {message.task_id}
                </small>
              </div>
              <time>{date(message.created_at)}</time>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function Knowledge() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Citation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true);
    setError("");
    setResults(null);
    try {
      setResults(
        await api<Citation[]>(
          `/v1/knowledge/search?q=${encodeURIComponent(query)}`,
        ),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading title="企业知识库" subtitle="default" />
      <form className="knowledge-search" onSubmit={search}>
        <div className="search-field">
          <Search size={18} />
          <input
            aria-label="搜索企业知识"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索制度、项目或产品资料"
            required
          />
        </div>
        <Button disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Search size={16} />
          )}
          检索
        </Button>
      </form>
      {error && <Failure message={error} />}
      {busy ? (
        <Loading />
      ) : results === null ? (
        <Empty>尚未检索</Empty>
      ) : !results.length ? (
        <Empty>没有找到相关内容</Empty>
      ) : (
        <div className="search-results">
          {results.map((result, index) => (
            <article key={index}>
              <div>
                <FileText size={18} />
                <h2>{result.title || result.documentId}</h2>
                <span className="small-badge">
                  {Number(result.score || 0).toFixed(3)}
                </span>
              </div>
              <p>{result.content}</p>
              <small>{result.documentId}</small>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function Reports() {
  const reports = useResource<Report[]>("/v1/reports", 10000);
  return (
    <>
      <PageHeading
        title="报告"
        subtitle="已完成工作的交付归档"
        actions={<Reload onClick={reports.reload} />}
      />
      {reports.error && (
        <Failure message={reports.error} retry={reports.reload} />
      )}
      {reports.loading ? (
        <Loading />
      ) : !reports.data?.length ? (
        <Empty>暂无已归档报告</Empty>
      ) : (
        <div className="report-list">
          {reports.data.map((report) => (
            <Link
              to={`/reports/${report.task_id}`}
              key={report.task_id}
              className="report-row"
            >
              <FileBarChart2 size={22} />
              <div>
                <h2>{report.title}</h2>
                <small>
                  {date(report.created_at)} · {report.task_id}
                </small>
              </div>
              <ArrowRight size={16} />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function ReportDetail() {
  const { taskId = "" } = useParams();
  const encoded = encodeURIComponent(taskId);
  const report = useResource<Report>(`/v1/reports/${encoded}`);
  return (
    <>
      <Link className="back-link" to="/reports">
        <ArrowLeft size={15} />
        报告
      </Link>
      {report.error ? (
        <Failure message={report.error} retry={report.reload} />
      ) : report.loading ? (
        <Loading />
      ) : (
        report.data && (
          <>
            <PageHeading
              title={report.data.title}
              subtitle={date(report.data.created_at)}
              actions={
                <Button asChild variant="outline">
                  <a href={`/v1/tasks/${encoded}/export`}>
                    <ArrowDownToLine size={16} />
                    导出
                  </a>
                </Button>
              }
            />
            <Markdown>{report.data.content || ""}</Markdown>
            <Link className="back-link" to={`/tasks/${encoded}`}>
              查看工作记录 <ArrowRight size={15} />
            </Link>
          </>
        )
      )}
    </>
  );
}

function Admin() {
  const stats = useResource<Dashboard>("/v1/dashboard");
  return (
    <>
      <PageHeading title="系统与开发状态" subtitle="本地环境" />
      <ModelSettings />
      {stats.error && <Failure message={stats.error} retry={stats.reload} />}
      <section className="section">
        <h2>连接状态</h2>
        <dl className="settings-list">
          <div>
            <dt>模型</dt>
            <dd>
              {stats.data?.runtime.configured
                ? stats.data.runtime.model
                : "未配置或状态未知"}
            </dd>
          </div>
          <div>
            <dt>知识检索</dt>
            <dd>
              {stats.data?.knowledge.available
                ? "Elasticsearch 已连接"
                : "状态未知或不可用"}
            </dd>
          </div>
          <div>
            <dt>API 密钥</dt>
            <dd>由部署环境管理</dd>
          </div>
          <div>
            <dt>访问控制</dt>
            <dd>JWT 会话、空间隔离、角色权限</dd>
          </div>
          <div>
            <dt>外部写入连接器</dt>
            <dd>未启用</dd>
          </div>
        </dl>
      </section>
      <Members />
      <section className="section">
        <h2>模块交付进度</h2>
        <div className="module-list">
          {[
            [
              Bot,
              "AI 员工协作",
              "文本任务、知识上下文、审核与交付",
              "当前阶段",
            ],
            [
              FileText,
              "Documents",
              "文件上传、解析、预览与知识库索引",
              "待开发",
            ],
            [
              CalendarDays,
              "Meetings",
              "会议记录、纪要、行动项与任务联动",
              "待开发",
            ],
            [
              Activity,
              "Data Analysis",
              "CSV / Excel 计算、图表与分析报告",
              "待开发",
            ],
            [
              MessageSquare,
              "Messages",
              "协作事件已接入；企业通讯连接器待接入",
              "部分实现",
            ],
            [
              Settings2,
              "企业业务服务",
              "Java 21、Spring Boot / Cloud、MySQL、Redis",
              "已接入",
            ],
            [
              ShieldCheck,
              "企业权限",
              "用户、空间角色、数据范围与审计",
              "已接入",
            ],
          ].map(([Icon, name, note, status]) => {
            const ModuleIcon = Icon as typeof Bot;
            return (
              <div key={String(name)}>
                <ModuleIcon size={18} />
                <section>
                  <strong>{String(name)}</strong>
                  <p>{String(note)}</p>
                </section>
                <span className="small-badge">{String(status)}</span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
