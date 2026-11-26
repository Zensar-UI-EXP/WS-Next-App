import { useEffect, useState } from "react";
import { createCoverTemplate, decideCoverTemplate, errorMessage, getCoverTemplates, saveCoverTemplate, submitCoverTemplate } from "../api.js";
import CoverEditor from "../components/CoverEditor.jsx";
import CoverSheet from "../components/CoverSheet.jsx";
import { useCrumbs, useStudio } from "../App.jsx";

const clone = (x) => JSON.parse(JSON.stringify(x));
// A sample client for the preview; placeholders are filled from it.
const SAMPLE = {
  "{Client}": "Marula Family", "{Portfolio}": "household portfolio", "{Period}": "1 January 2025 – 31 December 2025", "{From date}": "1 January 2025",
  "{To date}": "31 December 2025", "{As of date}": "31 December 2025", "{Run date}": "9 November 2026", "{Report name}": "Annual review 2025",
  "{Relationship manager}": "Eleanor Hartley",
};

/**
 * Cover templates (V7): designers create a cover or change one (a draft version) and submit it; compliance approves it or
 * returns it with a comment. Wealth managers and the reporting agent can only use approved covers; reports keep the version
 * they were made from.
 */
export default function CoverTemplates() {
  const { role } = useStudio();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null); // { name, segment, description, settings }
  const [comment, setComment] = useState("");
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  useCrumbs({ section: "Report", title: "Cover templates" });
  const designer = role === "Designer", approver = role === "Approver";

  const load = (pick) => getCoverTemplates().then((d) => {
    setData(d);
    const t = d.templates.find((x) => x.coverTemplateId === (pick ?? selected)) ?? d.templates[0];
    if (t) open(t);
  }).catch((e) => setNotice({ kind: "error", text: errorMessage(e) }));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (t) => {
    setSelected(t.coverTemplateId);
    const v = t.working ?? t.approved;
    setDraft({ name: t.name, segment: t.segment, description: t.description, settings: clone(v.settings) });
    setComment("");
  };
  const act = async (fn, ok) => {
    setBusy(true);
    setNotice(null);
    try { const id = await fn(); setNotice({ kind: "ok", text: ok }); await load(id ?? selected); } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    setBusy(false);
  };

  if (!data) return <div className="center-message">{notice?.text ?? "Loading…"}</div>;
  const t = data.templates.find((x) => x.coverTemplateId === selected);
  const working = t?.working;
  const editable = designer && (!t || !working || working.status === "Draft");

  return (
    <div className="page-pad cover-templates">
      <p className="eyebrow">Report · governed covers</p>
      <h1 className="display">Cover templates</h1>
      <p className="muted">Designers make covers, compliance approves them, and wealth managers and the agents pick from the approved ones.
        Every cover must keep a classification line and the legal entity line; images come from the approved library.</p>
      {notice && <div className={`notice ${notice.kind} pre-line`}>{notice.text}</div>}
      <div className="ct-grid">
        <aside className="card ct-list">
          {designer && <button type="button" className="btn small block" onClick={() => {
            setSelected(null);
            setDraft({ name: "New cover", segment: "All", description: "Describe when to use this cover.", settings: clone((data.templates[0]?.approved ?? data.templates[0]?.working).settings) });
          }}>＋ New cover template</button>}
          {data.templates.map((x) => (
            <button key={x.coverTemplateId} type="button" className={`ct-item ${x.coverTemplateId === selected ? "on" : ""}`} onClick={() => open(x)}>
              <strong>{x.name}</strong>
              <span className="small muted">{x.segment}</span>
              <span className="small">
                {x.approved ? <span className="status-pill released">Approved v{x.approved.version}</span> : null}{" "}
                {x.working && <span className={`status-pill ${x.working.status === "Submitted" ? "pending" : "draft"}`}>{x.working.status === "Submitted" ? "Waiting for approval" : "Draft"} v{x.working.version}</span>}
              </span>
            </button>
          ))}
        </aside>
        <section className="ct-preview">
          {draft && <CoverSheet cover={draft.settings} ctx={SAMPLE} />}
        </section>
        <aside className="card ct-inspector">
          {draft && (
            <>
              <label className="insp-field"><span>Name</span><input value={draft.name} disabled={!editable} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
              <div className="insp-row"><span>Client segment</span>
                <select value={draft.segment} disabled={!editable} onChange={(e) => setDraft({ ...draft, segment: e.target.value })}>
                  {data.segments.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <label className="insp-field"><span>When to use it</span><textarea rows={2} value={draft.description} disabled={!editable} maxLength={400} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
              {working?.reviewComment && working.status === "Draft" && <div className="notice error small">Returned by {working.reviewedBy}: “{working.reviewComment}”</div>}
              {designer && (
                <div className="btn-row">
                  <button type="button" className="btn" disabled={!editable || busy} onClick={() => act(() => (t ? saveCoverTemplate(t.coverTemplateId, draft) : createCoverTemplate(draft)).then((x) => x.coverTemplateId), "Draft saved.")}>Save draft</button>
                  <button type="button" className="btn primary" disabled={!t || !working || working.status !== "Draft" || busy} onClick={() => act(() => submitCoverTemplate(t.coverTemplateId).then(() => t.coverTemplateId), "Submitted to compliance.")}>Submit for approval</button>
                </div>
              )}
              {approver && working?.status === "Submitted" && (
                <div className="ct-decide">
                  <p className="small">Submitted by {working.submittedBy}. The preview shows the version waiting for approval.</p>
                  <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (required when returning)" />
                  <div className="btn-row">
                    <button type="button" className="btn primary" disabled={busy} onClick={() => act(() => decideCoverTemplate(t.coverTemplateId, true, comment || null).then(() => t.coverTemplateId), "Approved: wealth managers and the agents can use it.")}>Approve</button>
                    <button type="button" className="btn" disabled={busy || !comment.trim()} onClick={() => act(() => decideCoverTemplate(t.coverTemplateId, false, comment).then(() => t.coverTemplateId), "Returned to the designer.")}>Return</button>
                  </div>
                </div>
              )}
              <CoverEditor cover={draft.settings} templates={data.templates} readOnly={!editable} templateMode onChange={(settings) => setDraft({ ...draft, settings })} />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
