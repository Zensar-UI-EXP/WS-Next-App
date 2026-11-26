import { aiEnabled, ask, recordOutcome } from "../ai/gateway";
import { arr, obj, str } from "../ai/languageModel";
import { getCatalog } from "../catalog";
import { validateBlock } from "../blockValidator";
import { allBlocks, clone, Conditions, type ClientContext, type ClientReportDetail, type InsightSet, type ReportDefinition } from "../models";
import { listAccounts, listInsights } from "./facts";
import { fill, prompt } from "./prompts";

export interface CompositionDecision { pageId: string; pageTitle: string; action: "excluded" | "added" | "suggested"; detail: string; by: "rules" | "ai" }
const MAX_ADDITIONS = 2;

/**
 * Report Composition Agent: rules first (pages whose condition the client does not meet are left out), then the
 * model may add up to two approved modules to included, unlocked pages and suggest changes; every addition is
 * validated against the catalogue and dropped if it breaks a rule. Without a model only the rules apply.
 */
export async function compose(report: ClientReportDetail, definition: ReportDefinition, context: ClientContext, insights: InsightSet, userId: string) {
  const decisions: CompositionDecision[] = [];
  for (const page of definition.pages.filter((p) => p.condition && !context.conditions.includes(p.condition) && p.included)) {
    page.included = false;
    decisions.push({ pageId: page.id, pageTitle: page.title, action: "excluded", by: "rules",
      detail: page.condition === Conditions.StructuredProducts ? "The client holds no structured products at the period end."
        : page.condition === Conditions.MultiCurrency ? "All the reported accounts are in US dollars." : `Condition ${page.condition} is not met.` });
  }
  if (!aiEnabled())
    return { decisions, summary: summarise(decisions), aiProblem: "No language model is configured: only the composition rules were applied." as string | null };

  const catalog = await getCatalog();
  const schema = obj({
    summary: str(),
    additions: arr(obj({ presetKey: str(), pageId: str(), reason: str() })),
    suggestions: arr(obj({ pageId: str(), suggestion: str() })),
  });
  const pages = definition.pages.map((p) => {
    const status = p.locked ? "locked" : p.included ? "included" : "not included";
    const content = p.blocks.map((b) => (b.type === "data" ? `${b.display} "${b.title}" (${b.measures.join(", ")}${b.groupBy.length ? " by " + b.groupBy.join(", ") : ""})` : b.type)).join("; ");
    return `- ${p.id} · ${p.title} · ${status} · ${content}`;
  }).join("\n");
  const answer = await ask({ agent: "Report Composition Agent", purpose: "Select modules for the report", userId, clientReportId: report.clientReportId },
    fill(prompt("composition"), {
      template: report.templateName, client: context.clientName, subject: context.subjectLabel, period: report.periodLabel,
      mandates: context.mandates.join(", "), accounts: listAccounts(context), conditions: context.conditions.join(", ") || "none",
      insights: listInsights(insights), pages, modules: catalog.presets.map((p) => `- ${p.presetKey}: ${p.label} - ${p.description}`).join("\n"),
    }), schema);

  const dropped: string[] = [];
  let counter = 0;
  for (const a of answer.json.additions as { presetKey: string; pageId: string; reason: string }[]) {
    const preset = catalog.presets.find((p) => p.presetKey === a.presetKey);
    const page = definition.pages.find((p) => p.id === a.pageId);
    let problem = !preset ? `'${a.presetKey}' is not an approved module`
      : !page ? `there is no page '${a.pageId}'`
      : !page.included || page.locked ? `page '${page.title}' is locked or not included`
      : page.blocks.length >= 12 ? `page '${page.title}' is full`
      : decisions.filter((d) => d.action === "added").length >= MAX_ADDITIONS ? "only two modules may be added" : null;
    const block = preset ? clone(preset.block) : null;
    if (!problem && block && page) {
      do block.id = `${page.id}m${++counter}`; while (allBlocks(definition).some((b) => b.id === block.id));
      const same = (x: string[], y: string[]) => x.length === y.length && [...x].sort().every((v, i) => v === [...y].sort()[i]);
      if (page.blocks.some((b) => b.type === "data" && same(b.measures, block.measures) && b.groupBy.join() === block.groupBy.join()))
        problem = `page '${page.title}' already shows these figures`;
      else if (validateBlock(block, definition.scope, catalog).length) problem = validateBlock(block, definition.scope, catalog).join(" ");
    }
    if (problem) { dropped.push(`${a.presetKey} on ${a.pageId}: ${problem}`); continue; }
    page!.blocks.push(block!);
    decisions.push({ pageId: page!.id, pageTitle: page!.title, action: "added", detail: `${preset!.label}: ${a.reason}`, by: "ai" });
  }
  for (const s of (answer.json.suggestions as { pageId: string; suggestion: string }[]).slice(0, 2)) {
    const page = definition.pages.find((p) => p.id === s.pageId);
    if (page) decisions.push({ pageId: page.id, pageTitle: page.title, action: "suggested", detail: s.suggestion, by: "ai" });
  }
  await recordOutcome(answer.interactionId, true, dropped.length ? `Dropped ${dropped.length}: ${dropped.join("; ")}` : "All additions passed the catalogue checks.");
  return {
    decisions, summary: `${summarise(decisions)} ${answer.json.summary ?? ""}`.trim(),
    aiProblem: dropped.length ? `Dropped ${dropped.length} proposal(s) that broke the rules: ${dropped.join("; ")}` : null,
  };
}

function summarise(decisions: CompositionDecision[]) {
  const excluded = decisions.filter((d) => d.action === "excluded").map((d) => d.pageTitle);
  const added = decisions.filter((d) => d.action === "added").length;
  return [excluded.length ? `Left out ${excluded.join(", ")} (condition not met).` : "", added ? `Added ${added} module(s).` : "No modules added."].filter(Boolean).join(" ");
}
