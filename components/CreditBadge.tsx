"use client";

import { useState } from "react";
import TopUpModal from "@/components/TopUpModal";

type CreditBadgeProps = {
  remainingCredits: number;
  className?: string;
};

export default function CreditBadge({ remainingCredits, className = "" }: CreditBadgeProps) {
  const [showTopUp, setShowTopUp] = useState(false);
  const displayCredits = Math.max(remainingCredits, 0);
  const low = displayCredits < 500;

  return (
    <>
      <span
        className={`inline-flex items-center gap-2 rounded border px-3 py-1.5 text-xs font-mono tabular-nums ${
          low
            ? "border-red-500/30 bg-red-500/8 text-red-400"
            : "border-[#f59e0b]/25 bg-[#f59e0b]/8 text-[#f59e0b]"
        } ${className}`.trim()}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${low ? "bg-red-400" : "bg-[#f59e0b]"}`} />
        {displayCredits.toLocaleString()} credits
        <button
          type="button"
          onClick={() => setShowTopUp(true)}
          className="ml-1 text-[10px] uppercase tracking-wider opacity-60 hover:opacity-100 transition-opacity"
        >
          Top&nbsp;up
        </button>
      </span>
      {showTopUp && <TopUpModal onClose={() => setShowTopUp(false)} />}
    </>
  );
}
