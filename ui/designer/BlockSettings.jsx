import { useState } from "react";
import { dragged, endDrag } from "./dnd.js";
import { CONDITIONS, DISPLAYS, PLACEHOLDERS, dimension, isTotals, measure, notAllowedFor } from "../rules.js";


/** Block settings for the selected block. */
export default function BlockSettings({ block, state, catalog, disclosures, readOnly, onChange, onRemove, onDuplicate, onAddField, canAcceptField }) {
  if (!block) return <p className="muted pad">Select a block on the page to edit it, or add one from Build.</p>;

  const title = block.type === "data" ? (block.display === "kpi" ? "KPI" : block.display === "list" ? "List" : block.display === "table" ? "Table" : "Chart")
    : block.type === "disclaimer" ? "Disclaimer" : "Text";

  return (
    <section>
      <h3 className="insp-label">{title}</h3>
      <fieldset className="plain settings" disabled={readOnly}>
        {block.type !== "disclaimer" && (
          <label className="field">
            <span>Title</span>
            <input value={block.title} onChange={(e) => onChange({ title: e.target.value })} maxLength={200} />
          </label>
        )}

        {block.type === "data" && (
          <DataSettings block={block} state={state} catalog={catalog} onChange={onChange} onAddField={onAddField} canAcceptField={canAcceptField} />
        )}
        {block.type === "text" && <TextSettings block={block} onChange={onChange} />}
        {block.type === "disclaimer" && <DisclaimerSettings block={block} disclosures={disclosures ?? []} onChange={onChange} />}
        <div className="row">
          <span className="row-label">Width</span>
          <Segmented options={[{ key: "half", label: "Half" }, { key: "full", label: "Full" }]} value={block.width} onChange={(width) => onChange({ width })} />
        </div>

        <div className="settings-actions">
          <button type="button" className="ghost" onClick={onDuplicate}>Duplicate</button>
          <button type="button" className="ghost danger" onClick={onRemove}>Remove block</button>
        </div>
      </fieldset>
    </section>
  );
}

function DataSettings({ block, state, catalog, onChange, onAddField, canAcceptField }) {
  const notAllowed = notAllowedFor(catalog, block);
  const timeDim = block.groupBy.some((k) => dimension(catalog, k)?.isTime);
  const result = state?.result;
  const issues = result?.issues ?? [];

  const setDisplay = (display) => {
    const patch = { display };
    if (display === "pie") patch.compare = "none";
    onChange(patch);
  };

  return (
    <>
      <div className="row">
        <span className="row-label">Show as</span>
        <Segmented options={DISPLAYS} value={block.display} onChange={setDisplay} />
      </div>

      <DropZone
        label="Values (drop a measure)"
        kind="measure"
        block={block}
        canAcceptField={canAcceptField}
        onDropField={(key) => onAddField(block.id, "measure", key)}
        items={block.measures.map((k) => ({ key: k, label: `${measure(catalog, k)?.symbol ?? ""} ${measure(catalog, k)?.label ?? k}` }))}
        onRemove={(k) => onChange({ measures: block.measures.filter((m) => m !== k) })}
        empty="Drag a measure here, or click one in Data fields."
      />

      <DropZone
        label="Group by (drop a field)"
        kind="dimension"
        block={block}
        canAcceptField={canAcceptField}
        onDropField={(key) => onAddField(block.id, "dimension", key)}
        items={block.groupBy.map((k) => ({ key: k, label: `⌗ ${dimension(catalog, k)?.label ?? k}` }))}
        onRemove={(k) => onChange({ groupBy: block.groupBy.filter((d) => d !== k) })}
        empty={isTotals(block.display) ? "KPI cards and lists show totals; no group-by." : "Drag a group-by field here."}
      />

      <div className="two-col">
        <label className="field">
          <span>Period</span>
          <select value={block.period} onChange={(e) => onChange({ period: e.target.value })}>
            {catalog.periods.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Compare (optional)</span>
          <select value={block.compare} onChange={(e) => onChange({ compare: e.target.value })} disabled={timeDim || block.display === "pie"}>
            {catalog.compares.map((c) => (
              <option key={c.key} value={c.key}>{c.key === "none" ? "No comparison" : c.label}</option>
            ))}
          </select>
        </label>
      </div>

      {!isTotals(block.display) && (
        <div className="row show-row">
          <span className="row-label">Show</span>
          <label className="inline">
            Top
            <select value={block.topN ?? ""} onChange={(e) => onChange({ topN: e.target.value ? Number(e.target.value) : null })}>
              <option value="">All</option>
              {[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="inline">
            Sort
            <select value={block.sort} onChange={(e) => onChange({ sort: e.target.value })}>
              <option value="value_desc">Value ↓</option>
              <option value="value_asc">Value ↑</option>
              <option value="label_asc">Label A→Z / oldest first</option>
            </select>
          </label>
        </div>
      )}

      {notAllowed && (
        <div className="not-allowed">
          <p>Not allowed with {notAllowed.measures.join(", ")}:</p>
          <div className="chip-row">
            {notAllowed.dims.map((d) => (
              <span key={d.dimensionKey} className="field-chip dimension blocked">⌗ {d.label}</span>
            ))}
          </div>
          <p className="hint">Greyed fields can&apos;t be combined with the chosen measure and won&apos;t drop.</p>
        </div>
      )}

      <Validity state={state} issues={issues} />
    </>
  );
}

function Validity({ state, issues }) {
  if (state?.loading && !state?.result) return <div className="validity pending">Checking…</div>;
  if (state?.error) return <div className="validity bad">{state.error}</div>;
  if (issues.length > 0)
    return (
      <div className="validity bad">
        {issues.map((i) => <p key={i}>⚠ {i}</p>)}
      </div>
    );
  if (state?.result?.error) return <div className="validity bad">⚠ {state.result.error}</div>;
  if (state?.result) return <div className="validity ok">✓ Valid combination · sample data shown on page</div>;
  return null;
}

function DropZone({ label, kind, block, items, onRemove, onDropField, canAcceptField, empty }) {
  const [hover, setHover] = useState(null);
  return (
    <div className="drop-field">
      <span className="row-label">{label}</span>
      <div
        className={`drop-zone ${hover === true ? "ok" : hover === false ? "no" : ""}`}
        onDragOver={(e) => {
          const p = dragged();
          if (!p || p.kind !== kind) return;
          const ok = canAcceptField(block, p);
          setHover(ok);
          if (ok) e.preventDefault();
        }}
        onDragLeave={() => setHover(null)}
        onDrop={(e) => {
          e.preventDefault();
          const p = dragged();
          setHover(null);
          endDrag();
          if (p?.kind === kind && canAcceptField(block, p)) onDropField(p.key);
        }}
      >
        {items.length === 0 && <span className="muted">{empty}</span>}
        {items.map((item) => (
          <span key={item.key} className={`field-chip ${kind} in-zone`}>
            {item.label}
            <button type="button" className="chip-x" aria-label={`Remove ${item.label}`} onClick={() => onRemove(item.key)}>×</button>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Disclaimers only name a disclosure: the wording always comes from the content studio's library. */
function DisclaimerSettings({ block, disclosures, onChange }) {
  const chosen = disclosures.find((d) => d.disclosureCode === block.disclosureCode);
  return (
    <>
      <label className="field">
        <span>Disclosure (from the library)</span>
        <select value={block.disclosureCode ?? ""} onChange={(e) => onChange({ disclosureCode: e.target.value })}>
          <option value="" disabled>Choose…</option>
          {disclosures.map((d) => <option key={d.disclosureCode} value={d.disclosureCode}>{d.title} (v{d.version})</option>)}
        </select>
      </label>
      {chosen && <p className="disclosure-preview">{chosen.text}</p>}
      <label className="field">
        <span>Show only when</span>
        <select value={block.condition ?? ""} onChange={(e) => onChange({ condition: e.target.value || null })}>
          {CONDITIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </label>
    </>
  );
}

function TextSettings({ block, onChange }) {
  return (
    <>
      {block.type === "text" && (
        <div className="row">
          <span className="row-label">Style</span>
          <Segmented options={[{ key: "header", label: "Header" }, { key: "body", label: "Body" }]} value={block.variant ?? "body"} onChange={(variant) => onChange({ variant })} />
        </div>
      )}
      <label className="field">
        <span>Text</span>
        <textarea rows={5} value={block.text ?? ""} maxLength={6000} onChange={(e) => onChange({ text: e.target.value })} />
      </label>
      <div className="placeholder-row">
        <span className="muted">Insert:</span>
        {PLACEHOLDERS.map((p) => (
          <button key={p} type="button" className="mini" onClick={() => onChange({ text: `${block.text ?? ""}${block.text ? " " : ""}${p}` })}>{p}</button>
        ))}
      </div>
      <label className="field">
        <span>Narrative brief (optional)</span>
        <textarea rows={3} value={block.narrative ?? ""} maxLength={1000}
          placeholder="e.g. Two short paragraphs on performance against the benchmark. Leave empty to keep this text as written."
          onChange={(e) => onChange({ narrative: e.target.value || null })} />
      </label>
      <p className="muted small">With a brief, the Narrative Agent drafts this text for each client from the verified figures; every figure it writes is checked.</p>
    </>
  );
}

export function ReportSettings({ report, readOnly }) {
  const { header, setHeader, scope, setScope } = report;
  return (
    <section>
      <h3 className="insp-label">Template</h3>
      <fieldset className="plain settings" disabled={readOnly}>
        <label className="field">
          <span>Name</span>
          <input value={header.name} maxLength={100} onChange={(e) => setHeader({ ...header, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Category</span>
          <input value={header.category} maxLength={100} onChange={(e) => setHeader({ ...header, category: e.target.value })} />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea rows={2} value={header.description ?? ""} maxLength={1000} onChange={(e) => setHeader({ ...header, description: e.target.value })} />
        </label>
        <div className="field">
          <span>Report is about</span>
          {[
            { key: "Client", text: "A client: a household, one of its entities, or one account" },
            { key: "Firm", text: "Every account (firm-wide)" },
          ].map((s) => (
            <label key={s.key} className="radio">
              <input type="radio" name="scope" checked={scope === s.key} onChange={() => setScope(s.key)} /> {s.text}
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key} className={value === o.key ? "on" : ""} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
