"use client";

import { useState } from "react";

interface ManualPaymentOptionsProps {
  priceDisplay: string;
  onWhatsAppPayment: () => void;
  requesting: boolean;
  requested: boolean;
  contactLabel?: string | null;
  whatsappUrl?: string | null;
  paymentDetails?: string | null;
  onCardPayment?: () => void;
  cardEnabled?: boolean;
  cardRequesting?: boolean;
}

export default function ManualPaymentOptions({
  priceDisplay,
  onWhatsAppPayment,
  requesting,
  requested,
  contactLabel,
  whatsappUrl,
  paymentDetails,
  onCardPayment,
  cardEnabled = false,
  cardRequesting = false,
}: ManualPaymentOptionsProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopyDetails() {
    if (!paymentDetails) return;
    try {
      await navigator.clipboard.writeText(paymentDetails);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-left space-y-3">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold text-white">Pay via WhatsApp</p>
          <p className="text-xl font-bold text-amber-300">{priceDisplay}</p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onWhatsAppPayment}
            disabled={requesting}
            className="w-full rounded-lg bg-green-500 hover:bg-green-400 px-4 py-3 text-sm font-semibold text-black transition-colors disabled:cursor-not-allowed disabled:opacity-70"
          >
            {requesting ? "Opening WhatsApp…" : "Chat on WhatsApp"}
          </button>

          {cardEnabled ? (
            <button
              type="button"
              onClick={onCardPayment}
              disabled={cardRequesting}
              className="w-full rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] px-4 py-3 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-70"
            >
              {cardRequesting ? "Opening Stripe…" : "Pay with Card"}
            </button>
          ) : null}
        </div>
      </div>

      {requested ? (
        <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-4 py-3 text-left space-y-2">
          <p className="text-sm font-medium text-white">Awaiting payment confirmation</p>
          {contactLabel ? (
            <p className="text-xs text-gray-400">WhatsApp: {contactLabel}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {whatsappUrl ? (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-md bg-white/10 hover:bg-white/15 px-3 py-2 text-xs font-medium text-white transition-colors"
              >
                Open WhatsApp
              </a>
            ) : null}
            {paymentDetails ? (
              <button
                type="button"
                onClick={handleCopyDetails}
                className="inline-flex items-center justify-center rounded-md border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] px-3 py-2 text-xs font-medium text-white transition-colors"
              >
                {copied ? "Copied!" : "Copy payment details"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
