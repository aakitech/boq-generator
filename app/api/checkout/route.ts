import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureProfileExists } from "@/lib/supabase/ensure-profile";
import { getTierForAmount, getTierForItemCount, loadTiers, loadRateTiers } from "@/lib/pricing";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const shouldForceManualPayment = process.env.NODE_ENV === "production";
    const paymentProvider =
      process.env.PAYMENT_PROVIDER === "manual_whatsapp" || process.env.NEXT_PUBLIC_PAYMENT_PROVIDER === "manual_whatsapp"
        ? "manual_whatsapp"
        : "stripe";

    if (shouldForceManualPayment && paymentProvider === "manual_whatsapp") {
      return NextResponse.json(
        { error: "Card and mobile payment are coming soon. Please use manual payment for now." },
        { status: 409 }
      );
    }

    const body = (await req.json()) as {
      boq_id?: string;
      type?: "generate_boq" | "rate_boq";
      // Legacy rate_boq fields kept for backward compat
      storageKey?: string;
      rateColHeader?: string;
      amountColHeader?: string;
      // Legacy generate_boq field
      filename?: string;
    };
    const { boq_id, type = "generate_boq" } = body;
    const origin = req.headers.get("origin") || "http://localhost:3001";

    // Get authenticated user
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isRateBoq = type === "rate_boq";
    const serviceClient = createServiceClient();
    await ensureProfileExists(serviceClient, user);

    let amountCents: number;
    const metadata: Record<string, string> = { user_id: user.id, type };

    if (boq_id) {
      // New flow: boq_id provided — fetch preview BOQ to derive price
      const { data: previewBoq, error: fetchError } = await serviceClient
        .from("boqs")
        .select("id, payment_status, grand_total_zmw, source_excel_key, rate_col_header, amount_col_header, data")
        .eq("id", boq_id)
        .eq("user_id", user.id)
        .single();

      if (fetchError || !previewBoq) {
        return NextResponse.json({ error: "BOQ not found" }, { status: 404 });
      }

      if (previewBoq.payment_status === "paid") {
        return NextResponse.json({ error: "This BOQ has already been paid for" }, { status: 409 });
      }

      if (isRateBoq) {
        // Price by item count (no rates yet) — count items in the preview data if available,
        // otherwise fall back to the tier stored at ingest time
        const data = previewBoq.data as { bills?: Array<{ items?: Array<{ is_header?: boolean }> }> } | null;
        const itemCount = data?.bills
          ? data.bills.flatMap((b) => b.items ?? []).filter((i) => !i.is_header).length
          : 0;
        const rateTier = getTierForItemCount(itemCount, loadRateTiers());
        amountCents = rateTier.usdCents;

        // Pass storage key through metadata for rate-boq to download the Excel
        if (previewBoq.source_excel_key) metadata.storage_key = previewBoq.source_excel_key;
        if (previewBoq.rate_col_header) metadata.rate_col_header = previewBoq.rate_col_header;
        if (previewBoq.amount_col_header) metadata.amount_col_header = previewBoq.amount_col_header;
      } else {
        // Price by grand total ZMW
        const zmw = previewBoq.grand_total_zmw ? Number(previewBoq.grand_total_zmw) : 0;
        const tier = getTierForAmount(zmw, loadTiers());
        amountCents = tier.usdCents;
      }

      metadata.boq_id = boq_id;
    } else {
      // Legacy fallback (no boq_id) — keep old behavior for any in-flight sessions
      logger.warn("Checkout called without boq_id; using legacy flat rate", { route: "checkout", type });
      amountCents = 10000; // $100 flat

      if (isRateBoq) {
        const { storageKey, rateColHeader, amountColHeader } = body;
        if (!storageKey) {
          return NextResponse.json({ error: "storageKey is required for rate_boq" }, { status: 400 });
        }
        metadata.storage_key = storageKey;
        if (rateColHeader) metadata.rate_col_header = rateColHeader;
        if (amountColHeader) metadata.amount_col_header = amountColHeader;
      }
    }

    // Read referral code from cookie — pass through to webhook
    const refCode = req.cookies.get("ref_code")?.value;
    if (refCode) {
      metadata.ref_code = refCode;
    }

    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      customer_email: user.email ?? undefined,
      metadata,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: isRateBoq ? "BOQ Rate Filling" : "BOQ Generation",
              description: isRateBoq
                ? "AI fills missing rates in your existing Bill of Quantities"
                : "AI-generated Bill of Quantities for your project",
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/generating?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/upload`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    logger.error("Checkout session error", { error: err instanceof Error ? err.message : String(err), route: "checkout" });
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
