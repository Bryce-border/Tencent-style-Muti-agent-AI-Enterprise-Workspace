import { useState, type FormEvent } from "react";
import { FileText } from "lucide-react";
import { Button } from "../../components/ui/button";
import { api } from "../../api";
import type { OutputDraft } from "./contracts";

export function PreviewCard({ draft }: { draft: OutputDraft }) {
  return (
    <div className="gui-preview-card">
      <header>
        <FileText size={19} />
        <strong>预计输出</strong>
        <span>待你确认</span>
      </header>
      <dl>
        <div>
          <dt>文档类型</dt>
          <dd>{draft.output_type}</dd>
        </div>
        <div>
          <dt>目标篇幅</dt>
          <dd>{draft.length}</dd>
        </div>
        <div>
          <dt>输出格式</dt>
          <dd>{draft.format}</dd>
        </div>
        <div>
          <dt>写作风格</dt>
          <dd>{draft.style}</dd>
        </div>
        <div>
          <dt>生成方式</dt>
          <dd>{draft.generation_mode === "chapters" ? "逐章生成 · 一致性审核" : "整体生成"}</dd>
        </div>
      </dl>
      <h3>包含内容</h3>
      <ol>
        {draft.sections.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      {draft.notes && <p className="gui-preview-note">{draft.notes}</p>}
    </div>
  );
}
export function PreviewEditor({
  draft,
  revision,
  id,
  onCancel,
  onSaved,
}: {
  draft: OutputDraft;
  revision: number;
  id: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(draft);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/v1/conversations/${id}/preview`, {
        method: "PUT",
        body: JSON.stringify({ ...form, revision }),
      });
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="gui-preview-editor" onSubmit={save}>
      <h3>修改预计输出</h3>
      {(
        [
          ["title", "成果标题"],
          ["output_type", "文档类型"],
          ["length", "目标篇幅"],
          ["style", "写作风格"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            required
            maxLength={120}
            value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          />
        </label>
      ))}
      <label>
        生成方式
        <select value={form.generation_mode || "single"} onChange={(e) => setForm({ ...form, generation_mode: e.target.value as "single" | "chapters" })}>
          <option value="single">整体生成 · 适合简短工作</option>
          <option value="chapters">逐章生成 · 适合多章节文档</option>
        </select>
      </label>
      <label>
        章节结构（每行一节，最多10节）
        <textarea
          required
          rows={5}
          value={form.sections.join("\n")}
          onChange={(e) =>
            setForm({ ...form, sections: e.target.value.split("\n") })
          }
        />
      </label>
      <label>
        额外要求
        <textarea
          rows={2}
          maxLength={600}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </label>
      <small>当前交付格式为 Markdown。逐章生成会使用共享事实和术语，逐章保存并审核；目标篇幅受每次模型输出上限影响。</small>
      {error && (
        <p role="alert" className="gui-error">
          {error}
        </p>
      )}
      <div>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button disabled={busy}>保存方案</Button>
      </div>
    </form>
  );
}
