import { authorise, problem, toResponse } from "@/lib/http/http";
import { routes } from "@/lib/http/routes";

// The whole API (same URLs as v3) behind one route handler; lib/http/routes.ts holds the endpoints.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  const matches = routes.filter((r) => r.pattern.test(path));
  const route = matches.find((r) => r.method === req.method);
  if (!route) return matches.length ? problem(405, "Method not allowed") : problem(404, "Not found", `No endpoint /api/${path}.`);
  try {
    const auth = await authorise(req, route.roles);
    if (auth instanceof Response) {
      // GET /api/users needs no user (the POC's user picker).
      if (route.roles !== null) return auth;
    }
    const m = path.match(route.pattern)!;
    const result = await route.handler({
      req,
      params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])),
      query: new URL(req.url).searchParams,
      user: auth instanceof Response ? (null as never) : auth,
      body: async (schema) => {
        const text = await req.text();
        const json = text ? JSON.parse(text) : {};
        return schema ? schema.parse(json) : json;
      },
    });
    return result instanceof Response ? result : Response.json(result ?? null);
  } catch (e) {
    return toResponse(e);
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
