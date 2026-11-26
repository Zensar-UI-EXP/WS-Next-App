/* 05_security.sql - logins and grants. Run with sqlcmd so the password variables are substituted:
     sqlcmd -S localhost -U sa -C -i 05_security.sql -v ReaderPassword="<password>" AppPassword="<password>"

   wis10_reader: runs every report query. SELECT on the dp (data product) schema only, DENY on every other schema.
               The data products are owned by dbo like the source tables, so ownership chaining lets them read the
               sources without granting wis10_reader anything there.
   wis10_app:    the API's application login: studio (read/write), source reference data and data products (read),
               data-quality exceptions (status changes), and the audit and AI logs, which are append-only. */

USE master;
GO
IF SUSER_ID(N'wis10_reader') IS NULL
    CREATE LOGIN wis10_reader WITH PASSWORD = N'$(ReaderPassword)', CHECK_POLICY = ON, DEFAULT_DATABASE = WealthInsightsV10Db;
ELSE
    ALTER LOGIN wis10_reader WITH PASSWORD = N'$(ReaderPassword)';

IF SUSER_ID(N'wis10_app') IS NULL
    CREATE LOGIN wis10_app WITH PASSWORD = N'$(AppPassword)', CHECK_POLICY = ON, DEFAULT_DATABASE = WealthInsightsV10Db;
ELSE
    ALTER LOGIN wis10_app WITH PASSWORD = N'$(AppPassword)';
GO

USE WealthInsightsV10Db;
GO
DROP USER IF EXISTS wis10_reader;
DROP USER IF EXISTS wis10_app;
GO
CREATE USER wis10_reader FOR LOGIN wis10_reader WITH DEFAULT_SCHEMA = dp;
CREATE USER wis10_app FOR LOGIN wis10_app WITH DEFAULT_SCHEMA = studio;
GO

GRANT SELECT ON SCHEMA::dp TO wis10_reader;
DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::src_client    TO wis10_reader;
DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::src_holdings  TO wis10_reader;
DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::src_reference TO wis10_reader;
DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::src_market    TO wis10_reader;
DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::src_content   TO wis10_reader;
DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::studio        TO wis10_reader;
DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::gov           TO wis10_reader;
DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::dbo           TO wis10_reader;
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::studio TO wis10_app;
GRANT SELECT, VIEW DEFINITION ON SCHEMA::dp TO wis10_app;
GRANT SELECT ON SCHEMA::src_client    TO wis10_app;
GRANT SELECT ON SCHEMA::src_reference TO wis10_app;
GRANT SELECT ON SCHEMA::src_market    TO wis10_app;
GRANT SELECT ON SCHEMA::src_content   TO wis10_app;
DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::src_holdings TO wis10_app;   -- holdings are read through dp only

GRANT SELECT ON gov.DataQualityRule    TO wis10_app;
GRANT SELECT ON gov.DataProductLineage TO wis10_app;
GRANT SELECT, UPDATE ON gov.DataQualityException TO wis10_app;
GRANT SELECT, INSERT ON gov.AuditEvent TO wis10_app;
DENY UPDATE, DELETE ON gov.AuditEvent TO wis10_app;                         -- the audit trail is append-only
GRANT SELECT, INSERT, UPDATE ON gov.AiInteraction TO wis10_app;             -- UPDATE records the outcome of the checks
DENY DELETE ON gov.AiInteraction TO wis10_app;
GO
