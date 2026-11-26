import { useEffect, useState } from "react";
import { approveVersion, errorMessage, getReport, getReports, rejectVersion, runVersion } from "../api.js";
import InputsForm from "./InputsForm.jsx";
import ReportView from "./ReportView.jsx";
import { allBlocks, placeholderContext } from "../rules.js";
import { useCrumbs, useStudio } from "../App.jsx";

/** Approver (Governance): queue of submitted template versions; open one to review, then approve or return. */
export default function ApproverHome({ onOpen }) {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);
  useCrumbs({ section: "Review & publish", title: "Template approvals" });

  useEffect(() => {
    getReports().then(setReports).catch((e) => setError(errorMessage(e)));
  }, []);

  const queue = (reports ?? []).filter((r) => r.workingStatus === "Submitted");
  const setOpenId = onOpen;
  return (
    <div className="page-pad">
      <p className="eyebrow">Template approvals</p>
      <h1 className="display">Waiting for approval</h1>
      {error && <div className="notice error">{error}</div>}
      {reports && queue.length === 0 && <p className="muted">Nothing is waiting for approval.</p>}
      <div className="card-grid">
        {queue.map((r) => (
          <button key={r.reportId} type="button" className="report-card" onClick={() => setOpenId(r.reportId)}>
            <span className="category">{r.category}</span>
            <strong>{r.name}</strong>
            <span className="versions">
              <span className="status submitted">Submitted v{r.workingVersionNo}</span>
              {r.publishedVersionNo && <span className="status published">replaces v{r.publishedVersionNo}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Page- and block-level differences between the submitted version and the released one. */
function changes(working, published) {
  if (!published) return [{ kind: "added", text: "New template (no released version yet)" }];
  const before = new Map(allBlocks(published.definition).map((b) => [b.id, b]));
  const after = new Map(allBlocks(working.definition).map((b) => [b.id, b]));
  const pagesBefore = new Map(published.definition.pages.map((p) => [p.id, p]));
  const pagesAfter = new Map(working.definition.pages.map((p) => [p.id, p]));
  const list = [];
  if (working.definition.scope !== published.definition.scope)
    list.push({ kind: "changed", text: `Scope: ${published.definition.scope} → ${working.definition.scope}` });
  const meta = (p) => JSON.stringify({ ...p, blocks: undefined });
  for (const [id, p] of pagesAfter) {
    if (!pagesBefore.has(id)) list.push({ kind: "added", text: `Added page: ${p.title}` });
    else if (meta(p) !== meta(pagesBefore.get(id))) list.push({ kind: "changed", text: `Page settings changed: ${p.title}${p.locked !== pagesBefore.get(id).locked ? (p.locked ? " (now locked)" : " (now unlocked)") : ""}` });
  }
  for (const [id, p] of pagesBefore) if (!pagesAfter.has(id)) list.push({ kind: "removed", text: `Removed page: ${p.title}` });
  for (const [id, b] of after) {
    if (!before.has(id)) list.push({ kind: "added", text: `Added: ${b.title || b.disclosureCode || b.type}` });
    else if (JSON.stringify(b) !== JSON.stringify(before.get(id))) list.push({ kind: "changed", text: `Changed: ${b.title || b.type}` });
  }
  for (const [id, b] of before) if (!after.has(id)) list.push({ kind: "removed", text: `Removed: ${b.title || b.type}` });
  const order = (d) => allBlocks(d).map((b) => b.id).filter((id) => before.has(id) && after.has(id)).join();
  if (order(working.definition) !== order(published.definition)) list.push({ kind: "changed", text: "Blocks or pages reordered" });
  return list.length ? list : [{ kind: "changed", text: "No block changes" }];
}

export function Review({ reportId, lookups, onBack }) {
  const { user } = useStudio();
  const [detail, setDetail] = useState(null);
  const [params, setParams] = useState({});
  const [run, setRun] = useState(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    getReport(reportId).then((d) => {
      setDetail(d);
      setParams(d.working?.definition.preview ?? d.published?.definition.preview ?? {});
    }).catch((e) => setNotice({ kind: "error", text: errorMessage(e) }));
  }, [reportId]);

  const version = detail?.working ?? detail?.published;
  const doRun = async () => {
    setBusy(true);
    try {
      setRun(await runVersion(reportId, version.versionNo, params));
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (version) doRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version?.versionId]);

  useCrumbs({ back: { label: "Template approvals", onClick: onBack }, section: "Review & publish", title: detail ? `Review — ${detail.name}` : "Review" });
  if (!detail) return <div className="center-message">{notice?.text ?? "Loading…"}</div>;
  const submitted = detail.working?.status === "Submitted";

  const decide = async (approve) => {
    setBusy(true);
    try {
      const d = approve
        ? await approveVersion(reportId, version.versionNo, comment)
        : await rejectVersion(reportId, version.versionNo, comment);
      setDetail(d);
      setNotice({ kind: "ok", text: approve ? `Version ${version.versionNo} is released. Wealth managers can now use it.` : `Version ${version.versionNo} was returned to the designer.` });
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="review">
      <div className="review-head">
        <h1 className="display small">Review — {detail.name}</h1>
        {submitted && detail.working.submittedBy === user.userId && <span className="status-pill blocked">You submitted this version: another approver must review it</span>}
        <span className={`status-pill ${submitted ? "pending" : "released"}`}>
          {submitted ? `Submitted v${detail.working.versionNo} by ${detail.working.submittedBy}` : `Released v${detail.published?.versionNo}`}
        </span>
      </div>
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}

      <div className="review-grid">
        <aside className="panel">
          <h2 className="panel-title">Decision</h2>
          <div className="panel-body">
            {submitted ? (
              <>
                <p className="sub-label">Changes since the published version</p>
                <ul className="changes">
                  {changes(detail.working, detail.published).map((c) => (
                    <li key={c.text} className={c.kind}>{c.text}</li>
                  ))}
                </ul>
                <label className="field">
                  <span>Comment (required when returning)</span>
                  <textarea rows={3} value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
                </label>
                <div className="decision-buttons">
                  <button type="button" className="submit" disabled={busy || !run || run.blocks.some((b) => b.error || b.issues.length)} onClick={() => decide(true)}>
                    Approve and release
                  </button>
                  <button type="button" className="ghost danger" disabled={busy || !comment.trim()} onClick={() => decide(false)}>
                    Return to designer
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">Nothing to decide: this report has no submitted version.</p>
            )}

            <p className="sub-label">Run with</p>
            <InputsForm inputs={detail.inputs} values={params} onChange={setParams} lookups={lookups} compact />
            <button type="button" className="btn" onClick={doRun} disabled={busy}>Run</button>
          </div>
        </aside>
        <section className="panel">
          <h2 className="panel-title">v{version.versionNo} as wealth managers will see it (SQL shown for review)</h2>
          {run ? (
            <ReportView definition={run.definition} results={run.blocks} showSql
              ctx={placeholderContext({ params: run.parameters, lookups, reportName: detail.name })} />
          ) : <p className="center-message">Running…</p>}
        </section>
      </div>
    </div>
  );
}
