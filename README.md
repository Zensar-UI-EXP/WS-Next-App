# Wealth Insights Studio — POC v10 (V9 + cover options configured in the platform)

V10 is V9 with the cover options moved out of code into a governed configuration. In **Agent studio → Cover options** the
reporting admin (Priya Shah) decides what the Cover tab offers and what the cover agent may do; compliance (James Mokoena)
approves each version, and from then on the Cover tab, the cover template designer and the cover agent all use it.

| Configurable in the platform (no code change) | Still needs a developer |
|---|---|
| Switch each value on or off, rename it, change the order | A new layout, band shape, image, font or size (its drawing / CSS) |
| Rename an option | A new kind of option (e.g. border style) |
| Add colour themes (name + colour) and business tags | |
| Whether the cover agent may change an option (or recommend a template) | |
| Whether a choice is planned ahead (instant) or checked with a quick call | |

- Values added in code after an option was configured appear on the page **switched off** until an admin switches them on.
- Colours are design tokens: a new theme is only a name and a colour, so it needs no CSS.
- Old covers keep values that are switched off later; the editor shows them as "(no longer offered)" and release readiness warns the reviewer.
- The page lists what a version changes, and which approved cover templates use a value it switches off.
- The server refuses a value the cover cannot draw, plans only the choices marked "planned ahead", and drops any agent change to an option it may not change.

Files: `database/10_cover_options.sql` (studio.CoverOptionSet: Draft → Submitted → Approved), `lib/coverOptions.ts` (catalogue,
validation, versions), `ui/agents/CoverOptions.jsx` (the page); `lib/coverAgent.ts`, `ui/cover.js`, `CoverEditor.jsx` and `CoverSheet.jsx` read the approved version.

Tested on 18 Nov 2026 (Marula FY 2025): switched off Centred title, renamed Minimal white to Clean white, added Forest green, stopped the agent
changing the colour theme, approved as v2. The Cover tab offered exactly those values; the plan (14 s, 5.7k tokens) planned no Centred title and
no theme change, and nothing had to be dropped; Forest green drew from its configured colour (quick call 1.9 s, nothing else changed); Split
applied its planned changes at once and a quick call made the title Small. Saving `fullbleed` was refused ("needs a developer first").

---

# Earlier: POC v9

V9 is V8 with the cover agent reworked so that **the agent decides what goes with each choice and applies it straight away**,
without making you wait or costing 13–32k tokens a time. Every customisation in the Cover tab is still an option; there is no
free-text "Ask the studio" for the cover.

- **Plans ahead when the Cover tab opens** (one call, Claude Opus 5.5 at low effort): its recommendations for this client (★ with a
  reason) and, for every choice you may make next (each other template, layout, image, band, title position, alignment and size,
  logo and logo position, language), which other options should change with it. The plan is kept on the server, so opening the tab
  again costs nothing; "Plan again" makes a new one.
- **A planned choice applies at once**, with no call: you pick Colour band and the plan's changes (e.g. centred title, logo top left)
  are applied in the same moment, each with its reason and an **Undo**.
- **The browser then measures the drawn cover** (title lines, overlaps, text in the footer or off the page). If the choice was not
  planned, or the measurements show a problem, **one quick call** to a smaller model (Claude Haiku 5.5, low effort) decides what else
  to change, and that is applied too (with Undo). Typing the co-brand or dragging the overlay waits 0.7 s for you to stop.
- The agent never changes an option you chose yourself in this session (including ones you undid), never writes the cover's words,
  and its answers are checked on the server: approved values only, the client's recorded co-brand only, and nothing that breaks a
  compliance rule.

V3–V8 are unchanged.

| | |
|---|---|
| App (UI + API) | http://localhost:5803 |
| Database | `WealthInsightsV10Db` (its own copy) on the local SQL Server in Docker (`wrs-sql`, localhost,1433) |
| AI | Plan: `claude-opus-5-5` (fallback `claude-opus-4-8`, `AI_PLAN_EFFORT`, default low). Quick decisions: `AI_FAST_MODEL` (default `claude-haiku-5-5`, `AI_FAST_EFFORT` low, thinking off). Other agents as V8 (`AI_MODEL`, `AI_EFFORT`) |
| Users | as V4: Eleanor Hartley, Daniel Brooks (wealth managers), Priya Shah (designer), James Mokoena (compliance), Sam Patel (operations, period close), Naledi Marula, Anna Becker (clients) |

## V9: why it is faster and cheaper than V8

| V8 | V9 |
|---|---|
| 4–6 model calls per run (read client, read rules, check, draw, submit), each resending everything | One call: the client, rules, templates, cover and measurements are sent together; the answer comes back as checked JSON (structured output) |
| Pictures of the cover (about 600 tokens each, resent on every later call) | Measurements as a few lines of text; no picture |
| Only the instructions cached | Instructions, rules and templates cached, and the client block cached too |
| Opus for every follow-up | Opus once for the plan; Haiku 5.5 without thinking for quick decisions |
| Wait 2.5 s, then 10–20 s, then accept | Planned choices: instant, no call. Others: one quick call, applied straight away, with Undo |

| | Where | What |
|---|---|---|
| Client cover preferences | `database/09_cover_agent.sql` (`src_client.HouseholdPreference`) | As V8: preferred language, form of address, co-brand name and business area per household |
| The agent | `lib/coverAgent.ts` | `planCover` (recommendations + plan) and `decideCover` (quick decision): one call each with `output_config.format` (zod schema), the fixed part cached. `clean()` keeps only allowed changes and drops the rest (listed in the run's `dropped`) |
| Runs | `studio.CoverAgentRun` | Mode `plan` or `decide`, model, prompt, result, tokens, latency |
| In the browser | `ui/components/coverAgent.jsx` | Applies planned choices, measures the cover off-screen (`measureCover`), asks for a quick decision when needed, applies it, and undoes on request. Ignores an answer if you changed the cover again meanwhile |
| Cover tab | `ui/components/CoverEditor.jsx` | Agent panel: what the agent changed with your latest choice (old → new, reason, Undo, Undo all, "Instant, from the agent's plan" or the time and tokens of the quick call), the recommendations (★, Use all) and the plan (choices covered, time, tokens, Plan again) |
| Routes | `lib/http/routes.ts` | `GET/POST /api/{agent-reports or client-reports}/{id}/cover-agent` (`mode: plan` or `decide`), `…/cover-agent/{runId}/decision` (records applied or undone changes) |
| Governance | | Every call is in AI monitoring (agent "Cover agent", with how many input tokens were cached); applied and undone changes are audit events `cover-agent.applied` / `cover-agent.undone`; a change the agent applies replaces the kept recommendation for that option |

Tested (Marula FY 2025 annual review, Eleanor Hartley, 2026-11-16):

| Step | What happened | Model | Time | Tokens |
|---|---|---|---|---|
| Open the Cover tab | Plan: Family office template, Marula Family Office co-brand, Wealth & Investment tag, formal English, RM card, Georgia regular, overlay 45%; 24 choices planned, nothing dropped | Opus 5.5, low effort | 13 s | 5.3k (3.9k in, 1.5k out) |
| Open it again | Kept plan shown | none | instant | 0 |
| Layout → Colour band (planned) | Tall band, no image, logo top left applied at once; the measured cover passed, so no call | none | instant | 0 |
| Colour theme → Burgundy (not planned) | The saved split cover's title takes three lines, so Title size Medium → Small | Haiku 5.5, no thinking | 2.5 s | 3.6k |
| Layout → Split (not planned now) | Nothing else needs to change | Haiku 5.5, no thinking | 2.0 s | 3.5k (2.9k of it cached) |
| Undo | Puts the option back; audit event `cover-agent.undone` | none | instant | 0 |

Two fixes came out of the test: the quick call ran with thinking on (5–6 s, 650–930 output tokens), so thinking is now off
for it (2–2.5 s, under 110 output tokens); and it also applied unrelated client recommendations (co-brand, business tag, title
weight) after a layout change, so it is now told to change only what the choice affects (the ★ recommendations cover the rest).

## V7 additions on top of V6's agent studio

| | Where | What |
|---|---|---|
| Agent reports to compliance | `POST /api/agent-reports/{id}/submit`, `ReportPage.jsx` | "Send to compliance review" makes the agent report a V4 client report under the released "Agent-built report" template (hidden from the template lists), with the agents' verified figures and findings, and runs V4's release checks. Compliance reviews, approves and publishes it in the V4 screens; the client reads it under My reports. A blocked or returned report is fixed in V4's Customize editor |
| Audit trail | `lib/http/routes.ts` | Agent requests, changes, edits, reusable definitions, sending to review and the period close are audit events |
| AI monitoring | `lib/agents/agentRunner.ts` | Every model turn of every agent is a `gov.AiInteraction` row (agent, tokens, latency, response) |
| Custom periods in review | `07_agents.sql`, `clientReports.periodLabel` | Client reports accept `CUSTOM` periods |

## Designed covers

Every report (agent-built or made from a V4 template) can have a designed cover, edited in the **Cover** tab of the Customize editor.

| Area | Options |
|---|---|
| Layout and design | Colour band, split image/text, minimal white, centred title; band height and shape; approved background image (skyline, waves, grid, peaks, dunes) with an overlay; title position and alignment |
| Branding | Wordmark, monogram or no logo; logo position and size; co-brand name; colour theme (navy, teal, burgundy, graphite); business tag |
| Words | Eyebrow, title, subtitle, report type label, headline figure (verified figures only), personal note, prepared for / prepared by, date (period, as-of, issue date or none); placeholders such as {Client} and {Period} |
| Typography | Title font, size, weight and letter spacing; upper or sentence case labels |
| Personalisation | Cover labels in English or Afrikaans (the report body stays English); formal or first-name; relationship manager card (name and initials) |
| Compliance | Classification line and legal entity line required (a save without them is refused; release check "Cover meets the cover rules"); images only from the approved library; covers come from approved cover templates and record the template version |
| Agents | The cover agent (V8, above); the reporting agent picks an approved cover for the client's segment and writes the title, subtitle, headline and note |
| Output | Back cover; a light cover variant for PDF/print; cover thumbnails in Agent reports |

**Cover templates** (Report → Cover templates): Priya Shah (designer) creates a cover or changes one as a draft and submits it; James
Mokoena (compliance) approves it or returns it with a comment. Wealth managers and the agents only use approved versions. Code:
`lib/cover.ts` (settings and rules), `lib/repos/covers.ts`, `lib/coverAgent.ts`, `ui/components/CoverSheet.jsx`, `CoverEditor.jsx`,
`ui/designer/CoverTemplates.jsx`, `database/08_covers.sql`.

The legal entity line is placeholder wording: the real text must come from compliance. When a report has a designed cover, the cover
page's own text blocks are not shown; move anything you need from them to another page.

## Run it

```bash
cd ~/Desktop/Investec/dev/wealth-insights-studio-v10 && npm run dev
```

Then publish the standard figures once after a database rebuild (the period close; Sam Patel can also do it from **Knowledge & rules**):

```bash
curl -s -X POST -H "X-User: sam.patel" localhost:5803/api/publish
```

Settings and secrets are in `.env.local` (git-ignored): database logins `wis10_reader` / `wis10_app`, `ANTHROPIC_API_KEY` and the AI
settings. SQL passwords are also in `.secrets/sql.env`.

## How the design maps to the code

| Box or arrow in the design | V6 code | What it does |
|---|---|---|
| Report builder (front end) → request | `ui/agents/ReportBuilder.jsx` | Client, standard period or custom dates, optional reusable definition to start from, the request in the user's words |
| Report builder ← report + figures | `ui/agents/ReportPage.jsx`, `AgentRun.jsx` | The report with a status band (as-of date, data status, period, published vs calculated), every verified figure and its source, versions, and the live agent trace |
| Lead agent (coordinator) | `lib/agents/agents.ts` → `runLeadAgent` | Plans, delegates, reads the **report definition** the reporting agent returns and checks it against the request, may delegate again, returns the report. Handles change requests to an existing version |
| Performance agent → API request / ← figures + status | `runPerformanceAgent` | `get_client_context`, `check_data_status`, `get_published_figures`, `calculate_measures`, `submit_findings` |
| Reporting agent → report definition | `runReportingAgent` | `read_knowledge`, `read_reusable_definition`, `preview_block`, `submit_report`; revises its own draft, a previous version, or a reusable definition |
| Reporting API: signed-in user access | `lib/reporting/api.ts` (`ReportingApi`) | Bound to the signed-in user; every call checks their entitlement to the household and is logged in `studio.ReportingApiCall` (user, agent acting for them, endpoint, source, allowed) |
| Reporting API: reads published data via Infrastructure | `lib/reporting/published.ts`, schema `pub` | The period-close job publishes the standard figure sets for every household, entity and account and every closed FY/H/Q period; the API reads them with the read-only login |
| Reporting API: custom periods use the calculation library | `ReportingApi.calculate` → `blockRunner` | Custom or still-open periods, and any other measures or groupings, are calculated |
| Knowledge & rules → context | `lib/agents/knowledge.ts`, `ui/agents/Knowledge.jsx` | Data dictionary, display components, report rules, disclosures, ready-made modules, published figure sets, reusable definitions |
| "Reusable definitions" | `studio.ReusableDefinition` | Saved from any finished report; users start from one, agents read them |

Also on HTTP for the signed-in user: `POST /api/reporting/published` and `POST /api/reporting/calculate`.

## Changing a finished report

Every change is a new version (`studio.AgentReport` `RootId`/`Version`/`ChangeKind`); earlier versions stay readable.

- **Ask the agents to change it**: the lead agent gets the current definition and findings, delegates the change (to the reporting
  agent, and to the performance agent only if new figures are needed) and returns the next version.
- **Customize report** (`ui/agents/AgentCustomize.jsx`, the V4 editor reused for agent reports): pages on the left, the page on a
  canvas where you click any text, chart or table to edit it, and the Inspector (Content, Data status, Suggestions, Branding, Layout)
  with undo/redo and Preview all. **Ask the studio** revises one page with AI (V4's page assistant, given this report's verified figures
  and findings). Charts re-run through the Reporting API as you edit (`POST /api/agent-reports/{id}/preview`). On save the Reporting API
  checks the whole report exactly like the agents' work (an unverified number in the text is refused) and it becomes the next version.
  Disclosures pages are locked; there is no submit or review step.
- **Save as reusable definition**.

## What the tools enforce

The agents decide the plan, the measures, the layout and the words. The tools refuse only what cannot be shown or is not true:
data the signed-in user is not entitled to, measures and group-bys outside the catalogue, displays that break the chart rules,
unknown disclosures, and **any figure in text that the Reporting API did not return**. A refusal goes back to the agent as a tool
error with the reason, and the agent fixes it.

## Database

`database/01`–`06` as in V4, plus `07_agents.sql` and `08_covers.sql` (cover templates) (agent reports with versions, trace, Reporting API call log, reusable
definitions, and the `pub` schema). To rebuild:

```bash
cd ~/Desktop/Investec/dev/wealth-insights-studio-v10/database && set -a && . ../.secrets/sql.env && set +a && export SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" && for f in 01_schema 02_seed 03_data_products 04_catalog_reports; do sqlcmd -S localhost,1433 -U sa -C -b -i $f.sql || break; done && sqlcmd -S localhost,1433 -U sa -C -b -i 05_security.sql -v ReaderPassword="$READER_PASSWORD" AppPassword="$APP_PASSWORD" && sqlcmd -S localhost,1433 -U sa -C -b -i 06_governance.sql && sqlcmd -S localhost,1433 -U sa -C -b -i 07_agents.sql && sqlcmd -S localhost,1433 -U sa -C -b -i 08_covers.sql && sqlcmd -S localhost,1433 -U sa -C -b -i 09_cover_agent.sql && sqlcmd -S localhost,1433 -U sa -C -b -i 10_cover_options.sql && sqlcmd -S localhost,1433 -U sa -C -W -i tests/verify.sql
```

## Compared with V5 (the agent studio, as in V6)

| | V5 | V6 |
|---|---|---|
| Reporting API access | Shared read-only login | Per call, for the signed-in user; logged with the agent acting for them |
| Figures | Always calculated | Published for closed standard periods; calculation library for custom/open periods |
| Periods | Standard only | Standard or custom dates |
| Lead agent sees | An outline of the report | The report definition, which it checks against the request |
| Front end shows | Report and trace | Report, as-of date, data status, published/calculated sources, every verified figure, API calls |
| After the report | View and print | Change by the agents, customize in the V4 editor (with Ask the studio), save as reusable; versions |
