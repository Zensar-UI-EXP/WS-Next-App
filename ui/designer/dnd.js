// Native HTML5 drag and drop. The payload is kept here as well as in dataTransfer, because browsers hide
// dataTransfer contents during dragover, and drop targets need it there to decide whether to accept.
//
// Payloads: {kind: "preset", key} | {kind: "new", key} | {kind: "move", id}
//           {kind: "measure", key} | {kind: "dimension", key} | {kind: "period", key}

let current = null;

export function startDrag(event, payload) {
  current = payload;
  event.dataTransfer.effectAllowed = payload.kind === "move" ? "move" : "copy";
  event.dataTransfer.setData("text/plain", JSON.stringify(payload));
}

export function endDrag() {
  current = null;
}

export const dragged = () => current;
export const isBlockDrag = (p) => p && (p.kind === "preset" || p.kind === "new" || p.kind === "move");
export const isFieldDrag = (p) => p && (p.kind === "measure" || p.kind === "dimension" || p.kind === "period");
