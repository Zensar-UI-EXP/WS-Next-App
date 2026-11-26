import { getCatalog } from "../catalog";
import { resolvePeriod } from "../clientReports";
import { asDate, asText, execute, isoDate, queryOne, readerQuery } from "../db";
import { runBlock } from "../blockRunner";
import { validateBlock } from "../blockValidator";
import { BlockTypes, Scopes, normaliseBlock, type Block, type BlockResult } from "../models";
import type { BoundParameters } from "../params";
import { getAsOfDate, getHouseholds } from "../repos/wealth";

/**
 * Published figures: at each period close the infrastructure job runs the standard figure sets through the calculation
 * library for every household, entity and account, and publishes the results (schema pub). The Reporting API reads
 * them for closed standard periods; partial and custom periods are calculated on request.
 */
export interface FigureSet { key: string; title: string; measures: string[]; groupBy: string[]; display: string }

export const FIGURE_SETS: FigureSet[] = [
  { key: "key_figures", title: "Key figures", display: "kpi",
    measures: ["opening_value", "market_value", "net_flows", "investment_gain", "return_twr", "benchmark_return", "excess_return", "mwr", "fees"], groupBy: [] },
  { key: "by_account", title: "Results by account", display: "table",
    measures: ["market_value", "return_twr", "benchmark_return", "excess_return", "investment_gain"], groupBy: ["portfolio"] },
  { key: "by_entity", title: "Results by entity", display: "table", measures: ["market_value", "return_twr", "investment_gain"], groupBy: ["client"] },
  { key: "risk", title: "Risk", display: "list", measures: ["volatility", "max_drawdown", "sharpe_ratio", "tracking_error"], groupBy: [] },
  { key: "allocation", title: "Allocation by asset class", display: "pie", measures: ["weight"], groupBy: ["asset_class"] },
  { key: "growth", title: "Growth against the benchmark", display: "line", measures: ["growth_index", "benchmark_index"], groupBy: ["month"] },
];
export const STANDARD_PERIODS = ["FY", "H1", "H2", "Q1", "Q2", "Q3", "Q4"];

/** What makes two requests return the same figures (the display only changes how they are drawn). */
export function signature(b: Pick<Block, "measures" | "groupBy" | "period" | "compare" | "topN" | "sort">): string {
  return JSON.stringify([b.measures, b.groupBy, b.period ?? "report", b.compare ?? "none", b.topN ?? null, b.sort ?? "value_desc"]);
}

export async function setBlock(set: FigureSet, id = set.key): Promise<Block> {
  const catalog = await getCatalog();
  const time = set.groupBy.some((g) => catalog.dimensions.find((d) => d.dimensionKey === g)?.isTime);
  return normaliseBlock({
    id, type: BlockTypes.Data, title: set.title, measures: set.measures, groupBy: set.groupBy, display: set.display,
    period: "report", compare: "none", topN: null, sort: time ? "label_asc" : "value_desc",
  });
}

export const subjectKey = (p: Pick<BoundParameters, "householdId" | "clientId" | "portfolioCode">) =>
  p.portfolioCode ? `P:${p.portfolioCode}` : p.clientId != null ? `C:${p.clientId}` : `H:${p.householdId}`;

/** A period is published once it has closed: a standard period that ends on or before the latest valuation. */
export function isPublishedPeriod(periodKey: string, year: number | null, to: Date, asOf: Date) {
  if (!STANDARD_PERIODS.includes(periodKey) || year == null) return false;
  const end = { FY: 12, H1: 6, H2: 12, Q1: 3, Q2: 6, Q3: 9, Q4: 12 }[periodKey]!;
  const periodEnd = new Date(Date.UTC(year, end, 0));
  return periodEnd <= asOf && to.getTime() === periodEnd.getTime();
}

/** The published result for this subject, period and request, or null. Read with the read-only reporting login. */
export async function findPublished(p: BoundParameters, block: Block): Promise<(BlockResult & { publishedOn: Date }) | null> {
  const rows = await readerQuery(`
    SELECT TOP 1 ResultJson, PublishedOn FROM pub.PublishedResult
    WHERE SubjectKey = @Subject AND FromDate = @From AND ToDate = @To AND Signature = @Signature`,
    { Subject: subjectKey(p), From: asDate(p.from), To: asDate(p.to), Signature: signature(block) });
  if (!rows.length) return null;
  const r = JSON.parse(String(rows[0].ResultJson)) as BlockResult;
  return { ...r, blockId: block.id, issues: [], error: null, sql: null, publishedOn: new Date(String(rows[0].PublishedOn)) };
}

export async function lastPublishRun() {
  return queryOne<{ publishRunId: number; asOfDate: Date; results: number; finishedOn: Date }>("app",
    "SELECT TOP 1 PublishRunId, AsOfDate, Results, FinishedOn FROM pub.PublishRun ORDER BY PublishRunId DESC");
}

/** The period-close job: publishes every figure set for every subject and closed standard period. */
export async function publishAll(log: (m: string) => void = () => {}) {
  const started = new Date();
  const asOf = await getAsOfDate();
  const catalog = await getCatalog();
  const blocks = await Promise.all(FIGURE_SETS.map((s) => setBlock(s)));
  blocks.forEach((b) => { const issues = validateBlock(b, Scopes.Client, catalog); if (issues.length) throw new Error(`${b.id}: ${issues.join(" ")}`); });

  const jobs: { p: BoundParameters; periodKey: string; year: number }[] = [];
  const seen = new Set<string>();
  for (const h of await getHouseholds(null)) {
    const subjects = [
      { clientId: null, portfolioCode: null, accounts: h.accounts },
      ...h.entities.map((e) => ({ clientId: e.clientId, portfolioCode: null, accounts: h.accounts.filter((a) => a.clientId === e.clientId) })),
      ...h.accounts.map((a) => ({ clientId: a.clientId, portfolioCode: a.code, accounts: [a] })),
    ];
    for (const s of subjects.filter((s) => s.accounts.length)) {
      const dataStart = new Date(Math.min(...s.accounts.map((a) => new Date(a.inceptionDate).getTime())));
      for (let year = dataStart.getUTCFullYear(); year <= asOf.getUTCFullYear(); year++) {
        for (const periodKey of STANDARD_PERIODS) {
          let range: { from: Date; to: Date };
          try { range = resolvePeriod(year, periodKey, dataStart, asOf); } catch { continue; }
          if (!isPublishedPeriod(periodKey, year, range.to, asOf)) continue;
          // An account opened mid-year: H1 and Q2 can cover the same dates; publish them once.
          const key = `${subjectKey({ householdId: h.householdId, ...s })}|${isoDate(range.from)}|${isoDate(range.to)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          jobs.push({ p: { householdId: h.householdId, clientId: s.clientId, portfolioCode: s.portfolioCode, from: range.from, to: range.to }, periodKey, year });
        }
      }
    }
  }
  log(`Publishing ${FIGURE_SETS.length} figure sets for ${jobs.length} subject-periods (as of ${isoDate(asOf)})…`);

  const run = await queryOne<{ publishRunId: number }>("app", `
    INSERT pub.PublishRun (AsOfDate, Results, StartedOn, FinishedOn) VALUES (@AsOf, 0, @Started, @Started);
    SELECT CAST(SCOPE_IDENTITY() AS INT) AS PublishRunId;`, { AsOf: asDate(asOf), Started: started });
  await execute("app", "DELETE pub.PublishedResult WHERE PublishRunId <> @Run", { Run: run!.publishRunId });

  let done = 0, next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      for (const [i, block] of blocks.entries()) {
        const r = await runBlock(block, Scopes.Client, { ...j.p }, false);
        if (r.error || !r.rows.length) continue;
        await execute("app", `
          INSERT pub.PublishedResult (PublishRunId, SubjectKey, PeriodKey, PeriodYear, FromDate, ToDate, FigureSet, Signature, ResultJson)
          VALUES (@Run, @Subject, @Key, @Year, @From, @To, @Set, @Signature, @Json)`,
          { Run: run!.publishRunId, Subject: subjectKey(j.p), Key: j.periodKey, Year: j.year, From: asDate(j.p.from), To: asDate(j.p.to),
            Set: FIGURE_SETS[i].key, Signature: signature(block),
            Json: asText(JSON.stringify({ columns: r.columns, rows: r.rows, dataProduct: r.dataProduct })) });
        done++;
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  await execute("app", "UPDATE pub.PublishRun SET Results = @Done, FinishedOn = SYSUTCDATETIME() WHERE PublishRunId = @Run", { Done: done, Run: run!.publishRunId });
  log(`Published ${done} results in ${((Date.now() - started.getTime()) / 1000).toFixed(0)} s.`);
  return { publishRunId: run!.publishRunId, results: done, asOfDate: isoDate(asOf) };
}
