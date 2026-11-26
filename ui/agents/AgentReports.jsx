import { useEffect, useState } from "react";
import { errorMessage, getAgentReports } from "../api.js";
import { formatDate } from "../format.js";
import { AgentMap } from "./ReportBuilder.jsx";
import { StatusPill } from "../components/Trust.jsx";
import { CoverThumb } from "../components/CoverSheet.jsx";
import { useCrumbs, useStudio } from "../App.jsx";

/** Every report the agents have prepared (or are preparing). */
export default function AgentReports() {
  const { go } = useStudio();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  useCrumbs({ section: "Agent studio", title: "Agent reports" });

  useEffect(() => {
    getAgentReports().then(setList).catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) return <div className="page-pad"><div className="notice error">{error}</div></div>;
  if (!list) return <div className="center-message">Loading…</div>;
  return (
    <div className="page-pad">
      <p className="eyebrow">Agent studio · V7</p>
      <h1 className="display">Agent reports</h1>
      <AgentMap />
      <div className="inline-row"><button type="button" className="btn primary" onClick={() => go("agent-builder")}>＋ New report</button></div>
      {list.length === 0 ? <p className="muted">No reports yet. Ask the lead agent for one.</p> : (
        <table className="data-table">
          <thead><tr><th>#</th><th>Report</th><th>Household</th><th>Period</th><th>Request</th><th>Status</th><th>Tokens</th><th /></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.agentReportId}>
                <td className="mono">{r.agentReportId}</td>
                <td>
                  <div className="report-cell">
                    <CoverThumb cover={r.cover} ctx={{ "{Report name}": r.title ?? "Report", "{Client}": r.householdName, "{Portfolio}": "", "{Period}": "" }} />
                    <span>{r.title ?? "—"}</span>
                  </div>
                </td>
                <td>{r.householdName}</td>
                <td className="small">{formatDate(r.fromDate.slice(0, 10))} – {formatDate(r.toDate.slice(0, 10))}</td>
                <td className="small muted">{r.request.length > 90 ? `${r.request.slice(0, 90)}…` : r.request}</td>
                <td>
                  <span className={`status-pill run-${r.status.toLowerCase()}`}>{r.status}</span>
                  {r.review && <><br /><StatusPill status={r.review.status} /></>}
                </td>
                <td className="small mono">{((r.inputTokens + r.outputTokens) / 1000).toFixed(0)}k</td>
                <td>
                  <button type="button" className="btn small" onClick={() => go("agent-run", r.agentReportId)}>Trace</button>
                  {r.status === "Completed" && <button type="button" className="btn small primary" onClick={() => go("agent-report", r.agentReportId)}>Open</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
