import { useEffect, useState } from "react";
import { errorMessage, getClientReport } from "../api.js";
import { Checks, Insights, ReadinessBadge, RunTrace } from "../components/Trust.jsx";
import { useCrumbs, useStudio } from "../App.jsx";

/** The report orchestrator at work on a new report: each step as it runs, then the readiness and insights it produced. */
export default function Preparing({ reportId }) {
  const { go, guide } = useStudio();
  const [detail, setDetail] = useState(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  useCrumbs({ back: { label: "Create report", to: "create" }, section: "Report", title: "Preparing the report" });

  useEffect(() => {
    getClientReport(reportId).then(setDetail).catch((e) => setError(errorMessage(e)));
  }, [reportId]);

  const finished = () => getClientReport(reportId).then((d) => { setDetail(d); setDone(true); }).catch((e) => setError(errorMessage(e)));

  if (error) return <div className="page-pad"><div className="notice error">{error}</div></div>;
  if (!detail) return <div className="center-message">Loading…</div>;
  const run = detail.latestRun;
  return (
    <div className="page-pad preparing">
      <p className="eyebrow">Report orchestrator</p>
      <h1 className="display">{detail.templateName}</h1>
      <p className="muted">{detail.householdName} · {detail.subjectLabel} · {detail.periodLabel}</p>
      {guide && (
        <p className="guide">
          Workflows orchestrate, engines calculate, AI drafts and explains, people approve. Deterministic services check the client context and data,
          the performance engine calculates every figure, and two AI agents draft the commentary and choose modules. Every figure the AI writes is
          checked against the governed data before it is accepted.
        </p>
      )}
      <div className="two-col">
        <section className="card">
          <h2>What the studio is doing</h2>
          {run ? <RunTrace runId={run.runId} onDone={finished} /> : <p className="muted">No run found.</p>}
        </section>
        <section className="card">
          <h2>Result</h2>
          {!done && run?.status === "Running" ? (
            <p className="muted">The steps run in order; this usually takes under a minute.</p>
          ) : (
            <>
              <div className="inline-row"><strong>Release readiness</strong> <ReadinessBadge status={detail.readiness?.status} /></div>
              {detail.readiness && <Checks checks={detail.readiness.checks.filter((c) => c.status !== "Passed")} />}
              {detail.readiness?.checks.every((c) => c.status === "Passed") && <p className="small muted">All release checks passed.</p>}
              <h3 className="insp-label">Material movements</h3>
              <Insights insights={detail.insights} />
              <button type="button" className="btn primary" onClick={() => go("customize", reportId)}>Review and customise the report →</button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
