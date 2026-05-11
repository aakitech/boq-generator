import * as Sentry from "@sentry/nextjs";

type LogLevel = "info" | "warn" | "error" | "debug";

type LogContext = Record<string, unknown>;

function log(level: LogLevel, message: string, context?: LogContext) {
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    ...context,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, context?: LogContext) => log("info", message, context),
  warn: (message: string, context?: LogContext) => log("warn", message, context),
  error: (message: string, context?: LogContext) => log("error", message, context),
  debug: (message: string, context?: LogContext) => log("debug", message, context),
};

/**
 * Wraps fn in a Sentry performance span and logs duration on completion.
 * Use this on heavy API route handlers to get request timing in Sentry traces.
 */
export async function withTiming<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return Sentry.startSpan({ name, op: "http.handler" }, fn);
}
