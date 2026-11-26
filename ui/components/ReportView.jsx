import { useState } from "react";
import PageSheet from "./PageSheet.jsx";
import { BackCover } from "./CoverSheet.jsx";

/**
 * A finished report: every included page as a printed sheet. `results` is a list of block results;
 * `showSql` adds a "View SQL" list under each page (approver only).
 */
export default function ReportView({ definition, results, ctx, showSql = false, showProvenance = false }) {
  const byId = Object.fromEntries((results ?? []).map((b) => [b.blockId, { result: b }]));
  const pages = definition.pages.filter((p) => p.included !== false);
  return (
    <div className="report-pages">
      {pages.map((page, i) => (
        <div key={page.id} className="report-page-wrap">
          <PageSheet page={page} results={byId} ctx={ctx} branding={definition.branding} cover={definition.cover} pageNumber={i + 1} pageCount={pages.length} showProvenance={showProvenance} />
          {showSql && <PageSql page={page} results={byId} />}
        </div>
      ))}
      {definition.cover?.backCover && <div className="report-page-wrap"><BackCover cover={definition.cover} ctx={ctx} /></div>}
    </div>
  );
}

function PageSql({ page, results }) {
  const [open, setOpen] = useState(null);
  const withSql = page.blocks.filter((b) => results[b.id]?.result?.sql);
  if (withSql.length === 0) return null;
  return (
    <div className="sql-toggle no-print">
      {withSql.map((b) => (
        <div key={b.id}>
          <button type="button" className="link-button" onClick={() => setOpen(open === b.id ? null : b.id)}>
            {open === b.id ? "Hide" : "View SQL"} · {b.title || b.id}
          </button>
          {open === b.id && <pre className="sql">{results[b.id].result.sql}</pre>}
        </div>
      ))}
    </div>
  );
}
