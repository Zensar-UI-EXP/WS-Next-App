import { Check, Readiness, type ClientContext, type DataQualityExceptionRow, type DataReadiness, type ReadinessCheck } from "../models";
import { getExceptionsForSubject } from "../repos/governance";

const CHECKS: [string, string, string[]][] = [
  ["FRESHNESS", "Valuations are up to date", ["VAL_STALE"]],
  ["FX", "FX rates are available", ["FX_MISSING"]],
  ["COMPLETENESS", "No missing valuation days", ["VAL_GAP"]],
  ["PRICES", "No unusual price movements", ["PRICE_JUMP"]],
  ["RECONCILIATION", "Holdings reconcile to valuations", ["HOLD_RECON"]],
  ["REFERENCE", "Instruments are classified", ["REF_UNCLASSIFIED"]],
];

/**
 * Data Readiness Service (deterministic): is the data behind a subject and period complete, fresh and free of
 * exceptions? Open blockers stop release; blockers acknowledged by operations are accepted.
 */
export async function checkDataReadiness(context: ClientContext, clientId: number | null, portfolioCode: string | null, from: Date, to: Date): Promise<DataReadiness> {
  const exceptions = await getExceptionsForSubject(context.householdId, clientId, portfolioCode, from, to);
  const checks: ReadinessCheck[] = CHECKS.map(([code, label, rules]) => {
    const found = exceptions.filter((e) => rules.includes(e.ruleCode));
    const open = found.filter((e) => e.status === "Open");
    const acknowledged = found.filter((e) => e.status === "Acknowledged");
    const blocker = found.some((e) => e.severity === "Blocker");
    if (found.length === 0) return { code, label, status: Check.Passed, detail: "No exceptions in the period." };
    if (open.length) return { code, label, status: blocker ? Check.Blocker : Check.Warning, detail: describe(open, acknowledged.length) };
    return { code, label, status: blocker ? Check.Accepted : Check.Passed,
      detail: `${acknowledged.length} exception(s) acknowledged by operations: ${acknowledged[0].note ?? acknowledged[0].detail}` };
  });
  return {
    status: checks.some((c) => c.status === Check.Blocker) ? Readiness.Blocked
      : checks.some((c) => c.status === Check.Warning || c.status === Check.Accepted) ? Readiness.Warnings : Readiness.Ready,
    checks, exceptions,
  };
}

function describe(open: DataQualityExceptionRow[], acknowledged: number) {
  const text = open.length === 1 ? open[0].detail : `${open.length} open exceptions, e.g. ${open[0].detail}`;
  return acknowledged > 0 ? `${text} (${acknowledged} more acknowledged.)` : text;
}
