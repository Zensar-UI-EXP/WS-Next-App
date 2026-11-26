import { useEffect, useRef, useState } from "react";
import {
  errorMessage, getAiInteraction, getAiMonitoring, getAudit, getDataQuality, getMethodology, runDataQuality, updateException,
} from "../api.js";
import { formatDate } from "../format.js";
import { useCrumbs, useStudio } from "../App.jsx";

const stamp = (iso) => (iso ? `${formatDate(iso.slice(0, 10))} ${iso.slice(11, 16)}` : "—");

/** Data quality and exceptions: operations runs the checks and resolves or signs off exceptions; others can read. */
export function DataQuality() {
  const { role } = useStudio();
  const [data, setData] = useState(null);
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState(null); // { id, status, note }
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const operations = role === "Operations";
  useCrumbs({ section: "Trust & governance", title: "Data quality" });

  const load = () => getDataQuality(all).then(setData).catch((e) => setNotice({ kind: "error", text: errorMessage(e) }));
  useEffect(() => { load(); }, [all]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setBusy(true);
    try {
      const r = await runDataQuality();
      setNotice({ kind: "ok", text: `Checks run on data to ${r.asOfDate.slice(0, 10)}: ${r.newExceptions} new, ${r.reopened} reopened, ${r.cleared} cleared; ${r.openOrAcknowledged} outstanding.` });
      load();
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    try {
      await updateException(editing.id, editing.status, editing.note);
      setEditing(null);
      load();
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    }
  };

  return (
    <div className="page-pad">
      <p className="eyebrow">Trust & governance</p>
      <h1 className="display">Data quality and exceptions</h1>
      <p className="muted">Checks on the source data behind every report. An open blocker stops the affected client reports from being released;
        operations can resolve it at source or sign it off (acknowledge) with a note.</p>
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
      <div className="inline-row">
        {operations && <button type="button" className="btn primary" disabled={busy} onClick={run}>{busy ? "Running…" : "Run checks now"}</button>}
        <label className="radio"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show resolved</label>
      </div>
      {data && (
        <>
          <table className="data-table history-table">
            <thead><tr><th>Severity</th><th>Rule</th><th>Where</th><th>Date</th><th>Detail</th><th>Status</th>{operations && <th />}</tr></thead>
            <tbody>
              {data.exceptions.length === 0 && <tr><td colSpan={7} className="muted">No exceptions.</td></tr>}
              {data.exceptions.map((e) => (
                <tr key={e.exceptionId}>
                  <td><span className={`status-pill ${e.severity === "Blocker" ? "blocked" : "pending"}`}>{e.severity}</span></td>
                  <td>{e.ruleName}</td>
                  <td>{e.portfolioCode ? <><span className="mono">{e.portfolioCode}</span> · {e.householdName}</> : e.instrumentName}</td>
                  <td>{formatDate(e.asOfDate.slice(0, 10))}</td>
                  <td className="small">{e.detail}{e.note && <div className="muted">Note ({e.updatedBy}): {e.note}</div>}</td>
                  <td><span className={`status-pill ${e.status === "Resolved" ? "released" : e.status === "Acknowledged" ? "draft" : ""}`}>{e.status}</span></td>
                  {operations && (
                    <td className="actions">
                      {e.status !== "Acknowledged" && <button type="button" className="link-button" onClick={() => setEditing({ id: e.exceptionId, status: "Acknowledged", note: "" })}>Acknowledge</button>}
                      {e.status !== "Resolved" && <button type="button" className="link-button" onClick={() => setEditing({ id: e.exceptionId, status: "Resolved", note: "" })}>Resolve</button>}
                      {e.status !== "Open" && <button type="button" className="link-button" onClick={() => setEditing({ id: e.exceptionId, status: "Open", note: "" })}>Reopen</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {editing && (
            <div className="card edit-exception">
              <strong>Mark exception {editing.status.toLowerCase()}</strong>
              <textarea rows={2} value={editing.note} maxLength={1000} placeholder={editing.status === "Acknowledged" ? "Why is this acceptable for reporting?" : "What was done?"}
                onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
              <div className="btn-row">
                <button type="button" className="btn primary" disabled={editing.status !== "Open" && !editing.note.trim()} onClick={save}>Save</button>
                <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          )}
          <h2 className="section-title">Rules</h2>
          <table className="data-table history-table">
            <thead><tr><th>Rule</th><th>Severity</th><th>What it checks</th><th>Owner</th></tr></thead>
            <tbody>{data.rules.map((r) => <tr key={r.ruleCode}><td><strong>{r.name}</strong> <span className="mono muted">{r.ruleCode}</span></td><td>{r.severity}</td><td className="small">{r.description}</td><td>{r.owner}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** The append-only audit trail. */
export function AuditTrail() {
  const [rows, setRows] = useState(null);
  const [type, setType] = useState("");
  const [error, setError] = useState(null);
  useCrumbs({ section: "Trust & governance", title: "Audit trail" });
  useEffect(() => {
    getAudit({ entityType: type || undefined, take: 300 }).then(setRows).catch((e) => setError(errorMessage(e)));
  }, [type]);
  return (
    <div className="page-pad">
      <p className="eyebrow">Trust & governance</p>
      <h1 className="display">Audit trail</h1>
      <p className="muted">Every action on templates, client reports, data-quality exceptions and orchestration runs. The trail is append-only: the application cannot change or delete it.</p>
      {error && <div className="notice error">{error}</div>}
      <div className="segmented">
        {[["", "Everything"], ["ClientReport", "Client reports"], ["Template", "Templates"], ["DataQualityException", "Data quality"], ["DataQuality", "Check runs"]].map(([k, l]) => (
          <button key={k} type="button" className={type === k ? "on" : ""} onClick={() => setType(k)}>{l}</button>
        ))}
      </div>
      <table className="data-table history-table">
        <thead><tr><th>When (UTC)</th><th>Who</th><th>Role</th><th>Action</th><th>On</th><th>What</th></tr></thead>
        <tbody>
          {(rows ?? []).map((a) => (
            <tr key={a.auditId}>
              <td className="mono">{stamp(a.occurredOn)}</td><td>{a.userId}</td><td>{a.role}</td><td className="mono">{a.action}</td>
              <td>{a.entityType}{a.entityId ? ` #${a.entityId}` : ""}</td><td className="small">{a.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Responsible AI: every model call, its cost, latency and whether the deterministic checks accepted the answer. */
export function AiMonitoring() {
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const dialog = useRef(null);
  useCrumbs({ section: "Trust & governance", title: "AI monitoring" });
  useEffect(() => {
    getAiMonitoring().then(setData).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => { if (detail) dialog.current?.showModal(); }, [detail]);

  if (!data) return <div className="center-message">{error ?? "Loading…"}</div>;
  return (
    <div className="page-pad">
      <p className="eyebrow">Trust & governance</p>
      <h1 className="display">AI monitoring</h1>
      <p className="muted">Model: <strong>{data.provider} · {data.model}</strong>. The model is swappable (AI_PROVIDER); agents reach it only through one gateway that logs the exact prompt and answer.
        An answer is used only if the checks accept it: approved catalogue fields, every figure verified, no advice.</p>
      <div className="stat-row">
        <div className="stat"><span className="muted small">Calls</span><strong>{data.calls}</strong></div>
        <div className="stat"><span className="muted small">Accepted</span><strong>{data.accepted}</strong></div>
        <div className="stat"><span className="muted small">Rejected by checks</span><strong>{data.rejected}</strong></div>
        <div className="stat"><span className="muted small">Errors</span><strong>{data.errors}</strong></div>
        <div className="stat"><span className="muted small">Tokens in / out</span><strong>{data.inputTokens.toLocaleString()} / {data.outputTokens.toLocaleString()}</strong></div>
        <div className="stat"><span className="muted small">Average latency</span><strong>{(data.averageLatencyMs / 1000).toFixed(1)} s</strong></div>
      </div>
      <table className="data-table history-table">
        <thead><tr><th>When (UTC)</th><th>Agent</th><th>Purpose</th><th>Report</th><th>User</th><th>Tokens</th><th>Latency</th><th>Outcome</th><th /></tr></thead>
        <tbody>
          {data.recent.map((a) => (
            <tr key={a.interactionId}>
              <td className="mono">{stamp(a.occurredOn)}</td><td>{a.agent}</td><td className="small">{a.purpose}</td><td>{a.clientReportId ? `#${a.clientReportId}` : "—"}</td>
              <td>{a.userId}</td><td className="mono">{a.inputTokens ?? "—"} / {a.outputTokens ?? "—"}</td><td className="mono">{(a.latencyMs / 1000).toFixed(1)} s</td>
              <td><span className={`status-pill ${a.outcome === "Accepted" ? "released" : a.outcome === "Pending" ? "" : "blocked"}`}>{a.outcome}</span>{a.notes && <div className="muted small">{a.notes}</div>}</td>
              <td><button type="button" className="link-button" onClick={() => getAiInteraction(a.interactionId).then(setDetail)}>Prompt & answer</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail && (
        <dialog ref={dialog} className="dialog wide" onClose={() => setDetail(null)}>
          <header>
            <h2>{detail.agent} · #{detail.interactionId}</h2>
            <button type="button" className="btn" onClick={() => dialog.current.close()}>Close</button>
          </header>
          <p className="muted small">{detail.purpose} · {detail.model} · {detail.outcome}{detail.notes ? ` · ${detail.notes}` : ""}</p>
          <h3 className="insp-label">Prompt</h3>
          <pre className="sql prompt">{detail.prompt}</pre>
          <h3 className="insp-label">Answer</h3>
          <pre className="sql prompt">{detail.response ?? "(no answer)"}</pre>
        </dialog>
      )}
    </div>
  );
}

/** Methodology and calculation governance, data-product lineage and the disclosure library. */
export function Methodology() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useCrumbs({ section: "Trust & governance", title: "Methodology & lineage" });
  useEffect(() => {
    getMethodology().then(setData).catch((e) => setError(errorMessage(e)));
  }, []);
  if (!data) return <div className="center-message">{error ?? "Loading…"}</div>;
  const products = [...new Set(data.lineage.map((l) => l.dataProduct))];
  return (
    <div className="page-pad">
      <p className="eyebrow">Trust & governance</p>
      <h1 className="display">Methodology & lineage</h1>
      <p className="muted">Every figure in a report is one of these approved measures, calculated by the engine from a governed data product. Designers and the AI can only choose them, never change how they are calculated.</p>
      <h2 className="section-title">Approved measures</h2>
      <table className="data-table history-table">
        <thead><tr><th>Measure</th><th>Methodology</th><th>Version</th><th>Owner</th><th>Data products</th></tr></thead>
        <tbody>
          {data.measures.map((m) => (
            <tr key={m.measureKey}>
              <td><strong>{m.label}</strong><div className="mono muted">{m.measureKey}</div></td>
              <td className="small">{m.methodology}</td>
              <td>v{m.methodologyVersion}<div className="muted small">approved {formatDate(m.approvedOn.slice(0, 10))}</div></td>
              <td>{m.owner}</td>
              <td className="mono small">{m.dataProducts.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="section-title">Data-product lineage</h2>
      <div className="lineage">
        {products.map((p) => (
          <div key={p} className="card">
            <strong className="mono">{p}</strong>
            <ul className="plain-list small">
              {data.lineage.filter((l) => l.dataProduct === p).map((l) => (
                <li key={l.sourceObject}><span className="lineage-source">{l.sourceSystem}</span> <span className="mono">{l.sourceObject}</span> — {l.description}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <h2 className="section-title">Disclosure library</h2>
      <table className="data-table history-table">
        <thead><tr><th>Disclosure</th><th>Required when</th><th>Text</th><th>Version</th><th>Owner</th></tr></thead>
        <tbody>
          {data.disclosures.map((d) => (
            <tr key={d.disclosureCode}>
              <td><strong>{d.title}</strong><div className="mono muted">{d.disclosureCode}</div></td>
              <td>{d.appliesWhen}</td><td className="small">{d.text}</td><td>v{d.version}</td><td>{d.owner}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Language model: {data.ai.provider} · {data.ai.model}{data.ai.enabled ? "" : " (disabled)"}.</p>
    </div>
  );
}
