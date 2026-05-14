"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import CreditBadge from "@/components/CreditBadge";
import TopUpModal from "@/components/TopUpModal";
import { useCredits } from "@/components/CreditsProvider";
import { DocumentList, type UploadedDoc, type ProcessedDoc } from "./DocumentList";
import { RateAssumptions, DEFAULT_CONTEXT, type RateContext } from "./RateAssumptions";

type Stage = "idle" | "extracting" | "generating" | "error";

export default function GenerateBOQTab() {
  const router = useRouter();
  const ph = usePostHog();
  const { remainingCredits } = useCredits();

  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [ctx, setCtx] = useState<RateContext>(DEFAULT_CONTEXT);
  const [showTopUp, setShowTopUp] = useState(false);

  const anyProcessing = uploadedDocs.some((d) => d.processing);
  const readyDocs = uploadedDocs.filter((d) => d.processedDoc);
  const hasEnoughCredits = remainingCredits >= 500;
  const canGenerate = readyDocs.length > 0 && !anyProcessing && stage !== "generating" && hasEnoughCredits;

  const bundleDocs = useMemo((): ProcessedDoc[] => {
    return uploadedDocs
      .filter((d) => d.processedDoc)
      .map((d, i) => ({ ...d.processedDoc!, role: i === 0 ? "primary" : "supporting" }));
  }, [uploadedDocs]);

  async function extractDoc(file: File): Promise<{ text: string; pages: number | null; drawing_type?: string | null; subject_name?: string | null }> {
    if (file.size > 50 * 1024 * 1024) throw new Error("File too large. Maximum file size is 50 MB.");

    // Step 1: get a signed upload URL
    const uploadUrlRes = await fetch("/api/upload-doc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name }),
    });
    if (!uploadUrlRes.ok) {
      const { error: e } = await uploadUrlRes.json().catch(() => ({ error: null }));
      throw new Error(e || "Failed to prepare upload. Please try again.");
    }
    const { signedUrl, storageKey } = await uploadUrlRes.json();

    // Step 2: upload directly to Supabase Storage
    const uploadRes = await fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!uploadRes.ok) throw new Error("Upload failed. Please try again.");

    // Step 3: extract with auto-retry on 429
    const MAX_RETRIES = 3;
    let lastError: Error = new Error("Extraction failed");
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 4000 * attempt));
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_key: storageKey }),
      });
      if (res.ok) return res.json();
      const { error: e } = await res.json().catch(() => ({ error: null }));
      lastError = new Error(e || "Extraction failed. Please try again.");
      // Only retry on rate limit errors
      const isRateLimit = res.status === 429 || res.status === 503 || (e ?? "").toLowerCase().includes("too many requests");
      if (!isRateLimit) throw lastError;
    }
    throw lastError;
  }

  async function processDoc(doc: UploadedDoc) {
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
      ph.capture("document_uploaded", { file_type: doc.file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx", pages: result.pages });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Extraction failed";
      setUploadedDocs((current) =>
        current.map((d) => d.id === doc.id ? { ...d, processing: false, error: msg } : d)
      );
    }
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

    // Process in batches of 3 to avoid Gemini burst rate limits
    const BATCH_SIZE = 3;
    for (let i = 0; i < newDocs.length; i += BATCH_SIZE) {
      const batch = newDocs.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(processDoc));
      if (i + BATCH_SIZE < newDocs.length) await new Promise((r) => setTimeout(r, 1500));
    }
  }

  async function handleRetryDoc(doc: UploadedDoc) {
    setUploadedDocs((current) =>
      current.map((d) => d.id === doc.id ? { ...d, processing: true, error: null } : d)
    );
    await processDoc(doc);
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
    setStage("generating");
    setError(null);

    ph.capture("generate_initiated", { doc_count: bundleDocs.length, rate_context: ctx });
    localStorage.setItem("boq_rate_context", JSON.stringify(ctx));

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents: bundleDocs, suggest_rates: true, rate_context: ctx }),
      });

      if (res.status === 402) {
        setStage("idle");
        setShowTopUp(true);
        return;
      }

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "BOQ generation failed");
      }

      const { boq_id } = await res.json();
      router.push(`/generating?boq_id=${encodeURIComponent(boq_id)}`);
    } catch (err) {
      setStage("error");
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg === "Failed to fetch" ? "Network error. Check your connection and try again." : msg);
    }
  }

  if (showTopUp) {
    return <TopUpModal onClose={() => setShowTopUp(false)} />;
  }

  return (
    <div className="space-y-4">
      <DocumentList docs={uploadedDocs} onAdd={handleAddFiles} onRemove={handleRemoveDoc} onRetry={handleRetryDoc} disabled={stage === "generating"} />

      {error && (
        <div className="px-4 py-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {uploadedDocs.length > 0 && <RateAssumptions ctx={ctx} onChange={setCtx} />}

      {uploadedDocs.length > 0 && (
        <div className="flex items-center justify-between px-4 py-3 rounded border border-[#f59e0b]/20 bg-[#f59e0b]/5">
          <CreditBadge remainingCredits={remainingCredits} />
        </div>
      )}

      {uploadedDocs.length > 0 && !hasEnoughCredits && (
        <div className="px-4 py-3 rounded border border-[#f59e0b]/20 bg-[#f59e0b]/5 text-xs text-[#f59e0b]">
          You need at least 500 credits to generate a BOQ.{" "}
          <button className="underline" onClick={() => setShowTopUp(true)}>Top up credits</button>
        </div>
      )}

      {uploadedDocs.length > 0 && (
        <button
          className="w-full py-3.5 rounded bg-[#f59e0b] hover:bg-[#fbbf24] text-black font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          onClick={!hasEnoughCredits ? () => setShowTopUp(true) : handleGenerate}
          disabled={!anyProcessing && stage !== "generating" && readyDocs.length === 0}
        >
          {anyProcessing ? (
            <>
              <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-black/60 border-t-transparent animate-spin" />
              Processing documents…
            </>
          ) : stage === "generating" ? (
            <>
              <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-black/60 border-t-transparent animate-spin" />
              Starting…
            </>
          ) : !hasEnoughCredits ? (
            "Top up to generate →"
          ) : (
            "Generate BOQ →"
          )}
        </button>
      )}

      {uploadedDocs.length === 0 && (
        <p className="text-center text-xs text-[#555]">PDF or Word · up to 20 files · 50 MB each</p>
      )}
    </div>
  );
}
