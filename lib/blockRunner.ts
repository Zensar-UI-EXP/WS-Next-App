import { getCatalog } from "./catalog";
import { config } from "./config";
import { readerQuery } from "./db";
import { BlockTypes, dataProductFor, includedBlocks, type Block, type BlockResult, type ReportDefinition } from "./models";
import type { BoundParameters } from "./params";
import { compile, scopeFilter, shape } from "./queryCompiler";
import { validateBlock } from "./blockValidator";

/**
 * Runs catalogue blocks as wis10_reader against the data products. Never calls the language model. A failing or
 * incomplete block returns its own issues or error without affecting the others.
 */
export async function runAll(definition: ReportDefinition, p: BoundParameters, includeSql: boolean, only?: Block[]): Promise<BlockResult[]> {
  await ensureDataStart(definition.scope, p);
  const blocks = only ?? includedBlocks(definition);
  const results: BlockResult[] = new Array(blocks.length);
  let next = 0;
  const worker = async () => {
    while (next < blocks.length) {
      const i = next++;
      results[i] = await runBlock(blocks[i], definition.scope, p, includeSql);
    }
  };
  await Promise.all(Array.from({ length: Math.min(config.query.maxParallelBlocks, blocks.length) }, worker));
  return results;
}

export async function runBlock(block: Block, scope: string, p: BoundParameters, includeSql: boolean): Promise<BlockResult> {
  const catalog = await getCatalog();
  const result: BlockResult = { blockId: block.id, columns: [], rows: [], issues: validateBlock(block, scope, catalog), error: null, sql: null, dataProduct: null };
  if (block.type !== BlockTypes.Data || result.issues.length) return result;
  try {
    await ensureDataStart(scope, p);
    const q = compile(block, scope, p, catalog, config.query.maxRows);
    if (includeSql) result.sql = q.sql;
    const rows = await readerQuery(q.sql, q.parameters);
    result.rows = shape(rows, q, block);
    result.columns = q.columns;
    result.dataProduct = dataProductFor(q.source);
  } catch (e) {
    const err = e as { number?: number; class?: number; message?: string; code?: string };
    console.warn(`Block ${block.id} failed: ${err.message}`);
    result.error = err.code === "ESOCKET" || err.code === "ELOGIN" ? "The database is not reachable." : err.message ?? "Failed.";
  }
  return result;
}

/** Looks up the subject's first valuation date once (standard periods start "since inception" there). */
async function ensureDataStart(scope: string, p: BoundParameters) {
  if (p.dataStart) return;
  const params = {};
  const filter = scopeFilter(scope, p, params);
  const rows = await readerQuery(`SELECT MIN(ValueDate) AS DataStart FROM dp.vw_AccountDailyPerformance WHERE ${filter}`, params);
  const start = rows[0]?.DataStart;
  if (typeof start === "string") p.dataStart = new Date(`${start}T00:00:00Z`);
}
