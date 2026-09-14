import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { LogIn, LoaderCircle, LogOut } from "lucide-react";
import { api } from "./api";
import { Button } from "./components/ui/button";

export interface Session {
  user_id: string;
  username: string;
  workspace_id: string;
  role: "ADMIN" | "MEMBER" | "VIEWER";
  workspaces: { id: string; name: string; role: string }[];
}
const SessionContext = createContext<Session | null>(null);
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Session required");
  return value;
}

export function AuthBoundary({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Session>("/auth/me")
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
    const expired = () => setSession(null);
    window.addEventListener("workspace-session-expired", expired);
    return () =>
      window.removeEventListener("workspace-session-expired", expired);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      setSession(
        await api<Session>(register ? "/auth/register" : "/auth/login", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(values)),
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="auth-page">
        <LoaderCircle className="spin" aria-label="正在验证登录" />
      </main>
    );
  if (session)
    return (
      <SessionContext.Provider value={session}>
        <div key={`${session.user_id}:${session.workspace_id}`}>{children}</div>
      </SessionContext.Provider>
    );
  return (
    <main className="auth-page">
      <form className="auth-form" onSubmit={submit}>
        <img src="/application-icon.png" alt="" width="48" height="48" />
        <h1>Enterprise Workspace</h1>
        <p>{register ? "创建账户与工作空间" : "登录工作空间"}</p>
        <label>
          用户名
          <input
            name="username"
            autoComplete="username"
            required
            minLength={3}
            maxLength={64}
            pattern="[a-zA-Z0-9_.-]+"
          />
        </label>
        <label>
          密码
          <input
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            required
            minLength={register ? 12 : 1}
            maxLength={72}
          />
        </label>
        {register && (
          <label>
            空间名称
            <input name="workspace_name" required maxLength={120} />
          </label>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <Button disabled={busy} type="submit">
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <LogIn size={16} />
          )}{" "}
          {register ? "创建账户" : "登录"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register ? "返回登录" : "注册账户"}
        </Button>
      </form>
    </main>
  );
}

export function SessionControls() {
  const session = useSession();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function change(path: string, body?: object) {
    setBusy(true);
    setError("");
    try {
      await api(path, { method: "POST", body: JSON.stringify(body || {}) });
      window.location.assign("/");
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }
  return (
    <div className="session-controls">
      <select
        aria-label="当前工作空间"
        disabled={busy}
        value={session.workspace_id}
        onChange={(e) =>
          void change("/auth/workspace", { workspace_id: e.target.value })
        }
      >
        {session.workspaces.map((space) => (
          <option key={space.id} value={space.id}>
            {space.name}
          </option>
        ))}
      </select>
      <div>
        <span>
          {session.username} ·{" "}
          {
            { ADMIN: "管理员", MEMBER: "成员", VIEWER: "只读成员" }[
              session.role
            ]
          }
        </span>
        <Button
          aria-label="退出登录"
          title="退出登录"
          size="icon"
          variant="ghost"
          disabled={busy}
          onClick={() => void change("/auth/logout")}
        >
          <LogOut size={15} />
        </Button>
      </div>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
    </div>
  );
}
