/* 01_schema.sql - WealthInsightsV10Db (Wealth Insights Studio, POC v4 - Node.js).
   Recreates the whole database, so it is idempotent; logins live on the server and survive (05 re-creates the users).
   Run order: 01_schema -> 02_seed -> 03_data_products -> 04_catalog_reports -> 05_security -> 06_governance.

   The layout follows the solution architecture's governed data foundation, locally on SQL Server instead of Fabric:
   - src_client     Client management / Understanding You: households, client entities, accounts
   - src_holdings   Holdings, transactions and valuations (in the account's own currency)
   - src_reference  Product, instrument and reference data (effective-dated classifications, SPL components)
   - src_market     Market data, FX and benchmarks
   - src_content    Content studio: the disclosure library
   - dp             Consumer data products (views/functions over the sources, in USD). The ONLY objects report
                    queries may read; this is what would be a Fabric data product.
   - studio         Reporting studio: users and entitlements, catalogue, templates, client reports, orchestration runs
   - gov            Trust, control and governance: data quality, audit log, AI interaction log, lineage */

USE master;
GO
IF DB_ID(N'WealthInsightsV10Db') IS NOT NULL
BEGIN
    ALTER DATABASE WealthInsightsV10Db SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE WealthInsightsV10Db;
END;
GO
CREATE DATABASE WealthInsightsV10Db;
GO
USE WealthInsightsV10Db;
GO
SET NOCOUNT ON;
GO

CREATE SCHEMA src_client;
GO
CREATE SCHEMA src_holdings;
GO
CREATE SCHEMA src_reference;
GO
CREATE SCHEMA src_market;
GO
CREATE SCHEMA src_content;
GO
CREATE SCHEMA dp;
GO
CREATE SCHEMA studio;
GO
CREATE SCHEMA gov;
GO

/* ---------- Market data, FX and benchmarks ---------- */

CREATE TABLE src_market.Benchmark (
    BenchmarkId  INT            NOT NULL CONSTRAINT PK_Benchmark PRIMARY KEY,
    Name         NVARCHAR(100)  NOT NULL CONSTRAINT UQ_Benchmark_Name UNIQUE
);

CREATE TABLE src_market.BenchmarkReturn (
    BenchmarkId  INT            NOT NULL CONSTRAINT FK_BenchmarkReturn_Benchmark REFERENCES src_market.Benchmark (BenchmarkId),
    ValueDate    DATE           NOT NULL,
    DailyReturn  DECIMAL(12,8)  NOT NULL,   -- in USD
    CONSTRAINT PK_BenchmarkReturn PRIMARY KEY (BenchmarkId, ValueDate)
);

/* USD value of one unit of the currency at the close of RateDate. */
CREATE TABLE src_market.FxRate (
    Currency    CHAR(3)        NOT NULL,
    RateDate    DATE           NOT NULL,
    UsdPerUnit  DECIMAL(18,8)  NOT NULL CONSTRAINT CK_FxRate_Positive CHECK (UsdPerUnit > 0),
    CONSTRAINT PK_FxRate PRIMARY KEY (Currency, RateDate)
);

/* ---------- Client management ---------- */

/* A household (group) of related client entities, reported on together. */
CREATE TABLE src_client.Household (
    HouseholdId          INT            NOT NULL CONSTRAINT PK_Household PRIMARY KEY,
    Name                 NVARCHAR(100)  NOT NULL,
    Segment              NVARCHAR(30)   NOT NULL,      -- Private client, Family office, Corporate
    ReportingCurrency    CHAR(3)        NOT NULL CONSTRAINT DF_Household_Ccy DEFAULT ('USD'),
    RelationshipManager  NVARCHAR(100)  NOT NULL,
    ReviewFrequency      NVARCHAR(20)   NOT NULL,      -- Annual, Semi-annual, Quarterly
    NextReviewDate       DATE           NOT NULL
);

/* A client entity: a person, trust, company or family office within a household. */
CREATE TABLE src_client.Client (
    ClientId     INT            NOT NULL CONSTRAINT PK_Client PRIMARY KEY,
    HouseholdId  INT            NOT NULL CONSTRAINT FK_Client_Household REFERENCES src_client.Household (HouseholdId),
    Name         NVARCHAR(100)  NOT NULL,
    ClientType   NVARCHAR(30)   NOT NULL,              -- Individual, Family office, Trust, Company
    RiskProfile  NVARCHAR(20)   NOT NULL CONSTRAINT CK_Client_RiskProfile CHECK (RiskProfile IN (N'Conservative', N'Balanced', N'Growth')),
    Mandate      NVARCHAR(20)   NOT NULL CONSTRAINT CK_Client_Mandate CHECK (Mandate IN (N'Discretionary', N'Advisory'))
);

CREATE TABLE src_client.Account (
    AccountId      INT            NOT NULL CONSTRAINT PK_Account PRIMARY KEY,
    ClientId       INT            NOT NULL CONSTRAINT FK_Account_Client REFERENCES src_client.Client (ClientId),
    Code           NVARCHAR(20)   NOT NULL CONSTRAINT UQ_Account_Code UNIQUE,
    Name           NVARCHAR(100)  NOT NULL,
    Currency       CHAR(3)        NOT NULL,
    BenchmarkId    INT            NOT NULL CONSTRAINT FK_Account_Benchmark REFERENCES src_market.Benchmark (BenchmarkId),
    InceptionDate  DATE           NOT NULL
);

/* ---------- Product, instrument and reference data ---------- */

CREATE TABLE src_reference.Instrument (
    InstrumentId  INT            NOT NULL CONSTRAINT PK_Instrument PRIMARY KEY,
    Symbol        NVARCHAR(20)   NOT NULL CONSTRAINT UQ_Instrument_Symbol UNIQUE,
    Name          NVARCHAR(100)  NOT NULL,
    AssetClass    NVARCHAR(20)   NOT NULL CONSTRAINT CK_Instrument_AssetClass CHECK (AssetClass IN (N'Equity', N'Bond', N'Fund', N'Cash', N'Structured')),
    Region        NVARCHAR(40)   NOT NULL,
    Currency      CHAR(3)        NOT NULL,
    IsSpl         BIT            NOT NULL CONSTRAINT DF_Instrument_Spl DEFAULT (0)   -- structured product (SPL)
);

/* Sector classification, effective-dated: a reclassification closes one row and opens the next. */
CREATE TABLE src_reference.InstrumentClassification (
    InstrumentId  INT            NOT NULL CONSTRAINT FK_Classification_Instrument REFERENCES src_reference.Instrument (InstrumentId),
    Sector        NVARCHAR(100)  NOT NULL,
    ValidFrom     DATE           NOT NULL,
    ValidTo       DATE           NULL,          -- NULL = still valid
    CONSTRAINT PK_InstrumentClassification PRIMARY KEY (InstrumentId, ValidFrom),
    CONSTRAINT CK_Classification_Range CHECK (ValidTo IS NULL OR ValidTo >= ValidFrom)
);

/* What a structured product is made of, for look-through exposure. Weights per product sum to 1. */
CREATE TABLE src_reference.SplComponent (
    InstrumentId   INT            NOT NULL CONSTRAINT FK_SplComponent_Instrument REFERENCES src_reference.Instrument (InstrumentId),
    ComponentNo    INT            NOT NULL,
    ComponentName  NVARCHAR(100)  NOT NULL,
    AssetClass     NVARCHAR(20)   NOT NULL CONSTRAINT CK_SplComponent_AssetClass CHECK (AssetClass IN (N'Equity', N'Bond', N'Cash')),
    Weight         DECIMAL(9,6)   NOT NULL CONSTRAINT CK_SplComponent_Weight CHECK (Weight > 0 AND Weight <= 1),
    CONSTRAINT PK_SplComponent PRIMARY KEY (InstrumentId, ComponentNo)
);

/* ---------- Holdings, transactions and valuations (account currency) ---------- */

CREATE TABLE src_holdings.Valuation (
    AccountId         INT            NOT NULL CONSTRAINT FK_Valuation_Account REFERENCES src_client.Account (AccountId),
    ValueDate         DATE           NOT NULL,
    MarketValueLocal  DECIMAL(18,2)  NOT NULL,
    NetFlowLocal      DECIMAL(18,2)  NOT NULL,   -- external cash flow on the day: deposits positive, withdrawals negative
    CONSTRAINT PK_Valuation PRIMARY KEY (AccountId, ValueDate)
);

CREATE TABLE src_holdings.Holding (
    AccountId         INT            NOT NULL CONSTRAINT FK_Holding_Account REFERENCES src_client.Account (AccountId),
    InstrumentId      INT            NOT NULL CONSTRAINT FK_Holding_Instrument REFERENCES src_reference.Instrument (InstrumentId),
    AsOfDate          DATE           NOT NULL,
    Quantity          DECIMAL(18,4)  NOT NULL,
    MarketValueLocal  DECIMAL(18,2)  NOT NULL,
    CONSTRAINT PK_Holding PRIMARY KEY (AccountId, AsOfDate, InstrumentId)
);

CREATE TABLE src_holdings.[Transaction] (
    TxnId         INT            NOT NULL IDENTITY(1,1) CONSTRAINT PK_Transaction PRIMARY KEY,
    AccountId     INT            NOT NULL CONSTRAINT FK_Transaction_Account REFERENCES src_client.Account (AccountId),
    InstrumentId  INT            NULL     CONSTRAINT FK_Transaction_Instrument REFERENCES src_reference.Instrument (InstrumentId),
    TxnDate       DATE           NOT NULL,
    Type          NVARCHAR(20)   NOT NULL CONSTRAINT CK_Transaction_Type CHECK (Type IN (N'Buy', N'Sell', N'Dividend', N'Fee', N'Deposit', N'Withdrawal')),
    AmountLocal   DECIMAL(18,2)  NOT NULL CONSTRAINT CK_Transaction_Amount CHECK (AmountLocal >= 0)
);

CREATE INDEX IX_Valuation_Date ON src_holdings.Valuation (ValueDate) INCLUDE (MarketValueLocal, NetFlowLocal);
CREATE INDEX IX_Holding_AsOf ON src_holdings.Holding (AsOfDate) INCLUDE (InstrumentId, Quantity, MarketValueLocal);
CREATE INDEX IX_Transaction_Account_Date ON src_holdings.[Transaction] (AccountId, TxnDate) INCLUDE (Type, AmountLocal);
GO

/* ---------- Content studio: disclosures ---------- */

/* Approved disclosure wording. Report disclaimer blocks name a code; the text always comes from here.
   AppliesWhen says when a disclosure is required in a client report. */
CREATE TABLE src_content.Disclosure (
    DisclosureCode  NVARCHAR(30)    NOT NULL CONSTRAINT PK_Disclosure PRIMARY KEY,
    Title           NVARCHAR(100)   NOT NULL,
    Text            NVARCHAR(4000)  NOT NULL,
    AppliesWhen     NVARCHAR(30)    NOT NULL CONSTRAINT CK_Disclosure_Applies
        CHECK (AppliesWhen IN (N'Always', N'StructuredProducts', N'MultiCurrency', N'Advisory', N'Discretionary')),
    Version         INT             NOT NULL,
    EffectiveFrom   DATE            NOT NULL,
    Owner           NVARCHAR(60)    NOT NULL
);
GO

/* ---------- Studio: users and entitlements ----------
   POC without SSO: the caller names a user (X-User header). Roles: Designer (reporting admin), Approver
   (KI / compliance), Advisor (wealth manager), Operations (reporting operations), Client. Wealth managers see
   only their entitled households; client users see only their own household's published reports. */

CREATE TABLE studio.AppUser (
    UserId       NVARCHAR(30)   NOT NULL CONSTRAINT PK_AppUser PRIMARY KEY,
    Name         NVARCHAR(100)  NOT NULL,
    Title        NVARCHAR(100)  NOT NULL,
    Role         NVARCHAR(20)   NOT NULL CONSTRAINT CK_AppUser_Role CHECK (Role IN (N'Designer', N'Approver', N'Advisor', N'Operations', N'Client')),
    HouseholdId  INT            NULL CONSTRAINT FK_AppUser_Household REFERENCES src_client.Household (HouseholdId),
    CONSTRAINT CK_AppUser_ClientHousehold CHECK ((Role = N'Client' AND HouseholdId IS NOT NULL) OR (Role <> N'Client' AND HouseholdId IS NULL))
);

CREATE TABLE studio.Entitlement (
    UserId       NVARCHAR(30)  NOT NULL CONSTRAINT FK_Entitlement_User REFERENCES studio.AppUser (UserId),
    HouseholdId  INT           NOT NULL CONSTRAINT FK_Entitlement_Household REFERENCES src_client.Household (HouseholdId),
    CONSTRAINT PK_Entitlement PRIMARY KEY (UserId, HouseholdId)
);

/* ---------- Studio: approved data catalogue ----------
   Each measure and group-by maps to a vetted SQL expression over a data product. Designers and the AI only pick
   keys; the API assembles the query. Methodology columns are the governed definition shown to reviewers. */

CREATE TABLE studio.CatalogMeasure (
    MeasureKey          NVARCHAR(40)   NOT NULL CONSTRAINT PK_CatalogMeasure PRIMARY KEY,
    Label               NVARCHAR(60)   NOT NULL,
    Symbol              NVARCHAR(2)    NOT NULL,
    Format              NVARCHAR(10)   NOT NULL CONSTRAINT CK_CatalogMeasure_Format CHECK (Format IN (N'currency', N'percent', N'number', N'index', N'ratio')),
    Description         NVARCHAR(400)  NOT NULL,
    PerformanceExpr     NVARCHAR(1500) NULL,      -- aggregate over the performance rows; NULL = not available there
    HoldingsExpr        NVARCHAR(1000) NULL,      -- aggregate over holdings or look-through exposure rows
    RequiresGroup       BIT            NOT NULL CONSTRAINT DF_CatalogMeasure_Group DEFAULT (0),
    Cumulative          BIT            NOT NULL CONSTRAINT DF_CatalogMeasure_Cumulative DEFAULT (0),
    Methodology         NVARCHAR(1000) NOT NULL,
    MethodologyVersion  NVARCHAR(10)   NOT NULL,
    Owner               NVARCHAR(60)   NOT NULL,
    ApprovedOn          DATE           NOT NULL,
    SortOrder           INT            NOT NULL,
    IsActive            BIT            NOT NULL CONSTRAINT DF_CatalogMeasure_Active DEFAULT (1)
);

CREATE TABLE studio.CatalogDimension (
    DimensionKey  NVARCHAR(40)   NOT NULL CONSTRAINT PK_CatalogDimension PRIMARY KEY,
    Label         NVARCHAR(60)   NOT NULL,
    Source        NVARCHAR(20)   NOT NULL CONSTRAINT CK_CatalogDimension_Source CHECK (Source IN (N'Performance', N'Holdings', N'Exposure')),
    Expr          NVARCHAR(400)  NOT NULL,
    Format        NVARCHAR(10)   NOT NULL CONSTRAINT CK_CatalogDimension_Format CHECK (Format IN (N'text', N'month', N'date')),
    IsTime        BIT            NOT NULL CONSTRAINT DF_CatalogDimension_Time DEFAULT (0),
    PeriodRows    BIT            NOT NULL CONSTRAINT DF_CatalogDimension_PeriodRows DEFAULT (0),
    SortOrder     INT            NOT NULL,
    IsActive      BIT            NOT NULL CONSTRAINT DF_CatalogDimension_Active DEFAULT (1)
);

CREATE TABLE studio.CatalogCombination (
    MeasureKey    NVARCHAR(40) NOT NULL CONSTRAINT FK_CatalogCombination_Measure REFERENCES studio.CatalogMeasure (MeasureKey),
    DimensionKey  NVARCHAR(40) NOT NULL CONSTRAINT FK_CatalogCombination_Dimension REFERENCES studio.CatalogDimension (DimensionKey),
    CONSTRAINT PK_CatalogCombination PRIMARY KEY (MeasureKey, DimensionKey)
);

CREATE TABLE studio.BlockPreset (
    PresetKey    NVARCHAR(40)   NOT NULL CONSTRAINT PK_BlockPreset PRIMARY KEY,
    Label        NVARCHAR(60)   NOT NULL,
    Icon         NVARCHAR(4)    NOT NULL,
    Description  NVARCHAR(300)  NOT NULL,       -- shown to the composition agent
    BlockJson    NVARCHAR(MAX)  NOT NULL CONSTRAINT CK_BlockPreset_Json CHECK (ISJSON(BlockJson) = 1),
    SortOrder    INT            NOT NULL
);
GO

/* ---------- Studio: templates and versions ----------
   Draft -> Submitted -> Published (the previous Published becomes Retired); a returned version goes back to Draft. */

CREATE TABLE studio.Report (
    ReportId     INT             NOT NULL IDENTITY(1,1) CONSTRAINT PK_Report PRIMARY KEY,
    Name         NVARCHAR(100)   NOT NULL CONSTRAINT UQ_Report_Name UNIQUE,
    Category     NVARCHAR(100)   NOT NULL,
    Description  NVARCHAR(1000)  NULL,
    CreatedOn    DATETIME2(0)    NOT NULL CONSTRAINT DF_Report_CreatedOn DEFAULT (SYSUTCDATETIME())
);

CREATE TABLE studio.ReportVersion (
    VersionId       INT             NOT NULL IDENTITY(1,1) CONSTRAINT PK_ReportVersion PRIMARY KEY,
    ReportId        INT             NOT NULL CONSTRAINT FK_ReportVersion_Report REFERENCES studio.Report (ReportId) ON DELETE CASCADE,
    VersionNo       INT             NOT NULL,
    Status          NVARCHAR(20)    NOT NULL CONSTRAINT CK_ReportVersion_Status CHECK (Status IN (N'Draft', N'Submitted', N'Published', N'Retired')),
    DefinitionJson  NVARCHAR(MAX)   NOT NULL CONSTRAINT CK_ReportVersion_Json CHECK (ISJSON(DefinitionJson) = 1),
    PreviewPassed   BIT             NOT NULL CONSTRAINT DF_ReportVersion_Preview DEFAULT (0),
    CreatedBy       NVARCHAR(30)    NOT NULL,
    CreatedOn       DATETIME2(0)    NOT NULL CONSTRAINT DF_ReportVersion_CreatedOn DEFAULT (SYSUTCDATETIME()),
    UpdatedBy       NVARCHAR(30)    NOT NULL,
    UpdatedOn       DATETIME2(0)    NOT NULL CONSTRAINT DF_ReportVersion_UpdatedOn DEFAULT (SYSUTCDATETIME()),
    SubmittedBy     NVARCHAR(30)    NULL,
    SubmittedOn     DATETIME2(0)    NULL,
    ReviewedBy      NVARCHAR(30)    NULL,
    ReviewedOn      DATETIME2(0)    NULL,
    ReviewComment   NVARCHAR(1000)  NULL,
    CONSTRAINT UQ_ReportVersion_No UNIQUE (ReportId, VersionNo)
);
CREATE UNIQUE INDEX UX_ReportVersion_Working ON studio.ReportVersion (ReportId) WHERE Status IN (N'Draft', N'Submitted');
CREATE UNIQUE INDEX UX_ReportVersion_Published ON studio.ReportVersion (ReportId) WHERE Status = N'Published';
GO

/* ---------- Studio: client reports ----------
   Draft (wealth manager edits) -> InReview (submitted; release readiness passed) -> Published (approved by
   compliance, a different user; visible to the client). Returning a report sends it back to Draft with a comment.
   ContextJson, InsightsJson and ReadinessJson hold the latest output of the orchestration steps. */

CREATE TABLE studio.ClientReport (
    ClientReportId  INT             NOT NULL IDENTITY(1,1) CONSTRAINT PK_ClientReport PRIMARY KEY,
    ReportId        INT             NOT NULL CONSTRAINT FK_ClientReport_Report REFERENCES studio.Report (ReportId) ON DELETE CASCADE,
    VersionNo       INT             NOT NULL,
    HouseholdId     INT             NOT NULL CONSTRAINT FK_ClientReport_Household REFERENCES src_client.Household (HouseholdId),
    ClientId        INT             NULL     CONSTRAINT FK_ClientReport_Client REFERENCES src_client.Client (ClientId),
    PortfolioCode   NVARCHAR(20)    NULL,
    PeriodYear      INT             NOT NULL,
    PeriodKey       NVARCHAR(10)    NOT NULL CONSTRAINT CK_ClientReport_Period CHECK (PeriodKey IN (N'FY', N'H1', N'H2', N'Q1', N'Q2', N'Q3', N'Q4', N'SI')),
    FromDate        DATE            NOT NULL,
    ToDate          DATE            NOT NULL,
    OutputFormat    NVARCHAR(20)    NOT NULL,
    Status          NVARCHAR(20)    NOT NULL CONSTRAINT CK_ClientReport_Status CHECK (Status IN (N'Draft', N'InReview', N'Published')),
    DefinitionJson  NVARCHAR(MAX)   NOT NULL CONSTRAINT CK_ClientReport_Json CHECK (ISJSON(DefinitionJson) = 1),
    ContextJson     NVARCHAR(MAX)   NULL,
    InsightsJson    NVARCHAR(MAX)   NULL,
    ReadinessJson   NVARCHAR(MAX)   NULL,
    CreatedBy       NVARCHAR(30)    NOT NULL,
    CreatedOn       DATETIME2(0)    NOT NULL CONSTRAINT DF_ClientReport_CreatedOn DEFAULT (SYSUTCDATETIME()),
    UpdatedBy       NVARCHAR(30)    NOT NULL,
    UpdatedOn       DATETIME2(0)    NOT NULL CONSTRAINT DF_ClientReport_UpdatedOn DEFAULT (SYSUTCDATETIME()),
    SubmittedBy     NVARCHAR(30)    NULL,
    SubmittedOn     DATETIME2(0)    NULL,
    ReviewedBy      NVARCHAR(30)    NULL,
    ReviewedOn      DATETIME2(0)    NULL,
    ReviewComment   NVARCHAR(1000)  NULL,
    PublishedOn     DATETIME2(0)    NULL
);

/* One run of the report orchestrator: Draft (prepare a new report) or Release (checks before review). */
CREATE TABLE studio.OrchestrationRun (
    RunId           INT             NOT NULL IDENTITY(1,1) CONSTRAINT PK_OrchestrationRun PRIMARY KEY,
    ClientReportId  INT             NOT NULL CONSTRAINT FK_OrchestrationRun_Report REFERENCES studio.ClientReport (ClientReportId) ON DELETE CASCADE,
    Kind            NVARCHAR(10)    NOT NULL CONSTRAINT CK_OrchestrationRun_Kind CHECK (Kind IN (N'Draft', N'Release')),
    Status          NVARCHAR(20)    NOT NULL CONSTRAINT CK_OrchestrationRun_Status CHECK (Status IN (N'Running', N'Completed', N'Blocked', N'Failed')),
    StartedBy       NVARCHAR(30)    NOT NULL,
    StartedOn       DATETIME2(3)    NOT NULL CONSTRAINT DF_OrchestrationRun_Started DEFAULT (SYSUTCDATETIME()),
    FinishedOn      DATETIME2(3)    NULL,
    Summary         NVARCHAR(1000)  NULL
);

CREATE TABLE studio.OrchestrationStep (
    RunId       INT             NOT NULL CONSTRAINT FK_OrchestrationStep_Run REFERENCES studio.OrchestrationRun (RunId) ON DELETE CASCADE,
    StepNo      INT             NOT NULL,
    StepKey     NVARCHAR(40)    NOT NULL,
    Name        NVARCHAR(100)   NOT NULL,
    Kind        NVARCHAR(10)    NOT NULL CONSTRAINT CK_OrchestrationStep_Kind CHECK (Kind IN (N'Service', N'Agent')),
    Status      NVARCHAR(10)    NOT NULL CONSTRAINT CK_OrchestrationStep_Status CHECK (Status IN (N'Pending', N'Running', N'Passed', N'Warning', N'Failed', N'Skipped')),
    StartedOn   DATETIME2(3)    NULL,
    FinishedOn  DATETIME2(3)    NULL,
    Summary     NVARCHAR(1000)  NULL,
    OutputJson  NVARCHAR(MAX)   NULL,
    CONSTRAINT PK_OrchestrationStep PRIMARY KEY (RunId, StepNo)
);
GO

/* ---------- Governance ---------- */

CREATE TABLE gov.DataQualityRule (
    RuleCode     NVARCHAR(30)   NOT NULL CONSTRAINT PK_DataQualityRule PRIMARY KEY,
    Name         NVARCHAR(100)  NOT NULL,
    Severity     NVARCHAR(10)   NOT NULL CONSTRAINT CK_DataQualityRule_Severity CHECK (Severity IN (N'Blocker', N'Warning')),
    Description  NVARCHAR(400)  NOT NULL,
    Owner        NVARCHAR(60)   NOT NULL
);

/* Exceptions found by gov.usp_RunDataQuality. ExceptionKey identifies the same finding across runs, so its status
   (Open / Acknowledged / Resolved) survives a re-run. Blockers stop a client report from being released until resolved. */
CREATE TABLE gov.DataQualityException (
    ExceptionId     INT             NOT NULL IDENTITY(1,1) CONSTRAINT PK_DataQualityException PRIMARY KEY,
    ExceptionKey    NVARCHAR(200)   NOT NULL CONSTRAINT UQ_DataQualityException_Key UNIQUE,
    RuleCode        NVARCHAR(30)    NOT NULL CONSTRAINT FK_DataQualityException_Rule REFERENCES gov.DataQualityRule (RuleCode),
    AccountId       INT             NULL CONSTRAINT FK_DataQualityException_Account REFERENCES src_client.Account (AccountId),
    InstrumentId    INT             NULL CONSTRAINT FK_DataQualityException_Instrument REFERENCES src_reference.Instrument (InstrumentId),
    AsOfDate        DATE            NOT NULL,
    Detail          NVARCHAR(400)   NOT NULL,
    Status          NVARCHAR(15)    NOT NULL CONSTRAINT CK_DataQualityException_Status CHECK (Status IN (N'Open', N'Acknowledged', N'Resolved')),
    DetectedOn      DATETIME2(0)    NOT NULL CONSTRAINT DF_DataQualityException_Detected DEFAULT (SYSUTCDATETIME()),
    UpdatedBy       NVARCHAR(30)    NULL,
    UpdatedOn       DATETIME2(0)    NULL,
    Note            NVARCHAR(1000)  NULL
);

/* Append-only audit trail (05_security denies UPDATE and DELETE to the application). */
CREATE TABLE gov.AuditEvent (
    AuditId     BIGINT          NOT NULL IDENTITY(1,1) CONSTRAINT PK_AuditEvent PRIMARY KEY,
    OccurredOn  DATETIME2(3)    NOT NULL CONSTRAINT DF_AuditEvent_Occurred DEFAULT (SYSUTCDATETIME()),
    UserId      NVARCHAR(30)    NOT NULL,
    Role        NVARCHAR(20)    NOT NULL,
    Action      NVARCHAR(60)    NOT NULL,
    EntityType  NVARCHAR(30)    NOT NULL,
    EntityId    NVARCHAR(40)    NULL,
    Summary     NVARCHAR(400)   NOT NULL,
    DetailJson  NVARCHAR(MAX)   NULL
);
CREATE INDEX IX_AuditEvent_Entity ON gov.AuditEvent (EntityType, EntityId, OccurredOn);

/* Every call to the language model: who and what for, the exact prompt and answer, cost, and the outcome of the
   deterministic checks on the answer (Accepted, Rejected, Error). For responsible-AI monitoring. */
CREATE TABLE gov.AiInteraction (
    InteractionId   BIGINT          NOT NULL IDENTITY(1,1) CONSTRAINT PK_AiInteraction PRIMARY KEY,
    OccurredOn      DATETIME2(3)    NOT NULL CONSTRAINT DF_AiInteraction_Occurred DEFAULT (SYSUTCDATETIME()),
    UserId          NVARCHAR(30)    NOT NULL,
    Agent           NVARCHAR(40)    NOT NULL,
    Purpose         NVARCHAR(200)   NOT NULL,
    ClientReportId  INT             NULL,
    Provider        NVARCHAR(30)    NOT NULL,
    Model           NVARCHAR(60)    NOT NULL,
    Prompt          NVARCHAR(MAX)   NOT NULL,
    Response        NVARCHAR(MAX)   NULL,
    InputTokens     INT             NULL,
    OutputTokens    INT             NULL,
    LatencyMs       INT             NOT NULL,
    Outcome         NVARCHAR(10)    NOT NULL CONSTRAINT CK_AiInteraction_Outcome CHECK (Outcome IN (N'Pending', N'Accepted', N'Rejected', N'Error')),
    Notes           NVARCHAR(2000)  NULL
);
CREATE INDEX IX_AiInteraction_Report ON gov.AiInteraction (ClientReportId, OccurredOn);

/* Which source systems feed each data product (shown with every figure's methodology). */
CREATE TABLE gov.DataProductLineage (
    DataProduct   NVARCHAR(100)  NOT NULL,
    SourceSystem  NVARCHAR(100)  NOT NULL,
    SourceObject  NVARCHAR(200)  NOT NULL,
    Description   NVARCHAR(400)  NOT NULL,
    CONSTRAINT PK_DataProductLineage PRIMARY KEY (DataProduct, SourceObject)
);
GO
