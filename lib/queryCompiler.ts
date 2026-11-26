import { sourceOf } from "./blockValidator";
import { asDate, asFloat, isoDate, type Params } from "./db";
import { exprFor, Scopes, Sources, dimensionOf, measureOf, type Block, type Catalog, type ResultColumn } from "./models";
import type { BoundParameters } from "./params";
import { addDays, compare, resolve, standard, type DateRange } from "./periods";

export const SERIES = "Series";

export interface CompiledQuery {
  sql: string;
  parameters: Params;
  columns: ResultColumn[];
  seriesLabels: string[];
  dimensionColumns: string[];
  firstMeasure: string;
  periodRows: boolean;
  cumulative: string[];
  baseDate: Date;
  source: string;
}

const quote = (id: string) => `[${id.replace(/]/g, "]]")}]`;

/**
 * Builds the SQL for a catalogue block over the data products. Only vetted catalogue expressions and fixed SQL
 * appear in the text; every user value (household, entity, account, dates, series labels) is a typed parameter.
 *   src  rows of dp.vw_AccountDailyPerformance per range, tagged with Series, AnnYears and ScopePrior
 *   grp  + one g_ column per group-by
 *   day  per Series, group and day: amounts summed, returns weighted by the prior day's value, Contribution
 *   run  + GroupStart / GroupEnd and CumLog (running log-growth);  perf + RunMax (for drawdown)
 * Holdings / Exposure: src = dp.fn_HoldingSnapshot / dp.fn_ExposureSnapshot(@S0To), grp, the same final SELECT.
 */
export function compile(block: Block, scope: string, p: BoundParameters, catalog: Catalog, maxRows: number): CompiledQuery {
  const source = sourceOf(block, catalog);
  const dims = block.groupBy.map((k) => dimensionOf(catalog, k)!);
  const measures = block.measures.map((k) => measureOf(catalog, k)!);
  const periodRows = dims.some((d) => d.periodRows);

  // Snapshots are read at the period end only, so they never need a from date.
  const from = p.from ?? (source !== Sources.Performance ? p.to : null);
  let ranges: DateRange[];
  if (periodRows) {
    if (!p.dataStart) throw new Error("The subject has no valuations.");
    ranges = standard(p.to, p.dataStart);
  } else {
    const main = resolve(block.period, from, p.to);
    ranges = [main];
    const previous = compare(main, block.compare);
    if (previous) ranges.push(previous);
  }

  const parameters: Params = {};
  const filter = scopeFilter(scope, p, parameters);
  let sql = "WITH src AS (\n";
  ranges.forEach((r, i) => {
    parameters[`S${i}Label`] = r.label;
    parameters[`S${i}From`] = asDate(r.from);
    parameters[`S${i}To`] = asDate(r.to);
    parameters[`S${i}Years`] = asFloat(r.years);
    if (i > 0) sql += "    UNION ALL\n";
    sql += source === Sources.Holdings
      ? `    SELECT @S${i}Label AS Series, h.* FROM dp.fn_HoldingSnapshot(@S${i}To) AS h WHERE ${filter}\n`
      : source === Sources.Exposure
        ? `    SELECT @S${i}Label AS Series, h.* FROM dp.fn_ExposureSnapshot(@S${i}To) AS h WHERE ${filter}\n`
        : `    SELECT @S${i}Label AS Series, @S${i}Years AS AnnYears, d.*, SUM(CAST(d.PriorMarketValue AS FLOAT)) OVER (PARTITION BY d.ValueDate) AS ScopePrior\n`
          + `    FROM dp.vw_AccountDailyPerformance AS d WHERE d.ValueDate BETWEEN @S${i}From AND @S${i}To AND ${filter}\n`;
  });

  // Inside the CTEs group-by columns get a g_ prefix (names are case-insensitive: "sector" would clash with Sector).
  const dimCols = dims.map((d) => quote(`g_${d.dimensionKey}`));
  sql += "), grp AS (\n    SELECT src.*" + dims.map((d) => `, ${d.expr} AS ${quote(`g_${d.dimensionKey}`)}`).join("") + " FROM src\n)";

  let fromCte = "grp";
  if (source === Sources.Performance) {
    const keys = ["Series", "AnnYears", ...dimCols].join(", ");
    const partition = ["Series", ...dimCols].join(", ");
    sql += `, day AS (
    SELECT ${keys}, ValueDate,
           SUM(MarketValue) AS MarketValue, SUM(PriorMarketValue) AS PriorMarketValue, SUM(NetFlow) AS NetFlow,
           SUM(Deposits) AS Deposits, SUM(Withdrawals) AS Withdrawals, SUM(Fees) AS Fees,
           SUM(CAST(PriorMarketValue AS FLOAT) * DailyReturn) / NULLIF(SUM(CAST(PriorMarketValue AS FLOAT)), 0) AS DailyReturn,
           SUM(CAST(PriorMarketValue AS FLOAT) * LocalDailyReturn) / NULLIF(SUM(CAST(PriorMarketValue AS FLOAT)), 0) AS LocalDailyReturn,
           SUM(CAST(PriorMarketValue AS FLOAT) * BenchmarkReturn)
               / NULLIF(SUM(CASE WHEN BenchmarkReturn IS NOT NULL THEN CAST(PriorMarketValue AS FLOAT) END), 0) AS BenchmarkReturn,
           SUM(CAST(PriorMarketValue AS FLOAT) * DailyReturn) / NULLIF(MAX(ScopePrior), 0) AS Contribution
    FROM grp
    GROUP BY ${keys}, ValueDate
), run AS (
    SELECT day.*, MIN(ValueDate) OVER (PARTITION BY ${partition}) AS GroupStart,
           MAX(ValueDate) OVER (PARTITION BY ${partition}) AS GroupEnd,
           SUM(LOG(1.0 + DailyReturn)) OVER (PARTITION BY ${partition} ORDER BY ValueDate ROWS UNBOUNDED PRECEDING) AS CumLog
    FROM day
), perf AS (
    SELECT run.*, MAX(CumLog) OVER (PARTITION BY ${partition} ORDER BY ValueDate ROWS UNBOUNDED PRECEDING) AS RunMax
    FROM run
)`;
    fromCte = "perf";
  }
  sql += "\n";

  const groupBy = ["Series", ...dimCols].join(", ");
  const select = ["Series", ...dims.map((d) => `${quote(`g_${d.dimensionKey}`)} AS ${quote(d.dimensionKey)}`)].join(", ");
  sql += `SELECT TOP (${maxRows}) ${select}`;
  for (const m of measures) sql += `,\n       ${exprFor(m, source)} AS ${quote(m.measureKey)}`;
  sql += `\nFROM ${fromCte}\nGROUP BY ${groupBy}\nORDER BY ${groupBy}`;

  const columns: ResultColumn[] = dims.map((d) => ({
    name: d.dimensionKey, label: d.periodRows ? "Period" : d.label, format: d.format === "month" ? "month" : d.format, role: "dimension",
  }));
  if (ranges.length > 1 && !periodRows) columns.push({ name: SERIES, label: "Period", format: "text", role: "series" });
  for (const m of measures)
    columns.push({ name: m.measureKey, label: block.labels?.[m.measureKey] || m.label, format: m.format, role: "measure" });

  return {
    sql, parameters, columns, seriesLabels: ranges.map((r) => r.label), dimensionColumns: dims.map((d) => d.dimensionKey),
    firstMeasure: measures[0].measureKey, periodRows, cumulative: measures.filter((m) => m.cumulative).map((m) => m.measureKey),
    baseDate: addDays(ranges[0].from, -1), source,
  };
}

/** The WHERE condition for the report's subject (household, optionally one entity or account); adds its parameters. */
export function scopeFilter(scope: string, p: BoundParameters, parameters: Params): string {
  if (scope !== Scopes.Client) return "1 = 1";
  if (p.householdId == null) throw new Error("Choose a household.");
  parameters.HouseholdId = p.householdId;
  let filter = "HouseholdId = @HouseholdId";
  if (p.clientId != null) { parameters.ClientId = p.clientId; filter += " AND ClientId = @ClientId"; }
  if (p.portfolioCode) { parameters.PortfolioCode = p.portfolioCode; filter += " AND PortfolioCode = @PortfolioCode"; }
  return filter;
}

/**
 * Orders and trims the rows: members are sorted by the first measure in the main period, or by label; Top N keeps
 * the first N members in every period; Series is dropped without a comparison; standard-period rows keep their
 * order; growth measures are chained into an index starting at 100 on the day before the period.
 */
export function shape(rows: Record<string, unknown>[], q: CompiledQuery, block: Block): Record<string, unknown>[] {
  if (q.periodRows) {
    const pos = new Map(q.seriesLabels.map((s, i) => [s, i]));
    const ordered = [...rows].sort((a, b) => (pos.get(String(a[SERIES])) ?? 99) - (pos.get(String(b[SERIES])) ?? 99));
    ordered.forEach((r) => delete r[SERIES]);
    return ordered;
  }
  const memberKey = (r: Record<string, unknown>) => q.dimensionColumns.map((c) => String(r[c] ?? "")).join("\u001f");
  const value = (r: Record<string, unknown>) => (r[q.firstMeasure] == null ? null : Number(r[q.firstMeasure]));
  const main = q.seriesLabels[0];
  let members = [...new Set(rows.map(memberKey))];
  const mainValue = new Map(rows.filter((r) => r[SERIES] === main).map((r) => [memberKey(r), value(r)]));
  const sortValue = (m: string) => mainValue.get(m) ?? null;
  const sort = q.cumulative.length ? "label_asc" : block.sort;
  const nullsLast = (a: number | null, b: number | null, dir: number) =>
    a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : dir * (a - b);
  members = sort === "label_asc" ? members.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    : sort === "value_asc" ? members.sort((a, b) => nullsLast(sortValue(a), sortValue(b), 1))
    : members.sort((a, b) => nullsLast(sortValue(a), sortValue(b), -1));
  if (block.topN && !q.cumulative.length) members = members.slice(0, block.topN);

  const order = new Map(members.map((m, i) => [m, i]));
  const seriesOrder = new Map(q.seriesLabels.map((s, i) => [s, i]));
  let shaped = rows
    .filter((r) => order.has(memberKey(r)))
    .sort((a, b) => order.get(memberKey(a))! - order.get(memberKey(b))!
      || (seriesOrder.get(String(a[SERIES])) ?? 99) - (seriesOrder.get(String(b[SERIES])) ?? 99));
  if (q.cumulative.length && shaped.length) shaped = chainIndex(shaped, q);
  if (q.seriesLabels.length === 1) shaped.forEach((r) => delete r[SERIES]);
  return shaped;
}

/** Turns each period's growth (0.012 = +1.2%) into an index: 100 on the base date, then compounded. */
function chainIndex(rows: Record<string, unknown>[], q: CompiledQuery) {
  const base: Record<string, unknown> = { ...rows[0], [q.dimensionColumns[0]]: isoDate(q.baseDate) };
  for (const c of q.columns.filter((c) => c.role === "measure")) base[c.name] = q.cumulative.includes(c.name) ? 100 : null;
  const level: Record<string, number> = Object.fromEntries(q.cumulative.map((c) => [c, 100]));
  for (const row of rows)
    for (const c of q.cumulative) {
      if (row[c] == null) continue;
      level[c] *= 1 + Number(row[c]);
      row[c] = Math.round(level[c] * 10000) / 10000;
    }
  return [base, ...rows];
}
