import { useEffect, useMemo, useState } from "react";
import { errorMessage, getAnalysis, getHouseholds } from "../api.js";
import ReportView from "../components/ReportView.jsx";
import { Checks, Insights } from "../components/Trust.jsx";
import { formatDate } from "../format.js";
import { conditionLabel, placeholderContext } from "../rules.js";
import { useCrumbs, useStudio } from "../App.jsx";

const PERIODS = [["FY", "Full year"], ["H1", "H1"], ["H2", "H2"], ["Q1", "Q1"], ["Q2", "Q2"], ["Q3", "Q3"], ["Q4", "Q4"], ["SI", "Since inception"]];

/**
 * Analyse portfolio: the household (or one entity or account) for a period, live from the data products: client
 * context, data readiness, the governed figures and the material movements the Performance & Insight Agent finds.
 */
export default function Analyse({ householdId: initial }) {
  const { go, guide } = useStudio();
  const [households, setHouseholds] = useState(null);
  const [householdId, setHouseholdId] = useState(initial ?? null);
  const [clientId, setClientId] = useState("");
  const [portfolioCode, setPortfolioCode] = useState("");
  const [year, setYear] = useState(2026);
  const [periodKey, setPeriodKey] = useState("FY");
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useCrumbs({ section: "Analyse", title: "Analyse portfolio" });

  useEffect(() => {
    getHouseholds().then((h) => {
      setHouseholds(h);
      setHouseholdId((id) => id ?? h[0]?.householdId);
    }).catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    if (!householdId) return;
    setBusy(true);
    setError(null);
    getAnalysis(householdId, { year, periodKey, clientId: clientId || undefined, portfolioCode: portfolioCode || undefined })
      .then(setAnalysis)
      .catch((e) => { setAnalysis(null); setError(errorMessage(e)); })
      .finally(() => setBusy(false));
  }, [householdId, clientId, portfolioCode, year, periodKey]);

  const household = households?.find((h) => h.householdId === Number(householdId));
  const accounts = (household?.accounts ?? []).filter((a) => !clientId || a.clientId === Number(clientId));
  const ctx = useMemo(() => analysis && placeholderContext({
    params: { fromDate: analysis.fromDate.slice(0, 10), toDate: analysis.toDate.slice(0, 10) },
    clientName: analysis.context.clientName, subjectLabel: analysis.context.subjectLabel, periodLabel: analysis.periodLabel, reportName: "Portfolio analysis",
  }), [analysis]);

  if (!households) return <div className="center-message">{error ?? "Loading…"}</div>;
  return (
    <div className="page-pad analyse">
      <p className="eyebrow">Analyse portfolio</p>
      <h1 className="display">{analysis?.context.subjectLabel ?? household?.name ?? "Analyse"}</h1>
      <div className="inline-row">
        <select className="select" value={householdId ?? ""} onChange={(e) => { setHouseholdId(e.target.value); setClientId(""); setPortfolioCode(""); }} aria-label="Household">
          {households.map((h) => <option key={h.householdId} value={h.householdId}>{h.name}</option>)}
        </select>
        <select className="select" value={clientId} onChange={(e) => { setClientId(e.target.value); setPortfolioCode(""); }} aria-label="Entity">
          <option value="">All entities</option>
          {household?.entities.map((e) => <option key={e.clientId} value={e.clientId}>{e.name}</option>)}
        </select>
        <select className="select" value={portfolioCode} onChange={(e) => setPortfolioCode(e.target.value)} aria-label="Account">
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.code} value={a.code}>{a.name} ({a.code}, {a.currency})</option>)}
        </select>
        <div className="segmented">
          {[2026, 2025, 2024, 2023].map((y) => <button key={y} type="button" className={year === y ? "on" : ""} onClick={() => setYear(y)}>{y}</button>)}
        </div>
        <div className="segmented">
          {PERIODS.map(([k, l]) => <button key={k} type="button" className={periodKey === k ? "on" : ""} onClick={() => setPeriodKey(k)}>{l}</button>)}
        </div>
        {busy && <span className="muted small">Calculating…</span>}
      </div>
      {error && <div className="notice error">{error}</div>}
      {guide && <p className="guide">Every figure comes from the governed data products; the movements are found by fixed rules (no AI). Nothing here is saved.</p>}

      {analysis && (
        <>
          <div className="analysis-grid">
            <section className="card">
              <h2>Client context</h2>
              <p className="small">{analysis.periodLabel} · {formatDate(analysis.fromDate.slice(0, 10), "long")} – {formatDate(analysis.toDate.slice(0, 10), "long")}</p>
              <ul className="plain-list small">
                {analysis.context.entities.map((e) => <li key={e.clientId}><strong>{e.name}</strong> · {e.clientType} · {e.mandate} · {e.riskProfile}</li>)}
              </ul>
              <p className="small muted">{analysis.context.accounts.length} account(s) in {analysis.context.currencies.join(", ")}</p>
              <div className="chip-row">
                {analysis.context.conditions.map((c) => <span key={c} className="status-pill">{conditionLabel(c)}</span>)}
              </div>
            </section>
            <section className="card">
              <h2>Data readiness</h2>
              <Checks checks={analysis.readiness.checks} />
            </section>
            <section className="card">
              <h2>Material movements</h2>
              <Insights insights={analysis.insights} />
              <button type="button" className="btn primary" onClick={() => go("create", Number(householdId))}>Create a report →</button>
            </section>
          </div>
          <ReportView definition={analysis.definition} results={analysis.results} ctx={ctx} />
        </>
      )}
    </div>
  );
}
