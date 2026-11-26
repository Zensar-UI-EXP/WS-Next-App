import { COVER_LABELS, LEGAL_LINE, themeColour } from "../cover.js";
import { fillPlaceholders } from "../rules.js";

const FONTS = { serif: "'Source Serif 4', Georgia, serif", sans: "Inter, system-ui, sans-serif", classic: "Georgia, 'Times New Roman', serif" };

/** The approved background images: drawn here, so nothing outside the library can appear on a cover. */
export const COVER_IMAGES = {
  skyline: (
    <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <rect width="400" height="300" fill="#c9d3dc" />
      <path d="M0 300V190h30v-40h25v60h20v-90h30v70h18v-40h22v80h26v-120h34v100h20v-50h28v70h24v-30h30v-60h26v90h21v-20h26v110z" fill="#7d8ea0" />
      <path d="M0 300v-60h40v-30h30v50h35v-25h30v45h40v-70h30v60h35v-35h40v55h30v-40h35v30h35v70z" fill="#4f6175" />
    </svg>
  ),
  waves: (
    <svg viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true">
      <rect width="400" height="300" fill="#d9e4ea" />
      {[0, 1, 2, 3, 4, 5].map((i) => <path key={i} d={`M0 ${80 + i * 40} C100 ${50 + i * 40} 200 ${110 + i * 40} 400 ${70 + i * 40} V300 H0z`} fill="#5d7f93" opacity={0.12 + i * 0.08} />)}
    </svg>
  ),
  grid: (
    <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="400" height="300" fill="#e7e9ee" />
      {Array.from({ length: 21 }, (_, i) => <line key={`v${i}`} x1={i * 20} y1="0" x2={i * 20} y2="300" stroke="#9aa3b5" strokeWidth="0.6" />)}
      {Array.from({ length: 16 }, (_, i) => <line key={`h${i}`} x1="0" y1={i * 20} x2="400" y2={i * 20} stroke="#9aa3b5" strokeWidth="0.6" />)}
      <path d="M0 240 L80 200 L140 215 L220 150 L290 165 L400 90" fill="none" stroke="#c8a75a" strokeWidth="3" />
    </svg>
  ),
  peaks: (
    <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <rect width="400" height="300" fill="#dfe3e6" />
      <path d="M0 300 L90 140 L150 210 L230 90 L310 200 L360 150 L400 190 V300z" fill="#8b98a2" />
      <path d="M230 90 L255 126 L240 120 L222 132 L210 118z M90 140 L108 172 L94 166 L80 176z" fill="#f4f5f6" />
      <path d="M0 300 L60 230 L130 270 L200 215 L280 265 L350 235 L400 260 V300z" fill="#5a6772" />
    </svg>
  ),
  dunes: (
    <svg viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true">
      <rect width="400" height="300" fill="#efe4d2" />
      <path d="M0 200 C120 140 220 230 400 160 V300 H0z" fill="#d9bf98" />
      <path d="M0 250 C140 200 260 280 400 220 V300 H0z" fill="#b8956a" />
    </svg>
  ),
};

/**
 * The designed cover page (V7): layout, band, approved image with overlay, logo and co-brand, business tag, the words,
 * prepared for/by, date, relationship manager card, classification and legal line. Labels follow the cover language.
 */
export default function CoverSheet({ cover, ctx, pageCount, className = "", onSelect, selected }) {
  const L = COVER_LABELS[cover.language] ?? COVER_LABELS.en;
  const fill = (t) => fillPlaceholders(t ?? "", ctx);
  const client = ctx?.["{Client}"] ?? "";
  const name = cover.salutation === "first-name" ? client.split(" ")[0] : client;
  const rm = ctx?.["{Relationship manager}"];
  const date = cover.dateMode === "period" ? `${L.period}: ${ctx?.["{Period}"] ?? ""}`
    : cover.dateMode === "asof" ? `${L.asOf} ${ctx?.["{As of date}"] ?? ""}` : cover.dateMode === "run" ? `${L.issued} ${ctx?.["{Run date}"] ?? ""}` : null;
  const style = {
    "--cover": themeColour(cover.theme),
    "--cover-title-font": FONTS[cover.titleFont] ?? FONTS.serif,
    "--cover-overlay": cover.overlay,
  };
  const classes = [
    "sheet", "cover-sheet", `cvl-${cover.layout}`, `cv-band-${cover.band}`, `cv-angle-${cover.bandAngle}`, `cv-pos-${cover.titlePosition}`,
    `cv-align-${cover.titleAlign}`, `cv-size-${cover.titleSize}`, `cv-weight-${cover.titleWeight}`, `cv-spacing-${cover.letterSpacing}`,
    `cv-eyebrow-${cover.eyebrowCase}`, `cv-print-${cover.printVariant}`, cover.image !== "none" ? "cv-has-image" : "", selected ? "selected" : "", className,
  ].join(" ");
  const logo = cover.logo !== "none" && (
    <div className={`cv-logo cv-logo-${cover.logoPosition} cv-logo-${cover.logoSize}`}>
      {cover.logo === "monogram" ? <span className="cv-monogram">I</span> : <span className="cv-wordmark">Investec</span>}
      {cover.coBrand && <span className="cv-cobrand">{L.with} {fill(cover.coBrand)}</span>}
    </div>
  );
  return (
    <article className={classes} style={style} onClick={onSelect ? (e) => { e.stopPropagation(); onSelect("cover"); } : undefined}>
      {cover.image !== "none" && <div className="cv-image">{COVER_IMAGES[cover.image]}<div className="cv-overlay" /></div>}
      {cover.band !== "none" && <div className="cv-band" />}
      {cover.businessTag && <div className="cv-tag">{cover.businessTag}</div>}
      {logo}
      <div className="cv-body">
        {cover.eyebrow && <p className="cv-eyebrow">{fill(cover.eyebrow)}</p>}
        <h1 className="cv-title">{fill(cover.title)}</h1>
        {cover.subtitle && <p className="cv-subtitle">{fill(cover.subtitle)}</p>}
        {cover.reportType && <span className="cv-type">{fill(cover.reportType)}</span>}
        {cover.headline && <p className="cv-headline">{fill(cover.headline)}</p>}
        {cover.note && <p className="cv-note">{fill(cover.note)}</p>}
        <div className="cv-meta">
          {cover.preparedFor && client && <p><span>{L.preparedFor}</span> {name}</p>}
          {cover.preparedBy && rm && <p><span>{L.preparedBy}</span> {rm}</p>}
          {date && <p><span>{date}</span></p>}
        </div>
        {cover.rmCard && rm && (
          <div className="cv-rm">
            <span className="cv-avatar">{rm.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
            <div><span className="cv-rm-label">{L.rm}</span><strong>{rm}</strong></div>
          </div>
        )}
      </div>
      <footer className="cv-foot">
        {cover.classification && <strong>{L[cover.classification] ?? cover.classification}</strong>}
        {cover.legalLine && <span>{LEGAL_LINE}</span>}
        {pageCount ? <span className="cv-pages">{pageCount} pages</span> : null}
      </footer>
    </article>
  );
}

/** The back cover: thank-you line, relationship manager, classification and legal line. */
export function BackCover({ cover, ctx }) {
  const L = COVER_LABELS[cover.language] ?? COVER_LABELS.en;
  const rm = ctx?.["{Relationship manager}"];
  return (
    <article className={`sheet cover-sheet cv-back cv-print-${cover.printVariant}`} style={{ "--cover": themeColour(cover.theme) }}>
      <div className="cv-back-body">
        <span className="cv-wordmark">Investec</span>
        <h2>{L.backTitle}</h2>
        <p>{L.backText}</p>
        {rm && <p className="cv-back-rm">{L.rm}: <strong>{rm}</strong></p>}
      </div>
      <footer className="cv-foot">
        {cover.classification && <strong>{L[cover.classification] ?? cover.classification}</strong>}
        {cover.legalLine && <span>{LEGAL_LINE}</span>}
      </footer>
    </article>
  );
}

/** A small cover for lists. */
export function CoverThumb({ cover, ctx }) {
  if (!cover) return <div className="cover-thumb empty" aria-hidden="true" />;
  return <div className="cover-thumb" aria-hidden="true"><CoverSheet cover={cover} ctx={ctx} /></div>;
}
