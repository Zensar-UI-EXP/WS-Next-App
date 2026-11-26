// Shared types and constants: the TypeScript form of the v3 C# models. JSON on the wire is camelCase.
import { normaliseCover, type CoverSettings } from "./cover";

// ---------- definitions (templates and client reports) ----------

export const Scopes = { Client: "Client", Firm: "Firm" } as const;
export const ALL_SCOPES: string[] = [Scopes.Client, Scopes.Firm];

export const PageGroups = { Front: "Front matter", Portfolio: "Portfolio pages", Close: "Commentary & close" } as const;
export const ALL_PAGE_GROUPS: string[] = Object.values(PageGroups);
export const ALL_PAGE_LAYOUTS = ["standard", "kpi", "cover", "letter"];

/** Client-context conditions a page or disclaimer can depend on (set by the Client Context Service). */
export const Conditions = {
  StructuredProducts: "StructuredProducts", MultiCurrency: "MultiCurrency", Advisory: "Advisory", Discretionary: "Discretionary",
} as const;
export const ALL_CONDITIONS: string[] = Object.values(Conditions);

export const BlockTypes = { Text: "text", Disclaimer: "disclaimer", Data: "data" } as const;
export const ALL_BLOCK_TYPES: string[] = Object.values(BlockTypes);

export const TextOrigins = {
  Template: "template", NarrativeAgent: "narrative-agent", AskStudio: "ask-studio", WealthManager: "wealth-manager", ReportingAgent: "reporting-agent",
} as const;
export const isAiOrigin = (origin?: string | null) =>
  origin === TextOrigins.NarrativeAgent || origin === TextOrigins.AskStudio || origin === TextOrigins.ReportingAgent;

export const Displays = { Kpi: "kpi", List: "list", Bar: "bar", Line: "line", Pie: "pie", Table: "table" } as const;
export const ALL_DISPLAYS: string[] = Object.values(Displays);
export const isTotalsDisplay = (d: string) => d === Displays.Kpi || d === Displays.List;

export const PERIOD_LABELS: Record<string, string> = {
  report: "Report period", qtd: "Quarter to date", ytd: "Year to date", "1y": "Last 12 months", "3y": "Last 3 years", inception: "Since inception",
};
export const COMPARE_LABELS: Record<string, string> = { none: "None", previous_quarter: "Previous quarter", previous_year: "Previous year" };
export const ALL_SORTS = ["value_desc", "value_asc", "label_asc"];

export interface RunParameters {
  householdId?: string | null;
  clientId?: string | null;
  portfolioCode?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
}

export interface PageStyle { typeface: string; bodySize: number; lineHeight: number }
export interface Branding { accent: string; showLogo: boolean }

export interface Block {
  id: string;
  type: string;
  width: string;
  title: string;
  text?: string | null;
  variant?: string | null;
  /** Text: the brief the Narrative Agent drafts this block from. */
  narrative?: string | null;
  /** Text: template, narrative-agent, ask-studio or wealth-manager. */
  origin?: string | null;
  /** Disclaimer: the src_content.Disclosure code. */
  disclosureCode?: string | null;
  /** Disclaimer: applies only when the client context meets this condition. */
  condition?: string | null;
  display: string;
  measures: string[];
  groupBy: string[];
  period: string;
  compare: string;
  topN?: number | null;
  sort: string;
  labels?: Record<string, string> | null;
}

export interface Page {
  id: string;
  title: string;
  group: string;
  locked: boolean;
  included: boolean;
  condition?: string | null;
  sectionLabel: string;
  heading: string;
  layout: string;
  style: PageStyle;
  blocks: Block[];
}

export interface ReportDefinition {
  scope: string;
  preview: RunParameters;
  pages: Page[];
  branding: Branding;
  /** V7: the cover settings (lib/cover.ts); null keeps the plain cover page. */
  cover?: CoverSettings | null;
}

/** Fills the defaults the C# model had, so stored or posted JSON can be partial. */
export function normaliseDefinition(raw: unknown): ReportDefinition {
  const d = (raw ?? {}) as Partial<ReportDefinition>;
  return {
    scope: d.scope ?? Scopes.Client,
    preview: d.preview ?? {},
    branding: { accent: "navy", showLogo: true, ...(d.branding ?? {}) },
    cover: normaliseCover(d.cover),
    pages: (d.pages ?? []).map((p) => ({
      id: p.id ?? "", title: p.title ?? "", group: p.group ?? PageGroups.Portfolio, locked: p.locked ?? false,
      included: p.included ?? true, condition: p.condition ?? null, sectionLabel: p.sectionLabel ?? "", heading: p.heading ?? "",
      layout: p.layout ?? "standard", style: Object.assign({ typeface: "serif", bodySize: 10, lineHeight: 1.5 }, p.style),
      blocks: (p.blocks ?? []).map(normaliseBlock),
    })),
  };
}

export function normaliseBlock(raw: unknown): Block {
  const b = (raw ?? {}) as Partial<Block>;
  return {
    id: b.id ?? "", type: b.type ?? BlockTypes.Data, width: b.width ?? "full", title: b.title ?? "",
    text: b.text ?? null, variant: b.variant ?? null, narrative: b.narrative ?? null, origin: b.origin ?? null,
    disclosureCode: b.disclosureCode ?? null, condition: b.condition ?? null,
    display: b.display ?? Displays.Bar, measures: b.measures ?? [], groupBy: b.groupBy ?? [], period: b.period ?? "report",
    compare: b.compare ?? "none", topN: b.topN ?? null, sort: b.sort ?? "value_desc", labels: b.labels ?? null,
  };
}

export const allBlocks = (d: ReportDefinition) => d.pages.flatMap((p) => p.blocks);
export const includedBlocks = (d: ReportDefinition) => d.pages.filter((p) => p.included).flatMap((p) => p.blocks);

/** Deep copy through JSON (definitions are plain data). */
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// ---------- catalogue ----------

export const Sources = { Performance: "Performance", Holdings: "Holdings", Exposure: "Exposure" } as const;
export const isSnapshotSource = (s: string) => s === Sources.Holdings || s === Sources.Exposure;
export const dataProductFor = (s: string) =>
  s === Sources.Holdings ? "dp.fn_HoldingSnapshot" : s === Sources.Exposure ? "dp.fn_ExposureSnapshot" : "dp.vw_AccountDailyPerformance";

export interface CatalogMeasure {
  measureKey: string; label: string; symbol: string; format: string; description: string;
  performanceExpr: string | null; holdingsExpr: string | null; requiresGroup: boolean; cumulative: boolean;
  methodology: string; methodologyVersion: string; owner: string; approvedOn: Date; sortOrder: number;
}
export interface CatalogDimension {
  dimensionKey: string; label: string; source: string; expr: string; format: string; isTime: boolean; periodRows: boolean; sortOrder: number;
}
export interface BlockPreset { presetKey: string; label: string; icon: string; description: string; block: Block }
export interface Catalog {
  measures: CatalogMeasure[];
  dimensions: CatalogDimension[];
  combinations: Record<string, string[]>;
  presets: BlockPreset[];
  periods: { key: string; label: string }[];
  compares: { key: string; label: string }[];
  scopes: string[];
}
export const measureOf = (c: Catalog, key: string) => c.measures.find((m) => m.measureKey === key);
export const dimensionOf = (c: Catalog, key: string) => c.dimensions.find((d) => d.dimensionKey === key);
export const canCombine = (c: Catalog, m: string, d: string) => (c.combinations[m] ?? []).includes(d);
export const exprFor = (m: CatalogMeasure, source: string) => (isSnapshotSource(source) ? m.holdingsExpr : m.performanceExpr);

// ---------- results ----------

export interface ResultColumn { name: string; label: string; format: string; role: "dimension" | "series" | "measure" }
export interface BlockResult {
  blockId: string;
  columns: ResultColumn[];
  rows: Record<string, unknown>[];
  issues: string[];
  error: string | null;
  sql: string | null;
  dataProduct: string | null;
}
export interface ReportInput { name: string; label: string; type: string; optional: boolean }
export interface LookupItem { value: string; label: string; parent: string | null }

// ---------- people and wealth ----------

export const Roles = { Designer: "Designer", Approver: "Approver", Advisor: "Advisor", Operations: "Operations", Client: "Client" } as const;

export interface AppUser { userId: string; name: string; title: string; role: string; householdId: number | null; households: number[] }

export interface EntityProfile { clientId: number; householdId: number; name: string; clientType: string; riskProfile: string; mandate: string; marketValue: number }
export interface AccountProfile {
  code: string; name: string; clientId: number; householdId: number; currency: string; benchmark: string;
  inceptionDate: Date; lastValuation: Date | null; marketValue: number;
}
export interface HouseholdProfile {
  householdId: number; name: string; segment: string; relationshipManager: string; reviewFrequency: string; nextReviewDate: Date;
  marketValue: number; dataStart: Date | null; entities: EntityProfile[]; accounts: AccountProfile[];
}

export const PERIOD_KEYS = ["FY", "H1", "H2", "Q1", "Q2", "Q3", "Q4", "SI"];
export const ReportStatus = { Draft: "Draft", InReview: "InReview", Published: "Published" } as const;

export interface OrchestrationRunSummary {
  runId: number; clientReportId: number; kind: string; status: string; startedBy: string;
  startedOn: Date; finishedOn: Date | null; summary: string | null;
}
export interface OrchestrationStep {
  stepNo: number; stepKey: string; name: string; kind: string; status: string;
  startedOn: Date | null; finishedOn: Date | null; summary: string | null; output: unknown;
}
export interface OrchestrationRun extends OrchestrationRunSummary { steps: OrchestrationStep[] }

export interface ClientReportSummary {
  clientReportId: number; reportId: number; templateName: string; versionNo: number; householdId: number; householdName: string;
  clientId: number | null; clientName: string | null; portfolioCode: string | null; subjectLabel: string;
  periodYear: number; periodKey: string; periodLabel: string; fromDate: Date; toDate: Date; outputFormat: string; status: string;
  createdBy: string; createdOn: Date; updatedBy: string; updatedOn: Date; submittedBy: string | null; submittedOn: Date | null;
  reviewedBy: string | null; reviewedOn: Date | null; reviewComment: string | null; publishedOn: Date | null;
  readinessStatus: string | null; latestRun: OrchestrationRunSummary | null;
}
export interface ClientReportDetail extends ClientReportSummary {
  definition: ReportDefinition;
  parameters: RunParameters;
  lockedPageIds: string[];
  context: ClientContext | null;
  insights: InsightSet | null;
  readiness: ReleaseReadiness | null;
}

// ---------- orchestration outputs ----------

export interface ClientContext {
  householdId: number; householdName: string; segment: string; relationshipManager: string;
  subjectLevel: string; subjectLabel: string; clientName: string;
  entities: EntityProfile[]; accounts: AccountProfile[]; mandates: string[]; riskProfiles: string[]; currencies: string[];
  reportingCurrency: string; hasStructuredProducts: boolean; isMultiCurrency: boolean; conditions: string[];
  dataStart: Date; dataEnd: Date;
}

export const Readiness = { Ready: "Ready", Warnings: "Warnings", Blocked: "Blocked" } as const;
export const Check = { Passed: "Passed", Warning: "Warning", Blocker: "Blocker", Accepted: "Accepted" } as const;
export interface ReadinessCheck { code: string; label: string; status: string; detail: string }
export interface DataReadiness { status: string; checks: ReadinessCheck[]; exceptions: DataQualityExceptionRow[] }
export interface Fact { key: string; label: string; value: number | null; format: string; text: string }
export interface Insight { code: string; severity: "info" | "notable" | "material"; title: string; detail: string }
export interface InsightSet { facts: Fact[]; insights: Insight[]; comparisonLabel: string }
export interface ReleaseReadiness { status: string; checks: ReadinessCheck[]; checkedOn: Date }

export const RunKinds = { Draft: "Draft", Release: "Release" } as const;
export const RunStatus = { Running: "Running", Completed: "Completed", Blocked: "Blocked", Failed: "Failed" } as const;
export const StepStatus = { Pending: "Pending", Running: "Running", Passed: "Passed", Warning: "Warning", Failed: "Failed", Skipped: "Skipped" } as const;

// ---------- governance ----------

export const EXCEPTION_STATUSES = ["Open", "Acknowledged", "Resolved"];
export interface DataQualityExceptionRow {
  exceptionId: number; ruleCode: string; ruleName: string; severity: string; portfolioCode: string | null; householdName: string | null;
  instrumentName: string | null; asOfDate: Date; detail: string; status: string; detectedOn: Date;
  updatedBy: string | null; updatedOn: Date | null; note: string | null;
}
export interface DisclosureRow {
  disclosureCode: string; title: string; text: string; appliesWhen: string; version: number; effectiveFrom: Date; owner: string;
}
