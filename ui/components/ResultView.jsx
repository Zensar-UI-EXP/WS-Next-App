import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatValue, isNumericFormat, palette } from "../format.js";

const axisTick = { fontSize: 10, fill: "#6b6f80", fontFamily: "JetBrains Mono, monospace" };
const tooltipStyle = { borderRadius: 6, fontSize: 12, border: "1px solid #dde1ea" };

/**
 * Draws a block result. Columns carry a role: dimension (labels / x-axis), series (period or series name)
 * and measure (values). Works for catalogue blocks and Custom (AI) blocks alike.
 */
export default function ResultView({ display, result, height = 260 }) {
  const rows = result?.rows ?? [];
  const columns = result?.columns ?? [];
  if (rows.length === 0) return <p className="no-data">No data for these inputs.</p>;

  if (display === "kpi") return <KpiCards columns={columns} rows={rows} />;
  if (display === "list") return <FigureList columns={columns} rows={rows} />;
  if (display === "table" || !["bar", "line", "pie"].includes(display)) return <DataTable columns={columns} rows={rows} />;
  return <Chart display={display} columns={columns} rows={rows} height={height} />;
}

function KpiCards({ columns, rows }) {
  const seriesCol = columns.find((c) => c.role === "series");
  const measures = columns.filter((c) => c.role === "measure");
  const main = rows[0];
  const previous = seriesCol ? rows[1] : null;
  return (
    <div className="kpi-grid">
      {measures.map((m) => {
        const value = main[m.name];
        return (
          <div className="kpi" key={m.name}>
            <span className="kpi-label">{m.label}</span>
            <span className={`kpi-value ${m.format === "percent" && Number(value) < 0 ? "negative" : ""}`}>
              {formatValue(value, m.format)}
            </span>
            {previous && (
              <span className="kpi-compare">
                {previous[seriesCol.name]}: {formatValue(previous[m.name], m.format)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FigureList({ columns, rows }) {
  const main = rows[0];
  return (
    <table className="figure-list">
      <tbody>
        {columns.filter((c) => c.role === "measure").map((m) => (
          <tr key={m.name}>
            <th scope="row">{m.label}</th>
            <td className={m.format === "percent" && Number(main[m.name]) < 0 ? "negative" : ""}>{formatValue(main[m.name], m.format)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DataTable({ columns, rows }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.name} className={isNumericFormat(c.format) ? "num" : ""}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.name} className={isNumericFormat(c.format) ? "num" : ""}>
                  {formatValue(row[c.name], c.format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Pivots rows into one record per x value with one key per (measure, series) line or bar. */
function pivot(columns, rows) {
  const x = columns.find((c) => c.role === "dimension") ?? columns[0];
  const seriesCol = columns.find((c) => c.role === "series");
  const measures = columns.filter((c) => c.role === "measure");
  const keys = [];
  const byX = new Map();
  for (const row of rows) {
    const xValue = row[x.name];
    if (!byX.has(xValue)) byX.set(xValue, { __x: xValue });
    for (const m of measures) {
      const s = seriesCol ? String(row[seriesCol.name] ?? "") : null;
      const key = s === null ? m.label : measures.length > 1 ? `${m.label} · ${s}` : s;
      if (!keys.includes(key)) keys.push(key);
      byX.get(xValue)[key] = row[m.name] === null ? null : Number(row[m.name]);
    }
  }
  return { x, keys, data: [...byX.values()], format: measures[0]?.format ?? "number" };
}

function Chart({ display, columns, rows, height }) {
  const { x, keys, data, format } = pivot(columns, rows);
  const xLabel = (v) => formatValue(v, x.format === "text" && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? "date" : x.format);
  const valueFormatter = (v) => formatValue(v, format);

  if (display === "pie") {
    const key = keys[0];
    const slices = data.map((d) => ({ name: xLabel(d.__x), value: d[key] }));
    return (
      <div className="chart-canvas" style={{ height }} role="img" aria-label={`Pie chart: ${slices.map((s) => `${s.name} ${valueFormatter(s.value)}`).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius="48%" outerRadius="70%" paddingAngle={2} stroke="none"
              isAnimationActive={false} label={({ value }) => valueFormatter(value)} labelLine={false}>
              {slices.map((s, i) => (
                <Cell key={s.name} fill={palette[i % palette.length]} />
              ))}
            </Pie>
            <Tooltip formatter={valueFormatter} contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const ChartType = display === "line" ? ComposedChart : BarChart;
  // Up to ~13 months read best as short month names ("Jan"); otherwise slant long or many labels.
  const shortMonths = x.format === "month" && data.length <= 14;
  const tickLabel = shortMonths
    ? (v) => new Date(`${String(v).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })
    : xLabel;
  const slanted = !shortMonths && (data.length > 6 || data.some((d) => String(xLabel(d.__x)).length > 12));
  return (
    <div className="chart-canvas" style={{ height: slanted ? height + 30 : height }} role="img" aria-label={`${display} chart of ${keys.join(", ")} by ${x.label}`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ChartType data={data} margin={{ top: 10, right: 28, left: 8, bottom: 5 }}>
          <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="#e6e8ef" />
          <XAxis dataKey="__x" tick={slanted ? { ...axisTick, angle: -30, textAnchor: "end" } : axisTick} tickFormatter={tickLabel}
            axisLine={false} tickLine={false} height={slanted ? 70 : 28} interval={shortMonths ? "preserveStartEnd" : 0} />
          <YAxis tick={axisTick} tickFormatter={(v) => formatValue(v, format, { compact: true })} axisLine={false} tickLine={false} width={56}
            domain={format === "index" ? ["dataMin - 2", "dataMax + 2"] : undefined} />
          <Tooltip formatter={valueFormatter} labelFormatter={xLabel} contentStyle={tooltipStyle} cursor={{ fill: "#f3f4f8" }} />
          {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {keys.map((key, i) =>
            display === "line" && i === 0 ? (
              <Area key={key} type="linear" dataKey={key} name={key} stroke={palette[0]} strokeWidth={2} fill={palette[0]} fillOpacity={0.07}
                dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
            ) : display === "line" ? (
              <Line key={key} type="linear" dataKey={key} name={key} stroke={palette[i % palette.length]} strokeWidth={1.5} strokeDasharray="4 3"
                dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
            ) : (
              <Bar key={key} dataKey={key} name={key} fill={palette[i % palette.length]} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
            ),
          )}
        </ChartType>
      </ResponsiveContainer>
    </div>
  );
}
