import { runAll } from "../blockRunner";
import { normaliseBlock, normaliseDefinition, type BlockResult, type ClientContext, type Fact, type Insight, type InsightSet, type ReportDefinition } from "../models";
import type { BoundParameters } from "../params";
import { SERIES } from "../queryCompiler";
import { formatFact } from "./numberCheck";

/**
 * Performance & Insight Agent: calls the governed performance services (catalogue blocks over the data products),
 * turns the results into verified facts and finds material movements with fixed, explainable rules. It does not use
 * the language model: engines calculate.
 */
export function analysisDefinition(context: ClientContext, compare: string): ReportDefinition {
  const data = (id: string, display: string, title: string, measures: string[], groupBy: string[] = [], o: Record<string, unknown> = {}) =>
    normaliseBlock({ id, type: "data", display, title, measures, groupBy, width: "full", ...o });
  const compareLabel = compare === "previous_quarter" ? "previous quarter" : "a year earlier";
  const blocks = [
    data("a1", "kpi", "Key figures", ["market_value", "investment_gain", "return_twr", "mwr", "benchmark_return", "excess_return", "net_flows", "fees"]),
    data("a8", "line", "Indexed growth · {Base date} = 100", ["growth_index", "benchmark_index"], ["month"], { width: "half", sort: "label_asc",
      labels: { growth_index: "Portfolio", benchmark_index: "Benchmark" } }),
    data("a2", "list", "Risk in the period", ["volatility", "max_drawdown", "sharpe_ratio", "tracking_error"], [], { width: "half" }),
    data("a3", "table", "By account", ["market_value", "return_twr", "benchmark_return", "excess_return", "mwr", "contribution", "return_local", "fx_effect"], ["portfolio"], {
      labels: { return_twr: "TWR", mwr: "MWR", benchmark_return: "Benchmark", excess_return: "Relative", return_local: "Local ccy", fx_effect: "FX effect" } }),
    data("a4", "bar", `Asset allocation · now vs ${compareLabel}`, ["weight"], ["asset_class"], { width: "half", compare }),
  ];
  if (context.entities.length > 1) blocks.push(data("a5", "table", "By entity", ["market_value", "return_twr", "mwr", "contribution"], ["client"], { width: "half" }));
  if (context.hasStructuredProducts) blocks.push(data("a6", "pie", "Look-through allocation (structured products split)", ["weight"], ["lookthrough_asset_class"], { width: "half" }));
  if (context.isMultiCurrency) blocks.push(data("a7", "table", "By account currency", ["market_value", "return_local", "fx_effect", "return_twr"], ["account_currency"], {
    width: "half", labels: { return_local: "Local currency", fx_effect: "Currency effect", return_twr: "In USD" } }));
  return normaliseDefinition({ scope: "Client", pages: [{ id: "analysis", title: "Analysis", heading: context.subjectLabel, sectionLabel: "Portfolio analysis", layout: "kpi", blocks }] });
}

export const compareFor = (from: Date, to: Date) => ((to.getTime() - from.getTime()) / 86_400_000 <= 100 ? "previous_quarter" : "previous_year");

export async function analyse(context: ClientContext, p: BoundParameters, from: Date, to: Date):
  Promise<{ insights: InsightSet; definition: ReportDefinition; results: BlockResult[] }> {
  const compare = compareFor(from, to);
  const definition = analysisDefinition(context, compare);
  const results = await runAll(definition, p, false);
  const failed = results.find((r) => r.error || r.issues.length);
  if (failed) throw new Error(`Governed figures could not be calculated: ${failed.error ?? failed.issues.join(" ")}`);

  const byId = new Map(results.map((r) => [r.blockId, r]));
  const facts: Fact[] = [];
  const insights: Insight[] = [];
  const addFact = (key: string, label: string, raw: unknown, format: string) => {
    if (raw == null) return;
    const value = Number(raw);
    facts.push({ key, label, value, format, text: formatFact(value, format) });
  };
  const get = (key: string) => facts.find((f) => f.key === key)?.value ?? null;
  const T = (key: string) => facts.find((f) => f.key === key)!.text;
  const points = (key: string) => T(key).replace(/^-/, "").replace("%", " percentage points");

  for (const id of ["a1", "a2"]) {
    const r = byId.get(id)!;
    const row = r.rows[0];
    if (!row) continue;
    for (const c of r.columns.filter((c) => c.role === "measure")) addFact(`total.${c.name}`, c.label, row[c.name], c.format);
  }
  const mv = get("total.market_value"), gain = get("total.investment_gain"), flows = get("total.net_flows");
  if (mv != null && gain != null && flows != null) addFact("total.opening_value", "Opening value", mv - gain - flows, "currency");

  const rowsOf = (blockId: string, dimension: string, prefix: string) => {
    const r = byId.get(blockId);
    if (!r) return;
    for (const row of r.rows) {
      const name = String(row[dimension] ?? "");
      for (const c of r.columns.filter((c) => c.role === "measure")) addFact(`${prefix}.${name}.${c.name}`, `${name}: ${c.label}`, row[c.name], c.format);
    }
  };
  rowsOf("a3", "portfolio", "account");
  rowsOf("a5", "client", "entity");
  rowsOf("a7", "account_currency", "currency");

  // Allocation now vs the comparison period, in percentage points.
  const alloc = byId.get("a4")!;
  const seriesNames = [...new Set(alloc.rows.map((r) => String(r[SERIES] ?? "")))];
  const shifts: { cls: string; now: number; before: number }[] = [];
  for (const cls of [...new Set(alloc.rows.map((r) => String(r.asset_class)))]) {
    const w = (i: number) => Number(alloc.rows.find((r) => r.asset_class === cls && String(r[SERIES] ?? "") === seriesNames[i])?.weight ?? 0);
    const now = w(0);
    const before = seriesNames.length > 1 ? w(1) : now;
    addFact(`allocation.${cls}`, `${cls} weight now`, now, "percent");
    addFact(`allocation.${cls}.before`, `${cls} weight ${compare === "previous_quarter" ? "a quarter earlier" : "a year earlier"}`, before, "percent");
    addFact(`allocation.${cls}.change`, `${cls} weight change (percentage points)`, now - before, "percent");
    shifts.push({ cls, now, before });
  }
  for (const row of byId.get("a6")?.rows ?? [])
    addFact(`lookthrough.${row.lookthrough_asset_class}`, `${row.lookthrough_asset_class} weight (look-through)`, row.weight, "percent");

  // ---------- rules: material movements ----------
  const twr = get("total.return_twr"), excess = get("total.excess_return");
  if (twr != null && get("total.benchmark_return") != null && excess != null) {
    const size = Math.abs(excess);
    insights.push({
      code: "RELATIVE", severity: size >= 0.01 ? "material" : size >= 0.0025 ? "notable" : "info",
      title: size < 0.0025 ? "In line with the benchmark" : excess > 0 ? "Ahead of the benchmark" : "Behind the benchmark",
      detail: `Time-weighted return ${T("total.return_twr")} against ${T("total.benchmark_return")} for the benchmark (${excess >= 0 ? "+" : ""}${T("total.excess_return")} relative).`,
    });
    const mwr = get("total.mwr");
    if (mwr != null) {
      const gap = mwr - twr;
      addFact("total.mwr_minus_twr", "MWR minus TWR (percentage points)", gap, "percent");
      if (Math.abs(gap) >= 0.005)
        insights.push({
          code: "FLOW_TIMING", severity: Math.abs(gap) >= 0.015 ? "material" : "notable",
          title: gap > 0 ? "Flow timing helped" : "Flow timing cost return",
          detail: `The money-weighted return of ${T("total.mwr")} is ${points("total.mwr_minus_twr")} ${gap > 0 ? "above" : "below"} the time-weighted ${T("total.return_twr")}: deposits and withdrawals came at ${gap > 0 ? "favourable" : "unfavourable"} times.`,
        });
    }
  }
  const net = get("total.net_flows"), opening = get("total.opening_value");
  if (net != null && opening != null && opening > 0) {
    const share = net / opening;
    addFact("total.net_flows_share", "Net flows as a share of the opening value", share, "percent");
    if (Math.abs(share) >= 0.05)
      insights.push({
        code: "FLOWS", severity: Math.abs(share) >= 0.1 ? "material" : "notable",
        title: net > 0 ? "Significant net deposits" : "Significant net withdrawals",
        detail: `Net flows of ${T("total.net_flows")}, ${T("total.net_flows_share").replace(/^-/, "")} of the opening value of ${T("total.opening_value")}.`,
      });
  }
  if (shifts.length && seriesNames.length > 1) {
    const biggest = [...shifts].sort((a, b) => Math.abs(b.now - b.before) - Math.abs(a.now - a.before))[0];
    const move = biggest.now - biggest.before;
    if (Math.abs(move) >= 0.03)
      insights.push({
        code: "ALLOCATION", severity: Math.abs(move) >= 0.05 ? "material" : "notable",
        title: `${biggest.cls} allocation ${move > 0 ? "increased" : "reduced"}`,
        detail: `${biggest.cls} is ${T(`allocation.${biggest.cls}`)} of the portfolio, ${move > 0 ? "up" : "down"} ${points(`allocation.${biggest.cls}.change`)} from ${T(`allocation.${biggest.cls}.before`)}.`,
      });
  }
  const accounts = byId.get("a3")!.rows.filter((r) => r.excess_return != null);
  if (accounts.length > 1) {
    const sorted = [...accounts].sort((a, b) => Number(b.excess_return) - Number(a.excess_return));
    const [best, worst] = [sorted[0], sorted[sorted.length - 1]];
    const spread = Number(best.excess_return) - Number(worst.excess_return);
    if (spread >= 0.02)
      insights.push({
        code: "DISPERSION", severity: spread >= 0.05 ? "material" : "notable", title: "Accounts performed differently",
        detail: `${best.portfolio} returned ${T(`account.${best.portfolio}.return_twr`)} (${T(`account.${best.portfolio}.excess_return`)} relative); `
          + `${worst.portfolio} returned ${T(`account.${worst.portfolio}.return_twr`)} (${T(`account.${worst.portfolio}.excess_return`)} relative).`,
      });
  }
  const dd = get("total.max_drawdown");
  if (dd != null && dd <= -0.05)
    insights.push({ code: "DRAWDOWN", severity: dd <= -0.1 ? "material" : "notable", title: "A notable fall during the period", detail: `The largest fall from a peak was ${T("total.max_drawdown")}.` });
  for (const row of byId.get("a3")!.rows.filter((r) => r.fx_effect != null && Math.abs(Number(r.fx_effect)) >= 0.005)) {
    const key = `account.${row.portfolio}`;
    const fx = Number(row.fx_effect);
    insights.push({
      code: "CURRENCY", severity: Math.abs(fx) >= 0.02 ? "material" : "notable", title: `Currency ${fx > 0 ? "added to" : "reduced"} returns`,
      detail: `${row.portfolio} returned ${T(`${key}.return_local`)} in its own currency and ${T(`${key}.return_twr`)} in US dollars (${T(`${key}.fx_effect`)} currency effect).`,
    });
  }
  const lookEquity = get("lookthrough.Equity"), directEquity = get("allocation.Equity");
  if (context.hasStructuredProducts && lookEquity != null && directEquity != null) {
    addFact("lookthrough.equity_added", "Equity exposure added by structured products (percentage points)", lookEquity - directEquity, "percent");
    insights.push({ code: "STRUCTURED", severity: "info", title: "Structured products add equity exposure",
      detail: `Looking through the structured products, equity exposure is ${T("lookthrough.Equity")} rather than the ${T("allocation.Equity")} held directly.` });
  }
  for (const a of context.accounts.filter((a) => a.inceptionDate >= from))
    insights.push({ code: "NEW_ACCOUNT", severity: "info", title: "New account in the period",
      detail: `${a.name} (${a.code}) was opened on ${a.inceptionDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}; its initial funding counts as a deposit.` });

  const order = { material: 0, notable: 1, info: 2 };
  insights.sort((a, b) => order[a.severity] - order[b.severity]);
  return { insights: { facts, insights, comparisonLabel: compare === "previous_quarter" ? "previous quarter" : "previous year" }, definition, results };
}
