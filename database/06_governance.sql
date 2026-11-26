/* 06_governance.sql - trust, control and governance: the disclosure library, data-quality rules and the procedure
   that checks the source data, and data-product lineage. Ends with a first data-quality run.
   Idempotent: clears and reseeds the reference rows; exceptions keep their status (the procedure merges). */

USE WealthInsightsV10Db;
GO
SET NOCOUNT ON;
GO

/* ---------- Disclosure library (content studio) ---------- */

DELETE FROM src_content.Disclosure;
INSERT src_content.Disclosure (DisclosureCode, Title, Text, AppliesWhen, Version, EffectiveFrom, Owner) VALUES
 (N'PERF_GENERAL', N'Past performance', N'Past performance is not a reliable indicator of future results. The value of investments and the income from them can fall as well as rise and you may get back less than you invested.',
  N'Always', 3, '2025-01-01', N'Compliance'),
 (N'METHODOLOGY', N'How we calculate returns', N'Time-weighted returns (TWR) are calculated from daily valuations in US dollars, after fees and transaction costs but before tax, and combine accounts by value. Money-weighted returns (MWR) use the Modified Dietz method and reflect the timing and size of your deposits and withdrawals. Returns for periods longer than one year are annualised. Benchmarks are shown for comparison only.',
  N'Always', 2, '2026-09-01', N'Performance & analytics'),
 (N'ILLUSTRATIVE', N'Illustrative data', N'This report uses illustrative data for demonstration purposes only and is not investment advice.',
  N'Always', 1, '2026-01-01', N'Compliance'),
 (N'FX_RISK', N'Currency risk', N'Some of your accounts are held in currencies other than the US dollar. Their values and returns are converted to US dollars at daily closing exchange rates; changes in exchange rates can increase or reduce their value in US dollars.',
  N'MultiCurrency', 1, '2026-09-01', N'Compliance'),
 (N'SPL_RISK', N'Structured products', N'Structured products carry the credit risk of their issuer and may be difficult to sell before maturity. Any capital protection applies only at maturity and only if the issuer is able to pay. The look-through view splits each product into its components for illustration; it is not a valuation of those components.',
  N'StructuredProducts', 2, '2026-09-01', N'Compliance'),
 (N'ADVISORY', N'Advisory accounts', N'Your accounts are managed on an advisory basis: investment decisions are yours, made on the basis of our recommendations. We are responsible for the suitability of the advice we give.',
  N'Advisory', 1, '2025-01-01', N'Compliance');

/* ---------- Data-product lineage ---------- */

DELETE FROM gov.DataProductLineage;
INSERT gov.DataProductLineage (DataProduct, SourceSystem, SourceObject, Description) VALUES
 (N'dp.vw_AccountDailyPerformance', N'Holdings, transactions & valuations', N'src_holdings.Valuation',        N'Daily account valuations and external flows in the account currency.'),
 (N'dp.vw_AccountDailyPerformance', N'Holdings, transactions & valuations', N'src_holdings.Transaction',      N'Deposits, withdrawals and fees.'),
 (N'dp.vw_AccountDailyPerformance', N'Market data, FX & benchmarks',        N'src_market.FxRate',             N'Daily closing FX rates to convert to USD.'),
 (N'dp.vw_AccountDailyPerformance', N'Market data, FX & benchmarks',        N'src_market.BenchmarkReturn',    N'Benchmark daily returns.'),
 (N'dp.vw_AccountDailyPerformance', N'Client management / Understanding You', N'src_client.Account',          N'Household, entity and account hierarchy, account currency and benchmark.'),
 (N'dp.fn_HoldingSnapshot',         N'Holdings, transactions & valuations', N'src_holdings.Holding',          N'Month-end positions in the account currency.'),
 (N'dp.fn_HoldingSnapshot',         N'Product, instrument & reference data', N'src_reference.Instrument',     N'Asset class, region, currency and structured-product flag.'),
 (N'dp.fn_HoldingSnapshot',         N'Product, instrument & reference data', N'src_reference.InstrumentClassification', N'Effective-dated sector classification.'),
 (N'dp.fn_HoldingSnapshot',         N'Market data, FX & benchmarks',        N'src_market.FxRate',             N'FX rate on the snapshot date.'),
 (N'dp.fn_HoldingSnapshot',         N'Client management / Understanding You', N'src_client.Account',          N'Household, entity and account hierarchy.'),
 (N'dp.fn_ExposureSnapshot',        N'Data product',                        N'dp.fn_HoldingSnapshot',         N'Holdings in USD.'),
 (N'dp.fn_ExposureSnapshot',        N'Product, instrument & reference data', N'src_reference.SplComponent',   N'Structured-product components and weights for look-through.'),
 (N'dp.vw_HouseholdHierarchy',      N'Client management / Understanding You', N'src_client.Household',        N'Households, entities, accounts, mandate and risk profile.'),
 (N'src_content.Disclosure',        N'Content studio & disclosures',        N'src_content.Disclosure',        N'Approved disclosure wording, versioned.');

/* ---------- Data-quality rules ---------- */

IF NOT EXISTS (SELECT 1 FROM gov.DataQualityRule)
INSERT gov.DataQualityRule (RuleCode, Name, Severity, Description, Owner) VALUES
 (N'VAL_STALE',        N'Stale valuations',        N'Blocker', N'An account''s latest valuation is older than the latest business date loaded for all accounts.', N'Reporting operations'),
 (N'FX_MISSING',       N'Missing FX rate',         N'Blocker', N'A non-USD account has a valuation on a day without an FX rate, so it cannot be converted to USD.', N'Market data'),
 (N'VAL_GAP',          N'Missing valuation days',  N'Warning', N'A business day between an account''s first and latest valuation has no valuation; the next day''s return covers several days.', N'Reporting operations'),
 (N'PRICE_JUMP',       N'Unusual daily return',    N'Warning', N'A local-currency daily return above 5% or below -5%; often a bad price.', N'Reporting operations'),
 (N'HOLD_RECON',       N'Holdings do not reconcile', N'Warning', N'A month-end holdings snapshot does not add up to the account''s valuation (tolerance 0.01%).', N'Reporting operations'),
 (N'REF_UNCLASSIFIED', N'Unclassified instrument', N'Warning', N'A held instrument has no sector classification valid on the snapshot date.', N'Reference data');
GO

/* ---------- The data-quality run ----------
   Finds exceptions and merges them: new findings are Open; a finding someone marked Resolved that is found again is
   re-opened; Open or Acknowledged findings that are no longer found are Resolved by the run. Acknowledged findings stay
   Acknowledged (operations has signed them off). Returns the counts. */

CREATE OR ALTER PROCEDURE gov.usp_RunDataQuality @RunBy NVARCHAR(30) = N'system'
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @AsOf DATE = (SELECT MAX(ValueDate) FROM src_holdings.Valuation);
    DECLARE @First DATE = (SELECT MIN(ValueDate) FROM src_holdings.Valuation);

    CREATE TABLE #Days (D DATE PRIMARY KEY);
    INSERT #Days (D)
    SELECT d FROM (
        SELECT TOP (DATEDIFF(DAY, @First, @AsOf) + 1) DATEADD(DAY, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1, @First) AS d
        FROM sys.all_objects a CROSS JOIN sys.all_objects b
    ) x
    WHERE DATEDIFF(DAY, '19000101', d) % 7 < 5;

    CREATE TABLE #Found (
        ExceptionKey NVARCHAR(200) PRIMARY KEY, RuleCode NVARCHAR(30), AccountId INT NULL, InstrumentId INT NULL, AsOfDate DATE, Detail NVARCHAR(400)
    );

    -- Stale valuations: the account's last valuation is before the latest business date.
    INSERT #Found
    SELECT CONCAT(N'VAL_STALE|', a.AccountId, N'|', @AsOf), N'VAL_STALE', a.AccountId, NULL, @AsOf,
           CONCAT(N'Latest valuation for ', a.Code, N' is ', CONVERT(NVARCHAR(10), r.LastDate, 23), N'; other accounts are valued to ', CONVERT(NVARCHAR(10), @AsOf, 23), N'.')
    FROM src_client.Account a
    CROSS APPLY (SELECT MAX(ValueDate) AS LastDate FROM src_holdings.Valuation WHERE AccountId = a.AccountId) r
    WHERE r.LastDate < @AsOf;

    -- Missing valuation days between an account's first and last valuation.
    INSERT #Found
    SELECT CONCAT(N'VAL_GAP|', a.AccountId, N'|', d.D), N'VAL_GAP', a.AccountId, NULL, d.D,
           CONCAT(N'No valuation for ', a.Code, N' on ', CONVERT(NVARCHAR(10), d.D, 23), N'.')
    FROM src_client.Account a
    CROSS APPLY (SELECT MIN(ValueDate) AS F, MAX(ValueDate) AS T FROM src_holdings.Valuation WHERE AccountId = a.AccountId) r
    JOIN #Days d ON d.D > r.F AND d.D < r.T
    WHERE NOT EXISTS (SELECT 1 FROM src_holdings.Valuation v WHERE v.AccountId = a.AccountId AND v.ValueDate = d.D);

    -- FX rate missing for a non-USD valuation.
    INSERT #Found
    SELECT CONCAT(N'FX_MISSING|', a.AccountId, N'|', v.ValueDate), N'FX_MISSING', a.AccountId, NULL, v.ValueDate,
           CONCAT(N'No ', a.Currency, N' rate on ', CONVERT(NVARCHAR(10), v.ValueDate, 23), N' to convert ', a.Code, N' to USD.')
    FROM src_holdings.Valuation v
    JOIN src_client.Account a ON a.AccountId = v.AccountId
    WHERE a.Currency <> 'USD'
      AND NOT EXISTS (SELECT 1 FROM src_market.FxRate r WHERE r.Currency = a.Currency AND r.RateDate = v.ValueDate);

    -- Unusual daily return in the account currency.
    INSERT #Found
    SELECT CONCAT(N'PRICE_JUMP|', a.AccountId, N'|', p.ValueDate), N'PRICE_JUMP', a.AccountId, NULL, p.ValueDate,
           CONCAT(a.Code, N' moved ', FORMAT(p.LocalDailyReturn, 'P2'), N' on ', CONVERT(NVARCHAR(10), p.ValueDate, 23), N' in ', a.Currency, N'.')
    FROM dp.vw_AccountDailyPerformance p
    JOIN src_client.Account a ON a.Code = p.PortfolioCode
    WHERE ABS(p.LocalDailyReturn) > 0.05;

    -- Holdings snapshot does not add up to the valuation.
    INSERT #Found
    SELECT CONCAT(N'HOLD_RECON|', h.AccountId, N'|', h.AsOfDate), N'HOLD_RECON', h.AccountId, NULL, h.AsOfDate,
           CONCAT(N'Holdings for ', a.Code, N' on ', CONVERT(NVARCHAR(10), h.AsOfDate, 23), N' total ', FORMAT(h.Total, 'N2'),
                  N' but the valuation is ', FORMAT(v.MarketValueLocal, 'N2'), N' ', a.Currency, N'.')
    FROM (SELECT AccountId, AsOfDate, SUM(MarketValueLocal) AS Total FROM src_holdings.Holding GROUP BY AccountId, AsOfDate) h
    JOIN src_holdings.Valuation v ON v.AccountId = h.AccountId AND v.ValueDate = h.AsOfDate
    JOIN src_client.Account a ON a.AccountId = h.AccountId
    WHERE ABS(h.Total - v.MarketValueLocal) > 0.0001 * v.MarketValueLocal;

    -- Held instrument without a classification on the snapshot date.
    INSERT #Found
    SELECT CONCAT(N'REF_UNCLASSIFIED|', i.InstrumentId, N'|', h.AsOfDate), N'REF_UNCLASSIFIED', NULL, i.InstrumentId, h.AsOfDate,
           CONCAT(i.Name, N' (', i.Symbol, N') has no sector classification valid on ', CONVERT(NVARCHAR(10), h.AsOfDate, 23), N'.')
    FROM (SELECT DISTINCT InstrumentId, AsOfDate FROM src_holdings.Holding) h
    JOIN src_reference.Instrument i ON i.InstrumentId = h.InstrumentId
    WHERE NOT EXISTS (SELECT 1 FROM src_reference.InstrumentClassification c
                      WHERE c.InstrumentId = h.InstrumentId AND c.ValidFrom <= h.AsOfDate AND (c.ValidTo IS NULL OR c.ValidTo >= h.AsOfDate));

    -- Merge.
    INSERT gov.DataQualityException (ExceptionKey, RuleCode, AccountId, InstrumentId, AsOfDate, Detail, Status)
    SELECT f.ExceptionKey, f.RuleCode, f.AccountId, f.InstrumentId, f.AsOfDate, f.Detail, N'Open'
    FROM #Found f
    WHERE NOT EXISTS (SELECT 1 FROM gov.DataQualityException e WHERE e.ExceptionKey = f.ExceptionKey);
    DECLARE @New INT = @@ROWCOUNT;

    UPDATE e SET Status = N'Open', Detail = f.Detail, UpdatedBy = @RunBy, UpdatedOn = SYSUTCDATETIME(), Note = N'Found again by the data-quality run.'
    FROM gov.DataQualityException e JOIN #Found f ON f.ExceptionKey = e.ExceptionKey
    WHERE e.Status = N'Resolved';
    DECLARE @Reopened INT = @@ROWCOUNT;

    UPDATE e SET Status = N'Resolved', UpdatedBy = @RunBy, UpdatedOn = SYSUTCDATETIME(), Note = N'No longer found by the data-quality run.'
    FROM gov.DataQualityException e
    WHERE e.Status <> N'Resolved' AND NOT EXISTS (SELECT 1 FROM #Found f WHERE f.ExceptionKey = e.ExceptionKey);
    DECLARE @Cleared INT = @@ROWCOUNT;

    SELECT @New AS NewExceptions, @Reopened AS Reopened, @Cleared AS Cleared,
           (SELECT COUNT(*) FROM gov.DataQualityException WHERE Status <> N'Resolved') AS OpenOrAcknowledged, @AsOf AS AsOfDate;
END;
GO

GRANT EXECUTE ON gov.usp_RunDataQuality TO wis10_app;
GO

EXEC gov.usp_RunDataQuality @RunBy = N'system';
GO
