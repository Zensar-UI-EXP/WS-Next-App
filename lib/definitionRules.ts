import { ALL_BLOCK_TYPES, ALL_CONDITIONS, ALL_PAGE_GROUPS, ALL_PAGE_LAYOUTS, allBlocks, type ReportDefinition } from "./models";

export const MAX_PAGES = 30;

/** Structural checks on a definition (pages and blocks), shared by templates and client reports. */
export function checkDefinition(d: ReportDefinition, maxBlocks: number): [string, string][] {
  const out: [string, string][] = [];
  const blocks = allBlocks(d);
  if (d.pages.length === 0) out.push(["definition.pages", "A report needs at least one page."]);
  if (d.pages.length > MAX_PAGES) out.push(["definition.pages", `A report can have at most ${MAX_PAGES} pages.`]);
  if (d.pages.some((p) => !p.id?.trim()) || new Set(d.pages.map((p) => p.id)).size !== d.pages.length)
    out.push(["definition.pages.id", "Every page needs a unique id."]);
  const badGroup = d.pages.find((p) => !ALL_PAGE_GROUPS.includes(p.group));
  if (badGroup) out.push(["definition.pages.group", `Unknown page group '${badGroup.group}'.`]);
  const badLayout = d.pages.find((p) => !ALL_PAGE_LAYOUTS.includes(p.layout));
  if (badLayout) out.push(["definition.pages.layout", `Unknown page layout '${badLayout.layout}'.`]);
  if (d.pages.some((p) => !p.title?.trim() || p.title.length > 80)) out.push(["definition.pages.title", "Every page needs a title of at most 80 characters."]);
  const badCond = d.pages.find((p) => p.condition && !ALL_CONDITIONS.includes(p.condition));
  if (badCond) out.push(["definition.pages.condition", `Unknown page condition '${badCond.condition}'.`]);
  if (blocks.length > maxBlocks) out.push(["definition.blocks", `A report can have at most ${maxBlocks} blocks.`]);
  if (blocks.some((b) => !b.id?.trim()) || new Set(blocks.map((b) => b.id)).size !== blocks.length)
    out.push(["definition.blocks.id", "Every block needs a unique id."]);
  const unknown = blocks.find((b) => !ALL_BLOCK_TYPES.includes(b.type));
  if (unknown) out.push(["definition.blocks.type", `Unknown block type '${unknown.type}'.`]);
  if (blocks.some((b) => (b.text?.length ?? 0) > 6000 || b.title.length > 200 || (b.narrative?.length ?? 0) > 1000))
    out.push(["definition.blocks.text", "Block text is limited to 6,000 characters, narrative briefs to 1,000 and titles to 200."]);
  const badBlockCond = blocks.find((b) => b.condition && !ALL_CONDITIONS.includes(b.condition));
  if (badBlockCond) out.push(["definition.blocks.condition", `Unknown block condition '${badBlockCond.condition}'.`]);
  return out;
}
