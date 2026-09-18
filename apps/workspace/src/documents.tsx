import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Archive,
  FileDown,
  FileText,
  LoaderCircle,
  RefreshCw,
  Upload,
} from "lucide-react";
import { api, useResource } from "./api";
import { useSession } from "./auth";
import { Button } from "./components/ui/button";

type DocumentRow = {
  id: string;
  title: string;
  latest_version: number;
  active_version: number;
  archived: boolean;
  filename?: string;
  byte_size?: number;
  status: string;
  chunk_count?: number;
  error?: string;
};
type DocumentDetail = DocumentRow & {
  versions: Array<{
    version: number;
    filename: string;
    byte_size: number;
    status: string;
    extracted_text?: string;
    chunk_count: number;
    error?: string;
  }>;
};
const statusNames: Record<string, string> = {
  PENDING: "等待入库",
  INDEXING: "正在解析与索引",
  READY: "已入库",
  FAILED: "处理失败",
};
export function Documents() {
  const session = useSession();
  const [searchParams] = useSearchParams();
  const requestedId = searchParams.get("id");
  const docs = useResource<DocumentRow[]>("/v1/documents", 4000);
  const file = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<DocumentDetail | null>(null);
  const [versionFor, setVersionFor] = useState<string | undefined>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!requestedId) return;
    let stopped = false;
    api<DocumentDetail>(`/v1/documents/${encodeURIComponent(requestedId)}`)
      .then(value => { if (!stopped) setSelected(value); })
      .catch(e => { if (!stopped) setError(String(e)); });
    return () => { stopped = true; };
  }, [requestedId]);
  useEffect(() => {
    if (!selected) return;
    let stopped = false;
    const row = docs.data?.find(item => item.id === selected.id);
    if (row && (row.status !== selected.status || row.active_version !== selected.active_version || row.latest_version !== selected.latest_version)) {
      api<DocumentDetail>(`/v1/documents/${selected.id}`).then(value => { if (!stopped) setSelected(value); }).catch(e => { if (!stopped) setError(String(e)); });
    }
    return () => { stopped = true; };
  }, [docs.data, selected]);
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.files?.[0];
    const id = versionFor;
    event.target.value = "";
    setVersionFor(undefined);
    if (!value || busy || session.role === "VIEWER") return;
    setBusy("upload");
    setError("");
    const form = new FormData();
    form.append("file", value);
    try {
      const result = await api<DocumentDetail>(
        id ? `/v1/documents/${id}/versions` : "/v1/documents",
        { method: "POST", body: form },
      );
      setSelected(result);
      docs.reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  async function action(id: string, action: "retry" | "archive" | "restore") {
    setBusy(id + action);
    setError("");
    try {
      await api(
        `/v1/documents/${id}/${action === "retry" ? "retry" : "archive"}`,
        {
          method: "POST",
          ...(action !== "retry"
            ? { body: JSON.stringify({ archived: action === "archive" }) }
            : {}),
        },
      );
      docs.reload();
      if (selected?.id === id)
        setSelected(await api<DocumentDetail>(`/v1/documents/${id}`));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  async function detail(id: string) {
    try {
      setSelected(await api<DocumentDetail>(`/v1/documents/${id}`));
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>我的知识文件</h1>
          <p>上传、解析和管理工作空间资料</p>
          <small>支持 TXT、Markdown、CSV、PDF、DOCX、XLSX，单文件不超过 5 MB。</small>
        </div>
        <Button
          disabled={session.role === "VIEWER" || !!busy}
          onClick={() => {
            setVersionFor(undefined);
            file.current?.click();
          }}
        >
          <Upload size={16} />
          上传文档
        </Button>
        <input
          ref={file}
          hidden
          type="file"
          accept=".txt,.md,.csv,.pdf,.docx,.xlsx"
          onChange={(e) => void upload(e)}
        />
      </div>
      <label className="gui-file-search"><input aria-label="搜索知识文件" placeholder="按文件名搜索…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {busy === "upload" && <p role="status">正在保存原文件，稍后自动解析入库…</p>}
      {docs.error && <p role="alert">{docs.error}</p>}
      {docs.loading ? (
        <LoaderCircle className="spin" aria-label="加载文档" />
      ) : !docs.data?.length ? (
        <p>暂无文档，上传后会自动解析并建立检索索引。</p>
      ) : (
        <div className="document-list">
          {docs.data.filter(doc=>`${doc.title} ${doc.filename}`.toLowerCase().includes(query.toLowerCase())).map((doc) => (
            <article className="document-row" key={doc.id}>
              <FileText size={21} />
              <div className="document-main">
                <button
                  className="document-title"
                  onClick={() => void detail(doc.id)}
                >
                  {doc.title}
                </button>
                <small>
                  {doc.filename} · v{doc.latest_version} ·{" "}
                  {doc.byte_size ? `${Math.ceil(doc.byte_size / 1024)} KB` : ""}
                  {doc.status === "READY" ? ` · ${doc.chunk_count ?? 0} 个知识分块` : ""}
                </small>
              </div>
              <span className="small-badge">
                {doc.archived
                  ? "已归档"
                  : statusNames[doc.status] || doc.status}
              </span>
              <div className="document-actions">
                {doc.status === "FAILED" && !doc.archived && session.role !== "VIEWER" && (
                  <Button
                    variant="outline"
                    title="重试入库"
                    disabled={!!busy}
                    onClick={() => void action(doc.id, "retry")}
                  >
                    <RefreshCw size={15} />
                  </Button>
                )}
                {["READY", "FAILED"].includes(doc.status) && session.role !== "VIEWER" && (
                  <>
                    <Button
                      variant="outline"
                      title="上传新版本"
                      disabled={!!busy || doc.archived}
                      onClick={() => {
                        setVersionFor(doc.id);
                        file.current?.click();
                      }}
                    >
                      <Upload size={15} />
                    </Button>
                    <Button
                      variant="outline"
                      title={doc.archived ? "恢复文档" : "归档文档"}
                      disabled={!!busy}
                      onClick={() =>
                        void action(
                          doc.id,
                          doc.archived ? "restore" : "archive",
                        )
                      }
                    >
                      <Archive size={15} />
                    </Button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {selected && (
        <div className="document-preview">
          <div className="section-heading">
            <h2>{selected.title}</h2>
            <Button variant="outline" onClick={() => setSelected(null)}>
              关闭
            </Button>
          </div>
          <p>
            {selected.archived
              ? "此文档已归档，不参与新检索。"
              : `当前版本 v${selected.active_version || selected.latest_version} · ${statusNames[selected.status] || selected.status}`}
          </p>
          {selected.versions.map((v) => (
            <details
              key={v.version}
              open={v.version === selected.active_version || (v.version === selected.latest_version && v.status === "FAILED")}
            >
              <summary>
                版本 {v.version} · {v.filename} ·{" "}
                {statusNames[v.status] || v.status}
                <a
                  className="document-download"
                  href={`/v1/documents/${selected.id}/versions/${v.version}/download`}
                  title="下载原文件"
                >
                  <FileDown size={15} />
                </a>
              </summary>
              <p className="gui-document-meta">{Math.ceil(v.byte_size/1024)} KB · {v.chunk_count} 个索引分块 · {v.status === "READY" ? "解析与索引已完成" : statusNames[v.status] || v.status}</p>
              {v.error ? (
                <p className="error">{v.error}</p>
              ) : (
                v.extracted_text && <pre>{v.extracted_text}</pre>
              )}
            </details>
          ))}
        </div>
      )}
    </>
  );
}
