import { normaliseDefinition } from "../models";
import { ReportingApi, type SourcedFact } from "../reporting/api";
import { findUser } from "../users";
import { LEAD, runLeadAgent } from "./agents";
import type { RunState } from "./state";
import { AgentStatus, addAgentEvent, failInterruptedAgentReports, finishAgentReport, getAgentReport, getReusableDefinition, saveAgentOutput, setAgentStatus, type AgentReportRow } from "./store";

// One in-process queue: one agent run at a time; survives Next.js hot reload (globalThis).
const g = globalThis as unknown as { __agentQueue?: { chain: Promise<void>; started: boolean } };
g.__agentQueue ??= { chain: Promise.resolve(), started: false };

/** Queues the lead agent for a new agent report or a change request. */
export async function queueAgentReport(reportId: number) {
  const q = g.__agentQueue!;
  if (!q.started) {
    q.started = true;
    await failInterruptedAgentReports().catch((e) => console.warn("Could not mark interrupted agent reports", e));
  }
  q.chain = q.chain.then(() => run(reportId));
}

/** The Reporting API for the user who asked for this version, carrying the verified figures it starts from. */
export async function apiFor(r: AgentReportRow, facts: SourcedFact[] = []) {
  const user = await findUser(r.createdBy);
  if (!user) throw new Error(`Unknown user ${r.createdBy}.`);
  return new ReportingApi(user, {
    householdId: r.householdId, clientId: r.clientId, portfolioCode: r.portfolioCode, from: r.fromDate, to: r.toDate,
    periodKey: r.periodKey, periodYear: r.periodYear,
  }, r.agentReportId, facts);
}

async function run(reportId: number) {
  const r = await getAgentReport(reportId);
  if (!r) return;
  let s: RunState | null = null;
  try {
    const parent = r.parentId ? await getAgentReport(r.parentId) : null;
    const start = r.startFromId ? await getReusableDefinition(r.startFromId) : null;
    s = {
      reportId, request: r.request,
      api: await apiFor(r, parent?.factsJson ? JSON.parse(parent.factsJson) : []),
      findings: r.findingsJson ? JSON.parse(r.findingsJson) : null, report: null, completed: null,
      previous: parent?.definitionJson ? { version: parent.version, title: parent.title ?? "Report", definition: normaliseDefinition(JSON.parse(parent.definitionJson)) } : null,
      startFrom: start ? { definitionId: start.definitionId, name: start.name, definition: normaliseDefinition(JSON.parse(start.definitionJson)) } : null,
    };
    await setAgentStatus(reportId, AgentStatus.Running);
    await runLeadAgent(s);
    await saveAgentOutput(reportId, "FactsJson", s.api.facts);
    await finishAgentReport(reportId, AgentStatus.Completed, s.report!.title, s.completed!.message);
  } catch (e) {
    const message = (e as Error).message;
    console.error(`Agent report ${reportId} failed`, e);
    if (s) await saveAgentOutput(reportId, "FactsJson", s.api.facts).catch(() => {});
    await addAgentEvent(reportId, { agent: LEAD, kind: "error", title: `The run stopped: ${message.slice(0, 300)}`, detail: message }).catch(() => {});
    await finishAgentReport(reportId, AgentStatus.Failed, s?.report?.title ?? null, `The agents could not finish: ${message}`).catch(() => {});
  }
}
