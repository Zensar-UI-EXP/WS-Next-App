import { asDate, query } from "../db";
import { StudioError } from "../errors";
import { Conditions, type ClientContext } from "../models";
import { getHouseholds } from "../repos/wealth";

/**
 * Client Context Service (deterministic): resolves the household, entity or account a report is about - entities,
 * accounts, mandates, currencies, structured products - and the conditions that decide conditional pages and disclosures.
 */
export async function buildContext(householdId: number, clientId: number | null, portfolioCode: string | null, to: Date): Promise<ClientContext> {
  const household = (await getHouseholds([householdId]))[0];
  if (!household) throw new StudioError(400, "Unknown household", `Household ${householdId} does not exist.`);
  let entities = household.entities;
  let accounts = household.accounts;
  let level = "Household", label = `${household.name} · whole household`, name = household.name;
  if (clientId != null) {
    const entity = entities.find((e) => e.clientId === clientId);
    if (!entity) throw new StudioError(400, "Unknown entity", `Entity ${clientId} is not part of ${household.name}.`);
    entities = [entity];
    accounts = accounts.filter((a) => a.clientId === clientId);
    [level, label, name] = ["Entity", `${entity.name} · all accounts`, entity.name];
  }
  if (portfolioCode) {
    const account = accounts.find((a) => a.code === portfolioCode);
    if (!account) throw new StudioError(400, "Unknown account", `${portfolioCode} is not one of the chosen client's accounts.`);
    accounts = [account];
    entities = entities.filter((e) => e.clientId === account.clientId);
    [level, label, name] = ["Account", `${account.name} (${account.code}, ${account.currency})`, entities[0].name];
  }

  // Accounts that exist by the end of the period are the ones reported on.
  const reported = accounts.filter((a) => a.inceptionDate <= to);
  const codes = reported.map((a) => a.code);
  const hasSpl = codes.length > 0 && ((await query<{ n: number }>("app",
    "SELECT COUNT(*) AS N FROM dp.fn_HoldingSnapshot(@To) WHERE PortfolioCode IN @Codes AND HoldingType = N'Structured product'",
    { To: asDate(to), Codes: codes }))[0]?.n ?? 0) > 0;

  const currencies = [...new Set(reported.map((a) => a.currency))].sort((a, b) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)));
  const mandates = [...new Set(entities.map((e) => e.mandate))].sort();
  const conditions: string[] = [];
  if (hasSpl) conditions.push(Conditions.StructuredProducts);
  if (currencies.some((c) => c !== "USD")) conditions.push(Conditions.MultiCurrency);
  if (mandates.includes("Advisory")) conditions.push(Conditions.Advisory);
  if (mandates.includes("Discretionary")) conditions.push(Conditions.Discretionary);

  const times = (xs: Date[]) => xs.map((d) => d.getTime());
  return {
    householdId: household.householdId, householdName: household.name, segment: household.segment, relationshipManager: household.relationshipManager,
    subjectLevel: level, subjectLabel: label, clientName: name, entities, accounts: reported, mandates,
    riskProfiles: [...new Set(entities.map((e) => e.riskProfile))].sort(), currencies, reportingCurrency: "USD",
    hasStructuredProducts: hasSpl, isMultiCurrency: currencies.some((c) => c !== "USD"), conditions,
    dataStart: reported.length ? new Date(Math.min(...times(reported.map((a) => a.inceptionDate)))) : household.dataStart ?? new Date(0),
    dataEnd: reported.length ? new Date(Math.max(...times(reported.map((a) => a.lastValuation ?? a.inceptionDate)))) : new Date(0),
  };
}
