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
  const sessionId = params.get("session_id");
  const resumeBoqId = params.get("boq_id");
  const ph = usePostHog();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(10);
  const [statusText, setStatusText] = useState("Verifying payment and preparing your BOQ...");
  const [isRateBoq, setIsRateBoq] = useState(false);
  const [isCheckingSavedBoq, setIsCheckingSavedBoq] = useState(false);
  const { remainingCredits, loadingCredits } = useCredits();
  const started = useRef(false);

  type RecoveryState = {
    boq_id: string | null;
    payment_status: string | null;
    processing_status: string | null;
    last_error: string | null;
  };

  async function recoverBySession(currentSessionId: string): Promise<RecoveryState | null> {
    try {
      const res = await fetch(`/api/boqs/by-session?session_id=${encodeURIComponent(currentSessionId)}`);
      if (!res.ok) return null;
      const body = (await res.json()) as RecoveryState;
      return body;
    } catch {
      return null;
    }
  }

  async function waitForCompletedBoq(
    currentSessionId: string,
    options?: { attempts?: number; delayMs?: number }
  ): Promise<RecoveryState | null> {
    const attempts = options?.attempts ?? 30;
    const delayMs = options?.delayMs ?? 2000;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const state = await recoverBySession(currentSessionId);
      if (state?.boq_id && state.processing_status === "completed") return state;
      if (state?.boq_id && state.processing_status === "failed") return state;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return null;
  }

  async function checkAgainForSavedBoq() {
    if (resumeBoqId) {
      router.replace(`/generating?boq_id=${resumeBoqId}`);
      return;
    }
    if (!sessionId) return;
    setIsCheckingSavedBoq(true);
    setStatusText("Checking again for a completed BOQ...");
    const recovered = await waitForCompletedBoq(sessionId, { attempts: 10, delayMs: 2000 });
    if (recovered?.boq_id && recovered.processing_status === "completed") {
      router.push(`/boq/${recovered.boq_id}`);
      return;
    }
    setStatusText("Generation stopped due to an error.");
    setIsCheckingSavedBoq(false);
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function unlock() {
      if (!sessionId && !resumeBoqId) {
        setError("Missing payment session. Please start over.");
        return;
      }

      if (resumeBoqId) {
        setIsRateBoq(true);
      } else {
        const recovered = await recoverBySession(sessionId!);
        if (recovered?.boq_id && recovered.processing_status === "completed") {
          router.push(`/boq/${recovered.boq_id}`);
          return;
        }
      }

      const boqType = resumeBoqId ? "rate_boq" : (localStorage.getItem("boq_type") ?? "generate");
      const isRateBoqValue = boqType === "rate_boq";
      setIsRateBoq(isRateBoqValue);

      let progressTimer: ReturnType<typeof setInterval> | null = null;

      try {
        const startedAt = Date.now();
        progressTimer = setInterval(() => {
          setProgress((p) => (p < 94 ? p + 3 : p));
          const elapsed = Math.floor((Date.now() - startedAt) / 1000);
          if (elapsed > 90) {
            setStatusText(
              isRateBoqValue
                ? "Still filling rates. Large BOQs can take several minutes."
                : "Still building your BOQ. Large document bundles can take several minutes."
            );
          } else if (elapsed > 30) {
            setStatusText(
              isRateBoqValue
                ? "Saving your rated BOQ and preparing your export..."
                : "Saving your BOQ and preparing it for review..."
            );
          } else if (elapsed > 8) {
            setStatusText(
              isRateBoqValue
                ? "Reading workbook structure and filling missing rates..."
                : "Finalising your BOQ..."
            );
          }
        }, 2000);

        setProgress(30);

        let res: Response;

        if (resumeBoqId) {
          setStatusText("Resuming your paid BOQ and filling in rates...");
          res = await fetch(`/api/boqs/${resumeBoqId}/resume`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
        } else if (isRateBoqValue) {
          setStatusText("AI is parsing your BOQ and filling in rates...");
          const rateContextRaw = localStorage.getItem("boq_rate_context");
          const rateContext = rateContextRaw ? JSON.parse(rateContextRaw) : undefined;
          res = await fetch("/api/rate-boq", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId, rate_context: rateContext }),
          });
        } else {
          // generate_boq: BOQ was already generated before payment.
          // Just verify payment and unlock the saved preview.
          setStatusText("Verifying payment and unlocking your BOQ...");
          res = await fetch("/api/unlock-boq", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId }),
          });
        }

        setProgress(80);

        if (!res.ok) {
          let e: string | undefined;
          try {
            const body = await res.json();
            e = body.error;
          } catch {
            // Non-JSON error body
          }
          if (res.status === 402)
            throw new Error("Payment could not be verified. Please contact support.");
          if (res.status === 429)
            throw new Error("AI quota exceeded. Please try again in a minute.");
          if (res.status === 503)
            throw new Error("AI service is temporarily busy. Your payment is still attached to this BOQ, and you can resume it from the dashboard without paying again.");
      if (res.status === 504 || !e)
        throw new Error(
          "This is taking longer than expected. We are checking whether your BOQ finished in the background."
        );
          throw new Error(e || (isRateBoqValue ? "Rate filling failed" : "Could not unlock BOQ"));
        }

        const { boq, boq_id } = await res.json();
        setProgress(100);

        ph.capture(isRateBoqValue ? "boq_rates_filled" : "boq_unlocked", {
          boq_id,
          bill_count: boq?.bills?.length ?? 0,
          item_count: (boq?.bills ?? []).reduce(
            (s: number, b: { items?: unknown[] }) => s + (b.items?.length ?? 0),
            0
          ),
        });

        localStorage.removeItem("boq_type");
        localStorage.removeItem("boq_text");
        localStorage.removeItem("boq_document_bundle");
        localStorage.removeItem("boq_suggest_rates");
        localStorage.removeItem("boq_is_sow");
        localStorage.removeItem("boq_sow_warning");
        localStorage.removeItem("boq_sow_confidence");
        localStorage.removeItem("boq_document_type");
        localStorage.removeItem("boq_should_block_generation");
        localStorage.removeItem("boq_positive_signals");
        localStorage.removeItem("boq_negative_signals");
        localStorage.removeItem("boq_sow_flags");
        localStorage.removeItem("boq_required_attachments");
        localStorage.removeItem("boq_source_bundle_status");
        localStorage.removeItem("boq_rate_context");

        if (boq_id) {
          router.push(`/boq/${boq_id}`);
        } else {
          localStorage.setItem("boq_data", JSON.stringify(boq));
          router.push("/boq");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        setIsCheckingSavedBoq(true);
        setStatusText("Checking whether your BOQ finished in the background...");
        const recovered = sessionId ? await waitForCompletedBoq(sessionId) : null;
        if (recovered?.boq_id && recovered.processing_status === "completed") {
          router.push(`/boq/${recovered.boq_id}`);
          return;
        }
        setStatusText("Generation stopped due to an error.");
        setIsCheckingSavedBoq(false);
        setError(
          msg === "Failed to fetch"
            ? "The connection dropped while the BOQ was generating. Your payment is still attached to this BOQ, and you can resume it later from the dashboard."
            : msg
        );
      } finally {
        if (progressTimer) clearInterval(progressTimer);
      }
    }

    unlock();
  }, [resumeBoqId, sessionId, router]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      <nav className="fixed top-0 left-0 right-0 z-20 border-b border-white/5 bg-[#0f0f0f]/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <a href="/">
            <img src="/boqlogo.png" alt="BOQ Generator" className="h-7 w-auto" width="28" height="28" />
          </a>
          {!loadingCredits ? <CreditBadge remainingCredits={remainingCredits} /> : null}
        </div>
      </nav>

      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-amber-500/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 mt-14 w-full max-w-md text-center">
        {error ? (
          <div className="space-y-6">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
              <svg
                className="w-8 h-8 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Something went wrong</h2>
              <p className="text-gray-400 text-sm leading-relaxed">{error}</p>
            </div>
            <div className="flex items-center justify-center gap-3">
              {sessionId || resumeBoqId ? (
                <button
                  type="button"
                  onClick={checkAgainForSavedBoq}
                  disabled={isCheckingSavedBoq}
                  className="inline-block px-6 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
                >
                  {isCheckingSavedBoq ? "Checking..." : "Check Again"}
                </button>
              ) : null}
              <a
                href="/dashboard"
                className="inline-block px-6 py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-semibold text-sm transition-colors"
              >
                Go to dashboard
              </a>
            </div>
            <p className="text-xs text-gray-500">
              Your payment stays attached to this BOQ. You can resume from the dashboard without paying again.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto animate-pulse">
              <svg
                className="w-8 h-8 text-amber-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Preparing your BOQ</h2>
              <p className="text-gray-400 text-sm">{statusText}</p>
            </div>
            {/* Step tracker */}
            {(() => {
              const steps = [
                { label: "Payment verified", done: progress >= 30, active: progress < 30 },
                { label: isRateBoq ? "Filling in market rates" : "Building your BOQ", done: progress >= 80, active: progress >= 30 && progress < 80 },
                { label: "Finalising", done: progress >= 100, active: progress >= 80 && progress < 100 },
              ];
              return (
                <div className="flex items-center justify-center gap-3">
                  {steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        {step.done ? (
                          <span className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center shrink-0">
                            <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          </span>
                        ) : step.active ? (
                          <span className="w-5 h-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0" />
                        ) : (
                          <span className="w-5 h-5 rounded-full border border-white/20 bg-white/5 shrink-0" />
                        )}
                        <span className={`text-xs ${step.done ? "text-amber-300" : step.active ? "text-white" : "text-gray-600"}`}>
                          {step.label}
                        </span>
                      </div>
                      {i < steps.length - 1 && (
                        <span className="w-6 h-px bg-white/15 shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
            <div className="space-y-2">
              <Progress value={progress} className="h-2 bg-white/10" />
            <p className="text-xs text-gray-500">
              Small BOQs finish quickly. Larger files can take several minutes.
            </p>
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
        <main className="min-h-screen flex items-center justify-center">
          <div className="text-gray-400 text-sm">Loading…</div>
        </main>
      }
    >
      <GeneratingContent />
    </Suspense>
  );
}
