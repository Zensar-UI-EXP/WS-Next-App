import type { Fact } from "../models";

/**
 * "AI drafts, engines calculate": every figure in AI-written (or edited) text must be one of the governed facts.
 * Percentages, money amounts and decimals are compared with the facts, allowing a fact to be rounded (to 0, 1 or 2
 * decimals) and quoted without its sign. Years, day numbers and other small whole numbers are ignored.
 */
const TOKEN = /(?<![\w.,])(?<cur>\$|US\$|USD\s?)?(?<int>\d{1,3}(?:,\d{3})+|\d+)(?<dec>\.\d+)?(?:\s?(?<unit>%|per\s?cent|percentage points?|points?\b|pp\b|bn\b|billion|m\b|million|k\b))?/gi;

const roundAway = (x: number, d: number) => {
  const f = 10 ** d;
  return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9)) / f;
};
const fixed = (x: number, d: number) => roundAway(x, d).toFixed(d);
const thousands = (x: number, max: number) => x.toLocaleString("en-US", { maximumFractionDigits: max, minimumFractionDigits: 0 });

/** Formats a value the way the narrative must quote it (the fact's text). */
export function formatFact(value: number, format: string): string {
  switch (format) {
    case "percent": return `${fixed(value * 100, 2)}%`;
    case "currency": return `${value < 0 ? "-$" : "$"}${thousands(Math.round(Math.abs(value)), 0)}`;
    case "ratio": return fixed(value, 2);
    case "index": return fixed(value, 1);
    default: return thousands(value, 2);
  }
}

/** Every accepted way of writing the facts' values. */
export function allowedNumbers(facts: Iterable<Fact>): Set<string> {
  const set = new Set<string>(["num:100"]);
  for (const f of facts) {
    if (f.value == null || Number.isNaN(f.value)) continue;
    const a = Math.abs(f.value);
    for (const d of [0, 1, 2]) {
      if (f.format === "percent") set.add(`pct:${fixed(a * 100, d)}`);
      else if (f.format === "currency") { set.add(`curm:${fixed(a / 1e6, d)}`); set.add(`curk:${fixed(a / 1e3, d)}`); }
      else set.add(`num:${fixed(a, d)}`);
    }
    if (f.format === "currency") set.add(`cur:${Math.round(a)}`);
  }
  return set;
}

/** The figures in `text` that are not among the allowed facts. */
export function unverifiedNumbers(text: string | null | undefined, allowed: Set<string>): string[] {
  const bad: string[] = [];
  if (!text) return bad;
  for (const m of text.matchAll(TOKEN)) {
    const g = m.groups!;
    const digits = g.int.replace(/,/g, "");
    const dec = g.dec ?? "";
    const unit = (g.unit ?? "").toLowerCase();
    const isMoney = !!g.cur;
    const decimals = dec ? dec.length - 1 : 0;
    const value = Number(digits + dec);
    const written = value.toFixed(decimals);
    let key: string | null;
    if (unit === "%" || unit.startsWith("per") || unit.startsWith("percentage") || unit.startsWith("point") || unit === "pp") key = `pct:${written}`;
    else if (unit === "m" || unit === "million") key = isMoney || unit === "million" ? `curm:${written}` : null;
    else if (unit === "bn" || unit === "billion") key = `curm:${(value * 1000).toFixed(Math.max(0, decimals - 3))}`;
    else if (unit === "k") key = `curk:${written}`;
    else if (isMoney) key = `cur:${Math.round(value)}`;
    else if (decimals > 0) key = `num:${written}`;
    else if (digits.length >= 4 && !(value >= 1900 && value <= 2100)) key = `cur:${digits}`;   // a large amount without the $ sign
    else key = null;                                                                             // small whole numbers, years, day numbers
    if (key && !allowed.has(key)) bad.push(m[0].trim());
  }
  return [...new Set(bad)];
}
