"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Progress } from "@/components/ui/progress";
import { usePostHog } from "posthog-js/react";
import BOQPricingCard from "@/components/BOQPricingCard";
import CreditBadge from "@/components/CreditBadge";
import ManualPaymentOptions from "@/components/ManualPaymentOptions";
import { useCredits } from "@/components/CreditsProvider";
import { DocumentList, type UploadedDoc, type ProcessedDoc } from "./DocumentList";
import { RateAssumptions, DEFAULT_CONTEXT, type RateContext } from "./RateAssumptions";

type Stage = "idle" | "extracting" | "generating" | "preview" | "paying" | "error";

const PAYMENT_MODE =
  process.env.NEXT_PUBLIC_PAYMENT_PROVIDER === "manual_whatsapp"
    ? process.env.NODE_ENV === "production"
      ? "manual_whatsapp"
      : "hybrid"
    : "stripe";

function openPendingExternalWindow() {
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;
  return popup;
}

function resolveExternalWindow(popup: Window | null, url: string) {
  if (popup) { popup.location.href = url; return; }
  window.open(url, "_blank", "noopener,noreferrer");
}

function closePendingExternalWindow(popup: Window | null) {
  if (popup && !popup.closed) popup.close();
}


export default function GenerateBOQTab() {
  const router = useRouter();
  const ph = usePostHog();
  const { remainingCredits } = useCredits();

  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [ctx, setCtx] = useState<RateContext>(DEFAULT_CONTEXT);

  // Preview / payment state
  const [boqId, setBoqId] = useState<string | null>(null);
  const [boqPreview, setBoqPreview] = useState<{
    billCount: number;
    itemCount: number;
    tier: { label: string; displayUsd: string; usdCents: number };
    approxRangeLabel: string;
  } | null>(null);
  const [manualPaymentRequested, setManualPaymentRequested] = useState(false);
  const [manualPaymentContact, setManualPaymentContact] = useState<string | null>(null);
  const [manualPaymentUrl, setManualPaymentUrl] = useState<string | null>(null);
  const [manualPaymentDetails, setManualPaymentDetails] = useState<string | null>(null);

  // Derived
  const anyProcessing = uploadedDocs.some((d) => d.processing);
  const readyDocs = uploadedDocs.filter((d) => d.processedDoc);
  const canGenerate = readyDocs.length > 0 && !anyProcessing;

  // Keep bundle in localStorage in sync
  const bundleDocs = useMemo((): ProcessedDoc[] => {
    const successful = uploadedDocs.filter((d) => d.processedDoc);
    return successful.map((d, i) => ({
      ...d.processedDoc!,
      role: i === 0 ? "primary" : "supporting",
    }));
  }, [uploadedDocs]);

  useEffect(() => {
    if (bundleDocs.length > 0) {
      localStorage.setItem("boq_document_bundle", JSON.stringify(bundleDocs));
    }
  }, [bundleDocs]);

  async function extractDoc(file: File): Promise<{
    text: string;
    pages: number | null;
    drawing_type?: string | null;
    subject_name?: string | null;
  }> {
    if (file.size > 50 * 1024 * 1024) {
      throw new Error("File too large. Maximum file size is 50 MB.");
    }
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/extract", { method: "POST", body: form });
    if (!res.ok) {
      const { error: e } = await res.json();
      throw new Error(e || "Extraction failed");
    }
    return res.json();
  }

  async function handleAddFiles(files: File[]) {
    if (files.length === 0) return;

    const newDocs: UploadedDoc[] = files.map((f, i) => ({
      id: `doc-${Date.now()}-${i}`,
      file: f,
      processing: true,
      error: null,
      processedDoc: null,
    }));

    setUploadedDocs((current) => [...current, ...newDocs]);
    setError(null);

    await Promise.all(
      newDocs.map(async (doc) => {
        try {
          const result = await extractDoc(doc.file);
          const processedDoc: ProcessedDoc = {
            document_id: doc.id,
            name: doc.file.name,
            role: "supporting",
            document_type: "supporting_context",
            text: result.text,
            pages: result.pages ?? null,
            drawing_type: result.drawing_type ?? null,
            subject_name: result.subject_name ?? null,
          };
          setUploadedDocs((current) =>
            current.map((d) => d.id === doc.id ? { ...d, processing: false, error: null, processedDoc } : d)
          );
          ph.capture("document_uploaded", {
            file_type: doc.file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx",
            pages: result.pages,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Extraction failed";
          setUploadedDocs((current) =>
            current.map((d) => d.id === doc.id ? { ...d, processing: false, error: msg } : d)
          );
        }
      })
    );
  }

  function handleRemoveDoc(id: string) {
    setUploadedDocs((current) => {
      const next = current.filter((d) => d.id !== id);
      if (next.length === 0) setError(null);
      return next;
    });
  }

  async function handleGenerate() {
    if (!canGenerate) return;

    localStorage.setItem("boq_suggest_rates", "1");
    localStorage.setItem("boq_type", "generate");
    setManualPaymentRequested(false);
    setManualPaymentContact(null);
    setManualPaymentUrl(null);
    setManualPaymentDetails(null);

    ph.capture("generate_initiated", {
      doc_count: bundleDocs.length,
      rate_context: ctx,
    });

    setStage("generating");
    setError(null);

    try {
      const bundleRaw = localStorage.getItem("boq_document_bundle");
      const documents = bundleRaw ? JSON.parse(bundleRaw) : bundleDocs;

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documents,
          suggest_rates: true,
          rate_context: ctx,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "BOQ generation failed");
      }
      const { boq_id, boq_preview } = await res.json();
      setBoqId(boq_id);
      setBoqPreview(boq_preview);
      setStage("preview");
    } catch (err) {
      setStage("error");
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg === "Failed to fetch" ? "Network error. Check your connection and try again." : msg);
    }
  }

  async function handleCheckout() {
    if (!boqId) return;
    if (remainingCredits > 0) {
      setStage("paying");
      setError(null);
      router.push(`/generating?boq_id=${encodeURIComponent(boqId)}&pay=credits&type=generate`);
      return;
    }

    setStage("paying");
    setError(null);

    if (PAYMENT_MODE !== "stripe") {
      const pendingWindow = openPendingExternalWindow();
      try {
        const res = await fetch("/api/manual-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ boq_id: boqId, type: "generate_boq" }),
        });
        const body = (await res.json()) as {
          error?: string;
          whatsappUrl?: string;
          contact?: string;
          paymentDetails?: string;
        };
        if (!res.ok || !body.whatsappUrl) throw new Error(body.error || "Could not start manual payment");
        setManualPaymentRequested(true);
        setManualPaymentContact(body.contact ?? null);
        setManualPaymentUrl(body.whatsappUrl);
        setManualPaymentDetails(body.paymentDetails ?? null);
        ph.capture("manual_payment_requested", { type: "generate_boq", boqId });
        resolveExternalWindow(pendingWindow, body.whatsappUrl);
        setStage("preview");
        return;
      } catch (err) {
        closePendingExternalWindow(pendingWindow);
        setStage("preview");
        const msg = err instanceof Error ? err.message : "Something went wrong";
        setError(msg === "Failed to fetch" ? "Network error. Check your connection and try again." : msg);
        return;
      }
    }

    ph.capture("payment_initiated", { type: "generate_boq", boqId });
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boq_id: boqId, type: "generate_boq" }),
      });
      if (!res.ok) {
        const { error: e } = await res.json();
        throw new Error(e || "Could not create payment session");
      }
      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      setStage("preview");
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg === "Failed to fetch" ? "Network error. Check your connection and try again." : msg);
    }
  }

  // ── Preview / paying ──────────────────────────────────────────────────────
  if ((stage === "preview" || stage === "paying") && boqPreview) {
    return (
      <BOQPricingCard
        boqPreview={boqPreview}
        onUnlock={handleCheckout}
        onCardPayment={async () => {
          if (!boqId) return;
          setStage("paying");
          setError(null);
          ph.capture("payment_initiated", { type: "generate_boq", boqId, mode: "stripe_test" });
          try {
            const res = await fetch("/api/checkout", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ boq_id: boqId, type: "generate_boq" }),
            });
            if (!res.ok) {
              const { error: e } = await res.json();
              throw new Error(e || "Could not create payment session");
            }
            const { url } = await res.json();
            window.location.href = url;
          } catch (err) {
            setStage("preview");
            const msg = err instanceof Error ? err.message : "Something went wrong";
            setError(msg === "Failed to fetch" ? "Network error. Check your connection and try again." : msg);
          }
        }}
        paying={stage === "paying"}
        creditsRemaining={remainingCredits}
        paymentMode={PAYMENT_MODE}
        manualPaymentRequested={manualPaymentRequested}
        manualPaymentContact={manualPaymentContact}
        manualPaymentUrl={manualPaymentUrl}
        manualPaymentDetails={manualPaymentDetails}
      />
    );
  }

  // ── Generating ────────────────────────────────────────────────────────────
  if (stage === "generating") {
    return (
      <div className="text-center space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight mb-3">Generating your BOQ</h2>
          <p className="text-sm text-gray-400">This takes 30–60 seconds…</p>
        </div>
        <Progress value={60} className="h-1.5 bg-white/10" />
      </div>
    );
  }

  // ── Main upload + ready UI ────────────────────────────────────────────────
  const isLocked = stage === "paying";

  return (
    <div className="space-y-4">
      <DocumentList
        docs={uploadedDocs}
        onAdd={handleAddFiles}
        onRemove={handleRemoveDoc}
        disabled={isLocked}
      />

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Rate assumptions — only show once we have at least one doc */}
      {uploadedDocs.length > 0 && (
        <RateAssumptions ctx={ctx} onChange={setCtx} />
      )}

      {/* Credits badge */}
      {remainingCredits > 0 && uploadedDocs.length > 0 && (
        <div className="flex items-center justify-between px-4 py-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
          <CreditBadge remainingCredits={remainingCredits} />
        </div>
      )}

      {/* Generate button */}
      {uploadedDocs.length > 0 && (
        <button
          className="w-full py-3.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          onClick={handleGenerate}
          disabled={!canGenerate || isLocked}
        >
          {anyProcessing ? (
            <>
              <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-black/60 border-t-transparent animate-spin" />
              Processing documents…
            </>
          ) : (
            "Generate BOQ →"
          )}
        </button>
      )}

      {uploadedDocs.length === 0 && (
        <p className="text-center text-xs text-gray-600">PDF or Word · up to 6 files · 50 MB each</p>
      )}
    </div>
  );
}
