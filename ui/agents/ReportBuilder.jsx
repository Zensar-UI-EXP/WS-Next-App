import { useEffect, useMemo, useState } from "react";
import { createAgentReport, errorMessage, getHouseholds, getReusableDefinitions } from "../api.js";
import { formatDate, formatMillions } from "../format.js";
import { PERIODS, resolvePeriod } from "../wealth/CreateReport.jsx";
import { useCrumbs, useStudio } from "../App.jsx";

const EXAMPLES = [
  "Annual review for the whole family: how the portfolio did against its benchmark, which accounts helped or held it back, and the costs paid. Warm and concise.",
  "A short one-page performance summary I can send before our meeting.",
  "Explain the currency effect on the non-USD accounts and how the structured products change the real equity exposure.",
  "Quarterly update focused on risk: volatility, drawdown and how the allocation moved.",
];

/** Report builder (front end): the user's selections and request go to the lead agent. */
export default function ReportBuilder() {
  const { go, guide } = useStudio();
  const [households, setHouseholds] = useState(null);
  const [householdId, setHouseholdId] = useState(null);
  const [entityId, setEntityId] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const [year, setYear] = useState(2025);
  const [periodKey, setPeriodKey] = useState("FY");
  const [custom, setCustom] = useState({ from: "2025-02-15", to: "2025-08-20" });
  const [definitions, setDefinitions] = useState([]);
  const [startFromId, setStartFromId] = useState("");
  const [request, setRequest] = useState(EXAMPLES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useCrumbs({ section: "Agent studio", title: "New report" });

  useEffect(() => {
    getHouseholds().then((h) => { setHouseholds(h); setHouseholdId(h[0]?.householdId ?? null); }).catch((e) => setError(errorMessage(e)));
    getReusableDefinitions().then(setDefinitions).catch(() => setDefinitions([]));
  }, []);

  const household = households?.find((h) => h.householdId === Number(householdId));
  const entity = household?.entities.find((e) => e.clientId === Number(entityId));
  const accounts = (household?.accounts ?? []).filter((a) => !entity || a.clientId === entity.clientId);
  const subject = accounts.find((a) => a.code === portfolio);
  const chosen = subject ? [subject] : accounts;
  const dataStart = chosen.map((a) => a.inceptionDate.slice(0, 10)).sort()[0];
  const dataEnd = useMemo(() => (households ?? []).flatMap((h) => h.accounts).map((a) => a.lastValuation?.slice(0, 10) ?? "").sort().at(-1), [households]);
  const years = dataEnd ? [0, 1, 2, 3].map((i) => Number(dataEnd.slice(0, 4)) - i) : [];
  const isCustom = periodKey === "CUSTOM";
  const customOk = custom.from && custom.to && custom.from <= custom.to && (!dataStart || custom.from >= dataStart) && (!dataEnd || custom.to <= dataEnd);
  const period = !household ? null : isCustom ? (customOk ? { from: custom.from, to: custom.to, partial: false } : null) : resolvePeriod(year, periodKey, dataStart, dataEnd);
  // Closed standard periods are published at period close; anything else is calculated.
  const published = period && !isCustom && periodKey !== "SI" && !period.partial;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await createAgentReport({
        householdId: Number(householdId), clientId: entity ? entity.clientId : null, portfolioCode: portfolio || null, year, periodKey, request,
        ...(isCustom ? { from: custom.from, to: custom.to } : {}), startFromId: startFromId ? Number(startFromId) : null,
      });
      go("agent-run", r.agentReportId);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  if (!households) return <div className="center-message">{error ?? "Loading…"}</div>;
  return (
    <div className="page-pad agent-builder">
      <p className="eyebrow">Agent studio · V7</p>
      <h1 className="display">Ask for a report</h1>
      <p className="muted">Choose the client and period, then say what you need. A lead agent plans the work and delegates it to a performance agent and a reporting agent.</p>
      {guide && <AgentMap />}
      {error && <div className="notice error">{error}</div>}

      <section className="card">
        <h2>Client and period</h2>
        <div className="inline-row">
          <select className="select" value={householdId ?? ""} onChange={(e) => { setHouseholdId(e.target.value); setEntityId(""); setPortfolio(""); }} aria-label="Household">
            {households.map((h) => <option key={h.householdId} value={h.householdId}>{h.name}</option>)}
          </select>
          <select className="select" value={entityId} onChange={(e) => { setEntityId(e.target.value); setPortfolio(""); }} aria-label="Entity">
            <option value="">All entities (whole household)</option>
            {household?.entities.map((e) => <option key={e.clientId} value={e.clientId}>{e.name} ({e.clientType})</option>)}
          </select>
          <select className="select" value={portfolio} onChange={(e) => setPortfolio(e.target.value)} aria-label="Account">
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.code} value={a.code}>{a.name} ({a.code}, {a.currency})</option>)}
          </select>
        </div>
        {household && (
          <p className="small muted">
            {household.segment} · {formatMillions(chosen.reduce((s, a) => s + a.marketValue, 0))} · {[...new Set(chosen.map((a) => a.currency))].join(", ")}
          </p>
        )}
        <div className="inline-row">
          <div className="segmented">
            {years.map((y) => <button key={y} type="button" className={year === y ? "on" : ""} onClick={() => setYear(y)}>{y}</button>)}
          </div>
          <div className="segmented">
            {PERIODS.map((p) => {
              const ok = household && resolvePeriod(year, p.key, dataStart, dataEnd);
              return <button key={p.key} type="button" className={periodKey === p.key ? "on" : ""} disabled={!ok} onClick={() => setPeriodKey(p.key)}>{p.label}</button>;
            })}
            <button type="button" className={isCustom ? "on" : ""} onClick={() => setPeriodKey("CUSTOM")}>Custom dates</button>
          </div>
        </div>
        {isCustom && (
          <div className="inline-row">
            <label className="small">From <input type="date" value={custom.from} min={dataStart} max={dataEnd} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
            <label className="small">To <input type="date" value={custom.to} min={dataStart} max={dataEnd} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
          </div>
        )}
        <p className="small muted">
          {period ? `${formatDate(period.from, "long")} – ${formatDate(period.to, "long")}${period.partial ? " (to the latest valuation)" : ""}` : "No valuations in this period: choose another."}
        </p>
        {period && (
          <p className={`small source-note ${published ? "src-published" : "src-calculated"}`}>
            {published
              ? "Closed standard period: the Reporting API reads the published figures, and calculates anything else."
              : "Custom or open period: the Reporting API calculates every figure with the calculation library."}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Your request</h2>
        {definitions.length > 0 && (
          <label className="small start-from">Start from
            <select className="select" value={startFromId} onChange={(e) => setStartFromId(e.target.value)}>
              <option value="">Nothing: the agents design the report</option>
              {definitions.map((d) => <option key={d.definitionId} value={d.definitionId}>{d.name} ({d.pages.length} pages)</option>)}
            </select>
          </label>
        )}
        <textarea rows={4} value={request} onChange={(e) => setRequest(e.target.value)} aria-label="What report do you need?" maxLength={2000} />
        <div className="chip-row">
          {EXAMPLES.map((x, i) => (
            <button key={i} type="button" className="btn small" onClick={() => setRequest(x)}>{x.split(":")[0].split(".")[0]}</button>
          ))}
        </div>
      </section>

      <div className="action-bar no-print">
        <span className="muted">The agents usually take two to four minutes.</span>
        <button type="button" className="btn primary" disabled={!period || busy || request.trim().length < 10} onClick={send}>
          {busy ? "Sending…" : "Send to the lead agent →"}
        </button>
      </div>
    </div>
  );
}

/** The V7 design in one line: front end → lead agent → two specialists → governed tools. */
export function AgentMap() {
  return (
    <div className="agent-map" aria-label="How the agents work">
      <div className="am-box"><span className="am-kind">Front end</span><strong>Report builder</strong><span>selections, request, changes; shows report, figures, as-of date, status</span></div>
      <span className="am-arrow">→</span>
      <div className="am-box lead"><span className="am-kind">Coordinator</span><strong>Lead agent</strong><span>plans, delegates, returns the report</span></div>
      <span className="am-arrow">→</span>
      <div className="am-stack">
        <div className="am-box spec"><span className="am-kind">Specialist</span><strong>Performance agent</strong><span>measures, figures, data status</span></div>
        <div className="am-box spec"><span className="am-kind">Specialist</span><strong>Reporting agent</strong><span>layout, sections, narrative</span></div>
      </div>
      <span className="am-arrow">→</span>
      <div className="am-stack">
        <div className="am-box tools"><span className="am-kind">Governed tools</span><strong>Reporting API</strong><span>signed-in user access · published figures · calculation library</span></div>
        <div className="am-box tools"><span className="am-kind">Shared context</span><strong>Knowledge &amp; rules</strong><span>dictionary, rules, disclosures, reusable definitions</span></div>
      </div>
    </div>
  );
}
