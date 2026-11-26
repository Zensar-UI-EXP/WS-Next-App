import { aiEnabled, ask, recordOutcome } from "./ai/gateway";
import { arr, obj, str } from "./ai/languageModel";
import { bindReport } from "./bind";
import { runAll } from "./blockRunner";
import { validateBlock } from "./blockValidator";
import { getCatalog } from "./catalog";
import { InvalidBlockError, StudioError } from "./errors";
import { BlockTypes, TextOrigins, clone, normaliseBlock, type Block, type BlockResult, type Catalog, type ClientReportDetail, type Page } from "./models";
import { factsFromResults, listFacts, listInsights } from "./orchestration/facts";
import { allowedNumbers, unverifiedNumbers } from "./orchestration/numberCheck";
import { fill, longDate, prompt } from "./orchestration/prompts";

/**
 * "Ask the studio": the AI revises one page on the wealth manager's instruction. It may write text and add or change
 * catalogue data blocks (approved keys only, never SQL). Data blocks are validated and run; every figure in its text
 * must be verified; invalid output gets one retry. Disclaimers are always kept. Nothing is saved here.
 */
export async function revisePage(report: ClientReportDetail, page: Page, instruction: string, userId: string): Promise<{ page: Page; summary: string; results: BlockResult[] }> {
  if (!aiEnabled()) throw new StudioError(503, "AI not configured", "No language model is configured, so Ask the studio is not available.");
  const catalog = await getCatalog();
  const p = bindReport(report);
  const current = await runAll(report.definition, p, false, page.blocks);
  const pageFacts = factsFromResults(current, new Map(page.blocks.map((b) => [b.id, b])));
  const otherFacts = report.insights?.facts ?? [];
  const base = buildPrompt(report, page, instruction, pageFacts, otherFacts, catalog);
  let previous: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = previous ? `${base}\n\n## Your previous answer was rejected\n\n${previous}\n\nFix these problems and answer again.` : base;
    const answer = await ask({ agent: "Ask the studio", purpose: `Page "${page.title}": ${instruction.length > 120 ? instruction.slice(0, 120) + "…" : instruction}`,
      userId, clientReportId: report.clientReportId }, text, schema());
    try {
      const { revised, summary } = apply(page, answer.json, catalog, report.definition.scope);
      const results = await runAll(report.definition, p, false, revised.blocks);
      const failed = results.filter((r) => r.error).map((r) => `Block '${r.blockId}' failed to run: ${r.error}`);
      if (failed.length) throw new InvalidBlockError(failed.join(" "));
      const allowed = allowedNumbers([...pageFacts, ...otherFacts, ...factsFromResults(results, new Map(revised.blocks.map((b) => [b.id, b])))]);
      const bad = [...new Set(revised.blocks.filter((b) => b.type === BlockTypes.Text && b.origin === TextOrigins.AskStudio).flatMap((b) => unverifiedNumbers(b.text, allowed)))];
      if (bad.length) throw new InvalidBlockError(`The text uses figures that are not in the verified data: ${bad.join(", ")}.`);
      await recordOutcome(answer.interactionId, true, summary);
      return { page: revised, summary, results };
    } catch (e) {
      if (!(e instanceof InvalidBlockError)) throw e;
      console.warn(`Page ${page.id} attempt ${attempt} rejected: ${e.message}`);
      await recordOutcome(answer.interactionId, false, e.message);
      previous = e.message;
    }
  }
  throw new InvalidBlockError(`The studio could not make a valid page: ${previous}`);
}

function buildPrompt(r: ClientReportDetail, page: Page, instruction: string, pageFacts: ReturnType<typeof factsFromResults>, otherFacts: typeof pageFacts, c: Catalog) {
  return fill(prompt("page"), {
    template: r.templateName, client: r.clientName ?? r.householdName, subject: r.subjectLabel, period: r.periodLabel,
    from: longDate(r.fromDate), to: longDate(r.toDate), sectionLabel: page.sectionLabel, heading: page.heading,
    blocks: JSON.stringify(page.blocks.map((b) => (b.type === BlockTypes.Disclaimer ? { id: b.id, type: b.type, title: b.title }
      : { id: b.id, type: b.type, title: b.title, text: b.text, variant: b.variant, width: b.width, display: b.display, measures: b.measures,
          groupBy: b.groupBy, period: b.period, compare: b.compare, topN: b.topN, sort: b.sort }))),
    results: listFacts(pageFacts, 80), facts: listFacts(otherFacts, 80), insights: listInsights(r.insights), instruction: instruction.trim(),
    measures: c.measures.map((m) => `- ${m.measureKey}: ${m.label} [${m.format}] - ${m.description}`).join("\n"),
    dimensions: c.dimensions.map((d) => `- ${d.dimensionKey}: ${d.label} [${d.source}${d.isTime ? ", time" : ""}]`).join("\n"),
    combinations: Object.entries(c.combinations).map(([k, v]) => `- ${k}: ${v.join(", ")}`).join("\n"),
  });
}

/** Builds the revised page from the model's answer and checks it. Throws InvalidBlockError with the reasons. */
function apply(page: Page, answer: any, catalog: Catalog, scope: string): { revised: Page; summary: string } { // eslint-disable-line @typescript-eslint/no-explicit-any
  const original = new Map(page.blocks.map((b) => [b.id, b]));
  const used = new Set<string>();
  const problems: string[] = [];
  const blocks: Block[] = [];
  let counter = 0;
  const newId = () => { let id: string; do id = `${page.id}a${++counter}`; while (original.has(id) || used.has(id)); return id; };
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  for (const item of answer.blocks ?? []) {
    const existing = original.get(s(item.id));
    if (existing && used.has(existing.id)) { problems.push(`Block '${existing.id}' appears twice.`); continue; }
    if (existing) used.add(existing.id);
    switch (s(item.action)) {
      case "keep":
        if (!existing) problems.push(`There is no block '${s(item.id)}' to keep.`); else blocks.push(existing);
        break;
      case "text": {
        if (existing && existing.type !== BlockTypes.Text) { problems.push(`Block '${existing.id}' is not a text block; only keep it.`); break; }
        const body = s(item.text);
        if (!body || body.length > 6000) { problems.push("A text block needs text of at most 6,000 characters."); break; }
        const unchanged = !!existing && existing.text === body && existing.title === s(item.title);
        blocks.push(normaliseBlock({ id: existing?.id ?? newId(), type: "text", title: s(item.title), text: body,
          variant: item.variant === "header" ? "header" : "body", width: item.width === "half" ? "half" : "full",
          narrative: existing?.narrative ?? null, origin: unchanged ? existing!.origin : TextOrigins.AskStudio }));
        break;
      }
      case "data": {
        if (existing && existing.type !== BlockTypes.Data) { problems.push(`Block '${existing.id}' is not a data block; only keep it.`); break; }
        const block = normaliseBlock({ id: existing?.id ?? newId(), type: "data", title: s(item.title), display: s(item.display),
          width: item.width === "half" ? "half" : "full", measures: (item.measures ?? []).filter(Boolean), groupBy: (item.groupBy ?? []).filter(Boolean),
          period: s(item.period) || "report", compare: s(item.compare) || "none", sort: s(item.sort) || "value_desc", topN: item.topN > 0 ? item.topN : null });
        if (existing?.labels) block.labels = Object.fromEntries(Object.entries(existing.labels).filter(([k]) => block.measures.includes(k)));
        const issues = validateBlock(block, scope, catalog);
        if (issues.length) problems.push(`Data block '${block.title}': ${issues.join(" ")}`);
        blocks.push(block);
        break;
      }
      default:
        problems.push(`Unknown action '${s(item.action)}'.`);
    }
  }
  // Disclaimers are compliance text: put back any the model left out, at the end of the page.
  blocks.push(...page.blocks.filter((b) => b.type === BlockTypes.Disclaimer && !used.has(b.id)));
  if (!blocks.length) problems.push("The page would be empty.");
  if (blocks.length > 12) problems.push("A page can have at most 12 blocks.");
  if (problems.length) throw new InvalidBlockError(problems.join(" "));
  const revised = clone(page);
  revised.blocks = blocks;
  revised.sectionLabel = s(answer.sectionLabel);
  revised.heading = s(answer.heading) || page.heading;
  return { revised, summary: s(answer.summary) };
}

function schema() {
  const block = obj({
    action: { type: "string", enum: ["keep", "text", "data"] }, id: str(), title: str(), text: str(),
    variant: { type: "string", enum: ["body", "header", ""] }, display: str(), width: { type: "string", enum: ["full", "half"] },
    measures: arr(str()), groupBy: arr(str()), period: str(), compare: str(), topN: { type: "integer" }, sort: str(),
  });
  return obj({ summary: str(), sectionLabel: str(), heading: str(), blocks: arr(block) });
}
