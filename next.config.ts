import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "pg", "mammoth"],
  experimental: {
    proxyClientMaxBodySize: "55mb",
  },
};

export default withSentryConfig(nextConfig, {
  org: "boq-generator",
  project: "boq-generator",
  // Tunnel Sentry requests through our own domain to bypass ad-blockers
  tunnelRoute: "/monitoring",
  // Suppress non-CI build output
  silent: !process.env.CI,
  // No source map upload — skipping SENTRY_AUTH_TOKEN requirement
  sourcemaps: { disable: true },
});
