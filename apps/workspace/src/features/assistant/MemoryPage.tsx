import { useState } from "react";
import { Brain, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api, useResource } from "../../api";
import { useSession } from "../../auth";
import { Button } from "../../components/ui/button";
import { employeeNames } from "../../workflow-model";

interface Memory {
  id: string;
  kind: string;
  content: string;
  source_task_id?: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
export function MemoryPage() {
  const [employee, setEmployee] = useState("ai_assistant");
  const [kind, setKind] = useState("preference");
  const [content, setContent] = useState("");
  const [edit, setEdit] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const memories = useResource<Memory[]>(
    `/v1/memories?employee_id=${employee}`,
  );
  const readonly = useSession().role === "VIEWER";
  async function mutate(method: string, path: string, body?: object) {
    setBusy(true);
    setError("");
    try {
      await api(path, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
      memories.reload();
      setEdit(undefined);
      setAdding(false);
      setContent("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gui-page memory-page">
      <div className="gui-page-title">
        <span className="gui-eyebrow">PERSONAL MEMORY</span>
        <h1>记忆</h1>
        <p>让 AI 了解你的工作习惯，由你决定它记住什么。</p>
        <Button
          onClick={() => {
            setAdding(true);
            setEdit(undefined);
            setContent("");
          }}
          disabled={readonly}
        >
          <Plus size={16} />
          添加记忆
        </Button>
      </div>
      <div className="gui-memory-note">
        <Brain size={22} />
        <div>
          <strong>经过你确认，才成为长期记忆</strong>
          <p>
            偏好与规则仅在当前空间内供你使用。禁用后不再召回，已生成的成果会保留。
          </p>
        </div>
      </div>
      <label className="gui-memory-scope">
        应用范围
        <select
          value={employee}
          onChange={(e) => {
            setEmployee(e.target.value);
            setAdding(false);
            setEdit(undefined);
          }}
        >
          {Object.entries(employeeNames).map(([id, name]) => (
            <option key={id} value={id}>
              {id === "ai_assistant"
                ? "总智能体 · 默认会话"
                : `${name} · 历史专用会话`}
            </option>
          ))}
        </select>
      </label>
      {(error || memories.error) && (
        <p className="gui-error" role="alert">
          {error || memories.error}
        </p>
      )}
      {(adding || edit) && (
        <form
          className="gui-memory-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void mutate(
              edit ? "PATCH" : "POST",
              edit ? `/v1/memories/${edit}` : "/v1/memories",
              edit ? { content } : { employee_id: employee, kind, content },
            );
          }}
        >
          <h2>{edit ? "编辑记忆" : "添加记忆"}</h2>
          {!edit && (
            <label>
              类型
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="preference">输出偏好</option>
                <option value="fact">确认的事实</option>
                <option value="decision">工作规则与决策</option>
              </select>
            </label>
          )}
          <label>
            内容
            <textarea
              autoFocus
              required
              maxLength={1000}
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="例如：中文输出，先给结论，再列依据。"
            />
          </label>
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAdding(false);
                setEdit(undefined);
              }}
            >
              取消
            </Button>
            <Button disabled={busy || readonly || !content.trim()}>
              <Check size={15} />
              保存
            </Button>
          </div>
        </form>
      )}
      <div className="gui-memory-grid">
        {memories.loading ? (
          <p>正在加载记忆…</p>
        ) : !memories.data?.length ? (
          <div className="gui-blank">
            <Brain size={30} />
            <h2>从一个偏好开始</h2>
            <p>语言、写作风格、常用章节，都可以成为下一次工作的起点。</p>
          </div>
        ) : (
          memories.data.map((m) => (
            <article
              key={m.id}
              className={`gui-memory-card ${m.enabled ? "" : "disabled"}`}
            >
              <header>
                <span className="gui-chip">
                  {
                    {
                      preference: "输出偏好",
                      fact: "确认的事实",
                      decision: "工作规则",
                    }[m.kind]
                  }
                </span>
                <label className="gui-switch">
                  <input
                    type="checkbox"
                    checked={m.enabled}
                    disabled={readonly || busy}
                    onChange={() =>
                      mutate("PATCH", `/v1/memories/${m.id}`, {
                        enabled: !m.enabled,
                      })
                    }
                  />
                  {m.enabled ? "已启用" : "已禁用"}
                </label>
              </header>
              <p>{m.content}</p>
              <footer>
                <small>
                  来源：用户确认 ·{" "}
                  {new Date(m.updated_at || m.created_at).toLocaleDateString(
                    "zh-CN",
                  )}
                </small>
                {m.source_task_id && (
                  <Link to={`/tasks/${m.source_task_id}`}>来源任务</Link>
                )}
                <div>
                  <button
                    aria-label={`编辑记忆 ${m.content}`}
                    disabled={readonly || busy}
                    onClick={() => {
                      setEdit(m.id);
                      setAdding(false);
                      setContent(m.content);
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    aria-label={`删除记忆 ${m.content}`}
                    disabled={readonly || busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "删除这条记忆？后续执行不再召回，已有成果不受影响。",
                        )
                      )
                        void mutate("DELETE", `/v1/memories/${m.id}`);
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </footer>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
