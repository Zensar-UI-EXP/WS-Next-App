import type { ClientReportSummary } from "./models";
import type { BoundParameters } from "./params";

/** A client report's run parameters. */
export const bindReport = (r: ClientReportSummary): BoundParameters => ({
  householdId: r.householdId, clientId: r.clientId, portfolioCode: r.portfolioCode, from: r.fromDate, to: r.toDate,
});
