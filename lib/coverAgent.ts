import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { config } from "./config";
import { coverIssues, coverTexts, normaliseCover, type CoverSettings } from "./cover";
import { agentMay, type CoverOptionSet } from "./coverOptions";
import { execute, query, queryOne } from "./db";
import { StudioError } from "./errors";
import type { AppUser, ClientContext, Fact } from "./models";
import { allowedNumbers, unverifiedNumbers } from "./orchestration/numberCheck";
import { readKnowledge } from "./agents/knowledge";
import type { approvedCovers } from "./repos/covers";

/**
 * The cover agent (V9). The Cover tab stays a set of options, and the agent decides what goes with each choice:
 *  - "plan": when the tab opens, one call recommends the options for this client (★) and plans ahead, for each choice the
 *    wealth manager may make next (every layout, image, template...), which other options should change with it. The
 *    browser applies a planned choice at once, with no call.
 *  - "decide": a choice the plan does not cover, or a planned one whose drawing fails a check, gets one quick call to a
 *    smaller model, and its changes are applied straight away (the wealth manager can undo them).
 * Each is one call with everything in it (no back-and-forth tools), the browser's measurements instead of a picture, and the
 * fixed part (instructions, rules, templates) cached. Answers come back as JSON and are checked here: only approved values,
 * never the wealth manager's own choices, and nothing that breaks compliance's rules.
 * V10: the approved cover options (lib/coverOptions.ts) say which values are offered, what the agent may change and which
 * choices it plans ahead, so the bank changes the agent's room without a code change.
 */

/** The settings the agent works on: the options in the Cover tab, not the cover's words. */
export const AGENT_KEYS = [
  "layout", "band", "bandAngle", "image", "overlay", "titlePosition", "titleAlign",
  "theme", "logo", "logoPosition", "logoSize", "coBrand", "businessTag",
  "titleFont", "titleSize", "titleWeight", "letterSpacing", "eyebrowCase",
  "language", "salutation", "rmCard",
] as const;
/** The choices the plan covers, as the cover options set them. */
const plannedKeys = (options: CoverOptionSet) => options.options.filter((o) => o.planned).map((o) => o.key);

export interface Change { key: string; value: string | number | boolean; reason: string; current?: unknown }
export interface CoverReport {
  kind: "agent" | "client"; id: number; title: string; period: string; summary: string; facts: Fact[]; clientReportId: number | null;
  context: ClientContext; preferences: HouseholdPreference | null;
}
export interface HouseholdPreference { preferredLanguage: string; formOfAddress: string; coBrandName: string | null; businessArea: string }
type Templates = Awaited<ReturnType<typeof approvedCovers>>;
type Measurements = Record<string, unknown>;
export type PlanInput = { cover: CoverSettings; measurements: Measurements | null; templateMeasurements?: Record<string, Measurements> | null };
export type DecideInput = { cover: CoverSettings; previous: CoverSettings | null; changedKeys: string[]; userKeys: string[]; measurements: Measurements | null; planned: Change[] };

export const getHouseholdPreference = (householdId: number) => queryOne<HouseholdPreference>("app",
  "SELECT PreferredLanguage, FormOfAddress, CoBrandName, BusinessArea FROM src_client.HouseholdPreference WHERE HouseholdId = @Id", { Id: householdId });

let client: Anthropic | null = null;
function getClient() {
  if (!config.ai.apiKey) throw new StudioError(503, "AI not configured", "ANTHROPIC_API_KEY is not set, so the cover agent is not available.");
  return (client ??= new Anthropic({ apiKey: config.ai.apiKey, baseURL: config.ai.baseUrl }));
}

// ---------- what the agent reads (the fixed part is the same on every call, so it is cached) ----------

const RawChange = z.object({ key: z.string(), value: z.string(), reason: z.string() });
const PlanOutput = z.object({
  summary: z.string(),
  recommendations: z.array(RawChange),
  plan: z.array(z.object({ key: z.string(), value: z.string(), changes: z.array(RawChange) })),
});
const DecideOutput = z.object({ summary: z.string(), changes: z.array(RawChange) });
type Raw = z.infer<typeof RawChange>;

const pick = (c: CoverSettings) => Object.fromEntries(AGENT_KEYS.map((k) => [k, c[k]]));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function system(templates: Templates, options: CoverOptionSet) {
  const may = options.options.filter((o) => o.agent === "change" && (AGENT_KEYS as readonly string[]).includes(o.key));
  const fixed = options.options.filter((o) => o.agent === "fixed");
  const has = (key: string) => may.some((o) => o.key === key);
  return `You are the cover agent in a private bank's report studio. A wealth manager designs a client report's cover by choosing
options in the Cover tab (template, layout and design, branding, typography, personalisation). You decide which other options
should change with each choice they make, so the cover always works as a whole. Your answer is applied straight away (they can undo it).

How to decide:
- Start from the client and the report, not from taste: the client's preferences (language, form of address, co-brand, business
  area) and segment, and the house rules below.
- Only use the allowed values below. Never write the cover's words (title, subtitle, headline, note); the co-brand is the only text
  you may set, and only to the client's recorded co-brand name.
- Never change an option the wealth manager chose themselves. Change as little as needed; no change is often the right answer.
- Judge layout from the measurements of the drawn cover: the title should take at most two lines, nothing may overlap (logo, tag,
  title, relationship manager card, footer), and the text must not run into the footer or off the page. A half-width text column
  (split layout) fits about 14 characters per line at a Large title, 18 at Medium and 24 at Small.
- Every change needs a short, specific reason the wealth manager can judge (under 20 words), e.g. "Split halves the text column;
  Medium keeps the title to two lines." Use names, not ids or setting keys. No marketing language.
- Values are always strings: numbers as "0.45", true/false as "true"/"false", templates by their id.

${await readKnowledge("cover_templates")}

# Approved templates
${templates.map((t) => `- id ${t.coverTemplateId} "${t.name}" (${t.segment}): ${t.description} Settings: ${JSON.stringify(pick(t.settings))}`).join("\n")}

# Allowed values (the bank's approved cover options${options.version ? `, version ${options.version}` : ""})
${may.filter((o) => o.values).map((o) => `- ${o.key} (${o.label}): ${o.values!.filter((x) => x.enabled).map((x) => `${JSON.stringify(x.value)}${x.label !== x.value || x.colour ? ` (${x.label}${x.colour ? `, ${x.colour}` : ""})` : ""}`).join(", ")}`).join("\n")}
${has("overlay") ? "- overlay: 0 to 0.8 (darkens the background image; 0.35 or more keeps a white title readable on most images)\n" : ""}${has("coBrand") ? "- coBrand: the client's recorded co-brand name, or \"\"\n" : ""}${has("rmCard") ? "- rmCard: \"true\" or \"false\" (relationship manager card with name and initials)\n" : ""}${fixed.length ? `
# Options you never change
The bank's cover options keep these with the wealth manager: ${fixed.map((o) => o.key === "templateId" ? "templateId (do not recommend a template)" : `${o.key} (${o.label})`).join(", ")}.
` : ""}
# House rules
- Match the template to the client segment; 'All' templates suit anyone.
- Business tag: the client's business area.
- Cover language and name on the cover: the client's preferences.
- Name a family office, trust or partner as co-brand only when the client has one recorded.
- The title should take at most two lines; long titles get a smaller size.
- A background image needs an overlay that keeps the title readable.
- The logo must not overlap the title, the business tag or the footer (classification and legal line).
- Formal tone: serif or Georgia, regular weight, normal or wide spacing. Modern tone: Inter, bold.`;
}

function clientBlock(r: CoverReport) {
  const c = r.context;
  return `# The client and the report
${JSON.stringify({
    client: c.clientName, household: c.householdName, segment: c.segment, entityTypes: [...new Set(c.entities.map((e) => e.clientType))],
    relationshipManager: c.relationshipManager, preferences: r.preferences ?? "none recorded",
    report: { title: r.title, period: r.period, summary: r.summary.slice(0, 600) },
  })}`;
}

const describe = (cover: CoverSettings, m: Measurements | null) => `Current cover options: ${JSON.stringify(pick(cover))}
Template: ${cover.templateName ?? "none"} (id ${cover.templateId ?? "-"}). Title: "${cover.title}"${cover.eyebrow ? `, eyebrow: "${cover.eyebrow}"` : ""}.
Measurements of the drawn cover: ${m ? JSON.stringify(m) : "not available"}`;

/** What the browser measured on a template's own settings, in a few words for the plan. */
function templateDrawing(m: Measurements | undefined) {
  if (!m) return "";
  const x = m as Record<string, unknown>;
  const problems = [
    Number(x.titleLines) > 2 ? `title takes ${x.titleLines} lines` : null,
    ...((x.overlaps as string[] | undefined) ?? []),
    x.contentRunsIntoFooter ? "text runs into the footer" : null,
    x.contentOutsidePage ? "text runs off the page" : null,
  ].filter(Boolean);
  const fits = x.titleFits as { titleSize: string; titleWeight: string }[] | undefined;
  const fit = fits ? `; the title takes two lines only with ${fits.length ? fits.map((f) => `titleSize ${f.titleSize} + titleWeight ${f.titleWeight}`).join(" or ") : "none of the sizes and weights"}` : "";
  return ` [drawn: title ${x.titleLines} lines at ${x.titleFontSize} in a ${x.textColumnWidth}px column; ${problems.length ? `PROBLEMS: ${problems.join(", ")}${fit}` : "no problems"}]`;
}

/**
 * The values of each planned choice, so the plan covers exactly what the wealth manager can pick next. Templates include the
 * current one (switching back to it after trying another), each with how the browser drew it on the template's own settings.
 */
function nextChoices(cover: CoverSettings, templates: Templates, options: CoverOptionSet, drawn?: Record<string, Measurements> | null) {
  return options.options.filter((o) => o.planned).map(({ key: k, values: offered }) => {
    const values = k === "templateId"
      ? templates.map((t) => `${t.coverTemplateId} (${t.name}${t.coverTemplateId === cover.templateId ? ", the current template: plan for switching back to it" : ""})${templateDrawing(drawn?.[String(t.coverTemplateId)])}`)
      : (offered ?? []).filter((x) => x.enabled && x.value !== (cover as unknown as Record<string, unknown>)[k]).map((x) => JSON.stringify(x.value));
    return `- ${k}: ${values.join(k === "templateId" ? "\n    " : ", ")}`;
  }).join("\n");
}

// ---------- checking the answer ----------

function coerce(key: string, value: string): string | number | boolean {
  if (key === "overlay" || key === "templateId") return Number(value);
  if (key === "rmCard") return value === "true";
  return value;
}

/**
 * Applies changes on top of a cover. Switching template starts from its settings and keeps the cover's words; `fresh` does that
 * even for the current template (the plan for switching back to it).
 */
function apply(base: CoverSettings, changes: Record<string, unknown>, templates: Templates, fresh = false): CoverSettings {
  let start: CoverSettings = base;
  if (changes.templateId != null && (fresh || Number(changes.templateId) !== base.templateId)) {
    const t = templates.find((x) => x.coverTemplateId === Number(changes.templateId));
    if (!t) throw new Error(`template ${changes.templateId} is not approved`);
    start = { ...t.settings, eyebrow: base.eyebrow, title: base.title, subtitle: base.subtitle, reportType: base.reportType, headline: base.headline, note: base.note };
  }
  const { templateId: _t, ...rest } = changes;
  const unknown = Object.keys(rest).filter((k) => !(AGENT_KEYS as readonly string[]).includes(k));
  if (unknown.length) throw new Error(`${unknown.join(", ")} is not an option the agent may change`);
  const cover = normaliseCover({ ...start, ...rest })!;
  const refused = Object.entries(rest).filter(([k, v]) => !same((cover as unknown as Record<string, unknown>)[k], v));
  if (refused.length) throw new Error(`not allowed: ${refused.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}`);
  return cover;
}

function check(cover: CoverSettings, r: CoverReport, templates: Templates) {
  const issues = coverIssues(cover, templates.map((t) => ({ coverTemplateId: t.coverTemplateId, version: t.version })));
  const allowed = allowedNumbers(r.facts);
  const figures = [...new Set(coverTexts(cover).flatMap((t) => unverifiedNumbers(t, allowed)))];
  if (figures.length) issues.blockers.push(`Figures that are not verified: ${figures.join(", ")}.`);
  return issues;
}

/**
 * Keeps the changes that are allowed, one by one, and drops the rest: unknown options or values, the wealth manager's own
 * choices, a co-brand other than the client's, changes that change nothing. If the result breaks a compliance rule the cover
 * did not break before, nothing is kept.
 */
function clean(base: CoverSettings, items: Raw[], r: CoverReport, templates: Templates, options: CoverOptionSet, opts: { keep: string[]; allowTemplate?: boolean; keepSame?: boolean }) {
  const changes: Change[] = [], dropped: string[] = [];
  const seen = new Set<string>();
  let cover = base;
  const ordered = [...items].sort((a, b) => Number(b.key === "templateId") - Number(a.key === "templateId"));
  for (const p of ordered) {
    if (seen.has(p.key)) { dropped.push(`${p.key}: proposed twice`); continue; }
    seen.add(p.key);
    if (opts.keep.includes(p.key)) { dropped.push(`${p.key}: the wealth manager's own choice`); continue; }
    if (p.key === "templateId" && !opts.allowTemplate) { dropped.push("templateId: not here"); continue; }
    const value = coerce(p.key, p.value);
    const refused = p.key === "templateId" ? (options.options.find((o) => o.key === "templateId")?.agent === "fixed" ? "the cover options keep the template with the wealth manager" : null)
      : agentMay(options, p.key, value);
    if (refused) { dropped.push(`${p.key}: ${refused}`); continue; }
    if (p.key === "coBrand" && value !== "" && value !== r.preferences?.coBrandName) { dropped.push("coBrand: not the client's recorded name"); continue; }
    try {
      const next = apply(cover, { [p.key]: value }, templates);
      const current = (base as unknown as Record<string, unknown>)[p.key];
      if (!opts.keepSame && same(value, current)) continue;
      changes.push({ key: p.key, value, reason: p.reason.trim().slice(0, 200), current });
      cover = next;
    } catch (e) { dropped.push(`${p.key}: ${(e as Error).message}`); }
  }
  const before = check(base, r, templates).blockers;
  const after = check(cover, r, templates).blockers.filter((b) => !before.includes(b));
  if (after.length) return { changes: [] as Change[], cover: base, dropped: [...dropped, ...after] };
  return { changes, cover, dropped };
}

// ---------- the two calls ----------

interface Call<T> { output: T; prompt: string; usage: { in: number; out: number }; ms: number; model: string }

async function call<T>(user: AppUser, r: CoverReport, mode: "plan" | "decide", schema: z.ZodType<T>, templates: Templates, options: CoverOptionSet, task: string): Promise<Call<T>> {
  const plan = mode === "plan";
  const since = Date.now();
  const params = {
    model: plan ? config.ai.model : config.ai.fastModel,
    max_tokens: plan ? 16000 : 4000,
    // The quick decision is a small, well-specified step: no thinking keeps it to a second or two.
    ...(plan ? { betas: ["server-side-fallback-2026-06-01"], fallbacks: [{ model: config.ai.fallbackModel }] } : { thinking: { type: "disabled" } }),
    output_config: { effort: plan ? config.ai.planEffort : config.ai.fastEffort, format: betaZodOutputFormat(schema) },
    system: [{ type: "text", text: await system(templates, options), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [
      { type: "text", text: clientBlock(r), cache_control: { type: "ephemeral" } },
      { type: "text", text: task },
    ] }],
  };
  const m = await getClient().beta.messages.parse(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
  const ms = Date.now() - since;
  const usage = { in: (m.usage.input_tokens ?? 0) + (m.usage.cache_read_input_tokens ?? 0) + (m.usage.cache_creation_input_tokens ?? 0), out: m.usage.output_tokens };
  await logCall(user, r, mode, task, m, usage, ms);
  if (m.stop_reason === "refusal") throw new StudioError(502, "Cover agent declined", "The model declined this request.");
  if (m.stop_reason === "max_tokens") throw new StudioError(502, "Cover agent error", "The answer was cut off.");
  const output = schema.safeParse(m.parsed_output);
  if (!output.success) throw new StudioError(502, "Cover agent error", "The answer did not have the expected shape.");
  return { output: output.data, prompt: task, usage, ms, model: m.model };
}

/** When the tab opens: recommendations for this client, and a plan for every choice the wealth manager may make next. */
export async function planCover(user: AppUser, r: CoverReport, input: PlanInput, templates: Templates, options: CoverOptionSet) {
  getClient();
  const task = `The wealth manager opened the Cover tab of "${r.title}" for ${r.context.clientName}.
${describe(input.cover, input.measurements)}

1. recommendations: your recommended value for the options that matter for this client and report (templateId first if a template
   fits better). Include a value even when the current one is already right, so the wealth manager sees why.
2. plan: for each choice below that the wealth manager may make next, the other options that should change with it on the current
   cover (an empty list when nothing else needs to change). One entry per choice; never change the chosen option itself, and never
   change the template inside a plan entry. A template switch starts from that template's own settings; where its drawing shows
   PROBLEMS, include the changes that fix them (for example the titleSize and titleWeight measured to keep the title to two lines).
${nextChoices(input.cover, templates, options, input.templateMeasurements)}
3. summary: one sentence on what suits this client.`;
  return run(user, r, "plan", input, async () => {
    const c = await call(user, r, "plan", PlanOutput, templates, options, task);
    const recs = clean(input.cover, c.output.recommendations, r, templates, options, { keep: [], allowTemplate: true, keepSame: true });
    const plan: { key: string; value: string | number | boolean; changes: Change[] }[] = [];
    const dropped = [...recs.dropped.map((d) => `recommendation ${d}`)];
    for (const e of c.output.plan) {
      if (!plannedKeys(options).includes(e.key)) { dropped.push(`plan ${e.key}: not a planned choice`); continue; }
      const value = coerce(e.key, e.value);
      const offered = options.options.find((o) => o.key === e.key)?.values;
      if (offered && !offered.some((x) => x.enabled && x.value === value)) { dropped.push(`plan ${e.key}=${e.value}: not offered`); continue; }
      let after: CoverSettings;
      try { after = apply(input.cover, { [e.key]: value }, templates, e.key === "templateId"); } catch (err) { dropped.push(`plan ${e.key}=${e.value}: ${(err as Error).message}`); continue; }
      const companions = clean(after, e.changes, r, templates, options, { keep: [e.key] });
      dropped.push(...companions.dropped.map((d) => `plan ${e.key}=${e.value}, ${d}`));
      if (!plan.some((p) => p.key === e.key && same(p.value, value))) plan.push({ key: e.key, value, changes: companions.changes });
    }
    return { call: c, result: { summary: c.output.summary.slice(0, 400), recommendations: recs.changes, plan, base: { templateId: input.cover.templateId, templateVersion: input.cover.templateVersion, optionsVersion: options.version }, dropped } };
  });
}

/** After a choice the plan does not cover (or whose drawing fails a check): what else should change with it. */
export async function decideCover(user: AppUser, r: CoverReport, input: DecideInput, templates: Templates, options: CoverOptionSet) {
  getClient();
  const before = input.previous ? Object.fromEntries(input.changedKeys.map((k) => [k, (input.previous as unknown as Record<string, unknown>)[k]])) : {};
  const after = Object.fromEntries(input.changedKeys.map((k) => [k, (input.cover as unknown as Record<string, unknown>)[k]]));
  const task = `The wealth manager just changed ${input.changedKeys.join(", ")} on the cover of "${r.title}" for ${r.context.clientName}.
Before: ${JSON.stringify(before)}. After: ${JSON.stringify(after)}.
${input.planned.length ? `Planned changes already applied with it: ${input.planned.map((p) => `${p.key}=${JSON.stringify(p.value)}`).join(", ")}.\n` : ""}${describe(input.cover, input.measurements)}
Options the wealth manager chose themselves (keep them): ${[...new Set([...input.changedKeys, ...input.userKeys])].join(", ")}.
changes: only the options this change affects that must change so the cover still works: line breaks, overlaps, readability,
or options that no longer fit the new choice. An empty list if it is fine. Do not bring in other recommendations for this client
(template, co-brand, business tag, typography, personalisation): the wealth manager sees those separately. summary: one sentence.`;
  return run(user, r, "decide", input, async () => {
    const c = await call(user, r, "decide", DecideOutput, templates, options, task);
    const kept = clean(input.cover, c.output.changes, r, templates, options, { keep: [...input.changedKeys, ...input.userKeys] });
    return { call: c, result: { summary: c.output.summary.slice(0, 400), changes: kept.changes, dropped: kept.dropped } };
  });
}

/** Records the call in studio.CoverAgentRun (the plan is kept there, so opening the tab again costs nothing). */
async function run<R>(user: AppUser, r: CoverReport, mode: "plan" | "decide", input: unknown, work: () => Promise<{ call: Call<unknown>; result: R }>) {
  try {
    const { call: c, result } = await work();
    const row = await queryOne<{ id: number }>("app", `INSERT studio.CoverAgentRun (ReportKind, ReportId, Mode, Status, Model, InputJson, PromptText, ResultJson, InputTokens, OutputTokens, LatencyMs, CreatedBy)
      VALUES (@Kind, @Report, @Mode, N'Done', @Model, @Input, @Prompt, @Result, @In, @Out, @Ms, @User); SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id;`, {
      Kind: r.kind, Report: r.id, Mode: mode, Model: c.model.slice(0, 60), Input: JSON.stringify(input), Prompt: c.prompt, Result: JSON.stringify(result),
      In: c.usage.in, Out: c.usage.out, Ms: c.ms, User: user.userId,
    });
    return { runId: row!.id, ...result, tokens: c.usage.in + c.usage.out, ms: c.ms, model: c.model };
  } catch (e) {
    await execute("app", `INSERT studio.CoverAgentRun (ReportKind, ReportId, Mode, Status, InputJson, Error, CreatedBy) VALUES (@Kind, @Report, @Mode, N'Failed', @Input, @Error, @User)`,
      { Kind: r.kind, Report: r.id, Mode: mode, Input: JSON.stringify(input), Error: (e as Error).message.slice(0, 2000), User: user.userId }).catch(() => {});
    if (e instanceof StudioError) throw e;
    // The API's own message ("Your credit balance is too low...") rather than the raw JSON around it.
    const api = e instanceof Anthropic.APIError ? (e.error as { error?: { message?: string } } | undefined)?.error?.message : null;
    throw new StudioError(502, "Cover agent error", `The cover agent could not run: ${api ?? (e as Error).message}`);
  }
}

// ---------- kept runs ----------

/** The run's row, for the report it belongs to. */
export async function getCoverRun(runId: number, kind: string, reportId: number) {
  const run = await queryOne<Record<string, unknown>>("app", "SELECT RunId, ReportKind, Mode FROM studio.CoverAgentRun WHERE RunId = @Id AND ReportKind = @Kind AND ReportId = @Report",
    { Id: runId, Kind: kind, Report: reportId });
  if (!run) throw new StudioError(404, "Not found", "That cover agent run does not belong to this report.");
  return run;
}

/** The latest plan for a report. */
export async function latestPlan(kind: string, reportId: number) {
  const row = await queryOne<{ runId: number; resultJson: string; createdOn: Date; inputTokens: number; outputTokens: number; latencyMs: number; model: string }>("app", `
    SELECT TOP (1) RunId, ResultJson, CreatedOn, InputTokens, OutputTokens, LatencyMs, Model FROM studio.CoverAgentRun
    WHERE ReportKind = @Kind AND ReportId = @Report AND Mode = N'plan' AND Status = N'Done' ORDER BY RunId DESC`, { Kind: kind, Report: reportId });
  if (!row) return null;
  return { runId: row.runId, createdOn: row.createdOn, tokens: row.inputTokens + row.outputTokens, ms: row.latencyMs, model: row.model, ...JSON.parse(row.resultJson) };
}

/** Changes the agent applied later replace the plan's recommendation for those options. */
export async function supersedeRecommendations(kind: string, reportId: number, keys: string[]) {
  const latest = await latestPlan(kind, reportId);
  if (!latest || !keys.length) return;
  const { runId, createdOn: _c, tokens: _t, ms: _m, model: _model, ...result } = latest;
  result.recommendations = (result.recommendations as Change[]).filter((p) => !keys.includes(p.key));
  await execute("app", "UPDATE studio.CoverAgentRun SET ResultJson = @Result WHERE RunId = @Id", { Id: runId, Result: JSON.stringify(result) });
}

export const runTotals = (kind: string, reportId: number) => query<{ mode: string; runs: number; tokens: number }>("app", `
  SELECT Mode, COUNT(*) AS Runs, SUM(InputTokens + OutputTokens) AS Tokens FROM studio.CoverAgentRun
  WHERE ReportKind = @Kind AND ReportId = @Report AND Status = N'Done' GROUP BY Mode`, { Kind: kind, Report: reportId });

/** AI monitoring (gov.AiInteraction), like every other model call in the studio. */
const logCall = (user: AppUser, r: CoverReport, mode: string, task: string, m: Anthropic.Beta.BetaMessage, usage: { in: number; out: number }, ms: number) => execute("app", `
  INSERT gov.AiInteraction (UserId, Agent, Purpose, ClientReportId, Provider, Model, Prompt, Response, InputTokens, OutputTokens, LatencyMs, Outcome, Notes)
  VALUES (@User, N'Cover agent', @Purpose, @ClientReport, N'Anthropic', @Model, @Prompt, @Response, @In, @Out, @Ms, @Outcome, @Notes)`, {
  User: user.userId, Purpose: `Cover ${mode} for ${r.kind} report #${r.id}`.slice(0, 200), ClientReport: r.clientReportId,
  Model: m.model.slice(0, 60), Prompt: task.slice(0, 20000),
  Response: m.content.map((b) => (b.type === "text" ? b.text : "")).join("").slice(0, 20000), In: usage.in, Out: usage.out, Ms: ms,
  Outcome: m.stop_reason === "refusal" || m.stop_reason === "max_tokens" ? "Error" : "Accepted",
  Notes: `${m.stop_reason}; cached ${m.usage.cache_read_input_tokens ?? 0} of ${usage.in} input tokens`.slice(0, 200),
}).catch((e) => console.warn("Could not log a cover agent call", e));
