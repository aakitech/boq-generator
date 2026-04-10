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
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 text-left">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-white">Choose how to pay</p>
            <p className="mt-1 text-xs text-gray-400">
              {cardEnabled
                ? "You can test either manual payment or Stripe in this environments."
                : "Manual payment is the current unlock option for this BOQ for your location."}
            </p>
          </div>
          <p className="text-xl font-bold text-amber-300">{priceDisplay}</p>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <button
            type="button"
            onClick={onWhatsAppPayment}
            disabled={requesting}
            className="w-full rounded-lg bg-green-500 hover:bg-green-400 px-4 py-3 text-sm font-semibold text-black transition-colors disabled:cursor-not-allowed disabled:opacity-70"
          >
            {requesting ? "Preparing WhatsApp..." : "Chat on WhatsApp"}
          </button>

          {cardEnabled ? (
            <button
              type="button"
              onClick={onCardPayment}
              disabled={cardRequesting}
              className="w-full rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] px-4 py-3 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-70"
            >
              {cardRequesting ? "Opening Stripe..." : "Pay with Card"}
            </button>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-gray-500">
        {cardEnabled
          ? "WhatsApp opens a chat with the team. Card payment uses Stripe test checkout in local/dev."
          : "WhatsApp opens a chat with the team so payment can be confirmed before this BOQ is unlocked."}
      </p>

      {requested ? (
        <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-4 py-3 text-left">
          <p className="text-sm font-medium text-white">Waiting for payment approval</p>
          <p className="mt-1 text-xs text-gray-300">
            Once payment is confirmed and the team marks this BOQ as paid, it will unlock normally.
          </p>
          {contactLabel ? (
            <p className="mt-2 text-xs text-gray-400">WhatsApp contact: {contactLabel}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {whatsappUrl ? (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-md bg-white/10 hover:bg-white/15 px-3 py-2 text-xs font-medium text-white transition-colors"
              >
                Open WhatsApp Web
              </a>
            ) : null}
            {paymentDetails ? (
              <button
                type="button"
                onClick={handleCopyDetails}
                className="inline-flex items-center justify-center rounded-md border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] px-3 py-2 text-xs font-medium text-white transition-colors"
              >
                {copied ? "Copied payment details" : "Copy payment details"}
              </button>
            ) : null}
          </div>
          {paymentDetails ? (
            <p className="mt-2 text-xs text-gray-400">
              If WhatsApp does not open on this device, copy the payment details and send them manually.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
