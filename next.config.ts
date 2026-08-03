import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // better-sqlite3 ships a native (.node) binding located relative to its own
  // package directory via __dirname. Bundling it into the server output (the
  // Vite/vinext default) breaks that lookup, so it must stay an external,
  // real `require()`'d dependency at runtime instead.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
