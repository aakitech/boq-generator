import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureProfileExists } from "@/lib/supabase/ensure-profile";
import { getStripe } from "@/lib/stripe";
import { fillMissingRatesInExistingBOQ, RateContext } from "@/lib/ai";
import { extractWorkbookBOQ } from "@/lib/excel";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";
import type { PostgrestError } from "@supabase/supabase-js";
import { consumeWalletCredits } from "@/lib/credits";
import { summarizeAIUsage } from "@/lib/gemini-pricing";
import type { GeminiUsageCollector } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 300;

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "boq-generator-dev";

function isMissingColumnError(error: PostgrestError | null, columns: string[]): boolean {
  if (!error) return false;
  const haystack = [error.message, error.details, error.hint, error.code].filter(Boolean).join(" ").toLowerCase();
  return columns.some((column) => haystack.includes(column.toLowerCase()));
}

function isDuplicateStripeSessionError(error: PostgrestError | null): boolean {
  if (!error) return false;
  const haystack = [error.message, error.details, error.hint, error.code].filter(Boolean).join(" ").toLowerCase();
  return (
    error.code === "23505" &&
    (haystack.includes("stripe_session_id") || haystack.includes("boqs_stripe_session_id_key"))
  );
}

function classifyError(message: string): { status: number; safeMessage: string } {
  const lower = message.toLowerCase();
  if (lower.includes("openai fallback is not configured") || lower.includes("openai_api_key")) {
    return {
      status: 503,
      safeMessage:
        "AI provider failover is not configured yet. Gemini was unavailable and the OpenAI fallback could not run. Please add the OpenAI API key or try again later.",
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
        "AI pricing hit a temporary provider response-format issue while retrying providers. Please try again now or resume this BOQ from the dashboard.",
    };
  }
  if (
    lower.includes("400") &&
    (lower.includes("budget 0 is invalid") || lower.includes("thinking mode"))
  ) {
    return {
      status: 503,
      safeMessage:
        "AI pricing hit a temporary model configuration issue while retrying providers. Please try again now or resume this BOQ from the dashboard.",
    };
  }
  if (
    (lower.includes("503") || lower.includes("service unavailable")) &&
    (lower.includes("high demand") || lower.includes("temporarily unavailable"))
  ) {
    return {
      status: 503,
      safeMessage:
        "AI pricing is temporarily under heavy demand. We already retried and attempted model failover. Please try again in 1-2 minutes.",
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

export async function POST(req: NextRequest) {
  let failureBoqId: string | null = null;
  let failureUserId: string | null = null;
  let failureClient: ReturnType<typeof createServiceClient> | null = null;
  try {
    const { session_id, boq_id, use_credit, rate_context } = (await req.json()) as {
      session_id?: string;
      boq_id?: string;
      use_credit?: boolean;
      rate_context?: RateContext;
    };

    if (!session_id && !use_credit) {
      return NextResponse.json({ error: "Payment required" }, { status: 402 });
    }

    // Auth check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = createServiceClient();
    failureClient = serviceClient;
    failureUserId = user.id;
    await ensureProfileExists(serviceClient, user);

    let stripeSessionId: string | null = null;
    let storageKey: string | null = null;
    let rateColHeader = "";
    let amountColHeader = "";
    let boqId = boq_id ?? null;
    let effectiveRateContext: RateContext | undefined = rate_context;

    if (use_credit) {
      if (!boqId) {
        return NextResponse.json({ error: "boq_id is required for credit unlock" }, { status: 400 });
      }

      const { data: previewBoq, error: previewError } = await serviceClient
        .from("boqs")
        .select("id, data, payment_status, processing_status, processing_context, user_id, source_excel_key, rate_col_header, amount_col_header")
        .eq("id", boqId)
        .single();

      if (previewError || !previewBoq) {
        return NextResponse.json({ error: "BOQ not found" }, { status: 404 });
      }

      if (previewBoq.user_id !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      if (previewBoq.payment_status === "paid" && previewBoq.processing_status === "completed") {
        return NextResponse.json({ boq: previewBoq.data, boq_id: previewBoq.id });
      }

      storageKey = previewBoq.source_excel_key;
      rateColHeader = previewBoq.rate_col_header ?? "";
      amountColHeader = previewBoq.amount_col_header ?? "";
      effectiveRateContext = rate_context ?? ((previewBoq.processing_context ?? undefined) as RateContext | undefined);
      failureBoqId = boqId;
    } else {
      // Verify Stripe payment
      const stripeSession = await getStripe().checkout.sessions.retrieve(session_id!);
      if (stripeSession.payment_status !== "paid") {
        return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
      }

      stripeSessionId = stripeSession.id;
      const metadata = stripeSession.metadata ?? {};
      if (metadata.type !== "rate_boq") {
        return NextResponse.json({ error: "Invalid session type" }, { status: 400 });
      }

      storageKey = metadata.storage_key;
      rateColHeader = metadata.rate_col_header ?? "";
      amountColHeader = metadata.amount_col_header ?? "";
      boqId = metadata.boq_id ?? null;
      failureBoqId = boqId;

      if (!storageKey) {
        return NextResponse.json({ error: "Missing storage key in payment session" }, { status: 400 });
      }

      if (boqId && !rate_context) {
        const { data: storedBoq } = await serviceClient
          .from("boqs")
          .select("processing_context")
          .eq("id", boqId)
          .eq("user_id", user.id)
          .maybeSingle();

        effectiveRateContext = (storedBoq?.processing_context ?? undefined) as RateContext | undefined;
      }
    }

    // Idempotency: if this Stripe session already produced a paid BOQ, return it
    if (stripeSessionId) {
      const { data: existingBoq } = await serviceClient
        .from("boqs")
        .select("id, data, processing_status")
        .eq("stripe_session_id", stripeSessionId)
        .maybeSingle();

      if (existingBoq?.processing_status === "completed") {
        return NextResponse.json({ boq: existingBoq.data, boq_id: existingBoq.id });
      }
    }

    if (boqId) {
      const { error: processingUpdateError } = await serviceClient
        .from("boqs")
        .update({
          processing_status: "processing",
          processing_started_at: new Date().toISOString(),
          processing_failed_at: null,
          last_error: null,
          processing_context: effectiveRateContext ?? null,
        })
        .eq("id", boqId)
        .eq("user_id", user.id);

      if (processingUpdateError) {
        logger.error("Failed to mark BOQ as processing before rate fill", {
          boqId,
          error: String(processingUpdateError),
          route: "rate-boq",
        });
      }
    }

    // Download original Excel from Storage
    const { data: fileData, error: downloadError } = await serviceClient.storage
      .from(STORAGE_BUCKET)
      .download(storageKey!);

    if (downloadError || !fileData) {
      logger.error("Storage download error", { error: String(downloadError), route: "rate-boq" });
      return NextResponse.json(
        { error: "Could not retrieve your uploaded file. Please try again." },
        { status: 500 }
      );
    }

    // Parse the original workbook deterministically, then fill only missing rates.
    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const workbookBoq = await extractWorkbookBOQ(buffer, {
      rateColumnHeader: rateColHeader || null,
      amountColumnHeader: amountColHeader || null,
    });
    const usageCollector: GeminiUsageCollector = { entries: [] };
    const boq = await fillMissingRatesInExistingBOQ(workbookBoq, effectiveRateContext, usageCollector);
    const usageSummary = summarizeAIUsage(usageCollector.entries);

    const title = boq.project || "Rated BOQ";
    const itemCount = boq.bills?.flatMap((b) => b.items).filter((i) => !i.is_header).length ?? 0;

    let savedId: string;

    if (boqId) {
      let remainingCredits: number | null = null;
      if (use_credit) {
        const creditResult = await consumeWalletCredits(serviceClient, {
          userId: user.id,
          reason: "rate_boq",
          referenceType: "boq",
          referenceId: boqId,
          credits: Math.max(usageSummary.creditsCharged, 1),
          deltaUsd: usageSummary.costUsd,
          metadata: {
            ai_cost_usd: usageSummary.costUsd,
            ai_input_tokens: usageSummary.inputTokens,
            ai_output_tokens: usageSummary.outputTokens,
            ai_total_tokens: usageSummary.totalTokens,
          },
        });

        if (creditResult.status === "insufficient") {
          return NextResponse.json(
            { error: "No credits remaining", remainingCredits: 0 },
            { status: 402 }
          );
        }

        remainingCredits = creditResult.remainingCredits;
        trackEvent(user.id, "credit_consumed", {
          reason: "rate_boq",
          boqId,
          remainingCredits,
          creditsCharged: usageSummary.creditsCharged,
          aiCostUsd: usageSummary.costUsd,
        });
      }

      // New flow: UPDATE the preview BOQ row created by ingest-boq
      const { data: updated, error: updateError } = await serviceClient
        .from("boqs")
        .update({
          title,
          data: boq,
          stripe_session_id: stripeSessionId,
          source_excel_key: storageKey,
          payment_status: "paid",
          payment_source: use_credit ? null : "stripe",
          processing_status: "completed",
          processing_failed_at: null,
          last_error: null,
          processing_context: effectiveRateContext ?? null,
          rate_col_header: rateColHeader || null,
          amount_col_header: amountColHeader || null,
          ai_input_tokens: usageSummary.inputTokens,
          ai_output_tokens: usageSummary.outputTokens,
          ai_total_tokens: usageSummary.totalTokens,
          ai_cost_usd: usageSummary.costUsd,
          ai_credits_charged: usageSummary.creditsCharged,
          ai_usage_breakdown: usageSummary.entries,
        })
        .eq("id", boqId)
        .eq("user_id", user.id)
        .select("id")
        .single();

      if (updateError || !updated) {
        logger.error("Failed to update preview BOQ with rates", { error: String(updateError), boqId, route: "rate-boq" });
        return NextResponse.json({ boq, boq_id: null });
      }
      savedId = updated.id;

      trackEvent(user.id, "boq_rated", {
        boqId: savedId,
        itemCount,
        storageKey,
        unlockType: use_credit ? "credit" : "stripe",
        aiCostUsd: usageSummary.costUsd,
        creditsCharged: usageSummary.creditsCharged,
      });

      return NextResponse.json({
        boq,
        boq_id: savedId,
        remainingCredits,
      });
    } else {
      // Legacy flow: INSERT a new BOQ row (no boq_id in metadata)
      let { data: saved, error: dbError } = await serviceClient
        .from("boqs")
        .insert({
          user_id: user.id,
          title,
          data: boq,
          stripe_session_id: stripeSessionId,
          source_excel_key: storageKey,
          rate_col_header: rateColHeader || null,
          amount_col_header: amountColHeader || null,
          payment_status: "paid",
          payment_source: stripeSessionId ? "stripe" : null,
          processing_status: "completed",
          processing_context: effectiveRateContext ?? null,
          ai_input_tokens: usageSummary.inputTokens,
          ai_output_tokens: usageSummary.outputTokens,
          ai_total_tokens: usageSummary.totalTokens,
          ai_cost_usd: usageSummary.costUsd,
          ai_credits_charged: usageSummary.creditsCharged,
          ai_usage_breakdown: usageSummary.entries,
        })
        .select("id")
        .single();

      if (isMissingColumnError(dbError, ["source_excel_key", "rate_col_header", "amount_col_header"])) {
        logger.warn("Rate BOQ metadata columns missing; retrying save without Excel metadata", {
          code: dbError?.code,
          message: dbError?.message,
          details: dbError?.details,
          hint: dbError?.hint,
          route: "rate-boq",
        });

        ({ data: saved, error: dbError } = await serviceClient
          .from("boqs")
          .insert({
            user_id: user.id,
            title,
            data: boq,
            stripe_session_id: stripeSessionId,
            payment_status: "paid",
            payment_source: stripeSessionId ? "stripe" : null,
            processing_status: "completed",
            processing_context: effectiveRateContext ?? null,
            ai_input_tokens: usageSummary.inputTokens,
            ai_output_tokens: usageSummary.outputTokens,
            ai_total_tokens: usageSummary.totalTokens,
            ai_cost_usd: usageSummary.costUsd,
            ai_credits_charged: usageSummary.creditsCharged,
            ai_usage_breakdown: usageSummary.entries,
          })
          .select("id")
          .single());
      }

      if (dbError) {
        if (isDuplicateStripeSessionError(dbError)) {
        logger.warn("Duplicate rate-boq save detected; loading existing row", {
          code: dbError.code,
          message: dbError.message,
          details: dbError.details,
          route: "rate-boq",
        });

          const { data: concurrentBoq } = await serviceClient
            .from("boqs")
            .select("id, data")
            .eq("stripe_session_id", stripeSessionId!)
            .maybeSingle();

          if (concurrentBoq?.id) {
            return NextResponse.json({ boq: concurrentBoq.data, boq_id: concurrentBoq.id });
          }
        }

        logger.error("Failed to save rated BOQ", {
          error: String(dbError),
          code: dbError.code,
          message: dbError.message,
          details: dbError.details,
          hint: dbError.hint,
          route: "rate-boq",
        });
        return NextResponse.json({ boq, boq_id: null });
      }

      if (!saved?.id) {
        logger.error("Rated BOQ save returned no row id", { route: "rate-boq" });
        return NextResponse.json({ boq, boq_id: null });
      }

      savedId = saved.id;
    }

    // Record payment
    if (stripeSessionId) {
      const stripeSession = await getStripe().checkout.sessions.retrieve(stripeSessionId);
      await serviceClient.from("payments").upsert(
        {
          stripe_session_id: stripeSessionId,
          stripe_payment_intent: stripeSession.payment_intent as string | null,
          user_id: user.id,
          amount_cents: stripeSession.amount_total ?? 2000,
          currency: stripeSession.currency ?? "usd",
          status: "completed",
          boq_id: savedId,
        },
        { onConflict: "stripe_session_id", ignoreDuplicates: false }
      );
    }

    trackEvent(user.id, "boq_rated", {
      boqId: savedId,
      itemCount,
      storageKey,
      unlockType: stripeSessionId ? "stripe" : "credit",
      aiCostUsd: usageSummary.costUsd,
      creditsCharged: usageSummary.creditsCharged,
    });
    return NextResponse.json({ boq, boq_id: savedId });
  } catch (err) {
    logger.error("rate-boq error", { error: err instanceof Error ? err.message : String(err), route: "rate-boq" });
    const message = err instanceof Error ? err.message : "Unknown error";
    if (failureClient && failureBoqId && failureUserId) {
      const { error: failureUpdateError } = await failureClient
        .from("boqs")
        .update({
          processing_status: "failed",
          processing_failed_at: new Date().toISOString(),
          last_error: message,
        })
        .eq("id", failureBoqId)
        .eq("user_id", failureUserId);

      if (failureUpdateError) {
        logger.error("Failed to persist BOQ failure status", {
          boqId: failureBoqId,
          error: String(failureUpdateError),
          route: "rate-boq",
        });
      }
    }
    const classified = classifyError(message);
    return NextResponse.json({ error: classified.safeMessage }, { status: classified.status });
  }
}
