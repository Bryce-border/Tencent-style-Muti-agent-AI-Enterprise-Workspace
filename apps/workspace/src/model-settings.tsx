import { useEffect, useState, type FormEvent } from "react";
import { Save, PlugZap, RotateCcw, LoaderCircle } from "lucide-react";
import { api, useResource } from "./api";
import { useSession } from "./auth";
import { Button } from "./components/ui/button";

interface Configuration {
  source: "workspace" | "environment";
  model?: string;
  base_url?: string;
  temperature?: number;
  max_tokens?: number;
  has_key: boolean;
  editable: boolean;
  allowed_hosts: string[];
  revision?: number;
}

export function ModelSettings() {
  const resource = useResource<Configuration>("/v1/model-settings");
  const session = useSession();
  const [model, setModel] = useState("");
  const [base, setBase] = useState("");
  const [key, setKey] = useState("");
  const [temperature, setTemperature] = useState(0.2);
  const [tokens, setTokens] = useState(1800);
  const [inheritKey, setInheritKey] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const value = resource.data;
    if (!value) return;
    setModel(value.model || "qwen3.7-flash"); setBase(value.base_url || "");
    setTemperature(value.temperature ?? 0.2); setTokens(value.max_tokens ?? 1800);
    setKey(""); setInheritKey(value.source === "environment" && value.has_key);
  }, [resource.data]);
  const editable = session.role === "ADMIN" && resource.data?.editable;
  const payload = { model, base_url: base, api_key: key, temperature, max_tokens: tokens, use_environment_key: inheritKey };
  async function act(action: "save" | "test" | "reset") {
    if (busy || !editable) return;
    setBusy(action); setMessage(""); setError("");
    try {
      if (action === "test") {
        const value = await api<{ latency_ms: number }>("/v1/model-settings/test", { method: "POST", body: JSON.stringify(payload) });
        setMessage(`连接成功 · ${value.latency_ms} ms`);
      } else {
        await api("/v1/model-settings", { method: action === "save" ? "PUT" : "DELETE", ...(action === "save" ? { body: JSON.stringify(payload) } : {}) });
        setKey(""); resource.reload();
        setMessage(action === "save" ? "已保存，新任务将使用此配置" : "已恢复部署默认配置");
      }
    } catch (e) { setError(String(e)); } finally { setBusy(""); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void act("save"); }
  return <section className="section model-settings">
    <div className="section-heading"><h2>模型与 API</h2><span className="small-badge">{resource.data?.source === "workspace" ? "空间配置" : "部署默认"}</span></div>
    {resource.loading ? <p role="status">加载中</p> : resource.error ? <p role="alert">{resource.error}</p> : <form className="work-form" onSubmit={submit}>
      <fieldset disabled={!editable || !!busy} className="model-fields">
        <label htmlFor="model-name">模型名称</label>
        <input id="model-name" list="model-options" value={model} onChange={e => setModel(e.target.value)} required maxLength={150} />
        <datalist id="model-options">{["qwen3.7-flash", "kimi-k3", "qwen3.8-27b"].map(name => <option value={name} key={name} />)}</datalist>
        <label htmlFor="model-base">API 地址</label>
        <input id="model-base" type="url" value={base} onChange={e => { setBase(e.target.value); setKey(""); setInheritKey(false); }} required maxLength={500} list="api-options" />
        <datalist id="api-options">{resource.data?.allowed_hosts.map(host => <option key={host} value={`https://${host}${host.includes("aliyuncs") ? "/compatible-mode" : ""}/v1`} />)}</datalist>
        <label htmlFor="model-key">API 密钥 · {resource.data?.has_key ? "已配置" : "未配置"}</label>
        <input id="model-key" type="password" autoComplete="new-password" value={key} onChange={e => setKey(e.target.value)} placeholder={resource.data?.source === "workspace" ? "留空保留现有密钥" : "输入 API 密钥"} maxLength={4096} />
        {resource.data?.source === "environment" && resource.data.has_key && <label className="model-checkbox"><input type="checkbox" checked={inheritKey} onChange={e => setInheritKey(e.target.checked)} disabled={base !== resource.data.base_url} />使用当前部署密钥</label>}
        <div className="model-numbers"><label>温度<input type="number" min="0" max="2" step="0.1" value={temperature} onChange={e => setTemperature(Number(e.target.value))} disabled={model.toLowerCase().startsWith("kimi-k3")} required /></label>
          <label>最大输出 Token<input type="number" min="128" max="16384" step="1" value={tokens} onChange={e => setTokens(Number(e.target.value))} required /></label></div>
      </fieldset>
      {editable && <div className="model-actions">
        <Button type="button" variant="outline" disabled={!!busy} onClick={() => void act("test")}><PlugZap size={16} />测试连接</Button>
        <Button type="submit" disabled={!!busy}>{busy === "save" ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}保存</Button>
        <Button type="button" variant="outline" title="恢复部署默认配置" disabled={!!busy || resource.data?.source !== "workspace"} onClick={() => void act("reset")}><RotateCcw size={16} />恢复默认</Button>
      </div>}
      {busy === "test" && <p role="status">正在测试连接</p>}
      {message && <p role="status">{message}</p>}{error && <p role="alert" className="error">{error}</p>}
      {!resource.data?.editable && <p role="status">模型配置暂不可用</p>}
    </form>}
  </section>;
}
