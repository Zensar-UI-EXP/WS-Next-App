/* 10_cover_options.sql - V10: the cover options, configured in the platform. A reporting admin decides which values the Cover
   tab offers (and their names and order), adds colour themes and business tags, and sets what the cover agent may change and
   which choices it plans ahead; compliance approves each version. The values a cover can draw stay in code (lib/coverOptions.ts):
   a new layout still needs its drawing, and then starts switched off until an admin switches it on. */

USE WealthInsightsV10Db;
GO

DROP TABLE IF EXISTS studio.CoverOptionSet;
GO

CREATE TABLE studio.CoverOptionSet (
    VersionId      INT IDENTITY(1,1) CONSTRAINT PK_CoverOptionSet PRIMARY KEY,
    Version        INT            NOT NULL CONSTRAINT UQ_CoverOptionSet_Version UNIQUE,
    Status         NVARCHAR(20)   NOT NULL CONSTRAINT CK_CoverOptionSet_Status CHECK (Status IN (N'Draft', N'Submitted', N'Approved', N'Retired')),
    ConfigJson     NVARCHAR(MAX)  NOT NULL CONSTRAINT CK_CoverOptionSet_Json CHECK (ISJSON(ConfigJson) = 1),
    CreatedBy      NVARCHAR(30)   NOT NULL,
    CreatedOn      DATETIME2(0)   NOT NULL CONSTRAINT DF_CoverOptionSet_Created DEFAULT SYSUTCDATETIME(),
    SubmittedBy    NVARCHAR(30)   NULL,
    SubmittedOn    DATETIME2(0)   NULL,
    ReviewedBy     NVARCHAR(30)   NULL,
    ReviewedOn     DATETIME2(0)   NULL,
    ReviewComment  NVARCHAR(1000) NULL
);
CREATE UNIQUE INDEX UX_CoverOptionSet_Working ON studio.CoverOptionSet (Status) WHERE Status IN (N'Draft', N'Submitted');
CREATE UNIQUE INDEX UX_CoverOptionSet_Approved ON studio.CoverOptionSet (Status) WHERE Status = N'Approved';
GO

-- Version 1: everything the cover can draw, with the names in code, and the agent planning the choices V9 planned.
INSERT studio.CoverOptionSet (Version, Status, ConfigJson, CreatedBy, SubmittedBy, SubmittedOn, ReviewedBy, ReviewedOn, ReviewComment)
VALUES (1, N'Approved', N'{"options":{}}', N'priya.shah', N'priya.shah', SYSUTCDATETIME(), N'james.mokoena', SYSUTCDATETIME(), N'Seeded: the built-in options.');
GO
