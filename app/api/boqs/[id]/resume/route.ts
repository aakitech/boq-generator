import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureProfileExists } from "@/lib/supabase/ensure-profile";
import { fillMissingRatesInExistingBOQ, type RateContext } from "@/lib/claude";
import { extractWorkbookBOQ } from "@/lib/excel";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";
export const maxDuration = 300;

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "boq-generator-dev";

function classifyError(message: string): { status: number; safeMessage: string } {
  const lower = message.toLowerCase();
  if (lower.includes("openai fallback is not configured") || lower.includes("openai_api_key")) {
    return {
      status: 503,
      safeMessage:
        "AI provider failover is not configured yet. Gemini was unavailable and the OpenAI fallback could not run. Please add the OpenAI API key or try resuming later.",
    };
  }
  if (lower.includes("429") || lower.includes("quota") || lower.includes("too many requests")) {
    return { status: 429, safeMessage: "AI rate limit reached. Please wait a minute and try again." };
  }
  if (
    (lower.includes("[openai error]: 400") || lower.includes("invalid schema") || lower.includes("response_format")) &&
    !lower.includes("budget 0 is invalid")
  ) {
    return {
      status: 503,
      safeMessage:
        "AI pricing hit a temporary provider response-format issue while retrying providers. Please try resuming this BOQ again now or in a minute.",
    };
  }
  if (
    lower.includes("400") &&
    (lower.includes("budget 0 is invalid") || lower.includes("thinking mode"))
  ) {
    return {
      status: 503,
      safeMessage:
        "AI pricing hit a temporary model configuration issue while retrying providers. Please try resuming this BOQ again now or in a minute.",
    };
  }
  if (
    (lower.includes("503") || lower.includes("service unavailable")) &&
    (lower.includes("high demand") || lower.includes("temporarily unavailable"))
  ) {
    return {
      status: 503,
      safeMessage:
        "AI pricing is temporarily under heavy demand. We already retried and attempted model failover. Please try resuming again in 1-2 minutes.",
    };
  }
  if (
    lower.includes("fetch failed") ||
    lower.includes("502") || lower.includes("bad gateway") ||
    lower.includes("503") || lower.includes("service unavailable") ||
    lower.includes("timeout") || lower.includes("etimedout") || lower.includes("econnreset") ||
    lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("network")
  ) {
    return {
      status: 503,
      safeMessage: "AI service is temporarily unavailable or the provider request could not be reached. Please try again in a moment.",
    };
  }
  return { status: 500, safeMessage: "Rate filling failed. Please try again." };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  await ensureProfileExists(serviceClient, user);

  const { data: boqRow, error: fetchError } = await serviceClient
    .from("boqs")
    .select("id, user_id, title, data, payment_status, processing_status, processing_context, source_excel_key, rate_col_header, amount_col_header")
    .eq("id", id)
    .single();

  if (fetchError || !boqRow) {
    return NextResponse.json({ error: "BOQ not found" }, { status: 404 });
  }

  if (boqRow.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (boqRow.payment_status !== "paid") {
    return NextResponse.json({ error: "This BOQ has not been paid for yet." }, { status: 402 });
  }

  if (boqRow.processing_status === "completed") {
    return NextResponse.json({ boq: boqRow.data, boq_id: boqRow.id, status: "completed" });
  }

  if (!boqRow.source_excel_key) {
    return NextResponse.json({ error: "This BOQ does not need a resume flow." }, { status: 409 });
  }

  const rateContext = (boqRow.processing_context ?? null) as RateContext | null;

  try {
    const { error: processingUpdateError } = await serviceClient
      .from("boqs")
      .update({
        processing_status: "processing",
        processing_started_at: new Date().toISOString(),
        processing_failed_at: null,
        last_error: null,
      })
      .eq("id", boqRow.id)
      .eq("user_id", user.id);

    if (processingUpdateError) {
      logger.error("Failed to mark BOQ as processing before resume", {
        boqId: boqRow.id,
        error: String(processingUpdateError),
        route: "boq-resume",
      });
    }

    const { data: fileData, error: downloadError } = await serviceClient.storage
      .from(STORAGE_BUCKET)
      .download(boqRow.source_excel_key);

    if (downloadError || !fileData) {
      logger.error("Resume storage download error", { boqId: boqRow.id, error: String(downloadError), route: "boq-resume" });
      return NextResponse.json(
        { error: "Could not retrieve your uploaded file. Please try again." },
        { status: 500 }
      );
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const workbookBoq = extractWorkbookBOQ(buffer, {
      rateColumnHeader: boqRow.rate_col_header ?? null,
      amountColumnHeader: boqRow.amount_col_header ?? null,
    });

    const boq = await fillMissingRatesInExistingBOQ(workbookBoq, rateContext ?? undefined);
    const title = boq.project || boqRow.title || "Rated BOQ";

    const { error: updateError } = await serviceClient
      .from("boqs")
      .update({
        title,
        data: boq,
        payment_status: "paid",
        processing_status: "completed",
        processing_failed_at: null,
        last_error: null,
      })
      .eq("id", boqRow.id)
      .eq("user_id", user.id);

    if (updateError) {
      logger.error("Failed to save resumed BOQ", { boqId: boqRow.id, error: String(updateError), route: "boq-resume" });
      return NextResponse.json({ error: "Could not save your resumed BOQ." }, { status: 500 });
    }

    trackEvent(user.id, "boq_resume_completed", { boqId: boqRow.id });
    return NextResponse.json({ boq, boq_id: boqRow.id, status: "completed" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("boq-resume error", { boqId: boqRow.id, error: message, route: "boq-resume" });

    await serviceClient
      .from("boqs")
      .update({
        processing_status: "failed",
        processing_failed_at: new Date().toISOString(),
        last_error: message,
      })
      .eq("id", boqRow.id)
      .eq("user_id", user.id);

    const classified = classifyError(message);
    return NextResponse.json({ error: classified.safeMessage }, { status: classified.status });
  }
}
