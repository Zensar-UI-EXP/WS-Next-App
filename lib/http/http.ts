import { z } from "zod";
import { ParameterValidationError, StudioError } from "../errors";
import type { AppUser } from "../models";
import { findUser } from "../users";

export type Handler = (ctx: Ctx) => Promise<unknown>;
export interface Ctx {
  req: Request;
  params: Record<string, string>;
  query: URLSearchParams;
  user: AppUser;
  body: <T>(schema?: z.ZodType<T>) => Promise<T>;
}

/** RFC 7807 ProblemDetails, as the .NET API returned. */
export const problem = (status: number, title: string, detail?: string, errors?: Record<string, string[]>) =>
  Response.json({ type: `https://httpstatuses.io/${status}`, title, status, detail, ...(errors ? { errors } : {}) },
    { status, headers: { "Content-Type": "application/problem+json" } });

/** POC only, no SSO: the caller names a user in X-User. Unknown user → 401; role not allowed → 403. */
export async function authorise(req: Request, roles: string[] | null): Promise<AppUser | Response> {
  const user = await findUser(req.headers.get("x-user"));
  if (!user) return problem(401, "Sign-in required", "Send header X-User with a user id (see GET /api/users).");
  if (roles && !roles.includes(user.role)) return problem(403, "Forbidden", `${user.name} (${user.role}) cannot use this.`);
  return user;
}

export function toResponse(error: unknown): Response {
  if (error instanceof StudioError) return problem(error.status, error.title, error.message);
  if (error instanceof ParameterValidationError) return problem(400, "One or more parameters are invalid.", undefined, error.errors);
  if (error instanceof z.ZodError)
    return problem(400, "Invalid request", undefined, Object.fromEntries(error.issues.map((i) => [i.path.join(".") || "body", [i.message]])));
  const e = error as { code?: string; number?: number; message?: string };
  if (e?.code === "ELOGIN" || e?.code === "ESOCKET" || e?.code === "ETIMEOUT")
    return problem(503, "Database unavailable", "The server cannot connect to WealthInsightsV10Db. Check that SQL Server is running and .env.local is set.");
  console.error(error);
  return problem(500, "An error occurred while processing your request.", e?.message);
}
