import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  sendDefaultPii: true,
  // Sample Inngest jobs at 100% (low volume, high value); everything else at 10% in prod
  tracesSampler: ({ name }) => {
    if (name?.includes("inngest")) return 1.0;
    return process.env.NODE_ENV === "development" ? 1.0 : 0.1;
  },
  includeLocalVariables: true,
  enableLogs: true,
});
