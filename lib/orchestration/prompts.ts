import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Prompt templates from /prompts (same files as v3). */
const cache = new Map<string, string>();
export function prompt(name: "narrative" | "composition" | "page"): string {
  if (!cache.has(name)) cache.set(name, readFileSync(join(process.cwd(), "prompts", `${name}-prompt.txt`), "utf8"));
  return cache.get(name)!;
}

/** Replaces {{placeholders}}. */
export const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((t, [k, v]) => t.split(`{{${k}}}`).join(v), template);

export const longDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
