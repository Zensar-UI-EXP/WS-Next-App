import { arr, obj, str } from "../ai/languageModel";
import { ask, recordOutcome } from "../ai/gateway";
import { InvalidBlockError } from "../errors";
import { BlockTypes, TextOrigins, type Block, type ClientContext, type ClientReportDetail, type Fact, type InsightSet, type Page, type ReportDefinition } from "../models";
import { listAccounts, listFacts, listInsights } from "./facts";
import { allowedNumbers, unverifiedNumbers } from "./numberCheck";
import { fill, longDate, prompt } from "./prompts";

const ADVICE = /\b(we recommend|i recommend|you should (buy|sell|invest|switch)|guarantee[ds]?|will (rise|fall|grow|outperform))\b/i;

export const narrativeSlots = (d: ReportDefinition): { page: Page; block: Block }[] =>
  d.pages.filter((p) => p.included && !p.locked)
    .flatMap((page) => page.blocks.filter((b) => b.type === BlockTypes.Text && b.narrative?.trim()).map((block) => ({ page, block })));

/**
 * Narrative Agent: drafts every text block with a narrative brief on the included pages in one model call. The answer
 * is checked deterministically - one draft per block, sensible length, no advice or promises, every figure a verified
 * fact. A rejected answer gets one retry with the reasons; if that fails too the template wording stays.
 */
export async function draftNarrative(report: ClientReportDetail, definition: ReportDefinition, context: ClientContext, facts: Fact[],
  insights: InsightSet, userId: string): Promise<{ drafted: number; blockIds: string[]; summary: string }> {
  const slots = narrativeSlots(definition);
  if (!slots.length) return { drafted: 0, blockIds: [], summary: "No included page has a text block with a narrative brief." };
  const allowed = allowedNumbers(facts);
  const base = fill(prompt("narrative"), {
    template: report.templateName, client: context.clientName, subject: context.subjectLabel, household: context.householdName,
    segment: context.segment, mandates: context.mandates.join(", "), risk: context.riskProfiles.join(", "), period: report.periodLabel,
    from: longDate(report.fromDate), to: longDate(report.toDate), accounts: listAccounts(context), facts: listFacts(facts, 160),
    insights: listInsights(insights),
    slots: slots.map(({ page, block }) =>
      `- ${block.id} on page "${page.title}"${block.title ? ` (titled "${block.title}")` : ""}\n  Brief: ${block.narrative}\n  Template wording: ${(block.text ?? "").replace(/\n/g, " ")}`).join("\n"),
  });
  const schema = obj({ drafts: arr(obj({ blockId: str(), text: str() })) });

  let previous: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = previous ? `${base}\n\n## Your previous answer was rejected\n\n${previous}\n\nFix these problems and answer again.` : base;
    const answer = await ask({ agent: "Narrative Agent", purpose: `Draft ${slots.length} text block(s), attempt ${attempt}`, userId, clientReportId: report.clientReportId }, text, schema);
    const drafts = new Map<string, string>();
    const problems: string[] = [];
    for (const d of answer.json.drafts as { blockId: string; text: string }[]) {
      const body = (d.text ?? "").trim();
      if (!slots.some((s) => s.block.id === d.blockId)) { problems.push(`There is no block '${d.blockId}' to draft.`); continue; }
      if (drafts.has(d.blockId)) { problems.push(`Block '${d.blockId}' was drafted twice.`); continue; }
      drafts.set(d.blockId, body);
      if (body.length < 40 || body.length > 3000) problems.push(`Block '${d.blockId}': the text must be between 40 and 3,000 characters.`);
      const bad = unverifiedNumbers(body, allowed);
      if (bad.length) problems.push(`Block '${d.blockId}' uses figures that are not in the verified list: ${bad.join(", ")}.`);
      const advice = ADVICE.exec(body);
      if (advice) problems.push(`Block '${d.blockId}' gives advice or a promise ("${advice[0]}").`);
    }
    for (const s of slots.filter((s) => !drafts.has(s.block.id))) problems.push(`Block '${s.block.id}' has no draft.`);
    if (!problems.length) {
      for (const { block } of slots) { block.text = drafts.get(block.id)!; block.origin = TextOrigins.NarrativeAgent; }
      await recordOutcome(answer.interactionId, true, `${drafts.size} drafts accepted; figures verified against ${facts.length} facts.`);
      return { drafted: drafts.size, blockIds: [...drafts.keys()],
        summary: `Drafted ${drafts.size} text block(s) on ${new Set(slots.map((s) => s.page.title)).size} page(s); every figure matches the governed data.` };
    }
    previous = problems.map((p) => `- ${p}`).join("\n");
    await recordOutcome(answer.interactionId, false, previous);
  }
  throw new InvalidBlockError(`The drafts did not pass the checks after a retry: ${previous}`);
}
