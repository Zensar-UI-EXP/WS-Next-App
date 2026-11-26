/* 03_data_products.sql - consumer data products (schema dp): the only objects report queries may read.
   In the target architecture these are Fabric data products; here they are views and inline functions over the
   source schemas. Everything is in USD (the reporting currency), converted with the day's FX rate.

   Conventions
   - Returns are decimals (0.0123 = 1.23%), compounded as EXP(SUM(LOG(1 + r))) - 1.
   - DailyReturn (USD) = (MV - prior MV - NetFlow) / prior MV, with values converted at each day's own FX rate, so it
     includes the currency effect. LocalDailyReturn is the same in the account's currency.
   - An account's first valuation is its initial funding: PriorMarketValue = 0 and NetFlow = Deposits = the opening
     value. Returns of several accounts are combined weighted by PriorMarketValue, so the funding day carries no weight. */

USE WealthInsightsV10Db;
GO

CREATE VIEW dp.vw_HouseholdHierarchy
AS
SELECT h.HouseholdId, h.Name AS HouseholdName, h.Segment, h.RelationshipManager, h.ReviewFrequency, h.NextReviewDate,
       c.ClientId, c.Name AS ClientName, c.ClientType, c.RiskProfile, c.Mandate,
       a.AccountId, a.Code AS PortfolioCode, a.Name AS PortfolioName, a.Currency, b.Name AS BenchmarkName, a.InceptionDate
FROM src_client.Household h
JOIN src_client.Client c   ON c.HouseholdId = h.HouseholdId
JOIN src_client.Account a  ON a.ClientId = c.ClientId
JOIN src_market.Benchmark b ON b.BenchmarkId = a.BenchmarkId;
GO

CREATE VIEW dp.vw_AccountDailyPerformance
AS
WITH v AS (
    SELECT AccountId, ValueDate, MarketValueLocal, NetFlowLocal,
           LAG(MarketValueLocal) OVER (PARTITION BY AccountId ORDER BY ValueDate) AS PriorLocal,
           LAG(ValueDate)        OVER (PARTITION BY AccountId ORDER BY ValueDate) AS PriorDate
    FROM src_holdings.Valuation
), x AS (
    SELECT v.*, a.Currency,
           CAST(CASE WHEN a.Currency = 'USD' THEN 1 ELSE r.UsdPerUnit END AS FLOAT)  AS Fx,
           CAST(CASE WHEN a.Currency = 'USD' THEN 1 ELSE pr.UsdPerUnit END AS FLOAT) AS PriorFx
    FROM v
    JOIN src_client.Account a ON a.AccountId = v.AccountId
    LEFT JOIN src_market.FxRate r  ON r.Currency = a.Currency AND r.RateDate = v.ValueDate
    LEFT JOIN src_market.FxRate pr ON pr.Currency = a.Currency AND pr.RateDate = v.PriorDate
), t AS (
    SELECT AccountId, TxnDate,
           SUM(CASE WHEN Type = N'Deposit'    THEN AmountLocal ELSE 0 END) AS Deposits,
           SUM(CASE WHEN Type = N'Withdrawal' THEN AmountLocal ELSE 0 END) AS Withdrawals,
           SUM(CASE WHEN Type = N'Fee'        THEN AmountLocal ELSE 0 END) AS Fees
    FROM src_holdings.[Transaction]
    WHERE Type IN (N'Deposit', N'Withdrawal', N'Fee')
    GROUP BY AccountId, TxnDate
)
SELECT h.HouseholdId,
       h.Name          AS HouseholdName,
       c.ClientId,
       c.Name          AS ClientName,
       a.Code          AS PortfolioCode,
       a.Name          AS PortfolioName,
       a.Currency,
       x.ValueDate,
       CAST(CAST(x.MarketValueLocal AS FLOAT) * x.Fx AS DECIMAL(18,2))                       AS MarketValue,
       CAST(ISNULL(CAST(x.PriorLocal AS FLOAT) * x.PriorFx, 0) AS DECIMAL(18,2))              AS PriorMarketValue,
       CAST(CAST(CASE WHEN x.PriorLocal IS NULL THEN x.MarketValueLocal ELSE x.NetFlowLocal END AS FLOAT) * x.Fx AS DECIMAL(18,2)) AS NetFlow,
       CAST(CAST(ISNULL(t.Deposits, 0) + CASE WHEN x.PriorLocal IS NULL THEN x.MarketValueLocal ELSE 0 END AS FLOAT) * x.Fx AS DECIMAL(18,2)) AS Deposits,
       CAST(CAST(ISNULL(t.Withdrawals, 0) AS FLOAT) * x.Fx AS DECIMAL(18,2))                 AS Withdrawals,
       CAST(CAST(ISNULL(t.Fees, 0) AS FLOAT) * x.Fx AS DECIMAL(18,2))                        AS Fees,
       CASE WHEN x.PriorLocal IS NULL THEN 0
            ELSE (CAST(x.MarketValueLocal AS FLOAT) * x.Fx - CAST(x.PriorLocal AS FLOAT) * x.PriorFx - CAST(x.NetFlowLocal AS FLOAT) * x.Fx)
                 / (CAST(x.PriorLocal AS FLOAT) * x.PriorFx) END                             AS DailyReturn,
       CASE WHEN x.PriorLocal IS NULL THEN 0
            ELSE CAST(x.MarketValueLocal - x.PriorLocal - x.NetFlowLocal AS FLOAT) / CAST(x.PriorLocal AS FLOAT) END AS LocalDailyReturn,
       x.Fx            AS FxRate,
       b.Name          AS BenchmarkName,
       CAST(br.DailyReturn AS FLOAT) AS BenchmarkReturn
FROM x
JOIN src_client.Account a   ON a.AccountId = x.AccountId
JOIN src_client.Client c    ON c.ClientId = a.ClientId
JOIN src_client.Household h ON h.HouseholdId = c.HouseholdId
JOIN src_market.Benchmark b ON b.BenchmarkId = a.BenchmarkId
LEFT JOIN src_market.BenchmarkReturn br ON br.BenchmarkId = a.BenchmarkId AND br.ValueDate = x.ValueDate
LEFT JOIN t ON t.AccountId = x.AccountId AND t.TxnDate = x.ValueDate;
GO

/* Holdings of every account from its latest month-end snapshot on or before @AsOfDate, in USD, with the sector that
   was valid on the snapshot date ("Unclassified" when reference data has no classification for that date). */
CREATE FUNCTION dp.fn_HoldingSnapshot (@AsOfDate DATE)
RETURNS TABLE
AS
RETURN
SELECT hh.HouseholdId,
       hh.Name        AS HouseholdName,
       c.ClientId,
       c.Name         AS ClientName,
       a.Code         AS PortfolioCode,
       a.Name         AS PortfolioName,
       a.Currency     AS AccountCurrency,
       snap.SnapshotDate,
       i.Symbol,
       i.Name         AS SecurityName,
       i.AssetClass,
       COALESCE(cl.Sector, N'Unclassified') AS Sector,
       i.Region,
       i.Currency     AS InstrumentCurrency,
       CASE WHEN i.IsSpl = 1 THEN N'Structured product' ELSE N'Direct holding' END AS HoldingType,
       h.Quantity,
       CAST(CAST(h.MarketValueLocal AS FLOAT) * fx.Fx AS DECIMAL(18,2)) AS MarketValue,
       CAST(h.MarketValueLocal / NULLIF(SUM(h.MarketValueLocal) OVER (PARTITION BY h.AccountId), 0) AS DECIMAL(12,8)) AS Weight
FROM src_client.Account a
JOIN src_client.Client c     ON c.ClientId = a.ClientId
JOIN src_client.Household hh ON hh.HouseholdId = c.HouseholdId
CROSS APPLY (SELECT MAX(AsOfDate) AS SnapshotDate FROM src_holdings.Holding
             WHERE AccountId = a.AccountId AND AsOfDate <= @AsOfDate) snap
JOIN src_holdings.Holding h      ON h.AccountId = a.AccountId AND h.AsOfDate = snap.SnapshotDate
JOIN src_reference.Instrument i  ON i.InstrumentId = h.InstrumentId
OUTER APPLY (SELECT TOP (1) Sector FROM src_reference.InstrumentClassification
             WHERE InstrumentId = i.InstrumentId AND ValidFrom <= snap.SnapshotDate AND (ValidTo IS NULL OR ValidTo >= snap.SnapshotDate)
             ORDER BY ValidFrom DESC) cl
CROSS APPLY (SELECT CAST(CASE WHEN a.Currency = 'USD' THEN 1
                              ELSE (SELECT UsdPerUnit FROM src_market.FxRate WHERE Currency = a.Currency AND RateDate = snap.SnapshotDate) END AS FLOAT) AS Fx) fx;
GO

/* Look-through exposure: like fn_HoldingSnapshot, but each structured product is split into its components
   (e.g. 80% zero-coupon bond, 20% index option), so asset-class exposure shows what the client is really exposed to. */
CREATE FUNCTION dp.fn_ExposureSnapshot (@AsOfDate DATE)
RETURNS TABLE
AS
RETURN
SELECT s.HouseholdId, s.HouseholdName, s.ClientId, s.ClientName, s.PortfolioCode, s.PortfolioName, s.AccountCurrency, s.SnapshotDate,
       s.Symbol, s.SecurityName, s.AssetClass, s.Sector, s.Region, s.InstrumentCurrency, s.HoldingType,
       N'Direct' AS ExposureType, s.MarketValue, s.Weight
FROM dp.fn_HoldingSnapshot(@AsOfDate) s
WHERE s.HoldingType = N'Direct holding'
UNION ALL
SELECT s.HouseholdId, s.HouseholdName, s.ClientId, s.ClientName, s.PortfolioCode, s.PortfolioName, s.AccountCurrency, s.SnapshotDate,
       s.Symbol, CONCAT(s.SecurityName, N' · ', k.ComponentName), k.AssetClass, s.Sector, s.Region, s.InstrumentCurrency, s.HoldingType,
       N'Look-through', CAST(s.MarketValue * k.Weight AS DECIMAL(18,2)), CAST(s.Weight * k.Weight AS DECIMAL(12,8))
FROM dp.fn_HoldingSnapshot(@AsOfDate) s
JOIN src_reference.Instrument i    ON i.Symbol = s.Symbol
JOIN src_reference.SplComponent k  ON k.InstrumentId = i.InstrumentId
WHERE s.HoldingType = N'Structured product';
GO

/* ---------- Descriptions (MS_Description), shown in the governance screens ---------- */

EXEC sys.sp_addextendedproperty N'MS_Description', N'Households, their client entities and accounts, with mandate, risk profile, account currency and benchmark.', N'SCHEMA', N'dp', N'VIEW', N'vw_HouseholdHierarchy';
EXEC sys.sp_addextendedproperty N'MS_Description', N'One row per account per business day in USD: market value, prior value, external flows (initial funding counts as a deposit), fees, the USD and local-currency daily returns, the FX rate and the benchmark''s daily return.', N'SCHEMA', N'dp', N'VIEW', N'vw_AccountDailyPerformance';
EXEC sys.sp_addextendedproperty N'MS_Description', N'Holdings of every account from its latest month-end snapshot on or before @AsOfDate, in USD, with the effective-dated sector.', N'SCHEMA', N'dp', N'FUNCTION', N'fn_HoldingSnapshot';
EXEC sys.sp_addextendedproperty N'MS_Description', N'Look-through exposure at @AsOfDate: direct holdings plus structured products split into their components.', N'SCHEMA', N'dp', N'FUNCTION', N'fn_ExposureSnapshot';
GO
