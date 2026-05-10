import { fillMissingRatesInExistingBOQ, generateBOQ, validateSOW } from "@/lib/ai";
import type { GenerationInputDocument, GeminiUsageCollector, RateContext } from "@/lib/ai";
import { trackEvent } from "@/lib/analytics";
import { consumeWalletCredits } from "@/lib/credits";
import { extractWorkbookBOQ } from "@/lib/excel";
import { sendBoqReadyEmail } from "@/lib/email/boq-ready";
import { creditsForGeneratedBoq, MAX_GENERATION_CREDITS, summarizeAIUsage } from "@/lib/gemini-pricing";
import { logger } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/server";

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "boq-generator-dev";

export const shouldRunJobsInline =
  process.env.NODE_ENV !== "production" && process.env.BOQ_BACKGROUND_MODE !== "inngest";

async function markGenerationFailed(boqId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const db = createServiceClient();
  await db
    .from("boqs")
    .update({
      processing_status: "failed",
      processing_failed_at: new Date().toISOString(),
      last_error: message,
    })
    .eq("id", boqId);
}

async function markRatingFailed(boqId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const db = createServiceClient();
  await db
    .from("boqs")
    .update({
      processing_status: "failed",
      processing_failed_at: new Date().toISOString(),
      last_error: message,
    })
    .eq("id", boqId);
}

export async function processGenerateBOQJob(args: {
  boq_id: string;
  documents: GenerationInputDocument[];
  rate_context?: RateContext;
  user_id: string;
  user_email: string;
}) {
  const { boq_id, documents, rate_context, user_id, user_email } = args;

  try {
    const db = createServiceClient();
    await db
      .from("boqs")
      .update({
        processing_status: "processing",
        processing_started_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", boq_id);

    const usageCollector: GeminiUsageCollector = { entries: [] };
    const validationText = documents
      .map((d) => d.text.slice(0, 3000))
      .join("\n\n---\n\n");

    const validation = await validateSOW(validationText, {
      supportingDocsCount: documents.length - 1,
      usageCollector,
    });

    if (validation.should_block_generation) {
      throw new Error(validation.reason || "These documents can't be used to generate a BOQ.");
    }

    const truncated = documents.map((d) => ({
      ...d,
      text: d.text.length > 80000 ? d.text.slice(0, 80000) + "\n...[truncated]" : d.text,
    }));

    const boq = await generateBOQ(
      { documents: truncated },
      {
        suggestRates: true,
        rateContext: rate_context,
        documentClassification: validation,
        usageCollector,
      }
    );

    const usage = summarizeAIUsage(usageCollector.entries);
    const title = boq.project || "Untitled BOQ";
    const generationCredits = Math.max(
      creditsForGeneratedBoq(),
      Math.min(usage.creditsCharged, MAX_GENERATION_CREDITS)
    );

    const grandTotalZmw = (boq.bills ?? []).reduce((sum, bill) => {
      return sum + (bill.items ?? []).filter((i) => !i.is_header).reduce((s, i) => {
        const amt = i.amount ?? (i.qty != null && i.rate != null ? i.qty * i.rate : null);
        return s + (amt ?? 0);
      }, 0);
    }, 0);
    const itemCount = (boq.bills ?? [])
      .flatMap((b) => b.items ?? [])
      .filter((i) => !i.is_header).length;

    const { data: saved, error } = await db
      .from("boqs")
      .update({
        title,
        data: boq,
        processing_status: "completed",
        processing_failed_at: null,
        last_error: null,
        grand_total_zmw: grandTotalZmw,
        ai_input_tokens: usage.inputTokens,
        ai_output_tokens: usage.outputTokens,
        ai_total_tokens: usage.totalTokens,
        ai_cost_usd: usage.costUsd,
        ai_credits_charged: generationCredits,
        ai_usage_breakdown: usage.entries,
      })
      .eq("id", boq_id)
      .select("id")
      .single();

    if (error || !saved) {
      logger.error("generate-boq job: failed to save result", { boq_id, error: String(error) });
      throw new Error("Failed to save generated BOQ");
    }

    await consumeWalletCredits(db, {
      userId: user_id,
      reason: "generate_boq",
      referenceType: "boq",
      referenceId: boq_id,
      credits: generationCredits,
      deltaUsd: usage.costUsd,
    });

    trackEvent(user_id, "boq_generated_async", {
      boqId: saved.id,
      title,
      itemCount,
      grandTotalZmw,
      aiCostUsd: usage.costUsd,
      creditsCharged: generationCredits,
    });

    if (user_email) {
      try {
        await sendBoqReadyEmail({ email: user_email, boqId: saved.id, title });
      } catch (err) {
        logger.warn("generate-boq job: completion email failed", {
          boq_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { boq_id: saved.id };
  } catch (err) {
    logger.error("generate-boq job failed", {
      boq_id,
      error: err instanceof Error ? err.message : String(err),
    });
    await markGenerationFailed(boq_id, err);
    throw err;
  }
}

export async function processRateBOQJob(args: {
  boq_id: string;
  user_id: string;
  user_email: string;
  storage_key: string;
  rate_col_header: string;
  amount_col_header: string;
  rate_context?: RateContext;
}) {
  const { boq_id, user_id, user_email, storage_key, rate_col_header, amount_col_header, rate_context } = args;

  try {
    const db = createServiceClient();
    await db
      .from("boqs")
      .update({
        processing_status: "processing",
        processing_started_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", boq_id);

    const { data: fileData, error: downloadError } = await db.storage
      .from(STORAGE_BUCKET)
      .download(storage_key);

    if (downloadError || !fileData) {
      const isGone = String(downloadError).includes("Object not found") || String(downloadError).includes("404");
      throw new Error(
        isGone
          ? `Source Excel file no longer exists in storage (key: ${storage_key}). Re-upload the file from the UI to retry.`
          : `Storage download failed: ${String(downloadError)}`
      );
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const workbookBoq = await extractWorkbookBOQ(buffer, {
      rateColumnHeader: rate_col_header || null,
      amountColumnHeader: amount_col_header || null,
    });

    const usageCollector: GeminiUsageCollector = { entries: [] };
    const boq = await fillMissingRatesInExistingBOQ(workbookBoq, rate_context, usageCollector);
    const usage = summarizeAIUsage(usageCollector.entries);
    const title = boq.project || "Rated BOQ";
    const itemCount = boq.bills?.flatMap((b) => b.items).filter((i) => !i.is_header).length ?? 0;
    const ratingCredits = Math.max(500, Math.min(usage.creditsCharged, MAX_GENERATION_CREDITS));

    const { error } = await db
      .from("boqs")
      .update({
        title,
        data: boq,
        processing_status: "completed",
        processing_failed_at: null,
        last_error: null,
        ai_input_tokens: usage.inputTokens,
        ai_output_tokens: usage.outputTokens,
        ai_total_tokens: usage.totalTokens,
        ai_cost_usd: usage.costUsd,
        ai_credits_charged: ratingCredits,
        ai_usage_breakdown: usage.entries,
      })
      .eq("id", boq_id);

    if (error) {
      logger.error("rate-boq job: failed to save result", { boq_id, error: String(error) });
      throw new Error("Failed to save rated BOQ");
    }

    await consumeWalletCredits(db, {
      userId: user_id,
      reason: "rate_boq",
      referenceType: "boq",
      referenceId: boq_id,
      credits: ratingCredits,
      deltaUsd: usage.costUsd,
    });

    trackEvent(user_id, "boq_rated_async", {
      boqId: boq_id,
      itemCount,
      storageKey: storage_key,
      aiCostUsd: usage.costUsd,
      creditsCharged: usage.creditsCharged,
    });

    if (user_email) {
      try {
        await sendBoqReadyEmail({ email: user_email, boqId: boq_id, title });
      } catch (err) {
        logger.warn("rate-boq job: completion email failed", {
          boq_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { boq_id };
  } catch (err) {
    logger.error("rate-boq job failed", {
      boq_id,
      error: err instanceof Error ? err.message : String(err),
    });
    await markRatingFailed(boq_id, err);
    throw err;
  }
}
