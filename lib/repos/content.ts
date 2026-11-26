import { query } from "../db";
import { BlockTypes, allBlocks, type DisclosureRow, type ReportDefinition } from "../models";

/** The content studio's disclosure library. Disclaimer blocks only name a code; the wording always comes from here. */
export const getDisclosures = () =>
  query<DisclosureRow>("app", "SELECT DisclosureCode, Title, Text, AppliesWhen, Version, EffectiveFrom, Owner FROM src_content.Disclosure ORDER BY DisclosureCode");

/** Sets the title and text of every disclaimer block from the library (unknown codes get a visible warning). */
export async function fillDisclosures(definition: ReportDefinition) {
  const library = new Map((await getDisclosures()).map((d) => [d.disclosureCode, d]));
  for (const b of allBlocks(definition).filter((b) => b.type === BlockTypes.Disclaimer)) {
    const d = b.disclosureCode ? library.get(b.disclosureCode) : undefined;
    b.title = d ? d.title : "Disclosure missing";
    b.text = d ? d.text : `The disclosure '${b.disclosureCode}' is not in the library.`;
  }
}
