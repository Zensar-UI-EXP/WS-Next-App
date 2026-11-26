import { useState } from "react";
import BlockContent from "../components/BlockContent.jsx";
import { dragged, endDrag, isBlockDrag, isFieldDrag, startDrag } from "./dnd.js";

/**
 * 3. Page: blocks in a two-column grid (half / full width). Drop blocks between blocks to insert, drag a
 * block to rearrange, drop a field onto a block to add it. Data blocks show live sample data.
 */
export default function Page({ blocks, selectedId, onSelect, results, ctx, readOnly, canAcceptField, onDropBlock, onDropField }) {
  const [indicator, setIndicator] = useState(null); // {index} insertion point, or {fieldOn: id, ok}

  const over = (event, index, block) => {
    const payload = dragged();
    if (readOnly || !payload) return;
    if (isBlockDrag(payload)) {
      event.preventDefault();
      let at = index;
      if (block) {
        const rect = event.currentTarget.getBoundingClientRect();
        const after = block.width === "half"
          ? event.clientX > rect.left + rect.width / 2 || event.clientY > rect.top + rect.height * 0.75
          : event.clientY > rect.top + rect.height / 2;
        at = after ? index + 1 : index;
      }
      setIndicator({ index: at });
    } else if (isFieldDrag(payload) && block) {
      const ok = canAcceptField(block, payload);
      if (ok) event.preventDefault();
      setIndicator({ fieldOn: block.id, ok });
    }
  };

  const drop = (event) => {
    const payload = dragged();
    event.preventDefault();
    if (indicator?.index !== undefined && isBlockDrag(payload)) onDropBlock(payload, indicator.index);
    if (indicator?.fieldOn && indicator.ok && isFieldDrag(payload)) onDropField(indicator.fieldOn, payload);
    setIndicator(null);
    endDrag();
  };

  return (
    <div className="page-dnd" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setIndicator(null)}>
      <div className="sheet-grid">
        {blocks.map((block, index) => {
          const isSelected = block.id === selectedId;
          const fieldHover = indicator?.fieldOn === block.id;
          return (
            <div
              key={block.id}
              className={[
                "sheet-block", "page-block",
                block.width === "half" ? "half" : "full",
                `type-${block.type}`,
                isSelected ? "selected" : "",
                fieldHover ? (indicator.ok ? "field-ok" : "field-no") : "",
                indicator?.index === index ? "insert-before" : "",
                indicator?.index === index + 1 && index === blocks.length - 1 ? "insert-after" : "",
              ].join(" ")}
              draggable={!readOnly}
              onDragStart={(e) => startDrag(e, { kind: "move", id: block.id })}
              onDragEnd={() => { setIndicator(null); endDrag(); }}
              onDragOver={(e) => over(e, index, block)}
              onDrop={drop}
              onClick={(e) => { e.stopPropagation(); onSelect(block.id); }}
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onSelect(block.id)}
              aria-label={`${block.title || block.type} block${isSelected ? " (selected)" : ""}`}
            >
              {isSelected && <span className="selected-tag">{block.type === "data" ? block.display.toUpperCase() : block.type} · selected</span>}
              <BlockContent block={block} state={results[block.id]} ctx={ctx} />
              {fieldHover && !indicator.ok && <div className="drop-refused">Not allowed in this block</div>}
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <div
          className={`page-end-drop ${indicator?.index === blocks.length ? "active" : ""}`}
          onDragOver={(e) => { if (isBlockDrag(dragged())) { e.preventDefault(); setIndicator({ index: blocks.length }); } }}
          onDrop={drop}
        >
          {blocks.length === 0 ? "Drag blocks here to start this page" : "Drop here to add at the end"}
        </div>
      )}
    </div>
  );
}
