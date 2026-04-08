import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/server";
import Stripe from "stripe";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;

  if (webhookSecret && sig) {
    try {
      event = getStripe().webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Webhook error";
      logger.error("Webhook signature verification failed", { error: msg, route: "webhook" });
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  } else {
    logger.warn("STRIPE_WEBHOOK_SECRET not set — skipping verification", { route: "webhook" });
    try {
      event = JSON.parse(body) as Stripe.Event;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      logger.error("SUPABASE_SERVICE_ROLE_KEY is not configured; cannot persist payment", { route: "webhook" });
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY is not configured" },
        { status: 500 }
      );
    }

    const supabase = createServiceClient();

    const userId = session.metadata?.user_id ?? null;
    const boqId = session.metadata?.boq_id ?? null;

    // Upsert payment record
    const { data: paymentRow } = await supabase.from("payments").upsert(
      {
        stripe_session_id: session.id,
        stripe_payment_intent: session.payment_intent as string | null,
        user_id: userId,
        amount_cents: session.amount_total ?? 2000,
        currency: session.currency ?? "usd",
        status: "completed",
        ...(boqId ? { boq_id: boqId } : {}),
      },
      { onConflict: "stripe_session_id", ignoreDuplicates: false }
    ).select("id").single();

    if (boqId) {
      // New flow: mark the preview BOQ as paid
      const { error: updateError } = await supabase
        .from("boqs")
        .update({ payment_status: "paid", stripe_session_id: session.id, payment_source: "stripe" })
        .eq("id", boqId)
        .eq("payment_status", "preview"); // idempotent — only update if still preview

      if (updateError) {
        logger.error("Failed to mark BOQ as paid in webhook", { boqId, error: String(updateError), route: "webhook" });
      }
    } else {
      // Legacy flow: link payment to BOQ via stripe_session_id on the BOQ row
      const { data: boq } = await supabase
        .from("boqs")
        .select("id")
        .eq("stripe_session_id", session.id)
        .single();

      if (boq) {
        await supabase
          .from("payments")
          .update({ boq_id: boq.id })
          .eq("stripe_session_id", session.id);
      }
    }

    logger.info("Payment recorded", { sessionId: session.id, boqId, route: "webhook" });

    if (userId) {
      trackEvent(userId, "payment_completed", {
        amountCents: session.amount_total,
        currency: session.currency,
        type: session.metadata?.type ?? "generate_boq",
        boqId,
      });
    }

    // ── Affiliate commission ────────────────────────────────────────────────
    const refCode = session.metadata?.ref_code;
    if (refCode && userId) {
      try {
        const { data: affiliate } = await supabase
          .from("affiliates")
          .select("id, user_id, commission_type, commission_value")
          .eq("referral_code", refCode)
          .eq("status", "active")
          .single();

        if (affiliate && affiliate.user_id !== userId) {
          const amountTotal = session.amount_total ?? 0;
          const commission =
            affiliate.commission_type === "percent"
              ? Math.floor((amountTotal * affiliate.commission_value) / 10000)
              : affiliate.commission_value;

          const { data: referralRow } = await supabase
            .from("referrals")
            .insert({
              affiliate_id: affiliate.id,
              referred_user_id: userId,
              payment_id: paymentRow?.id ?? null,
              commission_cents: commission,
              status: "confirmed",
            })
            .select("id")
            .single();

          // Atomic increment via DB function
          await supabase.rpc("increment_affiliate_earned", {
            p_affiliate_id: affiliate.id,
            p_amount: commission,
          });

          trackEvent(affiliate.user_id, "affiliate_commission_credited", {
            commissionCents: commission,
            referralId: referralRow?.id,
            paymentSessionId: session.id,
          });

          logger.info("Affiliate commission credited", {
            affiliateId: affiliate.id,
            commission,
            refCode,
            route: "webhook",
          });
        }
      } catch (affiliateErr) {
        // Non-fatal — log and continue; payment already recorded above
        logger.error("Affiliate commission error", {
          error: affiliateErr instanceof Error ? affiliateErr.message : String(affiliateErr),
          refCode,
          route: "webhook",
        });
      }
    }
  }

  return NextResponse.json({ received: true });
}
