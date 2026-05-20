"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useCredits } from "@/components/CreditsProvider";

const TOPUP_OPTIONS = [
  { usd: 20,   credits: 500,   label: "$20",    note: "1 rated BOQ or 1 generate job (up to 5 docs)",    badge: null },
  { usd: 50,   credits: 1250,  label: "$50",    note: "2–3 rated BOQs or 1 generate job with drawings",  badge: null },
  { usd: 100,  credits: 2500,  label: "$100",   note: "5+ rated BOQs or large generate jobs",            badge: null },
  { usd: 500,  credits: 14000, label: "$500",   note: "Firm pack — 28 rated BOQs or 5+ generate jobs",   badge: "10% off" },
  { usd: 1000, credits: 30000, label: "$1,000", note: "Enterprise — 60 rated BOQs or 12+ generate jobs", badge: "17% off" },
];

type TopUpState = "pick" | "instructions";

interface TopUpResult {
  reference: string;
  amount_usd: number;
  credits_to_grant: number;
  momo_number: string | null;
  airtel_number: string | null;
  bank_details: string | null;
  whatsapp_url: string | null;
}

function TopUpModalContent({ onClose }: { onClose: () => void }) {
  const { refreshCredits } = useCredits();
  const [state, setState] = useState<TopUpState>("pick");
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TopUpResult | null>(null);
  const [copied, setCopied] = useState(false);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  async function handleConfirm() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_usd: selected }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to create top-up request");
      setResult(body as TopUpResult);
      setState("instructions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function copyRef() {
    if (!result) return;
    await navigator.clipboard.writeText(result.reference);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDone() {
    refreshCredits();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)" }}
    >
      {/* Backdrop click to close */}
      <div className="absolute inset-0" onClick={onClose} />

      <div
        className="relative w-full max-w-[480px] rounded-[10px] overflow-hidden"
        style={{ background: "#111", border: "1px solid #262626" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #262626" }}>
          <h2 className="font-serif text-[20px] font-normal text-[#f5f5f5]">Top up credits</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[#404040] hover:text-[#f5f5f5] transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          {state === "pick" && (
            <div className="space-y-4">
              <p className="text-[13px] text-[#737373]">
                Choose an amount. Credits are added to your account once payment is confirmed.
              </p>

              {/* Entry tiers — compact 3-column grid */}
              <div className="grid grid-cols-3 gap-2">
                {TOPUP_OPTIONS.filter((o) => !o.badge).map((opt) => (
                  <button
                    key={opt.usd}
                    type="button"
                    onClick={() => setSelected(opt.usd)}
                    className="flex flex-col px-3 py-3 rounded text-left transition-colors"
                    style={{
                      border: selected === opt.usd ? "1px solid #f59e0b" : "1px solid #262626",
                      background: selected === opt.usd ? "rgba(245,158,11,0.08)" : "#1a1a1a",
                    }}
                  >
                    <span className="font-mono text-[20px] font-medium text-[#f5f5f5] leading-none mb-1">{opt.label}</span>
                    <span className="font-mono text-[11px] text-[#f59e0b] mb-1">{opt.credits.toLocaleString()} cr</span>
                    <span className="text-[10px] text-[#525252] leading-snug">{opt.note}</span>
                  </button>
                ))}
              </div>

              {/* Firm & Enterprise separator */}
              <div className="flex items-center gap-3 pt-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#404040]">Firm &amp; Enterprise</span>
                <div className="flex-1 h-px bg-[#262626]" />
              </div>

              {/* Firm/Enterprise tiers — full-width rows */}
              <div className="space-y-2">
                {TOPUP_OPTIONS.filter((o) => o.badge).map((opt) => (
                  <button
                    key={opt.usd}
                    type="button"
                    onClick={() => setSelected(opt.usd)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded text-left transition-colors"
                    style={{
                      border: selected === opt.usd ? "1px solid #f59e0b" : "1px solid #262626",
                      background: selected === opt.usd ? "rgba(245,158,11,0.08)" : "#1a1a1a",
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-[18px] font-medium text-[#f5f5f5] flex-shrink-0">{opt.label}</span>
                      <div className="min-w-0">
                        <span className="font-mono text-[11px] text-[#f59e0b]">{opt.credits.toLocaleString()} credits</span>
                        <span className="block text-[10px] text-[#525252] leading-snug truncate">{opt.note}</span>
                      </div>
                    </div>
                    <span className="flex-shrink-0 ml-3 font-mono text-[10px] uppercase tracking-wide text-[#f59e0b] bg-[#f59e0b]/10 px-1.5 py-0.5 rounded">
                      {opt.badge}
                    </span>
                  </button>
                ))}
              </div>

              {error && (
                <p className="text-[12px] text-[#ef4444]">{error}</p>
              )}

              <button
                type="button"
                onClick={handleConfirm}
                disabled={!selected || loading}
                className="w-full py-3 rounded text-[13px] font-semibold transition-colors"
                style={{
                  background: selected && !loading ? "#f59e0b" : "#1a1a1a",
                  color: selected && !loading ? "#000" : "#404040",
                  cursor: selected && !loading ? "pointer" : "not-allowed",
                  border: selected && !loading ? "none" : "1px solid #262626",
                }}
              >
                {loading ? "Creating request…" : "Continue →"}
              </button>
            </div>
          )}

          {state === "instructions" && result && (
            <div className="space-y-4">
              <p className="text-[13px] text-[#737373]">
                Send <span className="text-[#f5f5f5] font-medium">${result.amount_usd}</span> using one of the methods below. Use your reference number as the payment description.
              </p>

              {/* Reference */}
              <div className="px-4 py-3 rounded" style={{ border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.06)" }}>
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#737373] mb-1">Reference number</p>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[#f59e0b] text-[20px] font-medium tracking-widest">{result.reference}</span>
                  <button
                    type="button"
                    onClick={copyRef}
                    className="text-[12px] px-3 py-1 rounded transition-colors"
                    style={{ border: "1px solid #262626", color: copied ? "#22c55e" : "#737373", background: "#1a1a1a" }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>

              {result.momo_number && (
                <div className="px-4 py-3 rounded" style={{ border: "1px solid #262626", background: "#1a1a1a" }}>
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#404040] mb-1">MTN MoMo</p>
                  <p className="font-mono text-[15px] text-[#f5f5f5]">{result.momo_number}</p>
                </div>
              )}

              {result.airtel_number && (
                <div className="px-4 py-3 rounded" style={{ border: "1px solid #262626", background: "#1a1a1a" }}>
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#404040] mb-1">Airtel Money</p>
                  <p className="font-mono text-[15px] text-[#f5f5f5]">{result.airtel_number}</p>
                </div>
              )}

              {result.bank_details && (
                <div className="px-4 py-3 rounded" style={{ border: "1px solid #262626", background: "#1a1a1a" }}>
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#404040] mb-1">Bank Transfer</p>
                  <p className="text-[13px] text-[#f5f5f5] leading-relaxed">{result.bank_details}</p>
                </div>
              )}

              {result.whatsapp_url && (
                <a
                  href={result.whatsapp_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 rounded text-[13px] font-medium transition-colors"
                  style={{ border: "1px solid #262626", background: "#1a1a1a", color: "#f5f5f5" }}
                >
                  <svg className="w-4 h-4" style={{ color: "#22c55e" }} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.554 4.122 1.524 5.857L.057 23.882l6.188-1.44A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.687-.507-5.224-1.39l-.374-.222-3.876.902.938-3.77-.244-.388A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                  </svg>
                  Send payment proof on WhatsApp
                </a>
              )}

              <div className="pt-3" style={{ borderTop: "1px solid #262626" }}>
                <p className="text-[12px] text-[#404040] mb-3">Credits are added within a few hours after we confirm your payment.</p>
                <button
                  type="button"
                  onClick={handleDone}
                  className="w-full py-2.5 rounded text-[13px] font-medium transition-colors"
                  style={{ background: "#f59e0b", color: "#000" }}
                >
                  Done — I&apos;ll send payment now
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TopUpModal({ onClose }: { onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return createPortal(<TopUpModalContent onClose={onClose} />, document.body);
}
