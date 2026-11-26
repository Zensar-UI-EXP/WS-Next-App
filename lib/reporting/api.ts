import { runBlock } from "../blockRunner";
import { validateBlock } from "../blockValidator";
import { getCatalog } from "../catalog";
import { asDate, execute, isoDate } from "../db";
import { StudioError } from "../errors";
import {
  BlockTypes, Roles, Scopes, allBlocks, includedBlocks, normaliseBlock, normaliseDefinition,
  type AppUser, type Block, type BlockResult, type ClientContext, type DataReadiness, type Fact, type ReportDefinition,
} from "../models";
import { buildContext } from "../orchestration/clientContext";
import { checkDataReadiness } from "../orchestration/dataReadiness";
import { factsFromResults } from "../orchestration/facts";
import { allowedNumbers, unverifiedNumbers } from "../orchestration/numberCheck";
import type { BoundParameters } from "../params";
import { getDisclosures } from "../repos/content";
import { canSeeHousehold } from "../users";
import { FIGURE_SETS, findPublished, isPublishedPeriod, setBlock } from "./published";
import { getAsOfDate } from "../repos/wealth";
import { coverIssues, coverTexts } from "../cover";
import { approvedCovers } from "../repos/covers";

/**
 * Reporting API (governed tools). Every call runs for the signed-in user: it checks their entitlement to the household
 * and is logged (studio.ReportingApiCall) with the agent acting for them. Closed standard periods read the published
 * figures; partial and custom periods use the calculation library. Nobody - user or agent - sees SQL, and every figure
 * returned is kept as a verified fact with its source.
 */
export type Source = "published" | "calculated";

/** A request the Reporting API refuses; the reason goes back to the caller (an agent reads it as a tool error). */
const rejected = (reason: string) => new StudioError(422, "Rejected by the Reporting API", reason);
export type SourcedResult = BlockResult & { source: Source; publishedOn?: Date };
export type SourcedFact = Fact & { source: Source };

export interface Subject { householdId: number; clientId: number | null; portfolioCode: string | null; from: Date; to: Date; periodKey: string; periodYear: number | null }

export class ReportingApi {
  private context: ClientContext | null = null;
  private readiness: DataReadiness | null = null;
  private asOf: Date | null = null;
  private queries = 0;
  readonly facts: SourcedFact[] = [];

  constructor(readonly user: AppUser, readonly subject: Subject, readonly agentReportId: number | null = null, facts: SourcedFact[] = []) {
    this.facts.push(...facts);
  }

  /** The client segment (Private client, Family office, Corporate), once the context is loaded. */
  get segment() { return this.context?.segment ?? null; }

  get params(): BoundParameters & { from: Date } {
    const s = this.subject;
    return { householdId: s.householdId, clientId: s.clientId, portfolioCode: s.portfolioCode, from: s.from, to: s.to };
  }

  /** Signed-in user access: only wealth managers, only for households they are entitled to. Logs every call. */
  private async call<T>(agent: string | null, endpoint: string, work: () => Promise<{ value: T; source?: Source; detail?: string; figures?: number }>): Promise<T> {
    const started = Date.now();
    const s = this.subject;
    const log = (allowed: boolean, r?: { source?: Source; detail?: string; figures?: number }) => execute("app", `
      INSERT studio.ReportingApiCall (AgentReportId, UserId, Agent, Endpoint, HouseholdId, ClientId, PortfolioCode, FromDate, ToDate, Source, Allowed, Detail, FigureCount, DurationMs)
      VALUES (@Report, @User, @Agent, @Endpoint, @Household, @Client, @Portfolio, @From, @To, @Source, @Allowed, @Detail, @Figures, @Ms)`,
      { Report: this.agentReportId, User: this.user.userId, Agent: agent, Endpoint: endpoint, Household: s.householdId, Client: s.clientId,
        Portfolio: s.portfolioCode, From: asDate(s.from), To: asDate(s.to), Source: r?.source ?? null, Allowed: allowed,
        Detail: r?.detail?.slice(0, 400) ?? null, Figures: r?.figures ?? null, Ms: Date.now() - started }).catch((e) => console.warn("Could not log a Reporting API call", e));
    if (this.user.role !== Roles.Advisor || !canSeeHousehold(this.user, s.householdId)) {
      await log(false, { detail: "Not entitled to this household." });
      throw new StudioError(403, "Not entitled", `${this.user.name} is not entitled to this household's data.`);
    }
    const r = await work();
    await log(true, r);
    return r.value;
  }

  private async ctx() {
    this.context ??= await buildContext(this.subject.householdId, this.subject.clientId, this.subject.portfolioCode, this.subject.to);
    return this.context;
  }

  async publishedAvailable() {
    this.asOf ??= await getAsOfDate();
    return isPublishedPeriod(this.subject.periodKey, this.subject.periodYear, this.subject.to, this.asOf);
  }

  async periodDescription() {
    const s = this.subject;
    const published = await this.publishedAvailable();
    return {
      from: isoDate(s.from), to: isoDate(s.to), kind: s.periodKey === "CUSTOM" ? "custom" : "standard",
      label: s.periodKey === "CUSTOM" ? "Custom period" : `${s.periodKey} ${s.periodYear ?? ""}`.trim(),
      figures: published
        ? "A closed standard period: the standard figure sets are published (get_published_figures). Anything else is calculated."
        : "Not a closed standard period (custom or still open): every figure is calculated by the calculation library (calculate_measures).",
    };
  }

  async clientContext(agent: string | null) {
    return this.call(agent, "context", async () => {
      const c = await this.ctx();
      return {
        value: {
          subject: c.subjectLabel, level: c.subjectLevel, clientName: c.clientName, household: c.householdName, segment: c.segment,
          relationshipManager: c.relationshipManager, mandates: c.mandates, riskProfiles: c.riskProfiles, reportingCurrency: c.reportingCurrency,
          entities: c.entities.map((e) => ({ name: e.name, type: e.clientType, mandate: e.mandate, riskProfile: e.riskProfile })),
          accounts: c.accounts.map((a) => ({ code: a.code, name: a.name, currency: a.currency, benchmark: a.benchmark, inception: isoDate(a.inceptionDate) })),
          hasStructuredProducts: c.hasStructuredProducts, isMultiCurrency: c.isMultiCurrency, conditions: c.conditions,
          period: await this.periodDescription(),
          dataAvailable: { from: isoDate(c.dataStart), to: isoDate(c.dataEnd) },
          signedInUser: `${this.user.name} (${this.user.title})`,
        },
      };
    });
  }

  async dataStatus(agent: string | null) {
    return this.call(agent, "status", async () => {
      const c = await this.ctx();
      const s = this.subject;
      this.readiness ??= await checkDataReadiness(c, s.clientId, s.portfolioCode, s.from, s.to);
      const asOf = c.dataEnd < s.to ? c.dataEnd : s.to;
      return {
        value: {
          status: this.readiness.status, asOfDate: isoDate(asOf),
          periodCovered: asOf < s.to ? `Data ends on ${isoDate(asOf)}, before the requested end date ${isoDate(s.to)}.` : "The whole period is covered.",
          checks: this.readiness.checks.map((x) => ({ check: x.label, status: x.status, detail: x.detail })),
        },
        detail: this.readiness.status,
      };
    });
  }

  /** Published figure sets for a closed standard period. */
  async publishedFigures(agent: string | null, set: string) {
    const fs = FIGURE_SETS.find((f) => f.key === set);
    if (!fs) throw rejected(`Unknown figure set '${set}'. Sets: ${FIGURE_SETS.map((f) => f.key).join(", ")}.`);
    return this.call(agent, "published", async () => {
      if (!(await this.publishedAvailable()))
        throw rejected("Nothing is published for this period (it is custom or not yet closed). Use calculate_measures: the calculation library calculates any period.");
      const block = await setBlock(fs, `q${++this.queries}`);
      const r = await findPublished(this.params, block);
      if (!r) throw rejected(`The '${set}' figures are not published for this subject and period. Use calculate_measures instead.`);
      const facts = this.keep([{ ...r, source: "published" }], block);
      const { id: _id, title: _t, type: _type, ...useInReport } = block;
      return {
        value: {
          figureSet: set, title: fs.title, source: "published", publishedOn: r.publishedOn.toISOString().slice(0, 16).replace("T", " "),
          figures: facts.slice(0, 80).map((f) => `${f.label.replace(`${block.title} · `, "")}: ${f.text}`),
          useInReport: { type: "data", title: fs.title, ...useInReport, note: "A data block with exactly these measures, groupBy, period, compare, topN and sort is shown from the published figures." },
        },
        source: "published", detail: set, figures: facts.length,
      };
    });
  }

  /** Any approved measures for any period: the calculation library. */
  async calculate(agent: string | null, req: { title: string; measures: string[]; groupBy?: string[]; period?: string; compare?: string; topN?: number | null; display?: string }) {
    return this.call(agent, "calculate", async () => {
      const catalog = await getCatalog();
      const groupBy = req.groupBy ?? [];
      const block = normaliseBlock({
        id: `q${++this.queries}`, type: BlockTypes.Data, title: req.title, measures: req.measures, groupBy,
        display: req.display ?? (groupBy.length ? "table" : "kpi"), period: req.period ?? "report", compare: req.compare ?? "none",
        topN: req.topN ?? null, sort: groupBy.some((g) => catalog.dimensions.find((d) => d.dimensionKey === g)?.isTime) ? "label_asc" : "value_desc",
      });
      const issues = validateBlock(block, Scopes.Client, catalog);
      if (issues.length) throw rejected(`The Reporting API rejected the request: ${issues.join(" ")}`);
      const [result] = await this.runBlocks([block]);
      if (result.error) throw rejected(`The calculation failed: ${result.error}`);
      const facts = this.keep([result], block);
      const missing = result.rows.reduce((n, r) => n + result.columns.filter((c) => c.role === "measure" && r[c.name] == null).length, 0);
      return {
        value: {
          queryId: block.id, title: block.title, source: result.source, dataProduct: result.dataProduct, period: block.period, compare: block.compare,
          rowCount: result.rows.length, missingValues: missing,
          figures: facts.slice(0, 80).map((f) => `${f.label.replace(`${block.title} · `, "")}: ${f.text}`),
          note: facts.length > 80 ? `${facts.length - 80} more figures not shown; narrow the request.` : undefined,
        },
        source: result.source, detail: `${req.title}: ${req.measures.join(", ")}${groupBy.length ? " by " + groupBy.join(", ") : ""}`, figures: facts.length,
      };
    });
  }

  /** Data blocks: from the published figures when the period is published and the request matches, else calculated. */
  private async runBlocks(blocks: Block[]): Promise<SourcedResult[]> {
    const published = await this.publishedAvailable();
    return Promise.all(blocks.map(async (b) => {
      const hit = published && b.type === BlockTypes.Data && !Object.keys(b.labels ?? {}).length ? await findPublished(this.params, b) : null;
      if (hit) return { ...hit, source: "published" as const };
      return { ...(await runBlock(b, Scopes.Client, { ...this.params }, false)), source: "calculated" as const };
    }));
  }

  private keep(results: SourcedResult[], ...blocks: Block[]) {
    const map = new Map(blocks.map((b) => [b.id, b]));
    const facts: SourcedFact[] = results.flatMap((r) => factsFromResults([r], map).map((f) => ({ ...f, source: r.source })));
    this.facts.push(...facts);
    return facts;
  }

  /** The report as the front end shows it: every included data block, published or calculated. */
  async runReport(agent: string | null, definition: ReportDefinition) {
    return this.call(agent, "report", async () => {
      const results = await this.runBlocks(includedBlocks(definition).filter((b) => b.type === BlockTypes.Data));
      const published = results.filter((r) => r.source === "published").length;
      return { value: results, source: published ? "published" : "calculated", detail: `${published} of ${results.length} blocks published`, figures: results.length };
    });
  }

  /** Figures in the text that the Reporting API did not return. */
  unverified(texts: string[]): string[] {
    const allowed = allowedNumbers(this.facts);
    return [...new Set(texts.flatMap((t) => unverifiedNumbers(t, allowed)))];
  }

  /**
   * Checks a report definition the way the renderer and the governed data need it: approved fields, valid displays,
   * known disclosures, and every figure in the text verified. Runs every data block, so the figures the charts and
   * tables will show are verified facts too. Returns the problems (empty when the report can be shown).
   */
  async checkReport(agent: string | null, raw: unknown, textOrigin: string): Promise<{ definition: ReportDefinition; problems: string[] }> {
    return this.call(agent, "check", async () => {
      const catalog = await getCatalog();
      const definition = normaliseDefinition({ scope: Scopes.Client, ...(raw as object) });
      const problems: string[] = [];
      if (!definition.pages.length) problems.push("The report has no pages.");
      if (definition.pages.length > 16) problems.push("Keep the report to at most 16 pages.");
      const codes = new Set((await getDisclosures()).map((d) => d.disclosureCode));
      const seen = new Set<string>();
      definition.pages.forEach((page, pi) => {
        page.id = page.id || `p${pi + 1}`;
        if (page.blocks.length > 8) problems.push(`Page '${page.title}' has ${page.blocks.length} blocks; keep it to 6.`);
        page.blocks.forEach((b, bi) => {
          b.id = b.id && !seen.has(b.id) ? b.id : `${page.id}b${bi + 1}`;
          seen.add(b.id);
          if (b.type === BlockTypes.Text && !b.origin) b.origin = textOrigin;
          for (const issue of validateBlock(b, Scopes.Client, catalog)) problems.push(`Page '${page.title}', block '${b.title || b.id}': ${issue}`);
          if (b.type === BlockTypes.Disclaimer && b.disclosureCode && !codes.has(b.disclosureCode)) problems.push(`Disclosure '${b.disclosureCode}' is not in the library.`);
        });
      });
      if (definition.cover) problems.push(...coverIssues(definition.cover, await approvedCovers()).blockers.map((x) => `Cover: ${x}`));
      if (!problems.length) {
        const blocks = allBlocks(definition).filter((b) => b.type === BlockTypes.Data);
        const results = await this.runBlocks(blocks);
        for (const r of results.filter((r) => r.error)) problems.push(`Block '${r.blockId}' could not be calculated: ${r.error}`);
        this.keep(results, ...blocks);
        const texts = allBlocks(definition).filter((b) => b.type === BlockTypes.Text).flatMap((b) => [b.title, b.text ?? ""]);
        const bad = this.unverified([...texts, ...definition.pages.map((p) => p.heading), ...(definition.cover ? coverTexts(definition.cover) : [])]);
        if (bad.length) problems.push(`These figures in the text were not returned by the Reporting API: ${bad.join(", ")}. Quote verified figures exactly, or describe the point without a number.`);
      }
      return { value: { definition, problems }, detail: problems.length ? `${problems.length} problems` : "accepted" };
    });
  }
}
