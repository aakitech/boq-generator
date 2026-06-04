import { NextRequest, NextResponse } from "next/server";
import type { GenerationInputDocument, RateContext } from "@/lib/ai";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isManualPaymentAdmin } from "@/lib/auth/manual-payment-admin";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";
import { InngestEnqueueError, sendInngestEvent } from "@/lib/inngest";
import { sendAdminServiceJobAlert } from "@/lib/email/admin-alerts";
import { processGenerateBOQJob, shouldRunJobsInline } from "@/lib/boq-jobs";

export const runtime = "nodejs";
export const maxDuration = 60;
export const maxRequestBodySize = "55mb";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !isManualPaymentAdmin(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { customer_email, project_name, payment_reference, service_package, documents, rate_context } = body as {
      customer_email: string;
      project_name?: string;
      payment_reference?: string;
      service_package?: "boq_only" | "tender_pack" | "full_submission";
      documents: GenerationInputDocument[];
      rate_context?: RateContext;
    };

    if (!customer_email || !customer_email.includes("@")) {
      return NextResponse.json({ error: "Valid customer_email is required" }, { status: 400 });
    }

    if (!Array.isArray(documents) || documents.length === 0) {
      return NextResponse.json({ error: "At least one document is required" }, { status: 400 });
    }

    const hasUsableText = documents.some((d) => typeof d.text === "string" && d.text.length >= 50);
    if (!hasUsableText) {
      return NextResponse.json(
        { error: "Could not extract meaningful content from the uploaded documents" },
        { status: 400 }
      );
    }

    const truncatedDocuments = documents.map((doc) => ({
      ...doc,
      text: doc.text.length > 80000 ? doc.text.slice(0, 80000) + "\n...[truncated]" : doc.text,
    }));

    const primaryDoc = documents.find((d) => d.role === "primary") ?? documents[0];
    const pendingTitle = project_name?.trim() ||
      (primaryDoc?.subject_name?.trim()) ||
      (primaryDoc?.name ? primaryDoc.name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").trim() : "") ||
      "Service Job";

    // Use service client to bypass RLS — service jobs are created on behalf of Brighton's account
    const db = createServiceClient();

    const { data: saved, error: dbError } = await db
      .from("boqs")
      .insert({
        user_id: user.id,
        title: pendingTitle.slice(0, 120),
        data: {},
        payment_status: "paid",
        processing_status: "pending",
        service_tier: "done_for_you",
        customer_email,
        service_status: "pending_review",
        service_package: service_package ?? "boq_only",
        service_payment_reference: payment_reference ?? null,
      })
      .select("id")
      .single();

    if (dbError || !saved) {
      logger.error("admin service-job: failed to create BOQ row", {
        error: dbError?.message,
        code: dbError?.code,
        route: "admin/service-job",
      });
      return NextResponse.json({ error: "Failed to create service job. Please try again." }, { status: 500 });
    }

    sendAdminServiceJobAlert({
      boqId: saved.id,
      customerEmail: customer_email,
      title: pendingTitle,
      docCount: documents.length,
      isReadyForReview: false,
    }).catch((err) =>
      logger.warn("admin service-job: new job alert failed", { error: String(err) })
    );

    if (shouldRunJobsInline) {
      void processGenerateBOQJob({
        boq_id: saved.id,
        documents: truncatedDocuments,
        rate_context,
        user_id: user.id,
        user_email: user.email ?? "",
      }).catch((jobError) => {
        logger.error("admin service-job inline job error", {
          error: jobError instanceof Error ? jobError.message : String(jobError),
          boqId: saved.id,
        });
      });

      trackEvent(user.id, "service_job_created", {
        boqId: saved.id,
        customerEmail: customer_email,
        docCount: truncatedDocuments.length,
        servicePackage: service_package ?? "boq_only",
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
      await db
        .from("boqs")
        .update({
          processing_status: "failed",
          processing_failed_at: new Date().toISOString(),
          last_error: `Could not enqueue generation job: ${message}`,
        })
        .eq("id", saved.id);
      logger.error("admin service-job: enqueue failed", {
        error: message,
        boqId: saved.id,
      });
      if (sendError instanceof InngestEnqueueError) {
        return NextResponse.json({ error: message }, { status: 503 });
      }
      throw sendError;
    }

    trackEvent(user.id, "service_job_created", {
      boqId: saved.id,
      customerEmail: customer_email,
      docCount: truncatedDocuments.length,
      servicePackage: service_package ?? "boq_only",
    });

    return NextResponse.json({ boq_id: saved.id, processing_status: "pending" });
  } catch (err) {
    logger.error("admin service-job: unexpected error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Failed to create service job. Please try again." }, { status: 500 });
  }
}
