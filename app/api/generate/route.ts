import { NextRequest, NextResponse } from "next/server";
import { generateBOQ, validateSOW } from "@/lib/ai";
import type { GenerationInputDocument } from "@/lib/ai";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureProfileExists } from "@/lib/supabase/ensure-profile";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";
import { computePricing, loadTiers } from "@/lib/pricing";
import { creditsForGeneratedBoq, summarizeAIUsage } from "@/lib/gemini-pricing";
import type { GeminiUsageCollector } from "@/lib/ai";
import type { PostgrestError } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300;

function isPostgrestError(error: unknown): error is PostgrestError {
  return Boolean(
    error &&
      typeof error === "object" &&
      "message" in error &&
      typeof (error as { message?: unknown }).message === "string"
  );
}

function classifyGenerateError(message: string): { status: number; safeMessage: string } {
  const lower = message.toLowerCase();
  if (lower.includes("openai fallback is not configured") || lower.includes("openai_api_key")) {
    return {
      status: 503,
      safeMessage:
        "AI provider failover is not configured yet. Gemini was unavailable and the OpenAI fallback could not run. Please add the OpenAI API key or try again later.",
    };
  }
  const isQuota =
    lower.includes("429") ||
    lower.includes("quota") ||
    lower.includes("too many requests");
  if (isQuota) {
    return {
      status: 429,
      safeMessage: "AI rate limit reached. Please wait a minute and try again.",
    };
  }

  const isProviderFormatError =
    lower.includes("[openai error]: 400") ||
    lower.includes("invalid schema") ||
    lower.includes("response_format") ||
    lower.includes("json_schema");

  if (isProviderFormatError) {
    return {
      status: 503,
      safeMessage: "AI generation hit a temporary provider formatting issue while retrying providers. Please try again in a moment.",
    };
  }

  const isTemporaryUnavailable =
    lower.includes("503") ||
    lower.includes("service unavailable") ||
    lower.includes("high demand") ||
    lower.includes("temporarily unavailable") ||
    lower.includes("timeout") ||
    lower.includes("etimedout") ||
    lower.includes("econnreset");

  if (isTemporaryUnavailable) {
    return {
      status: 503,
      safeMessage: "AI service is temporarily busy and provider failover did not complete. Please try again in a moment.",
    };
  }

  return { status: 500, safeMessage: "BOQ generation failed. Please try again." };
}

export async function POST(req: NextRequest) {
  try {
    // Auth check first — before any AI calls
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { text, documents, rate_context } = body as {
      text?: string;
      documents?: GenerationInputDocument[];
      rate_context?: import("@/lib/ai").RateContext;
    };

    const allDocuments: GenerationInputDocument[] =
      Array.isArray(documents) && documents.length > 0
        ? documents
        : typeof text === "string"
          ? [{ document_id: "doc-1", name: "Document", role: "supporting" as const, document_type: "construction_sow" as const, text, pages: null }]
          : [];

    if (allDocuments.length === 0) {
      return NextResponse.json({ error: "At least one document is required" }, { status: 400 });
    }

    const hasUsableText = allDocuments.some((d) => typeof d.text === "string" && d.text.length >= 50);
    if (!hasUsableText) {
      return NextResponse.json(
        { error: "Could not extract meaningful content from the uploaded documents" },
        { status: 400 }
      );
    }

    // Validate across all docs — AI picks the strongest SOW signal from the bundle
    const validationText = allDocuments
      .map((d) => d.text.slice(0, 3000))
      .join("\n\n---\n\n");

    const supportingDocsCount = allDocuments.length - 1;
    const usageCollector: GeminiUsageCollector = { entries: [] };

    const validation = await validateSOW(validationText, {
      supportingDocsCount,
      usageCollector,
    });
    if (!validation.isSOW || validation.should_block_generation) {
      return NextResponse.json(
        {
          error: validation.reason || "These documents don't contain a construction Scope of Work suitable for BOQ generation.",
          document_type: validation.documentType || "unknown",
        },
        { status: 422 }
      );
    }

    // Truncate to ~80k chars to stay within token limits
    const truncatedDocuments = allDocuments.map((doc) => ({
      ...doc,
      text:
        doc.text.length > 80000
          ? doc.text.slice(0, 80000) + "\n...[truncated]"
          : doc.text,
    }));

    const boq = await generateBOQ(
      { documents: truncatedDocuments },
      {
        suggestRates: true,
        rateContext: rate_context,
        documentClassification: validation,
        usageCollector,
      }
    );
    const usageSummary = summarizeAIUsage(usageCollector.entries);
    const generationCredits = Math.max(creditsForGeneratedBoq(), usageSummary.creditsCharged, 1);

    // Compute pricing from the generated BOQ
    const tiers = loadTiers();
    const pricing = computePricing(boq, tiers);
    const title = boq.project || "Untitled BOQ";

    const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!hasServiceRole) {
      logger.warn("SUPABASE_SERVICE_ROLE_KEY not set; falling back to user-scoped inserts", { route: "generate" });
    }
    const dbClient = hasServiceRole ? createServiceClient() : supabase;
    if (hasServiceRole) {
      const { error: profileError } = await ensureProfileExists(dbClient, user);
      if (profileError) {
        logger.error("Failed to ensure profile before preview BOQ save", {
          error: String(profileError),
          hasServiceRole,
          route: "generate",
        });
      }
    }

    // Save BOQ as a preview (unpaid) — no stripe_session_id yet
    const { data: saved, error: dbError } = await dbClient
      .from("boqs")
      .insert({
        user_id: user.id,
        title,
        data: boq,
        payment_status: "preview",
        processing_status: "completed",
        grand_total_zmw: pricing.grandTotalZmw,
        ai_input_tokens: usageSummary.inputTokens,
        ai_output_tokens: usageSummary.outputTokens,
        ai_total_tokens: usageSummary.totalTokens,
        ai_cost_usd: usageSummary.costUsd,
        ai_credits_charged: generationCredits,
        ai_usage_breakdown: usageSummary.entries,
      })
      .select("id")
      .single();

    if (dbError) {
      logger.error("Failed to save preview BOQ to DB", {
        error: String(dbError),
        code: isPostgrestError(dbError) ? dbError.code : undefined,
        message: isPostgrestError(dbError) ? dbError.message : undefined,
        details: isPostgrestError(dbError) ? dbError.details : undefined,
        hint: isPostgrestError(dbError) ? dbError.hint : undefined,
        hasServiceRole,
        route: "generate",
      });
      return NextResponse.json(
        { error: "Failed to save BOQ. Please try again." },
        { status: 500 }
      );
    }

    trackEvent(user.id, "boq_preview_created", {
      boqId: saved.id,
      title,
      billCount: pricing.billCount,
      itemCount: pricing.itemCount,
      grandTotalZmw: pricing.grandTotalZmw,
      tier: pricing.tier.label,
      amountCents: pricing.tier.usdCents,
      aiCostUsd: usageSummary.costUsd,
      creditsCharged: generationCredits,
    });

    // Return preview metadata only — NOT the full BOQ (locked until paid)
    return NextResponse.json({
      boq_id: saved.id,
      amountCents: pricing.tier.usdCents,
      boq_preview: {
        billCount: pricing.billCount,
        itemCount: pricing.itemCount,
        tier: {
          label: pricing.tier.label,
          displayUsd: pricing.tier.displayUsd,
          usdCents: pricing.tier.usdCents,
        },
        approxRangeLabel: pricing.approxRangeLabel,
      },
    });
  } catch (err) {
    logger.error("BOQ generation error", { error: err instanceof Error ? err.message : String(err), route: "generate" });
    const message = err instanceof Error ? err.message : "Unknown error";

    const isExtractionFailure =
      message.includes("Could not extract BOQ structure") ||
      message.includes("no measurable items found");
    if (isExtractionFailure) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    const classified = classifyGenerateError(message);
    return NextResponse.json(
      { error: classified.safeMessage },
      { status: classified.status }
    );
  }
}
