import { runAll } from "./blockRunner";
import { validateBlock } from "./blockValidator";
import { getCatalog } from "./catalog";
import { BlockTypes, allBlocks, clone, type ReportDefinition, type RunParameters } from "./models";
import { bindParameters, detectInputs } from "./params";
import { fillDisclosures, getDisclosures } from "./repos/content";
import type { ReportVersion } from "./repos/reports";

/** Runs a whole template version: detects its inputs, validates the values, runs every block. */
export async function runVersion(reportId: number, name: string, version: ReportVersion, values: RunParameters, includeSql: boolean) {
  const catalog = await getCatalog();
  const inputs = detectInputs(version.definition.scope, allBlocks(version.definition), catalog);
  const bound = bindParameters(values, inputs);
  const definition = clone(version.definition);
  await fillDisclosures(definition);
  return {
    reportId, name, versionNo: version.versionNo, definition, parameters: values, inputs,
    blocks: await runAll(definition, bound, includeSql), runAt: new Date().toISOString().slice(0, 19) + "Z",
  };
}

/** Validation issues per block id (blocks with none are left out). */
export async function blockIssues(definition: ReportDefinition): Promise<Record<string, string[]>> {
  const catalog = await getCatalog();
  const codes = new Set((await getDisclosures()).map((d) => d.disclosureCode));
  const out: Record<string, string[]> = {};
  for (const b of allBlocks(definition)) {
    const issues = validateBlock(b, definition.scope, catalog);
    if (b.type === BlockTypes.Disclaimer && b.disclosureCode && !codes.has(b.disclosureCode)) issues.push(`'${b.disclosureCode}' is not in the disclosure library.`);
    if (issues.length) out[b.id] = issues;
  }
  return out;
}

export async function inputsFor(definition: ReportDefinition) {
  return detectInputs(definition.scope, allBlocks(definition), await getCatalog());
}
