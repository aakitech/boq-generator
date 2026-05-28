import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isManualPaymentAdmin } from "@/lib/auth/manual-payment-admin";
import { generateBOQExcelFromTemplate } from "@/lib/excel-template";
import { sendServiceDeliveryEmail } from "@/lib/email/service-delivery";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";
import type { BOQDocument } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !isManualPaymentAdmin(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const db = createServiceClient();
    const { data: boq, error: fetchError } = await db
      .from("boqs")
      .select("id, title, data, service_tier, service_status, processing_status, customer_email, service_package")
      .eq("id", id)
      .single();

    if (fetchError || !boq) {
      return NextResponse.json({ error: "BOQ not found" }, { status: 404 });
    }

    if (boq.service_tier !== "done_for_you") {
      return NextResponse.json({ error: "Not a service job" }, { status: 400 });
    }

    if (boq.processing_status !== "completed") {
      return NextResponse.json(
        { error: "BOQ generation has not completed yet" },
        { status: 400 }
      );
    }

    if (boq.service_status === "delivered") {
      return NextResponse.json({ error: "Already delivered" }, { status: 409 });
    }

    if (!boq.customer_email) {
      return NextResponse.json({ error: "No customer email on record" }, { status: 400 });
    }

    const excelBuffer = await generateBOQExcelFromTemplate(boq.data as BOQDocument);

    await sendServiceDeliveryEmail({
      customerEmail: boq.customer_email,
      title: boq.title,
      boqId: boq.id,
      excelBuffer,
    });

    const now = new Date().toISOString();
    await db
      .from("boqs")
      .update({
        service_status: "delivered",
        service_approved_at: now,
        service_delivered_at: now,
      })
      .eq("id", id);

    trackEvent(user.id, "service_job_delivered", {
      boqId: id,
      customerEmail: boq.customer_email,
      servicePackage: boq.service_package,
    });

    logger.info("admin service-job: delivered", {
      boqId: id,
      customerEmail: boq.customer_email,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("admin service-job deliver: unexpected error", {
      boqId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Failed to deliver BOQ. Please try again." }, { status: 500 });
  }
}
