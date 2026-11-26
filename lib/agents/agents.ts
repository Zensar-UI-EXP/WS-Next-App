import { z } from "zod/v4";
import { isoDate } from "../db";
import { TextOrigins, normaliseDefinition, type ReportDefinition } from "../models";
import { normaliseCover, type CoverSettings } from "../cover";
import { approvedCovers } from "../repos/covers";
import { FIGURE_SETS } from "../reporting/published";
import { runAgent, tracedTool } from "./agentRunner";
import { KNOWLEDGE_SECTIONS, knowledgeOverview, readKnowledge } from "./knowledge";
import type { PerformanceFindings, RunState } from "./state";
import { getReusableDefinition, saveAgentOutput } from "./store";

/**
 * The three agents of the V7 design. The lead agent understands the request (a new report, or a change to one), plans
 * the work and delegates to the two specialists through tools; the specialists use the Reporting API for the signed-in
 * user and the shared Knowledge & rules. Each agent is Claude with its own instructions and tools, run in a tool-use loop.
 */
export const LEAD = "Lead agent", PERFORMANCE = "Performance agent", REPORTING = "Reporting agent";

const knowledgeTool = (s: RunState, agent: string) => tracedTool(s, agent, {
  name: "read_knowledge",
  description: `Read a section of the shared Knowledge & rules: ${KNOWLEDGE_SECTIONS.join(", ")}.`,
  inputSchema: z.object({ section: z.enum(KNOWLEDGE_SECTIONS) }),
  title: (i) => `Reads knowledge: ${i.section.replace(/_/g, " ")}`,
  run: (i) => readKnowledge(i.section),
});

/** The report definition as the lead agent reads it: pages, blocks and the full text (it checks the wording against the request). */
export const outline = (d: ReportDefinition) => d.pages.map((p, i) => ({
  page: i + 1, title: p.title, heading: p.heading, layout: p.layout,
  blocks: p.blocks.map((b) => b.type === "data" ? `${b.display}: ${b.title} (${b.measures.join(", ")}${b.groupBy.length ? " by " + b.groupBy.join(", ") : ""})`
    : b.type === "text" ? `text: ${b.title ? b.title + " - " : ""}${b.text ?? ""}` : `disclaimer: ${b.disclosureCode}`),
}));

/** The definition as a specialist edits it (no run-time fields). */
const editable = (d: ReportDefinition) => ({
  cover: d.cover && { templateId: d.cover.templateId, template: d.cover.templateName, eyebrow: d.cover.eyebrow, title: d.cover.title,
    subtitle: d.cover.subtitle, reportType: d.cover.reportType, headline: d.cover.headline, note: d.cover.note },
  pages: d.pages.map((p) => ({
    title: p.title, heading: p.heading, sectionLabel: p.sectionLabel, layout: p.layout,
    blocks: p.blocks.map(({ id: _id, origin: _o, ...b }) =>
      Object.fromEntries(Object.entries(b).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length)))),
  })),
});

// ---------- Performance agent ----------

const PERFORMANCE_SYSTEM = `You are the Performance agent of a private bank's wealth-reporting studio. The lead agent gives you a task about one
client's portfolio and period. You select the measures and parameters, request the figures through the Reporting API tools, check the
returned coverage, as-of date and data status, and hand back findings.

The Reporting API runs for the signed-in wealth manager: it only returns data they are entitled to.
- Closed standard periods (FY, H1, H2, Q1-Q4 that have ended) have published figures: get_published_figures returns the bank's
  published figure sets (${FIGURE_SETS.map((f) => f.key).join(", ")}). Prefer them where they cover the task.
- Anything else - custom or still-open periods, other measures or groupings, comparisons - is calculated by the calculation library
  through calculate_measures.

How to work:
- Start with get_client_context (it says whether the period is published) and check_data_status, and read the data_dictionary before
  calculating anything.
- Ask only for what the task needs and is relevant to this client.
- If the API rejects a request, read its reason, fix the request and try again.
- You never calculate figures yourself. Quote figures exactly as the tools return them (a percentage may be rounded to one decimal place).
- In coverage, say which figures are published and which were calculated.
- Finish by calling submit_findings once, then reply with one short sentence.`;

const findingsSchema = z.object({
  summary: z.string().describe("Two or three sentences on how the portfolio did, quoting verified figures."),
  findings: z.array(z.object({
    headline: z.string(), detail: z.string().describe("One or two sentences with the verified figures behind it."),
    significance: z.enum(["material", "notable", "info"]),
  })).describe("The most important movements and facts, most important first (3 to 8)."),
  dataStatus: z.string().describe("What the data status and coverage mean for the reader."),
  asOfDate: z.string().describe("yyyy-mm-dd"),
  coverage: z.string().describe("Which accounts and dates the figures cover, any gaps, and which figures are published or calculated."),
  suggestedContent: z.array(z.string()).describe("Charts or tables (figure sets or query ids and titles) that would show these findings in the report."),
});

const measureRequest = z.object({
  title: z.string().describe("What this request is for, e.g. 'Return by account'."),
  measures: z.array(z.string()).min(1).describe("Measure keys from the data dictionary."),
  groupBy: z.array(z.string()).optional().describe("Group-by keys; omit for totals."),
  period: z.string().optional().describe("report (default), qtd, ytd, 1y, 3y or inception."),
  compare: z.string().optional().describe("none (default), previous_quarter or previous_year."),
  topN: z.number().int().optional(),
});

export async function runPerformanceAgent(s: RunState, task: string): Promise<PerformanceFindings> {
  const api = s.api;
  const tools = [
    knowledgeTool(s, PERFORMANCE),
    tracedTool(s, PERFORMANCE, {
      name: "get_client_context", description: "Who the report is about (household, entity or account, accounts, currencies, mandates, conditions), the data range, and whether the period is published.",
      inputSchema: z.object({}), title: () => "Reporting API: client context", run: () => api.clientContext(PERFORMANCE),
    }),
    tracedTool(s, PERFORMANCE, {
      name: "check_data_status", description: "Data quality and readiness for the client and period: freshness, gaps, FX, reconciliation, and the as-of date.",
      inputSchema: z.object({}), title: () => "Reporting API: data status and as-of date", run: () => api.dataStatus(PERFORMANCE),
    }),
    tracedTool(s, PERFORMANCE, {
      name: "get_published_figures",
      description: "Reporting API: a published figure set for a closed standard period (read from the published data, not recalculated).",
      inputSchema: z.object({ set: z.enum(FIGURE_SETS.map((f) => f.key) as [string, ...string[]]) }),
      title: (i) => `Reporting API: published figures (${i.set.replace(/_/g, " ")})`,
      run: (i) => api.publishedFigures(PERFORMANCE, i.set),
    }),
    tracedTool(s, PERFORMANCE, {
      name: "calculate_measures",
      description: "Reporting API: calculates approved measures for the client and any period through the calculation library. Returns the figures exactly as they must be quoted.",
      inputSchema: measureRequest,
      title: (i) => `Reporting API: calculate ${i.title} (${i.measures.join(", ")}${i.groupBy?.length ? " by " + i.groupBy.join(", ") : ""})`,
      run: (i) => api.calculate(PERFORMANCE, i),
    }),
    tracedTool(s, PERFORMANCE, {
      name: "submit_findings", description: "Hand the findings to the lead agent. Every figure in the text must be one the Reporting API returned.",
      inputSchema: findingsSchema, title: () => "Submits findings",
      run: async (f) => {
        const bad = api.unverified([f.summary, f.dataStatus, f.coverage, ...f.findings.flatMap((x) => [x.headline, x.detail])]);
        if (bad.length) throw new Error(`These figures were not returned by the Reporting API: ${bad.join(", ")}. Use the exact figures from the Reporting API, or leave the number out.`);
        s.findings = f;
        await saveAgentOutput(s.reportId, "FindingsJson", f);
        return "Findings recorded.";
      },
    }),
  ];
  await runAgent(s, PERFORMANCE, {
    system: PERFORMANCE_SYSTEM, tools, maxIterations: 24,
    prompt: `Task from the lead agent:\n${task}\n\nThe report period is ${isoDate(api.subject.from)} to ${isoDate(api.subject.to)}.`
      + (s.findings ? `\n\nFindings handed over earlier (update them for this task):\n${JSON.stringify(s.findings, null, 1)}` : ""),
  });
  if (!s.findings) throw new Error("The performance agent finished without submitting findings.");
  return s.findings;
}

// ---------- Reporting agent ----------

const REPORTING_SYSTEM = `You are the Reporting agent of a private bank's wealth-reporting studio. From the lead agent's brief and the
performance agent's findings you assemble a client report: the page layout, the sections, the charts and tables, and the narrative. You
return a renderable report definition.

How to work:
- Read report_rules, display_components and disclosures first; read data_dictionary, published_figure_sets, ready_made_modules or
  reusable_definitions when you need them.
- If you are given a reusable definition to start from, keep its structure and adapt it to this client and period. Its text is an
  example of the wording only: its figures belong to another client and must not be reused.
- If you are given the current report to change, change only what the brief asks and keep everything else as it is.
- Charts and tables are data blocks: the Reporting API fills them when the report is shown (from the published figures where a block
  matches a published figure set, otherwise calculated), so choose the measures and display; never type figures into them.
- Text blocks carry the narrative. Quote only the verified figures from the findings (or from preview_block), exactly as written.
- Use preview_block to see the figures a chart or table will show before you write about them.
- Choose the cover: an approved cover template that suits the client's segment and the request (cover_templates), and write
  its title, subtitle and, if it helps, a headline with one verified figure.
- Call submit_report with the whole report. If it lists problems, fix them and submit again. When it is accepted, reply with one
  short sentence.`;

const blockSchema = z.object({
  type: z.enum(["text", "data", "disclaimer"]),
  title: z.string().optional(),
  text: z.string().optional().describe("text blocks"),
  variant: z.enum(["body", "header"]).optional().describe("text blocks"),
  disclosureCode: z.string().optional().describe("disclaimer blocks"),
  display: z.enum(["kpi", "list", "table", "bar", "line", "pie"]).optional().describe("data blocks"),
  measures: z.array(z.string()).optional(),
  groupBy: z.array(z.string()).optional(),
  period: z.string().optional(),
  compare: z.string().optional(),
  topN: z.number().int().nullish(),
  sort: z.enum(["value_desc", "value_asc", "label_asc"]).optional(),
  width: z.enum(["full", "half"]).optional(),
  labels: z.record(z.string(), z.string()).nullish(),
});
const coverSchema = z.object({
  templateId: z.number().int().describe("An approved cover template (read_knowledge cover_templates)."),
  eyebrow: z.string().optional(), title: z.string(), subtitle: z.string().optional(), reportType: z.string().optional(),
  headline: z.string().optional().describe("Optional: one short line with a verified figure, e.g. 'Return 6.04% against 7.33% for the benchmark'."),
  note: z.string().optional().describe("Optional short personal line, e.g. 'Prepared for our meeting in February'."),
});
const reportSchema = z.object({
  title: z.string().describe("The report's name, e.g. 'Annual review 2025'."),
  cover: coverSchema.optional().describe("The cover: an approved cover template and its words. Leave out to keep the current cover."),
  pages: z.array(z.object({
    title: z.string(), heading: z.string(), sectionLabel: z.string().optional(),
    layout: z.enum(["cover", "letter", "kpi", "standard"]),
    blocks: z.array(blockSchema),
  })),
});

export async function runReportingAgent(s: RunState, brief: string) {
  const api = s.api;
  const tools = [
    knowledgeTool(s, REPORTING),
    tracedTool(s, REPORTING, {
      name: "read_reusable_definition", description: "Read a reusable report definition (pages and blocks) saved by a wealth manager.",
      inputSchema: z.object({ definitionId: z.number().int() }), title: (i) => `Reads reusable definition #${i.definitionId}`,
      run: async (i) => {
        const d = await getReusableDefinition(i.definitionId);
        if (!d) throw new Error(`There is no reusable definition #${i.definitionId}.`);
        return { name: d.name, description: d.description, definition: editable(normaliseDefinition(JSON.parse(d.definitionJson))) };
      },
    }),
    tracedTool(s, REPORTING, {
      name: "preview_block", description: "Reporting API: fill one data block to see the figures it will show, and whether they are published or calculated.",
      inputSchema: measureRequest.extend({ display: z.enum(["kpi", "list", "table", "bar", "line", "pie"]).optional() }),
      title: (i) => `Reporting API: preview ${i.display ?? "block"} ${i.title}`,
      run: (i) => api.calculate(REPORTING, i),
    }),
    tracedTool(s, REPORTING, {
      name: "submit_report", description: "Submit the complete report. It is checked against the catalogue, the display rules, the disclosure library and the verified figures.",
      inputSchema: reportSchema, title: (r) => `Submits '${r.title}' (${r.pages.length} pages)`,
      run: async (r) => {
        const pages = r.pages.map((p, i) => ({ ...p, id: `p${i + 1}`, sectionLabel: p.sectionLabel ?? "", blocks: p.blocks.map((b, j) => ({ ...b, id: `p${i + 1}b${j + 1}` })) }));
        const base = s.report?.definition ?? s.previous?.definition ?? s.startFrom?.definition;
        const cover = await chooseCover(s, r.cover, base?.cover ?? null, r.title);
        const { definition, problems } = await api.checkReport(REPORTING, { branding: base?.branding, cover, pages }, TextOrigins.ReportingAgent);
        if (problems.length) throw new Error(`The report was not accepted:\n- ${problems.join("\n- ")}`);
        s.report = accepted = { title: r.title, definition };
        await saveAgentOutput(s.reportId, "DefinitionJson", definition);
        return `Accepted: ${definition.pages.length} pages.`;
      },
    }),
  ];
  let accepted: RunState["report"] = null;
  const f = s.findings!;
  // What the reporting agent changes: its own accepted draft in this run (a revision the lead asked for), the version the
  // wealth manager wants changed, or a reusable definition to start from.
  const base = s.report
    ? `Your accepted report '${s.report.title}' from earlier in this run - revise it as the brief asks:\n${JSON.stringify(editable(s.report.definition))}\n\n`
    : s.previous
      ? `The current report (version ${s.previous.version}, '${s.previous.title}') - change it as the brief asks:\n${JSON.stringify(editable(s.previous.definition))}\n\n`
      : s.startFrom
        ? `Start from reusable definition #${s.startFrom.definitionId} '${s.startFrom.name}':\n${JSON.stringify(editable(s.startFrom.definition))}\n\n`
        : "";
  await runAgent(s, REPORTING, {
    system: REPORTING_SYSTEM, tools, maxIterations: 16,
    prompt: `Brief from the lead agent:\n${brief}\n\nClient context:\n${JSON.stringify(await api.clientContext(REPORTING))}\n\n${base}`
      + `Findings from the performance agent (verified figures):\n${JSON.stringify(f, null, 1)}`,
  });
  if (!accepted) throw new Error(s.report
    ? "The reporting agent did not submit a revised report; the report it submitted earlier is still the accepted one."
    : "The reporting agent finished without an accepted report.");
  const report = accepted as { title: string; definition: ReportDefinition };
  return { title: report.title, reportDefinition: outline(report.definition) };
}

/** The cover for a submitted report: the agent's choice of approved template and words, else the current cover, else the house cover. */
async function chooseCover(s: RunState, chosen: z.infer<typeof coverSchema> | undefined, current: CoverSettings | null, title: string): Promise<CoverSettings> {
  const approved = await approvedCovers();
  if (!chosen && current) return current;
  const t = approved.find((x) => x.coverTemplateId === chosen?.templateId)
    ?? approved.find((x) => x.segment === s.api.segment) ?? approved.find((x) => x.name === "Classic band") ?? approved[0];
  if (chosen && t.coverTemplateId !== chosen.templateId) throw new Error(`Cover template ${chosen.templateId} is not approved. Read cover_templates.`);
  return normaliseCover({ ...t.settings, title, subtitle: "{Portfolio}", ...(chosen ?? {}) })!;
}

// ---------- Lead agent ----------

export async function runLeadAgent(s: RunState): Promise<void> {
  const system = `You are the Lead agent (coordinator) of a private bank's wealth-reporting studio. A wealth manager asks for a client
report in their own words, or asks for a change to a report the agents made. You understand the request, plan the work, delegate to
two specialists and return the completed report.

Your specialists (call them as tools):
- delegate_to_performance_agent: selects measures, gets the figures through the Reporting API (published figures for closed standard
  periods, the calculation library otherwise), checks coverage, as-of date and data status, and returns findings. Give it a clear task:
  what to analyse and why.
- delegate_to_reporting_agent: assembles the layout, sections, charts and narrative from the findings and returns the report
  definition. Give it a brief: audience, purpose, length, tone and what to emphasise - or, for a change, exactly what to change.

Read the report definition it returns and check it against the request. You may delegate again with a new task or brief if a result
does not meet the request. For a change request, use the existing findings and call the performance agent only if the change needs
figures they do not cover. When the report is accepted, call complete_report with a short message to the wealth manager (what the
report covers or what changed, the as-of date and data status, anything they should check). Do not write the report yourself.

${await knowledgeOverview()}`;
  const tools = [
    tracedTool(s, LEAD, {
      name: "delegate_to_performance_agent", description: "Delegate the analysis to the Performance agent; returns its findings.",
      inputSchema: z.object({ task: z.string() }), title: (i) => `Delegates to performance agent: ${i.task.slice(0, 160)}`,
      run: (i) => runPerformanceAgent(s, i.task),
    }),
    tracedTool(s, LEAD, {
      name: "delegate_to_reporting_agent", description: "Delegate report assembly (or a change) to the Reporting agent (needs findings first); returns the accepted report definition.",
      inputSchema: z.object({ brief: z.string() }), title: (i) => `Delegates to reporting agent: ${i.brief.slice(0, 160)}`,
      run: async (i) => {
        if (!s.findings) throw new Error("Delegate to the performance agent first: the reporting agent needs its findings.");
        return runReportingAgent(s, i.brief);
      },
    }),
    tracedTool(s, LEAD, {
      name: "complete_report", description: "Return the completed report to the wealth manager.",
      inputSchema: z.object({ message: z.string().describe("Two to four sentences to the wealth manager.") }),
      title: () => "Returns the report to the wealth manager",
      run: async (i) => {
        if (!s.report) throw new Error("There is no accepted report yet.");
        const bad = s.api.unverified([i.message]);
        if (bad.length) throw new Error(`These figures were not returned by the Reporting API: ${bad.join(", ")}.`);
        s.completed = { message: i.message };
        return "Done.";
      },
    }),
  ];
  const c = await s.api.clientContext(LEAD);
  const period = `Period: ${isoDate(s.api.subject.from)} to ${isoDate(s.api.subject.to)} (${c.period.label}). ${c.period.figures}`;
  const prompt = s.previous
    ? `Change request from the wealth manager for version ${s.previous.version} of '${s.previous.title}':\n"${s.request}"\n\n`
      + `Report subject: ${c.subject} (household ${c.household}). ${period}\n\nThe current report definition:\n${JSON.stringify(outline(s.previous.definition))}\n\n`
      + `The performance agent's findings from before are available to the reporting agent:\n${JSON.stringify(s.findings)}`
    : `Request from the wealth manager:\n"${s.request}"\n\nReport subject: ${c.subject} (household ${c.household}).\n${period}`
      + (s.startFrom ? `\n\nThe wealth manager asked to start from reusable definition #${s.startFrom.definitionId} '${s.startFrom.name}'. Tell the reporting agent.` : "");
  await runAgent(s, LEAD, { system, tools, maxIterations: 10, prompt });
  if (!s.completed) throw new Error("The lead agent stopped without returning a report.");
}
