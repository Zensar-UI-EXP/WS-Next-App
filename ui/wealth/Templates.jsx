import { useEffect, useState } from "react";
import { errorMessage, getReports, getTemplates } from "../api.js";
import { useCrumbs, useStudio } from "../App.jsx";
import { conditionLabel } from "../rules.js";

/**
 * Templates gallery (wealth manager: released templates and their pages; approver/others: status of every
 * template). With `governance`, shows the approval status list.
 */
export default function Templates({ governance = false }) {
  const { role, go } = useStudio();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  useCrumbs({ section: governance ? "Records" : "Report", title: governance ? "Governance" : "Templates" });

  useEffect(() => {
    const load = role === "Advisor"
      ? getTemplates()
      : getReports().then((rs) => rs.map((r) => ({
        reportId: r.reportId, name: r.name, category: r.category, description: r.description, versionNo: r.publishedVersionNo,
        status: r.publishedVersionNo ? "Released" : r.workingStatus === "Submitted" ? "Awaiting approval" : "In design",
        working: r.workingVersionNo ? `${r.workingStatus} v${r.workingVersionNo}` : null, pages: null,
      })));
    load.then(setList).catch((e) => setError(errorMessage(e)));
  }, [role]);

  return (
    <div className="page-pad">
      <p className="eyebrow">{governance ? "Template governance" : "Report templates"}</p>
      <h1 className="display">{governance ? "Governance" : "Templates"}</h1>
      <p className="muted">
        {governance
          ? "Templates are designed, then approved by compliance before wealth managers can use them. Locked pages cannot be changed in client reports."
          : "Approved templates wealth managers can build client reports from."}
      </p>
      {error && <div className="notice error">{error}</div>}
      <div className="template-gallery">
        {(list ?? []).map((t) => (
          <article key={t.reportId} className="template-tile">
            <span className="thumb" aria-hidden="true"><span /></span>
            <div>
              <p className="eyebrow">{t.category}</p>
              <h2>{t.name}</h2>
              <p className="muted small">{t.description}</p>
              <p>
                <span className={`status-pill ${t.status === "Released" ? "released" : "pending"}`}>{t.status}{t.versionNo ? ` · v${t.versionNo}` : ""}</span>
                {t.working && <span className="status-pill draft">{t.working}</span>}
              </p>
              {t.pages && t.pages.length > 0 && (
                <ol className="mini-pages">
                  {t.pages.map((p) => <li key={p.id}>{p.title}{p.locked ? " 🔒" : ""}{p.condition ? <span className="muted"> · only if {conditionLabel(p.condition).replace(/^The /, "the ")}</span> : ""}</li>)}
                </ol>
              )}
              {role === "Advisor" && t.status === "Released" && !governance && (
                <button type="button" className="btn small" onClick={() => go("create")}>Use for a report</button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
