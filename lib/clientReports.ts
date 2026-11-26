import { audit } from "./audit";
import { bindReport } from "./bind";
import { runAll } from "./blockRunner";
import { isoDate } from "./db";
import { checkDefinition } from "./definitionRules";
import { StudioError } from "./errors";
import {
  BlockTypes, PERIOD_KEYS, ReportStatus, Roles, RunStatus, Scopes, TextOrigins, allBlocks, clone, isAiOrigin,
  type AppUser, type BlockResult, type ClientContext, type ClientReportDetail, type ClientReportSummary, type Page, type ReportDefinition,
} from "./models";
import { buildContext } from "./orchestration/clientContext";
import { startDraft } from "./orchestration/orchestrator";
import { ymd } from "./periods";
import { fillDisclosures } from "./repos/content";
import { getPublished, getVersion } from "./repos/reports";
import * as wealth from "./repos/wealth";
import { canSeeHousehold } from "./users";

/**
 * The wealth manager's report for a household, entity or account: created from a released template version (which
 * never changes), prepared by the orchestrator, edited page by page, submitted for review and published by compliance.
 * Locked pages always come back from the template, conditional pages and disclosures follow the client context, and
 * disclosure wording always comes from the library. Entitlements: wealth managers see their households; clients only
 * their household's published reports.
 */

// ---------- periods ----------

/** Dates for a year and period key, clipped: never past the as-of date; "since inception" starts at the first valuation. */
export function resolvePeriod(year: number, key: string, dataStart: Date, asOf: Date): { from: Date; to: Date } {
  const ranges: Record<string, [Date, Date]> = {
    FY: [ymd(year, 1, 1), ymd(year, 12, 31)], H1: [ymd(year, 1, 1), ymd(year, 6, 30)], H2: [ymd(year, 7, 1), ymd(year, 12, 31)],
    Q1: [ymd(year, 1, 1), ymd(year, 3, 31)], Q2: [ymd(year, 4, 1), ymd(year, 6, 30)], Q3: [ymd(year, 7, 1), ymd(year, 9, 30)],
    Q4: [ymd(year, 10, 1), ymd(year, 12, 31)], SI: [dataStart, ymd(year, 12, 31)],
  };
  if (!ranges[key]) throw new StudioError(400, "Unknown period", `Period must be one of ${PERIOD_KEYS.join(", ")}.`);
  let [from, to] = ranges[key];
  if (to > asOf) to = asOf;
  if (from < dataStart) from = dataStart;
  if (from > to) throw new StudioError(400, "No data for this period",
    `There are valuations from ${short(dataStart)} to ${short(asOf)} only; choose a period in that range.`);
  return { from, to };
}
const short = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function periodLabel(key: string, year: number, to: Date): string {
  if (key === "CUSTOM") return `Custom period to ${short(to)}`;
  const full = key === "FY" ? `FY ${year}` : key === "SI" ? "Since inception" : `${key} ${year}`;
  const nominalEnd = key === "H1" || key === "Q2" ? ymd(year, 6, 30) : key === "Q1" ? ymd(year, 3, 31) : key === "Q3" ? ymd(year, 9, 30) : ymd(year, 12, 31);
  return to < nominalEnd ? `${full} to ${short(to)}` : full;
}
export const describeReport = (r: ClientReportSummary) => { r.periodLabel = periodLabel(r.periodKey, r.periodYear, r.toDate); };

// ---------- read ----------

export async function listReports(user: AppUser) {
  const list = user.role === Roles.Advisor ? await wealth.getReports(user.households, null)
    : user.role === Roles.Client ? await wealth.getReports([user.householdId!], [ReportStatus.Published])
    : user.role === Roles.Approver ? await wealth.getReports(null, [ReportStatus.InReview, ReportStatus.Published])
    : await wealth.getReports(null, null);
  list.forEach(describeReport);
  return list;
}

/** The report if this user may see it, else 404 (other households' reports are not even revealed). */
export async function getReportFor(id: number, user: AppUser): Promise<ClientReportDetail> {
  const d = await wealth.getReport(id);
  if (!d || !canSeeHousehold(user, d.householdId)
    || (user.role === Roles.Client && d.status !== ReportStatus.Published)
    || (user.role === Roles.Approver && d.status === ReportStatus.Draft && !d.submittedOn))
    throw new StudioError(404, "Not found", `Client report ${id} does not exist.`);
  describeReport(d);
  d.lockedPageIds = (await template(d)).pages.filter((p) => p.locked).map((p) => p.id);
  await fillDisclosures(d.definition);
  return d;
}

// ---------- create ----------

export interface CreateRequest {
  reportId: number; householdId: number; clientId: number | null; portfolioCode: string | null;
  year: number; periodKey: string; outputFormat: string; pages: { id: string; included: boolean }[];
}

export async function createReport(req: CreateRequest, user: AppUser): Promise<ClientReportDetail> {
  if (!canSeeHousehold(user, req.householdId)) throw new StudioError(403, "Not your client", "You are not entitled to this household.");
  if (req.outputFormat !== "full_pdf") throw new StudioError(400, "Format not available", "Only the Full PDF output is available in this version.");
  const published = (await getPublished()).find((p) => p.report.reportId === req.reportId);
  if (!published) throw new StudioError(409, "Template not released", "This template has no approved (released) version yet.");
  if (published.version.definition.scope !== Scopes.Client) throw new StudioError(400, "Not a client template", "This template reports on the whole firm, not on a client.");
  if (!req.portfolioCode) req.portfolioCode = null;

  const asOf = await wealth.getAsOfDate();
  const probe = await buildContext(req.householdId, req.clientId, req.portfolioCode, asOf);
  const dataStart = probe.accounts.length ? new Date(Math.min(...probe.accounts.map((a) => a.inceptionDate.getTime()))) : probe.dataStart;
  const { from, to } = resolvePeriod(req.year, req.periodKey, dataStart, asOf);
  const context = await buildContext(req.householdId, req.clientId, req.portfolioCode, to);
  if (!context.accounts.length) throw new StudioError(400, "No accounts in the period", "None of the chosen accounts existed by the end of this period.");

  const definition = clone(published.version.definition);
  const order = new Map(req.pages.map((p, i) => [p.id, i]));
  const included = new Map(req.pages.map((p) => [p.id, p.included]));
  definition.pages = definition.pages
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (order.get(a.p.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.p.id) ?? Number.MAX_SAFE_INTEGER) || a.i - b.i)
    .map(({ p }) => ({ ...p, included: p.locked || (included.get(p.id) ?? true) }));
  for (const b of allBlocks(definition).filter((b) => b.type === BlockTypes.Text)) b.origin = TextOrigins.Template;

  const stub = { reportId: req.reportId, versionNo: published.version.versionNo } as ClientReportSummary;
  const sanitized = await sanitize(stub, definition, context);
  if (!sanitized.pages.some((p) => p.included && !p.locked)) throw new StudioError(400, "No pages", "Include at least one page besides the compliance pages.");

  const id = await wealth.createReport(req, from, to, published.version.versionNo, sanitized, user.userId);
  await wealth.saveStepOutput(id, "ContextJson", context);
  await audit(user, "client-report.created", "ClientReport", id,
    `Created ${published.report.name} v${published.version.versionNo} for ${context.subjectLabel}, ${periodLabel(req.periodKey, req.year, to)}.`);
  await startDraft(id, user.userId);
  return getReportFor(id, user);
}

// ---------- edit ----------

export async function saveReport(id: number, edited: ReportDefinition, user: AppUser) {
  const detail = await editable(id, user);
  const definition = await sanitize(detail, edited, null);
  await wealth.saveDefinition(id, definition, user.userId);
  await audit(user, "client-report.saved", "ClientReport", id, "Saved the wealth manager's edits.", { aiText: allBlocks(definition).filter((b) => isAiOrigin(b.origin)).length });
  return getReportFor(id, user);
}

/** The report if this wealth manager may change it now (their household, still a draft, no run in progress). */
export async function editable(id: number, user: AppUser): Promise<ClientReportDetail> {
  if (user.role !== Roles.Advisor) throw new StudioError(403, "Forbidden", "Only the wealth manager can change a client report.");
  const d = await getReportFor(id, user);
  if (d.status !== ReportStatus.Draft)
    throw new StudioError(409, d.status === ReportStatus.InReview ? "In review" : "Published", d.status === ReportStatus.InReview
      ? "This report is with compliance for review; it can be changed again if they return it."
      : "This report is published and can no longer be changed.");
  if (d.latestRun?.status === RunStatus.Running) throw new StudioError(409, "Being prepared", "The orchestrator is still preparing this report; wait for it to finish.");
  return d;
}

const KNOWN_ORIGINS: (string | null | undefined)[] = Object.values(TextOrigins);

/**
 * Makes an edited definition safe to store or run: scope and preview from the template; locked pages restored from
 * the template (included, unedited, in place, with only the disclaimers whose condition is met); pages whose
 * condition is not met left out; disclosure wording from the library; structure checked.
 */
export async function sanitize(detail: ClientReportSummary, edited: ReportDefinition, context: ClientContext | null): Promise<ReportDefinition> {
  const t = await template(detail);
  const ctx = context ?? (detail as ClientReportDetail).context ?? await buildContext(detail.householdId, detail.clientId, detail.portfolioCode, detail.toDate);
  const d = clone(edited);
  d.scope = t.scope;
  d.preview = t.preview;
  const restore = (original: Page): Page => {
    const page = clone(original);
    page.included = true;
    page.blocks = page.blocks.filter((b) => !b.condition || ctx.conditions.includes(b.condition));
    page.blocks.filter((b) => b.type === BlockTypes.Text).forEach((b) => { b.origin = TextOrigins.Template; });
    return page;
  };
  const locked = new Map(t.pages.filter((p) => p.locked).map((p) => [p.id, p]));
  d.pages = d.pages.map((page) => {
    if (locked.has(page.id)) return restore(locked.get(page.id)!);
    page.locked = false;
    if (page.condition && !ctx.conditions.includes(page.condition)) page.included = false;
    page.blocks.filter((b) => b.type === BlockTypes.Text && !KNOWN_ORIGINS.includes(b.origin)).forEach((b) => { b.origin = TextOrigins.WealthManager; });
    return page;
  });
  t.pages.forEach((page, i) => {
    if (page.locked && !d.pages.some((p) => p.id === page.id)) d.pages.splice(Math.min(i, d.pages.length), 0, restore(page));
  });
  await fillDisclosures(d);
  const problems = checkDefinition(d, 180);
  if (problems.length) throw new StudioError(400, "Invalid report", problems.map(([, m]) => m).join(" "));
  if (!d.pages.some((p) => p.included)) throw new StudioError(400, "No pages", "Include at least one page.");
  return d;
}

// ---------- run ----------

export async function runReport(detail: ClientReportDetail, edited: ReportDefinition | null, pageIds: string[] | null): Promise<BlockResult[]> {
  const definition = edited ? await sanitize(detail, edited, detail.context) : detail.definition;
  const pages = definition.pages.filter((p) => p.included && (!pageIds?.length || pageIds.includes(p.id)));
  return runAll(definition, bindReport(detail), false, pages.flatMap((p) => p.blocks));
}

export async function template(r: ClientReportSummary): Promise<ReportDefinition> {
  const v = await getVersion(r.reportId, r.versionNo);
  if (!v) throw new StudioError(404, "Template missing", "The template version this report was made from no longer exists.");
  return v.definition;
}

export { isoDate };
