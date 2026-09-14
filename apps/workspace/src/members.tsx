import { useState, type FormEvent } from "react";
import { UserPlus, LoaderCircle } from "lucide-react";
import { api, useResource } from "./api";
import { useSession } from "./auth";
import { Button } from "./components/ui/button";

export function Members() {
  const session = useSession();
  return session.role === "ADMIN" ? (
    <MemberManagement />
  ) : (
    <p>当前角色：{session.role === "VIEWER" ? "只读成员" : "成员"}</p>
  );
}
function MemberManagement() {
  const members =
    useResource<{ id: string; username: string; role: string }[]>(
      "/v1/admin/members",
    );
  const audit =
    useResource<
      { id: number; action: string; resource_id: string; created_at: string }[]
    >("/v1/admin/audit");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(username: string, role: string) {
    setBusy(true);
    setError("");
    try {
      await api("/v1/admin/members", {
        method: "POST",
        body: JSON.stringify({ username, role }),
      });
      members.reload();
      audit.reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    void save(String(values.get("username")), String(values.get("role")));
  }
  return (
    <>
      <section className="section">
        <h2>空间成员</h2>
        <form className="member-form" onSubmit={add}>
          <input
            name="username"
            aria-label="成员用户名"
            placeholder="已注册的用户名"
            required
            minLength={3}
          />
          <select name="role" aria-label="新成员角色">
            <option value="MEMBER">成员</option>
            <option value="VIEWER">只读成员</option>
            <option value="ADMIN">管理员</option>
          </select>
          <Button disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <UserPlus size={16} />
            )}
            添加成员
          </Button>
        </form>
        {(error || members.error) && (
          <p className="auth-error" role="alert">
            {error || members.error}
          </p>
        )}
        <div className="member-list">
          {members.data?.map((member) => (
            <div key={member.id}>
              <span>{member.username}</span>
              <select
                aria-label={`${member.username} 的角色`}
                disabled={busy}
                value={member.role}
                onChange={(e) => void save(member.username, e.target.value)}
              >
                <option value="ADMIN">管理员</option>
                <option value="MEMBER">成员</option>
                <option value="VIEWER">只读成员</option>
              </select>
            </div>
          ))}
        </div>
      </section>
      <section className="section">
        <h2>操作审计</h2>
        {audit.error && <p className="auth-error">{audit.error}</p>}
        <div className="audit-list">
          {audit.data?.map((entry) => (
            <div key={entry.id}>
              <strong>{entry.action}</strong>
              <span>{entry.resource_id}</span>
              <time>{new Date(entry.created_at).toLocaleString("zh-CN")}</time>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
