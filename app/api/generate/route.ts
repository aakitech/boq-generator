import { NextRequest, NextResponse } from "next/server";
import { generateBOQ, validateSOW } from "@/lib/claude";
import type { GenerationInputDocument } from "@/lib/claude";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureProfileExists } from "@/lib/supabase/ensure-profile";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";
import { computePricing, loadTiers } from "@/lib/pricing";
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
      safeMessage: "AI service is temporarily busy. Please try again in a moment.",
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
    const { text, documents, suggest_rates } = body as {
      text?: string;
      documents?: GenerationInputDocument[];
      suggest_rates?: boolean;
      is_sow?: boolean;
      sow_warning?: string;
      document_type?: string;
      should_block_generation?: boolean;
    };

    const primaryDocument =
      documents?.find((doc) => doc.role === "primary") ??
      (typeof text === "string"
        ? {
            document_id: "primary",
            name: "Primary SOW",
            role: "primary" as const,
            document_type: "construction_sow" as const,
            text,
            pages: null,
          }
        : null);

    if (!primaryDocument || typeof primaryDocument.text !== "string") {
      return NextResponse.json({ error: "primary document text is required" }, { status: 400 });
    }

    if (primaryDocument.text.length < 50) {
      return NextResponse.json(
        { error: "Text too short — could not extract meaningful content from PDF" },
        { status: 400 }
      );
    }

    const supportingDocsCount = (documents ?? []).filter((doc) => doc.role === "supporting").length;
    const validation = await validateSOW(primaryDocument.text, { supportingDocsCount });
    const clientSaysNotSOW = body.is_sow === false;
    if (!validation.isSOW || validation.should_block_generation || clientSaysNotSOW || body.should_block_generation) {
      const reason =
        validation.reason ||
        body.sow_warning ||
        "This document does not appear to be a construction Scope of Work suitable for BOQ generation.";
      return NextResponse.json(
        {
          error: reason,
          document_type: validation.documentType || body.document_type || "unknown",
        },
        { status: 422 }
      );
    }

    // Truncate to ~80k chars to stay within token limits
    const truncatedDocuments = (documents ?? [primaryDocument]).map((doc) => ({
      ...doc,
      text:
        doc.text.length > 80000
          ? doc.text.slice(0, 80000) + "\n...[truncated]"
          : doc.text,
    }));

    const boq = await generateBOQ(
      { documents: truncatedDocuments },
      {
        suggestRates: suggest_rates ?? false,
        documentClassification: validation,
      }
    );

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
