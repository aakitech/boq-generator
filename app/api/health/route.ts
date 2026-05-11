import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "error" | "unconfigured";

async function checkDatabase(): Promise<CheckStatus> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("boqs").select("id").limit(1);
    return error ? "error" : "ok";
  } catch {
    return "error";
  }
}

async function checkRedis(): Promise<CheckStatus> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return "unconfigured";
  try {
    const res = await fetch(`${url}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

function checkAI(): CheckStatus {
  return process.env.GEMINI_API_KEY ? "ok" : "unconfigured";
}

export async function GET() {
  const [db, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  const ai = checkAI();

  const checks = { db, redis, ai };
  const status = db === "ok" ? "ok" : "degraded";

  return NextResponse.json(
    { status, timestamp: new Date().toISOString(), checks },
    { status: db === "ok" ? 200 : 503 }
  );
}
