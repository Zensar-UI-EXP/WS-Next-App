import { normaliseCover, type CoverSettings } from "../cover";
import { execute, query, queryOne, transaction } from "../db";
import { StudioError } from "../errors";

/** Cover templates (studio.CoverTemplate*): a designer drafts and submits, compliance approves or returns. */
export interface CoverTemplateVersion {
  versionId: number; version: number; status: string; settings: CoverSettings; createdBy: string; createdOn: Date;
  submittedBy: string | null; submittedOn: Date | null; reviewedBy: string | null; reviewedOn: Date | null; reviewComment: string | null;
}
export interface CoverTemplate {
  coverTemplateId: number; name: string; segment: string; description: string;
  approved: CoverTemplateVersion | null; working: CoverTemplateVersion | null;
}

export const SEGMENTS = ["All", "Private client", "Family office", "Corporate"];

export async function listCoverTemplates(): Promise<CoverTemplate[]> {
  const rows = await query<Record<string, unknown>>("app", `
    SELECT t.CoverTemplateId, t.Name, t.Segment, t.Description, v.VersionId, v.Version, v.Status, v.SettingsJson, v.CreatedBy, v.CreatedOn,
           v.SubmittedBy, v.SubmittedOn, v.ReviewedBy, v.ReviewedOn, v.ReviewComment
    FROM studio.CoverTemplate t JOIN studio.CoverTemplateVersion v ON v.CoverTemplateId = t.CoverTemplateId AND v.Status <> N'Retired'
    ORDER BY t.Name, v.Version`);
  const map = new Map<number, CoverTemplate>();
  for (const r of rows) {
    const id = r.coverTemplateId as number;
    if (!map.has(id)) map.set(id, { coverTemplateId: id, name: r.name as string, segment: r.segment as string, description: r.description as string, approved: null, working: null });
    const v: CoverTemplateVersion = {
      versionId: r.versionId as number, version: r.version as number, status: r.status as string,
      settings: { ...normaliseCover(JSON.parse(r.settingsJson as string))!, templateId: id, templateVersion: r.version as number, templateName: r.name as string },
      createdBy: r.createdBy as string, createdOn: r.createdOn as Date, submittedBy: r.submittedBy as string | null, submittedOn: r.submittedOn as Date | null,
      reviewedBy: r.reviewedBy as string | null, reviewedOn: r.reviewedOn as Date | null, reviewComment: r.reviewComment as string | null,
    };
    if (v.status === "Approved") map.get(id)!.approved = v; else map.get(id)!.working = v;
  }
  return [...map.values()];
}

export async function approvedCovers() {
  return (await listCoverTemplates()).filter((t) => t.approved).map((t) => ({
    coverTemplateId: t.coverTemplateId, version: t.approved!.version, name: t.name, segment: t.segment, description: t.description, settings: t.approved!.settings,
  }));
}

/** Saves the designer's draft: a new template, or a new working version of an existing one. */
export async function saveCoverDraft(id: number | null, d: { name: string; segment: string; description: string; settings: unknown }, userId: string) {
  const { templateId: _t, templateVersion: _v, templateName: _n, ...settings } = normaliseCover(d.settings) ?? normaliseCover({})!;
  const json = JSON.stringify(settings);
  return transaction("app", async (run) => {
    let templateId = id;
    if (templateId == null) {
      const [row] = await run(`INSERT studio.CoverTemplate (Name, Segment, Description) VALUES (@Name, @Segment, @Description);
        SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id;`, { Name: d.name, Segment: d.segment, Description: d.description });
      templateId = row.id as number;
    } else {
      await run("UPDATE studio.CoverTemplate SET Name = @Name, Segment = @Segment, Description = @Description WHERE CoverTemplateId = @Id",
        { Id: templateId, Name: d.name, Segment: d.segment, Description: d.description });
    }
    const [working] = await run("SELECT VersionId, Status FROM studio.CoverTemplateVersion WHERE CoverTemplateId = @Id AND Status IN (N'Draft', N'Submitted')", { Id: templateId });
    if (working?.status === "Submitted") throw new StudioError(409, "With compliance", "This cover is waiting for approval; it can change again if compliance returns it.");
    if (working) await run("UPDATE studio.CoverTemplateVersion SET SettingsJson = @Json WHERE VersionId = @V", { V: working.versionId, Json: json });
    else await run(`INSERT studio.CoverTemplateVersion (CoverTemplateId, Version, Status, SettingsJson, CreatedBy)
      SELECT @Id, ISNULL(MAX(Version), 0) + 1, N'Draft', @Json, @User FROM studio.CoverTemplateVersion WHERE CoverTemplateId = @Id`, { Id: templateId, Json: json, User: userId });
    return templateId;
  });
}

export async function submitCover(id: number, userId: string) {
  const n = await execute("app", `UPDATE studio.CoverTemplateVersion SET Status = N'Submitted', SubmittedBy = @User, SubmittedOn = SYSUTCDATETIME()
    WHERE CoverTemplateId = @Id AND Status = N'Draft'`, { Id: id, User: userId });
  if (!n) throw new StudioError(409, "Nothing to submit", "There is no draft of this cover.");
}

/** Compliance decision. Approving retires the version clients' reports were made from until now; those reports keep theirs. */
export async function decideCover(id: number, approve: boolean, comment: string | null, userId: string) {
  const working = await queryOne<{ versionId: number; submittedBy: string }>("app",
    "SELECT VersionId, SubmittedBy FROM studio.CoverTemplateVersion WHERE CoverTemplateId = @Id AND Status = N'Submitted'", { Id: id });
  if (!working) throw new StudioError(409, "Not submitted", "This cover is not waiting for approval.");
  if (working.submittedBy === userId) throw new StudioError(403, "Segregation of duties", "You cannot approve a cover you submitted.");
  await transaction("app", async (run) => {
    if (approve) await run("UPDATE studio.CoverTemplateVersion SET Status = N'Retired' WHERE CoverTemplateId = @Id AND Status = N'Approved'", { Id: id });
    await run(`UPDATE studio.CoverTemplateVersion SET Status = @Status, ReviewedBy = @User, ReviewedOn = SYSUTCDATETIME(), ReviewComment = @Comment
      WHERE VersionId = @V`, { V: working.versionId, Status: approve ? "Approved" : "Draft", User: userId, Comment: comment });
  });
}
