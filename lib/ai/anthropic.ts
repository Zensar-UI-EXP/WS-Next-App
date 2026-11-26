import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { AiOutputError, AiUnavailableError, type JsonSchema, type LanguageModel } from "./languageModel";

/**
 * LanguageModel for AI_PROVIDER = Anthropic: one Messages API call with structured output (a JSON schema), so the
 * reply is always a JSON object of the expected shape. Server-side refusal fallback is enabled, so a rare decline is
 * re-served by the fallback model inside the same call. Same settings as v3.
 */
export function anthropicModel(): LanguageModel {
  let client: Anthropic | null = null;
  const getClient = () => {
    if (!config.ai.apiKey) throw new AiUnavailableError("ANTHROPIC_API_KEY is not set in .env.local.");
    return (client ??= new Anthropic({ apiKey: config.ai.apiKey, baseURL: config.ai.baseUrl }));
  };

  return {
    provider: "Anthropic",
    model: config.ai.model,
    async generateJson(prompt: string, schema: JsonSchema) {
      const response = await getClient().beta.messages.create({
        model: config.ai.model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-06-01"],
        fallbacks: [{ model: config.ai.fallbackModel }],
        output_config: { effort: config.ai.effort, format: { type: "json_schema", schema } },
        messages: [{ role: "user", content: prompt }],
      });
      if (response.stop_reason === "refusal") throw new AiOutputError("The model declined this request.");
      if (response.stop_reason === "max_tokens") throw new AiOutputError("The model's answer was cut off (max tokens).");
      const raw = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      try {
        return { json: JSON.parse(raw), raw, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
      } catch (e) {
        throw new AiOutputError(`The model's answer was not valid JSON: ${(e as Error).message}`);
      }
    },
  };
}
