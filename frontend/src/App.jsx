import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Check,
  CheckCircle2, ChevronDown, CircleAlert, Clock3, Code2, Copy,
  Gauge, Layers3, LoaderCircle, Plus, Play, RefreshCw, Save,
  Server, ShieldAlert, Terminal, Trash2, X, Zap
} from "lucide-react";

const initialForm = { name: "", faultDelayMs: 0, faultRate: 0, faultStatus: 0 };
const initialHistory = [];
const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const error = new Error(data?.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function jsonOptions(method, body) {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function StatusPill({ status }) {
  return <span className={`status-pill ${status >= 500 ? "danger" : status >= 400 ? "warning" : "success"}`}>{status}</span>;
}

function Field({ label, hint, children }) {
  return <label className="field"><span className="field-title">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

export default function App() {
  const [scenarios, setScenarios] = useState([]);
  const [connected, setConnected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notification, setNotification] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [selected, setSelected] = useState("");
  const [path, setPath] = useState("/get");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState(initialHistory);
  const [activeResult, setActiveResult] = useState(null);
  const [tab, setTab] = useState("overview");

  const notify = (message, type = "success") => setNotification({ message, type });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api("/scenarios");
      if (!Array.isArray(data)) throw new Error("Unexpected API response");
      setScenarios(data);
      setConnected(true);
    } catch (error) {
      setConnected(false);
      notify(`Backend unavailable: ${error.message}`, "error");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!notification) return;
    const id = setTimeout(() => setNotification(null), 4500);
    return () => clearTimeout(id);
  }, [notification]);

  const stats = useMemo(() => {
    const count = history.length;
    const failed = history.filter(x => x.status >= 400 || x.status === 0).length;
    const avg = count ? Math.round(history.reduce((sum, x) => sum + x.ms, 0) / count) : 0;
    return { count, failed, avg, rate: count ? Math.round((failed / count) * 100) : 0 };
  }, [history]);

  const openCreate = () => { setEditing(null); setForm({ ...initialForm }); setFormOpen(true); };
  const openEdit = (scenario) => { setEditing(scenario.name); setForm({ ...scenario }); setFormOpen(true); };
  const updateForm = (key, value) => setForm(previous => ({ ...previous, [key]: value }));

  async function saveScenario(event) {
    event.preventDefault();
    const name = form.name.trim();
    const config = {
      faultDelayMs: Number(form.faultDelayMs),
      faultRate: Number(form.faultRate),
      faultStatus: Number(form.faultStatus)
    };
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) return notify("Use 1–64 letters, numbers, hyphens or underscores for the name.", "error");
    if (!Number.isInteger(config.faultDelayMs) || config.faultDelayMs < 0 || config.faultDelayMs > 5000) return notify("Delay must be an integer between 0 and 5000.", "error");
    if (!Number.isFinite(config.faultRate) || config.faultRate < 0 || config.faultRate > 1) return notify("Failure rate must be between 0 and 1.", "error");
    if (config.faultStatus !== 0 && (!Number.isInteger(config.faultStatus) || config.faultStatus < 400 || config.faultStatus > 599)) return notify("Forced status must be 0 or 400–599.", "error");
    setBusy(true);
    try {
      if (editing) await api(`/scenarios/${encodeURIComponent(editing)}`, jsonOptions("PUT", config));
      else await api("/scenarios", jsonOptions("POST", { name, ...config }));
      await refresh();
      setFormOpen(false);
      setSelected(name);
      notify(editing ? "Scenario updated" : "Scenario created");
    } catch (error) { notify(error.message, "error"); }
    finally { setBusy(false); }
  }

  async function deleteScenario(name) {
    if (!window.confirm(`Delete scenario “${name}”?`)) return;
    try {
      await api(`/scenarios/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (selected === name) setSelected("");
      await refresh();
      notify("Scenario deleted");
    } catch (error) { notify(error.message, "error"); }
  }

  async function runExperiment() {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("#")) return notify("Enter a relative path starting with / (for example /get).", "error");
    setRunning(true);
    const params = new URLSearchParams();
    if (selected) params.set("scenario", selected);
    const separator = path.includes("?") ? "&" : "?";
    const url = `/proxy${path}${selected ? separator + params.toString() : ""}`;
    const started = performance.now();
    try {
      const response = await fetch(`${API_BASE}${url}`);
      const body = await response.text();
      const result = {
        id: crypto.randomUUID(), status: response.status,
        ms: Math.round(performance.now() - started),
        path: url, scenario: selected || "None", body,
        time: new Date().toLocaleTimeString(),
        contentType: response.headers.get("content-type") || "text/plain"
      };
      setHistory(previous => [result, ...previous].slice(0, 50));
      setActiveResult(result);
      notify(`Request completed · HTTP ${response.status}`, response.ok ? "success" : "error");
    } catch (error) {
      const result = {
        id: crypto.randomUUID(), status: 0,
        ms: Math.round(performance.now() - started),
        path: url, scenario: selected || "None", body: error.message,
        time: new Date().toLocaleTimeString(), contentType: "text/plain"
      };
      setHistory(previous => [result, ...previous].slice(0, 50));
      setActiveResult(result);
      notify(`Request failed: ${error.message}`, "error");
    } finally { setRunning(false); }
  }

  function prettyBody(result) {
    if (!result) return "Run an experiment to inspect its response.";
    if (result.contentType.includes("json")) {
      try { return JSON.stringify(JSON.parse(result.body), null, 2); } catch { /* show raw body */ }
    }
    return result.body || "(empty response)";
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Activity size={22} strokeWidth={2.7} /></div><div><div className="brand-name">FAULTLINE<span className="brand-dot">.</span></div><div className="brand-subtitle">RESILIENCE CONSOLE</div></div></div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="nav">
          <button className={`nav-item ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}><Gauge size={18} /> Overview</button>
          <button className={`nav-item ${tab === "scenarios" ? "active" : ""}`} onClick={() => setTab("scenarios")}><Layers3 size={18} /> Scenarios <span className="nav-count">{scenarios.length}</span></button>
          <button className={`nav-item ${tab === "runner" ? "active" : ""}`} onClick={() => setTab("runner")}><Terminal size={18} /> Experiment runner</button>
        </nav>
        <div className="sidebar-bottom"><div className="sidebar-divider" /><div className="environment"><Server size={17} /><div><strong>Local environment</strong><small>Express · localhost:3000</small></div></div><div className={`connection ${connected === true ? "online" : connected === false ? "offline" : "pending"}`}><span className="connection-dot" />{connected === true ? "API CONNECTED" : connected === false ? "API OFFLINE" : "CHECKING API"}</div></div>
      </aside>

      <main className="main">
        <header className="topbar"><div className="breadcrumb">WORKSPACE <span>/</span> <strong>{tab === "overview" ? "OVERVIEW" : tab === "scenarios" ? "SCENARIOS" : "EXPERIMENT RUNNER"}</strong></div><div className="top-actions"><span className="top-env"><span className="env-dot" /> LOCAL</span><button className="icon-button" onClick={refresh} title="Refresh scenarios" disabled={loading}><RefreshCw size={17} className={loading ? "spin" : ""} /></button></div></header>
        <div className="content">
          {tab === "overview" && <>
            <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> SYSTEM OVERVIEW</div><h1>Break things.<br /><span>Build confidence.</span></h1><p>Inject controlled failures. Observe how your services respond.</p></div><button className="primary-button" onClick={() => setTab("runner")}><Play size={16} fill="currentColor" /> Run experiment <ArrowUpRight size={17} /></button></div>
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-top"><span>SAVED SCENARIOS</span><Layers3 size={18} /></div><div className="stat-value">{scenarios.length.toString().padStart(2, "0")}</div><div className="stat-bottom">Reusable fault configurations</div></div>
              <div className="stat-card"><div className="stat-top"><span>REQUESTS RUN</span><Activity size={18} /></div><div className="stat-value">{stats.count.toString().padStart(2, "0")}</div><div className="stat-bottom">Current browser session</div></div>
              <div className="stat-card"><div className="stat-top"><span>FAILURE RATE</span><ShieldAlert size={18} /></div><div className="stat-value">{stats.rate}<small>%</small></div><div className="stat-bottom">{stats.failed} failed requests observed</div></div>
              <div className="stat-card"><div className="stat-top"><span>AVG RESPONSE</span><Clock3 size={18} /></div><div className="stat-value">{stats.avg}<small>ms</small></div><div className="stat-bottom">Client-observed duration</div></div>
            </div>
            <div className="section-grid"><section className="panel"><div className="panel-header"><div><div className="panel-eyebrow">CONFIGURATION</div><h2>Saved scenarios</h2></div><button className="text-button" onClick={() => setTab("scenarios")}>View all <ArrowRight size={15} /></button></div><div className="panel-body">{scenarios.length ? scenarios.slice(0, 4).map(s => <div className="scenario-row" key={s.name}><div className="scenario-symbol"><Zap size={17} /></div><div className="scenario-info"><strong>{s.name}</strong><small>{s.faultDelayMs}ms delay · {Math.round(s.faultRate * 100)}% failure · {s.faultStatus || "auto"} status</small></div><button className="row-action" onClick={() => { setSelected(s.name); setTab("runner"); }}><ArrowUpRight size={18} /></button></div>) : <div className="empty-state"><Layers3 size={26} /><strong>No scenarios yet</strong><span>Create your first failure configuration.</span><button className="secondary-button" onClick={openCreate}><Plus size={15} /> New scenario</button></div>}</div></section>
              <section className="panel"><div className="panel-header"><div><div className="panel-eyebrow">EXECUTION</div><h2>Recent requests</h2></div><button className="text-button" onClick={() => setTab("runner")}>Open runner <ArrowRight size={15} /></button></div><div className="panel-body">{history.length ? history.slice(0, 4).map(h => <button className="request-row" key={h.id} onClick={() => { setActiveResult(h); setTab("runner"); }}><div className="request-icon"><ArrowUpRight size={16} /></div><div className="request-info"><strong>{h.path}</strong><small>{h.time} · {h.ms} ms</small></div>{h.status ? <StatusPill status={h.status} /> : <span className="status-pill danger">ERR</span>}</button>) : <div className="empty-state"><Terminal size={26} /><strong>No experiments yet</strong><span>Run a request to see results here.</span><button className="secondary-button" onClick={() => setTab("runner")}><Play size={15} /> Open runner</button></div>}</div></section></div>
            <div className="footer-note"><CircleAlert size={15} /> Metrics shown here are from experiments run in this browser, not system-wide traffic.</div>
          </>}

          {tab === "scenarios" && <><div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line" /> FAULT CONFIGURATION</div><h1>Scenarios<span className="heading-period">.</span></h1><p>Reusable profiles for latency and failure injection.</p></div><button className="primary-button" onClick={openCreate}><Plus size={17} /> New scenario</button></div><section className="panel full-panel"><div className="panel-header"><div><div className="panel-eyebrow">SCENARIO REGISTRY</div><h2>{scenarios.length} configurations</h2></div><button className="icon-button" onClick={refresh} title="Refresh"><RefreshCw size={17} className={loading ? "spin" : ""} /></button></div>{scenarios.length ? <div className="scenario-table-wrap"><table className="scenario-table"><thead><tr><th>NAME</th><th>DELAY</th><th>FAILURE RATE</th><th>FORCED STATUS</th><th>ACTIONS</th></tr></thead><tbody>{scenarios.map(s => <tr key={s.name}><td><span className="table-name"><Zap size={15} /> {s.name}</span></td><td>{s.faultDelayMs} ms</td><td>{Math.round(s.faultRate * 100)}%</td><td>{s.faultStatus || "—"}</td><td><div className="table-actions"><button title="Run" onClick={() => { setSelected(s.name); setTab("runner"); }}><Play size={15} /></button><button title="Edit" onClick={() => openEdit(s)}><Code2 size={15} /></button><button className="delete-action" title="Delete" onClick={() => deleteScenario(s.name)}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div> : <div className="empty-state tall"><Layers3 size={30} /><strong>Your registry is empty</strong><span>Build your first reusable failure profile.</span><button className="primary-button" onClick={openCreate}><Plus size={16} /> Create scenario</button></div>}</section></>}

          {tab === "runner" && <><div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line" /> TEST EXECUTION</div><h1>Experiment runner<span className="heading-period">.</span></h1><p>Send a request through Faultline and inspect the result.</p></div></div><div className="runner-layout"><section className="panel"><div className="panel-header"><div><div className="panel-eyebrow">REQUEST BUILDER</div><h2>Configure experiment</h2></div><span className="method-label">GET</span></div><div className="runner-form"><Field label="UPSTREAM PATH" hint="Relative path appended to your configured upstream URL"><input className="input mono" value={path} onChange={e => setPath(e.target.value)} placeholder="/get" /></Field><Field label="FAULT SCENARIO" hint="Select a saved scenario or run without injection"><div className="select-wrap"><select className="input" value={selected} onChange={e => setSelected(e.target.value)}><option value="">No scenario — normal request</option>{scenarios.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}</select><ChevronDown size={16} /></div></Field>{selected && scenarios.some(s => s.name === selected) && <div className="selected-scenario"><div className="selected-title"><Zap size={16} /> ACTIVE FAULT PROFILE</div>{(() => { const s = scenarios.find(x => x.name === selected); return <div className="profile-stats"><span><strong>{s.faultDelayMs}</strong> ms delay</span><span><strong>{Math.round(s.faultRate * 100)}%</strong> fail rate</span><span><strong>{s.faultStatus || "—"}</strong> forced status</span></div>; })()}</div>}<button className="primary-button run-button" onClick={runExperiment} disabled={running || connected === false}>{running ? <LoaderCircle size={18} className="spin" /> : <Play size={17} fill="currentColor" />}{running ? "Running experiment..." : "Send request"}<ArrowUpRight size={17} /></button></div></section><section className="panel response-panel"><div className="panel-header"><div><div className="panel-eyebrow">RESPONSE INSPECTOR</div><h2>Latest response</h2></div>{activeResult && (activeResult.status ? <StatusPill status={activeResult.status} /> : <span className="status-pill danger">ERR</span>)}</div>{activeResult ? <div className="response-content"><div className="response-meta"><span><Clock3 size={15} /> {activeResult.ms} ms</span><span>{activeResult.time}</span><button onClick={() => { navigator.clipboard?.writeText(prettyBody(activeResult)); notify("Response copied"); }} title="Copy response"><Copy size={15} /></button></div><div className="response-path">{activeResult.path}</div><pre className="response-code">{prettyBody(activeResult)}</pre></div> : <div className="empty-state response-empty"><Code2 size={30} /><strong>Awaiting a request</strong><span>Execute an experiment to inspect its HTTP response.</span></div>}</section></div><section className="panel history-panel"><div className="panel-header"><div><div className="panel-eyebrow">SESSION HISTORY</div><h2>Recent experiments</h2></div>{history.length > 0 && <button className="text-button" onClick={() => { setHistory([]); setActiveResult(null); }}>Clear history <X size={14} /></button>}</div>{history.length ? <div className="history-list">{history.map(h => <button key={h.id} className={`history-item ${activeResult?.id === h.id ? "chosen" : ""}`} onClick={() => setActiveResult(h)}><span className="history-method">GET</span><span className="history-path">{h.path}</span><span className="history-time">{h.ms} ms</span>{h.status ? <StatusPill status={h.status} /> : <span className="status-pill danger">ERR</span>}</button>)}</div> : <div className="history-empty">No requests recorded in this session.</div>}</section></>}
        </div>
      </main>

      {formOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setFormOpen(false); }}><div className="modal" role="dialog" aria-modal="true" aria-label={editing ? "Edit scenario" : "Create scenario"}><div className="modal-header"><div><div className="panel-eyebrow">FAULT PROFILE</div><h2>{editing ? "Edit scenario" : "New scenario"}</h2></div><button className="icon-button" onClick={() => setFormOpen(false)}><X size={19} /></button></div><form onSubmit={saveScenario} className="modal-form"><Field label="SCENARIO NAME"><input className="input mono" value={form.name} disabled={Boolean(editing)} onChange={e => updateForm("name", e.target.value)} placeholder="unstable-payment" required /></Field><Field label="INJECTED DELAY (MS)" hint="0–5000 milliseconds before the upstream request"><input className="input" type="number" min="0" max="5000" step="1" value={form.faultDelayMs} onChange={e => updateForm("faultDelayMs", e.target.value)} required /></Field><Field label="FAILURE PROBABILITY" hint="0 = never, 0.1 = 10%, 1 = always"><input className="input" type="number" min="0" max="1" step="0.01" value={form.faultRate} onChange={e => updateForm("faultRate", e.target.value)} required /></Field><Field label="FORCED HTTP STATUS" hint="0 disables forced status; 400–599 injects that status on every request"><input className="input" type="number" min="0" max="599" step="1" value={form.faultStatus} onChange={e => updateForm("faultStatus", e.target.value)} required /></Field><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setFormOpen(false)}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}{editing ? "Save changes" : "Create scenario"}</button></div></form></div></div>}
      {notification && <div className={`toast ${notification.type}`} role="status">{notification.type === "error" ? <CircleAlert size={17} /> : <CheckCircle2 size={17} />}<span>{notification.message}</span><button onClick={() => setNotification(null)}><X size={15} /></button></div>}
    </div>
  );
}
