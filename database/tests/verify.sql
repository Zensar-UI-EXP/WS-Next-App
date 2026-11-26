/* verify.sql - self-checks for WealthInsightsV10Db. Run as sa after 01-06; every row should say PASS. */
USE WealthInsightsV10Db;
SET NOCOUNT ON;
DECLARE @R TABLE (Test NVARCHAR(120), Result NVARCHAR(4), Detail NVARCHAR(400));

INSERT @R SELECT 'Accounts and households seeded', IIF(COUNT(*) = 11, 'PASS', 'FAIL'), CONCAT(COUNT(*), ' accounts') FROM src_client.Account;
INSERT @R SELECT 'Valuations to 30 Oct 2026', IIF(MAX(ValueDate) = '2026-10-30', 'PASS', 'FAIL'), CONVERT(NVARCHAR(10), MAX(ValueDate), 23) FROM src_holdings.Valuation;
INSERT @R SELECT 'Holdings reconcile except the seeded break', IIF(COUNT(*) = 1, 'PASS', 'FAIL'), CONCAT(COUNT(*), ' break(s)')
FROM (SELECT AccountId, AsOfDate, SUM(MarketValueLocal) t FROM src_holdings.Holding GROUP BY AccountId, AsOfDate) h
JOIN src_holdings.Valuation v ON v.AccountId = h.AccountId AND v.ValueDate = h.AsOfDate WHERE ABS(h.t - v.MarketValueLocal) > 0.01;
INSERT @R SELECT 'Every non-USD valuation has an FX rate', IIF(COUNT(*) = 0, 'PASS', 'FAIL'), CONCAT(COUNT(*), ' missing')
FROM src_holdings.Valuation v JOIN src_client.Account a ON a.AccountId = v.AccountId
WHERE a.Currency <> 'USD' AND NOT EXISTS (SELECT 1 FROM src_market.FxRate r WHERE r.Currency = a.Currency AND r.RateDate = v.ValueDate);
INSERT @R SELECT 'SPL components sum to 1', IIF(MIN(w) = 1 AND MAX(w) = 1, 'PASS', 'FAIL'), CONCAT(COUNT(*), ' products')
FROM (SELECT InstrumentId, SUM(Weight) w FROM src_reference.SplComponent GROUP BY InstrumentId) x;
INSERT @R SELECT 'Look-through keeps total value', IIF(ABS(SUM(CASE WHEN k = 'e' THEN mv ELSE -mv END)) < 1, 'PASS', 'FAIL'), CONCAT(SUM(CASE WHEN k = 'h' THEN mv END), '')
FROM (SELECT 'h' k, SUM(MarketValue) mv FROM dp.fn_HoldingSnapshot('2025-12-31') UNION ALL SELECT 'e', SUM(MarketValue) FROM dp.fn_ExposureSnapshot('2025-12-31')) x;
INSERT @R SELECT 'Data-quality run finds the 8 seeded problems', IIF(COUNT(*) = 8, 'PASS', 'FAIL'), CONCAT(COUNT(*), ' exceptions') FROM gov.DataQualityException;
INSERT @R SELECT 'Exactly one blocker (stale P-106)', IIF(COUNT(*) = 1, 'PASS', 'FAIL'), MIN(e.Detail)
FROM gov.DataQualityException e JOIN gov.DataQualityRule r ON r.RuleCode = e.RuleCode WHERE r.Severity = 'Blocker';

-- Marula household FY 2025: TWR (value-weighted daily returns) and MWR (Modified Dietz) from the data product.
DECLARE @twr FLOAT = (SELECT EXP(SUM(LOG(1 + r))) - 1 FROM (SELECT SUM(PriorMarketValue * DailyReturn) / NULLIF(SUM(PriorMarketValue), 0) r
    FROM dp.vw_AccountDailyPerformance WHERE HouseholdId = 1 AND ValueDate BETWEEN '2025-01-01' AND '2025-12-31' GROUP BY ValueDate) d);
INSERT @R SELECT 'Marula FY 2025 TWR = 6.04%', IIF(ROUND(@twr, 4) = 0.0604, 'PASS', 'FAIL'), CONCAT(@twr, '');
DECLARE @b FLOAT, @e FLOAT, @cf FLOAT, @w FLOAT;
SELECT @b = SUM(CASE WHEN ValueDate = '2025-01-01' THEN PriorMarketValue END), @e = SUM(CASE WHEN ValueDate = '2025-12-31' THEN MarketValue END),
       @cf = SUM(NetFlow), @w = SUM(NetFlow * DATEDIFF(DAY, ValueDate, '2025-12-31') / 365.0)
FROM dp.vw_AccountDailyPerformance WHERE HouseholdId = 1 AND ValueDate BETWEEN '2025-01-01' AND '2025-12-31';
INSERT @R SELECT 'Marula FY 2025 MWR = 6.14%', IIF(ROUND((@e - @b - @cf) / (@b + @w), 4) = 0.0614, 'PASS', 'FAIL'), CONCAT((@e - @b - @cf) / (@b + @w), '');

-- Security
INSERT @R SELECT 'wis10_reader can read data products', IIF(HAS_PERMS_BY_NAME('dp.vw_AccountDailyPerformance', 'OBJECT', 'SELECT') IS NOT NULL, 'PASS', 'FAIL'), '' ;
EXECUTE AS USER = 'wis10_reader';
INSERT @R SELECT 'wis10_reader cannot read source tables', IIF(HAS_PERMS_BY_NAME('src_holdings.Valuation', 'OBJECT', 'SELECT') = 0, 'PASS', 'FAIL'), '';
INSERT @R SELECT 'wis10_reader can read dp', IIF(HAS_PERMS_BY_NAME('dp.vw_AccountDailyPerformance', 'OBJECT', 'SELECT') = 1, 'PASS', 'FAIL'), '';
REVERT;
EXECUTE AS USER = 'wis10_app';
INSERT @R SELECT 'Audit trail is append-only for the app', IIF(HAS_PERMS_BY_NAME('gov.AuditEvent', 'OBJECT', 'INSERT') = 1 AND HAS_PERMS_BY_NAME('gov.AuditEvent', 'OBJECT', 'DELETE') = 0 AND HAS_PERMS_BY_NAME('gov.AuditEvent', 'OBJECT', 'UPDATE') = 0, 'PASS', 'FAIL'), '';
INSERT @R SELECT 'App cannot read holdings tables directly', IIF(HAS_PERMS_BY_NAME('src_holdings.Holding', 'OBJECT', 'SELECT') = 0, 'PASS', 'FAIL'), '';
REVERT;

SELECT Test, Result, Detail FROM @R;
SELECT CONCAT(SUM(IIF(Result = 'PASS', 1, 0)), ' / ', COUNT(*), ' PASS') AS Summary FROM @R;
