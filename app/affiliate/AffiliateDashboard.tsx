"use client";

import { useState } from "react";

interface AffiliateData {
  referral_code: string;
  status: string;
  payout_email: string;
  commission_type: string;
  commission_value: number;
  total_earned_cents: number;
  total_paid_cents: number;
}

interface Stats {
  conversions: number;
  pending_commission_cents: number;
  paid_commission_cents: number;
}

interface Props {
  affiliate: AffiliateData;
  stats: Stats;
  referralUrl: string;
}

export default function AffiliateDashboard({ affiliate, stats, referralUrl }: Props) {
  const [copied, setCopied] = useState(false);

  function copyLink() {
    navigator.clipboard.writeText(referralUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const commissionLabel =
    affiliate.commission_type === "percent"
      ? `${(affiliate.commission_value / 100).toFixed(0)}%`
      : `$${(affiliate.commission_value / 100).toFixed(0)}`;

  const pendingBalance = affiliate.total_earned_cents - affiliate.total_paid_cents;

  return (
    <div className="space-y-5">
      {/* Status banner */}
      {affiliate.status === "pending" && (
        <div className="px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm">
          Your account is pending activation. Commissions will start accruing once you&apos;re approved.
        </div>
      )}
      {affiliate.status === "suspended" && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
          Your affiliate account has been suspended. Contact us to resolve this.
        </div>
      )}

      {/* Referral link */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-white">Your referral link</p>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            affiliate.status === "active"
              ? "bg-green-500/20 text-green-400"
              : affiliate.status === "pending"
              ? "bg-amber-500/20 text-amber-400"
              : "bg-red-500/20 text-red-400"
          }`}>
            {affiliate.status.charAt(0).toUpperCase() + affiliate.status.slice(1)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-sm text-amber-300 font-mono truncate flex-1 bg-white/[0.03] border border-white/10 rounded px-3 py-2">
            {referralUrl}
          </p>
          <button
            onClick={copyLink}
            className="shrink-0 px-3 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-black text-xs font-semibold transition-colors"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Commission: <span className="text-white font-medium">{commissionLabel}</span> per paid BOQ
          {affiliate.commission_type === "percent" ? " of the platform fee" : ""}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Conversions", value: String(stats.conversions) },
          { label: "Pending earnings", value: `$${(stats.pending_commission_cents / 100).toFixed(2)}` },
          { label: "Total paid out", value: `$${(affiliate.total_paid_cents / 100).toFixed(2)}` },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-center">
            <p className="text-xl font-bold text-white">{value}</p>
            <p className="text-xs text-gray-400 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Payout info */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-2">
        <p className="text-sm font-medium text-white">Payout details</p>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">Payout email</span>
          <span className="text-white font-mono text-xs">{affiliate.payout_email}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">Available balance</span>
          <span className="text-amber-400 font-semibold">${(pendingBalance / 100).toFixed(2)}</span>
        </div>
        <p className="text-xs text-gray-500 pt-1 border-t border-white/5">
          Payouts are processed manually. Contact us at{" "}
          <a href="mailto:boq-support@aakitech.com" className="text-amber-400 hover:underline">
            boq-support@aakitech.com
          </a>{" "}
          to request a payout once your balance exceeds $20.
        </p>
      </div>
    </div>
  );
}
