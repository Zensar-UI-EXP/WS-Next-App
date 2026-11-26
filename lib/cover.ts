/**
 * The report cover (V7): its layout, branding, text, typography and personalisation, kept with the report definition.
 * Covers start from a cover template that a designer made and compliance approved; the settings below are what the
 * wealth manager (or the reporting agent) may change. Compliance requires some elements on every cover.
 */
export const CoverOptions = {
  layout: ["band", "split", "minimal", "centred"],
  band: ["tall", "medium", "short", "none"],
  bandAngle: ["angled", "straight"],
  image: ["none", "skyline", "waves", "grid", "peaks", "dunes"],
  titlePosition: ["top", "middle", "bottom"],
  titleAlign: ["left", "centre"],
  logo: ["wordmark", "monogram", "none"],
  logoPosition: ["top-left", "top-right", "bottom-left"],
  logoSize: ["s", "m", "l"],
  theme: ["navy", "teal", "burgundy", "graphite"],
  businessTag: ["", "Private Banking", "Wealth & Investment", "Private Client Advisory"],
  dateMode: ["period", "asof", "run", "none"],
  classification: ["Private and confidential", "Confidential", "For the addressee only", ""],
  titleFont: ["serif", "sans", "classic"],
  titleSize: ["s", "m", "l"],
  titleWeight: ["regular", "bold"],
  letterSpacing: ["tight", "normal", "wide"],
  eyebrowCase: ["upper", "sentence"],
  salutation: ["formal", "first-name"],
  language: ["en", "af"],
  printVariant: ["same", "light"],
} as const;

type Choice<K extends keyof typeof CoverOptions> = (typeof CoverOptions)[K][number];

/**
 * V10: options whose list the bank can extend in the cover options (lib/coverOptions.ts) because they are only data: a colour
 * theme is a colour, a business tag is words. Any value of the right shape is kept here; the cover options say which are offered.
 */
export const EXTENDABLE: Record<string, (v: string) => boolean> = {
  theme: (v) => /^[a-z0-9][a-z0-9-]{1,29}$/.test(v),
  businessTag: (v) => v.length <= 60 && !/[<>{}]/.test(v),
};

export interface CoverSettings {
  templateId: number | null; templateVersion: number | null; templateName: string | null;
  layout: Choice<"layout">; band: Choice<"band">; bandAngle: Choice<"bandAngle">; image: Choice<"image">; overlay: number;
  titlePosition: Choice<"titlePosition">; titleAlign: Choice<"titleAlign">;
  logo: Choice<"logo">; logoPosition: Choice<"logoPosition">; logoSize: Choice<"logoSize">; coBrand: string; theme: string;
  businessTag: string;
  eyebrow: string; title: string; subtitle: string; reportType: string; headline: string; note: string;
  preparedFor: boolean; preparedBy: boolean; dateMode: Choice<"dateMode">; classification: Choice<"classification">; legalLine: boolean;
  titleFont: Choice<"titleFont">; titleSize: Choice<"titleSize">; titleWeight: Choice<"titleWeight">; letterSpacing: Choice<"letterSpacing">;
  eyebrowCase: Choice<"eyebrowCase">;
  salutation: Choice<"salutation">; language: Choice<"language">; rmCard: boolean;
  backCover: boolean; printVariant: Choice<"printVariant">;
}

export const DEFAULT_COVER: CoverSettings = {
  templateId: null, templateVersion: null, templateName: null,
  layout: "band", band: "tall", bandAngle: "angled", image: "none", overlay: 0.35, titlePosition: "middle", titleAlign: "left",
  logo: "wordmark", logoPosition: "top-left", logoSize: "m", coBrand: "", theme: "navy", businessTag: "Wealth & Investment",
  eyebrow: "{Report name}", title: "{Report name}", subtitle: "{Portfolio}", reportType: "", headline: "", note: "",
  preparedFor: true, preparedBy: true, dateMode: "period", classification: "Private and confidential", legalLine: true,
  titleFont: "serif", titleSize: "l", titleWeight: "bold", letterSpacing: "normal", eyebrowCase: "upper",
  salutation: "formal", language: "en", rmCard: false, backCover: false, printVariant: "same",
};

const TEXT_LIMITS: Partial<Record<keyof CoverSettings, number>> = {
  eyebrow: 80, title: 120, subtitle: 160, reportType: 60, headline: 200, note: 300, coBrand: 60, templateName: 120,
};

/** Fills defaults and drops anything that is not a known choice, so stored or posted JSON can be partial. */
export function normaliseCover(raw: unknown): CoverSettings | null {
  if (raw == null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const c: Record<string, unknown> = { ...DEFAULT_COVER };
  for (const [k, def] of Object.entries(DEFAULT_COVER)) {
    const v = r[k];
    if (v === undefined) continue;
    const options = (CoverOptions as Record<string, readonly string[]>)[k];
    if (options) { if (typeof v === "string" && (options.includes(v) || EXTENDABLE[k]?.(v))) c[k] = v; }
    else if (typeof def === "boolean") c[k] = Boolean(v);
    else if (k === "overlay") c[k] = Math.min(0.8, Math.max(0, Number(v) || 0));
    else if (k === "templateId" || k === "templateVersion") c[k] = v == null ? null : Number(v);
    else if (typeof v === "string" || v === null) c[k] = v === null ? (def === null ? null : "") : v.slice(0, TEXT_LIMITS[k as keyof CoverSettings] ?? 200);
  }
  return c as unknown as CoverSettings;
}

/** The cover's own words (checked like any other text: placeholders and verified figures). */
export const coverTexts = (c: CoverSettings) => [c.eyebrow, c.title, c.subtitle, c.reportType, c.headline, c.note, c.coBrand];

/**
 * What compliance requires on every cover (blockers), and what it wants a reviewer to confirm (warnings). Approved
 * images are the library above; a cover must come from an approved cover template.
 */
export function coverIssues(c: CoverSettings, approvedTemplates: { coverTemplateId: number; version: number }[]): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [], warnings: string[] = [];
  if (!c.classification) blockers.push("The cover needs a classification line (e.g. Private and confidential).");
  if (!c.legalLine) blockers.push("The cover needs the legal entity line.");
  if (!c.title.trim()) blockers.push("The cover needs a title.");
  if (c.templateId == null) warnings.push("The cover is not based on an approved cover template.");
  else if (!approvedTemplates.some((t) => t.coverTemplateId === c.templateId))
    blockers.push(`Cover template '${c.templateName ?? c.templateId}' is no longer approved; pick an approved one.`);
  else if (!approvedTemplates.some((t) => t.coverTemplateId === c.templateId && t.version === c.templateVersion))
    warnings.push(`Made from v${c.templateVersion} of cover template '${c.templateName}'; a newer version has been approved.`);
  if (c.image !== "none" && c.overlay < 0.2) warnings.push("The background image has a light overlay: check that the title is easy to read.");
  return { blockers, warnings };
}

/** Placeholder wording for this proof of concept: the real legal entity and regulatory line comes from compliance. */
export const LEGAL_LINE = "[Legal entity and regulatory status line, wording supplied by compliance]";
