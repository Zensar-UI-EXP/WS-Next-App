import { queryMany } from "./db";
import { Roles, type AppUser } from "./models";

const g = globalThis as unknown as { __wisUsers?: Promise<Map<string, AppUser>> };

/**
 * Users, roles and household entitlements, cached. POC without SSO: the caller names the user in the X-User header;
 * in the target architecture WealthSpan would pass the identity.
 */
async function load(): Promise<Map<string, AppUser>> {
  const [users, ents] = await queryMany("app", `
    SELECT UserId, Name, Title, Role, HouseholdId FROM studio.AppUser ORDER BY Role, Name;
    SELECT UserId, HouseholdId FROM studio.Entitlement;`);
  const map = new Map<string, AppUser>();
  for (const u of users as unknown as AppUser[]) {
    u.households = (ents as { userId: string; householdId: number }[]).filter((e) => e.userId === u.userId).map((e) => e.householdId);
    map.set(u.userId.toLowerCase(), u);
  }
  return map;
}

function users() {
  g.__wisUsers ??= load().catch((e) => { g.__wisUsers = undefined; throw e; });
  return g.__wisUsers;
}

export const allUsers = async () => [...(await users()).values()];
export const findUser = async (id?: string | null) => (id ? (await users()).get(id.toLowerCase()) ?? null : null);

/** Can this user see the household's data? Approvers and operations see all; clients only their own. */
export function canSeeHousehold(user: AppUser, householdId: number): boolean {
  if (user.role === Roles.Advisor) return user.households.includes(householdId);
  if (user.role === Roles.Client) return user.householdId === householdId;
  return true;
}
