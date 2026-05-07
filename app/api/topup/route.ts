import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureProfileExists } from "@/lib/supabase/ensure-profile";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";

const TOPUP_OPTIONS: Record<number, number> = {
  20: 500,
  50: 1250,
  100: 2500,
};

function buildWhatsAppUrl(phone: string, message: string): string {
  const clean = phone.replace(/\D/g, "");
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
}

export async function POST(req: NextRequest) {
  try {
    const { amount_usd } = (await req.json()) as { amount_usd: number };

    const creditsToGrant = TOPUP_OPTIONS[amount_usd];
    if (!creditsToGrant) {
      return NextResponse.json({ error: "Invalid amount. Choose $20, $50, or $100." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const serviceClient = createServiceClient();
    await ensureProfileExists(serviceClient, user);

    // Create the top-up request row
    const { data: topupRow, error: insertError } = await serviceClient
      .from("topup_requests")
      .insert({
        user_id: user.id,
        amount_usd,
        credits_to_grant: creditsToGrant,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError || !topupRow) {
      logger.error("Failed to create topup request", { error: insertError?.message ?? String(insertError), code: insertError?.code, userId: user.id });
      return NextResponse.json({ error: "Failed to create top-up request. Please try again." }, { status: 500 });
    }

    const reference = topupRow.id.slice(0, 8).toUpperCase();
    const whatsappNumber = process.env.TOPUP_WHATSAPP_NUMBER ?? "";
    const ecocashNumber = process.env.TOPUP_MOMO_NUMBER ?? "";
    const bankDetails = process.env.TOPUP_BANK_DETAILS ?? "";

    const whatsappMessage = [
      `Hi, I'd like to top up my BOQ Generator account.`,
      ``,
      `Email: ${user.email}`,
      `Amount: $${amount_usd} (${creditsToGrant} credits)`,
      `Reference: ${reference}`,
      ``,
      `I'll send proof of payment now.`,
    ].join("\n");

    const whatsappUrl = whatsappNumber ? buildWhatsAppUrl(whatsappNumber, whatsappMessage) : null;

    trackEvent(user.id, "topup_requested", { amountUsd: amount_usd, creditsToGrant, reference });

    return NextResponse.json({
      reference,
      amount_usd,
      credits_to_grant: creditsToGrant,
      momo_number: ecocashNumber || null,
      bank_details: bankDetails || null,
      whatsapp_url: whatsappUrl,
    });
  } catch (err) {
    logger.error("topup route error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
