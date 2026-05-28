"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Progress } from "@/components/ui/progress";
import { usePostHog } from "posthog-js/react";
import CreditBadge from "@/components/CreditBadge";
import { useCredits } from "@/components/CreditsProvider";

function GeneratingContent() {
  const router = useRouter();
  const params = useSearchParams();
  const boqId = params.get("boq_id");
  const ph = usePostHog();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(10);
  const [statusText, setStatusText] = useState("Starting…");
  const { remainingCredits, loadingCredits } = useCredits();
  const started = useRef(false);

  async function pollBoqStatus(id: string, maxMs = 600_000): Promise<{ ok: boolean; error?: string }> {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      try {
        const res = await fetch(`/api/boqs/${id}/status`);
        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        const { processing_status, last_error } = (await res.json()) as {
          processing_status: string;
          last_error: string | null;
        };
        if (processing_status === "completed") return { ok: true };
        if (processing_status === "failed") return { ok: false, error: last_error || "Generation failed" };
      } catch {
        // network blip — keep polling
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return { ok: false, error: "Timed out waiting for BOQ. Check the dashboard." };
  }

  async function checkAgain() {
    if (!boqId) return;
    setError(null);
    setStatusText("Checking status…");
    setProgress(30);
    const result = await pollBoqStatus(boqId, 30_000);
    if (result.ok) {
      router.push(`/boq/${boqId}`);
    } else {
      setError(result.error || "Still processing. Try again in a moment.");
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function run() {
      if (!boqId) {
        setError("Missing BOQ ID. Please start over.");
        return;
      }

      setStatusText("Your BOQ is being prepared…");
      setProgress(20);

      const startedAt = Date.now();
      const progressTimer = setInterval(() => {
        setProgress((p) => (p < 90 ? p + 2 : p));
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        if (elapsed > 120) setStatusText("Still working on it. Large documents take a few minutes.");
        else if (elapsed > 30) setStatusText("Building your BOQ…");
      }, 3000);

      try {
        const result = await pollBoqStatus(boqId);
        clearInterval(progressTimer);

        if (!result.ok) throw new Error(result.error);

        setProgress(100);
        ph.capture("boq_generation_completed", { boq_id: boqId });
        localStorage.removeItem("boq_type");
        localStorage.removeItem("boq_rate_context");
        router.push(`/boq/${boqId}`);
      } catch (err) {
        clearInterval(progressTimer);
        const msg = err instanceof Error ? err.message : "Something went wrong";
        ph.capture("boq_generation_failed", { boq_id: boqId, error: msg });
        setError(msg);
      }
    }

    run();
  }, [boqId, router, ph]);

  return (
    <main className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center px-4 py-16">
      <nav className="fixed top-0 left-0 right-0 z-20 border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur">
        <div className="max-w-[960px] mx-auto px-6 py-3 flex items-center justify-between">
          <a href="/" className="font-serif text-white text-lg font-normal tracking-tight">
            BOQ Generator
          </a>
          {!loadingCredits ? <CreditBadge remainingCredits={remainingCredits} /> : null}
        </div>
      </nav>

      <div className="relative z-10 mt-14 w-full max-w-md text-center">
        {error ? (
          <div className="space-y-6">
            <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <h2 className="font-serif text-xl text-white mb-2">Something went wrong</h2>
              <p className="text-[#888] text-sm leading-relaxed">{error}</p>
            </div>
            <div className="flex items-center justify-center gap-3">
              {boqId && (
                <button
                  type="button"
                  onClick={checkAgain}
                  className="px-5 py-2.5 rounded bg-white/8 hover:bg-white/12 text-white text-sm font-medium transition-colors"
                >
                  Check Again
                </button>
              )}
              <a href="/dashboard" className="px-5 py-2.5 rounded bg-[#f59e0b] hover:bg-[#fbbf24] text-black text-sm font-semibold transition-colors">
                Go to dashboard
              </a>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="w-14 h-14 rounded-full bg-[#f59e0b]/10 border border-[#f59e0b]/20 flex items-center justify-center mx-auto animate-pulse">
              <svg className="w-6 h-6 text-[#f59e0b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div>
              <h2 className="font-serif text-2xl text-white mb-2">Preparing your BOQ</h2>
              <p className="text-[#888] text-sm">{statusText}</p>
            </div>
            <div className="space-y-3">
              <Progress value={progress} className="h-1.5 bg-white/8" />
              <div className="space-y-1">
                <p className="text-xs text-[#555]">Running in the background — you can navigate away.</p>
                <a href="/dashboard" className="text-xs text-[#f59e0b]/70 hover:text-[#f59e0b] underline underline-offset-2 transition-colors">
                  Go to dashboard →
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function GeneratingPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
          <div className="text-[#555] text-sm">Loading…</div>
        </main>
      }
    >
      <GeneratingContent />
    </Suspense>
  );
}
