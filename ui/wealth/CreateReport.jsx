import { useEffect, useMemo, useState } from "react";
import { createClientReport, errorMessage, getHouseholds, getTemplates } from "../api.js";
import { conditionLabel } from "../rules.js";
import { formatDate, formatMillions } from "../format.js";
import { useCrumbs, useStudio } from "../App.jsx";

export const PERIODS = [
  { key: "FY", label: "Full year" },
  { key: "H1", label: "H1" },
  { key: "H2", label: "H2" },
  { key: "Q1", label: "Q1" },
  { key: "Q2", label: "Q2" },
  { key: "Q3", label: "Q3" },
  { key: "Q4", label: "Q4" },
  { key: "SI", label: "Since inception" },
];

const FORMATS = [
  { key: "full_pdf", label: "Full PDF", note: "Complete report (~12 pages)" },
  { key: "half_pdf", label: "Half PDF", note: "~7 pages" },
  { key: "quarter_pdf", label: "Quarter PDF", note: "~4 pages" },
  { key: "deck", label: "Presentation deck", note: "PPTX" },
  { key: "linkedin", label: "LinkedIn post", note: "Social card" },
  { key: "instagram", label: "Instagram", note: "Social card" },
  { key: "xlsx", label: "Excel export", note: "XLSX" },
  { key: "docx", label: "Word export", note: "DOCX" },
];

const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Same rules as the API (ClientReportService.ResolvePeriod): dates clipped to the subject's data. */
export function resolvePeriod(year, key, dataStart, dataEnd) {
  const ranges = {
    FY: [iso(year, 1, 1), iso(year, 12, 31)], H1: [iso(year, 1, 1), iso(year, 6, 30)], H2: [iso(year, 7, 1), iso(year, 12, 31)],
    Q1: [iso(year, 1, 1), iso(year, 3, 31)], Q2: [iso(year, 4, 1), iso(year, 6, 30)], Q3: [iso(year, 7, 1), iso(year, 9, 30)],
    Q4: [iso(year, 10, 1), iso(year, 12, 31)], SI: [dataStart, iso(year, 12, 31)],
  };
  let [from, to] = ranges[key];
  const nominalTo = to;
  if (!dataStart || !dataEnd) return null;
  if (to > dataEnd) to = dataEnd;
  if (from < dataStart) from = dataStart;
  if (from > to) return null;
  return { from, to, partial: to < nominalTo };
}

/**
 * Create a report: household, entity or account, period, output format, template, pages. The orchestrator then
 * prepares it (context, data readiness, insights, narrative, composition, release readiness).
 */
export default function CreateReport({ householdId: initialHousehold }) {
  const { go, guide } = useStudio();
  const [households, setHouseholds] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [householdId, setHouseholdId] = useState(initialHousehold ?? null);
  const [entityId, setEntityId] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const [year, setYear] = useState(2025);
  const [periodKey, setPeriodKey] = useState("FY");
  const [format, setFormat] = useState("full_pdf");
  const [templateId, setTemplateId] = useState(null);
  const [pages, setPages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useCrumbs({ section: "Report", title: "Create report" });

  useEffect(() => {
    Promise.all([getHouseholds(), getTemplates()])
      .then(([h, t]) => {
        setHouseholds(h);
        setHouseholdId((id) => id ?? h[0]?.householdId);
        setTemplates(t);
        const first = t.find((x) => x.status === "Released");
        if (first) chooseTemplate(first);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const household = households?.find((h) => h.householdId === Number(householdId));
  const entity = household?.entities.find((e) => e.clientId === Number(entityId));
  const template = templates?.find((t) => t.reportId === templateId);
  const accounts = (household?.accounts ?? []).filter((a) => !entity || a.clientId === entity.clientId);
  const subject = accounts.find((p) => p.code === portfolio);
  const chosen = subject ? [subject] : accounts;
  const dataStart = chosen.map((a) => a.inceptionDate.slice(0, 10)).sort()[0];
  // The studio's as-of date: the latest valuation of any account (a stale account does not shorten the period).
  const dataEnd = useMemo(() => (households ?? []).flatMap((h) => h.accounts).map((a) => a.lastValuation?.slice(0, 10) ?? "").sort().at(-1), [households]);
  const years = useMemo(() => {
    if (!dataEnd) return [];
    const last = Number(dataEnd.slice(0, 4));
    return [last, last - 1, last - 2, last - 3];
  }, [dataEnd]);
  const period = household ? resolvePeriod(year, periodKey, dataStart, dataEnd) : null;
  const currencies = [...new Set(chosen.filter((a) => period && a.inceptionDate.slice(0, 10) <= period.to).map((a) => a.currency))];
  const conditionMet = (c) => !c || (c === "MultiCurrency" ? currencies.some((x) => x !== "USD") : c === "StructuredProducts" ? null : true);
  const periodName = PERIODS.find((p) => p.key === periodKey)?.label.toLowerCase();

  function chooseTemplate(t) {
    if (t.status !== "Released") return;
    setTemplateId(t.reportId);
    setPages(t.pages.map((p) => ({ ...p, included: true })));
  }

  const movePage = (index, delta) => {
    const next = [...pages];
    const [p] = next.splice(index, 1);
    next.splice(index + delta, 0, p);
    setPages(next);
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const report = await createClientReport({
        reportId: templateId, householdId: Number(householdId), clientId: entity ? entity.clientId : null, portfolioCode: portfolio || null,
        year, periodKey, outputFormat: format, pages: pages.map((p) => ({ id: p.id, included: p.included })),
      });
      go("preparing", report.clientReportId);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  if (!households || !templates) return <div className="center-message">{error ?? "Loading…"}</div>;
  const included = pages.filter((p) => p.included).length;
  let lastGroup = null;

  return (
    <div className="create">
      <div className="page-pad">
        <p className="eyebrow">Client reporting</p>
        <h1 className="display">Create a report</h1>
        <p className="muted">Every figure is bound from the systems of record. Nothing here is typed by hand.</p>
        {error && <div className="notice error">{error}</div>}

        <Step no="01" title="Client, entity or group">
          {households.length === 0 && <p className="muted">You have no households assigned.</p>}
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
            <span className="client-chip">
              <span className="avatar">{household.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
              <strong>{entity?.name ?? household.name}</strong>
              <span className="muted">
                {household.segment} · {formatMillions(chosen.reduce((s, a) => s + a.marketValue, 0))} · {[...new Set((entity ? [entity] : household.entities).map((e) => e.mandate))].join(" & ")}
                {" "}· {[...new Set(chosen.map((a) => a.currency))].join(", ")} · next review {formatDate(household.nextReviewDate.slice(0, 10))}
              </span>
            </span>
          )}
          <button type="button" className="btn small" onClick={() => go("analyse", Number(householdId))}>Analyse this portfolio first ↗</button>
        </Step>

        <Step no="02" title="Reporting period and portfolio">
          <div className="inline-row">
            <div className="segmented">
              {years.map((y) => (
                <button key={y} type="button" className={year === y ? "on" : ""} onClick={() => setYear(y)}>{y}</button>
              ))}
            </div>
            <div className="segmented">
              {PERIODS.map((p) => {
                const ok = household && resolvePeriod(year, p.key, dataStart, dataEnd);
                return (
                  <button key={p.key} type="button" className={periodKey === p.key ? "on" : ""} disabled={!ok}
                    title={ok ? "" : "No valuations in this period"} onClick={() => setPeriodKey(p.key)}>{p.label}</button>
                );
              })}
            </div>
          </div>
          <p className="muted small">
            {period
              ? <>Reporting for {formatDate(period.from, "long")} – {formatDate(period.to, "long")}, {periodName}, for {subject ? `${subject.name} (${subject.code})` : entity ? `${entity.name}, all accounts` : `the whole ${household.name} household`}, in US dollars.
                  {period.partial && <> Valuations are available to {formatDate(dataEnd, "long")}, so the period is shown to date.</>}</>
              : "There are no valuations for this period: choose another."}
          </p>
        </Step>

        <Step no="03" title="Output format">
          <div className="card-row">
            {FORMATS.map((f) => {
              const available = f.key === "full_pdf";
              return (
                <button key={f.key} type="button" className={`format-card ${format === f.key ? "on" : ""}`} disabled={!available} onClick={() => setFormat(f.key)}>
                  <strong>{f.label}</strong>
                  <span className="muted">{f.note}</span>
                  {!available && <span className="soon">Coming soon</span>}
                </button>
              );
            })}
          </div>
        </Step>

        <Step no="04" title="Predefined template">
          <div className="card-row">
            {templates.map((t) => (
              <button key={t.reportId} type="button" className={`template-card ${templateId === t.reportId ? "on" : ""}`}
                disabled={t.status !== "Released"} onClick={() => chooseTemplate(t)}>
                <span className="thumb" aria-hidden="true"><span /></span>
                <strong>{t.name}</strong>
                <span className="muted">{t.versionNo ? `v${t.versionNo} · ${t.pages.length}pp` : t.category}</span>
                <span className={`status-pill ${t.status === "Released" ? "released" : "pending"}`}>{t.status === "Released" ? "Released" : t.status}</span>
              </button>
            ))}
          </div>
          <button type="button" className="btn small" disabled title="Coming soon">Or upload your own template (PDF/PPTX)</button>
        </Step>

        <Step no="05" title="Report pages" aside={`${included} of ${pages.length} included · locked pages are required by compliance`}>
          {guide && <p className="guide">Switch pages off to leave them out, and use the arrows to change the order. You can change both again while customising.</p>}
          <div className="page-rows">
            {pages.map((p, i) => {
              const header = p.group !== lastGroup;
              lastGroup = p.group;
              const met = conditionMet(p.condition);
              return (
                <div key={p.id} className={`page-row ${p.included ? "" : "excluded"}`} data-group-start={header || undefined}>
                  <span className="mono muted">{String(i + 1).padStart(2, "0")}</span>
                  <span className="page-row-title">{p.title} {p.locked && <span title="Required by compliance" aria-label="Locked">🔒</span>}</span>
                  <span className="muted small">
                    {p.condition ? (met === false ? "Left out: not the case for this client" : `Only if ${conditionLabel(p.condition).replace(/^The /, "the ")}`) : p.group}
                  </span>
                  <button type="button" className="icon-btn" aria-label={`Move ${p.title} up`} disabled={i === 0} onClick={() => movePage(i, -1)}>↑</button>
                  <button type="button" className="icon-btn" aria-label={`Move ${p.title} down`} disabled={i === pages.length - 1} onClick={() => movePage(i, 1)}>↓</button>
                  <Toggle checked={p.included} disabled={p.locked} label={`Include ${p.title}`}
                    onChange={(v) => setPages(pages.map((x) => (x.id === p.id ? { ...x, included: v } : x)))} />
                </div>
              );
            })}
          </div>
        </Step>
      </div>

      <div className="action-bar no-print">
        <span className="muted">
          {template && period ? `Ready to generate · ${template.name} · ${PERIODS.find((p) => p.key === periodKey).label === "Full year" ? `FY ${year}` : `${PERIODS.find((p) => p.key === periodKey).label} ${year}`}` : "Choose a template and a period with data"}
        </span>
        <button type="button" className="btn primary" disabled={!template || !period || busy || included === 0} onClick={generate}>
          {busy ? "Preparing…" : "Generate report →"}
        </button>
      </div>
    </div>
  );
}

function Step({ no, title, aside, children }) {
  return (
    <section className="step">
      <span className="step-no">{no}</span>
      <div className="step-body">
        <div className="step-head">
          <h2>{title}</h2>
          {aside && <span className="muted small">{aside}</span>}
        </div>
        {children}
      </div>
    </section>
  );
}

export function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}
