import { inngest } from "@/lib/inngest";
import { createServiceClient } from "@/lib/supabase/server";
import { fillMissingRatesInExistingBOQ } from "@/lib/ai";
import type { RateContext, GeminiUsageCollector } from "@/lib/ai";
import { extractWorkbookBOQ } from "@/lib/excel";
import { summarizeAIUsage, MAX_GENERATION_CREDITS } from "@/lib/gemini-pricing";
import { trackEvent } from "@/lib/analytics";
import { logger } from "@/lib/logger";
import { sendBoqReadyEmail } from "@/lib/email/boq-ready";

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "boq-generator-dev";

export const rateBOQJob = inngest.createFunction(
  { id: "rate-boq", retries: 2, timeouts: { finish: "10m" }, triggers: [{ event: "boq/rate.requested" }] },
  async ({ event, step }) => {
    const { boq_id, user_id, user_email, storage_key, rate_col_header, amount_col_header, rate_context } =
      event.data as {
        boq_id: string;
        user_id: string;
        user_email: string;
        storage_key: string;
        rate_col_header: string;
        amount_col_header: string;
        rate_context?: RateContext;
      };

    await step.run("mark-processing", async () => {
      const db = createServiceClient();
      await db
        .from("boqs")
        .update({
          processing_status: "processing",
          processing_started_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", boq_id);
    });

    const result = await step.run("fill-rates", async () => {
      const db = createServiceClient();

      const { data: fileData, error: downloadError } = await db.storage
        .from(STORAGE_BUCKET)
        .download(storage_key);

      if (downloadError || !fileData) {
        throw new Error(`Storage download failed: ${String(downloadError)}`);
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      const workbookBoq = await extractWorkbookBOQ(buffer, {
        rateColumnHeader: rate_col_header || null,
        amountColumnHeader: amount_col_header || null,
      });

      const usageCollector: GeminiUsageCollector = { entries: [] };
      const boq = await fillMissingRatesInExistingBOQ(workbookBoq, rate_context, usageCollector);

      return { boq, usage: usageCollector.entries };
    });

    await step.run("save-result", async () => {
      const db = createServiceClient();
      const usage = summarizeAIUsage(result.usage);
      const title = result.boq.project || "Rated BOQ";
      const itemCount = result.boq.bills?.flatMap((b) => b.items).filter((i) => !i.is_header).length ?? 0;

      const { error } = await db
        .from("boqs")
        .update({
          title,
          data: result.boq,
          processing_status: "completed",
          last_error: null,
          ai_input_tokens: usage.inputTokens,
          ai_output_tokens: usage.outputTokens,
          ai_total_tokens: usage.totalTokens,
          ai_cost_usd: usage.costUsd,
          ai_credits_charged: Math.max(500, Math.min(usage.creditsCharged, MAX_GENERATION_CREDITS)),
          ai_usage_breakdown: usage.entries,
        })
        .eq("id", boq_id);

      if (error) {
        logger.error("rate-boq job: failed to save result", { boq_id, error: String(error) });
        throw new Error("Failed to save rated BOQ");
      }

      trackEvent(user_id, "boq_rated_async", {
        boqId: boq_id,
        itemCount,
        storageKey: storage_key,
        aiCostUsd: usage.costUsd,
        creditsCharged: usage.creditsCharged,
      });
    });

    await step.run("send-email", async () => {
      if (!user_email) return;
      const title = result.boq.project || "Rated BOQ";
      try {
        await sendBoqReadyEmail({ email: user_email, boqId: boq_id, title });
      } catch (err) {
        logger.warn("rate-boq job: completion email failed", {
          boq_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    return { boq_id };
  }
);
