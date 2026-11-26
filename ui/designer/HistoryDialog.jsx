import { useEffect, useRef } from "react";

const when = (iso) => (iso ? new Date(iso + (iso.endsWith("Z") ? "" : "Z")).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");

/** Version history: who changed, submitted and reviewed each version. Any version can be opened read-only. */
export default function HistoryDialog({ versions, onOpen, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog ref={ref} className="history" onClose={onClose}>
      <header>
        <h2>Version history</h2>
        <button type="button" className="ghost" onClick={() => ref.current.close()}>Close</button>
      </header>
      <table className="data-table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Status</th>
            <th>Last change</th>
            <th>Submitted</th>
            <th>Review</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.versionId}>
              <td>v{v.versionNo}</td>
              <td><span className={`status ${v.status.toLowerCase()}`}>{v.status}</span></td>
              <td>{v.updatedBy}, {when(v.updatedOn)}</td>
              <td>{v.submittedOn ? `${v.submittedBy}, ${when(v.submittedOn)}` : "—"}</td>
              <td>
                {v.reviewedOn ? (
                  <>
                    {v.status === "Draft" ? "Returned" : "Approved"} by {v.reviewedBy}, {when(v.reviewedOn)}
                    {v.reviewComment && <div className="muted">“{v.reviewComment}”</div>}
                  </>
                ) : "—"}
              </td>
              <td>
                <button type="button" className="link-button" onClick={() => { onOpen(v.versionNo); ref.current.close(); }}>Open</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </dialog>
  );
}
