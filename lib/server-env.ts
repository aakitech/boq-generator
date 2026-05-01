import { existsSync, readFileSync } from "fs";
import path from "path";

let cachedLocalEnv: Map<string, string> | null = null;

function stripWrappingQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseEnvFile(filePath: string) {
  const values = new Map<string, string>();
  const raw = readFileSync(filePath, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(trimmed.slice(separatorIndex + 1).trim());
    values.set(key, value);
  }

  return values;
}

function getLocalEnvFileValues() {
  if (cachedLocalEnv) return cachedLocalEnv;

  const envPath = path.join(process.cwd(), ".env.local");
  cachedLocalEnv = existsSync(envPath) ? parseEnvFile(envPath) : new Map<string, string>();
  return cachedLocalEnv;
}

export function getServerEnv(name: string): string | null {
  if (process.env.NODE_ENV !== "production") {
    const localValue = getLocalEnvFileValues().get(name)?.trim();
    if (localValue) return localValue;
  }

  const envValue = process.env[name]?.trim();
  return envValue || null;
}
