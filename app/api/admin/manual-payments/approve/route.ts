import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isManualPaymentAdmin } from "@/lib/auth/manual-payment-admin";
import { sendManualPaymentApprovedEmail } from "@/lib/email/manual-payment";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isManualPaymentAdmin(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { boq_id, manual_payment_reference } = (await req.json()) as {
      boq_id?: string;
      manual_payment_reference?: string;
    };

    if (!boq_id) {
      return NextResponse.json({ error: "boq_id is required" }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    const { data: boqRow, error: fetchError } = await serviceClient
      .from("boqs")
      .select("id, user_id, title, payment_status, payment_source, processing_status, source_excel_key")
      .eq("id", boq_id)
      .single();

    if (fetchError || !boqRow) {
      return NextResponse.json({ error: "BOQ not found" }, { status: 404 });
    }

    if (boqRow.payment_status === "paid") {
      return NextResponse.json({ error: "This BOQ is already paid" }, { status: 409 });
    }

    const { error: updateError } = await serviceClient
      .from("boqs")
      .update({
        payment_status: "paid",
        payment_source: "manual_whatsapp",
        manual_payment_reference:
          manual_payment_reference?.trim() ||
          `Approved by ${user.email ?? "admin"} on ${new Date().toISOString()}`,
      })
      .eq("id", boq_id);

    if (updateError) {
      logger.error("Manual payment approval update failed", {
        route: "manual-payment-approve",
        boqId: boq_id,
        error: String(updateError),
      });
      return NextResponse.json({ error: "Could not approve manual payment" }, { status: 500 });
    }

    const { data: profile } = await serviceClient
      .from("profiles")
      .select("email")
      .eq("id", boqRow.user_id)
      .maybeSingle();

    if (profile?.email) {
      try {
        await sendManualPaymentApprovedEmail({
          email: profile.email,
          boqId: boqRow.id,
          title: boqRow.title || "Your BOQ",
          sourceExcelKey: boqRow.source_excel_key,
          processingStatus: boqRow.processing_status,
        });
      } catch (emailError) {
        logger.error("Manual payment approval email failed", {
          route: "manual-payment-approve",
          boqId: boq_id,
          error: emailError instanceof Error ? emailError.message : String(emailError),
        });
      }
    }

    trackEvent(user.id, "manual_payment_approved", {
      boqId: boq_id,
      approvedForUserId: boqRow.user_id,
    });

    return NextResponse.json({ ok: true, boq_id });
  } catch (err) {
    logger.error("manual-payment approve error", {
      route: "manual-payment-approve",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Could not approve manual payment" }, { status: 500 });
  }
}
