import { sourceOf } from "./blockValidator";
import { ParameterValidationError } from "./errors";
import { BlockTypes, Scopes, Sources, type Block, type Catalog, type ReportInput, type RunParameters } from "./models";
import { toDate } from "./db";

/** Validated, typed run parameters. */
export interface BoundParameters {
  householdId: number | null;
  clientId: number | null;
  portfolioCode: string | null;
  from: Date | null;
  to: Date;
  /** First valuation date of the subject; set by the runner when needed. */
  dataStart?: Date | null;
}

const isDate = (v?: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(toDate(v).getTime());
const isInt = (v?: string | null) => !!v && /^\d+$/.test(v);

/** Checks the inputs the report needs and converts them. Throws ParameterValidationError. */
export function bindParameters(values: RunParameters, inputs: ReportInput[]): BoundParameters {
  const errors: Record<string, string[]> = {};
  const needs = (n: string) => inputs.some((i) => i.name === n);

  let householdId: number | null = null;
  if (needs("householdId")) {
    if (isInt(values.householdId)) householdId = Number(values.householdId);
    else errors.householdId = ["Choose a household."];
  }
  let clientId: number | null = null;
  if (needs("clientId") && values.clientId?.toString().trim()) {
    if (isInt(String(values.clientId))) clientId = Number(values.clientId);
    else errors.clientId = ["Choose an entity."];
  }
  let portfolioCode: string | null = null;
  if (needs("portfolioCode") && values.portfolioCode?.trim()) {
    portfolioCode = values.portfolioCode.trim();
    if (portfolioCode.length > 20) errors.portfolioCode = ["Choose an account."];
  }
  let from: Date | null = null;
  if (needs("fromDate")) {
    if (isDate(values.fromDate)) from = toDate(values.fromDate!);
    else errors.fromDate = ["Enter a from date (yyyy-MM-dd)."];
  }
  let to = new Date(0);
  if (needs("toDate")) {
    if (isDate(values.toDate)) to = toDate(values.toDate!);
    else errors.toDate = ["Enter a date (yyyy-MM-dd)."];
  }
  if (from && Object.keys(errors).length === 0 && from > to) errors.fromDate = ["From date must be on or before the to date."];
  if (Object.keys(errors).length) throw new ParameterValidationError(errors);
  return { householdId, clientId, portfolioCode, from, to };
}

/**
 * Works out which inputs a report needs: for Client scope the household (and optionally one entity or account)
 * when any block needs data, the to/as-of date, and a from date only when a block uses the report period for
 * performance figures (or its text refers to it).
 */
export function detectInputs(scope: string, blocks: Block[], catalog: Catalog): ReportInput[] {
  const data = blocks.filter((b) => b.type === BlockTypes.Data);
  const texts = blocks.map((b) => `${b.text ?? ""}${b.title ?? ""}`).join("");
  const needsSubject = data.length > 0 || texts.includes("{Portfolio}") || texts.includes("{Client}");
  const needsTo = data.length > 0 || texts.includes("{To date}") || texts.includes("{As of date}");
  const needsFrom = ["{From date}", "{Base date}", "{Period}"].some((p) => texts.includes(p))
    || data.some((b) => b.period === "report" && sourceOf(b, catalog) === Sources.Performance);

  const inputs: ReportInput[] = [];
  if (needsSubject && scope === Scopes.Client) {
    inputs.push({ name: "householdId", label: "Household", type: "household", optional: false });
    inputs.push({ name: "clientId", label: "Entity", type: "client", optional: true });
    inputs.push({ name: "portfolioCode", label: "Account", type: "portfolio", optional: true });
  }
  if (needsFrom) {
    inputs.push({ name: "fromDate", label: "From date", type: "date", optional: false });
    inputs.push({ name: "toDate", label: "To date", type: "date", optional: false });
  } else if (needsTo) {
    inputs.push({ name: "toDate", label: "As of date", type: "date", optional: false });
  }
  return inputs;
}
