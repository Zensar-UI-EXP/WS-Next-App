import { useEffect, useMemo, useState } from "react";
import { errorMessage, getClientReport, runClientReport } from "../api.js";
import ReportView from "../components/ReportView.jsx";
import { StatusPill } from "../components/Trust.jsx";
import { placeholderContext } from "../rules.js";
import { useCrumbs, useStudio } from "../App.jsx";

/** The generated report, page after page, ready to print or save as PDF. Clients see this view only. */
export default function FinalReport({ reportId }) {
  const { go, role } = useStudio();
  const [detail, setDetail] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  useCrumbs({
    back: role === "Client" ? { label: "My reports", to: "history" } : { label: "Report history", to: "history" },
    section: "Report", title: detail ? `${detail.templateName} · ${detail.clientName ?? ""}` : "Report",
  });

  useEffect(() => {
    getClientReport(reportId)
      .then((d) => {
        setDetail(d);
        return runClientReport(reportId, null, null);
      })
      .then(setResults)
      .catch((e) => setError(errorMessage(e)));
  }, [reportId]);

  const ctx = useMemo(() => detail && placeholderContext({
    params: detail.parameters, clientName: detail.clientName, subjectLabel: detail.subjectLabel, relationshipManager: detail.context?.relationshipManager,
    periodLabel: detail.periodLabel, reportName: detail.templateName,
  }), [detail]);

  if (error) return <div className="notice error">{error}</div>;
  if (!detail || !results) return <div className="center-message">Preparing the report…</div>;

  return (
    <div className="final">
      <div className="final-bar no-print">
        <div>
          <p className="eyebrow"><StatusPill status={detail.status} /> {detail.status === "Published" && detail.publishedOn ? `Published ${detail.publishedOn.slice(0, 10)} · approved by ${detail.reviewedBy}` : ""}</p>
          <h1 className="display small">{detail.templateName}</h1>
          <p className="muted">{detail.householdName} · {detail.subjectLabel} · {detail.periodLabel}</p>
        </div>
        <div className="btn-row">
          {role === "Advisor" && <button type="button" className="btn" onClick={() => go("customize", reportId)}>{detail.status === "Draft" ? "Edit pages" : "Open in studio"}</button>}
          <button type="button" className="btn primary" onClick={() => window.print()}>Print / save as PDF</button>
        </div>
      </div>
      <ReportView definition={detail.definition} results={results} ctx={ctx} showProvenance={role !== "Client"} />
    </div>
  );
}
