import { execute, query, queryMany, queryOne, transaction } from "../db";
import { PageGroups, Scopes, normaliseDefinition, type LookupItem, type ReportDefinition } from "../models";

/**
 * Templates and versions. Draft → Submitted → Published (the previous Published becomes Retired); a returned version
 * goes back to Draft. Saving changes to a Published template creates the next version as a Draft.
 */
const VERSION_COLUMNS = `VersionId, ReportId, VersionNo, Status, PreviewPassed, CreatedBy, CreatedOn, UpdatedBy, UpdatedOn,
  SubmittedBy, SubmittedOn, ReviewedBy, ReviewedOn, ReviewComment`;

export interface VersionInfo {
  versionId: number; reportId: number; versionNo: number; status: string; previewPassed: boolean; createdBy: string; createdOn: Date;
  updatedBy: string; updatedOn: Date; submittedBy: string | null; submittedOn: Date | null; reviewedBy: string | null;
  reviewedOn: Date | null; reviewComment: string | null;
}
export interface ReportVersion extends VersionInfo { definition: ReportDefinition }
export interface ReportSummary {
  reportId: number; name: string; category: string; description: string | null; publishedVersionNo: number | null;
  workingVersionNo: number | null; workingStatus: string | null; updatedOn: Date;
}
export interface ReportDetail {
  reportId: number; name: string; category: string; description: string | null; versions: VersionInfo[];
  working: ReportVersion | null; published: ReportVersion | null; inputs: unknown[]; issues: Record<string, string[]>;
}

const parse = (json: string) => normaliseDefinition(JSON.parse(json));
const withDefinition = (row: Record<string, unknown>): ReportVersion => {
  const { definitionJson, ...v } = row;
  return { ...(v as unknown as VersionInfo), definition: parse(definitionJson as string) };
};

export const getAllReports = () => query<ReportSummary>("app", `
  SELECT r.ReportId, r.Name, r.Category, r.Description,
         p.VersionNo AS PublishedVersionNo, w.VersionNo AS WorkingVersionNo, w.Status AS WorkingStatus,
         COALESCE(w.UpdatedOn, p.UpdatedOn, r.CreatedOn) AS UpdatedOn
  FROM studio.Report r
  LEFT JOIN studio.ReportVersion p ON p.ReportId = r.ReportId AND p.Status = 'Published'
  LEFT JOIN studio.ReportVersion w ON w.ReportId = r.ReportId AND w.Status IN ('Draft', 'Submitted')
  ORDER BY r.Category, r.Name`);

export async function getReportDetail(id: number): Promise<ReportDetail | null> {
  const [head, versions, defs] = await queryMany("app", `
    SELECT ReportId, Name, Category, Description FROM studio.Report WHERE ReportId = @Id;
    SELECT ${VERSION_COLUMNS} FROM studio.ReportVersion WHERE ReportId = @Id ORDER BY VersionNo DESC;
    SELECT VersionId, DefinitionJson FROM studio.ReportVersion WHERE ReportId = @Id AND Status IN ('Draft', 'Submitted', 'Published');`, { Id: id });
  if (!head[0]) return null;
  const byId = new Map((defs as { versionId: number; definitionJson: string }[]).map((d) => [d.versionId, d.definitionJson]));
  const list = versions as unknown as VersionInfo[];
  const full = (v?: VersionInfo) => (v && byId.has(v.versionId) ? { ...v, definition: parse(byId.get(v.versionId)!) } : null);
  return {
    ...(head[0] as unknown as ReportDetail), versions: list, inputs: [], issues: {},
    working: full(list.find((v) => v.status === "Draft" || v.status === "Submitted")),
    published: full(list.find((v) => v.status === "Published")),
  };
}

export async function getVersion(reportId: number, versionNo: number): Promise<ReportVersion | null> {
  const row = await queryOne<Record<string, unknown>>("app",
    `SELECT ${VERSION_COLUMNS}, DefinitionJson FROM studio.ReportVersion WHERE ReportId = @ReportId AND VersionNo = @VersionNo`,
    { ReportId: reportId, VersionNo: versionNo });
  return row ? withDefinition(row) : null;
}

export async function getPublished(): Promise<{ report: ReportSummary; version: ReportVersion }[]> {
  const rows = await query<Record<string, unknown>>("app", `
    SELECT r.ReportId, r.Name, r.Category, r.Description, v.VersionId, v.VersionNo, v.Status, v.PreviewPassed, v.CreatedBy, v.CreatedOn,
           v.UpdatedBy, v.UpdatedOn, v.SubmittedBy, v.SubmittedOn, v.ReviewedBy, v.ReviewedOn, v.ReviewComment, v.DefinitionJson
    FROM studio.Report r JOIN studio.ReportVersion v ON v.ReportId = r.ReportId AND v.Status = 'Published'
    ORDER BY r.Category, r.Name`);
  return rows.map((r) => ({
    report: { reportId: r.reportId, name: r.name, category: r.category, description: r.description } as ReportSummary,
    version: withDefinition(r),
  }));
}

export async function createReport(name: string, category: string, description: string | null, userId: string): Promise<number> {
  const definition: ReportDefinition = normaliseDefinition({
    scope: Scopes.Client,
    preview: { householdId: "1", fromDate: "2025-01-01", toDate: "2025-12-31" },
    pages: [
      { id: "p1", title: "Cover", group: PageGroups.Front, locked: true, layout: "cover", heading: "{Report name}",
        blocks: [{ id: "b1", type: "text", variant: "header", title: "{Client}", text: "{Portfolio}\nReporting period {From date} – {To date}" }] },
      { id: "p2", title: "Performance", group: PageGroups.Portfolio, sectionLabel: "Section one", heading: "Performance" },
      { id: "p3", title: "Disclosures", group: PageGroups.Close, locked: true, sectionLabel: "Disclosures", heading: "Important information",
        blocks: ["PERF_GENERAL", "METHODOLOGY", "ILLUSTRATIVE"].map((c, i) => ({ id: `b${i + 2}`, type: "disclaimer", disclosureCode: c })) },
    ],
  });
  return transaction("app", async (run) => {
    const [row] = await run(`INSERT studio.Report (Name, Category, Description) VALUES (@Name, @Category, @Description);
      SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id;`, { Name: name.trim(), Category: category.trim(), Description: description });
    const id = row.id as number;
    await run(`INSERT studio.ReportVersion (ReportId, VersionNo, Status, DefinitionJson, CreatedBy, UpdatedBy)
      VALUES (@ReportId, 1, 'Draft', @Json, @User, @User)`, { ReportId: id, Json: JSON.stringify(definition), User: userId });
    return id;
  });
}

/** Saves into the working version (a Submitted one goes back to Draft); with none, creates the next Draft. */
export async function saveDraft(reportId: number, name: string, category: string, description: string | null, definition: ReportDefinition, userId: string) {
  await transaction("app", async (run) => {
    await run("UPDATE studio.Report SET Name = @Name, Category = @Category, Description = @Description WHERE ReportId = @ReportId",
      { ReportId: reportId, Name: name.trim(), Category: category.trim(), Description: description });
    const json = JSON.stringify(definition);
    const [updated] = await run(`
      UPDATE studio.ReportVersion
      SET DefinitionJson = @Json, Status = 'Draft', PreviewPassed = 0, UpdatedBy = @User, UpdatedOn = SYSUTCDATETIME(), SubmittedBy = NULL, SubmittedOn = NULL
      WHERE ReportId = @ReportId AND Status IN ('Draft', 'Submitted');
      SELECT @@ROWCOUNT AS N;`, { ReportId: reportId, Json: json, User: userId });
    if (!updated.n)
      await run(`INSERT studio.ReportVersion (ReportId, VersionNo, Status, DefinitionJson, CreatedBy, UpdatedBy)
        SELECT @ReportId, ISNULL(MAX(VersionNo), 0) + 1, 'Draft', @Json, @User, @User
        FROM studio.ReportVersion WITH (UPDLOCK, HOLDLOCK) WHERE ReportId = @ReportId`, { ReportId: reportId, Json: json, User: userId });
  });
}

export const setPreviewPassed = (versionId: number, passed: boolean) =>
  execute("app", "UPDATE studio.ReportVersion SET PreviewPassed = @Passed WHERE VersionId = @VersionId", { VersionId: versionId, Passed: passed });

export const submitVersion = (versionId: number, userId: string) => execute("app", `
  UPDATE studio.ReportVersion SET Status = 'Submitted', SubmittedBy = @User, SubmittedOn = SYSUTCDATETIME(),
         ReviewedBy = NULL, ReviewedOn = NULL, ReviewComment = NULL
  WHERE VersionId = @VersionId AND Status = 'Draft'`, { VersionId: versionId, User: userId });

export const publishVersion = (reportId: number, versionId: number, userId: string, comment: string | null) =>
  transaction("app", async (run) => {
    await run("UPDATE studio.ReportVersion SET Status = 'Retired' WHERE ReportId = @ReportId AND Status = 'Published'", { ReportId: reportId });
    await run(`UPDATE studio.ReportVersion SET Status = 'Published', ReviewedBy = @User, ReviewedOn = SYSUTCDATETIME(), ReviewComment = @Comment
      WHERE VersionId = @VersionId AND Status = 'Submitted'`, { VersionId: versionId, User: userId, Comment: comment });
  });

export const rejectVersion = (versionId: number, userId: string, comment: string) => execute("app", `
  UPDATE studio.ReportVersion SET Status = 'Draft', PreviewPassed = 0, ReviewedBy = @User, ReviewedOn = SYSUTCDATETIME(), ReviewComment = @Comment
  WHERE VersionId = @VersionId AND Status = 'Submitted'`, { VersionId: versionId, User: userId, Comment: comment });

/** Dropdowns for the designer's preview inputs; entities and accounts carry their household as parent. */
export function getLookup(type: string): Promise<LookupItem[]> {
  const sql: Record<string, string> = {
    household: "SELECT CAST(HouseholdId AS NVARCHAR(20)) AS Value, Name AS Label, CAST(NULL AS NVARCHAR(20)) AS Parent FROM src_client.Household ORDER BY Name",
    client: "SELECT CAST(ClientId AS NVARCHAR(20)) AS Value, Name AS Label, CAST(HouseholdId AS NVARCHAR(20)) AS Parent FROM src_client.Client ORDER BY Name",
    portfolio: `SELECT a.Code AS Value, CONCAT(a.Code, N' - ', a.Name, N' (', a.Currency, N')') AS Label, CAST(c.HouseholdId AS NVARCHAR(20)) AS Parent
                FROM src_client.Account a JOIN src_client.Client c ON c.ClientId = a.ClientId ORDER BY a.Code`,
  };
  return query<LookupItem>("app", sql[type.toLowerCase()]);
}
