// V7 cover: the choices the editor offers (mirrors lib/cover.ts), the cover labels in each language, and the client-side
// warnings the editor shows before the server checks the cover again.

// V10: the options the Cover tab offers come from the approved cover options (lib/coverOptions.ts), loaded when the app starts.
// These three are not configured there: they are the compliance and output settings.
export const COVER_CHOICES = {
  dateMode: [["period", "Report period"], ["asof", "As-of date"], ["run", "Issue date"], ["none", "No date"]],
  classification: [["Private and confidential", "Private and confidential"], ["Confidential", "Confidential"], ["For the addressee only", "For the addressee only"], ["", "None (not allowed)"]],
  printVariant: [["same", "Same as on screen"], ["light", "Light (saves ink)"]],
};

let OPTIONS = null; // { version, options: [{ key, label, group, agent, planned, values: [{ value, label, enabled, colour }] }] }
export const setCoverOptions = (set) => { OPTIONS = set; };
export const coverOptions = () => OPTIONS;
export const coverOption = (key) => OPTIONS?.options.find((o) => o.key === key) ?? null;

/** What the Cover tab offers for an option: the values switched on, in the admin's order, plus the cover's own if it is no longer offered. */
export function coverChoices(key, current) {
  const values = coverOption(key)?.values ?? [];
  const on = values.filter((v) => v.enabled).map((v) => [v.value, v.label]);
  if (current !== undefined && !on.some(([v]) => v === current)) {
    const old = values.find((v) => v.value === current);
    on.push([current, `${old?.label ?? (current || "None")} (no longer offered)`]);
  }
  return on;
}
export const coverValueLabel = (key, value) => coverOption(key)?.values?.find((v) => v.value === value)?.label ?? null;

export const THEME_COLOURS = { navy: "#2d2a5e", teal: "#1f5c5a", burgundy: "#6b2335", graphite: "#2f3437" };
/** The theme's colour: from the cover options (where the bank can add themes), else the built-in one. */
export const themeColour = (theme) => coverOption("theme")?.values?.find((v) => v.value === theme)?.colour ?? THEME_COLOURS[theme] ?? THEME_COLOURS.navy;

/** Cover labels; the report body stays in English. */
export const COVER_LABELS = {
  en: {
    preparedFor: "Prepared for", preparedBy: "Prepared by", period: "Period", asOf: "As of", issued: "Issued", with: "with",
    rm: "Your relationship manager", backTitle: "Thank you", backText: "Questions about this report? Your relationship manager will be glad to help.",
    "Private and confidential": "Private and confidential", Confidential: "Confidential", "For the addressee only": "For the addressee only",
  },
  af: {
    preparedFor: "Voorberei vir", preparedBy: "Voorberei deur", period: "Tydperk", asOf: "Soos op", issued: "Uitgereik", with: "met",
    rm: "U verhoudingsbestuurder", backTitle: "Dankie", backText: "Vrae oor hierdie verslag? U verhoudingsbestuurder help graag.",
    "Private and confidential": "Privaat en vertroulik", Confidential: "Vertroulik", "For the addressee only": "Slegs vir die geadresseerde",
  },
};

export const LEGAL_LINE = "[Legal entity and regulatory status line, wording supplied by compliance]";

/** The same rules the server applies (lib/cover.ts coverIssues), shown while editing. */
export function coverWarnings(cover, approved) {
  const blockers = [], warnings = [];
  if (!cover.classification) blockers.push("A classification line is required.");
  if (!cover.legalLine) blockers.push("The legal entity line is required.");
  if (!cover.title?.trim()) blockers.push("The cover needs a title.");
  if (cover.templateId == null) warnings.push("Not based on an approved cover template.");
  else if (approved && !approved.some((t) => t.coverTemplateId === cover.templateId)) blockers.push("This cover template is no longer approved.");
  else if (approved && !approved.some((t) => t.coverTemplateId === cover.templateId && t.approved?.version === cover.templateVersion))
    warnings.push("A newer version of this cover template has been approved.");
  if (cover.image !== "none" && cover.overlay < 0.2) warnings.push("Light overlay on the image: check the title is easy to read.");
  return { blockers, warnings };
}

/** A cover made from an approved template, keeping the words already written. */
export function coverFromTemplate(template, words = {}) {
  const s = template.approved.settings;
  return { ...s, ...Object.fromEntries(Object.entries(words).filter(([, v]) => v !== undefined)) };
}
