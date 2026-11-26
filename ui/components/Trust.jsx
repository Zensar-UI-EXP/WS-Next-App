import { useEffect, useState } from "react";
import { errorMessage, getRun } from "../api.js";

const STATUS_ICON = { Passed: "✓", Warning: "!", Failed: "✕", Blocker: "✕", Accepted: "✓", Running: "◌", Pending: "○", Skipped: "–" };

const seconds = (a, b) => (a && b ? `${((new Date(b) - new Date(a)) / 1000).toFixed(1)} s` : "");

/**
 * The orchestrator's trace for one run: each step (service or AI agent), its status, summary and duration.
 * Polls every 1.5 s while the run is in progress and calls onDone(run) once when it finishes.
 */
export function RunTrace({ runId, onDone, compact = false }) {
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let stop = false;
    let timer;
    const load = () => getRun(runId).then((r) => {
      if (stop) return;
      setRun(r);
      if (r.status === "Running") timer = setTimeout(load, 1500);
      else onDone?.(r);
    }).catch((e) => !stop && setError(errorMessage(e)));
    load();
    return () => { stop = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  if (error) return <div className="notice error">{error}</div>;
  if (!run) return <p className="muted">Loading the run…</p>;
  return (
    <div className={`run-trace ${compact ? "compact" : ""}`}>
      <div className="run-head">
        <span className={`status-pill run-${run.status.toLowerCase()}`}>{run.kind} run #{run.runId} · {run.status}</span>
        {run.summary && <span className="muted small">{run.summary}</span>}
      </div>
      <ol className="steps">
        {run.steps.map((s) => (
          <li key={s.stepNo} className={`trace-step st-${s.status.toLowerCase()}`}>
            <span className="trace-icon" aria-label={s.status}>{STATUS_ICON[s.status] ?? "○"}</span>
            <div>
              <div className="trace-title">
                <strong>{s.name}</strong>
                <span className={`kind ${s.kind === "Agent" ? "ai" : ""}`}>{s.kind === "Agent" ? "AI agent" : "Deterministic"}</span>
                <span className="muted small">{s.status === "Running" ? "running…" : seconds(s.startedOn, s.finishedOn)}</span>
              </div>
              {s.summary && <p className="small">{s.summary}</p>}
              {!compact && s.stepKey === "composition" && Array.isArray(s.output) && s.output.length > 0 && (
                <ul className="decisions">
                  {s.output.map((d, i) => (
                    <li key={i}><span className={`kind ${d.by === "ai" ? "ai" : ""}`}>{d.by === "ai" ? "AI" : "Rule"}</span> <strong>{d.pageTitle}</strong> · {d.action}: {d.detail}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A list of readiness checks (data readiness or release readiness). */
export function Checks({ checks }) {
  return (
    <ul className="checks">
      {checks.map((c) => (
        <li key={c.code} className={`check ch-${c.status.toLowerCase()}`}>
          <span className="trace-icon">{STATUS_ICON[c.status] ?? "○"}</span>
          <div>
            <strong>{c.label}</strong> <span className="check-status">{c.status === "Accepted" ? "accepted by operations" : c.status.toLowerCase()}</span>
            <p className="small muted">{c.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ReadinessBadge({ status }) {
  if (!status) return <span className="status-pill">Not checked</span>;
  const cls = status === "Ready" ? "released" : status === "Blocked" ? "blocked" : "pending";
  return <span className={`status-pill ${cls}`}>{status === "Warnings" ? "Ready with warnings" : status}</span>;
}

/** Material movements found by the Performance & Insight Agent. */
export function Insights({ insights }) {
  if (!insights?.insights?.length) return <p className="muted small">No material movements.</p>;
  return (
    <ul className="insights">
      {insights.insights.map((i, n) => (
        <li key={n} className={`insight sev-${i.severity}`}>
          <span className="sev">{i.severity}</span>
          <div><strong>{i.title}</strong><p className="small">{i.detail}</p></div>
        </li>
      ))}
    </ul>
  );
}

export const STATUS_LABEL = { Draft: "Draft", InReview: "In review", Published: "Published" };
export function StatusPill({ status }) {
  const cls = status === "Published" ? "released" : status === "InReview" ? "pending" : "draft";
  return <span className={`status-pill ${cls}`}>{STATUS_LABEL[status] ?? status}</span>;
}
