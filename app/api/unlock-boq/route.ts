import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureProfileExists } from "@/lib/supabase/ensure-profile";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";
import { consumeFreeBoqCredit, getRemainingCredits } from "@/lib/credits";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { session_id, boq_id, use_credit } = (await req.json()) as {
      session_id?: string;
      boq_id?: string;
      use_credit?: boolean;
    };

    if (!session_id && !use_credit) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    if (use_credit && !boq_id) {
      return NextResponse.json({ error: "boq_id is required for credit unlock" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let stripeSessionId: string | null = null;
    let boqId = boq_id ?? null;

    if (!use_credit) {
      const stripeSession = await getStripe().checkout.sessions.retrieve(session_id!);
      if (stripeSession.payment_status !== "paid") {
        return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
      }

      stripeSessionId = stripeSession.id;
      boqId = stripeSession.metadata?.boq_id ?? null;
      if (!boqId) {
        return NextResponse.json({ error: "No BOQ linked to this session" }, { status: 404 });
      }
    }

    const serviceClient = createServiceClient();
    await ensureProfileExists(serviceClient, user);

    const { data: boqRow, error: fetchError } = await serviceClient
      .from("boqs")
      .select("id, data, payment_status, user_id")
      .eq("id", boqId)
      .single();

    if (fetchError || !boqRow) {
      logger.error("Failed to fetch BOQ in unlock", { boqId, error: String(fetchError), route: "unlock-boq" });
      return NextResponse.json({ error: "BOQ not found" }, { status: 404 });
    }

    if (boqRow.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (use_credit) {
      if (boqRow.payment_status === "paid") {
        const remainingCredits = await getRemainingCredits(serviceClient, user.id);
        return NextResponse.json({
          boq: boqRow.data,
          boq_id: boqRow.id,
          remainingCredits,
        });
      }

      const creditResult = await consumeFreeBoqCredit(serviceClient, {
        userId: user.id,
        reason: "generate_boq",
        referenceType: "boq",
        referenceId: boqId!,
      });

      if (creditResult.status === "insufficient") {
        return NextResponse.json(
          { error: "No free BOQs remaining", remainingCredits: 0 },
          { status: 402 }
        );
      }

      if (boqRow.payment_status === "preview") {
        const { error: updateError } = await serviceClient
          .from("boqs")
          .update({ payment_status: "paid" })
          .eq("id", boqId);

        if (updateError) {
          logger.error("Failed to mark BOQ as paid after credit unlock", {
            boqId,
            error: String(updateError),
            route: "unlock-boq",
          });
          return NextResponse.json(
            { error: "Failed to unlock BOQ. Please try again." },
            { status: 500 }
          );
        }
      }

      trackEvent(user.id, "credit_consumed", {
        reason: "generate_boq",
        boqId,
        remainingCredits: creditResult.remainingCredits,
      });
      trackEvent(user.id, "boq_unlocked", { boqId, unlockType: "credit" });

      return NextResponse.json({
        boq: boqRow.data,
        boq_id: boqRow.id,
        remainingCredits: creditResult.remainingCredits,
      });
    }

    const stripeSession = await getStripe().checkout.sessions.retrieve(session_id!);

    if (boqRow.payment_status === "preview") {
      const { error: updateError } = await serviceClient
        .from("boqs")
        .update({ payment_status: "paid", stripe_session_id: session_id! })
        .eq("id", boqId);

      if (updateError) {
        logger.error("Failed to mark BOQ as paid in unlock", { boqId, error: String(updateError), route: "unlock-boq" });
      }

      await serviceClient.from("payments").upsert(
        {
          stripe_session_id: session_id!,
          stripe_payment_intent: stripeSession.payment_intent as string | null,
          user_id: user.id,
          amount_cents: stripeSession.amount_total ?? 2000,
          currency: stripeSession.currency ?? "usd",
          status: "completed",
          boq_id: boqId,
        },
        { onConflict: "stripe_session_id", ignoreDuplicates: false }
      );
    }

    trackEvent(user.id, "boq_unlocked", { boqId, sessionId: stripeSessionId });

    return NextResponse.json({ boq: boqRow.data, boq_id: boqRow.id });
  } catch (err) {
    logger.error("unlock-boq error", { error: err instanceof Error ? err.message : String(err), route: "unlock-boq" });
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
