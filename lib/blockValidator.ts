import {
  ALL_DISPLAYS, ALL_SORTS, BlockTypes, COMPARE_LABELS, Displays, PERIOD_LABELS, Sources, canCombine, dimensionOf, measureOf,
  type Block, type Catalog,
} from "./models";

/** The data product a block reads: Exposure or Holdings when a group-by is a snapshot field, else Performance. */
export function sourceOf(block: Block, catalog: Catalog): string {
  const sources = block.groupBy.map((k) => dimensionOf(catalog, k)?.source);
  return sources.includes(Sources.Exposure) ? Sources.Exposure : sources.includes(Sources.Holdings) ? Sources.Holdings : Sources.Performance;
}

/**
 * Checks that a block is complete and that its fields can be combined; an empty list means valid. The UI mirrors
 * these rules; the server is the source of truth and re-checks on every run, preview, submit and AI answer.
 */
export function validateBlock(block: Block, _scope: string, catalog: Catalog): string[] {
  const issues: string[] = [];
  switch (block.type) {
    case BlockTypes.Text:
      if (!block.text?.trim() && !block.title?.trim()) issues.push("Add some text.");
      break;
    case BlockTypes.Disclaimer:
      if (!block.disclosureCode?.trim()) issues.push("Choose a disclosure from the library.");
      break;
    case BlockTypes.Data:
      validateData(block, catalog, issues);
      break;
    default:
      issues.push(`Unknown block type '${block.type}'.`);
  }
  if (block.width !== "full" && block.width !== "half") issues.push("Width must be half or full.");
  return issues;
}

function validateData(block: Block, catalog: Catalog, issues: string[]) {
  if (!ALL_DISPLAYS.includes(block.display)) issues.push(`Unknown display '${block.display}'.`);
  if (!(block.period in PERIOD_LABELS)) issues.push(`Unknown period '${block.period}'.`);
  if (!(block.compare in COMPARE_LABELS)) issues.push(`Unknown comparison '${block.compare}'.`);
  if (!ALL_SORTS.includes(block.sort)) issues.push(`Unknown sort '${block.sort}'.`);
  if (block.topN != null && (block.topN < 1 || block.topN > 100)) issues.push("Top N must be between 1 and 100.");

  const measures = block.measures.map((k) => ({ key: k, item: measureOf(catalog, k) }));
  const dims = block.groupBy.map((k) => ({ key: k, item: dimensionOf(catalog, k) }));
  for (const m of measures.filter((x) => !x.item)) issues.push(`'${m.key}' is not an approved measure.`);
  for (const d of dims.filter((x) => !x.item)) issues.push(`'${d.key}' is not an approved group-by field.`);
  if (new Set(block.measures).size !== block.measures.length) issues.push("A measure is used twice.");
  if (new Set(block.groupBy).size !== block.groupBy.length) issues.push("A group-by field is used twice.");
  if (issues.length) return;

  if (measures.length === 0) issues.push("Drop at least one measure into Values.");
  if ((block.display === Displays.Kpi || block.display === Displays.List) && dims.length > 0)
    issues.push("KPI cards and lists show totals: remove the group-by field, or show as a chart or table.");
  else if ((block.display === Displays.Bar || block.display === Displays.Line || block.display === Displays.Pie) && dims.length !== 1)
    issues.push("A chart needs exactly one group-by field.");
  else if (block.display === Displays.Table && dims.length > 3) issues.push("A table can group by at most 3 fields.");
  if (block.display === Displays.Pie && (measures.length > 1 || block.compare !== "none"))
    issues.push("A pie chart shows one measure with no comparison.");
  if ((block.display === Displays.Bar || block.display === Displays.Line) && new Set(measures.map((m) => m.item!.format)).size > 1)
    issues.push("A chart's values share one axis: use measures of the same unit (all amounts or all percentages), or show as a table.");
  if (new Set(dims.map((d) => d.item!.source)).size > 1)
    issues.push(`${dims.map((d) => d.item!.label).join(" and ")} cannot be used together (they come from different data products).`);

  for (const { item: m } of measures) {
    const notAllowed = dims.filter((d) => !canCombine(catalog, m!.measureKey, d.key)).map((d) => d.item!.label);
    if (notAllowed.length) issues.push(`${m!.label} cannot be grouped by ${notAllowed.join(" or ")}.`);
    else if (dims.length === 0 && m!.requiresGroup)
      issues.push(m!.cumulative ? `${m!.label} needs a Month, Quarter or Year group-by.`
        : m!.holdingsExpr ? `${m!.label} needs a group-by field (asset class, sector, region or security).`
        : `${m!.label} needs a group-by field (account, entity, household or currency).`);
  }
  if (measures.some((m) => m.item!.cumulative) && measures.some((m) => !m.item!.cumulative))
    issues.push("Growth indices can only be shown with other growth indices.");
  if (measures.some((m) => m.item!.cumulative) && dims.length > 1)
    issues.push("Growth indices need exactly one group-by: Month, Quarter or Year.");
  if (dims.some((d) => d.item!.periodRows)) {
    if (dims.length > 1) issues.push("Standard periods cannot be combined with other group-by fields.");
    if (block.compare !== "none") issues.push("Standard periods already compare several periods: set Compare to None.");
    if (block.display !== Displays.Table && block.display !== Displays.Bar) issues.push("Show standard periods as a table or a bar chart.");
  }
  if (block.compare !== "none" && dims.some((d) => d.item!.isTime))
    issues.push("Compare is not available when grouping by Month or Quarter; the chart already shows time.");
}
