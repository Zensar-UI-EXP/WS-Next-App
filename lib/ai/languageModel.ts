/**
 * The language model behind the agents. One implementation per provider, chosen by AI_PROVIDER: Anthropic (Claude)
 * today; an approved enterprise LLM would be another implementation. Callers never use it directly: they go through
 * the gateway, which logs every call for responsible-AI monitoring.
 */
export interface LanguageModel {
  provider: string;
  model: string;
  /** One structured-output call: the reply is a JSON object matching `schema`. */
  generateJson(prompt: string, schema: JsonSchema): Promise<LanguageModelReply>;
}

export interface LanguageModelReply { json: unknown; raw: string; inputTokens: number | null; outputTokens: number | null }
export type JsonSchema = Record<string, unknown>;

/** The model's output was missing, refused or not valid JSON. */
export class AiOutputError extends Error {}
/** No language model is configured: agents fall back to their deterministic behaviour. */
export class AiUnavailableError extends Error {}

/** AI_PROVIDER = Disabled: every call fails fast, so the orchestrator shows how the studio degrades without AI. */
export const disabledModel: LanguageModel = {
  provider: "Disabled",
  model: "none",
  generateJson: async () => { throw new AiUnavailableError("No language model is configured (AI_PROVIDER = Disabled)."); },
};

// ---------- JSON-schema helpers ----------

export const str = () => ({ type: "string" });
/** A closed JSON-schema object whose properties are all required. */
export const obj = (properties: Record<string, unknown>): JsonSchema => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});
export const arr = (items: unknown) => ({ type: "array", items });
