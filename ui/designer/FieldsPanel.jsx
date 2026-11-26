import { endDrag, startDrag } from "./dnd.js";
import { dimensionBlocked, measureBlocked } from "../rules.js";

/**
 * 2. Data fields (approved catalogue). Fields that cannot be combined with the selected block are greyed
 * out and won't drop. Drag a field onto a block (or its settings), or click to add it to the selected block.
 */
export default function FieldsPanel({ catalog, selected, onAddField, disabled }) {
  const isData = selected?.type === "data";
  const chip = (kind, key, label, symbol, reason) => {
    const blocked = disabled || (isData && reason);
    return (
      <button
        key={key}
        type="button"
        className={`field-chip ${kind} ${blocked ? "blocked" : ""}`}
        draggable={!blocked}
        aria-disabled={Boolean(blocked)}
        title={blocked ? reason || "" : isData ? "Click or drag to add to the selected block" : "Drag onto a KPI, chart or table block"}
        onDragStart={(e) => startDrag(e, { kind, key })}
        onDragEnd={endDrag}
        onClick={() => !blocked && isData && onAddField(selected.id, kind, key)}
      >
        {symbol && <span className="sym">{symbol}</span>} {label}
      </button>
    );
  };

  return (
    <section>
      <h3 className="insp-label">Data fields (approved catalogue)</h3>
      <div>
        <h3 className="group-label measures">Measures</h3>
        <div className="chip-grid">
          {catalog.measures.map((m) =>
            chip("measure", m.measureKey, m.label, m.symbol, isData ? measureBlocked(catalog, selected, m.measureKey) : null),
          )}
        </div>

        <h3 className="group-label dims">Group by</h3>
        <div className="chip-grid">
          {catalog.dimensions.map((d) =>
            chip("dimension", d.dimensionKey, d.label, "⌗", isData ? dimensionBlocked(catalog, selected, d.dimensionKey) : null),
          )}
        </div>

        <h3 className="group-label">Period</h3>
        <div className="chip-grid">
          {catalog.periods.map((p) =>
            chip("period", p.key, p.label, null, isData && selected.period === p.key ? "Already selected." : null),
          )}
        </div>

        <p className="panel-note">
          Only approved fields appear here. New fields are added by admins in the catalogue tables.
        </p>
      </div>
    </section>
  );
}
