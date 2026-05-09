import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureProfileExists } from "@/lib/supabase/ensure-profile";
import type { RateContext } from "@/lib/ai";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";
import { getRemainingCredits } from "@/lib/credits";
import { inngest } from "@/lib/inngest";

export const runtime = "nodejs";
export const maxDuration = 60;

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "boq-generator-dev";

export async function POST(req: NextRequest) {
  try {
    const { boq_id, rate_context } = (await req.json()) as {
      boq_id: string;
      rate_context?: RateContext;
    };

    if (!boq_id) {
      return NextResponse.json({ error: "boq_id is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = createServiceClient();
    await ensureProfileExists(serviceClient, user);

    // Fetch the BOQ to get storage key and column headers
    const { data: boq, error: boqError } = await serviceClient
      .from("boqs")
      .select("id, user_id, payment_status, processing_status, source_excel_key, rate_col_header, amount_col_header, processing_context")
      .eq("id", boq_id)
      .single();

    if (boqError || !boq) {
      return NextResponse.json({ error: "BOQ not found" }, { status: 404 });
    }

    if (boq.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!boq.source_excel_key) {
      return NextResponse.json({ error: "No Excel file associated with this BOQ" }, { status: 400 });
    }

    // Idempotency: already completed
    if (boq.processing_status === "completed") {
      return NextResponse.json({ boq_id: boq.id, processing_status: "completed" });
    }

    // Idempotency: actively running (pending from ingest-upload should still be allowed through)
    if (boq.processing_status === "processing") {
      return NextResponse.json({ boq_id: boq.id, processing_status: boq.processing_status });
    }

    // Credit pre-check
    const remainingCredits = await getRemainingCredits(serviceClient, user.id);
    if (remainingCredits < 500) {
      return NextResponse.json(
        { error: "insufficient_credits", remainingCredits },
        { status: 402 }
      );
    }

    const effectiveRateContext: RateContext | undefined =
      rate_context ?? ((boq.processing_context ?? undefined) as RateContext | undefined);

    // Mark as pending and enqueue
    await serviceClient
      .from("boqs")
      .update({
        payment_status: "paid",
        processing_status: "pending",
        processing_started_at: null,
        processing_failed_at: null,
        last_error: null,
        processing_context: effectiveRateContext ?? null,
      })
      .eq("id", boq_id)
      .eq("user_id", user.id);

    await inngest.send({
      name: "boq/rate.requested",
      data: {
        boq_id,
        user_id: user.id,
        user_email: user.email ?? "",
        storage_key: boq.source_excel_key,
        rate_col_header: boq.rate_col_header ?? "",
        amount_col_header: boq.amount_col_header ?? "",
        rate_context: effectiveRateContext,
      },
    });

    trackEvent(user.id, "boq_rate_enqueued", { boqId: boq_id });

    return NextResponse.json({ boq_id, processing_status: "pending" });
  } catch (err) {
    logger.error("rate-boq enqueue error", {
      error: err instanceof Error ? err.message : String(err),
      route: "rate-boq",
    });
    return NextResponse.json({ error: "Failed to start rating. Please try again." }, { status: 500 });
  }
}
