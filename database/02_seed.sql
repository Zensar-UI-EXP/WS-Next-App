/* 02_seed.sql - POC sample data (dummy clients only) for the source systems, plus studio users.
   All "random" numbers come from a SHA-256 hash of a fixed key, so every run produces exactly the same data.

   - 5 households, 7 client entities, 11 accounts in USD, GBP and EUR, valued every business day (Mon-Fri) from
     inception (2 Jan 2023 for most) to 30 Oct 2026, in the account's own currency.
   - Daily GBP and EUR rates (random walks), three USD benchmarks.
   - Month-end holdings (equities, bonds, funds, cash, and structured products in one account) that sum to the
     valuation, an effective-dated sector reclassification (Visa) and a classification gap (property fund, July 2026).
   - Seeded data problems for the data-quality checks: P-106 valuations stop on 27 Oct 2026 (stale), P-108 has no
     valuations for 14-16 Sep 2026 (gap), P-104 has a bad price on 15 May 2024 (spike and revert) and its June 2026
     holdings do not reconcile to the valuation. */

USE WealthInsightsV10Db;
GO
SET NOCOUNT ON;
GO

DROP FUNCTION IF EXISTS dbo.fn_SeedRandom;
GO
/* Deterministic uniform number in [0, 1) derived from a text key. Dropped at the end of this script. */
CREATE FUNCTION dbo.fn_SeedRandom (@Key NVARCHAR(200))
RETURNS FLOAT
AS
BEGIN
    RETURN (CAST(CAST(SUBSTRING(HASHBYTES('SHA2_256', @Key), 1, 4) AS INT) AS BIGINT) + 2147483648) / 4294967296.0;
END;
GO

/* ---------- Master data ---------- */

INSERT src_market.Benchmark (BenchmarkId, Name) VALUES
    (1, N'Equity Index'),
    (2, N'Balanced 60/40'),
    (3, N'Conservative 30/70');

INSERT src_client.Household (HouseholdId, Name, Segment, ReportingCurrency, RelationshipManager, ReviewFrequency, NextReviewDate) VALUES
    (1, N'Marula Family',    N'Family office',  'USD', N'Eleanor Hartley', N'Annual',      '2027-02-06'),
    (2, N'Okafor Group',     N'Corporate',      'USD', N'Eleanor Hartley', N'Semi-annual', '2027-01-15'),
    (3, N'Raman Household',  N'Private client', 'USD', N'Eleanor Hartley', N'Annual',      '2027-03-12'),
    (4, N'Becker Family',    N'Private client', 'USD', N'Daniel Brooks',   N'Quarterly',   '2026-12-04'),
    (5, N'Lindqvist Family', N'Private client', 'USD', N'Daniel Brooks',   N'Semi-annual', '2027-04-20');

INSERT src_client.Client (ClientId, HouseholdId, Name, ClientType, RiskProfile, Mandate) VALUES
    (1, 1, N'Marula Family Office',  N'Family office', N'Balanced',     N'Discretionary'),
    (2, 1, N'Marula Family Trust',   N'Trust',         N'Conservative', N'Discretionary'),
    (3, 2, N'Okafor Holdings Ltd',   N'Company',       N'Growth',       N'Discretionary'),
    (4, 3, N'Priya Raman',           N'Individual',    N'Conservative', N'Advisory'),
    (5, 4, N'Becker Family Trust',   N'Trust',         N'Growth',       N'Discretionary'),
    (6, 5, N'Erik Lindqvist',        N'Individual',    N'Balanced',     N'Advisory'),
    (7, 5, N'Lindqvist Holdings AB', N'Company',       N'Conservative', N'Advisory');

INSERT src_client.Account (AccountId, ClientId, Code, Name, Currency, BenchmarkId, InceptionDate) VALUES
    ( 1, 1, N'P-101', N'Marula Balanced',          'USD', 2, '2023-01-02'),
    ( 2, 1, N'P-102', N'Marula Growth Sleeve',     'USD', 1, '2023-01-02'),
    ( 3, 2, N'P-109', N'Marula Trust Sterling',    'GBP', 3, '2023-01-02'),
    ( 4, 1, N'P-110', N'Marula Structured Income', 'USD', 2, '2024-01-02'),
    ( 5, 3, N'P-103', N'Okafor Global Growth',     'USD', 1, '2023-01-02'),
    ( 6, 3, N'P-104', N'Okafor Technology Tilt',   'USD', 1, '2023-01-02'),
    ( 7, 4, N'P-105', N'Raman Capital Preserve',   'USD', 3, '2023-01-02'),
    ( 8, 4, N'P-111', N'Raman Euro Reserve',       'EUR', 3, '2024-07-01'),
    ( 9, 5, N'P-106', N'Becker Equity Growth',     'USD', 1, '2023-01-02'),
    (10, 6, N'P-107', N'Lindqvist Balanced',       'USD', 2, '2024-04-01'),
    (11, 7, N'P-108', N'Lindqvist Income',         'EUR', 3, '2025-07-01');

INSERT src_reference.Instrument (InstrumentId, Symbol, Name, AssetClass, Region, Currency, IsSpl) VALUES
    ( 1, N'AAPL',    N'Apple Inc.',                                N'Equity',     N'United States',    'USD', 0),
    ( 2, N'MSFT',    N'Microsoft Corp.',                           N'Equity',     N'United States',    'USD', 0),
    ( 3, N'NVDA',    N'NVIDIA Corp.',                              N'Equity',     N'United States',    'USD', 0),
    ( 4, N'JNJ',     N'Johnson & Johnson',                         N'Equity',     N'United States',    'USD', 0),
    ( 5, N'UNH',     N'UnitedHealth Group',                        N'Equity',     N'United States',    'USD', 0),
    ( 6, N'JPM',     N'JPMorgan Chase & Co.',                      N'Equity',     N'United States',    'USD', 0),
    ( 7, N'V',       N'Visa Inc.',                                 N'Equity',     N'United States',    'USD', 0),
    ( 8, N'XOM',     N'Exxon Mobil Corp.',                         N'Equity',     N'United States',    'USD', 0),
    ( 9, N'PG',      N'Procter & Gamble Co.',                      N'Equity',     N'United States',    'USD', 0),
    (10, N'CAT',     N'Caterpillar Inc.',                          N'Equity',     N'United States',    'USD', 0),
    (11, N'UST2Y',   N'US Treasury 2Y Note',                       N'Bond',       N'United States',    'USD', 0),
    (12, N'UST10Y',  N'US Treasury 10Y Note',                      N'Bond',       N'United States',    'USD', 0),
    (13, N'IGC31',   N'Investment Grade Corp Bond 2031',           N'Bond',       N'United States',    'USD', 0),
    (14, N'HYC29',   N'High Yield Corp Bond 2029',                 N'Bond',       N'United States',    'USD', 0),
    (15, N'MUNI28',  N'Municipal Bond 2028',                       N'Bond',       N'United States',    'USD', 0),
    (16, N'GLEQF',   N'Global Equity Fund',                        N'Fund',       N'Global',           'USD', 0),
    (17, N'EMEQF',   N'Emerging Markets Equity Fund',              N'Fund',       N'Emerging markets', 'USD', 0),
    (18, N'MAINF',   N'Multi-Asset Income Fund',                   N'Fund',       N'Global',           'USD', 0),
    (19, N'PROPF',   N'Global Property Fund',                      N'Fund',       N'Global',           'USD', 0),
    (20, N'CASH',    N'Cash (USD)',                                N'Cash',       N'United States',    'USD', 0),
    (21, N'SPXAC27', N'S&P 500 Autocall Note 2027',                N'Structured', N'United States',    'USD', 1),
    (22, N'SX5ECP28',N'Euro Stoxx 50 Capital Protected Note 2028', N'Structured', N'Europe',           'EUR', 1),
    (23, N'CASHGBP', N'Cash (GBP)',                                N'Cash',       N'United Kingdom',   'GBP', 0),
    (24, N'CASHEUR', N'Cash (EUR)',                                N'Cash',       N'Europe',           'EUR', 0),
    (25, N'UKG30',   N'UK Gilt 2030',                              N'Bond',       N'United Kingdom',   'GBP', 0),
    (26, N'BUND29',  N'German Bund 2029',                          N'Bond',       N'Europe',           'EUR', 0);

/* Sectors from 1 Jan 2020. Visa moved from Technology to Financials on 17 Mar 2023 (a real reclassification); the
   property fund's classification lapses for July 2026 before "Real Assets" starts (a reference-data gap). */
INSERT src_reference.InstrumentClassification (InstrumentId, Sector, ValidFrom, ValidTo) VALUES
    ( 1, N'Technology', '2020-01-01', NULL), ( 2, N'Technology', '2020-01-01', NULL), ( 3, N'Technology', '2020-01-01', NULL),
    ( 4, N'Healthcare', '2020-01-01', NULL), ( 5, N'Healthcare', '2020-01-01', NULL), ( 6, N'Financials', '2020-01-01', NULL),
    ( 7, N'Technology', '2020-01-01', '2023-03-16'), ( 7, N'Financials', '2023-03-17', NULL),
    ( 8, N'Energy', '2020-01-01', NULL), ( 9, N'Consumer Staples', '2020-01-01', NULL), (10, N'Industrials', '2020-01-01', NULL),
    (11, N'Government', '2020-01-01', NULL), (12, N'Government', '2020-01-01', NULL), (13, N'Corporate', '2020-01-01', NULL),
    (14, N'Corporate', '2020-01-01', NULL), (15, N'Municipal', '2020-01-01', NULL), (16, N'Global Equity', '2020-01-01', NULL),
    (17, N'Emerging Markets', '2020-01-01', NULL), (18, N'Multi-Asset', '2020-01-01', NULL),
    (19, N'Real Estate', '2020-01-01', '2026-06-30'), (19, N'Real Assets', '2026-08-01', NULL),
    (20, N'Cash', '2020-01-01', NULL), (21, N'Structured products', '2020-01-01', NULL), (22, N'Structured products', '2020-01-01', NULL),
    (23, N'Cash', '2020-01-01', NULL), (24, N'Cash', '2020-01-01', NULL), (25, N'Government', '2020-01-01', NULL),
    (26, N'Government', '2020-01-01', NULL);

INSERT src_reference.SplComponent (InstrumentId, ComponentNo, ComponentName, AssetClass, Weight) VALUES
    (21, 1, N'Zero-coupon bond floor',  N'Bond',   0.800000),
    (21, 2, N'S&P 500 index option',    N'Equity', 0.200000),
    (22, 1, N'Zero-coupon Bund floor',  N'Bond',   0.850000),
    (22, 2, N'Euro Stoxx 50 option',    N'Equity', 0.150000);

/* ---------- Studio users and entitlements (no SSO in the POC) ---------- */

INSERT studio.AppUser (UserId, Name, Title, Role, HouseholdId) VALUES
    (N'priya.shah',      N'Priya Shah',      N'Reporting admin · report designer', N'Designer',   NULL),
    (N'james.mokoena',   N'James Mokoena',   N'Compliance (KI)',                   N'Approver',   NULL),
    (N'eleanor.hartley', N'Eleanor Hartley', N'Senior wealth manager',             N'Advisor',    NULL),
    (N'daniel.brooks',   N'Daniel Brooks',   N'Wealth manager',                    N'Advisor',    NULL),
    (N'sam.patel',       N'Sam Patel',       N'Reporting operations',              N'Operations', NULL),
    (N'naledi.marula',   N'Naledi Marula',   N'Client · Marula Family',            N'Client',     1),
    (N'anna.becker',     N'Anna Becker',     N'Client · Becker Family',            N'Client',     4);

INSERT studio.Entitlement (UserId, HouseholdId) VALUES
    (N'eleanor.hartley', 1), (N'eleanor.hartley', 2), (N'eleanor.hartley', 3),
    (N'daniel.brooks', 4), (N'daniel.brooks', 5);
GO

/* ---------- Business-day calendar ---------- */

DROP TABLE IF EXISTS #Cal;
DECLARE @Start DATE = '2023-01-02', @End DATE = '2026-10-30';

WITH n AS (
    SELECT TOP (DATEDIFF(DAY, @Start, @End) + 1) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS i
    FROM sys.all_objects a CROSS JOIN sys.all_objects b
), d AS (
    SELECT DATEADD(DAY, i, @Start) AS ValueDate FROM n
    WHERE DATEDIFF(DAY, '19000101', DATEADD(DAY, i, @Start)) % 7 < 5      -- 1900-01-01 was a Monday; 0..4 = Mon..Fri
)
SELECT ValueDate,
       ROW_NUMBER() OVER (ORDER BY ValueDate) AS Seq,
       CASE WHEN ValueDate = MAX(ValueDate) OVER (PARTITION BY YEAR(ValueDate), MONTH(ValueDate)) THEN 1 ELSE 0 END AS IsMonthEnd
INTO #Cal
FROM d;
CREATE UNIQUE CLUSTERED INDEX CX_Cal ON #Cal (Seq);

/* Seed-only account settings: allocation style and opening value (account currency). */
DROP TABLE IF EXISTS #Port;
SELECT a.AccountId, a.BenchmarkId, a.Currency, v.Style, v.OpeningValue,
       (SELECT MIN(Seq) FROM #Cal WHERE ValueDate >= a.InceptionDate) AS InceptionSeq,
       (SELECT MIN(ValueDate) FROM #Cal WHERE ValueDate >= a.InceptionDate) AS InceptionDate
INTO #Port
FROM src_client.Account a
JOIN (VALUES ( 1, N'Balanced',     CAST(1250000.00 AS DECIMAL(18,2))),
             ( 2, N'Growth',       CAST( 480000.00 AS DECIMAL(18,2))),
             ( 3, N'Conservative', CAST( 600000.00 AS DECIMAL(18,2))),
             ( 4, N'Structured',   CAST( 750000.00 AS DECIMAL(18,2))),
             ( 5, N'Growth',       CAST(2100000.00 AS DECIMAL(18,2))),
             ( 6, N'Growth',       CAST( 650000.00 AS DECIMAL(18,2))),
             ( 7, N'Conservative', CAST( 900000.00 AS DECIMAL(18,2))),
             ( 8, N'Conservative', CAST( 400000.00 AS DECIMAL(18,2))),
             ( 9, N'Growth',       CAST(3400000.00 AS DECIMAL(18,2))),
             (10, N'Balanced',     CAST(1750000.00 AS DECIMAL(18,2))),
             (11, N'Conservative', CAST( 520000.00 AS DECIMAL(18,2)))) v (AccountId, Style, OpeningValue)
  ON v.AccountId = a.AccountId;

/* ---------- Benchmark daily returns (USD) ---------- */

INSERT src_market.BenchmarkReturn (BenchmarkId, ValueDate, DailyReturn)
SELECT b.BenchmarkId, c.ValueDate,
       CASE WHEN c.Seq = 1 THEN 0
            ELSE CAST(ROUND((dbo.fn_SeedRandom(CONCAT(N'bm|', b.BenchmarkId, N'|', c.Seq)) * 2 - 1)
                            * CASE b.BenchmarkId WHEN 1 THEN 0.0120 WHEN 2 THEN 0.0070 ELSE 0.0045 END
                            + CASE b.BenchmarkId WHEN 1 THEN 0.0003 WHEN 2 THEN 0.0002 ELSE 0.00015 END, 8) AS DECIMAL(12,8)) END
FROM src_market.Benchmark b CROSS JOIN #Cal c;

/* ---------- FX: GBP and EUR as random walks of up to +/-0.4% a day ---------- */

INSERT src_market.FxRate (Currency, RateDate, UsdPerUnit)
SELECT x.Currency, c.ValueDate,
       CAST(ROUND(x.StartRate * EXP(SUM(CASE WHEN c.Seq = 1 THEN 0
                                             ELSE (dbo.fn_SeedRandom(CONCAT(N'fx|', x.Currency, N'|', c.Seq)) * 2 - 1) * 0.004 + 0.00002 END)
                                    OVER (PARTITION BY x.Currency ORDER BY c.Seq ROWS UNBOUNDED PRECEDING)), 8) AS DECIMAL(18,8))
FROM (VALUES ('GBP', 1.2100), ('EUR', 1.0700)) x (Currency, StartRate)
CROSS JOIN #Cal c;

/* ---------- External cash flows (Deposit / Withdrawal) ---------- */
/* Each month: a possible deposit on the first business day on/after the 10th,
   and a possible withdrawal on the first business day on/after the 20th. */

DROP TABLE IF EXISTS #Flow;
WITH months AS (
    SELECT DISTINCT YEAR(ValueDate) AS Y, MONTH(ValueDate) AS M FROM #Cal
), slots AS (
    SELECT m.Y, m.M, N'Deposit' AS Type,
           (SELECT MIN(ValueDate) FROM #Cal c WHERE YEAR(c.ValueDate) = m.Y AND MONTH(c.ValueDate) = m.M AND DAY(c.ValueDate) >= 10) AS TxnDate
    FROM months m
    UNION ALL
    SELECT m.Y, m.M, N'Withdrawal',
           (SELECT MIN(ValueDate) FROM #Cal c WHERE YEAR(c.ValueDate) = m.Y AND MONTH(c.ValueDate) = m.M AND DAY(c.ValueDate) >= 20)
    FROM months m
)
SELECT p.AccountId, s.TxnDate, s.Type,
       CAST(ROUND(p.OpeningValue
                  * CASE s.Type WHEN N'Deposit' THEN 0.010 + 0.040 * dbo.fn_SeedRandom(CONCAT(N'amt|', p.AccountId, N'|', s.TxnDate, s.Type))
                                ELSE 0.005 + 0.025 * dbo.fn_SeedRandom(CONCAT(N'amt|', p.AccountId, N'|', s.TxnDate, s.Type)) END, -2) AS DECIMAL(18,2)) AS Amount
INTO #Flow
FROM #Port p CROSS JOIN slots s
WHERE s.TxnDate > p.InceptionDate
  AND dbo.fn_SeedRandom(CONCAT(N'flow|', p.AccountId, N'|', s.TxnDate, s.Type))
      < CASE s.Type WHEN N'Deposit' THEN 0.50 ELSE 0.35 END;

/* ---------- Daily valuations in the account currency ---------- */
/* Local return = beta x benchmark return + idiosyncratic noise (structured income is less equity-sensitive).
   MarketValue = prior MV x (1 + r) + NetFlow, rounded to cents. */

DROP TABLE IF EXISTS #PV;
CREATE TABLE #PV (
    AccountId INT NOT NULL, Seq INT NOT NULL, ValueDate DATE NOT NULL,
    MarketValue DECIMAL(18,2) NOT NULL, NetFlow DECIMAL(18,2) NOT NULL,
    PRIMARY KEY (AccountId, Seq)
);

INSERT #PV (AccountId, Seq, ValueDate, MarketValue, NetFlow)
SELECT p.AccountId, c.Seq, c.ValueDate, p.OpeningValue, 0
FROM #Port p JOIN #Cal c ON c.Seq = p.InceptionSeq;

DECLARE @Seq INT = 2, @MaxSeq INT = (SELECT MAX(Seq) FROM #Cal);
WHILE @Seq <= @MaxSeq
BEGIN
    INSERT #PV (AccountId, Seq, ValueDate, MarketValue, NetFlow)
    SELECT p.AccountId, c.Seq, c.ValueDate, x.MarketValue, fl.NetFlow
    FROM #Cal c
    CROSS JOIN #Port p
    JOIN #PV prev ON prev.AccountId = p.AccountId AND prev.Seq = c.Seq - 1
    JOIN src_market.BenchmarkReturn br ON br.BenchmarkId = p.BenchmarkId AND br.ValueDate = c.ValueDate
    CROSS APPLY (
        SELECT CAST(ISNULL(SUM(CASE f.Type WHEN N'Deposit' THEN f.Amount ELSE -f.Amount END), 0) AS DECIMAL(18,2)) AS NetFlow
        FROM #Flow f WHERE f.AccountId = p.AccountId AND f.TxnDate = c.ValueDate
    ) fl
    CROSS APPLY (
        SELECT CASE p.Style WHEN N'Structured' THEN 0.5 ELSE 0.7 END * CAST(br.DailyReturn AS FLOAT)
               + (dbo.fn_SeedRandom(CONCAT(N'pv|', p.AccountId, N'|', c.Seq)) * 2 - 1) * 0.0040
               + 0.0001 AS R
    ) r
    CROSS APPLY (
        SELECT CAST(ROUND(CAST(prev.MarketValue AS FLOAT) * (1 + r.R), 2) AS DECIMAL(18,2)) + fl.NetFlow AS MarketValue
    ) x
    WHERE c.Seq = @Seq
      AND c.Seq > p.InceptionSeq;

    SET @Seq += 1;
END;

-- Seeded problems: P-106 stops being valued after 27 Oct 2026; P-108 misses 14-16 Sep 2026; P-104 has a bad price on 15 May 2024.
DELETE FROM #PV WHERE AccountId = 9 AND ValueDate > '2026-10-27';
DELETE FROM #PV WHERE AccountId = 11 AND ValueDate BETWEEN '2026-09-14' AND '2026-09-16';
UPDATE #PV SET MarketValue = CAST(ROUND(MarketValue * 1.064, 2) AS DECIMAL(18,2)) WHERE AccountId = 6 AND ValueDate = '2024-05-15';

INSERT src_holdings.Valuation (AccountId, ValueDate, MarketValueLocal, NetFlowLocal)
SELECT AccountId, ValueDate, MarketValue, NetFlow FROM #PV;

INSERT src_holdings.[Transaction] (AccountId, InstrumentId, TxnDate, Type, AmountLocal)
SELECT f.AccountId, CASE p.Currency WHEN 'GBP' THEN 23 WHEN 'EUR' THEN 24 ELSE 20 END, f.TxnDate, f.Type, f.Amount
FROM #Flow f JOIN #Port p ON p.AccountId = f.AccountId
WHERE EXISTS (SELECT 1 FROM #PV v WHERE v.AccountId = f.AccountId AND v.ValueDate = f.TxnDate);

/* ---------- Month-end holdings ---------- */
/* Each account holds up to 6 equities, 3 bonds, 2 funds, 2 structured products and cash in its own currency.
   Asset-class weights follow the style with up to +/-15% monthly drift (renormalised); the rounding residual goes to
   cash so every snapshot sums to the valuation exactly. */

DROP TABLE IF EXISTS #Alloc;
SELECT * INTO #Alloc FROM (VALUES
    (N'Growth',       N'Equity', 0.72), (N'Growth',       N'Bond', 0.10), (N'Growth',       N'Fund', 0.13), (N'Growth',       N'Cash', 0.05),
    (N'Balanced',     N'Equity', 0.48), (N'Balanced',     N'Bond', 0.32), (N'Balanced',     N'Fund', 0.15), (N'Balanced',     N'Cash', 0.05),
    (N'Conservative', N'Equity', 0.22), (N'Conservative', N'Bond', 0.55), (N'Conservative', N'Fund', 0.15), (N'Conservative', N'Cash', 0.08),
    (N'Structured',   N'Structured', 0.55), (N'Structured', N'Bond', 0.25), (N'Structured', N'Fund', 0.12), (N'Structured', N'Cash', 0.08)
) a (Style, AssetClass, Weight);

DROP TABLE IF EXISTS #Pick;
SELECT AccountId, Style, InstrumentId, AssetClass
INTO #Pick
FROM (
    SELECT p.AccountId, p.Style, s.InstrumentId, s.AssetClass,
           ROW_NUMBER() OVER (PARTITION BY p.AccountId, s.AssetClass
                              ORDER BY dbo.fn_SeedRandom(CONCAT(N'pick|', p.AccountId, N'|', s.InstrumentId))) AS Rn
    FROM #Port p
    JOIN src_reference.Instrument s ON s.AssetClass <> N'Cash' OR s.Currency = p.Currency
    WHERE EXISTS (SELECT 1 FROM #Alloc a WHERE a.Style = p.Style AND a.AssetClass = s.AssetClass)
) x
WHERE (AssetClass = N'Equity' AND Rn <= 6) OR (AssetClass = N'Bond' AND Rn <= 3)
   OR (AssetClass = N'Fund' AND Rn <= 2) OR (AssetClass = N'Structured' AND Rn <= 2) OR AssetClass = N'Cash';

DROP TABLE IF EXISTS #ClassW;
WITH d AS (
    SELECT p.AccountId, c.ValueDate, a.AssetClass,
           a.Weight * (0.85 + 0.30 * dbo.fn_SeedRandom(CONCAT(N'cw|', p.AccountId, N'|', a.AssetClass, N'|', c.ValueDate))) AS W
    FROM #Port p
    JOIN #Alloc a ON a.Style = p.Style
    CROSS JOIN #Cal c
    WHERE c.IsMonthEnd = 1
)
SELECT AccountId, ValueDate, AssetClass, W / SUM(W) OVER (PARTITION BY AccountId, ValueDate) AS Weight
INTO #ClassW
FROM d;

DROP TABLE IF EXISTS #Price;
SELECT s.InstrumentId,
       CASE s.AssetClass WHEN N'Equity' THEN 40 + 460 * dbo.fn_SeedRandom(CONCAT(N'px|', s.InstrumentId))
                         WHEN N'Bond'   THEN 95 + 10 * dbo.fn_SeedRandom(CONCAT(N'px|', s.InstrumentId))
                         WHEN N'Fund'   THEN 10 + 25 * dbo.fn_SeedRandom(CONCAT(N'px|', s.InstrumentId))
                         WHEN N'Structured' THEN 92 + 12 * dbo.fn_SeedRandom(CONCAT(N'px|', s.InstrumentId))
                         ELSE 1 END AS BasePrice
INTO #Price
FROM src_reference.Instrument s;

DROP TABLE IF EXISTS #Hold;
WITH raw AS (
    SELECT k.AccountId, k.InstrumentId, k.AssetClass, c.ValueDate,
           0.6 + 0.8 * dbo.fn_SeedRandom(CONCAT(N'w|', k.AccountId, N'|', k.InstrumentId, N'|', c.ValueDate)) AS Raw,
           cw.Weight AS ClassWeight
    FROM #Pick k
    CROSS JOIN #Cal c
    JOIN #ClassW cw ON cw.AccountId = k.AccountId AND cw.AssetClass = k.AssetClass AND cw.ValueDate = c.ValueDate
    WHERE c.IsMonthEnd = 1
)
SELECT r.AccountId, r.InstrumentId, r.AssetClass, r.ValueDate AS AsOfDate,
       CAST(ROUND(CAST(pv.MarketValue AS FLOAT) * r.ClassWeight * r.Raw
                  / SUM(r.Raw) OVER (PARTITION BY r.AccountId, r.ValueDate, r.AssetClass), 2) AS DECIMAL(18,2)) AS MarketValue
INTO #Hold
FROM raw r
JOIN #PV pv ON pv.AccountId = r.AccountId AND pv.ValueDate = r.ValueDate;

UPDATE h
SET h.MarketValue = h.MarketValue + (pv.MarketValue - t.Total)
FROM #Hold h
JOIN (SELECT AccountId, AsOfDate, SUM(MarketValue) AS Total FROM #Hold GROUP BY AccountId, AsOfDate) t
  ON t.AccountId = h.AccountId AND t.AsOfDate = h.AsOfDate
JOIN #PV pv ON pv.AccountId = h.AccountId AND pv.ValueDate = h.AsOfDate
WHERE h.AssetClass = N'Cash';

-- Seeded problem: one P-104 position on 30 Jun 2026 is 2.5% too high, so the snapshot no longer reconciles.
UPDATE h SET h.MarketValue = CAST(ROUND(h.MarketValue * 1.025, 2) AS DECIMAL(18,2))
FROM #Hold h
WHERE h.AccountId = 6 AND h.AsOfDate = '2026-06-30'
  AND h.InstrumentId = (SELECT MIN(InstrumentId) FROM #Hold WHERE AccountId = 6 AND AsOfDate = '2026-06-30' AND AssetClass = N'Equity');

INSERT src_holdings.Holding (AccountId, InstrumentId, AsOfDate, Quantity, MarketValueLocal)
SELECT h.AccountId, h.InstrumentId, h.AsOfDate,
       CAST(ROUND(CAST(h.MarketValue AS FLOAT) / px.Price, 4) AS DECIMAL(18,4)),
       h.MarketValue
FROM #Hold h
JOIN #Price b ON b.InstrumentId = h.InstrumentId
CROSS APPLY (SELECT CASE WHEN h.AssetClass = N'Cash' THEN 1.0
                         ELSE b.BasePrice * (0.85 + 0.30 * dbo.fn_SeedRandom(CONCAT(N'pxm|', h.InstrumentId, N'|', h.AsOfDate))) END AS Price) px;

/* ---------- Internal transactions (do not change NetFlow) ---------- */

-- Monthly advisory fee on each month-end, debited from cash.
INSERT src_holdings.[Transaction] (AccountId, InstrumentId, TxnDate, Type, AmountLocal)
SELECT pv.AccountId, CASE p.Currency WHEN 'GBP' THEN 23 WHEN 'EUR' THEN 24 ELSE 20 END, pv.ValueDate, N'Fee',
       CAST(ROUND(pv.MarketValue * 0.00075, 2) AS DECIMAL(18,2))
FROM #PV pv
JOIN #Cal c ON c.ValueDate = pv.ValueDate
JOIN #Port p ON p.AccountId = pv.AccountId
WHERE c.IsMonthEnd = 1;

-- Quarterly dividends on equity holdings (Dec, Mar, Jun, Sep month-ends).
INSERT src_holdings.[Transaction] (AccountId, InstrumentId, TxnDate, Type, AmountLocal)
SELECT h.AccountId, h.InstrumentId, h.AsOfDate, N'Dividend', CAST(ROUND(h.MarketValue * 0.004, 2) AS DECIMAL(18,2))
FROM #Hold h
WHERE h.AssetClass = N'Equity' AND MONTH(h.AsOfDate) IN (3, 6, 9, 12);

-- Month-end rebalancing trades: one buy and one sell per account.
INSERT src_holdings.[Transaction] (AccountId, InstrumentId, TxnDate, Type, AmountLocal)
SELECT h.AccountId, h.InstrumentId, h.AsOfDate,
       CASE WHEN x.Rn = 1 THEN N'Buy' ELSE N'Sell' END,
       CAST(ROUND(h.MarketValue * (0.02 + 0.06 * dbo.fn_SeedRandom(CONCAT(N'trd|', h.AccountId, N'|', h.InstrumentId, N'|', h.AsOfDate))), 2) AS DECIMAL(18,2))
FROM #Hold h
JOIN (
    SELECT AccountId, InstrumentId, AsOfDate,
           ROW_NUMBER() OVER (PARTITION BY AccountId, AsOfDate
                              ORDER BY dbo.fn_SeedRandom(CONCAT(N'rb|', AccountId, N'|', InstrumentId, N'|', AsOfDate))) AS Rn
    FROM #Hold WHERE AssetClass <> N'Cash'
) x ON x.AccountId = h.AccountId AND x.InstrumentId = h.InstrumentId AND x.AsOfDate = h.AsOfDate
WHERE x.Rn <= 2;
GO

DROP FUNCTION IF EXISTS dbo.fn_SeedRandom;
GO
