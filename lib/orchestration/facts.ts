import type { Block, BlockResult, ClientContext, Fact, InsightSet } from "../models";
import { formatFact } from "./numberCheck";

/** Every figure in the block results as a fact (label = block title, row and column). */
export function factsFromResults(results: BlockResult[], blocks: Map<string, Block>): Fact[] {
  const facts: Fact[] = [];
  for (const r of results.filter((r) => !r.error && r.columns.length)) {
    const title = blocks.get(r.blockId)?.title ?? r.blockId;
    const dims = r.columns.filter((c) => c.role !== "measure");
    for (const row of r.rows) {
      const rowLabel = dims.map((d) => String(row[d.name] ?? "")).join(" · ");
      for (const c of r.columns.filter((c) => c.role === "measure")) {
        if (row[c.name] == null) continue;
        const value = Number(row[c.name]);
        facts.push({ key: `${r.blockId}.${rowLabel}.${c.name}`, label: [title, rowLabel, c.label].filter(Boolean).join(" · "), value, format: c.format, text: formatFact(value, c.format) });
      }
    }
  }
  return facts;
}

export const listFacts = (facts: Fact[], max = 120) => (facts.length ? facts.slice(0, max).map((f) => `- ${f.label}: ${f.text}`).join("\n") : "(none)");
export const listInsights = (s: InsightSet | null | undefined) =>
  s?.insights.length ? s.insights.map((i) => `- [${i.severity}] ${i.title}: ${i.detail}`).join("\n") : "(none found)";
export const listAccounts = (c: ClientContext) => c.accounts.map((a) => `${a.name} (${a.code}, ${a.currency})`).join("; ");
