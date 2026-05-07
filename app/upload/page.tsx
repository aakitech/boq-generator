"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Footer from "@/components/Footer";
import { usePostHog } from "posthog-js/react";
import CreditBadge from "@/components/CreditBadge";
import TopUpModal from "@/components/TopUpModal";
import { useCredits } from "@/components/CreditsProvider";
import GenerateBOQTab from "@/components/upload/GenerateBOQTab";
import { RateAssumptions, DEFAULT_CONTEXT, type RateContext } from "@/components/upload/RateAssumptions";

type Tab = "generate" | "rate";

// ─── Rate Existing BOQ Tab ───────────────────────────────────────────────────

type RateStage = "idle" | "validating" | "questions" | "ready" | "submitting" | "error";

interface BOQPreview {
  totalItems: number;
  missingRateCount: number;
  rateColumnHeader: string | null;
  amountColumnHeader: string | null;
}

function RateBOQTab() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<RateStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<BOQPreview | null>(null);
  const [rateBoqId, setRateBoqId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<RateContext>(DEFAULT_CONTEXT);
  const [showTopUp, setShowTopUp] = useState(false);
  const ph = usePostHog();
  const { remainingCredits } = useCredits();

  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    const name = f.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
      setError("Please upload an Excel file (.xlsx or .xls).");
      return;
    }
    setFile(f);
    setStage("idle");
    setError(null);
    setPreview(null);
  }

  async function handleValidate() {
    if (!file) return;
    setError(null);
    setStage("validating");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/ingest-boq", { method: "POST", body: form });
      if (!res.ok) {
        const { error: e } = await res.json();
        throw new Error(e || "Validation failed");
      }
      const { preview: p, boq_id: bid } = await res.json();
      setPreview(p);
      setRateBoqId(bid ?? null);
      ph.capture("excel_boq_uploaded", { total_items: p.totalItems, missing_rate_count: p.missingRateCount });
      setStage("questions");
    } catch (err) {
      setStage("error");
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg === "Failed to fetch" ? "Network error. Check your connection and try again." : msg);
    }
  }

  function handleQuestionsSubmit() {
    localStorage.setItem("boq_rate_context", JSON.stringify(ctx));
    setStage("ready");
  }

  async function handleRate() {
    if (!rateBoqId) return;
    setStage("submitting");
    setError(null);
    try {
      const res = await fetch("/api/rate-boq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boq_id: rateBoqId, rate_context: ctx }),
      });
      if (res.status === 402) {
        setShowTopUp(true);
        setStage("ready");
        return;
      }
      if (!res.ok) {
        const { error: e } = await res.json();
        throw new Error(e || "Could not start rating job");
      }
      const { boq_id } = await res.json();
      router.push(`/generating?boq_id=${encodeURIComponent(boq_id)}`);
    } catch (err) {
      setStage("ready");
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg === "Failed to fetch" ? "Network error. Check your connection and try again." : msg);
    }
  }

  // ── Questions form ────────────────────────────────────────────────────────
  if (stage === "questions") {
    return (
      <div className="space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded border border-emerald-500/20 bg-emerald-500/8 text-emerald-400 text-xs font-medium mb-3">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
            {preview?.totalItems} items · {preview?.missingRateCount} missing rates
          </div>
          <h2 className="font-serif text-xl text-white">Tell us about the project</h2>
        </div>
        <RateAssumptions ctx={ctx} onChange={setCtx} defaultOpen />
        <button
          onClick={handleQuestionsSubmit}
          className="w-full py-3 rounded bg-[#f59e0b] hover:bg-[#fbbf24] text-black font-semibold text-sm transition-colors"
        >
          Continue →
        </button>
      </div>
    );
  }

  // ── Ready / submitting ────────────────────────────────────────────────────
  if (stage === "ready" || stage === "submitting") {
    return (
      <div className="space-y-4">
        {showTopUp && <TopUpModal onClose={() => setShowTopUp(false)} />}

        <div>
          <h2 className="font-serif text-xl text-white mb-2">Ready to rate</h2>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded border border-emerald-500/20 bg-emerald-500/8 text-emerald-400 text-xs font-medium">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
            {preview?.totalItems} items · {preview?.missingRateCount} missing rates · {ctx.province} · {ctx.marginPct}% margin
          </div>
        </div>

        {error && (
          <div className="px-4 py-3 rounded border border-red-500/20 bg-red-500/8 text-red-400 text-sm">{error}</div>
        )}

        <div className="flex items-center gap-3 px-4 py-3 rounded border border-white/8 bg-white/2">
          <div className="w-8 h-8 rounded bg-emerald-500/15 flex items-center justify-center shrink-0">
            <ExcelIcon className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-sm text-white truncate flex-1">{file?.name}</p>
          <button className="text-xs text-[#555] hover:text-white" onClick={() => setStage("questions")}>
            Edit answers
          </button>
        </div>

        {remainingCredits < 500 && (
          <div className="px-4 py-3 rounded border border-[#f59e0b]/20 bg-[#f59e0b]/5 text-xs text-[#f59e0b]">
            You need at least 500 credits to rate a BOQ.{" "}
            <button className="underline" onClick={() => setShowTopUp(true)}>Top up credits</button>
          </div>
        )}

        <button
          className="w-full py-3 rounded bg-[#f59e0b] hover:bg-[#fbbf24] text-black font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          onClick={handleRate}
          disabled={stage === "submitting" || remainingCredits < 500}
        >
          {stage === "submitting" ? (
            <>
              <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-black/50 border-t-transparent animate-spin" />
              Starting…
            </>
          ) : "Add Rates →"}
        </button>
      </div>
    );
  }

  // ── Upload screen ─────────────────────────────────────────────────────────
  const isValidating = stage === "validating";

  return (
    <>
      <div
        className={`relative rounded border-2 border-dashed transition-colors cursor-pointer p-10 text-center
          ${dragging ? "border-[#f59e0b] bg-[#f59e0b]/5" : "border-white/10 bg-white/2 hover:border-white/20 hover:bg-white/4"}`}
        onClick={() => !isValidating && fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {file ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded bg-emerald-500/15 flex items-center justify-center">
              <ExcelIcon className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <p className="font-medium text-sm text-white truncate max-w-xs">{file.name}</p>
              <p className="text-xs text-[#555] mt-1">{(file.size / 1024).toFixed(0)} KB</p>
            </div>
            {!isValidating && (
              <button
                className="text-xs text-[#555] hover:text-[#888] underline mt-1"
                onClick={(e) => { e.stopPropagation(); setFile(null); setStage("idle"); setError(null); }}
              >
                Remove
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded bg-white/5 flex items-center justify-center">
              <ExcelIcon className="w-6 h-6 text-[#555]" />
            </div>
            <div>
              <p className="text-sm text-white font-medium">Drop your BOQ Excel here</p>
              <p className="text-xs text-[#555] mt-1">Excel (.xlsx or .xls) · max 50 MB</p>
            </div>
          </div>
        )}
      </div>

      {stage === "error" && error && (
        <div className="mt-4 px-4 py-3 rounded border border-red-500/20 bg-red-500/8 text-red-400 text-sm">{error}</div>
      )}

      <button
        className={`mt-4 w-full py-3 rounded font-semibold text-sm transition-colors
          ${file && !isValidating ? "bg-[#f59e0b] hover:bg-[#fbbf24] text-black" : "bg-white/5 text-[#555] cursor-not-allowed"}`}
        disabled={!file || isValidating}
        onClick={handleValidate}
      >
        {isValidating ? (
          <span className="inline-flex items-center justify-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-black/40 border-t-transparent animate-spin" />
            Validating…
          </span>
        ) : "Continue →"}
      </button>

      <p className="mt-6 text-center text-xs text-[#444]">Excel (.xlsx or .xls) · ZMW rates calibrated to your location</p>
    </>
  );
}


// ─── Main Upload Page ────────────────────────────────────────────────────────

export default function UploadPage() {
  const [activeTab, setActiveTab] = useState<Tab>("generate");
  const { remainingCredits, loadingCredits } = useCredits();

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      <nav className="fixed top-0 left-0 right-0 z-20 border-b border-white/5 bg-[#0a0a0a]/95 backdrop-blur">
        <div className="max-w-[960px] mx-auto px-6 py-3 flex items-center justify-between">
          <a href="/" className="font-serif text-white text-lg tracking-tight">BOQ Generator</a>
          <div className="flex items-center gap-4">
            {!loadingCredits ? <CreditBadge remainingCredits={remainingCredits} /> : null}
            <a href="/dashboard" className="text-xs text-[#555] hover:text-white transition-colors">
              My BOQs
            </a>
          </div>
        </div>
      </nav>

      <main className="flex-1 flex items-center justify-center px-6 py-24">
        <div className="w-full max-w-lg animate-fade-up">
          <div className="mb-8">
            <h1 className="font-serif text-3xl text-white tracking-tight mb-1">Upload your documents</h1>
            <p className="text-sm text-[#555]">Generate a new BOQ or add rates to an existing one.</p>
          </div>

          <div className="flex rounded border border-white/8 bg-white/2 p-1 mb-6">
            <button
              className={`flex-1 py-2 px-4 rounded text-xs font-medium transition-colors ${
                activeTab === "generate" ? "bg-[#f59e0b] text-black" : "text-[#666] hover:text-white"
              }`}
              onClick={() => setActiveTab("generate")}
            >
              Generate BOQ
            </button>
            <button
              className={`flex-1 py-2 px-4 rounded text-xs font-medium transition-colors ${
                activeTab === "rate" ? "bg-[#f59e0b] text-black" : "text-[#666] hover:text-white"
              }`}
              onClick={() => setActiveTab("rate")}
            >
              Rate a BOQ
            </button>
          </div>

          {activeTab === "generate" ? <GenerateBOQTab /> : <RateBOQTab />}
        </div>
      </main>

      <Footer />
    </div>
  );
}

function ExcelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M13.125 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m13.5-1.5v1.5c0 .621-.504 1.125-1.125 1.125m-13.5 0h7.5" />
    </svg>
  );
}
