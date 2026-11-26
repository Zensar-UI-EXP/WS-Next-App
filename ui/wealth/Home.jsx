import { useEffect, useState } from "react";
import { getAiMonitoring, getClientReports, getDataQuality, getHouseholds, getReports } from "../api.js";
import { formatDate, formatMillions } from "../format.js";
import { ReadinessBadge, StatusPill } from "../components/Trust.jsx";
import { useCrumbs, useStudio } from "../App.jsx";

/** Studio home: what needs attention for the signed-in person. */
export default function Home() {
  const { go, role, user } = useStudio();
  const [households, setHouseholds] = useState(null);
  const [reports, setReports] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [quality, setQuality] = useState(null);
  const [ai, setAi] = useState(null);
  useCrumbs({ section: "Studio", title: "Home" });

  useEffect(() => {
    const quiet = (p, set) => p.then(set).catch(() => set([]));
    quiet(getDataQuality(false).then((d) => d.exceptions), setQuality);
    if (role === "Advisor") {
      quiet(getHouseholds(), setHouseholds);
      quiet(getClientReports(), setReports);
    } else {
      quiet(getReports(), setTemplates);
    }
    if (role === "Approver") quiet(getClientReports(), setReports);
    if (role === "Approver" || role === "Operations") getAiMonitoring().then(setAi).catch(() => {});
  }, [role]);

  const first = user.name.split(" ")[0];
  const openExceptions = (quality ?? []).filter((e) => e.status === "Open");
  const blockers = openExceptions.filter((e) => e.severity === "Blocker");

  if (role !== "Advisor") {
    const waiting = (templates ?? []).filter((t) => t.workingStatus === "Submitted");
    const inReview = (reports ?? []).filter((r) => r.status === "InReview");
    return (
      <div className="page-pad">
        <p className="eyebrow">Wealth Insights Studio</p>
        <h1 className="display">Good day, {first}</h1>
        <div className="stat-row">
          {role === "Approver" && <Stat label="Reports awaiting review" value={inReview.length} onClick={() => go("reviews")} />}
          {role !== "Operations" && <Stat label="Templates awaiting approval" value={waiting.length} onClick={() => go(role === "Approver" ? "approvals" : "templates")} />}
          {role === "Designer" && <Stat label="Released templates" value={(templates ?? []).filter((t) => t.publishedVersionNo).length} onClick={() => go("templates")} />}
          <Stat label="Open data exceptions" value={quality ? openExceptions.length : "…"} onClick={() => go("data-quality")} />
          <Stat label="Open blockers" value={quality ? blockers.length : "…"} tone={blockers.length ? "bad" : ""} onClick={() => go("data-quality")} />
          {ai && <Stat label="AI calls accepted" value={`${ai.accepted} of ${ai.calls}`} onClick={() => go("ai-monitoring")} />}
        </div>
        {role === "Approver" && inReview.length > 0 && (
          <section className="card">
            <h2>Waiting for your review</h2>
            <ul className="plain-list">
              {inReview.map((r) => (
                <li key={r.clientReportId}>
                  <button type="button" className="link-button" onClick={() => go("review-report", r.clientReportId)}>{r.templateName} · {r.clientName}</button>
                  <span className="muted small"> {r.periodLabel} · submitted by {r.submittedBy}</span> <ReadinessBadge status={r.readinessStatus} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  const upcoming = [...(households ?? [])].sort((a, b) => a.nextReviewDate.localeCompare(b.nextReviewDate));
  const mine = new Set((households ?? []).map((h) => h.name));
  const myExceptions = openExceptions.filter((e) => !e.householdName || mine.has(e.householdName));
  return (
    <div className="page-pad">
      <p className="eyebrow">Wealth Insights Studio</p>
      <h1 className="display">Good day, {first}</h1>
      <div className="stat-row">
        <Stat label="Households" value={households?.length ?? "…"} onClick={() => go("clients")} />
        <Stat label="Assets under management" value={households ? formatMillions(households.reduce((s, c) => s + c.marketValue, 0)) : "…"} />
        <Stat label="Drafts" value={(reports ?? []).filter((r) => r.status === "Draft").length} onClick={() => go("history")} />
        <Stat label="With compliance" value={(reports ?? []).filter((r) => r.status === "InReview").length} onClick={() => go("history")} />
        <Stat label="Published" value={(reports ?? []).filter((r) => r.status === "Published").length} onClick={() => go("history")} />
        <Stat label="Data exceptions on my clients" value={quality ? myExceptions.length : "…"} tone={myExceptions.some((e) => e.severity === "Blocker") ? "bad" : ""} onClick={() => go("data-quality")} />
      </div>
      <div className="home-grid">
        <section className="card">
          <h2>Upcoming reviews</h2>
          <table className="data-table">
            <tbody>
              {upcoming.map((h) => (
                <tr key={h.householdId}>
                  <td><strong>{h.name}</strong><div className="muted small">{h.segment} · {h.entities.length} entit{h.entities.length === 1 ? "y" : "ies"} · {h.accounts.length} accounts · {h.reviewFrequency}</div></td>
                  <td className="num">{formatMillions(h.marketValue)}</td>
                  <td>{formatDate(h.nextReviewDate.slice(0, 10))}</td>
                  <td className="actions">
                    <button type="button" className="link-button" onClick={() => go("analyse", h.householdId)}>Analyse</button>
                    <button type="button" className="link-button" onClick={() => go("create", h.householdId)}>Report</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn primary" onClick={() => go("create")}>Create report →</button>
        </section>
        <section className="card">
          <h2>Recent reports</h2>
          {(reports ?? []).length === 0 && <p className="muted">No reports yet.</p>}
          <ul className="plain-list">
            {(reports ?? []).slice(0, 8).map((r) => (
              <li key={r.clientReportId}>
                <button type="button" className="link-button" onClick={() => go(r.latestRun?.status === "Running" ? "preparing" : r.status === "Draft" ? "customize" : "report", r.clientReportId)}>
                  {r.templateName} · {r.clientName}
                </button>
                <span className="muted small"> {r.periodLabel} </span><StatusPill status={r.status} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, onClick, tone = "" }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={`stat ${onClick ? "clickable" : ""} ${tone}`} onClick={onClick}>
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
    </Tag>
  );
}
