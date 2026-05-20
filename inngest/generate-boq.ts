import * as Sentry from "@sentry/nextjs";
import { inngest } from "@/lib/inngest";
import { createServiceClient } from "@/lib/supabase/server";
import {
  validateSOW,
  classifyProjectStructure,
  generateStructure,
  normalizeStructure,
  countNonHeaderItems,
  extractQuantities,
  applyDrawingCountHeuristics,
  mergeStructureAndQuantities,
  fillRatesPass,
  buildPromptBundle,
  buildSourceBundle,
  supportingDocsSatisfyRequirements,
} from "@/lib/ai";
import type { GenerationInputDocument, GeminiUsageCollector } from "@/lib/ai";
import type { RateContext } from "@/lib/ai";
import { creditsForGeneratedBoq, creditsForGeneratedBoqWithDocs, summarizeAIUsage, MAX_GENERATION_CREDITS } from "@/lib/gemini-pricing";
import { consumeWalletCredits } from "@/lib/credits";
import { trackEvent } from "@/lib/analytics";
import { logger } from "@/lib/logger";
import { sendBoqReadyEmail } from "@/lib/email/boq-ready";
import { cleanExtractedText } from "@/lib/text-cleaner";

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

export const generateBOQJob = inngest.createFunction(
  { id: "generate-boq", retries: 1, timeouts: { finish: "20m" }, triggers: [{ event: "boq/generate.requested" }] },
  async ({ event, step }) => {
    const { boq_id, documents, rate_context, user_id, user_email } = event.data as {
      boq_id: string;
      documents: GenerationInputDocument[];
      rate_context?: RateContext;
      user_id: string;
      user_email: string;
    };

    try {
      // Step 1: mark processing
      await step.run("mark-processing", async () => {
        return Sentry.startSpan({ name: "inngest.generate-boq/mark-processing", op: "inngest.step" }, async () => {
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
      });

      // Step 2: persist extracted documents for debugging and retry-without-reupload
      await step.run("persist-documents", async () => {
        const db = createServiceClient();
        const rows = documents.map((doc) => ({
          boq_id,
          user_id,
          filename: doc.name,
          text: doc.drawing_type ? doc.text : cleanExtractedText(doc.text),
          pages: doc.pages ?? null,
          drawing_type: doc.drawing_type ?? null,
          subject_name: doc.subject_name ?? null,
          used_vision: !!doc.drawing_type,
        }));
        const { error } = await db.from("extracted_documents").insert(rows);
        if (error) logger.warn("generate-boq: failed to persist extracted documents", { boq_id, error: String(error) });
      });

      // Step 3: validate SOW — fast, ~10-20s
      const validation = await step.run("validate-sow", async () => {
        return Sentry.startSpan({ name: "inngest.generate-boq/validate-sow", op: "inngest.step" }, async () => {
          const usageCollector: GeminiUsageCollector = { entries: [] };
          const validationText = documents
            .map((d) => d.text.slice(0, 3000))
            .join("\n\n---\n\n");
          const result = await validateSOW(validationText, {
            supportingDocsCount: documents.length - 1,
            usageCollector,
          });
          if (result.should_block_generation) {
            throw new Error(result.reason || "These documents can't be used to generate a BOQ.");
          }
          return { validation: result, usage: usageCollector.entries };
        });
      });

      // Step 4: structure pass — ~60-120s
      // Structure is saved to boqs.processing_context (not returned) to avoid
      // Inngest Finalization serializing a large object and hitting Vercel's 5m limit.
      const structureResult = await step.run("generate-structure", async () => {
        return Sentry.startSpan({ name: "inngest.generate-boq/generate-structure", op: "inngest.step" }, async () => {
          const usageCollector: GeminiUsageCollector = { entries: [] };
          const truncated = documents.map((d) => ({
            ...d,
            text: d.text.length > 80000 ? d.text.slice(0, 80000) + "\n...[truncated]" : d.text,
          }));
          const bundleText = buildPromptBundle(truncated);
          const { structure_type: structureMode, blocks } = await classifyProjectStructure(truncated, usageCollector);

          let structureRaw = await generateStructure(bundleText, false, structureMode, blocks, usageCollector);
          let structure = normalizeStructure(structureRaw);
          structure.structure_mode = structureMode;

          if (countNonHeaderItems(structure) === 0) {
            structureRaw = await generateStructure(bundleText, true, structureMode, blocks, usageCollector);
            structure = normalizeStructure(structureRaw);
            structure.structure_mode = structureMode;
          }

          if (countNonHeaderItems(structure) === 0) {
            throw new Error(
              "Could not extract BOQ structure from SOW (no measurable items found). Please upload a clearer scope document."
            );
          }

          // Save structure to DB — don't return it from the step.
          // Returning large objects causes Inngest Finalization to serialize them
          // through the Vercel function boundary, hitting the 5m timeout.
          const db = createServiceClient();
          const { error: saveErr } = await db
            .from("boqs")
            .update({ processing_context: { structure } })
            .eq("id", boq_id);
          if (saveErr) throw new Error(`Failed to save structure: ${saveErr.code}: ${saveErr.message}`);

          return { usage: usageCollector.entries };
        });
      });

      // Step 4: quantities pass — ~60-120s
      const quantitiesResult = await step.run("extract-quantities", async () => {
        return Sentry.startSpan({ name: "inngest.generate-boq/extract-quantities", op: "inngest.step" }, async () => {
          const usageCollector: GeminiUsageCollector = { entries: [] };
          const truncated = documents.map((d) => ({
            ...d,
            text: d.text.length > 80000 ? d.text.slice(0, 80000) + "\n...[truncated]" : d.text,
          }));

          // Rebuild bundleText locally — avoids passing ~1.5MB text payload through Inngest step serialization
          const bundleText = buildPromptBundle(truncated);

          // Read structure back from DB (was saved by generate-structure to avoid serialization overhead)
          const db = createServiceClient();
          const { data: boqRow, error: readErr } = await db
            .from("boqs")
            .select("processing_context")
            .eq("id", boq_id)
            .single();
          if (readErr || !boqRow?.processing_context?.structure) {
            throw new Error("Failed to read structure from processing_context");
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const structure = boqRow.processing_context.structure as any;

          const quantitiesRaw = applyDrawingCountHeuristics(
            structure,
            await extractQuantities(bundleText, structure, usageCollector),
            truncated
          );

          const sourceBundleStatus =
            validation.validation.required_attachments.length > 0 &&
            supportingDocsSatisfyRequirements(truncated, validation.validation.required_attachments)
              ? "complete"
              : validation.validation.source_bundle_status;

          const boq = mergeStructureAndQuantities(
            structure,
            quantitiesRaw,
            { ...validation.validation, source_bundle_status: sourceBundleStatus },
            buildSourceBundle(truncated)
          );

          if (rate_context?.projectType) {
            boq.project_type = rate_context.projectType;
          }

          return { boq, usage: usageCollector.entries };
        });
      });

      // Step 5: rate fill pass — ~60-180s depending on item count
      const result = await step.run("fill-rates", async () => {
        return Sentry.startSpan({ name: "inngest.generate-boq/fill-rates", op: "inngest.step" }, async () => {
          const usageCollector: GeminiUsageCollector = { entries: [] };
          const boq = await fillRatesPass(quantitiesResult.boq, { rateContext: rate_context, usageCollector });
          return {
            boq,
            usage: [
              ...validation.usage,
              ...structureResult.usage,
              ...quantitiesResult.usage,
              ...usageCollector.entries,
            ],
          };
        });
      });

      // Step 6: save result + charge credits (unchanged)
      const savedId = await step.run("save-result", async () => {
        return Sentry.startSpan({ name: "inngest.generate-boq/save-result", op: "inngest.step" }, async () => {
          const db = createServiceClient();
          const usage = summarizeAIUsage(result.usage);
          const title = result.boq.project || "Untitled BOQ";
          const creditsFloor = creditsForGeneratedBoqWithDocs(documents.length);
          const generationCredits = Math.max(
            creditsFloor,
            Math.min(usage.creditsCharged, MAX_GENERATION_CREDITS)
          );

          const grandTotalZmw = (result.boq.bills ?? []).reduce((sum, bill) => {
            return sum + (bill.items ?? []).filter((i) => !i.is_header).reduce((s, i) => {
              const amt = i.amount ?? (i.qty != null && i.rate != null ? i.qty * i.rate : null);
              return s + (amt ?? 0);
            }, 0);
          }, 0);
          const itemCount = (result.boq.bills ?? [])
            .flatMap((b) => b.items ?? [])
            .filter((i) => !i.is_header).length;

          const { data: saved, error } = await db
            .from("boqs")
            .update({
              title,
              data: result.boq,
              processing_status: "completed",
              processing_failed_at: null,
              processing_context: null,
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
            .maybeSingle();

          if (error) {
            const detail = `${error.code}: ${error.message}`;
            logger.error("generate-boq job: failed to save result", { boq_id, detail });
            throw new Error(`Failed to save generated BOQ — ${detail}`);
          }
          if (!saved) {
            logger.error("generate-boq job: boq row not found for save", { boq_id });
            throw new Error(`Failed to save generated BOQ — row not found (boq_id: ${boq_id})`);
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

          return saved.id;
        });
      });

      // Step 7: send email (unchanged)
      await step.run("send-email", async () => {
        return Sentry.startSpan({ name: "inngest.generate-boq/send-email", op: "inngest.step" }, async () => {
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
      });

      return { boq_id: savedId };
    } catch (err) {
      logger.error("generate-boq job failed", {
        boq_id,
        error: err instanceof Error ? err.message : String(err),
      });
      await markGenerationFailed(boq_id, err);
      throw err;
    }
  }
);
