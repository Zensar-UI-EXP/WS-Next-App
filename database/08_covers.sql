/* 08_covers.sql - V7: cover templates. A designer makes or changes a cover template (a draft version), compliance approves it,
   and wealth managers and the reporting agent pick from the approved ones. Each report records the template version it used. */

USE WealthInsightsV10Db;
GO

DROP TABLE IF EXISTS studio.CoverTemplateVersion;
DROP TABLE IF EXISTS studio.CoverTemplate;
GO

CREATE TABLE studio.CoverTemplate (
    CoverTemplateId INT IDENTITY(1,1) CONSTRAINT PK_CoverTemplate PRIMARY KEY,
    Name            NVARCHAR(80)   NOT NULL CONSTRAINT UQ_CoverTemplate_Name UNIQUE,
    Segment         NVARCHAR(40)   NOT NULL,   -- All, Private client, Family office, Corporate
    Description     NVARCHAR(400)  NOT NULL,
    CreatedOn       DATETIME2(0)   NOT NULL CONSTRAINT DF_CoverTemplate_Created DEFAULT SYSUTCDATETIME()
);
CREATE TABLE studio.CoverTemplateVersion (
    VersionId       INT IDENTITY(1,1) CONSTRAINT PK_CoverTemplateVersion PRIMARY KEY,
    CoverTemplateId INT            NOT NULL CONSTRAINT FK_CoverTemplateVersion_Template REFERENCES studio.CoverTemplate (CoverTemplateId) ON DELETE CASCADE,
    Version         INT            NOT NULL,
    Status          NVARCHAR(20)   NOT NULL CONSTRAINT CK_CoverTemplateVersion_Status CHECK (Status IN (N'Draft', N'Submitted', N'Approved', N'Retired')),
    SettingsJson    NVARCHAR(MAX)  NOT NULL CONSTRAINT CK_CoverTemplateVersion_Json CHECK (ISJSON(SettingsJson) = 1),
    CreatedBy       NVARCHAR(30)   NOT NULL,
    CreatedOn       DATETIME2(0)   NOT NULL CONSTRAINT DF_CoverTemplateVersion_Created DEFAULT SYSUTCDATETIME(),
    SubmittedBy     NVARCHAR(30)   NULL,
    SubmittedOn     DATETIME2(0)   NULL,
    ReviewedBy      NVARCHAR(30)   NULL,
    ReviewedOn      DATETIME2(0)   NULL,
    ReviewComment   NVARCHAR(1000) NULL,
    CONSTRAINT UQ_CoverTemplateVersion UNIQUE (CoverTemplateId, Version)
);
CREATE UNIQUE INDEX UX_CoverTemplateVersion_Working ON studio.CoverTemplateVersion (CoverTemplateId) WHERE Status IN (N'Draft', N'Submitted');
CREATE UNIQUE INDEX UX_CoverTemplateVersion_Approved ON studio.CoverTemplateVersion (CoverTemplateId) WHERE Status = N'Approved';
GO

DECLARE @Seed TABLE (Name NVARCHAR(80), Segment NVARCHAR(40), Description NVARCHAR(400), SettingsJson NVARCHAR(MAX));
INSERT @Seed VALUES
 (N'Classic band', N'All', N'The house cover: angled colour band, serif title, wordmark top left.',
  N'{"layout":"band","band":"tall","bandAngle":"angled","image":"none","theme":"navy","titleFont":"serif","titleSize":"l","titleWeight":"bold","logo":"wordmark","logoPosition":"top-left","businessTag":"Wealth & Investment"}'),
 (N'Skyline split', N'Private client', N'Image on the left half, title on the right; warm and modern.',
  N'{"layout":"split","band":"none","image":"skyline","overlay":0.35,"theme":"teal","titleFont":"serif","titleSize":"m","titleAlign":"left","logo":"wordmark","logoPosition":"bottom-left","businessTag":"Private Banking"}'),
 (N'Minimal', N'Corporate', N'White page, straight thin band, sans-serif title: for corporate and trust reporting.',
  N'{"layout":"minimal","band":"short","bandAngle":"straight","image":"none","theme":"graphite","titleFont":"sans","titleSize":"m","titleWeight":"bold","letterSpacing":"tight","logo":"wordmark","logoPosition":"top-right","eyebrowCase":"sentence","businessTag":""}'),
 (N'Family office', N'Family office', N'Centred title over a mountain image, relationship manager card and back cover.',
  N'{"layout":"centred","band":"none","image":"peaks","overlay":0.45,"theme":"burgundy","titleFont":"classic","titleSize":"l","titleAlign":"centre","titlePosition":"middle","logo":"monogram","logoPosition":"top-left","logoSize":"l","rmCard":true,"backCover":true,"businessTag":"Private Client Advisory"}');
INSERT studio.CoverTemplate (Name, Segment, Description) SELECT Name, Segment, Description FROM @Seed;
INSERT studio.CoverTemplateVersion (CoverTemplateId, Version, Status, SettingsJson, CreatedBy, SubmittedBy, SubmittedOn, ReviewedBy, ReviewedOn, ReviewComment)
SELECT t.CoverTemplateId, 1, N'Approved', s.SettingsJson, N'priya.shah', N'priya.shah', SYSUTCDATETIME(), N'james.mokoena', SYSUTCDATETIME(), N'Seeded and approved.'
FROM @Seed s JOIN studio.CoverTemplate t ON t.Name = s.Name;
GO
