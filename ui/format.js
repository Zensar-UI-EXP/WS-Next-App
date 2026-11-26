// Currency with thousand separators, percent with 2 decimals. Values arrive as decimals (0.0123 = 1.23%).

const currencyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compactCurrencyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** Chart colours: brand navy first, then a muted companion, gold, and supporting hues. */
export const palette = ["#2d2a5e", "#9d9ac0", "#b8892f", "#5f8fa8", "#7f6a93", "#c9b98f", "#3f6b5a", "#b5534a"];

/** Report accent colours the wealth manager can choose under Branding. */
export const ACCENTS = {
  navy: { label: "Investec navy", color: "#2d2a5e" },
  teal: { label: "Deep teal", color: "#1f5c5a" },
  burgundy: { label: "Burgundy", color: "#6b2335" },
  graphite: { label: "Graphite", color: "#2f3437" },
};

const isoDate = /^\d{4}-\d{2}-\d{2}/;

export function formatValue(value, format, { compact = false } = {}) {
  if (value === null || value === undefined || value === "") return "—";
  const number = typeof value === "number" ? value : Number(value);

  switch (format) {
    case "currency":
      if (Number.isNaN(number)) return String(value);
      return compact ? compactCurrencyFormat.format(number) : currencyFormat.format(number);
    case "percent":
      if (Number.isNaN(number)) return String(value);
      return `${(number * 100).toFixed(compact ? 1 : 2)}%`;
    case "index":
      return Number.isNaN(number) ? String(value) : number.toFixed(compact ? 0 : 1);
    case "ratio":
      return Number.isNaN(number) ? String(value) : number.toFixed(2);
    case "number":
      if (Number.isNaN(number)) return String(value);
      return numberFormat.format(number);
    case "date":
      return formatDate(value);
    case "month":
      return formatMonth(value);
    default:
      return String(value);
  }
}

export function formatDate(value, style = "short") {
  if (typeof value !== "string" || !isoDate.test(value)) return String(value ?? "");
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: style === "long" ? "long" : "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatMonth(value) {
  if (typeof value !== "string" || !isoDate.test(value)) return String(value ?? "");
  const [y, m] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** "$412.6m" style amount for headers and cards. */
export const formatMillions = (value) => compactCurrencyFormat.format(value ?? 0);

export const isNumericFormat = (format) => ["currency", "percent", "number", "index", "ratio"].includes(format);

/** ISO date one day before the given ISO date. */
export function dayBefore(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}
