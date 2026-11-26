import { useEffect, useMemo, useState } from "react";
import {
  decideCoverOptions, discardCoverOptions, errorMessage, getCoverOptions, getCoverTemplates, saveCoverOptions, submitCoverOptions,
} from "../api.js";
import { setCoverOptions } from "../cover.js";
import { Toggle } from "../wealth/CreateReport.jsx";
import { useCrumbs, useStudio } from "../App.jsx";

const clone = (x) => JSON.parse(JSON.stringify(x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const slug = (name) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
const GROUPS = ["Template", "Layout and design", "Branding", "Typography", "Personalisation"];
const valueName = (o, value) => o.values?.find((v) => v.value === value)?.label ?? (value || "None");

/** What a version changes from the one in use, in words a compliance reviewer can check. */
function changes(from, to) {
  const out = [];
  for (const o of to.options) {
    const f = from.options.find((x) => x.key === o.key);
    if (!f) continue;
    if (f.label !== o.label) out.push(`${f.label}: renamed to “${o.label}”.`);
    if (f.agent !== o.agent) out.push(`${o.label}: ${o.agent === "fixed" ? "the cover agent may no longer change it" : "the cover agent may now change it"}.`);
    if (f.planned !== o.planned) out.push(`${o.label}: ${o.planned ? "now planned ahead (instant)" : "no longer planned ahead (quick check instead)"}.`);
    for (const v of o.values ?? []) {
      const was = f.values?.find((x) => x.value === v.value);
      if (!was) out.push(`${o.label}: added “${v.label}”${v.colour ? ` (${v.colour})` : ""}${v.enabled ? "" : ", switched off"}.`);
      else {
        if (was.enabled !== v.enabled) out.push(`${o.label}: “${v.label}” switched ${v.enabled ? "on" : "off"}.`);
        if (was.label !== v.label) out.push(`${o.label}: “${was.label}” renamed to “${v.label}”.`);
        if (v.colour && was.colour !== v.colour) out.push(`${o.label}: “${v.label}” colour ${was.colour} → ${v.colour}.`);
      }
    }
    for (const v of f.values ?? []) if (!o.values?.some((x) => x.value === v.value)) out.push(`${o.label}: removed “${v.label}”.`);
    const order = (x) => (x.values ?? []).map((v) => v.value).filter((v) => (f.values ?? []).some((y) => y.value === v) && (o.values ?? []).some((y) => y.value === v));
    if (!same(order(f), order(o))) out.push(`${o.label}: values reordered.`);
  }
  return out;
}

/**
 * Cover options (V10, Agent studio): what the Cover tab offers and what the cover agent may do, configured in the platform.
 * The reporting admin switches values on and off, names and orders them, adds colour themes and business tags, and sets what
 * the agent may change and which choices it plans ahead; compliance approves each version. What a cover can draw stays in code.
 */
export default function CoverOptions() {
  const { role } = useStudio();
  const [data, setData] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [draft, setDraft] = useState(null);
  const [comment, setComment] = useState("");
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  useCrumbs({ section: "Agent studio", title: "Cover options" });
  const designer = role === "Designer", approver = role === "Approver";

  const load = () => Promise.all([getCoverOptions(), getCoverTemplates()]).then(([d, t]) => {
    setData(d);
    setTemplates(t.templates.filter((x) => x.approved));
    setDraft(clone((d.working?.set ?? d.approved).options));
    setCoverOptions(d.approved); // a newly approved version applies to every cover from now on
  }).catch((e) => setNotice({ kind: "error", text: errorMessage(e) }));
  useEffect(() => { load(); }, []);

  const working = data?.working;
  const base = working?.set ?? data?.approved;
  const editable = designer && (!working || working.status === "Draft");
  const dirty = !!draft && !!base && !same(draft, base.options);
  const shown = useMemo(() => (draft ? { options: draft } : null), [draft]);
  const diff = data && shown ? changes(data.approved, shown) : [];
  // Approved cover templates that use a value this version switches off: their covers say "no longer offered".
  const clashes = shown ? templates.flatMap((t) => shown.options.filter((o) => o.values).flatMap((o) => {
    const v = t.approved.settings[o.key];
    const found = o.values.find((x) => x.value === v);
    return found && !found.enabled ? [`Cover template “${t.name}” uses ${o.label}: ${found.label}, which is switched off.`] : [];
  })) : [];

  const act = async (fn, ok) => {
    setBusy(true);
    setNotice(null);
    try { await fn(); await load(); setNotice({ kind: "ok", text: ok }); setComment(""); } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    setBusy(false);
  };
  const update = (key, patch) => setDraft(draft.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  const setValue = (o, i, patch) => update(o.key, { values: o.values.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  const move = (o, i, d) => {
    const values = [...o.values];
    [values[i], values[i + d]] = [values[i + d], values[i]];
    update(o.key, { values });
  };

  if (!data || !draft) return <div className="center-message">{notice?.text ?? "Loading…"}</div>;
  const inUse = data.approvedVersion;

  return (
    <div className="page-pad cover-options">
      <p className="eyebrow">Agent studio · governed configuration</p>
      <h1 className="display">Cover options</h1>
      <p className="muted">What the Cover tab offers wealth managers and designers, and what the cover agent may do with it. Switch values on or off,
        rename and order them, add colour themes and business tags, and choose which options the agent may change and which choices it plans ahead
        (instant) rather than checks with a quick call. Compliance approves each version before it is used.
        New layouts, band shapes, images and fonts need their drawing in code first; they then appear here switched off.</p>
      {notice && <div className={`notice ${notice.kind} pre-line`}>{notice.text}</div>}

      <section className="card co-status">
        <div className="inline-row">
          <p className="small">
            <strong>In use:</strong> {data.approved.version ? `version ${data.approved.version}` : "the built-in options"}
            {inUse?.reviewedBy ? `, approved by ${inUse.reviewedBy} on ${new Date(inUse.reviewedOn).toLocaleDateString("en-GB")}` : ""}.
            {working && <> {" "}<span className={`status-pill ${working.status === "Submitted" ? "pending" : "draft"}`}>
              {working.status === "Submitted" ? `Version ${working.version} waiting for approval` : `Draft version ${working.version}`}</span></>}
          </p>
          {designer && (
            <div className="btn-row">
              <button type="button" className="btn" disabled={!editable || !dirty || busy} onClick={() => act(() => saveCoverOptions({ options: draft }), "Draft saved.")}>Save draft</button>
              <button type="button" className="btn primary" disabled={working?.status !== "Draft" || dirty || busy} title={dirty ? "Save the draft first" : undefined}
                onClick={() => act(submitCoverOptions, "Submitted to compliance.")}>Submit for approval</button>
              {(working?.status === "Draft" || dirty) && <button type="button" className="link-button" disabled={busy}
                onClick={() => (working?.status === "Draft" ? act(discardCoverOptions, "Draft discarded.") : setDraft(clone(base.options)))}>Discard changes</button>}
            </div>
          )}
        </div>
        {working?.reviewComment && working.status === "Draft" && <div className="notice error small">Returned by {working.reviewedBy}: “{working.reviewComment}”</div>}
        {approver && working?.status === "Submitted" && (
          <div className="ct-decide">
            <p className="small">Submitted by {working.submittedBy}. Below is the version waiting for approval{diff.length ? ", with what it changes" : ""}.</p>
            <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (required when returning)" />
            <div className="btn-row">
              <button type="button" className="btn primary" disabled={busy} onClick={() => act(() => decideCoverOptions(true, comment || null), "Approved: the Cover tab and the cover agent use these options now.")}>Approve</button>
              <button type="button" className="btn" disabled={busy || !comment.trim()} onClick={() => act(() => decideCoverOptions(false, comment), "Returned to the reporting admin.")}>Return</button>
            </div>
          </div>
        )}
        {(diff.length > 0 || clashes.length > 0) && (
          <div className="co-diff">
            {diff.length > 0 && <><p className="small"><strong>Changes from the version in use ({diff.length})</strong></p><ul className="small">{diff.map((d) => <li key={d}>{d}</li>)}</ul></>}
            {clashes.map((c) => <p key={c} className="small">⚠ {c}</p>)}
          </div>
        )}
      </section>

      {GROUPS.map((g) => (
        <section key={g}>
          <h2 className="co-group">{g}</h2>
          <div className="co-grid">
            {draft.filter((o) => o.group === g).map((o) => (
              <OptionCard key={o.key} o={o} editable={editable} was={data.approved.options.find((x) => x.key === o.key)}
                onChange={(patch) => update(o.key, patch)} setValue={(i, patch) => setValue(o, i, patch)} move={(i, d) => move(o, i, d)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function OptionCard({ o, was, editable, onChange, setValue, move }) {
  const [name, setName] = useState("");
  const [colour, setColour] = useState("#335c4c");
  const theme = o.key === "theme";
  const add = () => {
    const value = theme ? slug(name) : name.trim();
    if (!value || o.values.some((v) => v.value === value || v.label === name.trim())) return;
    onChange({ values: [...o.values, { value, label: name.trim(), enabled: true, builtIn: false, ...(theme ? { colour } : {}) }] });
    setName("");
  };
  const on = o.values?.filter((v) => v.enabled).length ?? 0;
  return (
    <div className={`card co-option${was && !same(was, o) ? " changed" : ""}`}>
      <div className="co-head">
        <input className="co-name" value={o.label} maxLength={40} disabled={!editable} aria-label="Option name" onChange={(e) => onChange({ label: e.target.value })} />
        {o.values && <span className="small muted">{on} of {o.values.length} on</span>}
      </div>
      <div className="co-flags">
        <label className="small"><Toggle checked={o.agent === "change"} disabled={!editable} label="The cover agent may change it"
          onChange={(v) => onChange({ agent: v ? "change" : "fixed" })} /> {o.key === "templateId" ? "Agent may recommend a template" : "Agent may change it"}</label>
        {o.plannable && <label className="small"><Toggle checked={o.planned} disabled={!editable} label="Planned ahead"
          onChange={(v) => onChange({ planned: v })} /> Planned ahead (instant)</label>}
      </div>
      {o.key === "templateId" && <p className="small muted">The templates themselves are made in Cover templates and approved there.</p>}
      {!o.values && o.key !== "templateId" && <p className="small muted">{o.key === "overlay" ? "A slider from 0 to 80%." : o.key === "coBrand" ? "Text: the agent may only use the client's recorded co-brand name." : "On or off."}</p>}
      {o.values && (
        <table className="co-values">
          <tbody>
            {o.values.map((v, i) => (
              <tr key={v.value} className={v.enabled ? "" : "off"}>
                <td><input type="checkbox" checked={v.enabled} disabled={!editable} aria-label={`Offer ${v.label}`} onChange={(e) => setValue(i, { enabled: e.target.checked })} /></td>
                {theme && <td><input type="color" value={v.colour} disabled={!editable} aria-label={`${v.label} colour`} onChange={(e) => setValue(i, { colour: e.target.value })} /></td>}
                <td><input value={v.label} maxLength={60} disabled={!editable} aria-label="Name" onChange={(e) => setValue(i, { label: e.target.value })} /></td>
                <td className="small muted">{v.builtIn ? "" : "added"}{!was?.values?.some((x) => x.value === v.value) && v.builtIn ? "new in code" : ""}</td>
                <td className="co-order">
                  <button type="button" className="mini" disabled={!editable || i === 0} aria-label="Move up" onClick={() => move(i, -1)}>↑</button>
                  <button type="button" className="mini" disabled={!editable || i === o.values.length - 1} aria-label="Move down" onClick={() => move(i, 1)}>↓</button>
                  {!v.builtIn && <button type="button" className="mini" disabled={!editable} aria-label={`Remove ${v.label}`}
                    onClick={() => onChange({ values: o.values.filter((_, j) => j !== i) })}>✕</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {o.addable && editable && (
        <div className="co-add">
          {theme && <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} aria-label="New theme colour" />}
          <input value={name} maxLength={60} placeholder={theme ? "New colour theme, e.g. Forest green" : "New business tag"} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()} />
          <button type="button" className="btn small" disabled={!name.trim() || (theme && slug(name).length < 2)} onClick={add}>Add</button>
        </div>
      )}
    </div>
  );
}
