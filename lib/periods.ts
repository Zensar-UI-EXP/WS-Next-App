import { COMPARE_LABELS, PERIOD_LABELS } from "./models";

/** A date range with its label. years > 1 means returns over it are annualised over that many years. */
export interface DateRange { from: Date; to: Date; label: string; years: number }

const DAY = 86_400_000;
export const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const addMonths = (d: Date, n: number) => {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  r.setUTCDate(Math.min(day, daysInMonth(r)));
  return r;
};
const addYears = (d: Date, n: number) => addMonths(d, 12 * n);
const daysInMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
const dayNumber = (d: Date) => Math.round(d.getTime() / DAY);

/** "Since inception" starts before any data. */
export const INCEPTION = ymd(1900, 1, 1);
export const quarterStart = (d: Date) => ymd(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3 + 1, 1);

/** True for the last calendar day or the last business day of a month (e.g. Friday 30 Oct 2026). */
export function isMonthEnd(date: Date): boolean {
  for (let d = addDays(date, 1); d.getUTCMonth() === date.getUTCMonth(); d = addDays(d, 1))
    if (!isWeekend(d)) return false;
  return true;
}

export function resolve(period: string, from: Date | null, to: Date): DateRange {
  const r = (f: Date, label: string): DateRange => ({ from: f, to, label, years: 1 });
  switch (period) {
    case "report":
      if (!from) throw new Error("The report period needs a from date.");
      return r(from, PERIOD_LABELS.report);
    case "qtd": return r(quarterStart(to), PERIOD_LABELS.qtd);
    case "ytd": return r(ymd(to.getUTCFullYear(), 1, 1), PERIOD_LABELS.ytd);
    case "1y": return r(addDays(addYears(to, -1), 1), PERIOD_LABELS["1y"]);
    case "3y": return r(addDays(addYears(to, -3), 1), PERIOD_LABELS["3y"]);
    case "inception": return r(INCEPTION, PERIOD_LABELS.inception);
    default: throw new Error(`Unknown period '${period}'.`);
  }
}

/** The comparison range, or null for none. Month-end dates stay month-ends (30 Sep → 30 Jun). */
export function compare(main: DateRange, kind: string): DateRange | null {
  if (kind === "none") return null;
  const months = kind === "previous_quarter" ? -3 : kind === "previous_year" ? -12 : NaN;
  if (Number.isNaN(months)) throw new Error(`Unknown comparison '${kind}'.`);
  const shift = (d: Date) => {
    if (d.getTime() === INCEPTION.getTime()) return d;
    const s = addMonths(d, months);
    return isMonthEnd(d) ? ymd(s.getUTCFullYear(), s.getUTCMonth() + 1, daysInMonth(s)) : s;
  };
  return { from: shift(main.from), to: shift(main.to), label: COMPARE_LABELS[kind], years: 1 };
}

/**
 * The "Return by period" rows ending on `to`: quarter, half and year containing it, 3 years annualised (when the
 * data covers them), since inception annualised (when longer than a year) and cumulative since inception.
 */
export function standard(to: Date, dataStart: Date): DateRange[] {
  const y = to.getUTCFullYear(), m = to.getUTCMonth() + 1;
  const qs = quarterStart(to);
  const hs = ymd(y, m <= 6 ? 1 : 7, 1);
  const toDateSuffix = (periodEnd: Date) => (isMonthEnd(to) && m === periodEnd.getUTCMonth() + 1 ? "" : " to date");
  const list: DateRange[] = [
    { from: qs, to, label: `Q${Math.floor((m - 1) / 3) + 1} ${y}${toDateSuffix(addDays(addMonths(qs, 3), -1))}`, years: 1 },
    { from: hs, to, label: `H${m <= 6 ? 1 : 2} ${y}${toDateSuffix(addDays(addMonths(hs, 6), -1))}`, years: 1 },
    { from: ymd(y, 1, 1), to, label: isMonthEnd(to) && m === 12 ? `FY ${y}` : `YTD ${y}`, years: 1 },
  ];
  const threeYears = addDays(addYears(to, -3), 1);
  let next = threeYears;
  while (isWeekend(next)) next = addDays(next, 1);
  if (dataStart <= next) list.push({ from: threeYears, to, label: "3 years annualised", years: 3 });
  const inceptionYears = (dayNumber(to) - dayNumber(dataStart) + 1) / 365.25;
  if (inceptionYears > 1.0001) list.push({ from: dataStart, to, label: "Since inception annualised", years: inceptionYears });
  list.push({ from: dataStart, to, label: "Cumulative since inception", years: 1 });
  return list;
}
