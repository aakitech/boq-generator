"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface WelcomeModalProps {
  onClose: () => void;
  onTopUp: () => void;
}

function WelcomeModalContent({ onClose, onTopUp }: WelcomeModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  function handleTopUp() {
    onClose();
    onTopUp();
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)" }}
    >
      <div className="absolute inset-0" onClick={onClose} />

      <div
        className="relative w-full max-w-[440px] rounded-[10px] overflow-hidden"
        style={{ background: "#111", border: "1px solid #262626" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Amber rule at top */}
        <div style={{ height: 3, background: "#f59e0b" }} />

        <div className="px-6 pt-6 pb-6 space-y-5">
          {/* Heading */}
          <div>
            <h2 className="font-serif text-[22px] font-normal text-[#f5f5f5] leading-tight">
              You&apos;re in.
            </h2>
            <p className="mt-2 text-[13px] text-[#737373] leading-relaxed">
              We&apos;ve added <span className="text-[#f5f5f5] font-medium">1,000 starter credits</span> to your account — enough for roughly 2 BOQs.
            </p>
          </div>

          {/* Credit display */}
          <div
            className="flex items-center justify-between px-4 py-3 rounded"
            style={{ border: "1px solid rgba(245,158,11,0.25)", background: "rgba(245,158,11,0.06)" }}
          >
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#737373] mb-0.5">Starter credits</p>
              <p className="font-mono text-[22px] font-medium text-[#f59e0b] tabular-nums">1,000</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-[#404040]">~2 BOQs</p>
            </div>
          </div>

          {/* How credits work */}
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#404040]">How credits work</p>
            <div className="space-y-1.5">
              {[
                "Each BOQ costs 500–2,500 credits depending on document size",
                "Credits are deducted after a successful generation",
                "Top up anytime — no subscription required",
              ].map((line) => (
                <div key={line} className="flex items-start gap-2">
                  <span className="mt-[3px] w-1 h-1 rounded-full bg-[#404040] shrink-0" />
                  <p className="text-[12px] text-[#737373] leading-relaxed">{line}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1">
            <a
              href="/upload"
              onClick={onClose}
              className="w-full py-3 rounded text-[13px] font-semibold text-center transition-colors bg-[#f59e0b] hover:bg-[#fbbf24] text-black"
            >
              Start generating →
            </a>
            <button
              type="button"
              onClick={handleTopUp}
              className="w-full py-2.5 rounded text-[13px] font-medium transition-colors border border-[#262626] bg-transparent text-[#737373] hover:text-[#f5f5f5] hover:bg-[#1a1a1a]"
            >
              Top up credits first
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WelcomeModal({ onClose, onTopUp }: WelcomeModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return createPortal(
    <WelcomeModalContent onClose={onClose} onTopUp={onTopUp} />,
    document.body
  );
}
