import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { scoreBOQ } from "@/lib/ai";
import { computeDeterministicQA } from "@/lib/boq-qa";
import type { BOQDocument } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const dbClient = hasServiceRole ? createServiceClient() : supabase;

    const { data: row, error } = await dbClient
      .from("boqs")
      .select("id, data")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (error || !row) return NextResponse.json({ error: "BOQ not found" }, { status: 404 });

    const boqData = row.data as BOQDocument;

    // Return cached score if it already exists and is in the newer format.
    if (boqData.qa?.updated_at) {
      return NextResponse.json({ qa: boqData.qa });
    }

    // Score the BOQ
    let qa = computeDeterministicQA(boqData);
    try {
      qa = await scoreBOQ(boqData);
    } catch (error) {
      logger.warn("QA route falling back to deterministic score", { error: String(error), route: "qa" });
    }

    // Persist the score back into the data JSON
    const updatedData = { ...boqData, qa };
    await dbClient
      .from("boqs")
      .update({ data: updatedData })
      .eq("id", id);

    return NextResponse.json({ qa });
  } catch (err) {
    logger.error("QA scoring error", { error: err instanceof Error ? err.message : String(err), route: "qa" });
    return NextResponse.json({ error: "Scoring failed" }, { status: 500 });
  }
}
