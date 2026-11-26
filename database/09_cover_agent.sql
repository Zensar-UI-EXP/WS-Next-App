/* 09_cover_agent.sql - the cover agent. Client cover preferences (language, form of address, co-brand, business area)
   that the agent reads, and the agent's calls (V9): the plan when the Cover tab opens (recommendations, and what goes with
   each next choice), and quick decisions after a choice the plan does not cover. One call each, so no paused runs. */

USE WealthInsightsV10Db;
GO

DROP TABLE IF EXISTS studio.CoverAgentRun;
DROP TABLE IF EXISTS src_client.HouseholdPreference;
GO

-- Client data, owned by the client systems like the rest of src_client; the app can only read it.
CREATE TABLE src_client.HouseholdPreference (
    HouseholdId        INT           NOT NULL CONSTRAINT PK_HouseholdPreference PRIMARY KEY
                                     CONSTRAINT FK_HouseholdPreference_Household REFERENCES src_client.Household (HouseholdId),
    PreferredLanguage  NVARCHAR(5)   NOT NULL CONSTRAINT CK_HouseholdPreference_Language CHECK (PreferredLanguage IN (N'en', N'af')),
    FormOfAddress      NVARCHAR(20)  NOT NULL CONSTRAINT CK_HouseholdPreference_Address CHECK (FormOfAddress IN (N'formal', N'first-name')),
    CoBrandName        NVARCHAR(60)  NULL,   -- family office, trust or partner named on the cover
    BusinessArea       NVARCHAR(40)  NOT NULL CONSTRAINT CK_HouseholdPreference_Area CHECK (BusinessArea IN (N'Private Banking', N'Wealth & Investment', N'Private Client Advisory'))
);
INSERT src_client.HouseholdPreference (HouseholdId, PreferredLanguage, FormOfAddress, CoBrandName, BusinessArea) VALUES
    (1, N'en', N'formal',     N'Marula Family Office', N'Wealth & Investment'),
    (2, N'en', N'formal',     NULL,                    N'Private Banking'),
    (3, N'en', N'first-name', NULL,                    N'Private Banking'),
    (4, N'af', N'formal',     N'Becker Family Trust',  N'Wealth & Investment'),
    (5, N'en', N'first-name', NULL,                    N'Private Client Advisory');
GO

CREATE TABLE studio.CoverAgentRun (
    RunId          INT IDENTITY(1,1) CONSTRAINT PK_CoverAgentRun PRIMARY KEY,
    ReportKind     NVARCHAR(10)   NOT NULL CONSTRAINT CK_CoverAgentRun_Kind CHECK (ReportKind IN (N'agent', N'client')),
    ReportId       INT            NOT NULL,
    Mode           NVARCHAR(10)   NOT NULL CONSTRAINT CK_CoverAgentRun_Mode CHECK (Mode IN (N'plan', N'decide')),
    Status         NVARCHAR(20)   NOT NULL CONSTRAINT CK_CoverAgentRun_Status CHECK (Status IN (N'Done', N'Failed')),
    Model          NVARCHAR(60)   NULL,
    InputJson      NVARCHAR(MAX)  NOT NULL CONSTRAINT CK_CoverAgentRun_Input CHECK (ISJSON(InputJson) = 1),
    PromptText     NVARCHAR(MAX)  NULL,    -- the task sent with the cached instructions, rules and client
    ResultJson     NVARCHAR(MAX)  NULL,
    Error          NVARCHAR(2000) NULL,
    InputTokens    INT            NOT NULL CONSTRAINT DF_CoverAgentRun_In DEFAULT 0,
    OutputTokens   INT            NOT NULL CONSTRAINT DF_CoverAgentRun_Out DEFAULT 0,
    LatencyMs      INT            NULL,
    CreatedBy      NVARCHAR(30)   NOT NULL,
    CreatedOn      DATETIME2(0)   NOT NULL CONSTRAINT DF_CoverAgentRun_Created DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_CoverAgentRun_Report ON studio.CoverAgentRun (ReportKind, ReportId, Mode, Status);
GO
