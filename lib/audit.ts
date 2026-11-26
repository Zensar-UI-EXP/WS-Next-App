import { execute, query } from "./db";
import type { AppUser } from "./models";

/** Writes the append-only audit trail (gov.AuditEvent). A lost audit row is logged, never silently dropped. */
export async function audit(user: AppUser, action: string, entityType: string, entityId: string | number | null, summary: string, detail?: unknown) {
  try {
    await execute("app", `
      INSERT gov.AuditEvent (UserId, Role, Action, EntityType, EntityId, Summary, DetailJson)
      VALUES (@UserId, @Role, @Action, @EntityType, @EntityId, @Summary, @Detail)`, {
      UserId: user.userId, Role: user.role, Action: action, EntityType: entityType,
      EntityId: entityId === null ? null : String(entityId), Summary: summary.slice(0, 400),
      Detail: detail === undefined ? null : JSON.stringify(detail),
    });
  } catch (e) {
    console.error(`Could not write audit event ${action} for ${entityType} ${entityId}`, e);
  }
}

export async function listAudit(entityType: string | null, entityId: string | null, take: number) {
  const rows = await query<Record<string, unknown>>("app", `
    SELECT TOP (@Take) AuditId, OccurredOn, UserId, Role, Action, EntityType, EntityId, Summary, DetailJson
    FROM gov.AuditEvent
    WHERE (@EntityType IS NULL OR EntityType = @EntityType) AND (@EntityId IS NULL OR EntityId = @EntityId)
    ORDER BY AuditId DESC`, { Take: Math.min(Math.max(take, 1), 500), EntityType: entityType, EntityId: entityId });
  return rows.map((r) => ({ ...r, auditId: Number(r.auditId) }));
}
