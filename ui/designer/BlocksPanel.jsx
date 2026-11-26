import { endDrag, startDrag } from "./dnd.js";
import { NEW_BLOCKS } from "../rules.js";

/** 1. Blocks: ready-made (pre-configured) and build-your-own. Drag onto the page, or click to add. */
export default function BlocksPanel({ presets, onAdd, disabled }) {
  return (
    <section>
      <h3 className="insp-label">Blocks</h3>
      <div>
        <h3 className="group-label">Ready-made (pre-configured)</h3>
        <div className="preset-list">
          {presets.map((p) => (
            <button
              key={p.presetKey}
              type="button"
              className="preset"
              draggable={!disabled}
              disabled={disabled}
              onDragStart={(e) => startDrag(e, { kind: "preset", key: p.presetKey })}
              onDragEnd={endDrag}
              onClick={() => onAdd({ kind: "preset", key: p.presetKey })}
              title="Drag onto the page, or click to add"
            >
              <span className="icon">{p.icon}</span> {p.label}
            </button>
          ))}
        </div>

        <h3 className="group-label">Build your own</h3>
        <div className="new-block-grid">
          {NEW_BLOCKS.map((b) => (
            <button
              key={b.key}
              type="button"
              className="new-block"
              draggable={!disabled}
              disabled={disabled}
              onDragStart={(e) => startDrag(e, { kind: "new", key: b.key })}
              onDragEnd={endDrag}
              onClick={() => onAdd({ kind: "new", key: b.key })}
              title="Drag onto the page, or click to add"
            >
              <span className="icon">{b.icon}</span> {b.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
