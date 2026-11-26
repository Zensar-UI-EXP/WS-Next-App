import ResultView from "./ResultView.jsx";
import { fillPlaceholders } from "../rules.js";

/**
 * The inside of one block as the reader sees it: header/body text with placeholders filled in, a disclaimer,
 * or the block's data. `state` is {loading, result, error} for data blocks; `ctx` holds the placeholder values.
 */
export default function BlockContent({ block, state, ctx, showTitle = true }) {
  if (block.type === "text") {
    const title = fillPlaceholders(block.title, ctx);
    const text = fillPlaceholders(block.text, ctx);
    return block.variant === "header" ? (
      <header className="report-header-block">
        <h2>{title}</h2>
        {text && <p>{text.split("\n").map((l) => l.charAt(0).toUpperCase() + l.slice(1)).join("\n")}</p>}
      </header>
    ) : (
      <div className="text-block">
        {title && <h3 className="block-title">{title}</h3>}
        <p>{text}</p>
      </div>
    );
  }
  if (block.type === "disclaimer") {
    return (
      <div className="disclaimer-block">
        {block.title && <h4>{fillPlaceholders(block.title, ctx)}</h4>}
        <p>{fillPlaceholders(block.text, ctx)}</p>
      </div>
    );
  }

  const result = state?.result;
  const issues = result?.issues ?? [];
  return (
    <div className="data-block">
      {showTitle && block.title && <h3 className="block-title">{fillPlaceholders(block.title, ctx)}</h3>}
      {state?.loading && !result ? (
        <p className="no-data">Loading figures…</p>
      ) : state?.error ? (
        <p className="block-error">{state.error}</p>
      ) : issues.length > 0 ? (
        <div className="block-incomplete">
          {issues.map((i) => (
            <p key={i}>{i}</p>
          ))}
        </div>
      ) : result?.error ? (
        <p className="block-error">This block could not load: {result.error}</p>
      ) : result ? (
        <div className={state?.loading ? "stale" : ""}>
          <ResultView display={block.display} result={result} height={block.width === "half" ? 200 : 230} />
        </div>
      ) : null}
    </div>
  );
}
