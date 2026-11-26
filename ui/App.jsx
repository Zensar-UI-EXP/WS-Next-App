import { createContext, useContext, useEffect, useRef, useState } from "react";
import { errorMessage, getCatalog, getCoverOptions, getLookup, getMethodology, getUsers, setUser } from "./api.js";
import { setCoverOptions } from "./cover.js";
import Designer from "./designer/Designer.jsx";
import ReportList from "./components/ReportList.jsx";
import ApproverHome, { Review } from "./components/ApproverHome.jsx";
import Home from "./wealth/Home.jsx";
import Analyse from "./wealth/Analyse.jsx";
import CreateReport from "./wealth/CreateReport.jsx";
import Preparing from "./wealth/Preparing.jsx";
import Customize from "./wealth/Customize.jsx";
import FinalReport from "./wealth/FinalReport.jsx";
import ReportHistory from "./wealth/ReportHistory.jsx";
import Records from "./wealth/Records.jsx";
import Templates from "./wealth/Templates.jsx";
import { ReviewQueue, ReportReview } from "./wealth/Reviews.jsx";
import { AiMonitoring, AuditTrail, DataQuality, Methodology } from "./governance/Governance.jsx";
import ReportBuilder from "./agents/ReportBuilder.jsx";
import AgentReports from "./agents/AgentReports.jsx";
import AgentRun from "./agents/AgentRun.jsx";
import ReportPage from "./agents/ReportPage.jsx";
import AgentCustomize from "./agents/AgentCustomize.jsx";
import Knowledge from "./agents/Knowledge.jsx";
import CoverTemplates from "./designer/CoverTemplates.jsx";
import CoverOptions from "./agents/CoverOptions.jsx";

export const ROLE_LABELS = {
  Advisor: "Wealth manager", Designer: "Reporting admin", Approver: "Compliance (KI)", Operations: "Operations", Client: "Client",
};
const STORAGE_KEY = "wis-user";

/** Navigation and shared state for every screen: go("create"), go("customize", 12), user, role, guide. */
export const Studio = createContext(null);
export const useStudio = () => useContext(Studio);

const HOME = { Designer: "templates", Approver: "reviews", Advisor: "home", Operations: "data-quality", Client: "history" };
const ALL_STAFF = ["Advisor", "Designer", "Approver", "Operations"];

const NAV = [
  { section: "Studio", items: [{ key: "home", label: "Home", icon: "⌂", roles: ALL_STAFF }] },
  {
    section: "Analyse",
    items: [
      { key: "analyse", label: "Analyse portfolio", icon: "↗", roles: ["Advisor"] },
      { key: "soon:Book of business", label: "Book of business", icon: "▤", roles: ["Advisor"] },
      { key: "soon:Data explorer", label: "Data explorer", icon: "▦", roles: ["Advisor"] },
    ],
  },
  {
    // V7: the agent-led design (lead agent + performance and reporting specialists) beside the V4 studio.
    section: "Agent studio",
    items: [
      { key: "agent-builder", label: "Ask the agents", icon: "✦", roles: ["Advisor"] },
      { key: "agent-reports", label: "Agent reports", icon: "◷", roles: ["Advisor"] },
      { key: "knowledge", label: "Knowledge & rules", icon: "❖", roles: ["Advisor", "Operations"] },
      { key: "cover-options", label: "Cover options", icon: "◩", roles: ["Designer", "Approver"] },
    ],
  },
  {
    section: "Report",
    items: [
      { key: "create", label: "Create report", icon: "＋", roles: ["Advisor"] },
      { key: "history", label: "Report history", clientLabel: "My reports", icon: "◷", roles: ["Advisor", "Client"] },
      { key: "templates", label: "Templates", icon: "▭", roles: ["Advisor", "Designer", "Approver"] },
      { key: "cover-templates", label: "Cover templates", icon: "▧", roles: ["Designer", "Approver"] },
    ],
  },
  {
    section: "Review & publish",
    items: [
      { key: "reviews", label: "Report reviews", icon: "✓", roles: ["Approver"] },
      { key: "approvals", label: "Template approvals", icon: "⚖", roles: ["Approver"] },
    ],
  },
  { section: "Records", items: [{ key: "clients", label: "Households", icon: "⚉", roles: ["Advisor", "Approver", "Operations"] }] },
  {
    section: "Trust & governance",
    items: [
      { key: "data-quality", label: "Data quality", icon: "◈", roles: ALL_STAFF },
      { key: "audit", label: "Audit trail", icon: "☰", roles: ["Approver", "Operations"] },
      { key: "ai-monitoring", label: "AI monitoring", icon: "✦", roles: ["Approver", "Operations"] },
      { key: "methodology", label: "Methodology & lineage", icon: "⚙", roles: ALL_STAFF },
    ],
  },
];

function savedUser() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export default function App() {
  const [users, setUsers] = useState(null);
  const [userId, setUserId] = useState(savedUser);
  const [error, setError] = useState(null);

  useEffect(() => {
    getUsers().then((list) => {
      setUsers(list);
      if (!list.some((u) => u.userId === userId))
        setUserId((list.find((u) => u.userId === "eleanor.hartley") ?? list.find((u) => u.role === "Advisor") ?? list[0])?.userId);
    }).catch((e) => setError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const user = users?.find((u) => u.userId === userId);
  if (error) return <div className="notice error app-error">{error}</div>;
  if (!user) return <div className="center-message">Loading…</div>;
  setUser(user.userId);
  return <Shell key={user.userId} user={user} users={users} onSwitch={(id) => {
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* storage may be unavailable; the choice still applies */ }
    setUserId(id);
  }} />;
}

function Shell({ user, users, onSwitch }) {
  const role = user.role;
  const [route, setRoute] = useState({ name: HOME[role] });
  const [navOpen, setNavOpen] = useState(true);
  const [guide, setGuide] = useState(true);
  const [catalog, setCatalog] = useState(null);
  const [lookups, setLookups] = useState({});
  const [disclosures, setDisclosures] = useState([]);
  const [error, setError] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [optionsReady, setOptionsReady] = useState(false);

  // V10: every cover is drawn and edited with the approved cover options, so they load before any screen.
  useEffect(() => {
    getCoverOptions().then((d) => setCoverOptions(d.approved)).catch((e) => setError(errorMessage(e))).finally(() => setOptionsReady(true));
  }, []);

  useEffect(() => {
    if (role === "Client") return;
    getCatalog().then(setCatalog).catch((e) => setError(errorMessage(e)));
    getMethodology().then((m) => setDisclosures(m.disclosures)).catch(() => {});
    if (role === "Designer" || role === "Approver")
      Promise.all([getLookup("household"), getLookup("client"), getLookup("portfolio")])
        .then(([household, client, portfolio]) => setLookups({ household, client, portfolio }))
        .catch((e) => setError(errorMessage(e)));
  }, [role]);

  const go = (name, id = null) => {
    setRoute({ name, id });
    // Full-width editors start with the navigation folded away, as in the mockups.
    setNavOpen(!["customize", "designer"].includes(name));
    window.scrollTo(0, 0);
  };

  const visible = (roles) => !roles || roles.includes(role);
  const activeFor = { "agent-reports": ["agent-reports", "agent-run", "agent-report", "agent-customize"], create: ["create", "preparing", "customize"], reviews: ["reviews", "review-report"], approvals: ["approvals", "review"], templates: ["templates", "designer"] };

  return (
    <Studio.Provider value={{ go, route, user, role, guide, lookups, catalog, disclosures }}>
      <div className={`shell ${navOpen ? "" : "nav-closed"}`}>
        <nav className="sidenav no-print" aria-label="Main">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">◢◣</span>
            <span>Investec</span>
          </div>
          <p className="product-name">Wealth Insights Studio · V10</p>
          {NAV.map((group) => {
            const items = group.items.filter((i) => visible(i.roles));
            if (items.length === 0) return null;
            return (
              <div key={group.section} className="nav-group">
                <p className="nav-section">{group.section}</p>
                {items.map((item) => {
                  const active = (activeFor[item.key] ?? [item.key]).includes(route.name) || (route.name === "soon" && route.id === item.label);
                  return (
                    <button key={item.key} type="button" className={`nav-item ${active ? "active" : ""}`}
                      onClick={() => (item.key.startsWith("soon:") ? go("soon", item.label) : go(item.key))}>
                      <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                      {role === "Client" && item.clientLabel ? item.clientLabel : item.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
          <p className="nav-tagline">Out of<br /><em>the ordinary</em></p>
        </nav>

        <div className="main">
          <header className="topbar no-print">
            <button type="button" className="icon-btn" aria-label={navOpen ? "Hide navigation" : "Show navigation"} onClick={() => setNavOpen(!navOpen)}>≡</button>
            <TopbarSlot />
            <div className="topbar-right">
              <button type="button" className="btn small" onClick={() => setShowMap(true)}>Workflow map</button>
              <button type="button" className={`btn small ${guide ? "" : "off"}`} onClick={() => setGuide(!guide)}>Guide {guide ? "on" : "off"}</button>
              <label className="persona" title="POC: no single sign-on, so pick who you are">
                <span className="avatar">{user.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
                <select value={user.userId} onChange={(e) => onSwitch(e.target.value)} aria-label="Signed in as">
                  {Object.entries(ROLE_LABELS).map(([r, label]) => (
                    <optgroup key={r} label={label}>
                      {users.filter((u) => u.role === r).map((u) => <option key={u.userId} value={u.userId}>{u.name} · {u.title}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
            </div>
          </header>

          {error && <div className="notice error app-error">{error}</div>}
          <main className="content">
            {optionsReady ? <Screen route={route} role={role} catalog={catalog} lookups={lookups} disclosures={disclosures} /> : <Loading />}
          </main>
        </div>
      </div>
      {showMap && <WorkflowMap role={role} onClose={() => setShowMap(false)} />}
    </Studio.Provider>
  );
}

/** Breadcrumb area of the top bar; screens fill it through a portal-free registry. */
let setCrumbs = () => {};
export function useCrumbs(crumbs) {
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    setCrumbs(crumbs);
    return () => setCrumbs(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
function TopbarSlot() {
  const [crumbs, set] = useState(null);
  setCrumbs = set;
  const { go } = useStudio();
  if (!crumbs) return <span className="crumbs" />;
  return (
    <span className="crumbs">
      {crumbs.back && (
        <button type="button" className="btn small" onClick={crumbs.back.onClick ?? (() => go(crumbs.back.to, crumbs.back.id))}>← {crumbs.back.label}</button>
      )}
      <span className="muted">{crumbs.section}</span>
      {crumbs.section && " / "}
      <strong>{crumbs.title}</strong>
    </span>
  );
}

function Screen({ route, role, catalog, lookups, disclosures }) {
  const { go } = useStudio();
  switch (route.name) {
    case "agent-builder":
      return <ReportBuilder />;
    case "agent-reports":
      return <AgentReports />;
    case "agent-run":
      return <AgentRun key={route.id} reportId={route.id} />;
    case "agent-report":
      return <ReportPage key={route.id} reportId={route.id} />;
    case "agent-customize":
      return <AgentCustomize key={route.id} reportId={route.id} />;
    case "cover-templates":
      return <CoverTemplates />;
    case "knowledge":
      return <Knowledge />;
    case "cover-options":
      return <CoverOptions />;
    case "home":
      return <Home />;
    case "analyse":
      return <Analyse key={route.id ?? "none"} householdId={route.id} />;
    case "create":
      return <CreateReport householdId={route.id} />;
    case "preparing":
      return <Preparing key={route.id} reportId={route.id} />;
    case "customize":
      return <Customize key={route.id} reportId={route.id} />;
    case "report":
      return <FinalReport key={route.id} reportId={route.id} />;
    case "history":
      return <ReportHistory />;
    case "reviews":
      return <ReviewQueue />;
    case "review-report":
      return <ReportReview key={route.id} reportId={route.id} />;
    case "clients":
      return <Records />;
    case "templates":
      return role === "Designer" ? <ReportList onOpen={(id) => go("designer", id)} /> : <Templates />;
    case "designer":
      return catalog ? <Designer key={route.id} reportId={route.id} catalog={catalog} lookups={lookups} disclosures={disclosures} onBack={() => go("templates")} /> : <Loading />;
    case "approvals":
      return <ApproverHome onOpen={(id) => go("review", id)} />;
    case "review":
      return <Review key={route.id} reportId={route.id} lookups={lookups} onBack={() => go("approvals")} />;
    case "data-quality":
      return <DataQuality />;
    case "audit":
      return <AuditTrail />;
    case "ai-monitoring":
      return <AiMonitoring />;
    case "methodology":
      return <Methodology />;
    default:
      return <ComingSoon label={route.id} />;
  }
}

const Loading = () => <div className="center-message">Loading…</div>;

function ComingSoon({ label }) {
  useCrumbs({ section: "Analyse", title: label });
  return (
    <div className="page-pad">
      <p className="eyebrow">Coming soon</p>
      <h1 className="display">{label}</h1>
      <p className="muted">This area is part of the wider studio design and is not built in this proof of concept.</p>
    </div>
  );
}

function WorkflowMap({ role, onClose }) {
  const ref = useRef(null);
  useEffect(() => ref.current?.showModal(), []);
  const steps = [
    { who: "Designer", text: "Builds templates from pages, approved catalogue fields and library disclosures; marks compliance pages locked; gives text blocks a narrative brief." },
    { who: "Approver", text: "Approves the template (segregation of duties: never their own). Only released templates can be used." },
    { who: "Advisor", text: "Picks a household, entity or account, the period and the pages, after checking the portfolio in Analyse portfolio." },
    { who: "Orchestrator", text: "Client context → data readiness → performance & insight → narrative (AI) → composition (AI) → release readiness. Engines calculate; AI drafts; every figure is checked." },
    { who: "Advisor", text: "Reviews and tailors the pages (or asks the studio), then submits. Submission is refused while release readiness has blockers." },
    { who: "Approver", text: "Reviews the report with its readiness checks, AI provenance and audit trail; publishes it or returns it with a comment." },
    { who: "Client", text: "Reads the published reports for their household." },
    { who: "Operations", text: "Runs the data-quality checks, resolves or signs off exceptions, and monitors the AI and the audit trail." },
  ];
  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <header>
        <h2>Workflow map</h2>
        <button type="button" className="btn" onClick={() => ref.current.close()}>Close</button>
      </header>
      <ol className="workflow">
        {steps.map((s, i) => (
          <li key={i} className={s.who === role ? "current" : ""}>
            <span className="step-no">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <strong>{ROLE_LABELS[s.who] ?? s.who}</strong>
              <p>{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="muted">Workflows orchestrate. Engines calculate. AI drafts and explains. People approve.</p>
    </dialog>
  );
}
