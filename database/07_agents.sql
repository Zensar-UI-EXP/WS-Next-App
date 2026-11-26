/* 07_agents.sql - V7: agent reports (with versions), the agents' trace, the Reporting API call log, reusable report
   definitions, and the published figures (schema pub) that the period-close job writes and the Reporting API reads.
   wis10_app already has read/write on the studio schema (05_security.sql); pub grants are below. */

USE WealthInsightsV10Db;
GO

DROP TABLE IF EXISTS studio.ReportingApiCall;
DROP TABLE IF EXISTS studio.AgentEvent;
DROP TABLE IF EXISTS studio.AgentReport;
DROP TABLE IF EXISTS studio.ReusableDefinition;
DROP TABLE IF EXISTS pub.PublishedResult;
DROP TABLE IF EXISTS pub.PublishRun;
GO
IF SCHEMA_ID(N'pub') IS NULL EXEC (N'CREATE SCHEMA pub');
GO

/* Reusable report definitions: saved from a finished agent report, so the agents (and the user) can start from them. */
CREATE TABLE studio.ReusableDefinition (
    DefinitionId   INT IDENTITY(1,1) CONSTRAINT PK_ReusableDefinition PRIMARY KEY,
    Name           NVARCHAR(120)  NOT NULL,
    Description    NVARCHAR(1000) NOT NULL,
    DefinitionJson NVARCHAR(MAX)  NOT NULL,  -- pages and blocks; text is kept as an example of the wording
    SourceReportId INT            NULL,
    CreatedBy      NVARCHAR(64)   NOT NULL,
    CreatedOn      DATETIME2(3)   NOT NULL CONSTRAINT DF_ReusableDefinition_Created DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE studio.AgentReport (
    AgentReportId  INT IDENTITY(1,1) CONSTRAINT PK_AgentReport PRIMARY KEY,
    RootId         INT            NULL,      -- the first version of this report (NULL on the first version itself)
    Version        INT            NOT NULL CONSTRAINT DF_AgentReport_Version DEFAULT 1,
    ParentId       INT            NULL,      -- the version this one changes
    ChangeKind     NVARCHAR(20)   NOT NULL CONSTRAINT DF_AgentReport_Change DEFAULT N'new',  -- new, agents, manual
    HouseholdId    INT            NOT NULL,
    ClientId       INT            NULL,
    PortfolioCode  NVARCHAR(20)   NULL,
    FromDate       DATE           NOT NULL,
    ToDate         DATE           NOT NULL,
    PeriodKey      NVARCHAR(10)   NOT NULL,  -- FY, H1, H2, Q1-Q4, SI or CUSTOM
    PeriodYear     INT            NULL,
    StartFromId    INT            NULL CONSTRAINT FK_AgentReport_Start REFERENCES studio.ReusableDefinition (DefinitionId),
    Request        NVARCHAR(2000) NOT NULL,
    Status         NVARCHAR(20)   NOT NULL CONSTRAINT DF_AgentReport_Status DEFAULT N'Queued',  -- Queued, Running, Completed, Failed
    Title          NVARCHAR(200)  NULL,
    Summary        NVARCHAR(MAX)  NULL,      -- the lead agent's message to the user
    FindingsJson   NVARCHAR(MAX)  NULL,      -- the performance agent's findings
    DefinitionJson NVARCHAR(MAX)  NULL,      -- the report definition from the reporting agent
    FactsJson      NVARCHAR(MAX)  NULL,      -- every figure the Reporting API returned (the verified facts), with its source
    InputTokens    INT            NOT NULL CONSTRAINT DF_AgentReport_In DEFAULT 0,
    OutputTokens   INT            NOT NULL CONSTRAINT DF_AgentReport_Out DEFAULT 0,
    CreatedBy      NVARCHAR(64)   NOT NULL,
    CreatedOn      DATETIME2(3)   NOT NULL CONSTRAINT DF_AgentReport_Created DEFAULT SYSUTCDATETIME(),
    FinishedOn     DATETIME2(3)   NULL
);
CREATE INDEX IX_AgentReport_Root ON studio.AgentReport (RootId, Version);
GO

CREATE TABLE studio.AgentEvent (
    EventId        INT IDENTITY(1,1) CONSTRAINT PK_AgentEvent PRIMARY KEY,
    AgentReportId  INT            NOT NULL CONSTRAINT FK_AgentEvent_Report REFERENCES studio.AgentReport (AgentReportId),
    Agent          NVARCHAR(40)   NOT NULL,  -- Lead agent, Performance agent, Reporting agent, Wealth manager
    Kind           NVARCHAR(20)   NOT NULL,  -- start, message, tool, tool_error, finish, error, edit
    Title          NVARCHAR(400)  NOT NULL,
    Detail         NVARCHAR(MAX)  NULL,
    InputTokens    INT            NULL,
    OutputTokens   INT            NULL,
    OccurredOn     DATETIME2(3)   NOT NULL CONSTRAINT DF_AgentEvent_On DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_AgentEvent_Report ON studio.AgentEvent (AgentReportId, EventId);
GO

/* Every Reporting API call: who called it (the signed-in user, and the agent acting for them), what for, the source of the
   figures (published or calculated) and whether access was allowed. */
CREATE TABLE studio.ReportingApiCall (
    CallId         INT IDENTITY(1,1) CONSTRAINT PK_ReportingApiCall PRIMARY KEY,
    AgentReportId  INT            NULL,
    UserId         NVARCHAR(64)   NOT NULL,
    Agent          NVARCHAR(40)   NULL,      -- NULL when the user called the API directly
    Endpoint       NVARCHAR(40)   NOT NULL,  -- context, status, published, calculate, check
    HouseholdId    INT            NOT NULL,
    ClientId       INT            NULL,
    PortfolioCode  NVARCHAR(20)   NULL,
    FromDate       DATE           NULL,
    ToDate         DATE           NULL,
    Source         NVARCHAR(20)   NULL,      -- published, calculated
    Allowed        BIT            NOT NULL,
    Detail         NVARCHAR(400)  NULL,
    FigureCount    INT            NULL,
    DurationMs     INT            NULL,
    CalledOn       DATETIME2(3)   NOT NULL CONSTRAINT DF_ReportingApiCall_On DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_ReportingApiCall_Report ON studio.ReportingApiCall (AgentReportId, CallId);
GO

/* Published figures: the period-close job runs the standard figure sets for every household, entity and account and
   every closed standard period, and publishes them here. The Reporting API reads them for standard periods; partial and
   custom periods are calculated by the calculation library. */
CREATE TABLE pub.PublishRun (
    PublishRunId   INT IDENTITY(1,1) CONSTRAINT PK_PublishRun PRIMARY KEY,
    AsOfDate       DATE           NOT NULL,
    Results        INT            NOT NULL,
    StartedOn      DATETIME2(3)   NOT NULL,
    FinishedOn     DATETIME2(3)   NOT NULL
);
CREATE TABLE pub.PublishedResult (
    PublishedId    INT IDENTITY(1,1) CONSTRAINT PK_PublishedResult PRIMARY KEY,
    PublishRunId   INT            NOT NULL CONSTRAINT FK_PublishedResult_Run REFERENCES pub.PublishRun (PublishRunId),
    SubjectKey     NVARCHAR(40)   NOT NULL,  -- H:<householdId>, C:<clientId>, P:<portfolioCode>
    PeriodKey      NVARCHAR(10)   NOT NULL,
    PeriodYear     INT            NOT NULL,
    FromDate       DATE           NOT NULL,
    ToDate         DATE           NOT NULL,
    FigureSet      NVARCHAR(40)   NOT NULL,  -- key_figures, by_account, ...
    Signature      NVARCHAR(400)  NOT NULL,  -- measures, group-bys, period, comparison, top N and sort
    ResultJson     NVARCHAR(MAX)  NOT NULL,
    PublishedOn    DATETIME2(3)   NOT NULL CONSTRAINT DF_PublishedResult_On DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_PublishedResult ON pub.PublishedResult (SubjectKey, FromDate, ToDate, Signature);
GO

GRANT SELECT ON SCHEMA::pub TO wis10_reader;                   -- the Reporting API reads published figures read-only
GRANT SELECT, INSERT, DELETE ON SCHEMA::pub TO wis10_app;      -- the period-close job (infrastructure) publishes them
GRANT UPDATE ON pub.PublishRun TO wis10_app;                    -- records when the run finished
GO

/* ---------- V7: agent reports join the V4 review, publishing and governance ---------- */

/* The review copy of an agent report: a V4 client report (Draft → InReview → Published) made from it. */
ALTER TABLE studio.AgentReport ADD ClientReportId INT NULL CONSTRAINT FK_AgentReport_ClientReport REFERENCES studio.ClientReport (ClientReportId);
GO

/* Agent reports can be for custom dates. */
ALTER TABLE studio.ClientReport DROP CONSTRAINT CK_ClientReport_Period;
ALTER TABLE studio.ClientReport ADD CONSTRAINT CK_ClientReport_Period
    CHECK (PeriodKey IN (N'FY', N'H1', N'H2', N'Q1', N'Q2', N'Q3', N'Q4', N'SI', N'CUSTOM'));
GO

/* The released template every agent report is reviewed under: no locked pages, because the agents assemble the pages and
   the release checks still require every applicable disclosure. Hidden from the template lists. */
IF NOT EXISTS (SELECT 1 FROM studio.Report WHERE Name = N'Agent-built report')
BEGIN
    INSERT studio.Report (Name, Category, Description)
    VALUES (N'Agent-built report', N'Agent studio', N'Reports assembled by the lead, performance and reporting agents. Reviewed and published like any client report.');
    INSERT studio.ReportVersion (ReportId, VersionNo, Status, DefinitionJson, PreviewPassed, CreatedBy, UpdatedBy, SubmittedBy, SubmittedOn, ReviewedBy, ReviewedOn, ReviewComment)
    VALUES (SCOPE_IDENTITY(), 1, N'Published', N'{"scope":"Client","pages":[]}', 1, N'system', N'system', N'system', SYSUTCDATETIME(), N'system', SYSUTCDATETIME(),
            N'Container for agent-built reports; their content is checked report by report at release.');
END
GO
