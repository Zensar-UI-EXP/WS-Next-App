import { useEffect, useMemo, useState } from "react";
import { changeAgentReport, errorMessage, submitAgentReport, getAgentFigures, getAgentReport, runAgentReport, saveReusableDefinition } from "../api.js";
import ReportView from "../components/ReportView.jsx";
import { StatusPill } from "../components/Trust.jsx";
import { placeholderContext } from "../rules.js";
import { formatDate } from "../format.js";
import { useCrumbs, useStudio } from "../App.jsx";
import { CHANGE_LABELS, Versions } from "./AgentRun.jsx";

/**
 * Report output: the finished report with its figures, as-of date and data status. From here the wealth manager can ask
 * the agents for a change, customize the report by hand, or save it as a reusable definition; every change is a new version.
 */
export default function ReportPage({ reportId }) {
  const { go } = useStudio();
  const [r, setR] = useState(null);
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [panel, setPanel] = useState(null); // change, reuse, figures
  useCrumbs({ back: { label: "Agent trace", to: "agent-run", id: reportId }, section: "Agent studio", title: r?.title ?? "Report" });

  useEffect(() => {
    getAgentReport(reportId).then((d) => { setR(d); return runAgentReport(reportId); }).then(setRun).catch((e) => setError(errorMessage(e)));
  }, [reportId]);

  const ctx = useMemo(() => r && placeholderContext({
    params: { householdId: r.householdId, clientId: r.clientId, portfolioCode: r.portfolioCode, fromDate: r.fromDate.slice(0, 10), toDate: r.toDate.slice(0, 10) },
    clientName: r.clientName, subjectLabel: r.subjectLabel, reportName: r.title, relationshipManager: r.relationshipManager,
    periodLabel: `${formatDate(r.fromDate.slice(0, 10), "long")} – ${formatDate(r.toDate.slice(0, 10), "long")}`,
  }), [r]);

  if (error) return <div className="page-pad"><div className="notice error">{error}</div></div>;
  if (!r || !run) return <div className="center-message">Calculating the charts and tables…</div>;
  const latest = r.versions.at(-1)?.agentReportId === r.agentReportId;
  const published = run.results.filter((x) => x.source === "published").length;
  const toggle = (p) => setPanel(panel === p ? null : p);

  return (
    <div className="final">
      <div className="final-bar no-print">
        <div>
          <p className="eyebrow">Version {r.version} · {CHANGE_LABELS[r.changeKind]} · figures from the Reporting API</p>
          <h1 className="display small">{r.title}</h1>
          <p className="muted">{r.subjectLabel}</p>
        </div>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => go("agent-run", reportId)}>See how it was made</button>
          <button type="button" className="btn" onClick={() => window.print()}>Print / save as PDF</button>
        </div>
      </div>

      <div className="report-status no-print">
        <div><span className="rs-label">As of</span><strong>{formatDate(run.dataStatus.asOfDate, "long")}</strong></div>
        <div><span className="rs-label">Data status</span><strong className={`rs-status st-${run.dataStatus.status.toLowerCase()}`}>{run.dataStatus.status}</strong>
          <span className="small muted">{run.dataStatus.periodCovered}</span></div>
        <div><span className="rs-label">Period</span><strong>{run.period.label}</strong><span className="small muted">{run.period.kind === "custom" ? "custom dates" : "standard period"}</span></div>
        <div><span className="rs-label">Charts and tables</span><strong>{published} published · {run.results.length - published} calculated</strong>
          <button type="button" className="link-button small" onClick={() => toggle("figures")}>{r.factCount} verified figures</button></div>
      </div>
      {run.dataStatus.checks.some((c) => c.status !== "Passed") && (
        <div className="notice no-print small">
          {run.dataStatus.checks.filter((c) => c.status !== "Passed").map((c) => <div key={c.check}><strong>{c.check}:</strong> {c.detail}</div>)}
        </div>
      )}

      <div className="report-actions no-print">
        <Versions r={r} current={r.agentReportId} onOpen={(id) => go("agent-report", id)} />
        {latest ? (
          <div className="btn-row">
            <button type="button" className={`btn ${panel === "change" ? "primary" : ""}`} onClick={() => toggle("change")}>✦ Ask the agents to change it</button>
            <button type="button" className="btn" onClick={() => go("agent-customize", r.agentReportId)}>✐ Customize report</button>
            <button type="button" className={`btn ${panel === "reuse" ? "primary" : ""}`} onClick={() => toggle("reuse")}>Save as reusable definition</button>
            <Review r={r} onOpen={(id) => go("report", id)} onDraft={(id) => go("customize", id)} />
          </div>
        ) : <p className="small muted">This is an earlier version. Open the latest version to change it.</p>}
      </div>

      {panel === "change" && <ChangePanel r={r} onDone={(id) => go("agent-run", id)} />}
      {panel === "reuse" && <ReusePanel r={r} onDone={() => setPanel(null)} />}
      {panel === "figures" && <FiguresPanel reportId={reportId} />}
      <ReportView definition={run.definition} results={run.results} ctx={ctx} showProvenance />
    </div>
  );
}

const CHANGE_EXAMPLES = [
  "Add a chart of the allocation by asset class to the overview page.",
  "Make it shorter: drop the costs page and keep the letter to one paragraph.",
  "Add a page on risk: volatility, maximum drawdown and how they compare with the benchmark.",
];

function ChangePanel({ r, onDone }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async () => {
    setBusy(true);
    try { onDone((await changeAgentReport(r.agentReportId, text)).agentReportId); } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  return (
    <section className="card change-panel no-print">
      <h2>Ask the agents to change it</h2>
      <p className="small muted">The lead agent reads the current report and the findings, delegates the change, and returns version {r.versions.length + 1}.
        New figures come from the Reporting API and are checked the same way.</p>
      {error && <div className="notice error">{error}</div>}
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="What should change?" aria-label="What should change?" maxLength={2000} />
      <div className="chip-row">{CHANGE_EXAMPLES.map((x) => <button key={x} type="button" className="btn small" onClick={() => setText(x)}>{x.split(":")[0].split(".")[0]}</button>)}</div>
      <div className="btn-row"><button type="button" className="btn primary" disabled={busy || text.trim().length < 5} onClick={send}>{busy ? "Sending…" : "Send to the lead agent →"}</button></div>
    </section>
  );
}

function ReusePanel({ r, onDone }) {
  const [name, setName] = useState(r.title ?? "");
  const [description, setDescription] = useState(r.request.slice(0, 300));
  const [state, setState] = useState(null);
  const save = async () => {
    setState("saving");
    try { await saveReusableDefinition(r.agentReportId, { name, description }); setState("saved"); setTimeout(onDone, 1200); } catch (e) { setState(errorMessage(e)); }
  };
  return (
    <section className="card no-print">
      <h2>Save as a reusable definition</h2>
      <p className="small muted">The pages, charts and tables are saved; the text is kept as an example of the wording. Wealth managers can start a new
        report from it, and the reporting agent can find it in Knowledge &amp; rules.</p>
      <label className="small">Name <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></label>
      <label className="small">When to use it <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} /></label>
      {state && state !== "saving" && state !== "saved" && <div className="notice error">{state}</div>}
      <div className="btn-row"><button type="button" className="btn primary" disabled={state === "saving" || name.trim().length < 3 || description.trim().length < 5} onClick={save}>
        {state === "saved" ? "Saved ✓" : "Save"}</button></div>
    </section>
  );
}

function FiguresPanel({ reportId }) {
  const [facts, setFacts] = useState(null);
  const [q, setQ] = useState("");
  useEffect(() => { getAgentFigures(reportId).then(setFacts).catch(() => setFacts([])); }, [reportId]);
  if (!facts) return <section className="card no-print"><p className="muted">Loading…</p></section>;
  const unique = [...new Map(facts.map((f) => [`${f.label}|${f.text}`, f])).values()];
  const shown = unique.filter((f) => !q || f.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="card figures-panel no-print">
      <div className="inline-row">
        <h2>Verified figures</h2>
        <input className="search" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter figures" />
      </div>
      <p className="small muted">Every figure the Reporting API returned for this report. Text may only quote these.</p>
      <table className="data-table">
        <thead><tr><th>Figure</th><th>Value</th><th>Source</th></tr></thead>
        <tbody>
          {shown.slice(0, 400).map((f, i) => (
            <tr key={i}><td className="small">{f.label}</td><td className="mono small">{f.text}</td>
              <td><span className={`source-badge inline src-${f.source ?? "calculated"}`}>{f.source ?? "calculated"}</span></td></tr>
          ))}
        </tbody>
      </table>
      {shown.length > 400 && <p className="small muted">{shown.length - 400} more; filter to narrow.</p>}
    </section>
  );
}

/**
 * Compliance: a finished agent report becomes a V4 client report and goes through the same release checks, review,
 * approval and publishing. Once sent, the review copy is the one that changes (in the V4 editor) if compliance returns it.
 */
function Review({ r, onOpen, onDraft }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(r.review);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await submitAgentReport(r.agentReportId);
      setSent({ clientReportId: out.clientReportId, status: "InReview" });
    } catch (e) {
      setError(errorMessage(e));
      getAgentReport(r.agentReportId).then((d) => setSent(d.review)).catch(() => {});
    }
    setBusy(false);
  };
  if (sent && sent.status !== "Draft") {
    return (
      <span className="review-state">
        <StatusPill status={sent.status} />
        <button type="button" className="btn primary" onClick={() => onOpen(sent.clientReportId)}>Open review copy →</button>
      </span>
    );
  }
  return (
    <span className="review-state">
      <button type="button" className="btn primary" disabled={busy} onClick={send}>{busy ? "Running the release checks…" : "Send to compliance review →"}</button>
      {sent && <button type="button" className="btn" onClick={() => onDraft(sent.clientReportId)}>Fix the review draft</button>}
      {sent?.reviewComment && <span className="small">Returned by {sent.reviewedBy}: “{sent.reviewComment}”</span>}
      {error && <span className="notice error small pre-line">{error}</span>}
    </span>
  );
}

