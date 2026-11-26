import sql from "mssql";
import { config } from "./config";

/**
 * Two connection pools, as in v3: "reader" (wis10_reader) can read the data products only and runs every report
 * query; "app" (wis10_app) reads and writes the studio and governance tables. Pools live on globalThis so Next.js
 * hot reload does not open new ones.
 */
type Kind = "app" | "reader";
const g = globalThis as unknown as { __wisPools?: Partial<Record<Kind, Promise<sql.ConnectionPool>>> };
g.__wisPools ??= {};

function pool(kind: Kind): Promise<sql.ConnectionPool> {
  const pools = g.__wisPools!;
  if (!pools[kind]) {
    const login = kind === "app" ? config.db.app : config.db.reader;
    const p = new sql.ConnectionPool({
      server: config.db.server, port: config.db.port, database: config.db.database,
      user: login.user, password: login.password,
      options: { encrypt: true, trustServerCertificate: true, useUTC: true, appName: kind === "app" ? "WealthInsights.Web" : "WealthInsights.Web.ReadOnly" },
      requestTimeout: config.query.timeoutSeconds * 1000,
      pool: { max: 10 },
    }).connect();
    p.catch(() => { delete pools[kind]; });
    pools[kind] = p;
  }
  return pools[kind]!;
}

/** A parameter with an explicit SQL type; plain values are typed from their JS type. */
export interface Typed { type: sql.ISqlTypeFactory | sql.ISqlType; value: unknown }
export const asDate = (value: Date | string | null): Typed => ({ type: sql.Date, value: value === null ? null : toDate(value) });
export const asText = (value: string | null): Typed => ({ type: sql.NVarChar(sql.MAX), value });
export const asFloat = (value: number): Typed => ({ type: sql.Float, value });
export type Params = Record<string, unknown>;

/** "2025-12-31" → Date at UTC midnight. */
export function toDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function bind(request: sql.Request, text: string, params: Params): string {
  for (const [name, value] of Object.entries(params)) {
    const key = name.replace(/^@/, "");
    if (Array.isArray(value)) {
      // IN lists: @Codes → (@Codes0, @Codes1, ...); an empty list matches nothing.
      const names = value.map((_, i) => `@${key}${i}`);
      value.forEach((v, i) => addInput(request, `${key}${i}`, v));
      text = text.replace(new RegExp(`@${key}\\b`, "g"), names.length ? `(${names.join(", ")})` : "(NULL)");
      continue;
    }
    if (!new RegExp(`@${key}\\b`, "i").test(text)) continue;   // pass only the parameters the query uses
    addInput(request, key, value);
  }
  return text;
}

function addInput(request: sql.Request, name: string, value: unknown) {
  if (value && typeof value === "object" && "type" in (value as object) && "value" in (value as object)) {
    const t = value as Typed;
    request.input(name, t.type as sql.ISqlType, t.value);
  } else if (typeof value === "number") {
    request.input(name, Number.isInteger(value) && Math.abs(value) < 2 ** 31 ? sql.Int : sql.Float, value);
  } else if (typeof value === "boolean") {
    request.input(name, sql.Bit, value);
  } else if (value instanceof Date) {
    request.input(name, sql.DateTime2, value);
  } else {
    const text = value === null || value === undefined ? null : String(value);
    request.input(name, text !== null && text.length > 4000 ? sql.NVarChar(sql.MAX) : sql.NVarChar(4000), text);
  }
}

/** PascalCase SQL column names → camelCase JSON properties (as ASP.NET did). */
export function camel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k.charAt(0).toLowerCase() + k.slice(1)] = v;
  return out as T;
}

/** Every result set of the batch, rows with camelCase keys. */
export async function queryMany(kind: Kind, text: string, params: Params = {}): Promise<Record<string, unknown>[][]> {
  const request = (await pool(kind)).request();
  const result = await request.query(bind(request, text, params));
  return (result.recordsets as unknown as Record<string, unknown>[][]).map((set) => set.map((r) => camel(r)));
}

export async function query<T>(kind: Kind, text: string, params: Params = {}): Promise<T[]> {
  return ((await queryMany(kind, text, params))[0] ?? []) as T[];
}

export async function queryOne<T>(kind: Kind, text: string, params: Params = {}): Promise<T | null> {
  return (await query<T>(kind, text, params))[0] ?? null;
}

/** Runs a statement; returns the total rows affected. */
export async function execute(kind: Kind, text: string, params: Params = {}): Promise<number> {
  const request = (await pool(kind)).request();
  const result = await request.query(bind(request, text, params));
  return result.rowsAffected.reduce((a, b) => a + b, 0);
}

/** Runs several statements in one transaction. */
export async function transaction<T>(kind: Kind, work: (run: (text: string, params?: Params) => Promise<Record<string, unknown>[]>) => Promise<T>): Promise<T> {
  const tx = new sql.Transaction(await pool(kind));
  await tx.begin();
  try {
    const value = await work(async (text, params = {}) => {
      const request = new sql.Request(tx);
      const result = await request.query(bind(request, text, params));
      return (result.recordset ?? []).map((r: Record<string, unknown>) => camel(r));
    });
    await tx.commit();
    return value;
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

/** Report queries as wis10_reader: raw column names kept (catalogue keys), dates as yyyy-MM-dd, row cap. */
export async function readerQuery(text: string, params: Params): Promise<Record<string, unknown>[]> {
  const request = (await pool("reader")).request();
  const result = await request.query(bind(request, text, params));
  return (result.recordset ?? []).slice(0, config.query.maxRows).map((r: Record<string, unknown>) => {
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) row[k] = v instanceof Date ? isoDate(v) : v;
    return row;
  });
}

export { sql };
