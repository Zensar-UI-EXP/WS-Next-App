import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { askAgentStudio, editAgentReport, errorMessage, getAgentReport, getCoverTemplates, previewAgentReport, runAgentReport } from "../api.js";
import CoverEditor from "../components/CoverEditor.jsx";
import { useCoverAgent } from "../components/coverAgent.jsx";
import { Checks } from "../components/Trust.jsx";
import PageSheet from "../components/PageSheet.jsx";
import ReportView from "../components/ReportView.jsx";
import { PAGE_LAYOUTS, hasData, newBlockId, newPage, placeholderContext } from "../rules.js";
import { formatDate } from "../format.js";
import { useCrumbs, useStudio } from "../App.jsx";
import { Toggle } from "../wealth/CreateReport.jsx";
import { AskStudio, BrandingSettings, ElementSettings, LayoutSettings, PageSettings, Suggestions } from "../wealth/Customize.jsx";
import { CHANGE_LABELS, Findings } from "./AgentRun.jsx";

const clone = (x) => JSON.parse(JSON.stringify(x));
const TABS = ["Cover", "Content", "Data status", "Suggestions", "Branding", "Layout"];
const isDisclosures = (p) => p.blocks.length > 0 && p.blocks.every((b) => b.type === "disclaimer");

/**
 * Customize an agent report (the V4 editor): pages on the left, the selected page in the middle, the Inspector on the
 * right. "Ask the studio" revises one page with AI. Saving checks the whole report through the Reporting API (approved
 * fields, display rules, verified figures in the text) and makes it the next version; earlier versions stay as they were.
 */
export default function AgentCustomize({ reportId }) {
  const { go, guide, catalog } = useStudio();
  const [r, setR] = useState(null);
  const [status, setStatus] = useState(null);
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
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState(null); // results for "Preview all"
  const [coverTemplates, setCoverTemplates] = useState([]);
  const runKeys = useRef({});

  useEffect(() => {
    Promise.all([getAgentReport(reportId), runAgentReport(reportId)])
      .then(([d, run]) => {
        setR(d);
        setStatus(run.dataStatus);
        setDefinition(clone(run.definition));
        setResults(Object.fromEntries(run.results.map((b) => [b.blockId, { result: b }])));
        const first = run.definition.pages.find((p) => p.layout !== "cover" && !isDisclosures(p)) ?? run.definition.pages[0];
        setPageId(first.id);
      })
      .catch((e) => setNotice({ kind: "error", text: errorMessage(e) }));
    getCoverTemplates().then((d) => setCoverTemplates(d.templates)).catch(() => {});
  }, [reportId]);

  const page = definition?.pages.find((p) => p.id === pageId);
  const latest = r && r.versions.at(-1)?.agentReportId === r.agentReportId;
  const readOnly = Boolean(r && (!latest || r.status !== "Completed"));
  const locked = Boolean(page && (readOnly || isDisclosures(page)));
  const ctx = useMemo(() => r && placeholderContext({
    params: { householdId: r.householdId, clientId: r.clientId, portfolioCode: r.portfolioCode, fromDate: r.fromDate.slice(0, 10), toDate: r.toDate.slice(0, 10) },
    clientName: r.clientName, subjectLabel: r.subjectLabel, reportName: r.title, relationshipManager: r.relationshipManager,
    periodLabel: `${formatDate(r.fromDate.slice(0, 10), "long")} – ${formatDate(r.toDate.slice(0, 10), "long")}`,
  }), [r]);
  // V9: the cover agent behind the Cover tab's options (plans ahead; changes what goes with each choice, with undo).
  const coverChange = useRef(null);
  const coverAgent = useCoverAgent({
    kind: "agent-reports", id: reportId, cover: definition?.cover ?? null, ctx, templates: coverTemplates,
    onChange: (cover) => coverChange.current?.(cover), enabled: tab === "Cover" && !readOnly && Boolean(definition),
  });
  useCrumbs({ back: { label: "Report", to: "agent-report", id: reportId }, section: "Agent studio", title: "Customize report" });

  // Figures for the page on screen: re-run through the Reporting API (debounced) whenever its data blocks change.
  const runPage = useCallback((target, force = false) => {
    const blocks = target.blocks.filter(hasData);
    const key = JSON.stringify(blocks);
    if (!force && runKeys.current[target.id] === key) return;
    const first = runKeys.current[target.id] === undefined;
    runKeys.current[target.id] = key;
    if (blocks.length === 0 || (first && !force && blocks.every((b) => results[b.id]?.result))) return;
    setResults((cur) => ({ ...cur, ...Object.fromEntries(blocks.map((b) => [b.id, { ...cur[b.id], loading: true }])) }));
    previewAgentReport(reportId, { ...definition, pages: [target] }, [target.id])
      .then((list) => runKeys.current[target.id] === key
        && setResults((cur) => ({ ...cur, ...Object.fromEntries(list.map((b) => [b.blockId, { result: b }])) })))
      .catch((e) => setResults((cur) => ({ ...cur, ...Object.fromEntries(blocks.map((b) => [b.id, { error: errorMessage(e) }])) })));
  }, [definition, reportId, results]);

  useEffect(() => {
    if (!page) return undefined;
    const t = setTimeout(() => runPage(page), 300);
    return () => clearTimeout(t);
  }, [page, runPage]);

  if (!r || !definition || !page) return <div className="center-message">{notice?.text ?? "Loading report…"}</div>;

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
    // Typed changes to text make it the wealth manager's wording (its figures are still checked when saved).
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
  const nextVersion = r.versions.length + 1;

  // ---------- actions ----------
  const save = async () => {
    setBusy("save");
    setNotice(null);
    try {
      const out = await editAgentReport(reportId, definition, note.trim() || null);
      go("agent-report", out.agentReportId);
    } catch (e) {
      setNotice({ kind: "error", text: `Not saved. ${errorMessage(e)}` });
      setBusy(null);
    }
  };

  const applyAsk = async (instruction = ask) => {
    setBusy("ask");
    setNotice(null);
    try {
      const out = await askAgentStudio(reportId, page, instruction);
      change((d) => { d.pages[d.pages.findIndex((p) => p.id === page.id)] = { ...out.page, included: page.included }; });
      runKeys.current[page.id] = "";
      setSelected(null);
      setAsk("");
      setNotice({ kind: "ok", text: `Studio: ${out.summary || "page updated."} Review it, then save. Undo reverts it.` });
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const previewAll = async () => {
    setBusy("preview");
    try {
      setPreview(await previewAgentReport(reportId, definition, null));
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };


  const regenerate = () => {
    runKeys.current = {};
    runPage(page, true);
    setNotice({ kind: "ok", text: "Figures re-read through the Reporting API." });
  };

  const addPage = () => {
    const p = newPage("Commentary & close", "New page");
    p.blocks = [{ id: newBlockId(), type: "text", variant: "body", width: "full", title: "", text: "Write your commentary here.", origin: "wealth-manager" }];
    const at = definition.pages.findIndex((x) => x.id === page.id) + 1;
    change((d) => d.pages.splice(at, 0, p));
    setPageId(p.id);
    setSelected(null);
  };

  return (
    <div className="customize">
      <aside className="pages-panel no-print">
        <div className="panel-head">
          <strong>Report pages</strong>
          <span className="muted small">{included.length} pages</span>
        </div>
        <button type="button" className="btn small block" onClick={addPage} disabled={readOnly}>+ Add page</button>
        <nav className="page-list" aria-label="Report pages">
          {definition.pages.map((p) => {
            const no = included.findIndex((x) => x.id === p.id) + 1;
            return (
              <button key={p.id} type="button" className={`page-link ${p.id === page.id ? "active" : ""} ${p.included ? "" : "excluded"}`}
                onClick={() => { setPageId(p.id); setSelected(null); }}>
                <span className="mono">{no ? String(no).padStart(2, "0") : "—"}</span>
                <span className="grow">{p.title}</span>
                {isDisclosures(p) && <span className="lock" title="Disclosures from the library">🔒</span>}
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="canvas">
        <div className="canvas-bar no-print">
          <span className="crumb-line">
            <strong>{r.title}</strong>
            <span className="muted"> · v{r.version} {CHANGE_LABELS[r.changeKind].toLowerCase()} · {page.title} · {pageNo ? `Page ${pageNo} of ${included.length}` : "Not included"}</span>
          </span>
          <span className="grow" />
          <button type="button" className="icon-btn" title="Undo" aria-label="Undo" disabled={!past.length} onClick={undo}>↶</button>
          <button type="button" className="icon-btn" title="Redo" aria-label="Redo" disabled={!future.length} onClick={redo}>↷</button>
          <button type="button" className="btn small" onClick={previewAll} disabled={busy}>{busy === "preview" ? "Loading…" : "Preview all"}</button>
        </div>
        {readOnly && (
          <div className="notice info no-print">
            This is version {r.version}; only the latest version can be changed.
            <button type="button" className="btn small" onClick={() => go("agent-customize", r.versions.at(-1).agentReportId)}>Open the latest</button>
          </div>
        )}
        {notice && (
          <div className={`notice ${notice.kind} no-print pre-line`}>
            {notice.text}
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button>
          </div>
        )}
        <div className="canvas-scroll" onClick={() => setSelected(null)}>
          <PageSheet page={page} results={results} ctx={ctx} branding={definition.branding} cover={definition.cover} pageNumber={pageNo || null} pageCount={included.length}
            selectedId={locked ? null : selected} onSelect={locked ? undefined : (id) => { setSelected(id); if (id === "cover") setTab("Cover"); }} className={page.included ? "" : "excluded"} showProvenance />
        </div>
        <div className="action-bar no-print">
          <span className="muted small">
            {readOnly ? "Read only." : locked ? "Disclosures come from the library and cannot be edited." : "Click anything on the page to edit it"} · Layout: {PAGE_LAYOUTS.find((l) => l.key === page.layout)?.label}
          </span>
          <span className="grow" />
          <button type="button" className="btn" onClick={regenerate} title="Re-read every figure on this page through the Reporting API">Regenerate content</button>
          {!readOnly && <input className="save-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What did you change?" aria-label="What did you change?" />}
          {readOnly
            ? <button type="button" className="btn primary" onClick={() => go("agent-report", reportId)}>View report →</button>
            : <button type="button" className="btn primary" onClick={save} disabled={!dirty || busy}>{busy === "save" ? "Checking…" : `Save as version ${nextVersion} →`}</button>}
        </div>
      </section>

      <aside className="inspector no-print">
        <div className="panel-head">
          <strong>Inspector</strong>
          <span className="small muted">Include this page</span>
          <Toggle checked={page.included} disabled={locked} label="Include this page" onChange={(v) => changePage((p) => { p.included = v; })} />
        </div>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
        <div className="inspector-body">
          {tab === "Cover" && (
            <CoverEditor cover={definition.cover} templates={coverTemplates} segment={r.segment} readOnly={readOnly} agent={coverAgent}
              onChange={(cover) => change((d) => { d.cover = cover; })} />
          )}
          {tab === "Content" && (
            <fieldset disabled={locked} className="plain">
              {locked && !readOnly && <p className="guide">Disclosures come from the disclosure library and are required for this client.</p>}
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
          {tab === "Data status" && (
            <div className="readiness-tab">
              <div className="inline-row"><strong>Data status</strong> <span className={`rs-status st-${status.status.toLowerCase()}`}>{status.status}</span></div>
              <p className="small muted">As of {formatDate(status.asOfDate, "long")}. {status.periodCovered}</p>
              <Checks checks={status.checks.map((c, i) => ({ code: `c${i}`, label: c.check, status: c.status, detail: c.detail }))} />
              <p className="muted small">When you save, the Reporting API checks the whole report again.</p>
              {r.findings && <Findings f={r.findings} />}
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
                onRemove={definition.pages.length > 1 ? () => {
                  const i = definition.pages.findIndex((p) => p.id === page.id);
                  change((d) => { d.pages.splice(i, 1); });
                  setPageId(definition.pages[i === 0 ? 1 : i - 1].id);
                } : null} />
            </fieldset>
          )}
        </div>
      </aside>

      {preview && (
        <div className="overlay" role="dialog" aria-label="Preview all pages">
          <div className="overlay-bar">
            <strong>Preview · {r.title} · {r.subjectLabel}</strong>
            <span className="grow" />
            <button type="button" className="btn" onClick={() => setPreview(null)}>Close preview</button>
          </div>
          <div className="overlay-body">
            <ReportView definition={definition} results={preview} ctx={ctx} showProvenance />
          </div>
        </div>
      )}
    </div>
  );
}
