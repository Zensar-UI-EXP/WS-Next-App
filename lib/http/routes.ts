import { z } from "zod";
import { aiEnabled, aiForReport, aiInteraction, aiSummary, languageModel } from "../ai/gateway";
import { audit, listAudit } from "../audit";
import { runBlock } from "../blockRunner";
import { validateBlock } from "../blockValidator";
import { getCatalog, publicCatalog } from "../catalog";
import * as reports from "../clientReports";
import { checkDefinition } from "../definitionRules";
import { InvalidBlockError, StudioError } from "../errors";
import {
  ALL_SCOPES, Check, EXCEPTION_STATUSES, Readiness, ReportStatus, Roles, TextOrigins, normaliseBlock, normaliseDefinition, type ClientReportDetail,
} from "../models";
import { buildContext } from "../orchestration/clientContext";
import { checkDataReadiness } from "../orchestration/dataReadiness";
import { runRelease } from "../orchestration/orchestrator";
import { analyse } from "../orchestration/performanceInsight";
import { revisePage } from "../pageAssistant";
import { bindParameters, detectInputs } from "../params";
import { getDisclosures } from "../repos/content";
import * as gov from "../repos/governance";
import { getRun, listRuns } from "../repos/orchestration";
import * as tpl from "../repos/reports";
import * as wealth from "../repos/wealth";
import { blockIssues, inputsFor, runVersion } from "../reportRun";
import { allUsers, canSeeHousehold } from "../users";
import { problem, type Handler } from "./http";
import { fillDisclosures } from "../repos/content";
import * as agents from "../agents/store";
import { apiFor, queueAgentReport } from "../agents/queue";
import { KNOWLEDGE_SECTIONS, readKnowledge } from "../agents/knowledge";
import { ReportingApi } from "../reporting/api";
import { lastPublishRun, publishAll } from "../reporting/published";
import * as covers from "../repos/covers";
import * as coverAgent from "../coverAgent";
import * as coverOptions from "../coverOptions";
import { normaliseCover } from "../cover";
import type { AppUser, Fact } from "../models";
import { isoDate } from "../db";

const { Designer: D, Approver: A, Advisor: W, Operations: O, Client: C } = Roles;
const STAFF = [D, A, W, O];

interface Route { method: string; pattern: RegExp; keys: string[]; roles: string[] | null; handler: Handler }
export const routes: Route[] = [];
function route(method: string, path: string, roles: string[] | null, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
  routes.push({ method, pattern, keys, roles, handler });
}

const int = (v: string) => { const n = Number(v); if (!Number.isInteger(n)) throw new StudioError(404, "Not found", "Unknown id."); return n; };
const trimComment = (c?: string | null) => (c && c.trim() ? c.trim().slice(0, 1000) : null);
const definitionBody = z.object({ definition: z.unknown() }).transform((b) => normaliseDefinition(b.definition));

// ---------- users, catalogue, lookups, block preview ----------

route("GET", "users", null, async () => allUsers());
route("GET", "catalog", STAFF, async () => publicCatalog(await getCatalog()));
route("GET", "lookups/:type", [D, A], async ({ params }) => {
  if (!["household", "client", "portfolio"].includes(params.type.toLowerCase()))
    throw new StudioError(400, "Unknown lookup", "Lookup type must be household, client or portfolio.");
  return tpl.getLookup(params.type);
});
route("POST", "blocks/run", [D], async ({ body }) => {
  const b = await body(z.object({ scope: z.string(), parameters: z.record(z.string(), z.any()).default({}), block: z.unknown() }));
  if (!ALL_SCOPES.includes(b.scope)) throw new StudioError(400, "Unknown scope", `Scope must be one of ${ALL_SCOPES.join(", ")}.`);
  const block = normaliseBlock(b.block);
  const catalog = await getCatalog();
  const issues = validateBlock(block, b.scope, catalog);
  if (issues.length) return { blockId: block.id, columns: [], rows: [], issues, error: null, sql: null, dataProduct: null };
  return runBlock(block, b.scope, bindParameters(b.parameters, detectInputs(b.scope, [block], catalog)), true);
});

// ---------- templates (designer and compliance) ----------

async function templateDetail(id: number) {
  const detail = await tpl.getReportDetail(id);
  if (!detail) throw new StudioError(404, "Not found", `Template ${id} does not exist.`);
  for (const v of [detail.working, detail.published]) if (v) await fillDisclosures(v.definition);
  const current = detail.working ?? detail.published;
  if (current) { detail.inputs = await inputsFor(current.definition); detail.issues = await blockIssues(current.definition); }
  return detail;
}
const header = z.object({ name: z.string().trim().min(1, "Name is required (max 100 characters).").max(100), category: z.string().trim().min(1, "Category is required (max 100 characters).").max(100), description: z.string().nullish() });
const nameTaken = (e: unknown, name: string) => {
  if ((e as { number?: number }).number === 2627 || (e as { number?: number }).number === 2601)
    throw new StudioError(409, "Name taken", `A template called '${name.trim()}' already exists.`);
  throw e;
};

route("GET", "reports", [D, A], () => tpl.getAllReports());
route("GET", "reports/:id", [D, A], ({ params }) => templateDetail(int(params.id)));
route("GET", "reports/:id/versions/:no", [D, A], async ({ params }) => {
  const v = await tpl.getVersion(int(params.id), int(params.no));
  if (!v) throw new StudioError(404, "Not found", `Template ${params.id} has no version ${params.no}.`);
  await fillDisclosures(v.definition);
  return v;
});
route("POST", "reports", [D], async ({ body, user }) => {
  const h = await body(header);
  const id = await tpl.createReport(h.name, h.category, h.description ?? null, user.userId).catch((e) => nameTaken(e, h.name));
  await audit(user, "template.created", "Template", id, `Created template '${h.name}'.`);
  return templateDetail(id as number);
});
route("PUT", "reports/:id/draft", [D], async ({ params, body, user }) => {
  const id = int(params.id);
  if (!(await tpl.getReportDetail(id))) throw new StudioError(404, "Not found", `Template ${id} does not exist.`);
  const b = await body(header.extend({ definition: z.unknown() }));
  const definition = normaliseDefinition(b.definition);
  const errors: Record<string, string[]> = {};
  if (!ALL_SCOPES.includes(definition.scope)) errors["definition.scope"] = [`Scope must be one of ${ALL_SCOPES.join(", ")}.`];
  for (const [k, m] of checkDefinition(definition, 150)) errors[k] = [m];
  if (Object.keys(errors).length) return problem(400, "One or more validation errors occurred.", undefined, errors);
  await tpl.saveDraft(id, b.name, b.category, b.description ?? null, definition, user.userId).catch((e) => nameTaken(e, b.name));
  await audit(user, "template.saved", "Template", id, `Saved a draft of '${b.name}'.`);
  return templateDetail(id);
});
route("POST", "reports/:id/draft/preview", [D], async ({ params }) => {
  const detail = await templateDetail(int(params.id));
  if (!detail.working) throw new StudioError(409, "No draft", "Save a change to start a new draft version first.");
  const run = await runVersion(detail.reportId, detail.name, detail.working, detail.working.definition.preview, true);
  const previewPassed = run.blocks.length > 0 && run.blocks.every((b) => !b.issues.length && !b.error);
  await tpl.setPreviewPassed(detail.working.versionId, previewPassed);
  return { run, previewPassed };
});
route("POST", "reports/:id/draft/submit", [D], async ({ params, user }) => {
  const id = int(params.id);
  const detail = await templateDetail(id);
  const w = detail.working;
  if (!w || w.status !== "Draft") throw new StudioError(409, "Nothing to submit", "There is no draft version to submit.");
  const issues = await blockIssues(w.definition);
  if (Object.keys(issues).length)
    throw new StudioError(409, "Blocks incomplete", `Fix ${Object.keys(issues).length} block(s) first: ${[...new Set(Object.values(issues).flat())].join(" ")}`);
  if (!w.previewPassed) throw new StudioError(409, "Preview required", "Run a preview of this version in which every block loads without an error, then submit.");
  await tpl.submitVersion(w.versionId, user.userId);
  await audit(user, "template.submitted", "Template", id, `Submitted '${detail.name}' v${w.versionNo} for approval.`);
  return templateDetail(id);
});
route("POST", "reports/:id/versions/:no/run", [D, A], async ({ params, body }) => {
  const detail = await templateDetail(int(params.id));
  const v = await tpl.getVersion(detail.reportId, int(params.no));
  if (!v) throw new StudioError(404, "Not found", `Template ${params.id} has no version ${params.no}.`);
  const b = await body(z.object({ parameters: z.record(z.string(), z.any()).default({}) }));
  return runVersion(detail.reportId, detail.name, v, b.parameters, true);
});
for (const approve of [true, false])
  route("POST", `reports/:id/versions/:no/${approve ? "approve" : "reject"}`, [A], async ({ params, body, user }) => {
    const id = int(params.id), no = int(params.no);
    const v = await tpl.getVersion(id, no);
    if (!v) throw new StudioError(404, "Not found", `Template ${id} has no version ${no}.`);
    if (v.status !== "Submitted") throw new StudioError(409, "Not submitted", `Version ${no} is ${v.status}; only a submitted version can be ${approve ? "approved" : "returned"}.`);
    const comment = trimComment((await body(z.object({ comment: z.string().nullish() }))).comment);
    if (approve) {
      if (v.submittedBy === user.userId || v.updatedBy === user.userId)
        throw new StudioError(403, "Segregation of duties", "You cannot approve a version you created or submitted.");
      await tpl.publishVersion(id, v.versionId, user.userId, comment);
      await audit(user, "template.approved", "Template", id, `Approved and released v${no}.`, { comment });
    } else {
      if (!comment) return problem(400, "One or more validation errors occurred.", undefined, { comment: ["Say what needs to change."] });
      await tpl.rejectVersion(v.versionId, user.userId, comment);
      await audit(user, "template.returned", "Template", id, `Returned v${no} to the designer.`, { comment });
    }
    return templateDetail(id);
  });

// ---------- households and analysis ----------

route("GET", "households", [W, A, O], ({ user }) => wealth.getHouseholds(user.role === W ? user.households : null));
route("GET", "households/:id/analysis", [W], async ({ params, query, user }) => {
  const id = int(params.id);
  if (!canSeeHousehold(user, id)) throw new StudioError(404, "Not found", `Household ${id} does not exist.`);
  const year = Number(query.get("year")), periodKey = query.get("periodKey") ?? "FY";
  const clientId = query.get("clientId") ? Number(query.get("clientId")) : null;
  const portfolioCode = query.get("portfolioCode") || null;
  const asOf = await wealth.getAsOfDate();
  const probe = await buildContext(id, clientId, portfolioCode, asOf);
  const dataStart = probe.accounts.length ? new Date(Math.min(...probe.accounts.map((a) => a.inceptionDate.getTime()))) : probe.dataStart;
  const { from, to } = reports.resolvePeriod(year, periodKey, dataStart, asOf);
  const context = await buildContext(id, clientId, portfolioCode, to);
  const readiness = await checkDataReadiness(context, clientId, portfolioCode, from, to);
  const { insights, definition, results } = await analyse(context, { householdId: id, clientId, portfolioCode, from, to }, from, to);
  return { context, readiness, insights, definition, results, fromDate: from, toDate: to, periodLabel: reports.periodLabel(periodKey, year, to) };
});
route("GET", "templates", [W], async () => {
  const published = new Map((await tpl.getPublished()).map((p) => [p.report.reportId, p.version]));
  const list = (await tpl.getAllReports()).filter((r) => r.category !== AGENT_TEMPLATE_CATEGORY).map((r) => {
    const v = published.get(r.reportId);
    return {
      reportId: r.reportId, name: r.name, category: r.category, description: r.description,
      status: v ? "Released" : r.workingStatus === "Submitted" ? "Awaiting approval" : "In design", versionNo: v?.versionNo ?? null,
      scope: v?.definition.scope ?? "Client",
      pages: v?.definition.pages.map((p) => ({ id: p.id, title: p.title, group: p.group, locked: p.locked, condition: p.condition ?? null })) ?? [],
    };
  });
  return list.sort((a, b) => Number(a.status !== "Released") - Number(b.status !== "Released") || a.name.localeCompare(b.name));
});

// ---------- client reports ----------

route("GET", "client-reports", [W, A, C], ({ user }) => reports.listReports(user));
route("POST", "client-reports", [W], async ({ body, user }) => reports.createReport(await body(z.object({
  reportId: z.number().int(), householdId: z.number().int(), clientId: z.number().int().nullish().transform((v) => v ?? null),
  portfolioCode: z.string().nullish().transform((v) => v || null), year: z.number().int(), periodKey: z.string(),
  outputFormat: z.string().default("full_pdf"), pages: z.array(z.object({ id: z.string(), included: z.boolean().default(true) })).default([]),
})), user));
route("GET", "client-reports/:id", [W, A, C], async ({ params, user }) => {
  const r: ClientReportDetail = await reports.getReportFor(int(params.id), user);
  if (user.role === C) {
    await audit(user, "client-report.viewed", "ClientReport", r.clientReportId, "The client opened the report.");
    r.insights = null;
    r.readiness = null;
  }
  return r;
});
route("PUT", "client-reports/:id", [W], async ({ params, body, user }) => reports.saveReport(int(params.id), await body(definitionBody), user));
route("POST", "client-reports/:id/run", [W, A, C], async ({ params, body, user }) => {
  const r = await reports.getReportFor(int(params.id), user);
  const b = await body(z.object({ definition: z.unknown().nullish(), pageIds: z.array(z.string()).nullish() }));
  return reports.runReport(r, user.role === W && b.definition ? normaliseDefinition(b.definition) : null, b.pageIds ?? null);
});
route("POST", "client-reports/:id/submit", [W], async ({ params, body, user }) => {
  const id = int(params.id);
  await reports.saveReport(id, await body(definitionBody), user);
  const r = await reports.getReportFor(id, user);
  const { runId, readiness } = await runRelease(r, r.definition, user.userId);
  if (readiness.status === Readiness.Blocked) {
    await audit(user, "client-report.submit-blocked", "ClientReport", id, "Submission refused: the release checks found blockers.", { runId });
    throw new StudioError(409, "Not ready for review", readiness.checks.filter((c) => c.status === Check.Blocker).map((c) => `${c.label}: ${c.detail}`).join(" "));
  }
  if (!(await wealth.submitReport(id, user.userId))) throw new StudioError(409, "Not a draft", "Only a draft can be submitted.");
  await audit(user, "client-report.submitted", "ClientReport", id, `Submitted for compliance review (${readiness.status}).`, { runId, readiness: readiness.status });
  return reports.getReportFor(id, user);
});
for (const approve of [true, false])
  route("POST", `client-reports/:id/${approve ? "approve" : "return"}`, [A], async ({ params, body, user }) => {
    const id = int(params.id);
    const r = await reports.getReportFor(id, user);
    if (r.status !== ReportStatus.InReview) throw new StudioError(409, "Not in review", "Only a report in review can be approved or returned.");
    if (r.createdBy === user.userId || r.submittedBy === user.userId)
      throw new StudioError(403, "Segregation of duties", "You cannot review a report you created or submitted.");
    const comment = trimComment((await body(z.object({ comment: z.string().nullish() }))).comment);
    if (!approve && !comment) throw new StudioError(400, "Comment required", "Say what the wealth manager needs to change.");
    if (approve) {
      // Data can change while a report waits for review: check again before it reaches the client.
      const { readiness } = await runRelease(r, r.definition, user.userId);
      if (readiness.status === Readiness.Blocked)
        throw new StudioError(409, "Blocked since submission", "The release checks now find blockers: " + readiness.checks.filter((c) => c.status === Check.Blocker).map((c) => c.detail).join(" "));
    }
    if (!(await wealth.decideReport(id, user.userId, approve, comment))) throw new StudioError(409, "Not in review", "The report is no longer in review.");
    await audit(user, approve ? "client-report.published" : "client-report.returned", "ClientReport", id,
      approve ? "Approved and published to the client." : "Returned to the wealth manager.", { comment });
    return reports.getReportFor(id, user);
  });
route("POST", "client-reports/:id/ask", [W], async ({ params, body, user }) => {
  const b = await body(z.object({ instruction: z.string(), page: z.unknown() }));
  if (!b.instruction.trim() || b.instruction.length > 2000) throw new StudioError(400, "Ask the studio", "Describe the change you want (up to 2,000 characters).");
  const r = await reports.editable(int(params.id), user);
  const page = normaliseDefinition({ pages: [b.page] }).pages[0];
  if (r.lockedPageIds.includes(page.id)) throw new StudioError(409, "Locked page", "This page is required by compliance and cannot be changed.");
  try {
    const response = await revisePage(r, page, b.instruction, user.userId);
    await audit(user, "client-report.ask-studio", "ClientReport", r.clientReportId, `Asked the studio to change "${page.title}" (not saved yet).`,
      { instruction: b.instruction, summary: response.summary });
    return response;
  } catch (e) {
    if (e instanceof InvalidBlockError) throw new StudioError(422, "The studio could not do that", e.message);
    if (e instanceof StudioError) throw e;
    if ((e as { code?: string }).code?.startsWith("E")) throw e;   // database errors keep their own handling
    throw new StudioError(502, "AI service error", (e as Error).message);
  }
});

// ---------- orchestration trace and audit ----------

route("GET", "client-reports/:id/runs", [W, A], async ({ params, user }) => {
  const r = await reports.getReportFor(int(params.id), user);
  return listRuns(r.clientReportId);
});
route("GET", "orchestration-runs/:runId", [W, A, O], async ({ params, user }) => {
  const run = await getRun(int(params.runId));
  if (!run) throw new StudioError(404, "Not found", `Run ${params.runId} does not exist.`);
  if (user.role !== O) await reports.getReportFor(run.clientReportId, user);
  return run;
});
route("GET", "client-reports/:id/trail", [W, A], async ({ params, user }) => {
  const r = await reports.getReportFor(int(params.id), user);
  return { audit: await listAudit("ClientReport", String(r.clientReportId), 200), ai: await aiForReport(r.clientReportId), runs: await listRuns(r.clientReportId) };
});

// ---------- governance ----------

route("GET", "governance/data-quality", STAFF, async ({ query }) => ({
  rules: await gov.getRules(), exceptions: await gov.getExceptions(query.get("includeResolved") === "true"),
}));
route("POST", "governance/data-quality/run", [O], async ({ user }) => {
  const r = (await gov.runChecks(user.userId))!;
  await audit(user, "data-quality.run", "DataQuality", null,
    `Ran the data-quality checks: ${r.newExceptions} new, ${r.reopened} reopened, ${r.cleared} cleared, ${r.openOrAcknowledged} outstanding.`);
  return r;
});
route("PUT", "governance/data-quality/:id", [O], async ({ params, body, user }) => {
  const b = await body(z.object({ status: z.string(), note: z.string().nullish() }));
  if (!EXCEPTION_STATUSES.includes(b.status)) throw new StudioError(400, "Unknown status", `Status must be one of ${EXCEPTION_STATUSES.join(", ")}.`);
  const note = b.note?.trim() || null;
  if (b.status !== "Open" && !note) throw new StudioError(400, "Note required", "Explain why the exception is acknowledged or how it was resolved.");
  const row = await gov.updateException(int(params.id), b.status, note?.slice(0, 1000) ?? null, user.userId);
  if (!row) throw new StudioError(404, "Not found", `Exception ${params.id} does not exist.`);
  await audit(user, "data-quality.updated", "DataQualityException", row.exceptionId, `${row.ruleName}: marked ${b.status}.`, { note, detail: row.detail });
  return row;
});
route("GET", "governance/audit", [A, O], ({ query }) =>
  listAudit(query.get("entityType") || null, query.get("entityId") || null, Number(query.get("take") ?? 200)));
route("GET", "governance/ai", [A, O], ({ query }) => aiSummary(Number(query.get("take") ?? 50)));
route("GET", "governance/ai/:id", [A, O], async ({ params }) => {
  const row = await aiInteraction(int(params.id));
  if (!row) throw new StudioError(404, "Not found", `AI interaction ${params.id} does not exist.`);
  return row;
});
route("GET", "governance/methodology", STAFF, async () => ({
  measures: gov.methodology(await getCatalog()), lineage: await gov.getLineage(), disclosures: await getDisclosures(),
  ai: { provider: languageModel().provider, model: languageModel().model, enabled: aiEnabled() },
}));

// ---------- V7: agent reports (lead agent + performance and reporting specialists) ----------

async function agentReportFor(id: number, user: AppUser) {
  const r = await agents.getAgentReport(id);
  if (!r || !canSeeHousehold(user, r.householdId)) throw new StudioError(404, "Not found", `Agent report ${id} does not exist.`);
  return r;
}
const parse = (json: string | null) => (json ? JSON.parse(json) : null);
/** Agent reports are reviewed under this released template (07_agents.sql); it is hidden from the template lists. */
const AGENT_TEMPLATE = "Agent-built report", AGENT_TEMPLATE_CATEGORY = "Agent studio";
const completed = (r: agents.AgentReportRow) => {
  if (r.status !== agents.AgentStatus.Completed || !r.definitionJson) throw new StudioError(409, "Not finished", "Only a finished report can be changed.");
  return r;
};

const subjectBody = z.object({
  householdId: z.number().int(), clientId: z.number().int().nullish().transform((v) => v ?? null),
  portfolioCode: z.string().nullish().transform((v) => v || null),
  year: z.number().int().nullish(), periodKey: z.string(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
type SubjectBody = z.infer<typeof subjectBody>;

/** The subject and period for the signed-in user: a standard period (FY, H1, Q3 …) or custom dates within the data. */
async function resolveSubject(b: SubjectBody, user: AppUser) {
  if (!canSeeHousehold(user, b.householdId)) throw new StudioError(404, "Not found", `Household ${b.householdId} does not exist.`);
  const asOf = await wealth.getAsOfDate();
  const probe = await buildContext(b.householdId, b.clientId, b.portfolioCode, asOf);
  const dataStart = probe.accounts.length ? new Date(Math.min(...probe.accounts.map((a) => a.inceptionDate.getTime()))) : probe.dataStart;
  if (b.periodKey === "CUSTOM") {
    if (!b.from || !b.to) throw new StudioError(400, "Choose the dates", "A custom period needs a from and a to date.");
    const from = new Date(`${b.from}T00:00:00Z`), to = new Date(`${b.to}T00:00:00Z`);
    if (from > to) throw new StudioError(400, "Check the dates", "The from date must be before the to date.");
    if (from < dataStart || to > asOf) throw new StudioError(400, "Outside the data",
      `There are valuations from ${dataStart.toISOString().slice(0, 10)} to ${asOf.toISOString().slice(0, 10)} only.`);
    return { householdId: b.householdId, clientId: b.clientId, portfolioCode: b.portfolioCode, from, to, periodKey: "CUSTOM", periodYear: null };
  }
  if (b.year == null) throw new StudioError(400, "Choose the year", "A standard period needs a year.");
  const { from, to } = reports.resolvePeriod(b.year, b.periodKey, dataStart, asOf);
  return { householdId: b.householdId, clientId: b.clientId, portfolioCode: b.portfolioCode, from, to, periodKey: b.periodKey, periodYear: b.year };
}

route("GET", "agent-reports", [W], async ({ user }) => {
  const names = new Map((await wealth.getHouseholds(user.households)).map((h) => [h.householdId, h.name]));
  return Promise.all((await agents.listAgentReports(user.households)).map(async ({ coverJson, ...r }) => ({
    ...r, householdName: names.get(r.householdId) ?? "", review: r.clientReportId ? await reviewOf(r.clientReportId) : null,
    cover: coverJson ? normaliseCover(JSON.parse(coverJson)) : null,
  })));
});
route("POST", "agent-reports", [W], async ({ body, user }) => {
  const b = await body(subjectBody.extend({
    request: z.string().trim().min(10, "Describe the report you need (at least a sentence).").max(2000),
    startFromId: z.number().int().nullish().transform((v) => v ?? null),
  }));
  const subject = await resolveSubject(b, user);
  if (b.startFromId != null && !(await agents.getReusableDefinition(b.startFromId))) throw new StudioError(400, "Unknown definition", "That reusable definition does not exist.");
  const id = await agents.createAgentReport({ ...subject, request: b.request, startFromId: b.startFromId }, user.userId);
  await audit(user, "agent-report.requested", "AgentReport", id, `Asked the lead agent for a report: ${b.request.slice(0, 200)}`, { ...subject });
  await queueAgentReport(id);
  return { agentReportId: id };
});
route("GET", "agent-reports/:id", [W], async ({ params, user }) => {
  const r = await agentReportFor(int(params.id), user);
  const context = await buildContext(r.householdId, r.clientId, r.portfolioCode, r.toDate);
  const { findingsJson, definitionJson, factsJson, ...rest } = r;
  const facts: { source?: string }[] = parse(factsJson) ?? [];
  const start = r.startFromId ? await agents.getReusableDefinition(r.startFromId) : null;
  return {
    ...rest, householdName: context.householdName, subjectLabel: context.subjectLabel, clientName: context.clientName,
    relationshipManager: context.relationshipManager, segment: context.segment,
    findings: parse(findingsJson), definition: parse(definitionJson), factCount: facts.length,
    publishedFacts: facts.filter((f) => f.source === "published").length, startFromName: start?.name ?? null,
    review: r.clientReportId ? await reviewOf(r.clientReportId) : null,
    events: await agents.getAgentEvents(r.agentReportId), apiCalls: await agents.getApiCalls(r.agentReportId),
    versions: (await agents.listVersions(r.rootId ?? r.agentReportId)).map((v) => ({
      agentReportId: v.agentReportId, version: v.version, changeKind: v.changeKind, request: v.request, status: v.status, createdBy: v.createdBy, createdOn: v.createdOn,
    })),
  };
});
route("GET", "agent-reports/:id/figures", [W], async ({ params, user }) => {
  const r = await agentReportFor(int(params.id), user);
  return parse(r.factsJson) ?? [];
});
route("POST", "agent-reports/:id/run", [W], async ({ params, user }) => {
  const r = await agentReportFor(int(params.id), user);
  if (!r.definitionJson) throw new StudioError(409, "No report yet", "The reporting agent has not produced a report.");
  const definition = normaliseDefinition(JSON.parse(r.definitionJson));
  await fillDisclosures(definition);
  const api = await apiFor({ ...r, createdBy: user.userId });
  const results = await api.runReport(null, definition);
  return { definition, results, dataStatus: await api.dataStatus(null), period: await api.periodDescription() };
});
route("POST", "agent-reports/:id/changes", [W], async ({ params, body, user }) => {
  const r = completed(await agentReportFor(int(params.id), user));
  const b = await body(z.object({ request: z.string().trim().min(5, "Say what to change.").max(2000) }));
  const id = await agents.createAgentReport({ ...r, from: r.fromDate, to: r.toDate, request: b.request, parent: r, changeKind: agents.ChangeKinds.Agents }, user.userId);
  await audit(user, "agent-report.change-requested", "AgentReport", id, `Asked the agents to change version ${r.version}: ${b.request.slice(0, 200)}`, { parentId: r.agentReportId });
  await queueAgentReport(id);
  return { agentReportId: id };
});
route("PUT", "agent-reports/:id/edit", [W], async ({ params, body, user }) => {
  const r = completed(await agentReportFor(int(params.id), user));
  const b = await body(z.object({ definition: z.unknown(), note: z.string().trim().max(500).nullish() }));
  const api = await apiFor({ ...r, createdBy: user.userId }, parse(r.factsJson) ?? []);
  const { definition, problems } = await api.checkReport(null, b.definition, TextOrigins.WealthManager);
  if (problems.length) throw new StudioError(400, "The changes cannot be saved", problems.join("\n"));
  const note = b.note || "Edited by hand";
  const id = await agents.createAgentReport({
    ...r, from: r.fromDate, to: r.toDate, request: note, parent: r, changeKind: agents.ChangeKinds.Manual,
    done: { title: r.title ?? "Report", summary: `${user.name} edited version ${r.version}: ${note}`, definition, facts: api.facts },
  }, user.userId);
  await audit(user, "agent-report.edited", "AgentReport", id, `Edited version ${r.version} by hand: ${note}`, { parentId: r.agentReportId });
  await agents.addAgentEvent(id, { agent: "Wealth manager", kind: "edit", title: `${user.name} edited version ${r.version}: ${note}`, detail: { pages: definition.pages.map((p) => p.title) } });
  return { agentReportId: id };
});
route("POST", "agent-reports/:id/preview", [W], async ({ params, body, user }) => {
  const r = await agentReportFor(int(params.id), user);
  const b = await body(z.object({ definition: z.unknown(), pageIds: z.array(z.string()).nullish() }));
  const definition = normaliseDefinition(b.definition);
  if (b.pageIds) definition.pages = definition.pages.filter((p) => b.pageIds!.includes(p.id));
  return (await apiFor({ ...r, createdBy: user.userId })).runReport(null, definition);
});
route("POST", "agent-reports/:id/ask", [W], async ({ params, body, user }) => {
  const r = completed(await agentReportFor(int(params.id), user));
  const b = await body(z.object({ instruction: z.string(), page: z.unknown() }));
  if (!b.instruction.trim() || b.instruction.length > 2000) throw new StudioError(400, "Ask the studio", "Describe the change you want (up to 2,000 characters).");
  const page = normaliseDefinition({ pages: [b.page] }).pages[0];
  const context = await buildContext(r.householdId, r.clientId, r.portfolioCode, r.toDate);
  const findings = parse(r.findingsJson);
  // The page assistant works on a client report; an agent report gives it the same facts: its verified figures and findings.
  const report = {
    clientReportId: null, templateName: r.title ?? "Report", clientName: context.clientName, householdName: context.householdName,
    subjectLabel: context.subjectLabel, periodLabel: r.periodKey === "CUSTOM" ? "Custom period" : `${r.periodKey} ${r.periodYear}`,
    householdId: r.householdId, clientId: r.clientId, portfolioCode: r.portfolioCode, fromDate: r.fromDate, toDate: r.toDate,
    definition: normaliseDefinition(JSON.parse(r.definitionJson!)),
    insights: {
      facts: parse(r.factsJson) ?? [], comparisonLabel: "",
      insights: (findings?.findings ?? []).map((f: { headline: string; detail: string; significance: string }, i: number) =>
        ({ code: `F${i + 1}`, severity: f.significance, title: f.headline, detail: f.detail })),
    },
  } as unknown as ClientReportDetail;
  try {
    return await revisePage(report, page, b.instruction, user.userId);
  } catch (e) {
    if (e instanceof InvalidBlockError) throw new StudioError(422, "The studio could not do that", e.message);
    if (e instanceof StudioError) throw e;
    if ((e as { code?: string }).code?.startsWith("E")) throw e;
    throw new StudioError(502, "AI service error", (e as Error).message);
  }
});
route("POST", "agent-reports/:id/reusable", [W], async ({ params, body, user }) => {
  const r = completed(await agentReportFor(int(params.id), user));
  const b = await body(z.object({ name: z.string().trim().min(3).max(120), description: z.string().trim().min(5).max(1000) }));
  const definitionId = await agents.saveReusableDefinition({ ...b, definition: JSON.parse(r.definitionJson!), sourceReportId: r.agentReportId }, user.userId);
  await audit(user, "agent-report.saved-reusable", "ReusableDefinition", definitionId, `Saved '${b.name}' from agent report ${r.agentReportId} as a reusable definition.`);
  return { definitionId };
});
const reviewOf = async (clientReportId: number) => {
  const c = await wealth.getReport(clientReportId);
  return c && { clientReportId, status: c.status, reviewedBy: c.reviewedBy, reviewComment: c.reviewComment, publishedOn: c.publishedOn };
};

/**
 * Sends a finished agent report to compliance: it becomes a V4 client report under the "Agent-built report" template, with the
 * agents' verified figures and findings, and goes through the same release checks, review, approval and publishing.
 */
route("POST", "agent-reports/:id/submit", [W], async ({ params, user }) => {
  const r = completed(await agentReportFor(int(params.id), user));
  let id = r.clientReportId;
  if (!id) {
    const template = (await tpl.getPublished()).find((p) => p.report.name === AGENT_TEMPLATE);
    if (!template) throw new StudioError(500, "No review template", `The released '${AGENT_TEMPLATE}' template is missing (run database/07_agents.sql).`);
    const definition = normaliseDefinition(JSON.parse(r.definitionJson!));
    id = await wealth.createReport({
      reportId: template.report.reportId, householdId: r.householdId, clientId: r.clientId, portfolioCode: r.portfolioCode,
      year: r.periodYear ?? r.toDate.getUTCFullYear(), periodKey: r.periodKey, outputFormat: "full_pdf",
    }, r.fromDate, r.toDate, template.version.versionNo, definition, user.userId);
    const findings = parse(r.findingsJson);
    await wealth.saveStepOutput(id, "ContextJson", await buildContext(r.householdId, r.clientId, r.portfolioCode, r.toDate));
    await wealth.saveStepOutput(id, "InsightsJson", {
      facts: parse(r.factsJson) ?? [], comparisonLabel: "",
      insights: (findings?.findings ?? []).map((f: { headline: string; detail: string; significance: string }, i: number) =>
        ({ code: `F${i + 1}`, severity: f.significance, title: f.headline, detail: f.detail })),
    });
    await agents.linkClientReport(r.agentReportId, id);
    await audit(user, "agent-report.sent-to-review", "AgentReport", r.agentReportId, `Version ${r.version} became client report ${id} for compliance review.`, { clientReportId: id });
  }
  const c = await reports.getReportFor(id, user);
  if (c.status !== ReportStatus.Draft) throw new StudioError(409, "Already sent", "This report is already with compliance or published.");
  const { runId, readiness } = await runRelease(c, c.definition, user.userId);
  if (readiness.status === Readiness.Blocked) {
    await audit(user, "client-report.submit-blocked", "ClientReport", id, "Submission refused: the release checks found blockers.", { runId });
    throw new StudioError(409, "Not ready for review", readiness.checks.filter((x) => x.status === Check.Blocker).map((x) => `${x.label}: ${x.detail}`).join(" ")
      + ` Fix it in the review draft (client report ${id}), then submit it from there.`);
  }
  if (!(await wealth.submitReport(id, user.userId))) throw new StudioError(409, "Not a draft", "Only a draft can be submitted.");
  await audit(user, "client-report.submitted", "ClientReport", id, `Submitted for compliance review (${readiness.status}); built by the agents (agent report ${r.agentReportId}).`, { runId, readiness: readiness.status });
  return { clientReportId: id, readiness: readiness.status };
});
route("GET", "reusable-definitions", [W], async () => (await agents.listReusableDefinitions()).map(({ definitionJson, ...d }) => ({
  ...d, pages: (JSON.parse(definitionJson) as { pages: { title: string }[] }).pages.map((p) => p.title),
})));
route("GET", "knowledge", [W, O], async () => ({
  sections: await Promise.all(KNOWLEDGE_SECTIONS.map(async (key) => ({ key, text: await readKnowledge(key) }))),
  publishRun: await lastPublishRun(),
}));

// ---------- V7: covers ----------

route("GET", "cover-templates", STAFF, async ({ user }) => {
  const list = await covers.listCoverTemplates();
  // Wealth managers pick from approved covers; designers and compliance also see drafts and covers waiting for approval.
  return { segments: covers.SEGMENTS, templates: user.role === W || user.role === O ? list.filter((t) => t.approved).map((t) => ({ ...t, working: null })) : list };
});
const coverBody = z.object({ name: z.string().trim().min(3).max(80), segment: z.enum(covers.SEGMENTS as [string, ...string[]]),
  description: z.string().trim().min(5).max(400), settings: z.unknown() });
route("POST", "cover-templates", [D], async ({ body, user }) => {
  const id = await covers.saveCoverDraft(null, await body(coverBody), user.userId);
  await audit(user, "cover-template.created", "CoverTemplate", id, "Created a cover template (draft).");
  return { coverTemplateId: id };
});
route("PUT", "cover-templates/:id", [D], async ({ params, body, user }) => {
  const id = await covers.saveCoverDraft(int(params.id), await body(coverBody), user.userId);
  await audit(user, "cover-template.saved", "CoverTemplate", id, "Saved a draft of the cover template.");
  return { coverTemplateId: id };
});
route("POST", "cover-templates/:id/submit", [D], async ({ params, user }) => {
  await covers.submitCover(int(params.id), user.userId);
  await audit(user, "cover-template.submitted", "CoverTemplate", int(params.id), "Submitted the cover template for compliance approval.");
  return { ok: true };
});
for (const approve of [true, false])
  route("POST", `cover-templates/:id/${approve ? "approve" : "return"}`, [A], async ({ params, body, user }) => {
    const comment = trimComment((await body(z.object({ comment: z.string().nullish() }))).comment);
    if (!approve && !comment) throw new StudioError(400, "Comment required", "Say what the designer needs to change.");
    await covers.decideCover(int(params.id), approve, comment, user.userId);
    await audit(user, approve ? "cover-template.approved" : "cover-template.returned", "CoverTemplate", int(params.id),
      approve ? "Approved the cover template; wealth managers and agents can use it." : "Returned the cover template to the designer.", { comment });
    return { ok: true };
  });

// ---------- V10: the cover options (what the Cover tab offers and what the cover agent may change), configured in the platform ----------

route("GET", "cover-options", [D, A, W, O, C], async ({ user }) => {
  // Everyone draws covers with the approved options; the reporting admin and compliance also see the version being worked on.
  if (user.role !== D && user.role !== A) return { approved: await coverOptions.approvedOptions(), working: null };
  const { approved, working } = await coverOptions.optionVersions();
  return { approved: approved?.set ?? await coverOptions.approvedOptions(), approvedVersion: approved && { ...approved, set: undefined }, working };
});
route("PUT", "cover-options", [D], async ({ body, user }) => {
  const version = await coverOptions.saveOptionsDraft(await body(z.unknown()), user.userId);
  await audit(user, "cover-options.saved", "CoverOptionSet", version, `Saved a draft of the cover options (v${version}).`);
  return { version };
});
route("DELETE", "cover-options/draft", [D], async ({ user }) => {
  await coverOptions.discardOptionsDraft();
  await audit(user, "cover-options.discarded", "CoverOptionSet", null, "Discarded the draft of the cover options.");
  return { ok: true };
});
route("POST", "cover-options/submit", [D], async ({ user }) => {
  await coverOptions.submitOptions(user.userId);
  await audit(user, "cover-options.submitted", "CoverOptionSet", null, "Submitted the cover options for compliance approval.");
  return { ok: true };
});
for (const approve of [true, false])
  route("POST", `cover-options/${approve ? "approve" : "return"}`, [A], async ({ body, user }) => {
    const comment = trimComment((await body(z.object({ comment: z.string().nullish() }))).comment);
    if (!approve && !comment) throw new StudioError(400, "Comment required", "Say what the reporting admin needs to change.");
    const version = await coverOptions.decideOptions(approve, comment, user.userId);
    await audit(user, approve ? "cover-options.approved" : "cover-options.returned", "CoverOptionSet", version,
      approve ? `Approved the cover options v${version}; the Cover tab and the cover agent use them now.` : `Returned the cover options v${version} to the reporting admin.`, { comment });
    return { ok: true };
  });

// ---------- V9: the cover agent (plans when the Cover tab opens; decides what goes with a choice the plan does not cover) ----------

async function coverReport(kind: string, id: number, user: AppUser): Promise<coverAgent.CoverReport> {
  let r: { title: string; householdId: number; clientId: number | null; portfolioCode: string | null; toDate: Date; period: string; summary: string; facts: Fact[]; clientReportId: number | null };
  if (kind === "agent-reports") {
    const a = completed(await agentReportFor(id, user));
    r = { ...a, title: a.title ?? "Report", period: `${isoDate(a.fromDate)} to ${isoDate(a.toDate)}`, summary: parse(a.findingsJson)?.summary ?? a.summary ?? "",
      facts: parse(a.factsJson) ?? [], clientReportId: a.clientReportId };
  } else {
    const c = await reports.editable(id, user);
    r = { ...c, title: c.templateName, period: c.periodLabel, summary: c.insights?.insights.map((i) => i.title).join("; ") ?? "", facts: c.insights?.facts ?? [], clientReportId: c.clientReportId };
  }
  return {
    kind: kind === "agent-reports" ? "agent" : "client", id, title: r.title, period: r.period, summary: r.summary, facts: r.facts, clientReportId: r.clientReportId,
    context: await buildContext(r.householdId, r.clientId, r.portfolioCode, r.toDate), preferences: await coverAgent.getHouseholdPreference(r.householdId),
  };
}
const coverAgentError = (e: unknown): never => {
  if (e instanceof StudioError) throw e;
  throw new StudioError(502, "Cover agent error", (e as Error).message);
};
const measurements = z.record(z.string(), z.unknown()).nullish();
const coverRunBody = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("plan"), cover: z.unknown(), measurements, templateMeasurements: z.record(z.string().max(10), z.record(z.string(), z.unknown())).nullish() }),
  z.object({
    mode: z.literal("decide"), cover: z.unknown(), previous: z.unknown().nullish(), measurements,
    changedKeys: z.array(z.string().max(40)).min(1).max(40), userKeys: z.array(z.string().max(40)).max(40).default([]),
    planned: z.array(z.object({ key: z.string().max(40), value: z.union([z.string().max(80), z.number(), z.boolean()]), reason: z.string().max(300) })).max(30).default([]),
  }),
]);
for (const kind of ["agent-reports", "client-reports"]) {
  route("GET", `${kind}/:id/cover-agent`, [W], async ({ params, user }) => {
    const r = await coverReport(kind, int(params.id), user);
    return { plan: await coverAgent.latestPlan(r.kind, r.id), totals: await coverAgent.runTotals(r.kind, r.id), preferences: r.preferences };
  });
  route("POST", `${kind}/:id/cover-agent`, [W], async ({ params, body, user }) => {
    const b = await body(coverRunBody);
    const r = await coverReport(kind, int(params.id), user);
    const cover = normaliseCover(b.cover ?? {});
    if (!cover) throw new StudioError(400, "No cover", "This report has no designed cover yet.");
    const templates = await covers.approvedCovers();
    const options = await coverOptions.approvedOptions();
    if (b.mode === "plan") return coverAgent.planCover(user, r, { cover, measurements: b.measurements ?? null, templateMeasurements: b.templateMeasurements ?? null }, templates, options).catch(coverAgentError);
    return coverAgent.decideCover(user, r, {
      cover, previous: normaliseCover(b.previous ?? null), changedKeys: b.changedKeys, userKeys: b.userKeys, measurements: b.measurements ?? null, planned: b.planned,
    }, templates, options).catch(coverAgentError);
  });
  // The agent's changes are applied straight away; this records them (and any undo) in the audit trail.
  route("POST", `${kind}/:id/cover-agent/:runId/decision`, [W], async ({ params, body, user }) => {
    const b = await body(z.object({
      applied: z.array(z.object({ key: z.string(), value: z.unknown() })).max(40).default([]), undone: z.array(z.string()).max(40).default([]),
      after: z.string().max(80).nullish(),
    }));
    const id = int(params.id);
    const run = await coverAgent.getCoverRun(int(params.runId), kind === "agent-reports" ? "agent" : "client", id);
    const what = b.undone.length ? `undid ${b.undone.join(", ")}` : `applied ${b.applied.map((a) => a.key).join(", ") || "nothing"}`;
    await audit(user, b.undone.length ? "cover-agent.undone" : "cover-agent.applied", kind === "agent-reports" ? "AgentReport" : "ClientReport", id,
      `Cover agent (${run.mode === "plan" ? "planned" : "decided"}${b.after ? ` with ${b.after}` : ""}): ${what}.`,
      { runId: run.runId, applied: b.applied, undone: b.undone, after: b.after });
    if (b.applied.length && b.after !== "recommendations") await coverAgent.supersedeRecommendations(run.reportKind as string, id, b.applied.map((a) => a.key));
    return { ok: true };
  });
}

// ---------- V7: the Reporting API, called directly by the signed-in user ----------

route("POST", "reporting/published", [W], async ({ body, user }) => {
  const b = await body(subjectBody.extend({ set: z.string() }));
  return new ReportingApi(user, await resolveSubject(b, user)).publishedFigures(null, b.set);
});
route("POST", "reporting/calculate", [W], async ({ body, user }) => {
  const b = await body(subjectBody.extend({
    title: z.string().default("Figures"), measures: z.array(z.string()).min(1), groupBy: z.array(z.string()).optional(),
    period: z.string().optional(), compare: z.string().optional(), topN: z.number().int().nullish(),
  }));
  return new ReportingApi(user, await resolveSubject(b, user)).calculate(null, b);
});

// ---------- V7: period close (infrastructure) publishes the standard figure sets ----------

route("POST", "publish", [O], async ({ user }) => {
  const run = await publishAll((m) => console.log(m));
  await audit(user, "figures.published", "PublishRun", run.publishRunId, `Period close: published ${run.results} results for data as of ${run.asOfDate}.`);
  return run;
});
