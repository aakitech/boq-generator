import { inngest } from "@/lib/inngest";
import { createServiceClient } from "@/lib/supabase/server";
import { generateBOQ, validateSOW } from "@/lib/ai";
import type { GenerationInputDocument, GeminiUsageCollector } from "@/lib/ai";
import type { RateContext } from "@/lib/ai";
import { creditsForGeneratedBoq, summarizeAIUsage, MAX_GENERATION_CREDITS } from "@/lib/gemini-pricing";
import { trackEvent } from "@/lib/analytics";
import { logger } from "@/lib/logger";
import { sendBoqReadyEmail } from "@/lib/email/boq-ready";

export const generateBOQJob = inngest.createFunction(
  { id: "generate-boq", retries: 1, timeouts: { finish: "5m" }, triggers: [{ event: "boq/generate.requested" }] },
  async ({ event, step }) => {
    const { boq_id, documents, rate_context, user_id, user_email } = event.data as {
      boq_id: string;
      documents: GenerationInputDocument[];
      rate_context?: RateContext;
      user_id: string;
      user_email: string;
    };

    await step.run("mark-processing", async () => {
      const db = createServiceClient();
      await db
        .from("boqs")
        .update({ processing_status: "processing", processing_started_at: new Date().toISOString() })
        .eq("id", boq_id);
    });

    const result = await step.run("generate", async () => {
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

      return { boq, usage: usageCollector.entries };
    });

    const savedId = await step.run("save-result", async () => {
      const db = createServiceClient();
      const usage = summarizeAIUsage(result.usage);
      const title = result.boq.project || "Untitled BOQ";
      const generationCredits = Math.max(creditsForGeneratedBoq(), Math.min(usage.creditsCharged, MAX_GENERATION_CREDITS));

      // Compute grand total for display — inline to avoid importing deleted lib/pricing.ts
      const grandTotalZmw = (result.boq.bills ?? []).reduce((sum, bill) => {
        return sum + (bill.items ?? []).filter((i) => !i.is_header).reduce((s, i) => {
          const amt = i.amount ?? (i.qty != null && i.rate != null ? i.qty * i.rate : null);
          return s + (amt ?? 0);
        }, 0);
      }, 0);
      const itemCount = (result.boq.bills ?? []).flatMap((b) => b.items ?? []).filter((i) => !i.is_header).length;

      const { data: saved, error } = await db
        .from("boqs")
        .update({
          title,
          data: result.boq,
          processing_status: "completed",
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

      trackEvent(user_id, "boq_generated_async", {
        boqId: saved.id,
        title,
        itemCount,
        grandTotalZmw,
        aiCostUsd: usage.costUsd,
        creditsCharged: generationCredits,
      });

      return saved.id;
    });

    await step.run("send-email", async () => {
      if (!user_email) return;
      const title = result.boq.project || "Untitled BOQ";
      try {
        await sendBoqReadyEmail({ email: user_email, boqId: savedId, title });
      } catch (err) {
        logger.warn("generate-boq job: completion email failed", {
          boq_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    return { boq_id: savedId };
  }
);
