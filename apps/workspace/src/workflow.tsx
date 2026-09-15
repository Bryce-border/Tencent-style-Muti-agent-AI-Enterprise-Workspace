import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, GitBranch, LoaderCircle, Maximize2, Minus, Plus, X } from "lucide-react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "./components/ui/button";
import { buildWorkflow, eventNames, stateNames, type FlowNode } from "./workflow-model";
import type { Event, Task } from "./types";
import "./workflow.css";

const WIDTH = 248, HEIGHT = 132, GAP_X = 64, GAP_Y = 44, PAD = 24;
const position = (node: FlowNode) => ({ x: PAD + node.column * (WIDTH + GAP_X), y: PAD + node.row * (HEIGHT + GAP_Y) });
function display(value: unknown) { return typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value, null, 2); }
function time(value?: string) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未记录"; }
function duration(node: FlowNode, now: number) {
  if (node.status === "running" && node.events[0]) return `${Math.max(0, (now - Date.parse(node.events[0].created_at)) / 1000).toFixed(0)} 秒（进行中）`;
  if (node.events.length < 2 || !node.events.some(e => e.type.endsWith(".started"))) return "未记录完整起止时间";
  const seconds = Math.max(0, (Date.parse(node.events.at(-1)!.created_at) - Date.parse(node.events[0].created_at)) / 1000);
  return `${seconds.toFixed(1)} 秒${node.status === "running" ? "（已记录区间）" : ""}`;
}
function SafeOutput({ value }: { value: unknown }) {
  return <div className="markdown flow-output"><ReactMarkdown remarkPlugins={[remarkGfm]}>{display(value)}</ReactMarkdown></div>;
}

export function Workflow({ task, events, error, loading }: { task: Task; events: Event[]; error?: string; loading: boolean }) {
  const [attempt, setAttempt] = useState<number | undefined>();
  const graph = useMemo(() => buildWorkflow(task, events, attempt), [task, events, attempt]);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const lastButton = useRef<HTMLButtonElement | null>(null);
  const id = useId().replace(/:/g, "");
  const node = graph.nodes.find(n => n.id === selected);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (node?.status !== "running") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [node?.id, node?.status]);
  const width = graph.columns * (WIDTH + GAP_X) - GAP_X + PAD * 2;
  const height = graph.rows * (HEIGHT + GAP_Y) - GAP_Y + PAD * 2;
  const running = graph.nodes.filter(n => n.status === "running");
  const done = graph.nodes.filter(n => n.status === "done").length;
  useEffect(() => { setSelected(null); setAttempt(undefined); setZoom(1); }, [task.task_id]);
  useEffect(() => { if (selected) panel.current?.focus({ preventScroll: true }); }, [selected]);
  useEffect(() => {
    const target = graph.nodes.find(n => n.id === selected);
    if (!target || !viewport.current) return;
    const p = position(target);
    viewport.current.scrollTo({ left: Math.max(0, p.x * zoom - viewport.current.clientWidth / 2 + WIDTH * zoom / 2), top: Math.max(0, p.y * zoom - 24) });
  }, [selected, zoom, expanded, graph.columns, graph.rows]);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);
  function focusActive() {
    const target = running[0] || graph.nodes.filter(n => n.status === "warning").at(-1) || graph.nodes.find(n => n.status === "waiting") || graph.nodes.at(-1);
    if (!target || !viewport.current) return;
    const p = position(target);
    viewport.current.scrollTo({ left: p.x * zoom - viewport.current.clientWidth / 2 + WIDTH * zoom / 2, top: p.y * zoom, behavior: "smooth" });
    setSelected(target.id);
  }
  return <section className={`workflow ${expanded ? "workflow-expanded" : ""}`} aria-label="动态协作流程">
    <header className="flow-header">
      <div><h2><GitBranch size={19} />动态协作流程</h2><p>点击节点查看目标、前置成果、输出与执行记录</p></div>
      <div className="flow-tools">
        <select aria-label="执行轮次" value={attempt === undefined ? "latest" : attempt} onChange={e => { setAttempt(e.target.value === "latest" ? undefined : Number(e.target.value)); setSelected(null); }}>
          <option value="latest">最新执行 · 第 {graph.attempts.length} 轮</option>
          {graph.attempts.slice(0, -1).map((a, i) => <option key={a.start} value={i}>{a.label} · 历史</option>)}
        </select>
        <Button variant="outline" onClick={focusActive}>定位当前节点</Button>
        <Button variant="outline" onClick={() => { setSelected(null); setZoom(Math.max(.2, Math.min(1, (viewport.current?.clientWidth || width) / width))); viewport.current?.scrollTo(0, 0); }}>查看全图</Button>
        <Button variant="outline" aria-label={expanded ? "收起流程图" : "展开流程图"} onClick={() => setExpanded(!expanded)}>{expanded ? <X size={16} /> : <Maximize2 size={16} />}</Button>
      </div>
    </header>
    <div className="flow-summary" role="status">
      <span className={running.length ? "flow-live" : ""}>{running.length ? `${running.length} 个节点执行中` : task.status === "PENDING" && graph.latest ? "任务排队中" : graph.latest ? "已同步执行记录" : "查看历史执行"}</span>
      <span>{done} / {graph.nodes.length} 个节点完成</span>
      <span>箭头表示输入依赖 · 同列节点可并行</span>
    </div>
    {loading && !events.length && <p role="status">正在加载协作事件…</p>}
    {error && <p role="alert">协作记录同步失败：{error}。当前显示最近一次记录。</p>}
    <div className="flow-workbench">
      <div className="flow-canvas-area">
        <div className="flow-viewport" ref={viewport} tabIndex={0} aria-label="流程图画布，可横向滚动查看所有节点">
          <div style={{ width: width * zoom, height: height * zoom }}>
            <div className="flow-scene" style={{ width, height, transform: `scale(${zoom})` }}>
              <svg className="flow-edges" width={width} height={height} aria-hidden="true">
                <defs><marker id={`arrow-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>
                {graph.nodes.flatMap(target => target.depends.map(sourceId => {
                  const source = graph.nodes.find(n => n.id === sourceId);
                  if (!source) return null;
                  const a = position(source), b = position(target), x1 = a.x + WIDTH, x2 = b.x, y1 = a.y + HEIGHT / 2, y2 = b.y + HEIGHT / 2;
                  const active = target.status === "running";
                  const label = target.id === "sys:revision" ? "需修订" : target.id === "sys:human" ? "转人工" : target.id === "sys:recheck" ? "复核" : target.id === "sys:archive" ? "通过后" : "";
                  return <g key={`${source.id}-${target.id}`}><path className={`flow-edge ${active ? "active" : ""} ${selected === target.id || selected === source.id ? "highlight" : ""}`}
                    d={`M${x1},${y1} C${x1 + GAP_X / 2},${y1} ${x2 - GAP_X / 2},${y2} ${x2},${y2}`} markerEnd={`url(#arrow-${id})`} />{label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 9} textAnchor="middle" className="flow-edge-label">{label}</text>}</g>;
                }))}
              </svg>
              {graph.nodes.map((item, index) => {
                const p = position(item);
                return <button key={item.id} className={`flow-node flow-${item.status} ${selected === item.id ? "selected" : ""}`} style={{ left: p.x, top: p.y, width: WIDTH, height: HEIGHT }}
                  aria-label={`${item.title}，${stateNames[item.status]}`} aria-pressed={selected === item.id} aria-controls={`detail-${id}`}
                  onClick={e => { lastButton.current = e.currentTarget; setSelected(item.id); }}>
                  <span className="flow-node-top"><span className="flow-node-number">{String(index + 1).padStart(2, "0")}</span><span className="flow-node-state">{item.status === "running" ? <LoaderCircle size={13} className="spin" /> : item.status === "done" ? <Check size={13} /> : <span className="flow-dot" />}{stateNames[item.status]}</span></span>
                  <strong title={item.title}>{item.title}</strong><span className="flow-owner">{item.owner}<ChevronRight size={14} /></span>
                </button>;
              })}
            </div>
          </div>
        </div>
        <div className="flow-canvas-footer"><div className="flow-legend">{(["running", "done", "warning", "failed", "waiting", "cancelled", "skipped"] as const).map(s => <span key={s} className={`flow-${s}`}><i />{stateNames[s]}</span>)}</div>
          <div className="flow-zoom"><button aria-label="缩小流程图" disabled={zoom <= .2} onClick={() => setZoom(z => Math.max(.2, z - .1))}><Minus size={15} /></button><button onClick={() => setZoom(1)} title="恢复原始比例">{Math.round(zoom * 100)}%</button><button aria-label="放大流程图" disabled={zoom >= 1.4} onClick={() => setZoom(z => Math.min(1.4, z + .1))}><Plus size={15} /></button></div>
        </div>
      </div>
      {node && <div className="flow-detail" id={`detail-${id}`} ref={panel} tabIndex={-1} aria-label="节点详情">
        <div className="flow-detail-heading"><span>节点详情</span><button aria-label="关闭节点详情" onClick={() => { setSelected(null); lastButton.current?.focus(); }}><X size={17} /></button></div>
        <h3>{node.title}</h3><p className={`flow-detail-status flow-${node.status}`}>{stateNames[node.status]} · {node.owner}</p>
        <dl><div><dt>节点标识</dt><dd>{node.stepId || node.id.replace("sys:", "")}</dd></div><div><dt>首次记录</dt><dd>{time(node.events[0]?.created_at)}</dd></div><div><dt>最近记录</dt><dd>{time(node.events.at(-1)?.created_at)}</dd></div><div><dt>记录耗时</dt><dd>{duration(node, now)}</dd></div></dl>
        <h4>执行目标</h4><p>{node.objective}</p>{node.note && <p className="flow-note">{node.note}</p>}
        <h4>输入与依赖</h4><details><summary>用户工作目标</summary><p>{task.prompt}</p></details>
        {node.depends.map(dep => { const input = graph.nodes.find(n => n.id === dep); return input && <div className="flow-input" key={dep}><button onClick={() => setSelected(dep)}>{input.title}<ChevronRight size={13} /></button>{input.output !== undefined && <details><summary>查看前置成果</summary><SafeOutput value={input.output} /></details>}</div>; })}
        <h4>节点输出</h4>{node.output !== undefined ? <SafeOutput value={node.output} /> : <p className="muted">{node.status === "running" ? "节点正在执行，完成后显示成果。" : "尚无已记录输出。"}</p>}
        <h4>执行记录 · {node.events.length}</h4>{!node.events.length && <p className="muted">未收到该节点的独立事件记录。</p>}
        <ol className="flow-event-list">{node.events.map((event, i) => <li key={`${event.created_at}-${i}`}><strong>{eventNames[event.type] || event.type}</strong><time>{time(event.created_at)}</time>
          {["message", "feedback", "reason", "decision", "count", "round", "error"].map(key => event.payload[key] !== undefined && <p key={key}><span>{{ message: "说明", feedback: "审核意见", reason: "原因", decision: "决定", count: "候选数量", round: "审核轮次", error: "异常" }[key]}：</span>{display(event.payload[key])}</p>)}
        </li>)}</ol>
        {node.id === "sys:archive" && node.status === "done" && <Button asChild><Link to={`/reports/${encodeURIComponent(task.task_id)}`}>查看归档报告</Link></Button>}
      </div>}
    </div>
  </section>;
}
