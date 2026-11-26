"""Generates 04_catalog_reports.sql: the approved catalogue (with methodology), ready-made blocks and seeded templates.
Usage: python3 tools/gen_catalog_reports.py 04_catalog_reports.sql"""
import copy, json, sys

out_path = sys.argv[1]

def q(s): return s.replace("'", "''")
def j(o): return json.dumps(o, ensure_ascii=False, separators=(",", ":"))

def data(id, display, title, measures, groupBy=(), period="report", compare="none", topN=None, sort="value_desc", width="full", labels=None):
    b = {"id": id, "type": "data", "display": display, "width": width, "title": title, "measures": list(measures),
         "groupBy": list(groupBy), "period": period, "compare": compare, "topN": topN, "sort": sort}
    if labels: b["labels"] = labels
    return b
def text(id, body, title="", variant="body", width="full", narrative=None):
    b = {"id": id, "type": "text", "variant": variant, "width": width, "title": title, "text": body}
    if narrative: b["narrative"] = narrative
    return b
def disc(id, code, condition=None):
    b = {"id": id, "type": "disclaimer", "width": "full", "title": "", "text": "", "disclosureCode": code}
    if condition: b["condition"] = condition
    return b
def page(id, title, group, heading, blocks, section="", locked=False, layout="standard", condition=None):
    p = {"id": id, "title": title, "group": group, "locked": locked, "sectionLabel": section, "heading": heading,
         "layout": layout, "style": {"typeface": "serif", "bodySize": 10, "lineHeight": 1.5}, "blocks": blocks}
    if condition: p["condition"] = condition
    return p

FM, PP, CC = "Front matter", "Portfolio pages", "Commentary & close"
RET_LABELS = {"return_twr": "Portfolio (TWR)", "mwr": "Money-weighted", "benchmark_return": "Benchmark", "excess_return": "Relative"}
CLOSING = ("Thank you for choosing us to look after your wealth. If your circumstances, objectives or attitude to risk have changed, please let your wealth manager know so that we can review your mandate.\n\n"
           "Your next scheduled review is shown in your client profile. We are available at any time to discuss this report.")
COVER = lambda pid: page(pid, "Cover", FM, "{Report name}", [text(pid + "b1", "{Portfolio}\nReporting period {From date} – {To date}\nPrepared {Run date}", title="{Client}", variant="header")], locked=True, layout="cover")
def DISCLOSURES(pid):
    return page(pid, "Disclosures", CC, "Important information", [
        disc(pid + "b1", "PERF_GENERAL"), disc(pid + "b2", "METHODOLOGY"), disc(pid + "b3", "ILLUSTRATIVE"),
        disc(pid + "b4", "FX_RISK", "MultiCurrency"), disc(pid + "b5", "SPL_RISK", "StructuredProducts"), disc(pid + "b6", "ADVISORY", "Advisory"),
    ], section="Disclosures", locked=True)

LETTER_NARRATIVE = ("The body of a short personal letter to the client (no address block): thank them, summarise the period's return against "
                    "the benchmark, the change in value and the net flows, and mention one or two of the material movements. 120-180 words. "
                    "End with 'Yours sincerely,' and 'Your wealth management team' on separate lines.")
PERF_NARRATIVE = ("Two short paragraphs on performance over the period: the time-weighted return against the benchmark, the money-weighted "
                  "return and why it differs (timing and size of flows), and how risk behaved. 80-130 words.")
CHANGES_NARRATIVE = "One short paragraph on what changed in the period: allocation shifts, large flows and accounts that stood out. 60-110 words."
SPL_NARRATIVE = ("One short paragraph explaining what the look-through view shows: how the structured products split into bond-like and "
                 "equity-like exposure, and what that means for the household's overall allocation. 50-90 words.")
FX_NARRATIVE = ("One short paragraph explaining how currency movements affected the accounts held in currencies other than the US dollar, "
                "comparing their local-currency and US-dollar returns. 50-90 words.")

annual = {"scope": "Client", "preview": {"householdId": "1", "clientId": None, "portfolioCode": None, "fromDate": "2025-01-01", "toDate": "2025-12-31"}, "pages": [
    COVER("p01"),
    page("p02", "Investor letter", FM, "A letter to you", [
        text("p02b1", "Dear {Client},\n\nThank you for the trust you continue to place in us. This review covers {Period}, from {From date} to {To date}, for your {Portfolio}.\n\n"
                      "The pages that follow show how your investments performed against their benchmark, how your assets are allocated, what changed during the period and the costs you paid. "
                      "Every figure is taken directly from our systems of record.\n\nYours sincerely,\nYour wealth management team", narrative=LETTER_NARRATIVE),
        data("p02b2", "kpi", "At a glance", ["market_value", "return_twr", "mwr", "net_flows"]),
    ], section="Introduction", layout="letter"),
    page("p03", "Portfolio snapshot", FM, "Portfolio snapshot", [
        data("p03b1", "kpi", "Key figures", ["market_value", "investment_gain", "return_twr", "benchmark_return", "excess_return", "net_flows"]),
        data("p03b2", "pie", "Asset allocation", ["weight"], ["asset_class"], width="half"),
        data("p03b3", "pie", "Regional exposure", ["weight"], ["region"], width="half"),
    ], section="Section one", layout="kpi"),
    page("p04", "Performance", PP, "Performance overview", [
        data("p04b1", "line", "Indexed growth · {Base date} = 100", ["growth_index", "benchmark_index"], ["month"], sort="label_asc",
             labels={"growth_index": "Portfolio", "benchmark_index": "Benchmark"}),
        data("p04b2", "table", "Return by period", ["return_twr", "mwr", "benchmark_return", "excess_return"], ["return_period"], labels=RET_LABELS),
        data("p04b3", "list", "Risk characteristics · 3 years", ["volatility", "sharpe_ratio", "max_drawdown", "tracking_error", "information_ratio"], period="3y", width="half"),
        text("p04b4", "Your portfolio's return is shown both time-weighted, which measures the investment decisions, and money-weighted, which also reflects the timing of your deposits and withdrawals.",
             title="About these figures", width="half", narrative=PERF_NARRATIVE),
        disc("p04b5", "PERF_GENERAL"),
    ], section="Section two", layout="kpi"),
    page("p05", "Household & entities", PP, "Your household at a glance", [
        data("p05b1", "table", "By entity", ["market_value", "return_twr", "mwr", "contribution"], ["client"]),
        data("p05b2", "table", "By account", ["market_value", "return_twr", "benchmark_return", "mwr", "contribution"], ["portfolio"], labels=RET_LABELS),
        data("p05b3", "bar", "Contribution to return by account", ["contribution"], ["portfolio"]),
    ], section="Section three"),
    page("p06", "Allocation by asset class", PP, "Allocation by asset class", [
        data("p06b1", "bar", "Weight by asset class · this year vs last year", ["weight"], ["asset_class"], compare="previous_year"),
        data("p06b2", "table", "Holdings by asset class", ["market_value", "weight"], ["asset_class"]),
    ], section="Section four"),
    page("p07", "Asset allocation", PP, "Asset allocation", [
        data("p07b1", "pie", "Asset allocation", ["weight"], ["asset_class"], width="half"),
        data("p07b2", "table", "Allocation by asset class and sector", ["weight"], ["asset_class", "sector"], width="half"),
    ], section="Section five"),
    page("p08", "Sector & geography", PP, "Sector & geography", [
        data("p08b1", "bar", "Sector weights", ["weight"], ["sector"], width="half"),
        data("p08b2", "pie", "Regional exposure", ["weight"], ["region"], width="half"),
    ], section="Section six"),
    page("p09", "Principal holdings", PP, "Principal holdings", [
        data("p09b1", "table", "Top 10 holdings", ["market_value", "weight"], ["security", "asset_class", "region"], topN=10),
    ], section="Section seven"),
    page("p10", "Structured products", PP, "Structured products: a look-through view", [
        data("p10b1", "pie", "Asset allocation · looking through structured products", ["weight"], ["lookthrough_asset_class"], width="half"),
        data("p10b2", "table", "Direct holdings and structured products", ["market_value", "weight"], ["holding_type"], width="half"),
        text("p10b3", "Structured products combine a bond-like part, which provides capital protection or income, with an option that gives exposure to an equity index. "
                      "The look-through view splits each product into these parts.", narrative=SPL_NARRATIVE),
    ], section="Section eight", condition="StructuredProducts"),
    page("p11", "Currency", PP, "Currency effects", [
        data("p11b1", "table", "Return by account currency", ["market_value", "return_local", "fx_effect", "return_twr"], ["account_currency"],
             labels={"return_local": "Local currency", "fx_effect": "Currency effect", "return_twr": "In US dollars"}),
        text("p11b2", "Some of your accounts are held in currencies other than the US dollar. Their returns in US dollars include the effect of exchange-rate movements.", narrative=FX_NARRATIVE),
    ], section="Section nine", condition="MultiCurrency"),
    page("p12", "Key changes", PP, "Key changes in the period", [
        data("p12b1", "bar", "Sector weights · this year vs last year", ["weight"], ["sector"], compare="previous_year", topN=8),
        data("p12b2", "table", "Cash flows by quarter", ["deposits", "withdrawals", "net_flows"], ["quarter"], sort="label_asc"),
        text("p12b3", "The allocation was kept in line with your agreed strategy during the period.", narrative=CHANGES_NARRATIVE),
    ], section="Section ten"),
    page("p13", "Commentary", CC, "Market commentary", [
        text("p13b1", "Global markets were shaped by the path of interest rates, resilient corporate earnings and periods of geopolitical uncertainty. "
                      "Diversification across asset classes and regions helped to smooth returns, while bond holdings provided income and stability.\n\n"
                      "Our house view is set by the investment committee and is the same for every client."),
    ], section="Section eleven"),
    page("p14", "Strategic outlook", CC, "Strategic outlook", [
        text("p14b1", "We expect growth to moderate and inflation to continue easing, which should support both equities and high-quality bonds. "
                      "We remain selective, favouring companies with strong balance sheets and durable earnings, and will continue to rebalance portfolios towards their strategic allocation."),
    ], section="Section twelve"),
    page("p15", "Costs and charges", CC, "Costs and charges", [
        data("p15b1", "kpi", "Charges in the period", ["fees", "fee_rate"]),
        data("p15b2", "bar", "Fees by month", ["fees"], ["month"], sort="label_asc"),
    ], section="Section thirteen"),
    page("p16", "Charges by account", CC, "Charges by account", [
        data("p16b1", "table", "Fees by account", ["fees", "fee_rate", "market_value"], ["portfolio"]),
    ], section="Section fourteen"),
    DISCLOSURES("p17"),
    page("p18", "Closing", CC, "Thank you", [text("p18b1", CLOSING)], locked=True),
]}

summary_v1 = {"scope": "Client", "preview": annual["preview"], "pages": [
    COVER("s01"),
    page("s02", "Performance", PP, "Performance summary", [
        data("s02b1", "kpi", "Performance summary", ["market_value", "return_twr", "mwr", "benchmark_return", "excess_return"]),
        data("s02b2", "line", "Indexed growth · {Base date} = 100", ["growth_index", "benchmark_index"], ["month"], sort="label_asc",
             labels={"growth_index": "Portfolio", "benchmark_index": "Benchmark"}),
        text("s02b3", "Your portfolio's performance over the period is summarised above.", narrative=PERF_NARRATIVE),
    ], section="Section one", layout="kpi"),
    page("s03", "Allocation", PP, "Allocation and holdings", [
        data("s03b1", "pie", "Asset allocation", ["weight"], ["asset_class"], width="half"),
        data("s03b2", "table", "Top 10 holdings", ["market_value", "weight"], ["security", "asset_class"], topN=10, width="half"),
    ], section="Section two"),
    page("s04", "Cash flows", PP, "Cash flows", [
        data("s04b1", "bar", "Deposits and withdrawals by month", ["deposits", "withdrawals"], ["month"], sort="label_asc"),
    ], section="Section three"),
    DISCLOSURES("s05"),
]}
summary_v2 = copy.deepcopy(summary_v1)
summary_v2["pages"][2]["blocks"].append(data("s03b3", "bar", "Sector weights vs last quarter", ["weight"], ["sector"], compare="previous_quarter", topN=10))

costs = {"scope": "Client", "preview": annual["preview"], "pages": [
    COVER("c01"),
    page("c02", "Costs", PP, "Costs and charges", [
        data("c02b1", "kpi", "Charges in the period", ["fees", "fee_rate", "market_value"]),
        data("c02b2", "table", "Fees by account", ["fees", "fee_rate"], ["portfolio"]),
        data("c02b3", "bar", "Fees by quarter", ["fees"], ["quarter"], sort="label_asc"),
    ], section="Section one"),
    DISCLOSURES("c03"),
]}

# ---------- measures ----------
ann = "CAST(POWER(EXP(SUM(LOG(1.0 + {r}))), 1.0 / MAX(AnnYears)) - 1 AS DECIMAL(12,8))"
ann_raw = "(POWER(EXP(SUM(LOG(1.0 + {r}))), 1.0 / MAX(AnnYears)) - 1)"
ann252 = "(POWER(EXP(SUM(LOG(1.0 + {r}))), 252.0 / COUNT({r})) - 1)"
vol = "STDEV(DailyReturn) * SQRT(252.0)"
te = "STDEV(DailyReturn - BenchmarkReturn) * SQRT(252.0)"
EMV = "SUM(CASE WHEN ValueDate = GroupEnd THEN MarketValue END)"
BMV = "SUM(CASE WHEN ValueDate = GroupStart THEN PriorMarketValue END)"
MD = (f"(({EMV} - ISNULL({BMV}, 0) - SUM(NetFlow)) / NULLIF(ISNULL({BMV}, 0) + "
      "SUM(NetFlow * DATEDIFF(DAY, ValueDate, GroupEnd) / (DATEDIFF(DAY, GroupStart, GroupEnd) + 1.0)), 0))")
OWNER_PERF, OWNER_DATA = "Performance & analytics", "Data office"
measures = [
 # key, label, symbol, format, description, perfExpr, holdExpr, requiresGroup, cumulative, methodology
 ("market_value", "Market value", "Σ", "currency", "Closing market value at the end of the period (or of each month/quarter), in USD.",
  f"CAST({EMV} AS DECIMAL(18,2))", "SUM(MarketValue)", 0, 0,
  "Sum of account valuations on the last business day of the period, converted to USD at that day's FX rate. For holdings groupings: the month-end holdings snapshot on or before the period end."),
 ("opening_value", "Opening value", "Σ", "currency", "Market value at the close of the business day before the period (zero for accounts opened during it).",
  f"CAST(ISNULL({BMV}, 0) AS DECIMAL(18,2))", None, 0, 0,
  "Sum of the prior-day USD valuations on the first business day of the period. Accounts funded during the period start at zero; their funding counts as a deposit."),
 ("investment_gain", "Investment gain", "Σ", "currency", "Change in value not explained by deposits and withdrawals.",
  f"CAST({EMV} - ISNULL({BMV}, 0) - SUM(NetFlow) AS DECIMAL(18,2))", None, 0, 0,
  "Closing value minus opening value minus net external flows, in USD. Includes income, price changes and currency effects, after fees."),
 ("return_twr", "Return (TWR)", "%", "percent", "Time-weighted return in USD; several accounts are combined by value. Annualised for standard periods longer than a year.",
  ann.format(r="DailyReturn"), None, 0, 0,
  "Daily returns (USD, after fees) are combined across accounts weighted by each account's prior-day value, then chained geometrically. Periods over one year in the standard-period table are annualised. Removes the effect of the size and timing of flows."),
 ("mwr", "Return (MWR)", "%", "percent", "Money-weighted return (Modified Dietz) in USD: reflects the timing and size of deposits and withdrawals.",
  f"CAST(POWER(1.0 + {MD}, 1.0 / MAX(AnnYears)) - 1 AS DECIMAL(12,8))", None, 0, 0,
  "Modified Dietz: (closing value - opening value - net flows) / (opening value + flows weighted by the share of the period remaining after each flow). Calculated at account, entity and household level on the reported holdings; structured products are valued as single holdings (no look-through)."),
 ("benchmark_return", "Benchmark return", "%", "percent", "Return of the benchmark over the same days (blended by value for several accounts).",
  ann.format(r="BenchmarkReturn"), None, 0, 0,
  "Each account's benchmark daily return, combined across accounts with the same value weights as the portfolio return, then chained."),
 ("excess_return", "Excess return", "%", "percent", "Return (TWR) minus benchmark return.",
  f"CAST({ann_raw.format(r='DailyReturn')} - {ann_raw.format(r='BenchmarkReturn')} AS DECIMAL(12,8))", None, 0, 0,
  "Arithmetic difference between the time-weighted return and the benchmark return over the same period."),
 ("contribution", "Contribution to return", "%", "percent", "How much of the household's return came from each account or entity (percentage points).",
  "CAST(SUM(Contribution) AS DECIMAL(12,8))", None, 1, 0,
  "Sum over the days of the period of the group's share of the total prior-day value times its daily return. Contributions add up to the sum of the total's daily returns; the small difference to the compounded return is the linking residual."),
 ("return_local", "Return in local currency", "%", "percent", "Time-weighted return in each account's own currency, before currency effects.",
  ann.format(r="LocalDailyReturn"), None, 0, 0,
  "As Return (TWR), but from valuations in the account's own currency. For USD accounts it equals the USD return."),
 ("fx_effect", "Currency effect", "%", "percent", "USD return minus local-currency return: the effect of exchange-rate movements.",
  f"CAST({ann_raw.format(r='DailyReturn')} - {ann_raw.format(r='LocalDailyReturn')} AS DECIMAL(12,8))", None, 0, 0,
  "Difference between the time-weighted return in USD and in the account's own currency over the same days, using daily closing FX rates."),
 ("net_flows", "Net flows", "Σ", "currency", "Deposits minus withdrawals in the period (initial funding counts as a deposit).", "SUM(NetFlow)", None, 0, 0,
  "Sum of external deposits less withdrawals, converted to USD at each day's FX rate."),
 ("deposits", "Deposits", "Σ", "currency", "Total deposits in the period, including the initial funding of new accounts.", "SUM(Deposits)", None, 0, 0,
  "Sum of external deposits (and initial funding of accounts opened in the period), converted to USD at each day's FX rate."),
 ("withdrawals", "Withdrawals", "Σ", "currency", "Total withdrawals in the period (positive number).", "SUM(Withdrawals)", None, 0, 0,
  "Sum of external withdrawals, converted to USD at each day's FX rate."),
 ("fees", "Fees", "Σ", "currency", "Advisory fees charged in the period.", "SUM(Fees)", None, 0, 0,
  "Sum of advisory fees debited to the accounts, converted to USD at each day's FX rate."),
 ("fee_rate", "Fees (% of value)", "%", "percent", "Fees in the period as a share of the average market value.",
  "CAST(SUM(Fees) / NULLIF(AVG(MarketValue), 0) AS DECIMAL(12,8))", None, 0, 0,
  "Fees in the period divided by the average daily USD market value over the period (not annualised)."),
 ("weight", "Weight", "%", "percent", "Share of total market value at the period-end holdings snapshot. Needs a holdings grouping.",
  None, "CAST(SUM(CAST(MarketValue AS FLOAT)) / NULLIF(SUM(SUM(CAST(MarketValue AS FLOAT))) OVER (PARTITION BY Series), 0) AS DECIMAL(12,8))", 1, 0,
  "USD market value of the group divided by the total of the rows in scope, from the month-end snapshot on or before the period end. With look-through, structured products are split into their components."),
 ("growth_index", "Portfolio growth (index)", "↗", "index", "Growth of 100 invested at the start of the period, by month or quarter. Needs a Month or Quarter group-by.",
  "EXP(SUM(LOG(1.0 + DailyReturn))) - 1", None, 1, 1,
  "Time-weighted growth chained month by month from 100 on the day before the period."),
 ("benchmark_index", "Benchmark growth (index)", "↗", "index", "Growth of 100 in the benchmark over the same days. Needs a Month or Quarter group-by.",
  "EXP(SUM(LOG(1.0 + BenchmarkReturn))) - 1", None, 1, 1,
  "Benchmark growth chained month by month from 100 on the day before the period."),
 ("volatility", "Volatility", "σ", "percent", "Annualised standard deviation of daily returns.",
  f"CAST({vol} AS DECIMAL(12,8))", None, 0, 0, "Sample standard deviation of daily USD returns times the square root of 252."),
 ("sharpe_ratio", "Sharpe ratio", "#", "ratio", "Annualised return above a 2% risk-free rate, divided by volatility.",
  f"CAST(({ann252.format(r='DailyReturn')} - 0.02) / NULLIF({vol}, 0) AS DECIMAL(12,4))", None, 0, 0,
  "(Annualised return - 2% risk-free rate) / annualised volatility. Return annualised over 252 business days a year."),
 ("max_drawdown", "Maximum drawdown", "%", "percent", "Largest fall from a previous peak during the period.",
  "CAST(MIN(EXP(CumLog - IIF(RunMax > 0, RunMax, 0)) - 1) AS DECIMAL(12,8))", None, 0, 0,
  "Largest percentage fall of the time-weighted growth index from its running peak (starting at 100) within the period."),
 ("tracking_error", "Tracking error", "σ", "percent", "Annualised standard deviation of the daily difference between portfolio and benchmark returns.",
  f"CAST({te} AS DECIMAL(12,8))", None, 0, 0, "Sample standard deviation of daily (portfolio - benchmark) returns times the square root of 252."),
 ("information_ratio", "Information ratio", "#", "ratio", "Annualised excess return divided by tracking error.",
  f"CAST(({ann252.format(r='DailyReturn')} - {ann252.format(r='BenchmarkReturn')}) / NULLIF({te}, 0) AS DECIMAL(12,4))", None, 0, 0,
  "(Annualised portfolio return - annualised benchmark return) / tracking error."),
]
RISK = {"volatility", "sharpe_ratio", "max_drawdown", "tracking_error", "information_ratio"}
CUM = {"growth_index", "benchmark_index"}
ENTITY_ONLY = {"contribution"}
dims = [
 ("asset_class", "Asset class", "Holdings", "AssetClass", "text", 0, 0),
 ("sector", "Sector", "Holdings", "Sector", "text", 0, 0),
 ("region", "Region", "Holdings", "Region", "text", 0, 0),
 ("security", "Security", "Holdings", "SecurityName", "text", 0, 0),
 ("instrument_currency", "Instrument currency", "Holdings", "InstrumentCurrency", "text", 0, 0),
 ("holding_type", "Holding type", "Holdings", "HoldingType", "text", 0, 0),
 ("lookthrough_asset_class", "Asset class (look-through)", "Exposure", "AssetClass", "text", 0, 0),
 ("month", "Month", "Performance", "EOMONTH(ValueDate)", "month", 1, 0),
 ("quarter", "Quarter", "Performance", "CONCAT(YEAR(ValueDate), N' Q', DATEPART(QUARTER, ValueDate))", "text", 1, 0),
 ("year", "Year", "Performance", "CAST(YEAR(ValueDate) AS NVARCHAR(4))", "text", 1, 0),
 ("return_period", "Standard periods", "Performance", "Series", "text", 0, 1),
 ("household", "Household", "Performance", "HouseholdName", "text", 0, 0),
 ("client", "Entity", "Performance", "ClientName", "text", 0, 0),
 ("portfolio", "Account", "Performance", "CONCAT(PortfolioName, N' (', PortfolioCode, N')')", "text", 0, 0),
 ("account_currency", "Account currency", "Performance", "Currency", "text", 0, 0),
]
def combos():
    for m in measures:
        key, perf, hold = m[0], m[5], m[6]
        for d in dims:
            dk, src, is_time, period_rows = d[0], d[2], d[5], d[6]
            if src in ("Holdings", "Exposure") and not hold: continue
            if src == "Performance" and not perf: continue
            if key in CUM and not is_time: continue
            if key in RISK and is_time: continue
            if key in ENTITY_ONLY and (is_time or period_rows): continue
            if period_rows and key in {"market_value", "opening_value"} | CUM: continue
            yield key, dk

L = []
w = L.append
w("""/* 04_catalog_reports.sql - the approved data catalogue (with methodology), ready-made blocks and seeded templates.
   Generated by tools/gen_catalog_reports.py (edit that script, then re-run it); idempotent: clears these tables and reseeds them.

   Catalogue expressions are trusted SQL written by admins. The API's query compiler aggregates them over one of:
   - Performance: dp.vw_AccountDailyPerformance rows in the block's period, combined per day across the accounts in
     each group (value-weighted returns), with GroupStart/GroupEnd (first/last day in the group), AnnYears (years to
     annualise over; 1 = not annualised), Contribution (the group's share of the total's daily return), CumLog and RunMax.
   - Holdings: dp.fn_HoldingSnapshot(<period end>) rows.   - Exposure: dp.fn_ExposureSnapshot(<period end>) rows.
   Every query also carries a Series column (the period label), so weights are computed per series.

   Templates are made of pages: {id, title, group, locked, condition, sectionLabel, heading, layout, style, blocks}.
   Locked pages are required by compliance. A page or disclaimer with a condition (StructuredProducts, MultiCurrency,
   Advisory) applies only when the client context meets it. Disclaimer text always comes from src_content.Disclosure.
   Text blocks with a "narrative" brief are drafted by the Narrative Agent from the period's verified figures. */

USE WealthInsightsV10Db;
GO
SET NOCOUNT ON;
GO

DELETE FROM studio.OrchestrationStep;
DELETE FROM studio.OrchestrationRun;
DELETE FROM studio.ClientReport;
DELETE FROM studio.ReportVersion;
DELETE FROM studio.Report;
DELETE FROM studio.BlockPreset;
DELETE FROM studio.CatalogCombination;
DELETE FROM studio.CatalogDimension;
DELETE FROM studio.CatalogMeasure;
DECLARE @Reseed NVARCHAR(MAX) = N'';
SELECT @Reseed += N'DBCC CHECKIDENT (''studio.' + QUOTENAME(OBJECT_NAME(object_id)) + N''', RESEED, 0) WITH NO_INFOMSGS;'
FROM sys.identity_columns
WHERE OBJECT_SCHEMA_NAME(object_id) = N'studio' AND last_value IS NOT NULL;
EXEC sys.sp_executesql @Reseed;
GO

/* ---------- Measures ---------- */
""")
w("INSERT studio.CatalogMeasure (MeasureKey, Label, Symbol, Format, Description, PerformanceExpr, HoldingsExpr, RequiresGroup, Cumulative, Methodology, MethodologyVersion, Owner, ApprovedOn, SortOrder) VALUES")
rows = []
for i, (k, l, sym, fmt, desc, pe, he, rg, cu, meth) in enumerate(measures, 1):
    pe_s = f"N'{q(pe)}'" if pe else "NULL"
    he_s = f"N'{q(he)}'" if he else "NULL"
    version = "2.0" if k in {"mwr", "contribution", "return_local", "fx_effect", "investment_gain", "opening_value"} else "1.1"
    owner = OWNER_DATA if k in {"market_value", "net_flows", "deposits", "withdrawals", "fees", "weight"} else OWNER_PERF
    rows.append(f" (N'{k}', N'{q(l)}', N'{sym}', N'{fmt}',\n  N'{q(desc)}',\n  {pe_s},\n  {he_s}, {rg}, {cu},\n  N'{q(meth)}', N'{version}', N'{owner}', '2026-09-01', {i})")
w(",\n".join(rows) + ";\n")
w("/* ---------- Group-by fields ---------- */\n")
w("INSERT studio.CatalogDimension (DimensionKey, Label, Source, Expr, Format, IsTime, PeriodRows, SortOrder) VALUES")
w(",\n".join(f" (N'{k}', N'{q(l)}', N'{src}', N'{q(e)}', N'{f}', {t}, {pr}, {i})" for i, (k, l, src, e, f, t, pr) in enumerate(dims, 1)) + ";\n")
w("""/* Allowed measure x group-by pairs: a measure needs an expression for the group-by's source; growth indices need a
   time group-by; risk figures make no sense per month/quarter; contribution is per account, entity, household or currency. */""")
w("INSERT studio.CatalogCombination (MeasureKey, DimensionKey) VALUES")
w(",\n".join(f" (N'{m}', N'{d}')" for m, d in combos()) + ";\nGO\n")

presets = [
 ("performance_summary", "Performance summary", "▦", "KPI cards: market value, TWR, MWR, benchmark and excess return for the report period.",
  data("x", "kpi", "Performance summary", ["market_value", "return_twr", "mwr", "benchmark_return", "excess_return"])),
 ("indexed_growth", "Indexed growth", "📈", "Line chart of portfolio vs benchmark growth of 100, by month.",
  data("x", "line", "Indexed growth · {Base date} = 100", ["growth_index", "benchmark_index"], ["month"], sort="label_asc", labels={"growth_index": "Portfolio", "benchmark_index": "Benchmark"})),
 ("return_by_period", "Return by period", "☷", "Table of TWR, MWR, benchmark and relative return for the quarter, half, year, 3 years and since inception.",
  data("x", "table", "Return by period", ["return_twr", "mwr", "benchmark_return", "excess_return"], ["return_period"], labels=RET_LABELS)),
 ("risk_characteristics", "Risk characteristics", "σ", "List of 3-year volatility, Sharpe ratio, maximum drawdown, tracking error and information ratio.",
  data("x", "list", "Risk characteristics · 3 years", ["volatility", "sharpe_ratio", "max_drawdown", "tracking_error", "information_ratio"], period="3y")),
 ("twr_vs_mwr", "TWR vs MWR", "⇄", "KPI cards comparing the time-weighted and money-weighted return with the period's net flows.",
  data("x", "kpi", "Time- and money-weighted return", ["return_twr", "mwr", "net_flows"])),
 ("account_breakdown", "Return by account", "☰", "Table of value, TWR, MWR and contribution to return for each account.",
  data("x", "table", "Return by account", ["market_value", "return_twr", "mwr", "contribution"], ["portfolio"], labels=RET_LABELS)),
 ("entity_breakdown", "Return by entity", "⚇", "Table of value, TWR, MWR and contribution for each client entity in the household.",
  data("x", "table", "Return by entity", ["market_value", "return_twr", "mwr", "contribution"], ["client"])),
 ("currency_effect", "Currency effect", "¤", "Table of local-currency return, currency effect and USD return by account currency.",
  data("x", "table", "Return by account currency", ["return_local", "fx_effect", "return_twr"], ["account_currency"])),
 ("asset_allocation", "Asset allocation", "◔", "Pie chart of weight by asset class at the period end.",
  data("x", "pie", "Asset allocation", ["weight"], ["asset_class"], width="half")),
 ("lookthrough_allocation", "Look-through allocation", "◑", "Pie chart of weight by asset class, splitting structured products into their components.",
  data("x", "pie", "Asset allocation (look-through)", ["weight"], ["lookthrough_asset_class"], width="half")),
 ("allocation_change", "Allocation change", "⇅", "Bar chart of asset-class weights this year vs last year.",
  data("x", "bar", "Weight by asset class · this year vs last year", ["weight"], ["asset_class"], compare="previous_year")),
 ("top_holdings", "Top holdings", "☰", "Table of the 10 largest holdings with value, weight, asset class and sector.",
  data("x", "table", "Top 10 holdings", ["market_value", "weight"], ["security", "asset_class", "sector"], topN=10)),
]
w("/* ---------- Ready-made blocks (also the composition agent's module library) ---------- */\n")
w("INSERT studio.BlockPreset (PresetKey, Label, Icon, Description, BlockJson, SortOrder) VALUES")
def strip_id(b):
    b = dict(b); b.pop("id"); return b
w(",\n".join(f" (N'{k}', N'{q(l)}', N'{ic}', N'{q(d)}',\n  N'{q(j(strip_id(b)))}', {i})" for i, (k, l, ic, d, b) in enumerate(presets, 1)) + ";\nGO\n")

w("/* ---------- Seeded templates ---------- */\n")
w("DECLARE @Id INT;\n")
def report(name, category, desc, versions):
    w(f"INSERT studio.Report (Name, Category, Description, CreatedOn)\nVALUES (N'{q(name)}', N'{q(category)}', N'{q(desc)}', '2026-09-01T09:00:00');\nSET @Id = SCOPE_IDENTITY();")
    w("INSERT studio.ReportVersion (ReportId, VersionNo, Status, DefinitionJson, PreviewPassed, CreatedBy, CreatedOn, UpdatedBy, UpdatedOn, SubmittedBy, SubmittedOn, ReviewedBy, ReviewedOn, ReviewComment) VALUES")
    rows = []
    for no, status, definition in versions:
        if status == "Published":
            meta = "1, N'priya.shah', '2026-09-01T09:00:00', N'priya.shah', '2026-09-01T09:30:00', N'priya.shah', '2026-09-01T09:30:00', N'james.mokoena', '2026-09-02T11:00:00', N'Seeded version.'"
        elif status == "Submitted":
            meta = "1, N'priya.shah', '2026-10-20T09:00:00', N'priya.shah', '2026-10-20T09:30:00', N'priya.shah', '2026-10-20T09:30:00', NULL, NULL, NULL"
        else:
            meta = "0, N'priya.shah', '2026-10-28T10:00:00', N'priya.shah', '2026-10-28T10:00:00', NULL, NULL, NULL, NULL, NULL"
        rows.append(f" (@Id, {no}, N'{status}',\n  N'{q(j(definition))}',\n  {meta})")
    w(",\n".join(rows) + ";\n")
report("Annual Investment Review", "Client reporting",
       "The full annual review: letter, snapshot, performance (TWR and MWR), household and entities, allocation, holdings, structured products, currency, changes, commentary, costs and disclosures.",
       [(1, "Published", annual)])
report("Portfolio Summary", "Client reporting", "A short summary of performance, allocation and cash flows.",
       [(1, "Published", summary_v1), (2, "Draft", summary_v2)])
report("Costs and Charges Statement", "Regulatory", "Fees charged in the period, by account and quarter.",
       [(1, "Submitted", costs)])
w("GO")
open(out_path, "w").write("\n".join(L) + "\n")
print("pages:", len(annual["pages"]), "combos:", len(list(combos())), "measures:", len(measures))
