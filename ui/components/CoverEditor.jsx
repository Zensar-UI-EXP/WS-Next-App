import { COVER_CHOICES, coverChoices, coverFromTemplate, coverOption, coverOptions, coverValueLabel, coverWarnings } from "../cover.js";
import { PLACEHOLDERS } from "../rules.js";
import { Toggle } from "../wealth/CreateReport.jsx";

const WORDS = ["eyebrow", "title", "subtitle", "reportType", "headline", "note"];
const words = (c) => Object.fromEntries(WORDS.map((k) => [k, c?.[k]]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const LABELS = {
  templateId: "Cover template", layout: "Layout", band: "Colour band", bandAngle: "Band shape", image: "Background image", overlay: "Image overlay",
  titlePosition: "Title position", titleAlign: "Title alignment", theme: "Colour theme", logo: "Logo", logoPosition: "Logo position", logoSize: "Logo size",
  coBrand: "Co-brand", businessTag: "Business tag", titleFont: "Title font", titleSize: "Title size", titleWeight: "Title weight",
  letterSpacing: "Letter spacing", eyebrowCase: "Eyebrow and labels", language: "Cover language", salutation: "Name on the cover", rmCard: "Relationship manager card",
};
/** The option's name: as the cover options call it (V10), else the built-in name. */
const label = (key) => coverOption(key)?.label ?? LABELS[key] ?? key;

/**
 * The cover editor (V10 inspector tab; the values on offer come from the approved cover options). Every customisation is an option; the cover agent works behind the options:
 * it marks the option it recommends for this client (★, with a reason), and when you make a choice it changes the other
 * options that go with it straight away (from its plan, or after a quick check), each with a reason and an Undo.
 * Compliance's required elements are checked as before. Without an agent (designing a cover template) the options work on their own.
 */
export default function CoverEditor({ cover, templates, segment, onChange, readOnly, templateMode = false, agent = null }) {
  const approved = templates?.filter((t) => t.approved) ?? [];
  const set = (patch) => onChange({ ...cover, ...patch });
  const recs = Object.fromEntries((agent?.plan?.recommendations ?? []).map((p) => [p.key, p]));
  const follow = Object.fromEntries((agent?.last?.changes ?? []).filter((c) => !c.undone).map((c) => [c.key, c]));
  const show = (key, value) => {
    if (key === "templateId") return approved.find((t) => t.coverTemplateId === Number(value))?.name ?? `template ${value}`;
    if (typeof value === "boolean") return value ? "On" : "Off";
    if (key === "overlay") return `${Math.round(Number(value) * 100)}%`;
    if (key === "coBrand") return value ? `“${value}”` : "none";
    return coverValueLabel(key, value) ?? COVER_CHOICES[key]?.find(([v]) => v === value)?.[1] ?? String(value);
  };

  if (!cover) {
    return (
      <div className="cover-editor">
        <p className="guide">This report uses the plain cover page. Pick an approved cover template to design the cover{agent ? "; the cover agent then recommends the options for this client" : ""}.</p>
        <TemplatePicker templates={approved} segment={segment} onPick={(t) => onChange(coverFromTemplate(t, { title: "{Report name}", subtitle: "{Portfolio}" }))} />
      </div>
    );
  }
  const checked = coverWarnings(cover, approved);
  // Designing a template: it is not made from a template itself.
  const blockers = checked.blockers, warnings = templateMode ? checked.warnings.filter((w) => !w.includes("template")) : checked.warnings;

  /** The agent's word on one option: what it just changed (with Undo), or its recommendation when the cover differs from it. */
  const hint = (key) => {
    if (!agent || readOnly) return null;
    const f = follow[key];
    if (f) return (
      <div className="agent-hint follow">
        <span><strong>Agent changed {show(key, f.current)} → {show(key, f.value)}</strong> · {f.reason}</span>
        <span className="agent-hint-actions"><button type="button" className="mini" onClick={() => agent.undo([key])}>Undo</button></span>
      </div>
    );
    const r = recs[key];
    if (r && !same(r.value, cover[key])) return (
      <div className="agent-hint">
        <span>★ Recommended: <strong>{show(key, r.value)}</strong> · {r.reason}</span>
        <span className="agent-hint-actions"><button type="button" className="mini" onClick={() => agent.applyRecommendation([key])}>Use</button></span>
      </div>
    );
    return null;
  };
  const star = (key) => {
    const r = recs[key];
    return r && same(r.value, cover[key]) ? <span className="agent-star" title={`Recommended by the cover agent: ${r.reason}`}> ★</span> : null;
  };
  const rowClass = (key) => `insp-row${follow[key] ? " agent-proposed" : ""}`;
  const choice = (key) => (
    <div className="agent-field" key={key}>
      <div className={rowClass(key)}>
        <span>{label(key)}{star(key)}</span>
        <select value={cover[key]} onChange={(e) => set({ [key]: e.target.value })} disabled={readOnly}>
          {coverChoices(key, cover[key]).map(([v, l]) => <option key={v} value={v}>{l}{recs[key]?.value === v ? "  ★" : ""}</option>)}
        </select>
      </div>
      {hint(key)}
    </div>
  );
  const text = (key, label, max = 120, note) => (
    <div className="agent-field" key={key}>
      <label className={`insp-field${follow[key] ? " agent-proposed" : ""}`}>
        <span>{label}{star(key)}{note && <em className="muted small"> · {note}</em>}</span>
        <input value={cover[key] ?? ""} maxLength={max} disabled={readOnly} onChange={(e) => set({ [key]: e.target.value })} />
      </label>
      {hint(key)}
    </div>
  );
  const toggle = (key, name = label(key), disabled = false) => (
    <div className="agent-field" key={key}>
      <div className={rowClass(key)}><span>{name}{star(key)}</span><Toggle checked={!!cover[key]} disabled={readOnly || disabled} label={name} onChange={(v) => set({ [key]: v })} /></div>
      {hint(key)}
    </div>
  );

  return (
    <fieldset className="plain cover-editor" disabled={readOnly}>
      {agent && !readOnly && <AgentPanel agent={agent} show={show} cover={cover} />}
      {(blockers.length > 0 || warnings.length > 0) && (
        <div className={`validity ${blockers.length ? "bad" : ""}`}>
          {blockers.map((b) => <p key={b}>⛔ {b}</p>)}
          {warnings.map((w) => <p key={w}>⚠ {w}</p>)}
        </div>
      )}
      {!templateMode && <details open>
        <summary>Cover template</summary>
        <p className="small muted">{cover.templateName ? `${cover.templateName} · v${cover.templateVersion}` : "Not from a template"}. Switching keeps your words.</p>
        <TemplatePicker templates={approved} segment={segment} current={cover.templateId} recommended={recs.templateId}
          onPick={(t) => onChange(coverFromTemplate(t, words(cover)))} />
        {hint("templateId")}
      </details>}
      <details open>
        <summary>Layout and design</summary>
        {["layout", "band", "bandAngle", "image"].map((k) => choice(k))}
        <div className="agent-field">
          <div className={rowClass("overlay")}>
            <span>{label("overlay")}{star("overlay")}</span>
            <input type="range" min="0" max="0.8" step="0.05" value={cover.overlay} disabled={readOnly || cover.image === "none"} onChange={(e) => set({ overlay: Number(e.target.value) })} aria-label="Image overlay" />
          </div>
          {hint("overlay")}
        </div>
        {["titlePosition", "titleAlign"].map((k) => choice(k))}
      </details>
      <details open>
        <summary>Branding</summary>
        {["theme", "logo", "logoPosition", "logoSize"].map((k) => choice(k))}
        {text("coBrand", `${label("coBrand")} (partner, trust or family office)`, 60)}
        {choice("businessTag")}
      </details>
      <details open>
        <summary>Typography</summary>
        {["titleFont", "titleSize", "titleWeight", "letterSpacing", "eyebrowCase"].map((k) => choice(k))}
      </details>
      <details open>
        <summary>Personalisation</summary>
        {choice("language")}
        {choice("salutation")}
        {toggle("rmCard")}
        <p className="small muted">The cover labels follow the language; the report itself stays in English. The card shows the relationship manager's name and initials.</p>
      </details>
      <details>
        <summary>Words</summary>
        {text("eyebrow", "Eyebrow", 80)}
        {text("title", "Title", 120)}
        {text("subtitle", "Subtitle", 160)}
        {text("reportType", "Report type label", 60, "e.g. Annual review")}
        {text("headline", "Headline figure", 200, "verified figures only")}
        {text("note", "Personal note", 300)}
        <div className="chip-row">{PLACEHOLDERS.map((p) => <span key={p} className="mini" title="Placeholder you can type into the words">{p}</span>)}</div>
        {toggle("preparedFor", "Prepared for")}
        {toggle("preparedBy", "Prepared by (relationship manager)")}
        <div className="insp-row"><span>Date</span>
          <select value={cover.dateMode} onChange={(e) => set({ dateMode: e.target.value })} disabled={readOnly}>
            {COVER_CHOICES.dateMode.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </details>
      <details>
        <summary>Compliance</summary>
        <div className="insp-row"><span>Classification</span>
          <select value={cover.classification} onChange={(e) => set({ classification: e.target.value })} disabled={readOnly}>
            {COVER_CHOICES.classification.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {toggle("legalLine", "Legal entity line (required)")}
        <p className="small muted">Required by compliance: a classification line and the legal entity line. Images come only from the approved library.</p>
      </details>
      <details>
        <summary>Output</summary>
        {toggle("backCover", "Back cover")}
        <div className="insp-row"><span>PDF / print cover</span>
          <select value={cover.printVariant} onChange={(e) => set({ printVariant: e.target.value })} disabled={readOnly}>
            {COVER_CHOICES.printVariant.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </details>
    </fieldset>
  );
}

/** What the cover agent is doing, what it changed with your latest choice, and its recommendations for this client. */
function AgentPanel({ agent, show, cover }) {
  const { working, error, last, plan, usage } = agent;
  const differ = (plan?.recommendations ?? []).filter((p) => !same(p.value, cover[p.key]));
  const tokens = (usage ?? []).reduce((s, u) => s + (u.tokens ?? 0), 0);
  const calls = (usage ?? []).find((u) => u.mode === "decide")?.runs ?? 0;
  const live = last?.changes.filter((c) => !c.undone) ?? [];
  const choice = last && last.choice.keys.map((k) => `${label(k)} → ${show(k, last.choice.cover[k])}`).join(", ");
  const how = last?.source === "plan" ? "Instant, from the agent's plan." : last?.ms != null
    ? `${last.source === "plan+agent" ? "From the plan, then checked" : "Decided"} in ${(last.ms / 1000).toFixed(1)} s · ${(last.tokens / 1000).toFixed(1)}k tokens.` : "";
  return (
    <div className="agent-panel">
      <div className="agent-panel-head">
        <strong>Cover agent</strong>
        {tokens > 0 && <span className="small muted">{(tokens / 1000).toFixed(1)}k tokens on this cover{calls ? ` · ${calls} quick call${calls === 1 ? "" : "s"}` : ""}</span>}
      </div>
      {working && (
        <p className="small agent-working"><span className="spinner-dot" /> {working === "plan"
          ? "Planning ahead: recommendations for this client and what goes with each choice…"
          : `Checking ${choice ?? "your change"}…`}</p>
      )}
      {error && <div className="notice error small">{error}</div>}
      {last && !last.pending && (live.length > 0 ? (
        <div className="agent-follow">
          <p className="small"><strong>With {choice}, the agent also changed:</strong> {last.summary ?? ""}</p>
          <ul>{live.map((c) => (
            <li key={c.key}><strong>{label(c.key)}</strong>: {show(c.key, c.current)} → <strong>{show(c.key, c.value)}</strong>{" "}
              <button type="button" className="link-button small" onClick={() => agent.undo([c.key])}>Undo</button><br /><span className="muted">{c.reason}</span></li>
          ))}</ul>
          <div className="btn-row">
            {live.length > 1 && <button type="button" className="btn small" onClick={() => agent.undo(live.map((c) => c.key))}>Undo all</button>}
            <span className="small muted">{how}</span>
          </div>
        </div>
      ) : (
        <p className="small agent-fine">✓ {choice}: nothing else needs to change. <span className="muted">{last.changes.length ? "You undid the agent's changes. " : ""}{how || last.summary || ""}</span>{" "}
          <button type="button" className="link-button" onClick={agent.clearLast}>OK</button></p>
      ))}
      {plan && (
        <div className="agent-recs">
          <p className="small">★ <strong>Recommended for this client:</strong> {plan.summary}</p>
          <p className="small muted">{differ.length ? `${differ.length} option${differ.length === 1 ? " differs" : "s differ"} from the recommendation.` : "The cover follows every recommendation."}
            {plan.base?.templateVersion != null && cover.templateId === plan.base.templateId && cover.templateVersion !== plan.base.templateVersion ? " Made for an earlier template version." : ""}
            {plan.base && (plan.base.optionsVersion ?? null) !== (coverOptions()?.version ?? null) ? " The cover options have changed since this plan: plan again to use them." : ""}</p>
          <p className="small muted">Planned ahead for {plan.plan?.length ?? 0} choice{plan.plan?.length === 1 ? "" : "s"}{plan.ms ? ` in ${(plan.ms / 1000).toFixed(0)} s` : ""}{plan.tokens ? ` · ${(plan.tokens / 1000).toFixed(1)}k tokens` : ""}: those apply at once; other choices get a quick check.</p>
          <div className="btn-row">
            {differ.length > 0 && <button type="button" className="btn small" onClick={() => agent.applyRecommendation(differ.map((p) => p.key))}>Use all recommendations</button>}
            <button type="button" className="link-button small" onClick={agent.makePlan} disabled={working === "plan"}>Plan again</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplatePicker({ templates, segment, current, onPick, recommended }) {
  const sorted = [...templates].sort((a, b) => Number(b.segment === segment) - Number(a.segment === segment) || a.name.localeCompare(b.name));
  return (
    <div className="cover-templates-pick">
      {sorted.map((t) => {
        const rec = recommended && Number(recommended.value) === t.coverTemplateId;
        return (
          <button key={t.coverTemplateId} type="button" className={`cover-pick ${current === t.coverTemplateId ? "on" : ""}`}
            onClick={() => onPick(t)} title={rec ? `Recommended: ${recommended.reason}` : t.description}>
            <strong>{t.name}{rec ? " ★" : ""}</strong>
            <span className="small muted">{t.segment}{t.segment === segment ? " · suits this client" : ""}</span>
          </button>
        );
      })}
    </div>
  );
}
