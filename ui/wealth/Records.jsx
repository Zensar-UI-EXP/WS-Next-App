import { useEffect, useState } from "react";
import { errorMessage, getHouseholds } from "../api.js";
import { formatDate, formatValue } from "../format.js";
import { useCrumbs, useStudio } from "../App.jsx";

/** Records: households with their client entities and accounts (wealth managers see their own households only). */
export default function Records() {
  const { go, role } = useStudio();
  const [households, setHouseholds] = useState(null);
  const [error, setError] = useState(null);
  useCrumbs({ section: "Records", title: "Households" });
  useEffect(() => {
    getHouseholds().then(setHouseholds).catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <div className="page-pad">
      <p className="eyebrow">Client management</p>
      <h1 className="display">Households</h1>
      <p className="muted">{role === "Advisor" ? "The households you are entitled to." : "Every household."} Values are the latest valuations in US dollars.</p>
      {error && <div className="notice error">{error}</div>}
      {(households ?? []).map((h) => (
        <section key={h.householdId} className="card household">
          <div className="household-head">
            <div>
              <h2>{h.name}</h2>
              <p className="muted small">{h.segment} · relationship manager {h.relationshipManager} · {h.reviewFrequency} review, next {formatDate(h.nextReviewDate.slice(0, 10))}</p>
            </div>
            <strong className="mono big">{formatValue(h.marketValue, "currency")}</strong>
            {role === "Advisor" && (
              <div className="btn-row">
                <button type="button" className="btn small" onClick={() => go("analyse", h.householdId)}>Analyse</button>
                <button type="button" className="btn small primary" onClick={() => go("create", h.householdId)}>Create report</button>
              </div>
            )}
          </div>
          <table className="data-table">
            <thead><tr><th>Entity</th><th>Account</th><th>Currency</th><th>Benchmark</th><th>Inception</th><th>Last valuation</th><th className="num">Value (USD)</th></tr></thead>
            <tbody>
              {h.accounts.map((a) => {
                const e = h.entities.find((x) => x.clientId === a.clientId);
                return (
                  <tr key={a.code}>
                    <td><strong>{e?.name}</strong><div className="muted small">{e?.clientType} · {e?.mandate} · {e?.riskProfile}</div></td>
                    <td><span className="mono">{a.code}</span> {a.name}</td>
                    <td>{a.currency}</td>
                    <td>{a.benchmark}</td>
                    <td>{formatDate(a.inceptionDate.slice(0, 10))}</td>
                    <td>{a.lastValuation ? formatDate(a.lastValuation.slice(0, 10)) : "—"}</td>
                    <td className="num">{formatValue(a.marketValue, "currency")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
