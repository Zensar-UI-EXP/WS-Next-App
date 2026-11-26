import type { ReportDefinition } from "../models";
import type { ReportingApi } from "../reporting/api";

/** What one agent run knows: the Reporting API for the signed-in user, and what the agents have handed over so far. */
export interface RunState {
  reportId: number;
  request: string;
  api: ReportingApi;
  findings: PerformanceFindings | null;
  report: { title: string; definition: ReportDefinition } | null;
  completed: { message: string } | null;
  /** A change request: the version being changed. */
  previous: { version: number; title: string; definition: ReportDefinition } | null;
  /** The reusable definition the user asked to start from. */
  startFrom: { definitionId: number; name: string; definition: ReportDefinition } | null;
}

export interface PerformanceFindings {
  summary: string;
  findings: { headline: string; detail: string; significance: "material" | "notable" | "info" }[];
  dataStatus: string;
  asOfDate: string;
  coverage: string;
  suggestedContent: string[];
}
