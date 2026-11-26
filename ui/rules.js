// Client-side mirror of the catalogue rules, so the designer can grey out fields before anything is sent.
// The API re-checks every rule (BlockValidator) and is the source of truth.

import { dayBefore, formatDate } from "./format.js";

export const DISPLAYS = [
  { key: "kpi", label: "KPI" },
  { key: "list", label: "List" },
  { key: "bar", label: "Bar" },
  { key: "line", label: "Line" },
  { key: "pie", label: "Pie" },
  { key: "table", label: "Table" },
];

export const hasData = (block) => block.type === "data";
export const isTotals = (display) => display === "kpi" || display === "list";

export const PAGE_GROUPS = ["Front matter", "Portfolio pages", "Commentary & close"];
export const PAGE_LAYOUTS = [
  { key: "standard", label: "Standard" },
  { key: "kpi", label: "KPI board" },
  { key: "letter", label: "Letter" },
  { key: "cover", label: "Cover" },
];
export const TYPEFACES = [
  { key: "serif", label: "Source Serif (template)" },
  { key: "sans", label: "Inter" },
  { key: "classic", label: "Georgia" },
];

/** Every block on every page. */
export const allBlocks = (definition) => definition.pages.flatMap((p) => p.blocks);

/** Conditions a page or disclaimer can depend on (set from the client context). */
export const CONDITIONS = [
  { key: "", label: "Always" },
  { key: "StructuredProducts", label: "The client holds structured products" },
  { key: "MultiCurrency", label: "The client has non-USD accounts" },
  { key: "Advisory", label: "An advisory mandate is included" },
  { key: "Discretionary", label: "A discretionary mandate is included" },
];
export const conditionLabel = (key) => CONDITIONS.find((c) => c.key === key)?.label ?? key;

/** Who wrote a text block, for provenance badges. */
export const ORIGINS = {
  "narrative-agent": { label: "AI draft · Narrative Agent", ai: true },
  "ask-studio": { label: "AI · Ask the studio", ai: true },
  "reporting-agent": { label: "AI · Reporting agent", ai: true },
  "wealth-manager": { label: "Edited by wealth manager", ai: false },
  template: { label: "Template wording", ai: false },
};

export function sourceOf(block, catalog) {
  const sources = (block.groupBy ?? []).map((k) => dimension(catalog, k)?.source);
  return sources.includes("Exposure") ? "Exposure" : sources.includes("Holdings") ? "Holdings" : "Performance";
}

export const measure = (catalog, key) => catalog.measures.find((m) => m.measureKey === key);
export const dimension = (catalog, key) => catalog.dimensions.find((d) => d.dimensionKey === key);
export const canCombine = (catalog, measureKey, dimensionKey) =>
  (catalog.combinations[measureKey] ?? []).includes(dimensionKey);

/** Can this measure be added to the block? Returns a reason when it cannot. */
export function measureBlocked(catalog, block, measureKey) {
  if (!block || block.type !== "data") return "Select a KPI, chart or table block first.";
  if (block.measures.includes(measureKey)) return "Already used.";
  const m = measure(catalog, measureKey);
  const bad = block.groupBy.filter((d) => !canCombine(catalog, measureKey, d));
  if (bad.length) return `${m.label} cannot be grouped by ${bad.map((d) => dimension(catalog, d).label).join(" or ")}.`;
  if (m.requiresGroup && isTotals(block.display)) return `${m.label} needs a group-by field, so it cannot be a KPI card or list.`;
  const others = block.measures.map((k) => measure(catalog, k));
  if (others.length && others.some((x) => x.cumulative !== m.cumulative)) return "Growth indices can only be shown with other growth indices.";
  if (block.display === "pie" && block.measures.length >= 1) return "A pie chart shows one measure.";
  const other = block.measures.map((k) => measure(catalog, k)).find((x) => x.format !== m.format);
  if (["bar", "line"].includes(block.display) && other)
    return `A chart's values share one axis: ${m.label} (${m.format}) cannot be plotted with ${other.label} (${other.format}). Use a table instead.`;
  return null;
}

/** Can this group-by field be added to the block? Returns a reason when it cannot. */
export function dimensionBlocked(catalog, block, dimensionKey) {
  if (!block || block.type !== "data") return "Select a chart or table block first.";
  if (block.groupBy.includes(dimensionKey)) return "Already used.";
  const d = dimension(catalog, dimensionKey);
  const bad = block.measures.filter((m) => !canCombine(catalog, m, dimensionKey));
  if (bad.length) return `${d.label} cannot be combined with ${bad.map((m) => measure(catalog, m).label).join(" or ")}.`;
  const other = block.groupBy.map((k) => dimension(catalog, k)).find((x) => x.source !== d.source);
  if (other) return `${d.label} cannot be used with ${other.label}.`;
  if (isTotals(block.display)) return "KPI cards and lists show totals; switch to a chart or table to group.";
  if (d.periodRows && block.groupBy.length > 0) return "Standard periods must be the only group-by.";
  if (block.groupBy.some((k) => dimension(catalog, k)?.periodRows)) return "Standard periods must be the only group-by.";
  if (block.measures.some((k) => measure(catalog, k)?.cumulative) && block.groupBy.length >= 1) return "Growth indices need exactly one group-by.";
  if (["bar", "line", "pie"].includes(block.display) && block.groupBy.length >= 1) return "A chart groups by one field.";
  if (block.groupBy.length >= 3) return "A table groups by at most 3 fields.";
  if (block.compare !== "none" && d.isTime) return "Compare is not available with Month or Quarter.";
  return null;
}

/** Group-by fields that can never be combined with the block's measures (the mockup's "Not allowed with …" row). */
export function notAllowedFor(catalog, block) {
  if (!block || block.type !== "data" || block.measures.length === 0) return null;
  const dims = catalog.dimensions.filter((d) => block.measures.some((m) => !canCombine(catalog, m, d.dimensionKey)));
  return dims.length ? { measures: block.measures.map((m) => measure(catalog, m).label), dims } : null;
}

/** Mirror of the API's InputDetector: which inputs the advisor will be asked for. */
export function detectInputs(definition, catalog) {
  const blocks = allBlocks(definition);
  const dataBlocks = blocks.filter(hasData);
  const texts = blocks.map((b) => `${b.text ?? ""}${b.title ?? ""}`).join("");
  const needsSubject = dataBlocks.length > 0 || texts.includes("{Portfolio}") || texts.includes("{Client}");
  const needsTo = dataBlocks.length > 0 || texts.includes("{To date}") || texts.includes("{As of date}");
  const needsFrom =
    ["{From date}", "{Base date}", "{Period}"].some((p) => texts.includes(p)) ||
    dataBlocks.some((b) =>
      b.period === "report" && sourceOf(b, catalog) === "Performance",
    );

  const inputs = [];
  if (needsSubject && definition.scope === "Client") {
    inputs.push({ name: "householdId", label: "Household", type: "household" });
    inputs.push({ name: "clientId", label: "Entity", type: "client", optional: true });
    inputs.push({ name: "portfolioCode", label: "Account", type: "portfolio", optional: true });
  }
  if (needsFrom) {
    inputs.push({ name: "fromDate", label: "From date", type: "date" });
    inputs.push({ name: "toDate", label: "To date", type: "date" });
  } else if (needsTo) {
    inputs.push({ name: "toDate", label: "As of date", type: "date" });
  }
  return inputs;
}

export const PLACEHOLDERS = ["{Client}", "{Portfolio}", "{Period}", "{From date}", "{To date}", "{Base date}", "{Run date}", "{Report name}"];

/**
 * Values for the placeholders. `params` are the run inputs; names come from the client report (wealth manager)
 * or from the lookups (designer preview).
 */
export function placeholderContext({ params = {}, lookups = {}, clientName, subjectLabel, periodLabel, reportName, relationshipManager }) {
  const portfolio = lookups.portfolio?.find((p) => p.value === params.portfolioCode);
  const client = lookups.client?.find((c) => c.value === String(params.clientId ?? ""))
    ?? lookups.household?.find((h) => h.value === String(params.householdId ?? ""));
  const from = params.fromDate ? formatDate(params.fromDate, "long") : null;
  const to = params.toDate ? formatDate(params.toDate, "long") : null;
  return {
    "{Client}": clientName ?? client?.label ?? "All clients",
    "{Portfolio}": subjectLabel ? readableSubject(subjectLabel) : (portfolio ? portfolio.label.replace(/ \(.*\)$/, "") : params.clientId ? "accounts" : "household's accounts"),
    "{Period}": periodLabel ?? (from && to ? `${from} – ${to}` : "the report period"),
    "{From date}": from ?? "{From date}",
    "{To date}": to ?? "{To date}",
    "{As of date}": to ?? "{As of date}",
    "{Base date}": params.fromDate ? formatDate(dayBefore(params.fromDate), "long") : "{Base date}",
    "{Run date}": formatDate(new Date().toISOString().slice(0, 10), "long"),
    "{Report name}": reportName ?? "Report",
    // V7: shown on the cover (prepared by, relationship manager card); not a placeholder for text.
    "{Relationship manager}": relationshipManager ?? null,
  };
}

/** "Whole household" → "household portfolio", "Marula Family Trust · all accounts" → "Marula Family Trust accounts". */
function readableSubject(label) {
  if (label === "Whole household") return "household portfolio";
  return label.replace(/ · all accounts$/, " accounts").replace(/ · whole household$/, " household portfolio");
}

/** Replaces placeholders such as {Client} and {To date} in titles and text. */
export function fillPlaceholders(text, ctx) {
  if (!text) return "";
  return Object.entries(ctx ?? {}).reduce((t, [k, v]) => (v == null ? t : t.split(k).join(v)), text);
}

let counter = 0;
export function newBlockId() {
  counter += 1;
  return `b${Date.now().toString(36)}${counter}`;
}

/** Blank blocks for the "Build your own" palette. */
const dataBlock = (display, width, title) => ({ type: "data", display, width, title, measures: [], groupBy: [], period: "report", compare: "none", topN: null, sort: "value_desc" });
export const NEW_BLOCKS = [
  { key: "kpi", label: "KPI", icon: "#", block: dataBlock("kpi", "full", "Key figures") },
  { key: "list", label: "List", icon: "≡", block: dataBlock("list", "half", "Key figures") },
  { key: "chart", label: "Chart", icon: "▥", block: dataBlock("bar", "half", "New chart") },
  { key: "table", label: "Table", icon: "☷", block: dataBlock("table", "full", "New table") },
  { key: "text", label: "Text", icon: "T", block: { type: "text", variant: "body", width: "full", title: "", text: "Write your commentary here." } },
  { key: "disclaimer", label: "Disclaimer", icon: "!", block: { type: "disclaimer", width: "full", title: "", text: "", disclosureCode: "PERF_GENERAL" } },
];

let pageCounter = 0;
export function newPage(group = "Portfolio pages", title = "New page") {
  pageCounter += 1;
  return {
    id: `pg${Date.now().toString(36)}${pageCounter}`,
    title, group, locked: false, included: true, sectionLabel: "", heading: title, layout: "standard",
    style: { typeface: "serif", bodySize: 10, lineHeight: 1.5 },
    blocks: [],
  };
}
