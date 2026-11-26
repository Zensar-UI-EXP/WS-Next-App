import { z } from "zod";
import { CoverOptions, EXTENDABLE, type CoverSettings } from "./cover";
import { execute, query, queryOne, transaction } from "./db";
import { StudioError } from "./errors";

/**
 * The cover options, configured in the platform (V10). The code says what a cover can draw (the catalogue below); a version
 * of the cover options (studio.CoverOptionSet), approved by compliance, says what is offered: which values the Cover tab shows,
 * their names and order, the colour themes and business tags the bank added, what the cover agent may change and which choices
 * it plans ahead. The Cover tab, the cover template designer and the cover agent all read the approved version.
 */

type Values = readonly (readonly [string, string, string?])[];
interface CatalogueEntry {
  key: string; label: string; group: string;
  values?: Values;         // built-in values: [value, name, colour]
  addable?: boolean;       // the admin may add values (data only: a colour theme, a business tag)
  plannable?: boolean;     // a choice the agent can plan ahead
  planned?: boolean;       // planned in the built-in configuration (V9's choices)
}

const v = <K extends keyof typeof CoverOptions>(key: K, names: Record<(typeof CoverOptions)[K][number], string>): Values =>
  CoverOptions[key].map((x) => [x, names[x as keyof typeof names]] as const);

export const CATALOGUE: CatalogueEntry[] = [
  { key: "templateId", label: "Cover template", group: "Template", plannable: true, planned: true },
  { key: "layout", label: "Layout", group: "Layout and design", plannable: true, planned: true,
    values: v("layout", { band: "Colour band", split: "Split image / text", minimal: "Minimal white", centred: "Centred title" }) },
  { key: "band", label: "Colour band", group: "Layout and design", plannable: true, planned: true,
    values: v("band", { tall: "Tall", medium: "Medium", short: "Short", none: "No band" }) },
  { key: "bandAngle", label: "Band shape", group: "Layout and design", plannable: true, values: v("bandAngle", { angled: "Angled", straight: "Straight" }) },
  { key: "image", label: "Background image", group: "Layout and design", plannable: true, planned: true,
    values: v("image", { none: "No image", skyline: "City skyline", waves: "Waves", grid: "Fine grid", peaks: "Mountain peaks", dunes: "Dunes" }) },
  { key: "overlay", label: "Image overlay", group: "Layout and design" },
  { key: "titlePosition", label: "Title position", group: "Layout and design", plannable: true, planned: true,
    values: v("titlePosition", { top: "Top", middle: "Middle", bottom: "Bottom" }) },
  { key: "titleAlign", label: "Title alignment", group: "Layout and design", plannable: true, planned: true, values: v("titleAlign", { left: "Left", centre: "Centred" }) },
  { key: "theme", label: "Colour theme", group: "Branding", plannable: true, addable: true,
    values: [["navy", "Investec navy", "#2d2a5e"], ["teal", "Deep teal", "#1f5c5a"], ["burgundy", "Burgundy", "#6b2335"], ["graphite", "Monochrome graphite", "#2f3437"]] },
  { key: "logo", label: "Logo", group: "Branding", plannable: true, planned: true, values: v("logo", { wordmark: "Full wordmark", monogram: "Monogram", none: "No logo" }) },
  { key: "logoPosition", label: "Logo position", group: "Branding", plannable: true, planned: true,
    values: v("logoPosition", { "top-left": "Top left", "top-right": "Top right", "bottom-left": "Bottom left" }) },
  { key: "logoSize", label: "Logo size", group: "Branding", plannable: true, values: v("logoSize", { s: "Small", m: "Medium", l: "Large" }) },
  { key: "coBrand", label: "Co-brand", group: "Branding" },
  { key: "businessTag", label: "Business tag", group: "Branding", plannable: true, addable: true,
    values: v("businessTag", { "": "None", "Private Banking": "Private Banking", "Wealth & Investment": "Wealth & Investment", "Private Client Advisory": "Private Client Advisory" }) },
  { key: "titleFont", label: "Title font", group: "Typography", plannable: true, values: v("titleFont", { serif: "Source Serif", sans: "Inter", classic: "Georgia" }) },
  { key: "titleSize", label: "Title size", group: "Typography", plannable: true, planned: true, values: v("titleSize", { s: "Small", m: "Medium", l: "Large" }) },
  { key: "titleWeight", label: "Title weight", group: "Typography", plannable: true, values: v("titleWeight", { regular: "Regular", bold: "Bold" }) },
  { key: "letterSpacing", label: "Letter spacing", group: "Typography", plannable: true, values: v("letterSpacing", { tight: "Tight", normal: "Normal", wide: "Wide" }) },
  { key: "eyebrowCase", label: "Eyebrow and labels", group: "Typography", plannable: true, values: v("eyebrowCase", { upper: "UPPER CASE", sentence: "Sentence case" }) },
  { key: "language", label: "Cover language", group: "Personalisation", plannable: true, planned: true, values: v("language", { en: "English", af: "Afrikaans" }) },
  { key: "salutation", label: "Name on the cover", group: "Personalisation", plannable: true,
    values: v("salutation", { formal: "Formal (full name)", "first-name": "First name" }) },
  { key: "rmCard", label: "Relationship manager card", group: "Personalisation" },
];
const entry = (key: string) => CATALOGUE.find((e) => e.key === key);

export interface OptionValue { value: string; label: string; enabled: boolean; colour?: string; builtIn: boolean }
export interface CoverOption {
  key: string; label: string; group: string; agent: "change" | "fixed"; planned: boolean;
  plannable: boolean; addable: boolean; values: OptionValue[] | null;
}
export interface CoverOptionSet { version: number | null; options: CoverOption[] }

// What is stored: per option, what differs from the catalogue (an empty set means the built-in options).
const StoredValue = z.object({ value: z.string().max(60), label: z.string().trim().min(1).max(60), enabled: z.boolean(), colour: z.string().optional() });
const StoredOption = z.object({
  label: z.string().trim().min(1).max(40).optional(), agent: z.enum(["change", "fixed"]).optional(), planned: z.boolean().optional(),
  values: z.array(StoredValue).max(40).optional(),
});
const Stored = z.object({ options: z.record(z.string(), StoredOption) });
type StoredSet = z.infer<typeof Stored>;
const HEX = /^#[0-9a-f]{6}$/i;

/** The configuration as the screens and the agent use it: the catalogue with the stored version's choices on top. */
export function effective(stored: StoredSet, version: number | null): CoverOptionSet {
  return {
    version,
    options: CATALOGUE.map((e) => {
      const s = stored.options[e.key] ?? {};
      let values: OptionValue[] | null = null;
      if (e.values) {
        const builtIn = new Map(e.values.map(([value, label, colour]) => [value, { label, colour }]));
        const listed = (s.values ?? []).filter((x) => builtIn.has(x.value) || (e.addable && EXTENDABLE[e.key]?.(x.value)));
        const seen = new Set<string>();
        values = listed.filter((x) => !seen.has(x.value) && seen.add(x.value)).map((x) => ({
          value: x.value, label: x.label, enabled: x.enabled, builtIn: builtIn.has(x.value),
          ...(e.key === "theme" ? { colour: x.colour && HEX.test(x.colour) ? x.colour : builtIn.get(x.value)?.colour ?? "#2d2a5e" } : {}),
        }));
        // A value the code can draw that this version does not list: all of them when the option was never configured,
        // and switched off when it was (a value added in code later waits until an admin switches it on).
        for (const [value, label, colour] of e.values) if (!seen.has(value))
          values.push({ value, label, enabled: !s.values, builtIn: true, ...(colour ? { colour } : {}) });
      }
      return {
        key: e.key, label: s.label ?? e.label, group: e.group, agent: s.agent ?? "change",
        planned: !!e.plannable && (s.planned ?? !!e.planned), plannable: !!e.plannable, addable: !!e.addable, values,
      };
    }),
  };
}

/** Checks a version an admin saves and keeps only what the platform can draw. */
export function validate(input: unknown): StoredSet {
  const body = z.object({ options: z.array(z.object({
    key: z.string(), label: z.string().trim().min(1).max(40), agent: z.enum(["change", "fixed"]), planned: z.boolean(),
    values: z.array(StoredValue).max(40).nullable(),
  })) }).safeParse(input);
  if (!body.success) throw new StudioError(400, "Invalid cover options", body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const problems: string[] = [];
  const out: StoredSet = { options: {} };
  for (const o of body.data.options) {
    const e = entry(o.key);
    if (!e) { problems.push(`${o.key} is not a cover option.`); continue; }
    const s: z.infer<typeof StoredOption> = { label: o.label, agent: o.agent, planned: !!e.plannable && o.planned };
    if (e.values && o.values) {
      const built = new Set(e.values.map(([x]) => x));
      const seen = new Set<string>();
      for (const x of o.values) {
        if (seen.has(x.value)) problems.push(`${o.label}: "${x.label}" is listed twice.`);
        seen.add(x.value);
        if (!built.has(x.value) && !(e.addable && EXTENDABLE[e.key]?.(x.value)))
          problems.push(e.addable ? `${o.label}: "${x.label}" is not a valid new value.` : `${o.label}: "${x.value}" is not something the cover can draw; it needs a developer first.`);
        if (e.key === "theme" && !HEX.test(x.colour ?? "")) problems.push(`${o.label}: "${x.label}" needs a colour like #2d2a5e.`);
      }
      if (!o.values.some((x) => x.enabled)) problems.push(`${o.label}: switch on at least one value.`);
      s.values = o.values.map((x) => ({ value: x.value, label: x.label, enabled: x.enabled, ...(e.key === "theme" ? { colour: x.colour?.toLowerCase() } : {}) }));
    }
    out.options[o.key] = s;
  }
  if (problems.length) throw new StudioError(400, "Cover options need changes", problems.join("\n"));
  return out;
}

/** Values on a cover that the cover options no longer offer (old covers keep them; reviewers are told). */
export function notOffered(cover: CoverSettings, set: CoverOptionSet): string[] {
  return set.options.filter((o) => o.values).flatMap((o) => {
    const value = (cover as unknown as Record<string, unknown>)[o.key];
    const found = o.values!.find((x) => x.value === value);
    return found?.enabled ? [] : [`${o.label}: ${found?.label ?? (String(value) || "none")} is no longer offered.`];
  });
}

/** May the agent set this value? Fixed options and values that are switched off are not its to choose. */
export function agentMay(set: CoverOptionSet, key: string, value: unknown): string | null {
  const o = set.options.find((x) => x.key === key);
  if (!o) return null;
  if (o.agent === "fixed") return "the cover options do not let the agent change it";
  if (o.values && !o.values.some((x) => x.enabled && x.value === value)) return `${JSON.stringify(value)} is not offered`;
  return null;
}

// ---------- versions ----------

export interface OptionVersion {
  version: number; status: string; set: CoverOptionSet; createdBy: string; createdOn: Date; submittedBy: string | null;
  reviewedBy: string | null; reviewedOn: Date | null; reviewComment: string | null;
}
type Row = { version: number; status: string; configJson: string; createdBy: string; createdOn: Date; submittedBy: string | null; reviewedBy: string | null; reviewedOn: Date | null; reviewComment: string | null };
const toVersion = (r: Row): OptionVersion => {
  const parsed = Stored.safeParse(JSON.parse(r.configJson));
  const { configJson: _j, ...rest } = r;
  return { ...rest, set: effective(parsed.success ? parsed.data : { options: {} }, r.version) };
};

/** The approved cover options (the built-in ones if none has been approved). */
export async function approvedOptions(): Promise<CoverOptionSet> {
  const r = await queryOne<Row>("app", "SELECT TOP (1) * FROM studio.CoverOptionSet WHERE Status = N'Approved'");
  return r ? toVersion(r).set : effective({ options: {} }, null);
}

/** The approved version and the one being worked on (a draft, or waiting for compliance). */
export async function optionVersions() {
  const rows = (await query<Row>("app", "SELECT * FROM studio.CoverOptionSet WHERE Status <> N'Retired' ORDER BY Version")).map(toVersion);
  return { approved: rows.find((r) => r.status === "Approved") ?? null, working: rows.find((r) => r.status !== "Approved") ?? null };
}

export async function saveOptionsDraft(input: unknown, userId: string) {
  const json = JSON.stringify(validate(input));
  return transaction("app", async (run) => {
    const [working] = await run("SELECT VersionId, Status FROM studio.CoverOptionSet WHERE Status IN (N'Draft', N'Submitted')");
    if (working?.status === "Submitted") throw new StudioError(409, "With compliance", "These cover options are waiting for approval; they can change again if compliance returns them.");
    if (working) await run("UPDATE studio.CoverOptionSet SET ConfigJson = @Json WHERE VersionId = @V", { V: working.versionId, Json: json });
    else await run(`INSERT studio.CoverOptionSet (Version, Status, ConfigJson, CreatedBy)
      SELECT ISNULL(MAX(Version), 0) + 1, N'Draft', @Json, @User FROM studio.CoverOptionSet`, { Json: json, User: userId });
    const [row] = await run("SELECT Version FROM studio.CoverOptionSet WHERE Status = N'Draft'");
    return row.version as number;
  });
}

export async function discardOptionsDraft() {
  const n = await execute("app", "DELETE FROM studio.CoverOptionSet WHERE Status = N'Draft'");
  if (!n) throw new StudioError(409, "No draft", "There is no draft of the cover options.");
}

export async function submitOptions(userId: string) {
  const n = await execute("app", "UPDATE studio.CoverOptionSet SET Status = N'Submitted', SubmittedBy = @User, SubmittedOn = SYSUTCDATETIME() WHERE Status = N'Draft'", { User: userId });
  if (!n) throw new StudioError(409, "Nothing to submit", "There is no draft of the cover options.");
}

/** Compliance decision; approving retires the version in use, and the new one applies to every cover from then on. */
export async function decideOptions(approve: boolean, comment: string | null, userId: string) {
  const working = await queryOne<{ versionId: number; version: number; submittedBy: string }>("app",
    "SELECT VersionId, Version, SubmittedBy FROM studio.CoverOptionSet WHERE Status = N'Submitted'");
  if (!working) throw new StudioError(409, "Not submitted", "No cover options are waiting for approval.");
  if (working.submittedBy === userId) throw new StudioError(403, "Segregation of duties", "You cannot approve cover options you submitted.");
  await transaction("app", async (run) => {
    if (approve) await run("UPDATE studio.CoverOptionSet SET Status = N'Retired' WHERE Status = N'Approved'");
    await run(`UPDATE studio.CoverOptionSet SET Status = @Status, ReviewedBy = @User, ReviewedOn = SYSUTCDATETIME(), ReviewComment = @Comment
      WHERE VersionId = @V`, { V: working.versionId, Status: approve ? "Approved" : "Draft", User: userId, Comment: comment });
  });
  return working.version;
}
