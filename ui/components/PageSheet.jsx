import BlockContent from "./BlockContent.jsx";
import CoverSheet from "./CoverSheet.jsx";
import { ACCENTS } from "../format.js";
import { ORIGINS, fillPlaceholders } from "../rules.js";

const FONTS = {
  serif: "'Source Serif 4', Georgia, serif",
  sans: "Inter, system-ui, sans-serif",
  classic: "Georgia, 'Times New Roman', serif",
};

/**
 * One printed page (A4 proportions): section label, heading, blocks in a two-column grid, footer.
 * With `onSelect`, every element is clickable ("click anything on the page to edit it"): the heading
 * selects "heading", a block selects its id. `children` replaces the block grid (the designer's editable grid).
 */
export default function PageSheet({ page, results = {}, ctx, branding, cover, pageNumber, pageCount, selectedId, onSelect, children, className = "", showProvenance = false }) {
  // V7: a report with designed cover settings shows its cover page as the designed cover.
  if (cover && page.layout === "cover" && !children) {
    return <CoverSheet cover={cover} ctx={ctx} pageCount={pageCount} className={className} onSelect={onSelect} selected={selectedId === "cover"} />;
  }
  const accent = ACCENTS[branding?.accent]?.color ?? ACCENTS.navy.color;
  const style = {
    "--accent": accent,
    "--sheet-font": FONTS[page.style?.typeface] ?? FONTS.serif,
    "--body-size": `${page.style?.bodySize ?? 10}pt`,
    "--body-line": page.style?.lineHeight ?? 1.5,
  };
  const pick = (id) => (e) => {
    if (!onSelect) return;
    e.stopPropagation();
    onSelect(id);
  };
  const selectable = onSelect ? "selectable" : "";

  return (
    <article className={`sheet layout-${page.layout ?? "standard"} ${className}`} style={style} onClick={onSelect ? () => onSelect(null) : undefined}>
      {page.layout === "cover" && <div className="cover-band" />}
      {(page.sectionLabel || page.heading) && (
        <header className={`sheet-head ${selectable} ${selectedId === "heading" ? "selected" : ""}`} onClick={pick("heading")}>
          {page.sectionLabel && <p className="section-label">{fillPlaceholders(page.sectionLabel, ctx)}</p>}
          {page.heading && <h1 className="sheet-heading">{fillPlaceholders(page.heading, ctx)}</h1>}
        </header>
      )}
      {children ?? (
        <div className="sheet-grid">
          {page.blocks.map((block) => (
            <section
              key={block.id}
              className={`sheet-block ${block.width === "half" ? "half" : "full"} type-${block.type} ${selectable} ${selectedId === block.id ? "selected" : ""}`}
              onClick={pick(block.id)}
            >
              {showProvenance && ORIGINS[block.origin]?.ai && <span className="ai-badge no-print" title={ORIGINS[block.origin].label}>✦ AI</span>}
              {showProvenance && results[block.id]?.result?.source && (
                <span className={`source-badge no-print src-${results[block.id].result.source}`}
                  title={results[block.id].result.source === "published" ? "From the published figures" : "Calculated by the calculation library"}>
                  {results[block.id].result.source === "published" ? "Published" : "Calculated"}
                </span>
              )}
              <BlockContent block={block} state={results[block.id]} ctx={ctx} />
            </section>
          ))}
          {page.blocks.length === 0 && <p className="muted empty-page">This page has no content yet.</p>}
        </div>
      )}
      <footer className="sheet-foot">
        <span>
          {branding?.showLogo !== false && <span className="wordmark">Investec</span>}
          {ctx?.["{Report name}"]}{ctx?.["{Client}"] ? ` · ${ctx["{Client}"]}` : ""}
        </span>
        {pageNumber && <span>Page {pageNumber}{pageCount ? ` of ${pageCount}` : ""}</span>}
      </footer>
    </article>
  );
}
