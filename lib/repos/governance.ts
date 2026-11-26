import { asDate, query, queryOne, execute } from "../db";
import { dataProductFor, dimensionOf, Sources, type Catalog, type DataQualityExceptionRow } from "../models";

/** Data quality (rules, exceptions, runs), lineage and methodology. */
const EXCEPTION = `
  e.ExceptionId, e.RuleCode, r.Name AS RuleName, r.Severity, a.Code AS PortfolioCode, h.Name AS HouseholdName,
  CASE WHEN i.InstrumentId IS NOT NULL THEN CONCAT(i.Name, N' (', i.Symbol, N')') END AS InstrumentName,
  e.AsOfDate, e.Detail, e.Status, e.DetectedOn, e.UpdatedBy, e.UpdatedOn, e.Note
  FROM gov.DataQualityException e
  JOIN gov.DataQualityRule r ON r.RuleCode = e.RuleCode
  LEFT JOIN src_client.Account a ON a.AccountId = e.AccountId
  LEFT JOIN src_client.Client c ON c.ClientId = a.ClientId
  LEFT JOIN src_client.Household h ON h.HouseholdId = c.HouseholdId
  LEFT JOIN src_reference.Instrument i ON i.InstrumentId = e.InstrumentId`;

export const getExceptions = (includeResolved: boolean) => query<DataQualityExceptionRow>("app", `
  SELECT ${EXCEPTION}
  WHERE @All = 1 OR e.Status <> 'Resolved'
  ORDER BY CASE r.Severity WHEN 'Blocker' THEN 0 ELSE 1 END, CASE e.Status WHEN 'Open' THEN 0 WHEN 'Acknowledged' THEN 1 ELSE 2 END, e.AsOfDate DESC`,
  { All: includeResolved });

/** Unresolved exceptions affecting a subject in a period: its accounts' exceptions, and those of instruments it held. */
export const getExceptionsForSubject = (householdId: number, clientId: number | null, portfolioCode: string | null, from: Date, to: Date) =>
  query<DataQualityExceptionRow>("app", `
    WITH accts AS (
      SELECT AccountId, PortfolioCode FROM dp.vw_HouseholdHierarchy
      WHERE HouseholdId = @HouseholdId AND (@ClientId IS NULL OR ClientId = @ClientId) AND (@Code IS NULL OR PortfolioCode = @Code)
    )
    SELECT ${EXCEPTION}
    WHERE e.Status <> 'Resolved' AND e.AsOfDate BETWEEN @From AND @To
      AND (e.AccountId IN (SELECT AccountId FROM accts)
           OR (e.InstrumentId IS NOT NULL AND EXISTS (
                SELECT 1 FROM dp.fn_HoldingSnapshot(e.AsOfDate) s
                JOIN src_reference.Instrument si ON si.Symbol = s.Symbol
                WHERE si.InstrumentId = e.InstrumentId AND s.SnapshotDate = e.AsOfDate AND s.PortfolioCode IN (SELECT PortfolioCode FROM accts))))
    ORDER BY CASE r.Severity WHEN 'Blocker' THEN 0 ELSE 1 END, e.AsOfDate`,
    { HouseholdId: householdId, ClientId: clientId, Code: portfolioCode, From: asDate(from), To: asDate(to) });

export async function updateException(id: number, status: string, note: string | null, userId: string) {
  const n = await execute("app", "UPDATE gov.DataQualityException SET Status = @Status, Note = @Note, UpdatedBy = @User, UpdatedOn = SYSUTCDATETIME() WHERE ExceptionId = @Id",
    { Id: id, Status: status, Note: note, User: userId });
  return n === 0 ? null : queryOne<DataQualityExceptionRow>("app", `SELECT ${EXCEPTION} WHERE e.ExceptionId = @Id`, { Id: id });
}

export const runChecks = (userId: string) =>
  queryOne<Record<string, unknown>>("app", "EXEC gov.usp_RunDataQuality @RunBy = @User", { User: userId });

export const getRules = () => query("app", "SELECT RuleCode, Name, Severity, Description, Owner FROM gov.DataQualityRule ORDER BY Severity, RuleCode");
export const getLineage = () => query("app", "SELECT DataProduct, SourceSystem, SourceObject, Description FROM gov.DataProductLineage ORDER BY DataProduct, SourceSystem");

/** Every approved measure's methodology with the data products it can be calculated from. */
export function methodology(catalog: Catalog) {
  return catalog.measures.map((m) => ({
    measureKey: m.measureKey, label: m.label, format: m.format, methodology: m.methodology, methodologyVersion: m.methodologyVersion,
    owner: m.owner, approvedOn: m.approvedOn,
    dataProducts: [...new Set([...(catalog.combinations[m.measureKey] ?? []).map((d) => dataProductFor(dimensionOf(catalog, d)!.source)),
      dataProductFor(m.performanceExpr ? Sources.Performance : Sources.Holdings)])].sort(),
  }));
}
