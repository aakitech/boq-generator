"use client";

import ManualPaymentOptions from "@/components/ManualPaymentOptions";

interface BOQPreview {
  billCount: number;
  itemCount: number;
  tier: {
    label: string;
    displayUsd: string;
    usdCents: number;
  };
  approxRangeLabel: string;
}

interface BOQPricingCardProps {
  boqPreview: BOQPreview;
  onUnlock: () => void;
  onCardPayment?: () => void;
  paying: boolean;
  creditsRemaining?: number | null;
  paymentMode?: "stripe" | "manual_whatsapp" | "hybrid";
  manualPaymentRequested?: boolean;
  manualPaymentContact?: string | null;
  manualPaymentUrl?: string | null;
  manualPaymentDetails?: string | null;
}

export default function BOQPricingCard({
  boqPreview,
  onUnlock,
  onCardPayment,
  paying,
  creditsRemaining = 0,
  paymentMode = "stripe",
  manualPaymentRequested = false,
  manualPaymentContact,
  manualPaymentUrl,
  manualPaymentDetails,
}: BOQPricingCardProps) {
  const { billCount, itemCount, tier, approxRangeLabel } = boqPreview;
  const safeCreditsRemaining = creditsRemaining ?? 0;
  const hasFreeCredits = safeCreditsRemaining > 0;
  const usesManualPayment = !hasFreeCredits && paymentMode !== "stripe";
  const hasStripeOption = !hasFreeCredits && paymentMode === "hybrid";

  return (
    <div className="text-center space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight mb-3">Your BOQ is ready</h2>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-medium">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
          </svg>
          {billCount} {billCount === 1 ? "bill" : "bills"} · {itemCount} line items
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 text-left space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-white font-semibold">
              {hasFreeCredits ? "Unlock with credits" : usesManualPayment ? "Manual payment" : "Unlock BOQ"}
            </p>
            {!hasFreeCredits && !usesManualPayment && (
              <p className="text-xs text-gray-400 mt-0.5">{approxRangeLabel}</p>
            )}
          </div>
          <p className={hasFreeCredits ? "text-sm font-semibold text-amber-300" : "text-2xl font-bold text-amber-400"}>
            {hasFreeCredits ? `${safeCreditsRemaining.toLocaleString()} credits` : tier.displayUsd}
          </p>
        </div>
      </div>

      {usesManualPayment ? (
        <ManualPaymentOptions
          priceDisplay={tier.displayUsd}
          onWhatsAppPayment={onUnlock}
          requesting={paying}
          requested={manualPaymentRequested}
          contactLabel={manualPaymentContact}
          whatsappUrl={manualPaymentUrl}
          paymentDetails={manualPaymentDetails}
          onCardPayment={onCardPayment}
          cardEnabled={hasStripeOption}
          cardRequesting={paying}
        />
      ) : (
        <button
          className="w-full py-3.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-semibold text-sm transition-colors disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          onClick={onUnlock}
          disabled={paying}
        >
          {paying ? (
            <>
              <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-black/60 border-t-transparent animate-spin" />
              {hasFreeCredits ? "Unlocking…" : "Opening checkout…"}
            </>
          ) : (
            hasFreeCredits ? "Unlock →" : `Unlock — ${tier.displayUsd} →`
          )}
        </button>
      )}
    </div>
  );
}
