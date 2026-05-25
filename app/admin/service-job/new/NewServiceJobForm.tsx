"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface ProcessedDoc {
  document_id: string;
  name: string;
  role: "primary" | "supporting";
  document_type: string;
  text: string;
  pages: number | null;
  subject_name?: string | null;
}

interface UploadingFile {
  id: string;
  name: string;
  status: "uploading" | "extracting" | "done" | "error";
  error?: string;
  processedDoc?: ProcessedDoc;
}

const PACKAGE_OPTIONS = [
  { value: "boq_only", label: "BOQ Only", desc: "Priced Bill of Quantities — ~$50" },
  { value: "tender_pack", label: "BOQ + Tender Pack", desc: "BOQ + Method Statement + Programme + Prelims + Resource Schedule — ~$120" },
  { value: "full_submission", label: "Full Submission Pack", desc: "Everything + Activity Schedule + Cover Letter + 1 revision — ~$200" },
] as const;

async function uploadAndExtract(file: File): Promise<ProcessedDoc> {
  if (file.size > 50 * 1024 * 1024) throw new Error("File too large. Maximum 50 MB.");

  const uploadUrlRes = await fetch("/api/upload-doc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name }),
  });
  if (!uploadUrlRes.ok) {
    const { error } = await uploadUrlRes.json().catch(() => ({ error: null }));
    throw new Error(error || "Failed to prepare upload.");
  }
  const { signedUrl, storageKey } = await uploadUrlRes.json();

  const uploadRes = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!uploadRes.ok) throw new Error("Upload failed. Please try again.");

  // Extract with retry on rate limits
  const MAX_RETRIES = 3;
  let lastError: Error = new Error("Extraction failed");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 4000 * attempt));
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storage_key: storageKey }),
    });
    if (res.ok) {
      const result = await res.json();
      const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return {
        document_id: docId,
        name: file.name,
        role: "supporting",
        document_type: "construction_sow",
        text: result.text ?? "",
        pages: result.pages ?? null,
        subject_name: result.subject_name ?? null,
      };
    }
    const { error } = await res.json().catch(() => ({ error: null }));
    lastError = new Error(error || "Extraction failed.");
    const isRateLimit = res.status === 429 || res.status === 503;
    if (!isRateLimit) throw lastError;
  }
  throw lastError;
}

export default function NewServiceJobForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [customerEmail, setCustomerEmail] = useState("");
  const [projectName, setProjectName] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [servicePackage, setServicePackage] = useState<"boq_only" | "tender_pack" | "full_submission">("boq_only");
  const [files, setFiles] = useState<UploadingFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const readyDocs = files.filter((f) => f.status === "done" && f.processedDoc);
  const anyProcessing = files.some((f) => f.status === "uploading" || f.status === "extracting");
  const canSubmit = customerEmail.includes("@") && readyDocs.length > 0 && !anyProcessing && !submitting;

  async function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    const newFiles: UploadingFile[] = Array.from(fileList).map((f) => ({
      id: `${f.name}-${Date.now()}`,
      name: f.name,
      status: "uploading" as const,
    }));
    setFiles((prev) => [...prev, ...newFiles]);

    for (let i = 0; i < newFiles.length; i++) {
      const entry = newFiles[i];
      const file = fileList[i];
      setFiles((prev) =>
        prev.map((f) => f.id === entry.id ? { ...f, status: "extracting" } : f)
      );
      try {
        const processed = await uploadAndExtract(file);
        setFiles((prev) =>
          prev.map((f) => f.id === entry.id ? { ...f, status: "done", processedDoc: processed } : f)
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        setFiles((prev) =>
          prev.map((f) => f.id === entry.id ? { ...f, status: "error", error: msg } : f)
        );
      }
    }
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);

    const documents = readyDocs.map((f, i) => ({
      ...f.processedDoc!,
      role: i === 0 ? "primary" : "supporting",
    }));

    try {
      const res = await fetch("/api/admin/service-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_email: customerEmail.trim(),
          project_name: projectName.trim() || undefined,
          payment_reference: paymentReference.trim() || undefined,
          service_package: servicePackage,
          documents,
        }),
      });

      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Submission failed" }));
        throw new Error(error || "Submission failed");
      }

      router.push("/admin");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Customer email */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#404040] mb-2">
          Customer Email <span className="text-[#ef4444]">*</span>
        </label>
        <input
          type="email"
          required
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
          placeholder="client@example.com"
          className="w-full rounded border border-[#262626] bg-[#111] px-3 py-2.5 text-[13px] text-[#f5f5f5] placeholder:text-[#404040] focus:border-[#f59e0b] focus:outline-none transition-colors"
        />
        <p className="text-[11px] text-[#404040] mt-1.5">The finished BOQ will be emailed directly to this address.</p>
      </div>

      {/* Project name */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#404040] mb-2">
          Project Name <span className="text-[#525252]">(optional)</span>
        </label>
        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="e.g. Nakambala School Extension"
          className="w-full rounded border border-[#262626] bg-[#111] px-3 py-2.5 text-[13px] text-[#f5f5f5] placeholder:text-[#404040] focus:border-[#f59e0b] focus:outline-none transition-colors"
        />
      </div>

      {/* Payment reference */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#404040] mb-2">
          Payment Reference <span className="text-[#525252]">(optional)</span>
        </label>
        <input
          type="text"
          value={paymentReference}
          onChange={(e) => setPaymentReference(e.target.value)}
          placeholder="MoMo / WhatsApp ref from customer"
          className="w-full rounded border border-[#262626] bg-[#111] px-3 py-2.5 text-[13px] text-[#f5f5f5] placeholder:text-[#404040] focus:border-[#f59e0b] focus:outline-none transition-colors"
        />
      </div>

      {/* Service package */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#404040] mb-2">
          Package
        </label>
        <div className="space-y-2">
          {PACKAGE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex items-start gap-3 rounded border px-4 py-3 cursor-pointer transition-colors ${
                servicePackage === opt.value
                  ? "border-[#f59e0b] bg-[#f59e0b]/5"
                  : "border-[#262626] bg-[#111] hover:border-[#404040]"
              }`}
            >
              <input
                type="radio"
                name="service_package"
                value={opt.value}
                checked={servicePackage === opt.value}
                onChange={() => setServicePackage(opt.value)}
                className="mt-0.5 accent-[#f59e0b]"
              />
              <div>
                <p className="text-[13px] font-medium text-[#f5f5f5]">{opt.label}</p>
                <p className="text-[11px] text-[#525252] mt-0.5">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Document upload */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#404040] mb-2">
          Project Documents <span className="text-[#ef4444]">*</span>
        </label>

        <div
          className="rounded border border-dashed border-[#262626] bg-[#111] px-6 py-8 text-center cursor-pointer hover:border-[#404040] transition-colors"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFiles(e.dataTransfer.files);
          }}
        >
          <p className="text-[13px] text-[#737373]">Drop PDF or DOCX files here, or click to browse</p>
          <p className="text-[11px] text-[#404040] mt-1">Up to 6 files · 50 MB each</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.doc"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {files.length > 0 && (
          <ul className="mt-3 space-y-2">
            {files.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded border border-[#262626] bg-[#111] px-3 py-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    f.status === "done" ? "bg-[#22c55e]" :
                    f.status === "error" ? "bg-[#ef4444]" :
                    "bg-[#f59e0b] animate-pulse"
                  }`} />
                  <span className="text-[12px] text-[#d4d4d4] truncate">{f.name}</span>
                  {f.status === "uploading" && <span className="text-[11px] text-[#525252] flex-shrink-0">Uploading…</span>}
                  {f.status === "extracting" && <span className="text-[11px] text-[#525252] flex-shrink-0">Extracting…</span>}
                  {f.status === "error" && <span className="text-[11px] text-[#ef4444] flex-shrink-0 truncate max-w-[200px]">{f.error}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  className="text-[#404040] hover:text-[#ef4444] text-[16px] leading-none ml-3 flex-shrink-0 transition-colors"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {submitError && (
        <div className="rounded border border-[#ef4444]/30 bg-[#ef4444]/5 px-4 py-3 text-[13px] text-[#ef4444]">
          {submitError}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded bg-[#f59e0b] hover:bg-[#fbbf24] disabled:opacity-40 disabled:cursor-not-allowed px-6 py-2.5 text-[13px] font-semibold text-black transition-colors"
        >
          {submitting ? "Creating job…" : "Create Service Job"}
        </button>
        <a href="/admin" className="text-[13px] text-[#525252] hover:text-[#737373] transition-colors">
          Cancel
        </a>
      </div>
    </form>
  );
}
