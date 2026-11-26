import { useEffect, useMemo, useState } from "react";
import { errorMessage, getAgentReport } from "../api.js";
import { formatDate } from "../format.js";
import { useCrumbs, useStudio } from "../App.jsx";

const AGENT_CLASS = { "Lead agent": "lead", "Performance agent": "perf", "Reporting agent": "rep", "Wealth manager": "user" };
const KIND_ICON = { start: "▶", message: "✎", tool: "⚙", tool_error: "✕", finish: "✓", error: "!", edit: "✐" };
export const CHANGE_LABELS = { new: "New report", agents: "Changed by the agents", manual: "Edited by hand" };

/** The agents at work: every message, tool call and Reporting API call as it happens, then the findings and the report. */
export default function AgentRun({ reportId }) {
  const { go } = useStudio();
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  useCrumbs({ back: { label: "Agent reports", to: "agent-reports" }, section: "Agent studio", title: r?.title ?? "Agents at work" });

  useEffect(() => {
    let stop = false, timer;
    const load = () => getAgentReport(reportId).then((d) => {
      if (stop) return;
      setR(d);
      if (d.status === "Queued" || d.status === "Running") timer = setTimeout(load, 2000);
    }).catch((e) => !stop && setError(errorMessage(e)));
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, [reportId]);

  if (error) return <div className="page-pad"><div className="notice error">{error}</div></div>;
  if (!r) return <div className="center-message">Loading…</div>;
  const running = r.status === "Queued" || r.status === "Running";
  const events = r.events.filter((e) => filter === "all" || e.agent === filter);
  const toolCalls = r.events.filter((e) => e.kind === "tool" || e.kind === "tool_error").length;

  return (
    <div className="page-pad agent-run">
      <p className="eyebrow">Agent studio · report #{r.rootId ?? r.agentReportId} · version {r.version} · {CHANGE_LABELS[r.changeKind]}</p>
      <h1 className="display">{r.title ?? "Preparing your report"}</h1>
      <p className="muted">
        {r.subjectLabel} · {formatDate(r.fromDate.slice(0, 10), "long")} – {formatDate(r.toDate.slice(0, 10), "long")}
        {r.periodKey === "CUSTOM" ? " (custom period)" : ""}{r.startFromName ? ` · started from “${r.startFromName}”` : ""}
      </p>
      <blockquote className="agent-request">{r.changeKind === "new" ? "" : "Change: "}“{r.request}”</blockquote>
      <Versions r={r} current={r.agentReportId} onOpen={(id) => go("agent-run", id)} />

      <div className="two-col">
        <section className="card">
          <div className="inline-row">
            <h2>What the agents are doing</h2>
            <span className={`status-pill run-${r.status.toLowerCase()}`}>{r.status}</span>
          </div>
          <div className="segmented">
            {["all", "Lead agent", "Performance agent", "Reporting agent", "api"].map((a) => (
              <button key={a} type="button" className={filter === a ? "on" : ""} onClick={() => setFilter(a)}>
                {a === "all" ? "All" : a === "api" ? `Reporting API (${r.apiCalls.length})` : a}
              </button>
            ))}
          </div>
          {filter === "api" ? <ApiCalls calls={r.apiCalls} /> : (
            <ol className="agent-trace">
              {events.map((e) => <TraceItem key={e.eventId} e={e} />)}
              {running && <li className="trace-wait muted small">Working…</li>}
            </ol>
          )}
        </section>

        <section className="card">
          <h2>Result</h2>
          <p className="small muted">
            {r.events.filter((e) => e.kind === "message").length} model turns · {toolCalls} tool calls · {r.apiCalls.length} Reporting API calls ·
            {" "}{r.factCount} verified figures ({r.publishedFacts} published) · {(r.inputTokens / 1000).toFixed(0)}k in / {(r.outputTokens / 1000).toFixed(1)}k out tokens
          </p>
          {running && <p className="muted">The lead agent is working with the specialists. This page updates by itself.</p>}
          {r.summary && <div className={`notice ${r.status === "Failed" ? "error" : ""}`}><strong>{r.changeKind === "manual" ? "Edit:" : "Lead agent:"}</strong> {r.summary}</div>}
          {r.findings && <Findings f={r.findings} />}
          {r.definition && (
            <div className="inline-row">
              <span className="small muted">{r.definition.pages.length} pages: {r.definition.pages.map((p) => p.title).join(" · ")}</span>
            </div>
          )}
          {r.definition && r.status === "Completed" && (
            <button type="button" className="btn primary" onClick={() => go("agent-report", r.agentReportId)}>Open the report →</button>
          )}
        </section>
      </div>
    </div>
  );
}

/** Every version of the report: new, changed by the agents, or edited by hand. */
export function Versions({ r, current, onOpen }) {
  if (r.versions.length < 2) return null;
  return (
    <div className="versions">
      <span className="small muted">Versions:</span>
      {r.versions.map((v) => (
        <button key={v.agentReportId} type="button" className={`version-chip ${v.agentReportId === current ? "on" : ""} st-${v.status.toLowerCase()}`}
          title={`${CHANGE_LABELS[v.changeKind]}: ${v.request}`} onClick={() => onOpen(v.agentReportId)}>
          v{v.version} · {CHANGE_LABELS[v.changeKind]}{v.status !== "Completed" ? ` (${v.status.toLowerCase()})` : ""}
        </button>
      ))}
    </div>
  );
}

function ApiCalls({ calls }) {
  if (!calls.length) return <p className="muted small">No Reporting API calls yet.</p>;
  return (
    <table className="data-table api-calls">
      <thead><tr><th>Caller</th><th>Endpoint</th><th>Source</th><th>What</th><th>Figures</th><th>ms</th></tr></thead>
      <tbody>
        {calls.map((c) => (
          <tr key={c.callId} className={c.allowed ? "" : "denied"}>
            <td className="small">{c.agent ?? "Front end"}<br /><span className="muted">as {c.userId}</span></td>
            <td className="mono small">{c.endpoint}</td>
            <td>{c.source ? <span className={`source-badge inline src-${c.source}`}>{c.source}</span> : c.allowed ? "" : <span className="source-badge inline src-denied">denied</span>}</td>
            <td className="small">{c.detail}</td>
            <td className="small mono">{c.figureCount ?? ""}</td>
            <td className="small mono">{c.durationMs}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TraceItem({ e }) {
  const [open, setOpen] = useState(false);
  const detail = useMemo(() => {
    if (!e.detail) return null;
    try { return JSON.stringify(JSON.parse(e.detail), null, 2); } catch { return e.detail; }
  }, [e.detail]);
  return (
    <li className={`agent-event ${AGENT_CLASS[e.agent] ?? ""} k-${e.kind}`}>
      <span className="ae-icon" aria-hidden="true">{KIND_ICON[e.kind] ?? "•"}</span>
      <div>
        <div className="ae-head">
          <span className={`ae-agent ${AGENT_CLASS[e.agent] ?? ""}`}>{e.agent}</span>
          <span className="ae-title">{e.title}</span>
          {e.outputTokens != null && <span className="muted small">{e.outputTokens} tok</span>}
          {detail && <button type="button" className="link-button small" onClick={() => setOpen(!open)}>{open ? "Hide" : "Details"}</button>}
        </div>
        {open && <pre className="ae-detail">{detail}</pre>}
      </div>
    </li>
  );
}

export function Findings({ f }) {
  return (
    <div className="findings">
      <h3 className="insp-label">Performance agent's findings · as of {f.asOfDate}</h3>
      <p>{f.summary}</p>
      <ul className="insights">
        {f.findings.map((x, i) => (
          <li key={i} className={`insight sev-${x.significance}`}>
            <span className="sev">{x.significance}</span>
            <div><strong>{x.headline}</strong><p className="small">{x.detail}</p></div>
          </li>
        ))}
      </ul>
      <p className="small muted"><strong>Data status:</strong> {f.dataStatus}</p>
      <p className="small muted"><strong>Coverage:</strong> {f.coverage}</p>
    </div>
  );
}
