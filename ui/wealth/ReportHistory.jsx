import { useEffect, useState } from "react";
import { errorMessage, getClientReports } from "../api.js";
import { formatDate } from "../format.js";
import { ReadinessBadge, StatusPill } from "../components/Trust.jsx";
import { useCrumbs, useStudio } from "../App.jsx";

const when = (iso) => (iso ? formatDate(iso.slice(0, 10)) : "—");

/** The wealth manager's client reports (their households only), or the client's published reports. */
export default function ReportHistory() {
  const { go, role } = useStudio();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const client = role === "Client";
  useCrumbs({ section: "Report", title: client ? "My reports" : "Report history" });

  useEffect(() => {
    getClientReports().then(setList).catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <div className="page-pad">
      <p className="eyebrow">{client ? "Your documents" : "Client reporting"}</p>
      <h1 className="display">{client ? "My reports" : "Report history"}</h1>
      {error && <div className="notice error">{error}</div>}
      {list && list.length === 0 && (
        <p className="muted">{client ? "No reports have been published for you yet." : "No reports yet. Use Create report to make one."}</p>
      )}
      {list && list.length > 0 && (
        <table className="data-table history-table">
          <thead>
            <tr>
              <th>Report</th>
              <th>Household</th>
              <th>Covers</th>
              <th>Period</th>
              <th>Status</th>
              {!client && <th>Readiness</th>}
              <th>{client ? "Published" : "Updated"}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const running = r.latestRun?.status === "Running";
              return (
                <tr key={r.clientReportId}>
                  <td><strong>{r.templateName}</strong> <span className="muted">v{r.versionNo}</span></td>
                  <td>{r.householdName}</td>
                  <td>{r.subjectLabel}</td>
                  <td>{r.periodLabel}</td>
                  <td><StatusPill status={r.status} />{running && <span className="status-pill pending">Preparing…</span>}</td>
                  {!client && <td><ReadinessBadge status={r.readinessStatus} /></td>}
                  <td>{when(client ? r.publishedOn : r.updatedOn)}</td>
                  <td className="actions">
                    <button type="button" className="link-button" onClick={() => go(running ? "preparing" : "report", r.clientReportId)}>{running ? "Follow" : "View"}</button>
                    {!client && r.status === "Draft" && !running && <button type="button" className="link-button" onClick={() => go("customize", r.clientReportId)}>Customize</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
