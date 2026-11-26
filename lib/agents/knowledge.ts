import { getCatalog } from "../catalog";
import { COMPARE_LABELS, PERIOD_LABELS } from "../models";
import { getDisclosures } from "../repos/content";
import { FIGURE_SETS, setBlock } from "../reporting/published";
import { listReusableDefinitions } from "./store";
import { approvedCovers } from "../repos/covers";

/**
 * Knowledge & rules: the shared context every agent reads - the data dictionary (approved measures and group-by
 * fields), the display components, the report rules and the disclosure library. Built from the catalogue tables, so
 * the agents only ever see what is approved. V7 adds the published figure sets and the reusable report definitions.
 */
export const KNOWLEDGE_SECTIONS = [
  "data_dictionary", "display_components", "report_rules", "disclosures", "ready_made_modules", "published_figure_sets", "reusable_definitions", "cover_templates",
] as const;
export type KnowledgeSection = (typeof KNOWLEDGE_SECTIONS)[number];

export async function readKnowledge(section: KnowledgeSection): Promise<string> {
  const catalog = await getCatalog();
  switch (section) {
    case "data_dictionary": {
      const measures = catalog.measures.map((m) => {
        const groups = catalog.combinations[m.measureKey] ?? [];
        const needs = m.requiresGroup ? (m.cumulative ? " Needs a time group-by (month, quarter or year)." : " Needs a group-by field.") : "";
        return `- ${m.measureKey} (${m.label}, ${m.format}): ${m.description}${needs} Group-bys allowed: ${groups.join(", ") || "none (totals only)"}.`;
      });
      const dims = catalog.dimensions.map((d) =>
        `- ${d.dimensionKey} (${d.label}): data product ${d.source}${d.isTime ? ", a time axis" : ""}${d.periodRows ? ", rows are standard periods (quarter, half, year, 3 years, since inception)" : ""}.`);
      return [
        "# Data dictionary", "All figures come from the governed data products through the Reporting API. Use only these keys.", "",
        "## Measures", ...measures, "", "## Group-by fields", ...dims, "",
        "## Periods", ...Object.entries(PERIOD_LABELS).map(([k, v]) => `- ${k}: ${v}${k === "report" ? " (the dates the user chose)" : ""}`), "",
        "## Comparisons", ...Object.entries(COMPARE_LABELS).map(([k, v]) => `- ${k}: ${v}`),
      ].join("\n");
    }
    case "display_components":
      return `# Display components
A data block shows measures, optionally grouped by fields, as one of these displays:
- kpi: cards of totals. No group-by.
- list: a short list of totals (good for risk figures). No group-by.
- table: rows by up to 3 group-by fields; any number of measures.
- bar: exactly one group-by; all measures must share a unit (all percentages or all amounts). Can compare with a previous period.
- line: exactly one group-by, normally month; for growth indices use growth_index and benchmark_index by month.
- pie: exactly one measure (usually weight) and one group-by, no comparison.
Other rules: group-by fields must come from the same data product; standard periods (return_period) only as a table or bar with no
comparison and no other group-by; no comparison when grouping by month or quarter; growth indices only with other growth indices.
Fields of a data block: display, title, measures, groupBy, period (default "report"), compare (default "none"), topN (1-100, optional),
sort ("value_desc", "value_asc" or "label_asc"; use label_asc for time axes), width ("full" or "half"), labels (optional map from
measure key to a short column label).
Text blocks: { type: "text", title, text, variant } where variant is "body" (default) or "header" (big title text on a cover).
Disclaimer blocks: { type: "disclaimer", disclosureCode } - the wording always comes from the disclosure library.`;
    case "report_rules":
      return `# Report rules
- A report is a list of pages. Each page: { id, title, heading, sectionLabel, layout, blocks }.
  Layouts: "cover" (first page: a header text block with the report title and the subject), "letter" (a personal letter, text first),
  "kpi" (key figures and charts), "standard" (everything else).
- Two half-width blocks sit side by side. Keep a page to at most 6 blocks. A table with a group-by and more than one measure must be
  full width (a half-width page column is too narrow for it).
- Placeholders filled when the report is shown: {Client}, {Portfolio}, {Period}, {From date}, {To date}, {As of date}, {Base date},
  {Run date}, {Report name}. Use them instead of typing names and dates.
- Every figure written in text must be one returned by the Reporting API (the verified figures). Never calculate new numbers (no sums,
  differences or averages) and never invent one. Charts and tables are calculated by the engine when the report is shown.
- No personal investment advice, recommendations to buy or sell, forecasts or promises.
- Plain, warm, professional British English for a private client, addressed as "you". Short paragraphs, no markdown.
- End the report with a disclosures page holding the disclaimers that apply to this client (see the disclosure library).
- State the as-of date and anything the data status says the reader should know.`;
    case "disclosures": {
      const list = await getDisclosures();
      return ["# Disclosure library (use the code in a disclaimer block)",
        ...list.map((d) => `- ${d.disclosureCode}: ${d.title}. Applies: ${d.appliesWhen}.`)].join("\n");
    }
    case "ready_made_modules":
      return ["# Ready-made modules (approved blocks you can reuse as they are)",
        ...catalog.presets.map((p) => { const { id: _id, ...block } = p.block; return `- ${p.presetKey}: ${p.description}\n  ${JSON.stringify(block)}`; })].join("\n");
    case "published_figure_sets": {
      const sets = await Promise.all(FIGURE_SETS.map(async (f) => {
        const { id: _id, ...block } = await setBlock(f);
        return `- ${f.key}: ${f.title}\n  ${JSON.stringify(block)}`;
      }));
      return ["# Published figure sets",
        "At each period close these sets are published for every household, entity and account and every closed standard period (FY, H1, H2,",
        "Q1-Q4). For such a period, get_published_figures returns them, and a data block with exactly these measures, groupBy, period,",
        "compare, topN and sort is shown from the published figures (the display and title may differ). Custom and still-open periods are",
        "calculated by the calculation library (calculate_measures).", ...sets].join("\n");
    }
    case "cover_templates": {
      const list = await approvedCovers();
      return ["# Approved cover templates (choose one with cover.templateId in submit_report)",
        "Pick the one whose segment matches the client (or 'All'), and write the cover's words: eyebrow, title, subtitle, report type,",
        "an optional headline with one verified figure, and an optional short note. Layout, branding and the required classification",
        "and legal line come from the template.",
        ...list.map((t) => `- templateId ${t.coverTemplateId} '${t.name}' (segment ${t.segment}, v${t.version}): ${t.description}`)].join("\n");
    }
    case "reusable_definitions": {
      const list = await listReusableDefinitions();
      return list.length
        ? ["# Reusable report definitions (read one with read_reusable_definition)",
          ...list.map((d) => `- #${d.definitionId} ${d.name}: ${d.description} (${JSON.parse(d.definitionJson).pages.length} pages)`)].join("\n")
        : "# Reusable report definitions\nNone saved yet.";
    }
  }
}

/** A short overview for the lead agent's context. */
export async function knowledgeOverview(): Promise<string> {
  const catalog = await getCatalog();
  return `Knowledge & rules available to the specialists (sections: ${KNOWLEDGE_SECTIONS.join(", ")}):
- ${catalog.measures.length} approved measures, e.g. ${catalog.measures.slice(0, 10).map((m) => m.measureKey).join(", ")} …
- ${catalog.dimensions.length} group-by fields, e.g. ${catalog.dimensions.slice(0, 8).map((d) => d.dimensionKey).join(", ")} …
- Displays: kpi, list, table, bar, line, pie. ${catalog.presets.length} ready-made modules, ${FIGURE_SETS.length} published figure sets\n  (closed standard periods), reusable report definitions saved by wealth managers.
- Rules: every figure in text must come from the Reporting API; no advice or forecasts; end with the applicable disclosures.`;
}
