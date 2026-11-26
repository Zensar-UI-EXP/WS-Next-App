import { asDate, asText, execute, query, queryOne } from "../db";

/** Agent reports and their versions, the trace, reusable definitions and the Reporting API log (schema studio). */
export interface AgentReportRow {
  agentReportId: number; rootId: number | null; version: number; parentId: number | null; changeKind: string;
  householdId: number; clientId: number | null; portfolioCode: string | null; fromDate: Date; toDate: Date; periodKey: string; periodYear: number | null;
  startFromId: number | null; request: string; status: string; title: string | null; summary: string | null; findingsJson: string | null;
  definitionJson: string | null; factsJson: string | null; clientReportId: number | null; inputTokens: number; outputTokens: number; createdBy: string; createdOn: Date; finishedOn: Date | null;
}
export interface AgentEventRow {
  eventId: number; agent: string; kind: string; title: string; detail: string | null;
  inputTokens: number | null; outputTokens: number | null; occurredOn: Date;
}
export interface ReusableDefinitionRow { definitionId: number; name: string; description: string; definitionJson: string; sourceReportId: number | null; createdBy: string; createdOn: Date }

export const AgentStatus = { Queued: "Queued", Running: "Running", Completed: "Completed", Failed: "Failed" } as const;
export const ChangeKinds = { New: "new", Agents: "agents", Manual: "manual" } as const;

const SUMMARY = `AgentReportId, RootId, Version, ParentId, ChangeKind, HouseholdId, ClientId, PortfolioCode, FromDate, ToDate, PeriodKey, PeriodYear,
  StartFromId, Request, Status, Title, Summary, ClientReportId, InputTokens, OutputTokens, CreatedBy, CreatedOn, FinishedOn`;

export interface NewAgentReport {
  householdId: number; clientId: number | null; portfolioCode: string | null; from: Date; to: Date; periodKey: string; periodYear: number | null;
  request: string; startFromId?: number | null;
  /** A change to an existing version: the new version keeps its subject and period and starts from its findings. */
  parent?: AgentReportRow; changeKind?: string;
  /** A manual edit is written finished, at once. */
  done?: { title: string; summary: string; definition: unknown; facts: unknown };
}

export async function createAgentReport(r: NewAgentReport, userId: string) {
  const p = r.parent;
  const root = p ? p.rootId ?? p.agentReportId : null;
  const version = root == null ? 1
    : (await queryOne<{ v: number }>("app", "SELECT MAX(Version) AS V FROM studio.AgentReport WHERE AgentReportId = @Root OR RootId = @Root", { Root: root }))!.v + 1;
  const row = await queryOne<{ agentReportId: number }>("app", `
    INSERT studio.AgentReport (RootId, Version, ParentId, ChangeKind, HouseholdId, ClientId, PortfolioCode, FromDate, ToDate, PeriodKey, PeriodYear,
      StartFromId, Request, CreatedBy, Status, Title, Summary, FindingsJson, DefinitionJson, FactsJson, FinishedOn)
    VALUES (@Root, @Version, @Parent, @Change, @Household, @Client, @Portfolio, @From, @To, @PeriodKey, @PeriodYear,
      @StartFrom, @Request, @User, @Status, @Title, @Summary, @Findings, @Definition, @Facts, @Finished);
    SELECT CAST(SCOPE_IDENTITY() AS INT) AS AgentReportId;`,
    {
      Root: root, Version: version, Parent: p?.agentReportId ?? null, Change: r.changeKind ?? ChangeKinds.New,
      Household: r.householdId, Client: r.clientId, Portfolio: r.portfolioCode, From: asDate(r.from), To: asDate(r.to),
      PeriodKey: r.periodKey, PeriodYear: r.periodYear, StartFrom: r.startFromId ?? null, Request: asText(r.request), User: userId,
      Status: r.done ? AgentStatus.Completed : AgentStatus.Queued, Title: r.done?.title ?? p?.title ?? null, Summary: asText(r.done?.summary ?? null),
      Findings: asText(p?.findingsJson ?? null), Definition: asText(r.done ? JSON.stringify(r.done.definition) : null),
      Facts: asText(r.done ? JSON.stringify(r.done.facts) : null), Finished: r.done ? new Date() : null,
    });
  return row!.agentReportId;
}

/** The latest version of every report. */
export const listAgentReports = (households: number[] | null) => query<AgentReportRow & { coverJson: string | null }>("app", `
  SELECT TOP 100 ${SUMMARY}, JSON_QUERY(DefinitionJson, '$.cover') AS CoverJson FROM studio.AgentReport r
  WHERE r.Version = (SELECT MAX(x.Version) FROM studio.AgentReport x WHERE ISNULL(x.RootId, x.AgentReportId) = ISNULL(r.RootId, r.AgentReportId))
  ${households ? "AND HouseholdId IN @Households" : ""} ORDER BY ISNULL(FinishedOn, CreatedOn) DESC`,
  households ? { Households: households.length ? households : [-1] } : {});

export const listVersions = (rootId: number) => query<AgentReportRow>("app",
  `SELECT ${SUMMARY} FROM studio.AgentReport WHERE AgentReportId = @Root OR RootId = @Root ORDER BY Version`, { Root: rootId });

export const getAgentReport = (id: number) => queryOne<AgentReportRow>("app", "SELECT * FROM studio.AgentReport WHERE AgentReportId = @Id", { Id: id });

export const getAgentEvents = (id: number) => query<AgentEventRow>("app",
  "SELECT EventId, Agent, Kind, Title, Detail, InputTokens, OutputTokens, OccurredOn FROM studio.AgentEvent WHERE AgentReportId = @Id ORDER BY EventId", { Id: id });

export const getApiCalls = (id: number) => query<{
  callId: number; userId: string; agent: string | null; endpoint: string; source: string | null; allowed: boolean; detail: string | null;
  figureCount: number | null; durationMs: number | null; calledOn: Date;
}>("app", "SELECT CallId, UserId, Agent, Endpoint, Source, Allowed, Detail, FigureCount, DurationMs, CalledOn FROM studio.ReportingApiCall WHERE AgentReportId = @Id ORDER BY CallId", { Id: id });

export const setAgentStatus = (id: number, status: string) => execute("app",
  "UPDATE studio.AgentReport SET Status = @Status WHERE AgentReportId = @Id", { Id: id, Status: status });

export const addAgentEvent = (id: number, e: { agent: string; kind: string; title: string; detail?: unknown; inputTokens?: number | null; outputTokens?: number | null }) => execute("app", `
  INSERT studio.AgentEvent (AgentReportId, Agent, Kind, Title, Detail, InputTokens, OutputTokens) VALUES (@Id, @Agent, @Kind, @Title, @Detail, @In, @Out);
  UPDATE studio.AgentReport SET InputTokens = InputTokens + ISNULL(@In, 0), OutputTokens = OutputTokens + ISNULL(@Out, 0) WHERE AgentReportId = @Id;`,
  { Id: id, Agent: e.agent, Kind: e.kind, Title: e.title.slice(0, 400), In: e.inputTokens ?? null, Out: e.outputTokens ?? null,
    Detail: asText(e.detail == null ? null : typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail)) });

export const saveAgentOutput = (id: number, column: "FindingsJson" | "DefinitionJson" | "FactsJson", value: unknown) => execute("app",
  `UPDATE studio.AgentReport SET ${column} = @Value WHERE AgentReportId = @Id`, { Id: id, Value: asText(JSON.stringify(value)) });

export const finishAgentReport = (id: number, status: string, title: string | null, summary: string) => execute("app", `
  UPDATE studio.AgentReport SET Status = @Status, Title = ISNULL(@Title, Title), Summary = @Summary, FinishedOn = SYSUTCDATETIME() WHERE AgentReportId = @Id`,
  { Id: id, Status: status, Title: title, Summary: asText(summary) });

/** Runs left Queued or Running by a stopped server can never finish. */
export const failInterruptedAgentReports = () => execute("app", `
  UPDATE studio.AgentReport SET Status = N'Failed', Summary = N'Interrupted: the server stopped while the agents were working.', FinishedOn = SYSUTCDATETIME()
  WHERE Status IN (N'Queued', N'Running')`);

// ---------- reusable definitions ----------

export const listReusableDefinitions = () => query<ReusableDefinitionRow>("app",
  "SELECT DefinitionId, Name, Description, DefinitionJson, SourceReportId, CreatedBy, CreatedOn FROM studio.ReusableDefinition ORDER BY Name");

export const getReusableDefinition = (id: number) => queryOne<ReusableDefinitionRow>("app",
  "SELECT DefinitionId, Name, Description, DefinitionJson, SourceReportId, CreatedBy, CreatedOn FROM studio.ReusableDefinition WHERE DefinitionId = @Id", { Id: id });

export async function saveReusableDefinition(d: { name: string; description: string; definition: unknown; sourceReportId: number | null }, userId: string) {
  const row = await queryOne<{ definitionId: number }>("app", `
    INSERT studio.ReusableDefinition (Name, Description, DefinitionJson, SourceReportId, CreatedBy) VALUES (@Name, @Description, @Json, @Source, @User);
    SELECT CAST(SCOPE_IDENTITY() AS INT) AS DefinitionId;`,
    { Name: d.name, Description: asText(d.description), Json: asText(JSON.stringify(d.definition)), Source: d.sourceReportId, User: userId });
  return row!.definitionId;
}

export const linkClientReport = (id: number, clientReportId: number) => execute("app",
  "UPDATE studio.AgentReport SET ClientReportId = @Client WHERE AgentReportId = @Id", { Id: id, Client: clientReportId });
