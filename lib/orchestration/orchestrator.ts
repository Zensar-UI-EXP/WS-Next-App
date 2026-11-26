import Anthropic from "@anthropic-ai/sdk";
import { AiOutputError, AiUnavailableError } from "../ai/languageModel";
import { audit } from "../audit";
import { bindReport } from "../bind";
import { runAll } from "../blockRunner";
import { describeReport, sanitize } from "../clientReports";
import { InvalidBlockError } from "../errors";
import { allBlocks, clone, Readiness, RunKinds, RunStatus, StepStatus, Check, type ClientReportDetail, type DataReadiness, type ReleaseReadiness, type ReportDefinition } from "../models";
import { failInterrupted, finishRun, startRun, stepFinished, stepStarted } from "../repos/orchestration";
import { getReport, saveDefinition, saveStepOutput } from "../repos/wealth";
import { findUser } from "../users";
import { buildContext } from "./clientContext";
import { compose } from "./composition";
import { checkDataReadiness } from "./dataReadiness";
import { factsFromResults } from "./facts";
import { draftNarrative, narrativeSlots } from "./narrative";
import { analyse } from "./performanceInsight";
import { checkRelease } from "./releaseReadiness";

/**
 * Report orchestrator: deterministic process control. "Workflows orchestrate. Engines calculate. AI drafts and
 * explains. People approve." A Draft run prepares a new client report in the background, step by step, recording
 * every step's status, summary and output:
 *   1 Client Context → 2 Data Readiness → 3 Performance & Insight → 4 Narrative (AI) → 5 Composition (AI) → 6 Release Readiness.
 * A Release run (steps 2 and 6) runs synchronously when a report is submitted, and again on approval.
 */
export const DRAFT_STEPS = [
  ["client_context", "Client Context Service", "Service"],
  ["data_readiness", "Data Readiness Service", "Service"],
  ["performance_insight", "Performance & Insight Agent", "Service"],
  ["narrative", "Narrative Agent", "Agent"],
  ["composition", "Report Composition Agent", "Agent"],
  ["release_readiness", "Release Readiness Service", "Service"],
] as const;
export const RELEASE_STEPS = [
  ["data_readiness", "Data Readiness Service", "Service"],
  ["release_readiness", "Release Readiness Service", "Service"],
] as const;

// One in-process queue: runs one at a time, survives Next.js hot reload (globalThis).
const g = globalThis as unknown as { __wisQueue?: { chain: Promise<void>; started: boolean } };
g.__wisQueue ??= { chain: Promise.resolve(), started: false };

/** Records a Draft run and queues it; returns the run id at once. */
export async function startDraft(clientReportId: number, userId: string): Promise<number> {
  const q = g.__wisQueue!;
  if (!q.started) {
    q.started = true;
    await failInterrupted().catch((e) => console.warn("Could not mark interrupted runs", e));
  }
  const runId = await startRun(clientReportId, RunKinds.Draft, userId, DRAFT_STEPS);
  q.chain = q.chain.then(() => runDraft(runId, clientReportId, userId).catch(async (e) => {
    console.error(`Orchestration run ${runId} for client report ${clientReportId} failed`, e);
    await finishRun(runId, RunStatus.Failed, `The run stopped: ${(e as Error).message}`).catch(() => {});
  }));
  return runId;
}

/** Failures of the model or of its answer: the step degrades to rules or template wording instead of failing the run. */
const isAiFailure = (e: unknown) =>
  e instanceof AiUnavailableError || e instanceof AiOutputError || e instanceof InvalidBlockError || e instanceof Anthropic.APIError;

async function runDraft(runId: number, reportId: number, userId: string) {
  const report = await getReport(reportId);
  if (!report) throw new Error(`Client report ${reportId} does not exist.`);
  describeReport(report);
  const user = await findUser(userId);
  if (!user) throw new Error(`Unknown user ${userId}.`);
  const from = report.fromDate, to = report.toDate;

  // 1. Client context
  await stepStarted(runId, 1);
  const context = await buildContext(report.householdId, report.clientId, report.portfolioCode, to);
  await saveStepOutput(reportId, "ContextJson", context);
  await stepFinished(runId, 1, StepStatus.Passed,
    `${context.subjectLabel}: ${context.entities.length} entit${context.entities.length === 1 ? "y" : "ies"}, ${context.accounts.length} account(s) in ${context.currencies.join(", ")}; `
    + `${context.mandates.join(" and ").toLowerCase()} mandate; ${context.hasStructuredProducts ? "holds structured products" : "no structured products"}.`,
    { subjectLevel: context.subjectLevel, subjectLabel: context.subjectLabel, clientName: context.clientName, currencies: context.currencies,
      mandates: context.mandates, riskProfiles: context.riskProfiles, conditions: context.conditions,
      accounts: context.accounts.map((a) => `${a.code} ${a.name} (${a.currency})`) });

  // 2. Data readiness
  await stepStarted(runId, 2);
  const data = await checkDataReadiness(context, report.clientId, report.portfolioCode, from, to);
  await stepFinished(runId, 2, stepFor(data.status), dataSummary(data), data);

  // 3. Performance & insight
  await stepStarted(runId, 3);
  const { insights } = await analyse(context, bindReport(report), from, to);
  await saveStepOutput(reportId, "InsightsJson", insights);
  const notable = insights.insights.filter((i) => i.severity !== "info");
  await stepFinished(runId, 3, StepStatus.Passed,
    `${insights.facts.length} governed figures; ${notable.length} material or notable movement(s)${notable.length ? ": " + notable.map((i) => i.title).join("; ") : ""}.`,
    insights.insights);

  // 4. Narrative (AI). Facts: the insights plus every figure on the pages being drafted.
  let definition: ReportDefinition = clone(report.definition);
  await stepStarted(runId, 4);
  try {
    const slotPages = [...new Set(narrativeSlots(definition).map((s) => s.page))];
    const pageResults = await runAll(definition, bindReport(report), false, slotPages.flatMap((p) => p.blocks));
    const facts = [...insights.facts, ...factsFromResults(pageResults, new Map(allBlocks(definition).map((b) => [b.id, b])))];
    const result = await draftNarrative(report, definition, context, facts, insights, userId);
    await stepFinished(runId, 4, StepStatus.Passed, result.summary, { drafted: result.drafted, blockIds: result.blockIds });
  } catch (e) {
    if (!isAiFailure(e)) throw e;
    await stepFinished(runId, 4, StepStatus.Warning, `Template wording kept: ${(e as Error).message}`, null);
  }

  // 5. Composition (rules, then AI)
  await stepStarted(runId, 5);
  try {
    const result = await compose(report, definition, context, insights, userId);
    await stepFinished(runId, 5, result.aiProblem ? StepStatus.Warning : StepStatus.Passed,
      result.aiProblem ? `${result.summary} ${result.aiProblem}` : result.summary, result.decisions);
  } catch (e) {
    if (!isAiFailure(e)) throw e;
    await stepFinished(runId, 5, StepStatus.Warning, `Only the composition rules were applied: ${(e as Error).message}`, null);
  }
  definition = await sanitize(report, definition, context);
  await saveDefinition(reportId, definition, userId);

  // 6. Release readiness (a first check; it runs again when the report is submitted)
  await stepStarted(runId, 6);
  const readiness = await checkRelease(report, definition, context, data, insights);
  await saveStepOutput(reportId, "ReadinessJson", readiness);
  await stepFinished(runId, 6, stepFor(readiness.status), releaseSummary(readiness), readiness);

  const status = readiness.status === Readiness.Blocked ? RunStatus.Blocked : RunStatus.Completed;
  const summary = status === RunStatus.Blocked ? "Draft prepared, but it cannot be released until the blockers are resolved."
    : readiness.status === Readiness.Warnings ? "Draft prepared with warnings for the wealth manager to review." : "Draft prepared and ready for review.";
  await finishRun(runId, status, summary);
  await audit(user, "orchestration.draft", "ClientReport", reportId, `Report prepared by the orchestrator (run ${runId}): ${summary}`, { runId, readiness: readiness.status });
}

/** Data readiness and release readiness, synchronously; records a Release run and stores the result. */
export async function runRelease(report: ClientReportDetail, definition: ReportDefinition, userId: string): Promise<{ runId: number; readiness: ReleaseReadiness }> {
  const runId = await startRun(report.clientReportId, RunKinds.Release, userId, RELEASE_STEPS);
  try {
    const context = report.context ?? await buildContext(report.householdId, report.clientId, report.portfolioCode, report.toDate);
    await stepStarted(runId, 1);
    const data = await checkDataReadiness(context, report.clientId, report.portfolioCode, report.fromDate, report.toDate);
    await stepFinished(runId, 1, stepFor(data.status), dataSummary(data), data);
    await stepStarted(runId, 2);
    const readiness = await checkRelease(report, definition, context, data, report.insights);
    await saveStepOutput(report.clientReportId, "ReadinessJson", readiness);
    await stepFinished(runId, 2, stepFor(readiness.status), releaseSummary(readiness), readiness);
    await finishRun(runId, readiness.status === Readiness.Blocked ? RunStatus.Blocked : RunStatus.Completed, releaseSummary(readiness));
    return { runId, readiness };
  } catch (e) {
    await finishRun(runId, RunStatus.Failed, (e as Error).message);
    throw e;
  }
}

const stepFor = (r: string) => (r === Readiness.Blocked ? StepStatus.Failed : r === Readiness.Warnings ? StepStatus.Warning : StepStatus.Passed);
const dataSummary = (d: DataReadiness) => (d.status === Readiness.Ready ? "Data complete, fresh and reconciled for the period."
  : d.checks.filter((c) => c.status !== Check.Passed).map((c) => `${c.status}: ${c.detail}`).join(" "));
function releaseSummary(r: ReleaseReadiness) {
  const open = r.checks.filter((c) => c.status === Check.Blocker || c.status === Check.Warning);
  return r.status === Readiness.Ready ? `All ${r.checks.length} release checks passed.`
    : r.status === Readiness.Blocked ? `Blocked: ${open.filter((c) => c.status === Check.Blocker).map((c) => c.label).join("; ")}.`
    : `Ready with warnings: ${open.map((c) => c.label).join("; ")}.`;
}
