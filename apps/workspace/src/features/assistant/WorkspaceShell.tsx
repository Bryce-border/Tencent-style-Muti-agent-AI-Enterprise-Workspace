import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Archive,
  BookOpen,
  Brain,
  ChevronDown,
  MessageSquare,
  Menu,
  Plus,
  Search,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { useResource, api } from "../../api";
import { applicationIcon } from "../../branding";
import { useSession, SessionControls } from "../../auth";
import type { Conversation } from "./contracts";
import { conversationsChanged } from "./contracts";

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const conversations = useResource<Conversation[]>("/v1/conversations", 15000);
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [mobile, setMobile] = useState(false);
  const [archived, setArchived] = useState(false);
  const [account, setAccount] = useState(false);
  const [error, setError] = useState("");
  const selected = new URLSearchParams(location.search).get("conversation");
  useEffect(() => {
    const reload = () => conversations.reload();
    window.addEventListener("conversations-changed", reload);
    return () => window.removeEventListener("conversations-changed", reload);
  }, [conversations.reload]);
  useEffect(() => setMobile(false), [location.pathname, location.search]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobile(false);
        setAccount(false);
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, []);
  const items = (conversations.data || []).filter(
    (c) =>
      !!c.archived === archived &&
      c.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  async function archive(c: Conversation) {
    try {
      await api(`/v1/conversations/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: !c.archived }),
      });
      conversationsChanged();
      if (selected === c.id) navigate("/");
    } catch (e) {
      setError(String(e));
    }
  }
  let lastGroup = "";
  return (
    <div className="gui-shell">
      <button
        className="gui-mobile-toggle"
        aria-label={mobile ? "关闭导航" : "打开导航"}
        aria-expanded={mobile}
        aria-controls="workspace-navigation"
        onClick={() => setMobile(!mobile)}
      >
        {mobile ? <X size={18} /> : <Menu size={18} />}
      </button>
      {mobile && (
        <button
          className="gui-scrim"
          aria-label="收起导航"
          onClick={() => setMobile(false)}
        />
      )}
      <aside id="workspace-navigation" className={`gui-sidebar ${mobile ? "open" : ""}`}>
        <Link to="/" className="gui-brand">
          <img src={applicationIcon} alt="" />
          <span>AI Enterprise Workspace</span>
        </Link>
        <nav className="gui-nav" aria-label="主导航">
          {[
            { to: "/", label: "会话", icon: MessageSquare },
            { to: "/knowledge", label: "知识库", icon: BookOpen },
            { to: "/memory", label: "记忆", icon: Brain },
            { to: "/settings", label: "设置", icon: Settings2 },
          ].map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                isActive || (n.to === "/" && location.pathname === "/assistant")
                  ? "active"
                  : ""
              }
            >
              <n.icon size={17} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="gui-history-heading">
          <span>{archived ? "已归档会话" : "最近会话"}</span>
          <button
            title={archived ? "查看最近会话" : "查看归档"}
            aria-label={archived ? "查看最近会话" : "查看归档"}
            onClick={() => setArchived(!archived)}
          >
            <Archive size={15} />
          </button>
        </div>
        <Link to="/" className="gui-new">
          <Plus size={15} />
          新建会话
        </Link>
        <label className="gui-search">
          <Search size={14} />
          <input
            aria-label="搜索会话"
            placeholder="搜索会话"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {(error || conversations.error) && (
          <p className="gui-error" role="alert">
            {error || conversations.error}
            <button onClick={() => conversations.reload()}>重试</button>
          </p>
        )}
        <div className="gui-history">
          {conversations.loading && <p className="gui-muted">加载会话…</p>}
          {!conversations.loading && !items.length && (
            <p className="gui-muted">
              {search ? "没有匹配的会话" : "暂无会话"}
            </p>
          )}
          {items.map((c) => {
            const day = new Date(c.updated_at || c.created_at);
            const group =
              day.toDateString() === new Date().toDateString()
                ? "今天"
                : "更早";
            const heading = group !== lastGroup;
            lastGroup = group;
            return (
              <div key={c.id}>
                {heading && <p className="gui-time-group">{group}</p>}
                <div
                  className={`gui-history-row ${selected === c.id ? "selected" : ""}`}
                >
                  <Link to={`/?conversation=${c.id}`}>
                    <MessageSquare size={15} />
                    <span>
                      <strong>{c.title}</strong>
                      <small>
                        {day.toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                    </span>
                  </Link>
                  <button
                    disabled={session.role === "VIEWER"}
                    title={archived ? "恢复会话" : "归档会话"}
                    aria-label={`${archived ? "恢复" : "归档"} ${c.title}`}
                    onClick={() => archive(c)}
                  >
                    <Archive size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="gui-account">
          {account && (
            <div className="gui-account-popover">
              <SessionControls />
            </div>
          )}
          <button
            className="gui-user"
            aria-expanded={account}
            onClick={() => setAccount(!account)}
          >
            <span className="gui-avatar">
              {session.username.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{session.username}</strong>
              <small>
                {
                  session.workspaces.find((s) => s.id === session.workspace_id)
                    ?.name
                }
              </small>
            </span>
            <ChevronDown size={14} />
          </button>
        </div>
      </aside>
      <main className="gui-main">{children}</main>
    </div>
  );
}
