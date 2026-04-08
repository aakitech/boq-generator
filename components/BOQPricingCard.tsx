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
}: BOQPricingCardProps) {
  const { billCount, itemCount, tier, approxRangeLabel } = boqPreview;
  const hasFreeCredits = (creditsRemaining ?? 0) > 0;
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

      <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white/[0.03] border border-white/10 text-left">
        <div className="w-8 h-8 rounded bg-white/10 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <div>
          <p className="text-sm text-white font-medium">
            {hasFreeCredits ? "Unlock with a free BOQ credit" : "Content locked until payment"}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {hasFreeCredits
              ? `${creditsRemaining} free BOQ${creditsRemaining === 1 ? "" : "s"} left on your account.`
              : "Item descriptions, quantities, and rates are hidden."}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 text-left space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300">
                {hasFreeCredits ? "Free Trial" : usesManualPayment ? "Manual Payment" : `${tier.label} Project`}
              </span>
            </div>
            <p className="text-white font-semibold text-lg">
              {hasFreeCredits ? "Use 1 free BOQ credit" : usesManualPayment ? "Request manual payment" : "Unlock BOQ"}
            </p>
            <p className="text-gray-400 text-sm mt-0.5">
              {hasFreeCredits
                ? "Start testing now. Pay only after your free BOQs are used."
                : usesManualPayment
                  ? "Chat with our team on WhatsApp, complete payment, then we will unlock this BOQ."
                  : "One-time instant access"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-amber-400">{hasFreeCredits ? "Free" : tier.displayUsd}</p>
            <p className="text-xs text-gray-500">{hasFreeCredits ? `${creditsRemaining} left` : "USD"}</p>
          </div>
        </div>

        <div className="rounded-lg bg-white/[0.03] border border-white/10 px-3 py-2 text-xs text-gray-400">
          {hasFreeCredits ? (
            <>This BOQ will use <span className="text-gray-200 font-medium">1 free credit</span> from your account.</>
          ) : usesManualPayment ? (
            <>Quoted unlock price: <span className="text-gray-200 font-medium">{tier.displayUsd}</span>. Access opens after manual payment is confirmed.</>
          ) : (
            <>Estimated project value: <span className="text-gray-200 font-medium">{approxRangeLabel}</span></>
          )}
        </div>

        <ul className="space-y-2">
          {[
            "Full BOQ with all bill sections and line items",
            "Editable table - adjust quantities and descriptions",
            "Download .xlsx in Southern African tender format",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-gray-300">
              <svg className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
              </svg>
              {item}
            </li>
          ))}
        </ul>
      </div>

      {usesManualPayment ? (
        <ManualPaymentOptions
          priceDisplay={tier.displayUsd}
          onWhatsAppPayment={onUnlock}
          requesting={paying}
          requested={manualPaymentRequested}
          contactLabel={manualPaymentContact}
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
              {hasFreeCredits ? "Unlocking with free credit..." : "Opening secure checkout..."}
            </>
          ) : (
            hasFreeCredits ? "Use 1 Free BOQ ->" : `Unlock & Download - ${tier.displayUsd} ->`
          )}
        </button>
      )}

      <p className="text-xs text-gray-600">
        {hasFreeCredits
          ? `Free credits apply first. ${paymentMode === "stripe" ? "Stripe checkout" : paymentMode === "hybrid" ? "manual payment or Stripe" : "manual payment options"} appear only after your free BOQs are exhausted.`
          : usesManualPayment
            ? "Manual payment is confirmed by our team before this BOQ is unlocked."
            : "Secure payment via Stripe. You will be redirected back after payment."}
      </p>
    </div>
  );
}
