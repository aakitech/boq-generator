import { NextRequest, NextResponse } from "next/server";
import type { GenerationInputDocument } from "@/lib/ai";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureProfileExists } from "@/lib/supabase/ensure-profile";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";
import { InngestEnqueueError, sendInngestEvent } from "@/lib/inngest";
import type { RateContext } from "@/lib/ai";
import { getRemainingCredits } from "@/lib/credits";
import { creditsForGeneratedBoqWithDocs } from "@/lib/gemini-pricing";
import { processGenerateBOQJob, shouldRunJobsInline } from "@/lib/boq-jobs";

export const runtime = "nodejs";
export const maxDuration = 60;
export const maxRequestBodySize = "55mb";

function titleFromDocumentName(name: string): string {
  return name
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferPendingTitle(documents: GenerationInputDocument[]): string {
  const primary = documents.find((doc) => doc.role === "primary") ?? documents[0];
  const title = primary?.subject_name?.trim() || (primary?.name ? titleFromDocumentName(primary.name) : "");
  return title ? title.slice(0, 120) : "Generating BOQ";
}

export async function POST(req: NextRequest) {
  try {
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
      rate_context?: RateContext;
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

    // Truncate before storing in event payload — keeps Inngest event size manageable
    const truncatedDocuments = allDocuments.map((doc) => ({
      ...doc,
      text: doc.text.length > 80000 ? doc.text.slice(0, 80000) + "\n...[truncated]" : doc.text,
    }));
    const pendingTitle = inferPendingTitle(allDocuments);

    const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const dbClient = hasServiceRole ? createServiceClient() : supabase;

    if (hasServiceRole) {
      const { error: profileError } = await ensureProfileExists(dbClient, user);
      if (profileError) {
        logger.error("Failed to ensure profile before BOQ job enqueue", {
          error: String(profileError),
          route: "generate",
        });
      }
    }

    // Fast credit gate — prevent queueing jobs for users with insufficient credits
    const remainingCredits = await getRemainingCredits(dbClient, user.id);
    const requiredCredits = creditsForGeneratedBoqWithDocs(allDocuments.length);
    if (remainingCredits < requiredCredits) {
      return NextResponse.json(
        { error: "insufficient_credits", remainingCredits, requiredCredits },
        { status: 402 }
      );
    }

    // Insert placeholder row — Inngest job fills in data and marks completed
    const { data: saved, error: dbError } = await dbClient
      .from("boqs")
      .insert({
        user_id: user.id,
        title: pendingTitle,
        data: {},
        payment_status: "paid",
        processing_status: "pending",
      })
      .select("id")
      .single();

    if (dbError || !saved) {
      logger.error("Failed to create pending BOQ row", {
        error: String(dbError),
        route: "generate",
      });
      return NextResponse.json({ error: "Failed to start generation. Please try again." }, { status: 500 });
    }

    if (shouldRunJobsInline) {
      void processGenerateBOQJob({
        boq_id: saved.id,
        documents: truncatedDocuments,
        rate_context,
        user_id: user.id,
        user_email: user.email ?? "",
      }).catch((jobError) => {
        logger.error("BOQ generate inline job error", {
          error: jobError instanceof Error ? jobError.message : String(jobError),
          route: "generate",
          boqId: saved.id,
        });
      });

      trackEvent(user.id, "boq_generate_enqueued", {
        boqId: saved.id,
        docCount: truncatedDocuments.length,
        mode: "inline-dev",
      });

      return NextResponse.json({ boq_id: saved.id, processing_status: "pending" });
    }

    try {
      await sendInngestEvent({
        name: "boq/generate.requested",
        data: {
          boq_id: saved.id,
          documents: truncatedDocuments,
          rate_context,
          user_id: user.id,
          user_email: user.email ?? "",
        },
      });
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError);
      await dbClient
        .from("boqs")
        .update({
          processing_status: "failed",
          processing_failed_at: new Date().toISOString(),
          last_error: `Could not enqueue generation job: ${message}`,
        })
        .eq("id", saved.id);
      logger.error("BOQ generate enqueue send failed", {
        error: message,
        route: "generate",
        boqId: saved.id,
      });
      if (sendError instanceof InngestEnqueueError) {
        return NextResponse.json({ error: message }, { status: 503 });
      }
      throw sendError;
    }

    trackEvent(user.id, "boq_generate_enqueued", {
      boqId: saved.id,
      docCount: truncatedDocuments.length,
    });

    return NextResponse.json({ boq_id: saved.id, processing_status: "pending" });
  } catch (err) {
    logger.error("BOQ generate enqueue error", {
      error: err instanceof Error ? err.message : String(err),
      route: "generate",
    });
    return NextResponse.json({ error: "Failed to start generation. Please try again." }, { status: 500 });
  }
}
