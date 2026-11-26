/** Inputs detected for a report: household, entity and account dropdowns and date pickers only (no free text). */
export default function InputsForm({ inputs, values, onChange, lookups, compact = false }) {
  const set = (name, value) => {
    const next = { ...values, [name]: value };
    // A different household clears the entity and account chosen for the previous one.
    if (name === "householdId") { next.clientId = null; next.portfolioCode = null; }
    onChange(next);
  };
  const options = (type) => (lookups[type] ?? []).filter((o) => type === "household" || !o.parent || o.parent === String(values.householdId ?? ""));
  return (
    <div className={compact ? "inputs-form compact" : "inputs-form"}>
      {inputs.map((input) => (
        <label key={input.name} className="field">
          <span>{input.label}</span>
          {["household", "client", "portfolio"].includes(input.type) ? (
            <select value={values[input.name] ?? ""} onChange={(e) => set(input.name, e.target.value || null)}>
              <option value="" disabled={!input.optional}>
                {input.optional ? (input.type === "client" ? "All entities" : "All accounts") : "Choose…"}
              </option>
              {options(input.type).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : (
            <input type="date" value={values[input.name] ?? ""} onChange={(e) => set(input.name, e.target.value)} />
          )}
        </label>
      ))}
      {inputs.length === 0 && <p className="muted">This report needs no inputs.</p>}
    </div>
  );
}
