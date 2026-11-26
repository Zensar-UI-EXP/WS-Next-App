import { runAll } from "../blockRunner";
import { coverIssues, coverTexts } from "../cover";
import { approvedOptions, notOffered } from "../coverOptions";
import { approvedCovers } from "../repos/covers";
import { BlockTypes, Check, isAiOrigin, Readiness, allBlocks, type ClientContext, type ClientReportDetail, type DataReadiness, type InsightSet,
  type ReadinessCheck, type ReleaseReadiness, type ReportDefinition } from "../models";
import { getDisclosures } from "../repos/content";
import { getPublished, getVersion } from "../repos/reports";
import { bindReport } from "../bind";
import { factsFromResults } from "./facts";
import { allowedNumbers, unverifiedNumbers } from "./numberCheck";

const KNOWN = new Set(["{Client}", "{Portfolio}", "{Period}", "{From date}", "{To date}", "{As of date}", "{Base date}", "{Run date}", "{Report name}"]);
const PLACEHOLDER = /\{[A-Za-z][A-Za-z ]{0,30}\}/g;
const check = (code: string, label: string, status: string, detail: string): ReadinessCheck => ({ code, label, status, detail });

/**
 * Release Readiness Service (deterministic): released template, data readiness, every figure calculating, required
 * disclosures, intact compliance pages, figures in all text verified, known placeholders.
 */
export async function checkRelease(report: ClientReportDetail, definition: ReportDefinition, context: ClientContext, data: DataReadiness,
  insights: InsightSet | null): Promise<ReleaseReadiness> {
  const checks: ReadinessCheck[] = [];
  const included = definition.pages.filter((p) => p.included);

  const published = (await getPublished()).find((p) => p.report.reportId === report.reportId)?.version;
  checks.push(!published ? check("TEMPLATE", "Template is released", Check.Blocker, "The template no longer has a released version.")
    : published.versionNo === report.versionNo ? check("TEMPLATE", "Template is released", Check.Passed, `Made from v${report.versionNo}, the released version.`)
    : check("TEMPLATE", "Template is released", Check.Warning, `Made from v${report.versionNo}; v${published.versionNo} has since been released.`));

  const notPassed = data.checks.filter((c) => c.status !== Check.Passed);
  checks.push(check("DATA", "Data is complete and fresh",
    data.status === Readiness.Blocked ? Check.Blocker : data.status === Readiness.Warnings ? Check.Warning : Check.Passed,
    notPassed.length ? notPassed.map((c) => `${c.label}: ${c.detail}`).join(" ") : "All data-quality checks passed for the period."));

  const results = await runAll(definition, bindReport(report), false);
  const blocks = new Map(allBlocks(definition).map((b) => [b.id, b]));
  const broken = results.filter((r) => r.error || r.issues.length);
  const dataCount = results.filter((r) => blocks.get(r.blockId)?.type === BlockTypes.Data).length;
  checks.push(broken.length === 0
    ? check("FIGURES", "Every figure calculates", Check.Passed, `${dataCount} charts, tables and figure blocks ran from the data products.`)
    : check("FIGURES", "Every figure calculates", Check.Blocker, broken.map((r) => `${blocks.get(r.blockId)!.title}: ${r.error ?? r.issues.join(" ")}`).join(" ")));

  const library = await getDisclosures();
  const required = library.filter((d) => d.appliesWhen === "Always" || context.conditions.includes(d.appliesWhen));
  const present = new Set(included.flatMap((p) => p.blocks).filter((b) => b.type === BlockTypes.Disclaimer).map((b) => b.disclosureCode));
  const missing = required.filter((d) => !present.has(d.disclosureCode));
  checks.push(missing.length === 0
    ? check("DISCLOSURES", "Required disclosures are included", Check.Passed, `${required.length} required: ${required.map((d) => `${d.title} v${d.version}`).join(", ")}.`)
    : check("DISCLOSURES", "Required disclosures are included", Check.Blocker, `Missing: ${missing.map((d) => d.title).join(", ")}.`));

  const lockedTemplate = (await getVersion(report.reportId, report.versionNo))?.definition.pages.filter((p) => p.locked) ?? [];
  const problems: string[] = [];
  for (const t of lockedTemplate) {
    const page = definition.pages.find((p) => p.id === t.id);
    const expected = t.blocks.filter((b) => !b.condition || context.conditions.includes(b.condition)).map((b) => b.id).join();
    if (!page || !page.included) problems.push(`${t.title} is missing.`);
    else if (page.blocks.map((b) => b.id).join() !== expected) problems.push(`${t.title} was changed.`);
  }
  checks.push(problems.length === 0
    ? check("COMPLIANCE_PAGES", "Compliance pages are intact", Check.Passed, `${lockedTemplate.length} locked pages included as approved.`)
    : check("COMPLIANCE_PAGES", "Compliance pages are intact", Check.Blocker, problems.join(" ")));

  const facts = [...factsFromResults(results, blocks), ...(insights?.facts ?? [])];
  const allowed = allowedNumbers(facts);
  const texts = included.filter((p) => !p.locked).flatMap((page) => page.blocks.filter((b) => b.type === BlockTypes.Text).map((block) => ({ page, block })));
  const unverified = texts.map((t) => ({ ...t, bad: [...unverifiedNumbers(t.block.text, allowed), ...unverifiedNumbers(t.block.title, allowed)] })).filter((x) => x.bad.length);
  const aiCount = texts.filter((t) => isAiOrigin(t.block.origin)).length;
  checks.push(unverified.length === 0
    ? check("NARRATIVE", "Figures in the text are verified", Check.Passed,
      `${texts.length} text blocks checked (${aiCount} drafted or rewritten by AI); every figure matches the governed data.`)
    : check("NARRATIVE", "Figures in the text are verified", Check.Warning,
      unverified.map((u) => `${u.page.title}: ${u.bad.join(", ")} not found in the governed figures.`).join(" ") + " The reviewer must confirm these."));

  // V7: the cover's required elements, approved template and image, and verified figures in its words.
  if (definition.cover) {
    const { blockers, warnings } = coverIssues(definition.cover, await approvedCovers());
    // V10: values the approved cover options no longer offer (the cover keeps them; the reviewer decides).
    warnings.push(...notOffered(definition.cover, await approvedOptions()));
    const badCover = [...new Set(coverTexts(definition.cover).flatMap((t) => unverifiedNumbers(t, allowed)))];
    if (badCover.length) warnings.push(`Cover figures ${badCover.join(", ")} not found in the governed figures.`);
    checks.push(check("COVER", "Cover meets the cover rules", blockers.length ? Check.Blocker : warnings.length ? Check.Warning : Check.Passed,
      [...blockers, ...warnings].join(" ") || `Approved cover '${definition.cover.templateName}' v${definition.cover.templateVersion}; classification and legal line present.`));
  }

  const unknown = [...new Set([
    ...included.flatMap((p) => p.blocks).flatMap((b) => `${b.title} ${b.text ?? ""}`.match(PLACEHOLDER) ?? []),
    ...included.flatMap((p) => `${p.heading} ${p.sectionLabel}`.match(PLACEHOLDER) ?? []),
  ].filter((v) => !KNOWN.has(v)))];
  checks.push(unknown.length === 0
    ? check("PLACEHOLDERS", "Placeholders are filled", Check.Passed, "Every placeholder is a known field.")
    : check("PLACEHOLDERS", "Placeholders are filled", Check.Warning, `Unknown: ${unknown.join(", ")} (shown as typed).`));

  return {
    status: checks.some((c) => c.status === Check.Blocker) ? Readiness.Blocked : checks.some((c) => c.status === Check.Warning) ? Readiness.Warnings : Readiness.Ready,
    checks, checkedOn: new Date(),
  };
}
