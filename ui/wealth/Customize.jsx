import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  askStudio, errorMessage, getClientReport, getCoverTemplates, runClientReport, saveClientReport, submitClientReport,
} from "../api.js";
import CoverEditor from "../components/CoverEditor.jsx";
import { useCoverAgent } from "../components/coverAgent.jsx";
import { Checks, Insights, ReadinessBadge, RunTrace, StatusPill } from "../components/Trust.jsx";
import PageSheet from "../components/PageSheet.jsx";
import ReportView from "../components/ReportView.jsx";
import { ACCENTS } from "../format.js";
import {
  DISPLAYS, ORIGINS, PAGE_GROUPS, PAGE_LAYOUTS, PLACEHOLDERS, TYPEFACES, hasData, isTotals, measure, measureBlocked, newBlockId, newPage, placeholderContext,
} from "../rules.js";
import { useCrumbs, useStudio } from "../App.jsx";
import { Toggle } from "./CreateReport.jsx";

const clone = (x) => JSON.parse(JSON.stringify(x));
const TABS = ["Cover", "Content", "Readiness", "Suggestions", "Branding", "Layout"];

/**
 * Customize report: pages on the left, the selected page in the middle, the Inspector on the right.
 * Edits change this client report only; locked (compliance) pages cannot be edited or left out.
 * "Ask the studio" sends the page to the AI, which may rewrite text and add or change approved charts.
 */
export default function Customize({ reportId }) {
  const { go, guide, catalog } = useStudio();
  const [detail, setDetail] = useState(null);
  const [definition, setDefinition] = useState(null);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [pageId, setPageId] = useState(null);
  const [selected, setSelected] = useState(null); // null = the page, "heading", or a block id
  const [tab, setTab] = useState("Content");
  const [results, setResults] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);
  const [ask, setAsk] = useState("");
  const [preview, setPreview] = useState(null); // results for "Preview all"
  const runKeys = useRef({});
  const [coverTemplates, setCoverTemplates] = useState([]);

  useEffect(() => {
    getCoverTemplates().then((d) => setCoverTemplates(d.templates)).catch(() => {});
  }, []);

  useEffect(() => {
    getClientReport(reportId)
      .then((d) => {
        setDetail(d);
        setDefinition(clone(d.definition));
        const p4 = d.definition.pages.find((p) => p.included && !p.locked) ?? d.definition.pages[0];
        setPageId(p4.id);
      })
      .catch((e) => setNotice({ kind: "error", text: errorMessage(e) }));
  }, [reportId]);

  const page = definition?.pages.find((p) => p.id === pageId);
  // Only a draft can change; once submitted the report is with compliance (or published).
  const readOnly = Boolean(detail && (detail.status !== "Draft" || detail.latestRun?.status === "Running"));
  const locked = Boolean(page && (readOnly || detail?.lockedPageIds.includes(page.id)));
  const ctx = useMemo(() => detail && placeholderContext({
    params: detail.parameters, clientName: detail.clientName, subjectLabel: detail.subjectLabel, relationshipManager: detail.context?.relationshipManager,
    periodLabel: detail.periodLabel, reportName: detail.templateName,
  }), [detail]);
  // V9: the cover agent behind the Cover tab's options (plans ahead; changes what goes with each choice, with undo).
  const coverChange = useRef(null);
  const coverAgent = useCoverAgent({
    kind: "client-reports", id: reportId, cover: definition?.cover ?? null, ctx, templates: coverTemplates,
    onChange: (cover) => coverChange.current?.(cover), enabled: tab === "Cover" && !readOnly && Boolean(definition),
  });
  useCrumbs({ back: { label: "Report history", to: "history" }, section: "Report", title: "Customize report" });

  // Figures for the page on screen: re-run (debounced) whenever its data blocks change.
  const runPage = useCallback((target, force = false) => {
    const blocks = target.blocks.filter(hasData);
    const key = JSON.stringify(blocks);
    if (!force && runKeys.current[target.id] === key) return;
    runKeys.current[target.id] = key;
    if (blocks.length === 0) return;
    setResults((r) => ({ ...r, ...Object.fromEntries(blocks.map((b) => [b.id, { ...r[b.id], loading: true }])) }));
    const single = { ...definition, pages: [target] };
    runClientReport(reportId, single, [target.id])
      .then((list) => runKeys.current[target.id] === key
        && setResults((r) => ({ ...r, ...Object.fromEntries(list.map((b) => [b.blockId, { result: b }])) })))
      .catch((e) => setResults((r) => ({ ...r, ...Object.fromEntries(blocks.map((b) => [b.id, { error: errorMessage(e) }])) })));
  }, [definition, reportId]);

  useEffect(() => {
    if (!page) return undefined;
    const t = setTimeout(() => runPage(page), 300);
    return () => clearTimeout(t);
  }, [page, runPage]);

  if (!detail || !definition || !page) return <div className="center-message">{notice?.text ?? "Loading report…"}</div>;

  // ---------- editing with undo ----------
  const change = (fn) => {
    setPast((p) => [...p.slice(-49), definition]);
    setFuture([]);
    const next = clone(definition);
    fn(next);
    setDefinition(next);
    setDirty(true);
  };
  coverChange.current = (cover) => change((d) => { d.cover = cover; });
  const changePage = (fn) => change((d) => fn(d.pages.find((p) => p.id === pageId)));
  const changeBlock = (id, patch) => changePage((p) => {
    const block = p.blocks.find((b) => b.id === id);
    // Typed changes to text make it the wealth manager's wording (its figures are still checked before release).
    if (block.type === "text" && ("text" in patch || "title" in patch)) patch = { ...patch, origin: "wealth-manager" };
    Object.assign(block, patch);
  });
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [definition, ...f]);
    setDefinition(past[past.length - 1]);
    setPast(past.slice(0, -1));
    setDirty(true);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, definition]);
    setDefinition(future[0]);
    setFuture(future.slice(1));
    setDirty(true);
  };

  const included = definition.pages.filter((p) => p.included);
  const pageNo = included.findIndex((p) => p.id === page.id) + 1;
  const block = page.blocks.find((b) => b.id === selected) ?? null;

  // ---------- actions ----------
  const save = async () => {
    setBusy("save");
    try {
      const d = await saveClientReport(reportId, definition);
      setDetail(d);
      setDefinition(clone(d.definition));
      setDirty(false);
      setNotice({ kind: "ok", text: "Changes saved." });
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const finish = async () => {
    setBusy("generate");
    try {
      await submitClientReport(reportId, definition);
      go("report", reportId);
    } catch (e) {
      setNotice({ kind: "error", text: `Not submitted. ${errorMessage(e)}` });
      getClientReport(reportId).then(setDetail).catch(() => {});
      setTab("Readiness");
      setBusy(null);
    }
  };

  const applyAsk = async (instruction = ask) => {
    setBusy("ask");
    setNotice(null);
    try {
      const out = await askStudio(reportId, page, instruction);
      change((d) => { d.pages[d.pages.findIndex((p) => p.id === page.id)] = { ...out.page, included: page.included }; });
      runKeys.current[page.id] = JSON.stringify(out.page.blocks.filter(hasData));
      setResults((r) => ({ ...r, ...Object.fromEntries(out.results.map((b) => [b.blockId, { result: b }])) }));
      setSelected(null);
      setAsk("");
      setNotice({ kind: "ok", text: `Studio: ${out.summary || "page updated."} Review it, then save. Undo reverts it.` });
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  // V7: Ask the studio for the cover (the cover is not a compliance page; its own rules are checked at release).

  const previewAll = async () => {
    setBusy("preview");
    try {
      setPreview(await runClientReport(reportId, definition, null));
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const regenerate = () => {
    runKeys.current = {};
    runPage(page, true);
    setNotice({ kind: "ok", text: "Figures re-read from the systems of record." });
  };

  const addPage = () => {
    const p = newPage("Commentary & close", "New page");
    p.blocks = [{ id: newBlockId(), type: "text", variant: "body", width: "full", title: "", text: "Write your commentary here." }];
    const at = definition.pages.findIndex((x) => x.id === page.id) + 1;
    change((d) => d.pages.splice(at, 0, p));
    setPageId(p.id);
    setSelected(null);
  };

  let lastGroup = null;
  return (
    <div className="customize">
      <aside className="pages-panel no-print">
        <div className="panel-head">
          <strong>Report pages</strong>
          <span className="muted small">{included.length} pages</span>
        </div>
        <button type="button" className="btn small block" onClick={addPage}>+ Add page</button>
        <nav className="page-list" aria-label="Report pages">
          {definition.pages.map((p) => {
            const header = p.group !== lastGroup ? p.group : null;
            lastGroup = p.group;
            const no = included.findIndex((x) => x.id === p.id) + 1;
            return (
              <div key={p.id}>
                {header && <p className="nav-section">{header}</p>}
                <button type="button" className={`page-link ${p.id === page.id ? "active" : ""} ${p.included ? "" : "excluded"}`}
                  onClick={() => { setPageId(p.id); setSelected(null); }}>
                  <span className="mono">{no ? String(no).padStart(2, "0") : "—"}</span>
                  <span className="grow">{p.title}</span>
                  {detail.lockedPageIds.includes(p.id) && <span className="lock" title="Required by compliance">🔒</span>}
                </button>
              </div>
            );
          })}
        </nav>
      </aside>

      <section className="canvas">
        <div className="canvas-bar no-print">
          <span className="crumb-line">
            <strong>{detail.templateName}</strong>
            <span className="muted"> · {page.group} · {page.title} · {pageNo ? `Page ${pageNo} of ${included.length}` : "Not included"}</span>
          </span>
          <span className="grow" />
          <button type="button" className="icon-btn" title="Undo" aria-label="Undo" disabled={!past.length} onClick={undo}>↶</button>
          <button type="button" className="icon-btn" title="Redo" aria-label="Redo" disabled={!future.length} onClick={redo}>↷</button>
          <button type="button" className="btn small" onClick={previewAll} disabled={busy}>{busy === "preview" ? "Loading…" : "Preview all"}</button>
          <button type="button" className="btn small" onClick={save} disabled={!dirty || busy}>{busy === "save" ? "Saving…" : dirty ? "Save changes" : "Saved"}</button>
        </div>
        {detail.status !== "Draft" && (
          <div className="notice info no-print">
            <StatusPill status={detail.status} />
            {detail.status === "InReview" ? "This report is with compliance for review. It can be changed again if they return it." : "This report is published to the client and can no longer be changed."}
            <button type="button" className="btn small" onClick={() => go("report", reportId)}>View report</button>
          </div>
        )}
        {detail.status === "Draft" && detail.reviewComment && (
          <div className="notice error no-print">Returned by {detail.reviewedBy}: “{detail.reviewComment}”</div>
        )}
        {notice && (
          <div className={`notice ${notice.kind} no-print`}>
            {notice.text}
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button>
          </div>
        )}
        <div className="canvas-scroll" onClick={() => setSelected(null)}>
          <PageSheet page={page} results={results} ctx={ctx} branding={definition.branding} cover={definition.cover} pageNumber={pageNo || null} pageCount={included.length}
            selectedId={locked && !definition.cover ? null : selected}
            onSelect={definition.cover && page.layout === "cover" && !readOnly ? (id) => { setSelected(id); setTab("Cover"); } : locked ? undefined : setSelected} className={page.included ? "" : "excluded"} showProvenance />
        </div>
        <div className="action-bar no-print">
          <span className="muted small">
            {readOnly ? "Read only." : locked ? "This page is required by compliance and cannot be edited." : "Click anything on the page to edit it"} · Layout: {PAGE_LAYOUTS.find((l) => l.key === page.layout)?.label}
          </span>
          <span className="grow" />
          <button type="button" className="btn" onClick={regenerate} title="Re-read every figure on this page from the systems of record">Regenerate content</button>
          {readOnly
            ? <button type="button" className="btn primary" onClick={() => go("report", reportId)}>View report →</button>
            : <button type="button" className="btn primary" onClick={finish} disabled={busy}>{busy === "generate" ? "Checking…" : "Submit for review →"}</button>}
        </div>
      </section>

      <aside className="inspector no-print">
        <div className="panel-head">
          <strong>Inspector</strong>
          <span className="small muted">Include this page</span>
          <Toggle checked={page.included} disabled={locked || (page.condition && !detail.context?.conditions?.includes(page.condition))} label="Include this page" onChange={(v) => changePage((p) => { p.included = v; })} />
        </div>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
        <div className="inspector-body">
          {tab === "Cover" && (
            <CoverEditor cover={definition.cover} templates={coverTemplates} segment={detail.context?.segment} readOnly={readOnly} agent={coverAgent}
              onChange={(cover) => change((d) => { d.cover = cover; })} />
          )}
          {tab === "Content" && (
            <fieldset disabled={locked} className="plain">
              {locked && <p className="guide">Locked pages come from the approved template and are required by compliance.</p>}
              {block ? (
                <ElementSettings block={block} catalog={catalog} state={results[block.id]} onChange={(patch) => changeBlock(block.id, patch)}
                  onRemove={() => { changePage((p) => { p.blocks = p.blocks.filter((b) => b.id !== block.id); }); setSelected(null); }}
                  onBack={() => setSelected(null)} />
              ) : (
                <PageSettings page={page} onChange={changePage} focusHeading={selected === "heading"} />
              )}
              {!block && (
                <AskStudio value={ask} onChange={setAsk} busy={busy === "ask"} onApply={() => applyAsk()} pageTitle={page.title} />
              )}
              {guide && !block && <p className="muted small">Tip: click any text, chart or table on the page to edit that element.</p>}
            </fieldset>
          )}
          {tab === "Suggestions" && (
            <Suggestions page={page} locked={locked} busy={busy === "ask"} onPick={(s) => { setTab("Content"); setSelected(null); setAsk(s); }} />
          )}
          {tab === "Readiness" && (
            <div className="readiness-tab">
              <div className="inline-row"><strong>Release readiness</strong> <ReadinessBadge status={detail.readiness?.status} /></div>
              {detail.readiness ? <Checks checks={detail.readiness.checks} /> : <p className="muted small">Not checked yet.</p>}
              <p className="muted small">The checks run again when you submit; a blocker stops submission.</p>
              <h3 className="insp-label">Material movements</h3>
              <Insights insights={detail.insights} />
              {detail.latestRun && (
                <>
                  <h3 className="insp-label">Latest orchestration run</h3>
                  <RunTrace key={detail.latestRun.runId} runId={detail.latestRun.runId} compact
                    onDone={(r) => detail.latestRun.status === "Running" && r.status !== "Running" && getClientReport(reportId).then((d) => { setDetail(d); setDefinition(clone(d.definition)); })} />
                </>
              )}
            </div>
          )}
          {tab === "Branding" && (
            <BrandingSettings branding={definition.branding} onChange={(patch) => change((d) => { d.branding = { ...d.branding, ...patch }; })} />
          )}
          {tab === "Layout" && (
            <fieldset disabled={locked} className="plain">
              <LayoutSettings page={page} pages={definition.pages}
                onChange={changePage}
                onMove={(delta) => change((d) => {
                  const i = d.pages.findIndex((p) => p.id === page.id);
                  const [p] = d.pages.splice(i, 1);
                  d.pages.splice(Math.max(0, Math.min(d.pages.length, i + delta)), 0, p);
                })}
                onRemove={page.id.startsWith("pg") ? () => {
                  const i = definition.pages.findIndex((p) => p.id === page.id);
                  change((d) => { d.pages.splice(i, 1); });
                  setPageId(definition.pages[Math.max(0, i - 1)].id);
                } : null} />
            </fieldset>
          )}
        </div>
      </aside>

      {preview && (
        <div className="overlay" role="dialog" aria-label="Preview all pages">
          <div className="overlay-bar">
            <strong>Preview · {detail.templateName} · {detail.clientName}</strong>
            <span className="grow" />
            <button type="button" className="btn" onClick={() => setPreview(null)}>Close preview</button>
          </div>
          <div className="overlay-body">
            <ReportView definition={definition} results={preview} ctx={ctx} />
          </div>
        </div>
      )}
    </div>
  );
}

export function PageSettings({ page, onChange, focusHeading }) {
  const headingRef = useRef(null);
  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
  }, [focusHeading]);
  const style = page.style ?? {};
  const setStyle = (patch) => onChange((p) => { p.style = { ...p.style, ...patch }; });
  return (
    <>
      <h3 className="insp-label">Page typography</h3>
      <div className="insp-row">
        <span>Typeface</span>
        <select value={style.typeface ?? "serif"} onChange={(e) => setStyle({ typeface: e.target.value })}>
          {TYPEFACES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>
      <div className="insp-row">
        <span>Body size</span>
        <input type="range" min="8" max="13" step="0.5" value={style.bodySize ?? 10} onChange={(e) => setStyle({ bodySize: Number(e.target.value) })} aria-label="Body size" />
      </div>
      <div className="insp-row">
        <span>Line height</span>
        <input type="range" min="1.2" max="1.9" step="0.05" value={style.lineHeight ?? 1.5} onChange={(e) => setStyle({ lineHeight: Number(e.target.value) })} aria-label="Line height" />
      </div>

      <h3 className="insp-label">Title and labels</h3>
      <label className="insp-field">
        <span>Section label</span>
        <input value={page.sectionLabel} maxLength={80} onChange={(e) => onChange((p) => { p.sectionLabel = e.target.value; })} />
      </label>
      <label className="insp-field">
        <span>Heading</span>
        <input ref={headingRef} value={page.heading} maxLength={120} onChange={(e) => onChange((p) => { p.heading = e.target.value; })} />
      </label>
    </>
  );
}

export function AskStudio({ value, onChange, busy, onApply, pageTitle }) {
  return (
    <div className="ask">
      <h3 className="insp-label">Ask the studio</h3>
      <textarea rows={4} value={value} maxLength={2000} placeholder="e.g. personalise the greeting…" onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="btn dark" disabled={busy || !value.trim()} onClick={onApply}>
        {busy ? "The studio is working…" : `Apply to ${pageTitle}`}
      </button>
    </div>
  );
}

const SUGGESTIONS = {
  any: [
    "Personalise the wording for {Client} and keep it warm but concise.",
    "Add a short commentary on how the portfolio performed against its benchmark, using the figures on this page.",
    "Shorten the text on this page to the essentials.",
  ],
  Performance: ["Add a bar chart of return by quarter for the report period.", "Explain in two sentences what the risk figures mean for the client."],
  "Investor letter": ["Personalise the greeting and mention the period's return and net flows."],
  "Portfolio snapshot": ["Replace the regional exposure chart with sector weights."],
  "Costs and charges": ["Add a table of fees by quarter."],
};

export function Suggestions({ page, locked, busy, onPick }) {
  if (locked) return <p className="muted">Locked pages cannot be changed.</p>;
  const list = [...(SUGGESTIONS[page.title] ?? []), ...SUGGESTIONS.any];
  return (
    <div className="suggestions">
      <p className="muted small">Ideas for this page. Pick one to put it in “Ask the studio”, then edit and apply.</p>
      {list.map((s) => (
        <button key={s} type="button" className="suggestion" disabled={busy} onClick={() => onPick(s)}>{s}</button>
      ))}
    </div>
  );
}

export function BrandingSettings({ branding, onChange }) {
  return (
    <>
      <h3 className="insp-label">Accent colour (whole report)</h3>
      <div className="swatches">
        {Object.entries(ACCENTS).map(([key, a]) => (
          <button key={key} type="button" className={`swatch ${branding.accent === key ? "on" : ""}`} onClick={() => onChange({ accent: key })} title={a.label}>
            <span style={{ background: a.color }} /> {a.label}
          </button>
        ))}
      </div>
      <div className="insp-row">
        <span>Show Investec wordmark</span>
        <Toggle checked={branding.showLogo !== false} label="Show wordmark" onChange={(v) => onChange({ showLogo: v })} />
      </div>
    </>
  );
}

export function LayoutSettings({ page, pages, onChange, onMove, onRemove }) {
  const index = pages.findIndex((p) => p.id === page.id);
  return (
    <>
      <h3 className="insp-label">Page layout</h3>
      <div className="layout-grid">
        {PAGE_LAYOUTS.map((l) => (
          <button key={l.key} type="button" className={`layout-card ${page.layout === l.key ? "on" : ""}`} onClick={() => onChange((p) => { p.layout = l.key; })}>
            <span className={`layout-thumb ${l.key}`} aria-hidden="true"><i /><i /><i /></span>
            {l.label}
          </button>
        ))}
      </div>
      <h3 className="insp-label">Page</h3>
      <label className="insp-field">
        <span>Name in the page list</span>
        <input value={page.title} maxLength={80} onChange={(e) => onChange((p) => { p.title = e.target.value; })} />
      </label>
      <label className="insp-field">
        <span>Group</span>
        <select value={page.group} onChange={(e) => onChange((p) => { p.group = e.target.value; })}>
          {PAGE_GROUPS.map((g) => <option key={g}>{g}</option>)}
        </select>
      </label>
      <div className="btn-row">
        <button type="button" className="btn small" disabled={index === 0} onClick={() => onMove(-1)}>Move up</button>
        <button type="button" className="btn small" disabled={index === pages.length - 1} onClick={() => onMove(1)}>Move down</button>
        {onRemove && <button type="button" className="btn small danger" onClick={onRemove}>Remove page</button>}
      </div>
    </>
  );
}

/** Editing one element: text, or a chart/table/KPI built from approved fields. */
export function ElementSettings({ block, catalog, state, onChange, onRemove, onBack }) {
  const kind = block.type === "data" ? (isTotals(block.display) ? "Figures" : block.display === "table" ? "Table" : "Chart")
    : block.type === "disclaimer" ? "Disclaimer" : "Text";
  return (
    <div className="element">
      <button type="button" className="link-button" onClick={onBack}>← Page settings</button>
      <h3 className="insp-label">{kind}</h3>
      {block.type === "disclaimer" ? (
        <p className="guide">Disclaimers are compliance text and cannot be changed.</p>
      ) : (
        <>
          <label className="insp-field">
            <span>Title</span>
            <input value={block.title} maxLength={200} onChange={(e) => onChange({ title: e.target.value })} />
          </label>
          {block.type === "text" && (
            <>
              <p className={`origin-note ${ORIGINS[block.origin]?.ai ? "ai" : ""}`}>
                {ORIGINS[block.origin]?.label ?? "Template wording"}{ORIGINS[block.origin]?.ai ? " · figures checked against the governed data" : ""}
              </p>
              <label className="insp-field">
                <span>Text</span>
                <textarea rows={8} value={block.text ?? ""} maxLength={6000} onChange={(e) => onChange({ text: e.target.value })} />
              </label>
              <div className="chip-row">
                {PLACEHOLDERS.map((p) => (
                  <button key={p} type="button" className="mini" onClick={() => onChange({ text: `${block.text ?? ""}${block.text ? " " : ""}${p}` })}>{p}</button>
                ))}
              </div>
            </>
          )}
          {block.type === "data" && catalog && <DataElement block={block} catalog={catalog} state={state} onChange={onChange} />}
          <div className="insp-row">
            <span>Width</span>
            <select value={block.width} onChange={(e) => onChange({ width: e.target.value })}>
              <option value="full">Full width</option>
              <option value="half">Half width</option>
            </select>
          </div>
          <button type="button" className="btn small danger" onClick={onRemove}>Remove from page</button>
        </>
      )}
    </div>
  );
}

function DataElement({ block, catalog, state, onChange }) {
  const issues = state?.result?.issues ?? [];
  const addable = catalog.measures.filter((m) => !measureBlocked(catalog, block, m.measureKey));
  return (
    <>
      <div className="insp-row">
        <span>Show as</span>
        <select value={block.display} onChange={(e) => onChange({ display: e.target.value, ...(e.target.value === "pie" ? { compare: "none" } : {}) })}>
          {DISPLAYS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
      </div>
      <div className="insp-row">
        <span>Period</span>
        <select value={block.period} onChange={(e) => onChange({ period: e.target.value })}>
          {catalog.periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>
      <div className="insp-row">
        <span>Compare</span>
        <select value={block.compare} onChange={(e) => onChange({ compare: e.target.value })}>
          {catalog.compares.map((c) => <option key={c.key} value={c.key}>{c.key === "none" ? "No comparison" : c.label}</option>)}
        </select>
      </div>
      <h3 className="insp-label">Figures</h3>
      <div className="chip-row">
        {block.measures.map((k) => (
          <span key={k} className="field-chip measure in-zone">
            {block.labels?.[k] ?? measure(catalog, k)?.label ?? k}
            <button type="button" className="chip-x" aria-label="Remove" onClick={() => onChange({ measures: block.measures.filter((m) => m !== k) })}>×</button>
          </span>
        ))}
      </div>
      {addable.length > 0 && (
        <select value="" onChange={(e) => e.target.value && onChange({ measures: [...block.measures, e.target.value] })} aria-label="Add a figure">
          <option value="">+ Add a figure…</option>
          {addable.map((m) => <option key={m.measureKey} value={m.measureKey}>{m.label}</option>)}
        </select>
      )}
      {issues.length > 0 && <div className="validity bad">{issues.map((i) => <p key={i}>⚠ {i}</p>)}</div>}
      {state?.result && issues.length === 0 && !state.result.error && <div className="validity ok">✓ Bound to the systems of record</div>}
    </>
  );
}
