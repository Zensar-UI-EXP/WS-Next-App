import { asDate, execute, isoDate, query, queryMany, queryOne } from "../db";
import {
  normaliseDefinition, type AccountProfile, type ClientReportDetail, type ClientReportSummary, type EntityProfile, type HouseholdProfile,
  type OrchestrationRunSummary, type ReportDefinition,
} from "../models";

/** Households (latest USD values from the data products); only the given households when a list is passed. */
export async function getHouseholds(only?: number[] | null): Promise<HouseholdProfile[]> {
  const [hs, es, as] = await queryMany("app", `
    SELECT HouseholdId, Name, Segment, RelationshipManager, ReviewFrequency, NextReviewDate FROM src_client.Household ORDER BY Name;
    SELECT ClientId, HouseholdId, Name, ClientType, RiskProfile, Mandate FROM src_client.Client ORDER BY Name;
    WITH last AS (SELECT PortfolioCode, MAX(ValueDate) AS LastDate FROM dp.vw_AccountDailyPerformance GROUP BY PortfolioCode)
    SELECT h.PortfolioCode AS Code, h.PortfolioName AS Name, h.ClientId, h.HouseholdId, h.Currency, h.BenchmarkName AS Benchmark,
           h.InceptionDate, l.LastDate AS LastValuation, ISNULL(p.MarketValue, 0) AS MarketValue
    FROM dp.vw_HouseholdHierarchy h
    LEFT JOIN last l ON l.PortfolioCode = h.PortfolioCode
    LEFT JOIN dp.vw_AccountDailyPerformance p ON p.PortfolioCode = l.PortfolioCode AND p.ValueDate = l.LastDate
    ORDER BY h.PortfolioCode;`);
  const accounts = as as unknown as AccountProfile[];
  const entities = (es as unknown as EntityProfile[]).map((e) => ({
    ...e, marketValue: accounts.filter((a) => a.clientId === e.clientId).reduce((s, a) => s + a.marketValue, 0),
  }));
  const households = (hs as unknown as HouseholdProfile[]).map((h) => {
    const acc = accounts.filter((a) => a.householdId === h.householdId);
    return {
      ...h, entities: entities.filter((e) => e.householdId === h.householdId), accounts: acc,
      marketValue: acc.reduce((s, a) => s + a.marketValue, 0),
      dataStart: acc.length ? new Date(Math.min(...acc.map((a) => a.inceptionDate.getTime()))) : null,
    };
  });
  return only ? households.filter((h) => only.includes(h.householdId)) : households;
}

/** The latest business date with valuations (the studio's "as of" date). */
export async function getAsOfDate(): Promise<Date> {
  const row = await queryOne<{ asOf: Date }>("app", "SELECT MAX(ValueDate) AS AsOf FROM dp.vw_AccountDailyPerformance");
  return row!.asOf;
}

const SUMMARY = `
  cr.ClientReportId, cr.ReportId, COALESCE(ag.Title, r.Name) AS TemplateName, cr.VersionNo, cr.HouseholdId, h.Name AS HouseholdName,
  cr.ClientId, COALESCE(c.Name, ac.Name, h.Name) AS ClientName, cr.PortfolioCode,
  CASE WHEN cr.PortfolioCode IS NOT NULL THEN CONCAT(a.Name, N' (', a.Code, N', ', a.Currency, N')')
       WHEN cr.ClientId IS NOT NULL THEN CONCAT(c.Name, N' · all accounts')
       ELSE N'Whole household' END AS SubjectLabel,
  cr.PeriodYear, cr.PeriodKey, cr.FromDate, cr.ToDate, cr.OutputFormat, cr.Status, cr.CreatedBy, cr.CreatedOn, cr.UpdatedBy, cr.UpdatedOn,
  cr.SubmittedBy, cr.SubmittedOn, cr.ReviewedBy, cr.ReviewedOn, cr.ReviewComment, cr.PublishedOn,
  JSON_VALUE(cr.ReadinessJson, '$.status') AS ReadinessStatus,
  lr.RunId AS RunRunId, lr.Kind AS RunKind, lr.Status AS RunStatus, lr.StartedBy AS RunStartedBy, lr.StartedOn AS RunStartedOn,
  lr.FinishedOn AS RunFinishedOn, lr.Summary AS RunSummary`;
const FROM = `
  FROM studio.ClientReport cr
  JOIN studio.Report r            ON r.ReportId = cr.ReportId
  JOIN src_client.Household h     ON h.HouseholdId = cr.HouseholdId
  LEFT JOIN src_client.Client c   ON c.ClientId = cr.ClientId
  LEFT JOIN src_client.Account a  ON a.Code = cr.PortfolioCode
  LEFT JOIN src_client.Client ac  ON ac.ClientId = a.ClientId
  OUTER APPLY (SELECT TOP (1) RunId, Kind, Status, StartedBy, StartedOn, FinishedOn, Summary
               FROM studio.OrchestrationRun WHERE ClientReportId = cr.ClientReportId ORDER BY RunId DESC) lr
  -- V7: a report the agents built is named by its own title, not by the container template.
  OUTER APPLY (SELECT TOP (1) Title FROM studio.AgentReport WHERE ClientReportId = cr.ClientReportId) ag`;

function toSummary(row: Record<string, unknown>): ClientReportSummary {
  const { runRunId, runKind, runStatus, runStartedBy, runStartedOn, runFinishedOn, runSummary, ...rest } = row;
  const latestRun: OrchestrationRunSummary | null = runRunId == null ? null : {
    runId: runRunId as number, clientReportId: rest.clientReportId as number, kind: runKind as string, status: runStatus as string,
    startedBy: runStartedBy as string, startedOn: runStartedOn as Date, finishedOn: runFinishedOn as Date | null, summary: runSummary as string | null,
  };
  return { ...(rest as unknown as ClientReportSummary), periodLabel: "", latestRun };
}

/** Client reports for the given households (null = all), optionally only in the given statuses. */
export async function getReports(households: number[] | null, statuses: string[] | null): Promise<ClientReportSummary[]> {
  const where: string[] = [];
  if (households) where.push("cr.HouseholdId IN @Households");
  if (statuses) where.push("cr.Status IN @Statuses");
  const rows = await query<Record<string, unknown>>("app",
    `SELECT ${SUMMARY} ${FROM} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY cr.UpdatedOn DESC`,
    { ...(households ? { Households: households } : {}), ...(statuses ? { Statuses: statuses } : {}) });
  return rows.map(toSummary);
}

export async function getReport(id: number): Promise<ClientReportDetail | null> {
  const row = await queryOne<Record<string, unknown>>("app",
    `SELECT ${SUMMARY}, cr.DefinitionJson, cr.ContextJson, cr.InsightsJson, cr.ReadinessJson ${FROM} WHERE cr.ClientReportId = @Id`, { Id: id });
  if (!row) return null;
  const { definitionJson, contextJson, insightsJson, readinessJson, ...rest } = row;
  const s = toSummary(rest);
  const parse = (j: unknown) => (j ? reviveDates(JSON.parse(j as string)) : null);
  return {
    ...s,
    definition: normaliseDefinition(JSON.parse(definitionJson as string)),
    context: parse(contextJson), insights: parse(insightsJson), readiness: parse(readinessJson),
    lockedPageIds: [],
    parameters: {
      householdId: String(s.householdId), clientId: s.clientId == null ? null : String(s.clientId), portfolioCode: s.portfolioCode,
      fromDate: isoDate(s.fromDate), toDate: isoDate(s.toDate),
    },
  };
}

/** Stored JSON has ISO strings; the context's inception/valuation dates are used as Dates by the agents. */
function reviveDates<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) ? new Date(v) : v));
}

export async function createReport(r: { reportId: number; householdId: number; clientId: number | null; portfolioCode: string | null; year: number; periodKey: string; outputFormat: string },
  from: Date, to: Date, versionNo: number, definition: ReportDefinition, userId: string): Promise<number> {
  const row = await queryOne<{ id: number }>("app", `
    INSERT studio.ClientReport (ReportId, VersionNo, HouseholdId, ClientId, PortfolioCode, PeriodYear, PeriodKey, FromDate, ToDate, OutputFormat,
                                Status, DefinitionJson, CreatedBy, UpdatedBy)
    VALUES (@ReportId, @VersionNo, @HouseholdId, @ClientId, @PortfolioCode, @Year, @PeriodKey, @From, @To, @OutputFormat, 'Draft', @Json, @User, @User);
    SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id;`, {
    ReportId: r.reportId, VersionNo: versionNo, HouseholdId: r.householdId, ClientId: r.clientId, PortfolioCode: r.portfolioCode,
    Year: r.year, PeriodKey: r.periodKey, From: asDate(from), To: asDate(to), OutputFormat: r.outputFormat, Json: JSON.stringify(definition), User: userId,
  });
  return row!.id;
}

export const saveDefinition = (id: number, definition: ReportDefinition, userId: string) => execute("app",
  "UPDATE studio.ClientReport SET DefinitionJson = @Json, UpdatedBy = @User, UpdatedOn = SYSUTCDATETIME() WHERE ClientReportId = @Id",
  { Id: id, Json: JSON.stringify(definition), User: userId });

/** Stores an orchestration output: Context, Insights or Readiness. */
export function saveStepOutput(id: number, column: "ContextJson" | "InsightsJson" | "ReadinessJson", value: unknown) {
  return execute("app", `UPDATE studio.ClientReport SET ${column} = @Json WHERE ClientReportId = @Id`, { Id: id, Json: JSON.stringify(value) });
}

/** Draft → InReview. False when the report was not a draft. */
export async function submitReport(id: number, userId: string) {
  return (await execute("app", `
    UPDATE studio.ClientReport
    SET Status = 'InReview', SubmittedBy = @User, SubmittedOn = SYSUTCDATETIME(), ReviewedBy = NULL, ReviewedOn = NULL, ReviewComment = NULL,
        UpdatedBy = @User, UpdatedOn = SYSUTCDATETIME()
    WHERE ClientReportId = @Id AND Status = 'Draft'`, { Id: id, User: userId })) === 1;
}

/** InReview → Published (approve) or back to Draft (return). False when the report was not in review. */
export async function decideReport(id: number, userId: string, approve: boolean, comment: string | null) {
  return (await execute("app", `
    UPDATE studio.ClientReport
    SET Status = CASE WHEN @Approve = 1 THEN 'Published' ELSE 'Draft' END,
        PublishedOn = CASE WHEN @Approve = 1 THEN SYSUTCDATETIME() ELSE NULL END,
        ReviewedBy = @User, ReviewedOn = SYSUTCDATETIME(), ReviewComment = @Comment
    WHERE ClientReportId = @Id AND Status = 'InReview'`, { Id: id, User: userId, Approve: approve, Comment: comment })) === 1;
}
