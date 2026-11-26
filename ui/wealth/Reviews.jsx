import { useEffect, useMemo, useState } from "react";
import {
  approveClientReport, errorMessage, getClientReport, getClientReports, getReportTrail, returnClientReport, runClientReport,
} from "../api.js";
import ReportView from "../components/ReportView.jsx";
import { Checks, Insights, ReadinessBadge, RunTrace, StatusPill } from "../components/Trust.jsx";
import { formatDate } from "../format.js";
import { ORIGINS, placeholderContext } from "../rules.js";
import { useCrumbs, useStudio } from "../App.jsx";

const stamp = (iso) => (iso ? `${formatDate(iso.slice(0, 10))} ${iso.slice(11, 16)}` : "—");

/** Compliance: client reports waiting for review, and recently published ones. */
export function ReviewQueue() {
  const { go } = useStudio();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  useCrumbs({ section: "Review & publish", title: "Report reviews" });
  useEffect(() => {
    getClientReports().then(setList).catch((e) => setError(errorMessage(e)));
  }, []);

  const waiting = (list ?? []).filter((r) => r.status === "InReview");
  const published = (list ?? []).filter((r) => r.status === "Published");
  const Table = ({ rows, empty }) => (rows.length === 0 ? <p className="muted">{empty}</p> : (
    <table className="data-table history-table">
      <thead><tr><th>Report</th><th>Household</th><th>Covers</th><th>Period</th><th>Readiness</th><th>Wealth manager</th><th>Submitted</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.clientReportId}>
            <td><strong>{r.templateName}</strong> <StatusPill status={r.status} /></td>
            <td>{r.householdName}</td><td>{r.subjectLabel}</td><td>{r.periodLabel}</td>
            <td><ReadinessBadge status={r.readinessStatus} /></td>
            <td>{r.createdBy}</td><td>{stamp(r.submittedOn)}</td>
            <td className="actions"><button type="button" className="link-button" onClick={() => go("review-report", r.clientReportId)}>{r.status === "InReview" ? "Review" : "Open"}</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  ));

  return (
    <div className="page-pad">
      <p className="eyebrow">Review & publish</p>
      <h1 className="display">Report reviews</h1>
      <p className="muted">Each report passed the release-readiness checks when it was submitted; they run again when you approve. You cannot review a report you created or submitted.</p>
      {error && <div className="notice error">{error}</div>}
      <h2 className="section-title">Waiting for review</h2>
      <Table rows={waiting} empty="Nothing is waiting for review." />
      <h2 className="section-title">Published</h2>
      <Table rows={published} empty="No reports published yet." />
    </div>
  );
}

/** One client report under review: the pages with AI provenance, readiness, insights and the full trail; approve or return. */
export function ReportReview({ reportId }) {
  const { go, user } = useStudio();
  const [detail, setDetail] = useState(null);
  const [results, setResults] = useState(null);
  const [trail, setTrail] = useState(null);
  const [tab, setTab] = useState("Readiness");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  useCrumbs({ back: { label: "Report reviews", to: "reviews" }, section: "Review & publish", title: detail ? `Review — ${detail.templateName}` : "Review" });

  const load = () => Promise.all([getClientReport(reportId), runClientReport(reportId, null, null), getReportTrail(reportId)])
    .then(([d, r, t]) => { setDetail(d); setResults(r); setTrail(t); })
    .catch((e) => setNotice({ kind: "error", text: errorMessage(e) }));
  useEffect(() => { load(); }, [reportId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = useMemo(() => detail && placeholderContext({
    params: detail.parameters, clientName: detail.clientName, subjectLabel: detail.subjectLabel, relationshipManager: detail.context?.relationshipManager, periodLabel: detail.periodLabel, reportName: detail.templateName,
  }), [detail]);

  if (!detail) return <div className="center-message">{notice?.text ?? "Loading…"}</div>;
  const ownReport = detail.createdBy === user.userId || detail.submittedBy === user.userId;
  const aiBlocks = detail.definition.pages.filter((p) => p.included).flatMap((p) => p.blocks.filter((b) => ORIGINS[b.origin]?.ai).map((b) => ({ page: p.title, origin: b.origin })));
  const decide = async (approve) => {
    setBusy(true);
    try {
      const d = approve ? await approveClientReport(reportId, comment) : await returnClientReport(reportId, comment);
      setNotice({ kind: "ok", text: approve ? "Published: the client can now read this report." : "Returned to the wealth manager with your comment." });
      setDetail(d);
      getReportTrail(reportId).then(setTrail);
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="review">
      <div className="review-head">
        <h1 className="display small">{detail.templateName} · {detail.clientName}</h1>
        <StatusPill status={detail.status} />
        <span className="muted">{detail.subjectLabel} · {detail.periodLabel} · prepared by {detail.createdBy}</span>
      </div>
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
      <div className="review-grid wide">
        <aside className="panel">
          <h2 className="panel-title">Decision</h2>
          <div className="panel-body">
            {detail.status === "InReview" ? (
              ownReport ? <p className="notice error">Segregation of duties: you created or submitted this report, so another reviewer must decide.</p> : (
                <>
                  <label className="field">
                    <span>Comment (required when returning)</span>
                    <textarea rows={3} value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
                  </label>
                  <div className="decision-buttons">
                    <button type="button" className="btn primary" disabled={busy} onClick={() => decide(true)}>Approve and publish</button>
                    <button type="button" className="btn danger" disabled={busy || !comment.trim()} onClick={() => decide(false)}>Return to wealth manager</button>
                  </div>
                </>
              )
            ) : (
              <p className="muted small">{detail.status === "Published" ? `Published ${stamp(detail.publishedOn)} by ${detail.reviewedBy}.` : "Not in review."}</p>
            )}
            <div className="inline-row"><strong>Release readiness</strong> <ReadinessBadge status={detail.readiness?.status} /></div>
            <p className="small"><strong>AI-written text:</strong> {aiBlocks.length === 0 ? "none" : `${aiBlocks.length} block(s) on ${[...new Set(aiBlocks.map((b) => b.page))].join(", ")}`} (marked ✦ AI on the pages).</p>
            <div className="tabs" role="tablist">
              {["Readiness", "Insights", "Audit", "AI calls", "Runs"].map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>
              ))}
            </div>
            {tab === "Readiness" && (detail.readiness ? <Checks checks={detail.readiness.checks} /> : <p className="muted">Not checked.</p>)}
            {tab === "Insights" && <Insights insights={detail.insights} />}
            {tab === "Audit" && (
              <ul className="audit-list">
                {(trail?.audit ?? []).map((a) => <li key={a.auditId}><span className="mono">{stamp(a.occurredOn)}</span> <strong>{a.userId}</strong> {a.summary}</li>)}
              </ul>
            )}
            {tab === "AI calls" && (
              <ul className="audit-list">
                {(trail?.ai ?? []).length === 0 && <li className="muted">No AI calls.</li>}
                {(trail?.ai ?? []).map((a) => (
                  <li key={a.interactionId}><span className={`status-pill ${a.outcome === "Accepted" ? "released" : "blocked"}`}>{a.outcome}</span> <strong>{a.agent}</strong> {a.purpose}
                    <div className="muted small">{a.model} · {a.inputTokens ?? "?"} in / {a.outputTokens ?? "?"} out · {(a.latencyMs / 1000).toFixed(1)} s{a.notes ? ` · ${a.notes}` : ""}</div></li>
                ))}
              </ul>
            )}
            {tab === "Runs" && (trail?.runs ?? []).map((r) => <RunTrace key={r.runId} runId={r.runId} compact />)}
          </div>
        </aside>
        <section className="panel">
          <h2 className="panel-title">The report as the client will see it</h2>
          {results ? <ReportView definition={detail.definition} results={results} ctx={ctx} showProvenance /> : <p className="center-message">Running…</p>}
        </section>
      </div>
      {detail.status === "Published" && <button type="button" className="btn" onClick={() => go("reviews")}>Back to reviews</button>}
    </div>
  );
}
