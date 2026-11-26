import { useEffect, useState } from "react";
import { createReport, errorMessage, getReports } from "../api.js";
import { useCrumbs } from "../App.jsx";

/** Designer home: every report with its published and working versions, plus "New report". */
export default function ReportList({ onOpen }) {
  const [reports, setReports] = useState(null);
  const [form, setForm] = useState({ name: "", category: "Client reporting" });
  const [error, setError] = useState(null);
  useCrumbs({ section: "Report", title: "Templates" });

  useEffect(() => {
    getReports().then(setReports).catch((e) => setError(errorMessage(e)));
  }, []);

  const create = async (e) => {
    e.preventDefault();
    try {
      const detail = await createReport(form);
      onOpen(detail.reportId);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="page-pad">
      <p className="eyebrow">Report templates</p>
      <h1 className="display">Templates</h1>
      <p className="muted">Open a template to change it. Changes are saved as a new draft version; wealth managers keep using the released version until compliance approves the new one.</p>
      {error && <div className="notice error">{error}</div>}
      <div className="card-grid">
        {(reports ?? []).map((r) => (
          <button key={r.reportId} type="button" className="report-card" onClick={() => onOpen(r.reportId)}>
            <span className="category">{r.category}</span>
            <strong>{r.name}</strong>
            <span className="muted">{r.description}</span>
            <span className="versions">
              {r.publishedVersionNo && <span className="status published">Released v{r.publishedVersionNo}</span>}
              {r.workingVersionNo && <span className={`status ${r.workingStatus.toLowerCase()}`}>{r.workingStatus} v{r.workingVersionNo}</span>}
            </span>
          </button>
        ))}
        <form className="report-card new" onSubmit={create}>
          <strong>New template</strong>
          <label className="field">
            <span>Name</span>
            <input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            <span>Category</span>
            <input required maxLength={100} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </label>
          <button type="submit" className="primary">Create and open</button>
        </form>
      </div>
    </div>
  );
}
