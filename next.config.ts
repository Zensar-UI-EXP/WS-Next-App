import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mssql (tedious) and the Anthropic SDK run only on the server; keep them out of the bundler.
  serverExternalPackages: ["mssql", "tedious"],
  devIndicators: false,
};

export default nextConfig;
