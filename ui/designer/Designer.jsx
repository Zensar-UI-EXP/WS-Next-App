import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BlocksPanel from "./BlocksPanel.jsx";
import FieldsPanel from "./FieldsPanel.jsx";
import Page from "./Page.jsx";
import BlockSettings, { ReportSettings } from "./BlockSettings.jsx";
import InputsPanel from "./InputsPanel.jsx";
import HistoryDialog from "./HistoryDialog.jsx";
import PageSheet from "../components/PageSheet.jsx";
import { errorMessage, getReport, getVersion, previewDraft, runBlock, saveDraft, submitDraft } from "../api.js";
import {
  CONDITIONS, NEW_BLOCKS, PAGE_GROUPS, PAGE_LAYOUTS, allBlocks, detectInputs, dimensionBlocked, hasData, measureBlocked, newBlockId, newPage, placeholderContext,
} from "../rules.js";
import { useCrumbs } from "../App.jsx";

const clone = (x) => JSON.parse(JSON.stringify(x));
const TABS = ["Build", "Block", "Page", "Template"];

/**
 * Template designer: pages on the left, the selected page in the middle (drag blocks and fields onto it),
 * and the Build / Block / Page / Template inspector on the right. Preview runs every page with the sample
 * inputs; a clean preview is required before submitting for approval.
 */
export default function Designer({ reportId, catalog, lookups, disclosures, onBack }) {
  const [detail, setDetail] = useState(null);
  const [header, setHeader] = useState(null);
  const [definition, setDefinition] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [pageId, setPageId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState("Build");
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [viewing, setViewing] = useState(null); // a version opened read-only from History
  const [showHistory, setShowHistory] = useState(false);
  const runKeys = useRef({});

  const load = useCallback(async () => {
    const d = await getReport(reportId);
    const current = d.working ?? d.published;
    setDetail(d);
    setHeader({ name: d.name, category: d.category, description: d.description ?? "" });
    setDefinition(clone(current.definition));
    setPageId((id) => (current.definition.pages.some((p) => p.id === id) ? id : current.definition.pages[0]?.id));
    setDirty(false);
    setSelectedId(null);
    return d;
  }, [reportId]);

  useEffect(() => {
    load().catch((e) => setNotice({ kind: "error", text: errorMessage(e) }));
  }, [load]);

  useCrumbs({ back: { label: "Templates", onClick: () => (!dirty || window.confirm("Leave without saving your changes?")) && onBack() }, section: "Templates", title: header?.name ?? "Designer" });

  const shown = viewing?.definition ?? definition;
  const readOnly = Boolean(viewing);
  const page = shown?.pages.find((p) => p.id === pageId) ?? shown?.pages[0];

  // Live sample data for the page on screen: re-run a data block (debounced) whenever it, the scope or the inputs change.
  useEffect(() => {
    if (!page) return undefined;
    const timer = setTimeout(() => {
      for (const block of page.blocks.filter(hasData)) {
        const key = JSON.stringify([block, shown.scope, shown.preview]);
        if (runKeys.current[block.id] === key) continue;
        runKeys.current[block.id] = key;
        setResults((r) => ({ ...r, [block.id]: { ...r[block.id], loading: true } }));
        runBlock(shown.scope, shown.preview, block)
          .then((result) => runKeys.current[block.id] === key && setResults((r) => ({ ...r, [block.id]: { result } })))
          .catch((e) => runKeys.current[block.id] === key && setResults((r) => ({ ...r, [block.id]: { error: errorMessage(e) } })));
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [page, shown]);

  const inputs = useMemo(() => (shown ? detectInputs(shown, catalog) : []), [shown, catalog]);
  const ctx = useMemo(() => shown && placeholderContext({ params: shown.preview, lookups, reportName: header?.name }), [shown, lookups, header]);

  if (!detail || !definition || !header || !page) {
    return <div className="center-message">{notice?.text ?? "Loading template…"}</div>;
  }

  // ---------- editing ----------
  const change = (fn) => {
    setDefinition((d) => {
      const next = clone(d);
      fn(next);
      return next;
    });
    setDirty(true);
  };
  const changePage = (fn) => change((d) => fn(d.pages.find((p) => p.id === page.id)));
  const updateBlock = (id, patch) => changePage((p) => Object.assign(p.blocks.find((b) => b.id === id), patch));
  const insertBlock = (block, index) => {
    const withId = { ...clone(block), id: newBlockId() };
    changePage((p) => p.blocks.splice(index ?? p.blocks.length, 0, withId));
    setSelectedId(withId.id);
    setTab("Block");
  };
  const blockFromPayload = (payload) =>
    payload.kind === "preset"
      ? catalog.presets.find((p) => p.presetKey === payload.key)?.block
      : NEW_BLOCKS.find((b) => b.key === payload.key)?.block;

  const onDropBlock = (payload, index) => {
    if (payload.kind === "move") {
      changePage((p) => {
        const from = p.blocks.findIndex((b) => b.id === payload.id);
        const [moved] = p.blocks.splice(from, 1);
        p.blocks.splice(from < index ? index - 1 : index, 0, moved);
      });
      setSelectedId(payload.id);
    } else if (blockFromPayload(payload)) {
      insertBlock(blockFromPayload(payload), index);
    }
  };

  const onAddFromPalette = (payload) => {
    const at = selectedId ? page.blocks.findIndex((b) => b.id === selectedId) + 1 : page.blocks.length;
    insertBlock(blockFromPayload(payload), at);
  };

  const canAcceptField = (block, payload) => {
    if (!block || block.type !== "data") return false;
    if (payload.kind === "measure") return !measureBlocked(catalog, block, payload.key);
    if (payload.kind === "dimension") return !dimensionBlocked(catalog, block, payload.key);
    return payload.kind === "period";
  };

  const addField = (id, kind, key) => {
    const block = page.blocks.find((b) => b.id === id);
    if (!canAcceptField(block, { kind, key })) return;
    if (kind === "measure") updateBlock(id, { measures: [...block.measures, key] });
    if (kind === "dimension") updateBlock(id, { groupBy: [...block.groupBy, key], sort: catalog.dimensions.find((d) => d.dimensionKey === key)?.isTime ? "label_asc" : block.sort });
    if (kind === "period") updateBlock(id, { period: key });
    setSelectedId(id);
  };

  const selected = page.blocks.find((b) => b.id === selectedId) ?? null;

  const addPage = () => {
    const p = newPage("Portfolio pages", "New page");
    const at = definition.pages.findIndex((x) => x.id === page.id) + 1;
    change((d) => d.pages.splice(at, 0, p));
    setPageId(p.id);
    setSelectedId(null);
    setTab("Page");
  };
  const movePage = (delta) => change((d) => {
    const i = d.pages.findIndex((p) => p.id === page.id);
    const [p] = d.pages.splice(i, 1);
    d.pages.splice(Math.max(0, Math.min(d.pages.length, i + delta)), 0, p);
  });
  const removePage = () => {
    if (definition.pages.length === 1 || !window.confirm(`Remove the page "${page.title}" and its blocks?`)) return;
    const i = definition.pages.findIndex((p) => p.id === page.id);
    change((d) => { d.pages.splice(i, 1); });
    setPageId(definition.pages[Math.max(0, i - 1)].id);
  };

  // ---------- actions ----------
  const body = () => ({ ...header, definition });
  const save = async () => {
    setBusy("save");
    try {
      const d = await saveDraft(reportId, body());
      setDetail(d);
      setDefinition(clone(d.working.definition));
      setDirty(false);
      setNotice({ kind: "ok", text: `Saved as draft v${d.working.versionNo}.` });
      return d;
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const preview = async () => {
    if (dirty && !(await save())) return;
    setBusy("preview");
    try {
      const { run, previewPassed } = await previewDraft(reportId);
      const blocks = Object.fromEntries(allBlocks(definition).map((b) => [b.id, b]));
      for (const b of run.blocks) runKeys.current[b.blockId] = JSON.stringify([blocks[b.blockId], definition.scope, definition.preview]);
      setResults((r) => ({ ...r, ...Object.fromEntries(run.blocks.filter((b) => b.columns.length || b.issues.length || b.error).map((b) => [b.blockId, { result: b }])) }));
      setDetail(await getReport(reportId));
      const failed = run.blocks.filter((b) => b.issues.length || b.error);
      setNotice(previewPassed
        ? { kind: "ok", text: `Preview passed: all ${run.blocks.length} blocks on ${definition.pages.length} pages loaded with the sample inputs. You can submit for approval.` }
        : { kind: "error", text: `Preview found problems in ${failed.length} block(s) on: ${[...new Set(failed.map((b) => definition.pages.find((p) => p.blocks.some((x) => x.id === b.blockId))?.title))].join(", ")}.` });
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    setBusy("submit");
    try {
      const d = await submitDraft(reportId);
      setDetail(d);
      setNotice({ kind: "ok", text: `Version ${d.working.versionNo} submitted. Compliance must approve it before wealth managers can use it.` });
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const openVersion = async (versionNo) => {
    const current = detail.working ?? detail.published;
    if (current && versionNo === current.versionNo) {
      setViewing(null);
      return;
    }
    const v = await getVersion(reportId, versionNo);
    setViewing(v);
    setSelectedId(null);
  };

  // ---------- status ----------
  const { working, published } = detail;
  const nextNo = Math.max(...detail.versions.map((v) => v.versionNo)) + 1;
  const badge = working
    ? `${working.status} v${working.versionNo}${published ? ` · Released v${published.versionNo}` : " · not yet released"}`
    : `Released v${published.versionNo} · changes create v${nextNo}`;

  const blockOk = (b) =>
    hasData(b) ? results[b.id]?.result && results[b.id].result.issues.length === 0 && !results[b.id].result.error : Boolean(b.text || b.title);
  const checks = [
    { label: "Every page has content", ok: definition.pages.every((p) => p.blocks.length > 0) },
    { label: "Saved", ok: !dirty && Boolean(working) },
    { label: "Preview passed on this version", ok: !dirty && Boolean(working?.previewPassed) },
  ];
  const canSubmit = working?.status === "Draft" && checks.every((c) => c.ok);
  const pageIndex = shown.pages.findIndex((p) => p.id === page.id);
  let lastGroup = null;

  return (
    <div className="customize designer">
      <aside className="pages-panel no-print">
        <div className="panel-head">
          <strong>Template pages</strong>
          <span className="muted small">{shown.pages.length} pages</span>
        </div>
        {!readOnly && <button type="button" className="btn small block" onClick={addPage}>+ Add page</button>}
        <nav className="page-list" aria-label="Template pages">
          {shown.pages.map((p, i) => {
            const groupHeader = p.group !== lastGroup ? p.group : null;
            lastGroup = p.group;
            const problems = p.blocks.some((b) => hasData(b) && (results[b.id]?.result?.issues?.length || results[b.id]?.result?.error));
            return (
              <div key={p.id}>
                {groupHeader && <p className="nav-section">{groupHeader}</p>}
                <button type="button" className={`page-link ${p.id === page.id ? "active" : ""}`} onClick={() => { setPageId(p.id); setSelectedId(null); }}>
                  <span className="mono">{String(i + 1).padStart(2, "0")}</span>
                  <span className="grow">{p.title}</span>
                  {problems && <span className="warn" title="A block on this page has a problem">⚠</span>}
                  {p.locked && <span className="lock" title="Locked: required by compliance">🔒</span>}
                </button>
              </div>
            );
          })}
        </nav>
      </aside>

      <section className="canvas">
        <div className="canvas-bar no-print">
          <span className="crumb-line">
            <strong>{header.name}</strong>
            <span className="muted"> · {page.group} · {page.title} · Page {pageIndex + 1} of {shown.pages.length}</span>
          </span>
          <span className={`status-pill ${working?.status === "Submitted" ? "pending" : working ? "draft" : "released"}`}>{badge}{dirty ? " · unsaved" : ""}</span>
          <span className="grow" />
          <button type="button" className="btn small" onClick={() => setShowHistory(true)}>History</button>
          <button type="button" className="btn small" onClick={save} disabled={readOnly || !dirty || busy}>{busy === "save" ? "Saving…" : "Save"}</button>
          <button type="button" className="btn small" onClick={preview} disabled={readOnly || busy || (!working && !dirty)}>{busy === "preview" ? "Running…" : "Preview all"}</button>
          <button type="button" className="btn small primary" onClick={submit} disabled={readOnly || !canSubmit || busy}
            title={canSubmit ? "" : working?.status === "Submitted" ? "Already submitted" : "Complete the checklist under Template first"}>
            {busy === "submit" ? "Submitting…" : "Submit for approval"}
          </button>
        </div>
        {notice && (
          <div className={`notice ${notice.kind} no-print`}>
            {notice.text}
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button>
          </div>
        )}
        {working?.status === "Submitted" && !viewing && <div className="notice info">Version {working.versionNo} is waiting for approval. Saving a change withdraws it back to draft.</div>}
        {working?.reviewComment && working.status === "Draft" && !viewing && <div className="notice error">Returned by {working.reviewedBy}: “{working.reviewComment}”</div>}
        {viewing && (
          <div className="notice info">
            Viewing v{viewing.versionNo} ({viewing.status}) — read only.{" "}
            <button type="button" className="link-button" onClick={() => setViewing(null)}>Back to the current version</button>
          </div>
        )}
        <div className="canvas-scroll" onClick={() => setSelectedId(null)}>
          <PageSheet page={page} ctx={ctx} branding={shown.branding} pageNumber={pageIndex + 1} pageCount={shown.pages.length}
            selectedId={selectedId === null ? null : selectedId} onSelect={(id) => { if (id === "heading") { setSelectedId(null); setTab("Page"); } }}>
            <Page
              blocks={page.blocks}
              selectedId={selectedId}
              onSelect={(id) => { setSelectedId(id); setTab("Block"); }}
              results={results}
              ctx={ctx}
              readOnly={readOnly}
              canAcceptField={canAcceptField}
              onDropBlock={onDropBlock}
              onDropField={(id, p) => addField(id, p.kind, p.key)}
            />
          </PageSheet>
        </div>
      </section>

      <aside className="inspector no-print">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
        <div className="inspector-body">
          {tab === "Build" && (
            <>
              <BlocksPanel presets={catalog.presets} onAdd={onAddFromPalette} disabled={readOnly} />
              <FieldsPanel catalog={catalog} selected={selected} onAddField={addField} disabled={readOnly} />
            </>
          )}
          {tab === "Block" && (
            <BlockSettings
              disclosures={disclosures}
              block={selected}
              state={selected ? results[selected.id] : null}
              catalog={catalog}
              scope={shown.scope}
              readOnly={readOnly}
              onChange={(patch) => updateBlock(selected.id, patch)}
              onRemove={() => { changePage((p) => { p.blocks = p.blocks.filter((b) => b.id !== selected.id); }); setSelectedId(null); }}
              onDuplicate={() => insertBlock({ ...selected, title: `${selected.title} (copy)` }, page.blocks.findIndex((b) => b.id === selected.id) + 1)}
              onAddField={addField}
              canAcceptField={canAcceptField}
            />
          )}
          {tab === "Page" && (
            <fieldset className="plain settings" disabled={readOnly}>
              <h3 className="insp-label">Page</h3>
              <label className="field"><span>Name in the page list</span>
                <input value={page.title} maxLength={80} onChange={(e) => changePage((p) => { p.title = e.target.value; })} /></label>
              <label className="field"><span>Group</span>
                <select value={page.group} onChange={(e) => changePage((p) => { p.group = e.target.value; })}>
                  {PAGE_GROUPS.map((g) => <option key={g}>{g}</option>)}
                </select></label>
              <label className="field"><span>Section label</span>
                <input value={page.sectionLabel} maxLength={80} onChange={(e) => changePage((p) => { p.sectionLabel = e.target.value; })} /></label>
              <label className="field"><span>Heading</span>
                <input value={page.heading} maxLength={120} onChange={(e) => changePage((p) => { p.heading = e.target.value; })} /></label>
              <label className="field"><span>Layout</span>
                <select value={page.layout} onChange={(e) => changePage((p) => { p.layout = e.target.value; })}>
                  {PAGE_LAYOUTS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select></label>
              <label className="field"><span>Show this page only when</span>
                <select value={page.condition ?? ""} onChange={(e) => changePage((p) => { p.condition = e.target.value || null; })}>
                  {CONDITIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select></label>
              <label className="radio">
                <input type="checkbox" checked={page.locked} onChange={(e) => changePage((p) => { p.locked = e.target.checked; })} />
                Locked — required by compliance (wealth managers cannot remove or edit it)
              </label>
              <div className="btn-row">
                <button type="button" className="btn small" disabled={pageIndex === 0} onClick={() => movePage(-1)}>Move up</button>
                <button type="button" className="btn small" disabled={pageIndex === shown.pages.length - 1} onClick={() => movePage(1)}>Move down</button>
                <button type="button" className="btn small danger" disabled={shown.pages.length === 1} onClick={removePage}>Remove page</button>
              </div>
            </fieldset>
          )}
          {tab === "Template" && (
            <>
              <ReportSettings
                readOnly={readOnly}
                report={{
                  header,
                  setHeader: (h) => { setHeader(h); setDirty(true); },
                  scope: shown.scope,
                  setScope: (scope) => change((d) => { d.scope = scope; }),
                }}
              />
              <InputsPanel
                inputs={inputs}
                preview={shown.preview}
                onPreviewChange={(p) => change((d) => { d.preview = p; })}
                lookups={lookups}
                checks={readOnly ? null : checks}
                readOnly={readOnly}
              />
              {!checks[0].ok && <p className="muted small">Pages without blocks: {definition.pages.filter((p) => p.blocks.length === 0).map((p) => p.title).join(", ")}</p>}
              {allBlocks(definition).some((b) => !blockOk(b) && hasData(b) && results[b.id]) && <p className="muted small">Some blocks have problems: run Preview all to check every page.</p>}
            </>
          )}
        </div>
      </aside>

      {showHistory && <HistoryDialog versions={detail.versions} onOpen={openVersion} onClose={() => setShowHistory(false)} />}
    </div>
  );
}
