/**
 * Validates that all required environment variables are present.
 * Called at module load time — throws immediately with a clear list if any are missing.
 */

const REQUIRED_SERVER_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GEMINI_API_KEY",
  "NEXT_PUBLIC_APP_URL",
  "SUPABASE_STORAGE_BUCKET",
] as const;

const missing = REQUIRED_SERVER_VARS.filter((key) => !process.env[key]);

if (missing.length > 0 && process.env.NODE_ENV === "production") {
  throw new Error(
    `Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join("\n")}\n\nAdd them to your Vercel project settings.`
  );
}

export const config = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  geminiApiKey: process.env.GEMINI_API_KEY!,
  appUrl: process.env.NEXT_PUBLIC_APP_URL!,
  storageBucket: process.env.SUPABASE_STORAGE_BUCKET!,
  isProduction: process.env.NODE_ENV === "production",
} as const;
