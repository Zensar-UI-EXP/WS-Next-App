// Server-side settings from environment variables (.env.local in development).
const num = (name: string, fallback: number) => (process.env[name] ? Number(process.env[name]) : fallback);

export const config = {
  db: {
    server: process.env.DB_SERVER ?? "localhost",
    port: num("DB_PORT", 1433),
    database: process.env.DB_NAME ?? "WealthInsightsV10Db",
    reader: { user: process.env.DB_READER_USER ?? "wis10_reader", password: process.env.DB_READER_PASSWORD ?? "" },
    app: { user: process.env.DB_APP_USER ?? "wis10_app", password: process.env.DB_APP_PASSWORD ?? "" },
  },
  ai: {
    provider: process.env.AI_PROVIDER ?? "Anthropic",
    model: process.env.AI_MODEL || "claude-opus-5-5",
    fallbackModel: process.env.AI_FALLBACK_MODEL || "claude-opus-4-8",
    effort: (process.env.AI_EFFORT || "medium") as "low" | "medium" | "high" | "xhigh" | "max",
    // V9 cover agent: the plan (one call when the Cover tab opens) and the quick decision after a choice the plan does not cover.
    planEffort: (process.env.AI_PLAN_EFFORT || "low") as "low" | "medium" | "high",
    fastModel: process.env.AI_FAST_MODEL || "claude-haiku-5-5",
    fastEffort: (process.env.AI_FAST_EFFORT || "low") as "low" | "medium" | "high",
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    baseUrl: process.env.AI_ENDPOINT || undefined,
  },
  query: {
    maxRows: num("QUERY_MAX_ROWS", 500),
    timeoutSeconds: num("QUERY_TIMEOUT_SECONDS", 30),
    maxParallelBlocks: num("QUERY_MAX_PARALLEL_BLOCKS", 4),
  },
};
