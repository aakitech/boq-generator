import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: boqId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServiceClient();

  // Only expire if still in processing state and started 25+ minutes ago
  const STUCK_MS = 25 * 60 * 1000;
  const cutoff = new Date(Date.now() - STUCK_MS).toISOString();

  const { error } = await db
    .from("boqs")
    .update({
      processing_status: "failed",
      processing_failed_at: new Date().toISOString(),
      last_error: "Generation timed out. Click Retry to try again.",
    })
    .eq("id", boqId)
    .eq("user_id", user.id)
    .in("processing_status", ["pending", "processing"])
    .lt("processing_started_at", cutoff);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
