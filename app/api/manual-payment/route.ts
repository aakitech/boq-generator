import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureProfileExists } from "@/lib/supabase/ensure-profile";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";
import { getTierForAmount, getTierForItemCount, loadRateTiers, loadTiers } from "@/lib/pricing";

export const runtime = "nodejs";

function sanitizeWhatsAppNumber(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

export async function POST(req: NextRequest) {
  try {
    const { boq_id, type } = (await req.json()) as {
      boq_id?: string;
      type?: "generate_boq" | "rate_boq";
    };

    if (!boq_id || !type) {
      return NextResponse.json({ error: "boq_id and type are required" }, { status: 400 });
    }

    const rawWhatsAppNumber = process.env.MANUAL_PAYMENT_WHATSAPP_NUMBER;
    if (!rawWhatsAppNumber) {
      logger.error("Manual payment WhatsApp number missing", { route: "manual-payment" });
      return NextResponse.json({ error: "Manual payment is not configured" }, { status: 500 });
    }

    const contact = sanitizeWhatsAppNumber(rawWhatsAppNumber);
    if (!contact) {
      logger.error("Manual payment WhatsApp number invalid", { route: "manual-payment" });
      return NextResponse.json({ error: "Manual payment is not configured correctly" }, { status: 500 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = createServiceClient();
    await ensureProfileExists(serviceClient, user);

    const { data: boqRow, error: fetchError } = await serviceClient
      .from("boqs")
      .select("id, user_id, payment_status, grand_total_zmw, data")
      .eq("id", boq_id)
      .single();

    if (fetchError || !boqRow) {
      logger.error("Manual payment BOQ fetch failed", { route: "manual-payment", boqId: boq_id, error: String(fetchError) });
      return NextResponse.json({ error: "BOQ not found" }, { status: 404 });
    }

    if (boqRow.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (boqRow.payment_status === "paid") {
      return NextResponse.json({ error: "This BOQ is already paid for" }, { status: 409 });
    }

    let priceDisplay = "$0";

    if (type === "generate_boq") {
      const zmw = boqRow.grand_total_zmw ? Number(boqRow.grand_total_zmw) : 0;
      priceDisplay = getTierForAmount(zmw, loadTiers()).displayUsd;
    } else {
      const data = boqRow.data as { bills?: Array<{ items?: Array<{ is_header?: boolean }> }> } | null;
      const itemCount = data?.bills
        ? data.bills.flatMap((bill) => bill.items ?? []).filter((item) => !item.is_header).length
        : 0;
      priceDisplay = getTierForItemCount(itemCount, loadRateTiers()).displayUsd;
    }

    const { error: updateError } = await serviceClient
      .from("boqs")
      .update({
        payment_source: "manual_whatsapp",
        manual_payment_requested_at: new Date().toISOString(),
        manual_payment_contact: contact,
      })
      .eq("id", boq_id)
      .eq("user_id", user.id);

    if (updateError) {
      logger.error("Manual payment BOQ update failed", { route: "manual-payment", boqId: boq_id, error: String(updateError) });
      return NextResponse.json({ error: "Could not save manual payment request" }, { status: 500 });
    }

    const typeLabel = type === "rate_boq" ? "Rate existing BOQ" : "Generate BOQ";
    const message = [
      "Hello BOQ Team, I would like to complete a manual payment for BOQ Generator.",
      "",
      `Request type: ${typeLabel}`,
      `BOQ ID: ${boq_id}`,
      `Account email: ${user.email ?? "Not available"}`,
      `Quoted price: ${priceDisplay}`,
      "",
      "Please share the payment instructions and confirm once payment has been received so my BOQ can be unlocked.",
    ].join("\n");

    const whatsappUrl = `https://wa.me/${contact}?text=${encodeURIComponent(message)}`;

    trackEvent(user.id, "manual_payment_requested", {
      boqId: boq_id,
      type,
      priceDisplay,
      contact,
    });

    return NextResponse.json({
      ok: true,
      whatsappUrl,
      contact,
      priceDisplay,
      paymentDetails: message,
    });
  } catch (err) {
    logger.error("manual-payment error", { route: "manual-payment", error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Could not start manual payment" }, { status: 500 });
  }
}
