import InputsForm from "../components/InputsForm.jsx";

/** Report inputs (detected automatically), the sample inputs for the page, and the submit checklist. */
export default function InputsPanel({ inputs, preview, onPreviewChange, lookups, checks, readOnly }) {
  return (
    <section>
      <h3 className="insp-label">Report inputs (detected automatically)</h3>
      <div>
        <p className="small">Wealth managers will choose:</p>
        <div className="box inputs-detected">
          {inputs.length === 0 ? <span className="muted">Nothing yet — add a data block.</span> : inputs.map((i) => <span key={i.name}>✓ {i.label}</span>)}
        </div>

        <p className="sub-label">Preview with</p>
        <fieldset disabled={readOnly} className="plain">
          <InputsForm inputs={inputs} values={preview} onChange={onPreviewChange} lookups={lookups} compact />
        </fieldset>

        {checks && (
          <div className={`box readiness ${checks.every((c) => c.ok) ? "ready" : ""}`}>
            <strong>Ready to submit?</strong>
            {checks.map((c) => (
              <span key={c.label} className={c.ok ? "ok" : "todo"}>
                {c.ok ? "✓" : "○"} {c.label}
              </span>
            ))}
          </div>
        )}
        <p className="panel-note">Compliance approves the template before wealth managers can use it.</p>
      </div>
    </section>
  );
}
