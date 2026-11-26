import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type { z } from "zod/v4";
import { config } from "../config";
import type { RunState } from "./state";
import { execute } from "../db";
import { addAgentEvent } from "./store";

/**
 * Runs one agent: Claude with its own instructions and tools, in a tool-use loop (the SDK's tool runner) until it
 * stops calling tools. Every assistant message, tool call and tool result is written to the run's trace.
 */
let client: Anthropic | null = null;
function getClient() {
  if (!config.ai.apiKey) throw new Error("ANTHROPIC_API_KEY is not set in .env.local.");
  return (client ??= new Anthropic({ apiKey: config.ai.apiKey, baseURL: config.ai.baseUrl }));
}

const shorten = (value: unknown, max = 4000) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

/** A tool whose calls and results are recorded in the trace; a thrown error goes back to the model as a tool error. */
export function tracedTool<S extends z.ZodType>(s: RunState, agent: string, def: {
  name: string; description: string; inputSchema: S; title: (input: z.infer<S>) => string; run: (input: z.infer<S>) => Promise<unknown>;
}): BetaRunnableTool<z.infer<S>> {
  return betaZodTool({
    name: def.name, description: def.description, inputSchema: def.inputSchema,
    run: async (input) => {
      try {
        const result = await def.run(input);
        await addAgentEvent(s.reportId, { agent, kind: "tool", title: def.title(input), detail: { tool: def.name, input, result: shorten(result) } });
        return typeof result === "string" ? result : JSON.stringify(result);
      } catch (e) {
        const message = (e as Error).message;
        await addAgentEvent(s.reportId, { agent, kind: "tool_error", title: `${def.title(input)}: rejected`, detail: { tool: def.name, input, error: message } });
        throw e;
      }
    },
  });
}

export async function runAgent(s: RunState, agent: string, opts: {
  system: string; prompt: string; tools: BetaRunnableTool<any>[]; maxIterations: number; // eslint-disable-line @typescript-eslint/no-explicit-any
}): Promise<string> {
  await addAgentEvent(s.reportId, { agent, kind: "start", title: `${agent} started`, detail: opts.prompt });
  const runner = getClient().beta.messages.toolRunner({
    model: config.ai.model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-06-01"],
    fallbacks: [{ model: config.ai.fallbackModel }],
    output_config: { effort: config.ai.effort },
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    tools: opts.tools,
    messages: [{ role: "user", content: opts.prompt }],
    max_iterations: opts.maxIterations,
  });
  let last: Anthropic.Beta.BetaMessage | null = null;
  let turn = 0, since = Date.now();
  for await (const message of runner) {
    last = message;
    // AI monitoring (gov.AiInteraction), like every V4 model call. Latency is measured between turns, so it includes the tools.
    await logModelTurn(s, agent, ++turn, turn === 1 ? `${opts.system}\n\n---\n\n${opts.prompt}` : "(continues with the tool results)", message, Date.now() - since);
    since = Date.now();
    const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    const calls = message.content.filter((b) => b.type === "tool_use").map((b) => (b as Anthropic.Beta.BetaToolUseBlock).name);
    await addAgentEvent(s.reportId, {
      agent, kind: "message",
      title: text ? text.split("\n")[0].slice(0, 300) : calls.length ? `Calls ${calls.join(", ")}` : "Thinking",
      detail: text || null, inputTokens: (message.usage.input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0),
      outputTokens: message.usage.output_tokens,
    });
  }
  if (!last) throw new Error(`${agent} returned nothing.`);
  if (last.stop_reason === "refusal") throw new Error(`${agent}: the model declined this request.`);
  if (last.stop_reason === "max_tokens") throw new Error(`${agent}: the answer was cut off (max tokens).`);
  if (last.stop_reason === "tool_use") throw new Error(`${agent} did not finish within ${opts.maxIterations} steps.`);
  const answer = last.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  await addAgentEvent(s.reportId, { agent, kind: "finish", title: `${agent} finished`, detail: answer || null });
  return answer;
}

const logModelTurn = (s: RunState, agent: string, turn: number, prompt: string, m: Anthropic.Beta.BetaMessage, latencyMs: number) => execute("app", `
  INSERT gov.AiInteraction (UserId, Agent, Purpose, ClientReportId, Provider, Model, Prompt, Response, InputTokens, OutputTokens, LatencyMs, Outcome, Notes)
  VALUES (@User, @Agent, @Purpose, NULL, N'Anthropic', @Model, @Prompt, @Response, @In, @Out, @Ms, @Outcome, @Notes)`, {
  User: s.api.user.userId, Agent: agent, Purpose: `Agent report #${s.reportId}, turn ${turn}`.slice(0, 200), Model: m.model.slice(0, 60),
  Prompt: prompt, Response: shorten(m.content.map((b) => (b.type === "text" ? b.text : b.type === "tool_use" ? { tool: b.name, input: b.input } : b.type)), 20000),
  In: (m.usage.input_tokens ?? 0) + (m.usage.cache_read_input_tokens ?? 0) + (m.usage.cache_creation_input_tokens ?? 0), Out: m.usage.output_tokens, Ms: latencyMs,
  // The governed tools judge each call: a refused one goes back to the agent and shows as a rejected step in the trace.
  Outcome: m.stop_reason === "refusal" || m.stop_reason === "max_tokens" ? "Error" : "Accepted", Notes: m.stop_reason,
}).catch((e) => console.warn("Could not log an agent model turn", e));
