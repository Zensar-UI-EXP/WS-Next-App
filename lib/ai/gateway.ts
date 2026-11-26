import { config } from "../config";
import { execute, query, queryMany, queryOne } from "../db";
import { anthropicModel } from "./anthropic";
import { disabledModel, type JsonSchema, type LanguageModel } from "./languageModel";

/** Who is asking the model, and why: recorded with every call. */
export interface AiCall { agent: string; purpose: string; userId: string; clientReportId: number | null }
export interface AiAnswer { interactionId: number; json: any } // eslint-disable-line @typescript-eslint/no-explicit-any

const g = globalThis as unknown as { __wisModel?: LanguageModel };
/** The configured model (swappable: one implementation per provider). */
export function languageModel(): LanguageModel {
  if (!g.__wisModel) {
    if (config.ai.provider === "Anthropic") g.__wisModel = anthropicModel();
    else if (config.ai.provider === "Disabled") g.__wisModel = disabledModel;
    else throw new Error(`AI_PROVIDER '${config.ai.provider}' is not implemented. Implement LanguageModel for it in lib/ai.`);
  }
  return g.__wisModel;
}

export const aiEnabled = () => languageModel() !== disabledModel;

/**
 * The only way agents reach the model. Every call is written to gov.AiInteraction with the exact prompt and answer,
 * tokens and latency; the caller then records the outcome of its deterministic checks. Failures are logged as Error.
 */
export async function ask(call: AiCall, prompt: string, schema: JsonSchema): Promise<AiAnswer> {
  const model = languageModel();
  const started = Date.now();
  console.log("schema", schema);
  try {
    const reply = await model.generateJson(prompt, schema);
    const id = await insert(call, model, prompt, reply.raw, reply.inputTokens, reply.outputTokens, Date.now() - started, "Pending", null);
    console.info(`AI ${call.agent} (${call.purpose}) with ${model.model}: ${reply.inputTokens} in / ${reply.outputTokens} out tokens, replyJson ${reply.json}, reply ${reply.raw}, ${Date.now() - started} ms`);
    return { interactionId: id, json: reply.json };
  } catch (e) {
    await insert(call, model, prompt, null, null, null, Date.now() - started, "Error", (e as Error).message);
    throw e;
  }
}

/** Records the outcome of the caller's checks on an answer. */
export const recordOutcome = (interactionId: number, accepted: boolean, notes: string | null) => execute("app",
  "UPDATE gov.AiInteraction SET Outcome = @Outcome, Notes = @Notes WHERE InteractionId = @Id",
  { Id: interactionId, Outcome: accepted ? "Accepted" : "Rejected", Notes: notes?.slice(0, 2000) ?? null });

async function insert(call: AiCall, model: LanguageModel, prompt: string, response: string | null, inTok: number | null, outTok: number | null,
  latencyMs: number, outcome: string, notes: string | null): Promise<number> {
  const row = await queryOne<{ id: string | number }>("app", `
    INSERT gov.AiInteraction (UserId, Agent, Purpose, ClientReportId, Provider, Model, Prompt, Response, InputTokens, OutputTokens, LatencyMs, Outcome, Notes)
    VALUES (@UserId, @Agent, @Purpose, @ClientReportId, @Provider, @Model, @Prompt, @Response, @InputTokens, @OutputTokens, @LatencyMs, @Outcome, @Notes);
    SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS Id;`, {
    UserId: call.userId, Agent: call.agent, Purpose: call.purpose.slice(0, 200), ClientReportId: call.clientReportId,
    Provider: model.provider, Model: model.model, Prompt: prompt, Response: response, InputTokens: inTok, OutputTokens: outTok,
    LatencyMs: latencyMs, Outcome: outcome, Notes: notes?.slice(0, 2000) ?? null,
  });
  return Number(row!.id);
}

const ROW = "InteractionId, OccurredOn, UserId, Agent, Purpose, ClientReportId, Provider, Model, InputTokens, OutputTokens, LatencyMs, Outcome, Notes";
const fix = (r: Record<string, unknown>) => ({ ...r, interactionId: Number(r.interactionId) });

export async function aiSummary(take: number) {
  const [[s], recent] = await queryMany("app", `
    SELECT COUNT(*) AS Calls,
           ISNULL(SUM(CASE WHEN Outcome = 'Accepted' THEN 1 ELSE 0 END), 0) AS Accepted,
           ISNULL(SUM(CASE WHEN Outcome = 'Rejected' THEN 1 ELSE 0 END), 0) AS Rejected,
           ISNULL(SUM(CASE WHEN Outcome = 'Error' THEN 1 ELSE 0 END), 0) AS Errors,
           ISNULL(SUM(CAST(InputTokens AS BIGINT)), 0) AS InputTokens, ISNULL(SUM(CAST(OutputTokens AS BIGINT)), 0) AS OutputTokens,
           ISNULL(AVG(LatencyMs), 0) AS AverageLatencyMs
    FROM gov.AiInteraction;
    SELECT TOP (@Take) ${ROW} FROM gov.AiInteraction ORDER BY InteractionId DESC;`, { Take: Math.min(Math.max(take, 1), 200) });
  const model = languageModel();
  return {
    calls: s.calls, accepted: s.accepted, rejected: s.rejected, errors: s.errors,
    inputTokens: Number(s.inputTokens), outputTokens: Number(s.outputTokens), averageLatencyMs: s.averageLatencyMs,
    provider: model.provider, model: model.model, recent: recent.map(fix),
  };
}

export async function aiInteraction(id: number) {
  const row = await queryOne<Record<string, unknown>>("app", `SELECT ${ROW}, Prompt, Response FROM gov.AiInteraction WHERE InteractionId = @Id`, { Id: id });
  return row ? fix(row) : null;
}

export const aiForReport = async (id: number) =>
  (await query<Record<string, unknown>>("app", `SELECT ${ROW} FROM gov.AiInteraction WHERE ClientReportId = @Id ORDER BY InteractionId`, { Id: id })).map(fix);
