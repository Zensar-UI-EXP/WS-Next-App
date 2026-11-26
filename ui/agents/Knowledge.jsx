import { useEffect, useState } from "react";
import { errorMessage, getKnowledge, runPublish } from "../api.js";
import { formatDate } from "../format.js";
import { useCrumbs, useStudio } from "../App.jsx";

/** Knowledge & rules: the shared context the agents read, and the period close that publishes the standard figures. */
export default function Knowledge() {
  const { role } = useStudio();
  const [k, setK] = useState(null);
  const [section, setSection] = useState("data_dictionary");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useCrumbs({ section: "Agent studio", title: "Knowledge & rules" });

  const load = () => getKnowledge().then(setK).catch((e) => setError(errorMessage(e)));
  useEffect(() => { load(); }, []);
  const publish = async () => {
    setBusy(true);
    setError(null);
    try { await runPublish(); await load(); } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  };

  if (!k) return <div className="center-message">{error ?? "Loading…"}</div>;
  const run = k.publishRun;
  return (
    <div className="page-pad">
      <p className="eyebrow">Agent studio · shared context</p>
      <h1 className="display">Knowledge &amp; rules</h1>
      <p className="muted">What every agent reads: the data dictionary, display components, report rules, disclosures, ready-made modules,
        the published figure sets and the reusable report definitions. It is built from the approved catalogue, so the agents only see what is approved.</p>
      {error && <div className="notice error">{error}</div>}
      <section className="card">
        <div className="inline-row">
          <h2>Published figures</h2>
          {role === "Operations" && <button type="button" className="btn primary" disabled={busy} onClick={publish}>{busy ? "Publishing…" : "Run period close"}</button>}
        </div>
        <p className="small muted">
          {run ? `Last period close: ${run.results} results published for data as of ${formatDate(String(run.asOfDate).slice(0, 10), "long")}, finished ${new Date(run.finishedOn).toLocaleString("en-GB")}.`
            : "Nothing has been published yet. Operations runs the period close."}
          {" "}The Reporting API reads these for closed standard periods and calculates everything else.
        </p>
      </section>
      <div className="segmented">
        {k.sections.map((s) => <button key={s.key} type="button" className={section === s.key ? "on" : ""} onClick={() => setSection(s.key)}>{s.key.replace(/_/g, " ")}</button>)}
      </div>
      <pre className="knowledge-text">{k.sections.find((s) => s.key === section)?.text}</pre>
    </div>
  );
}
