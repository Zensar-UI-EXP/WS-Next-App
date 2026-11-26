import { query, queryMany } from "./db";
import { ALL_SCOPES, COMPARE_LABELS, PERIOD_LABELS, normaliseBlock, type Catalog, type CatalogDimension, type CatalogMeasure } from "./models";

const g = globalThis as unknown as { __wisCatalog?: Promise<Catalog> };

/** The approved catalogue (measures with methodology, group-bys, allowed pairs, modules), loaded once and cached. */
export function getCatalog(): Promise<Catalog> {
  g.__wisCatalog ??= load().catch((e) => { g.__wisCatalog = undefined; throw e; });
  return g.__wisCatalog;
}

async function load(): Promise<Catalog> {
  const [measures, dimensions, pairs, presets] = await queryMany("app", `
    SELECT MeasureKey, Label, Symbol, Format, Description, PerformanceExpr, HoldingsExpr, RequiresGroup, Cumulative,
           Methodology, MethodologyVersion, Owner, ApprovedOn, SortOrder
    FROM studio.CatalogMeasure WHERE IsActive = 1 ORDER BY SortOrder;
    SELECT DimensionKey, Label, Source, Expr, Format, IsTime, PeriodRows, SortOrder
    FROM studio.CatalogDimension WHERE IsActive = 1 ORDER BY SortOrder;
    SELECT MeasureKey, DimensionKey FROM studio.CatalogCombination;
    SELECT PresetKey, Label, Icon, Description, BlockJson FROM studio.BlockPreset ORDER BY SortOrder;`);
  const ms = measures as unknown as CatalogMeasure[];
  return {
    measures: ms,
    dimensions: dimensions as unknown as CatalogDimension[],
    combinations: Object.fromEntries(ms.map((m) => [m.measureKey,
      (pairs as { measureKey: string; dimensionKey: string }[]).filter((p) => p.measureKey === m.measureKey).map((p) => p.dimensionKey)])),
    presets: (presets as { presetKey: string; label: string; icon: string; description: string; blockJson: string }[]).map((p) => ({
      presetKey: p.presetKey, label: p.label, icon: p.icon, description: p.description, block: normaliseBlock(JSON.parse(p.blockJson)),
    })),
    periods: Object.entries(PERIOD_LABELS).map(([key, label]) => ({ key, label })),
    compares: Object.entries(COMPARE_LABELS).map(([key, label]) => ({ key, label })),
    scopes: [...ALL_SCOPES],
  };
}

/** The catalogue as sent to browsers: never the SQL expressions. */
export function publicCatalog(c: Catalog) {
  return { ...c, measures: c.measures.map(({ performanceExpr: _p, holdingsExpr: _h, ...m }) => m), dimensions: c.dimensions.map(({ expr: _e, ...d }) => d) };
}

export { query };
