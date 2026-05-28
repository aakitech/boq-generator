"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";

import type { BOQBill, BOQDocument, BOQItem, BOQQualitySummary } from "@/lib/types";
import { usePostHog } from "posthog-js/react";
import CreditBadge from "@/components/CreditBadge";
import { useCredits } from "@/components/CreditsProvider";
import RateReviewPanel from "@/components/boq/RateReviewPanel";

interface DBBoq {
  id: string;
  title: string;
  data: BOQDocument;
  source_excel_key?: string | null;
  review_status?: string | null;
  service_tier?: string | null;
  service_status?: string | null;
  customer_email?: string | null;
  service_package?: string | null;
  service_payment_reference?: string | null;
}

interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
  tone?: "default" | "error" | "success" | "question";
}

interface AssistantDiff {
  billDelta: number;
  itemDelta: number;
  pricedItemsDelta: number;
}

interface AssistantPreview {
  summary: string;
  proposedBoq: BOQDocument;
  diff: AssistantDiff;
}

function formatAssistantDiff(diff: AssistantDiff) {
  const parts = [
    `Bills ${diff.billDelta >= 0 ? "+" : ""}${diff.billDelta}`,
    `Items ${diff.itemDelta >= 0 ? "+" : ""}${diff.itemDelta}`,
    `Priced ${diff.pricedItemsDelta >= 0 ? "+" : ""}${diff.pricedItemsDelta}`,
  ];
  return parts.join(" · ");
}

function unresolvedPlaceholder(item: BOQItem): string | null {
  if (item.note === "Incl") return "Incl";
  if (item.qty === null && item.rate === null) return "TO BE COMPLETED";
  return null;
}


export default function BOQPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const isAdminView = searchParams.get("admin") === "1";
  const [boq, setBOQ] = useState<BOQDocument | null>(null);
  const [boqId] = useState(id);
  const [serviceMeta, setServiceMeta] = useState<{
    isServiceJob: boolean;
    serviceStatus: string | null;
    customerEmail: string | null;
    servicePackage: string | null;
    paymentReference: string | null;
  }>({ isServiceJob: false, serviceStatus: null, customerEmail: null, servicePackage: null, paymentReference: null });
  const [delivering, setDelivering] = useState(false);
  const [deliverError, setDeliverError] = useState<string | null>(null);
  const [deliverSuccess, setDeliverSuccess] = useState(false);
  const ph = usePostHog();
  const [exporting, setExporting] = useState(false);
  const [exportingPatched, setExportingPatched] = useState(false);
  const [hasSourceExcel, setHasSourceExcel] = useState(false);
  const [saved, setSaved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantPaneOpen, setAssistantPaneOpen] = useState(true);
  const [assistantDrawerOpen, setAssistantDrawerOpen] = useState(false);
  const [reviewPanelOpen, setReviewPanelOpen] = useState(true);
  const [reviewApproved, setReviewApproved] = useState(false);
  const [assistantPreview, setAssistantPreview] = useState<AssistantPreview | null>(null);
  const [assistantStatus, setAssistantStatus] = useState<string | null>(null);
  const [undoCount, setUndoCount] = useState(0);
  const { remainingCredits, loadingCredits, refreshCredits, setRemainingCredits } = useCredits();
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([
    {
      role: "assistant",
      content:
        "Describe the BOQ change you want, and I will apply it directly to this BOQ only.",
    },
  ]);
  const undoStack = useRef<BOQDocument[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const appendAssistantMessage = useCallback(
    (content: string, tone: AssistantMessage["tone"] = "default") => {
      setAssistantMessages((prev) => [...prev, { role: "assistant", content, tone }]);
    },
    []
  );

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/boqs/${id}`);
      if (!res.ok) {
        router.replace("/dashboard");
        return;
      }
      const { boq: row }: { boq: DBBoq } = await res.json();
      setBOQ(row.data);
      setHasSourceExcel(Boolean(row.source_excel_key));
      const approved = row.review_status === "approved";
      setReviewApproved(approved);
      setReviewPanelOpen(!approved);
      setServiceMeta({
        isServiceJob: row.service_tier === "done_for_you",
        serviceStatus: row.service_status ?? null,
        customerEmail: row.customer_email ?? null,
        servicePackage: row.service_package ?? null,
        paymentReference: row.service_payment_reference ?? null,
      });
      setLoading(false);
      ph.capture("boq_viewed", { boq_id: id, service_tier: row.service_tier ?? null });
    }
    load();
  }, [id, router, ph]);

  async function handleDeliverToCustomer() {
    setDelivering(true);
    setDeliverError(null);
    try {
      const res = await fetch(`/api/admin/service-job/${boqId}/deliver`, { method: "POST" });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Delivery failed" }));
        throw new Error(error || "Delivery failed");
      }
      setDeliverSuccess(true);
      setServiceMeta((prev) => ({ ...prev, serviceStatus: "delivered" }));
      setTimeout(() => router.push("/admin"), 2000);
    } catch (err) {
      setDeliverError(err instanceof Error ? err.message : "Delivery failed. Please try again.");
      setDelivering(false);
    }
  }

  const saveToDB = useCallback(
    (updated: BOQDocument) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        await fetch(`/api/boqs/${boqId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: updated.project || "Untitled BOQ", data: updated }),
        });
        setSaved(true);
      }, 1200);
    },
    [boqId]
  );

  const updateBOQ = useCallback(
    (updated: BOQDocument) => {
      setBOQ(updated);
      setSaved(false);
      saveToDB(updated);
    },
    [saveToDB]
  );

  function updateItem(
    billIdx: number,
    itemIdx: number,
    field: keyof BOQItem,
    value: string | number | null
  ) {
    if (!boq) return;
    const bills = boq.bills.map((b, bi) => {
      if (bi !== billIdx) return b;
      const items = b.items.map((it, ii) => {
        if (ii !== itemIdx) return it;
        const updated = { ...it, [field]: value };
        if (updated.qty !== null && updated.rate !== null) {
          updated.amount = +(updated.qty * updated.rate).toFixed(2);
        }
        return updated;
      });
      return { ...b, items };
    });
    updateBOQ({ ...boq, bills });
  }

  function addItem(billIdx: number) {
    if (!boq) return;
    const bills = boq.bills.map((b, bi) => {
      if (bi !== billIdx) return b;
      const newItem: BOQItem = {
        item_no: "",
        description: "",
        unit: "Item",
        qty: null,
        rate: null,
        amount: null,
        quantity_source: "assumed",
        quantity_confidence: 0.4,
      };
      return { ...b, items: [...b.items, newItem] };
    });
    updateBOQ({ ...boq, bills });
  }

  function removeItem(billIdx: number, itemIdx: number) {
    if (!boq) return;
    const bills = boq.bills.map((b, bi) => {
      if (bi !== billIdx) return b;
      return { ...b, items: b.items.filter((_, ii) => ii !== itemIdx) };
    });
    updateBOQ({ ...boq, bills });
  }

  async function handleApproveRates(updated: BOQDocument) {
    setBOQ(updated);
    await fetch(`/api/boqs/${boqId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review_status: "approved", data: updated, title: updated.project || "Untitled BOQ" }),
    });
    setReviewApproved(true);
    setReviewPanelOpen(false);
  }

  async function handleExport() {
    if (!boq) return;

    ph.capture("excel_download_attempted", { boq_id: boqId, type: "generated" });
    setExporting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(boq),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BOQ_${boq.project.replace(/[^\w]/g, "_").slice(0, 40)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      ph.capture("excel_downloaded", { boq_id: boqId, type: "generated", bill_count: boq.bills.length });
    } catch (e) {
      alert("Export failed. Please try again.");
      console.error(e);
    } finally {
      setExporting(false);
    }
  }

  async function handleExportPatched() {
    ph.capture("excel_download_attempted", { boq_id: boqId, type: "patched_original" });
    setExportingPatched(true);
    try {
      const res = await fetch(`/api/export-patched/${boqId}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Rated_${boq?.project?.replace(/[^\w]/g, "_").slice(0, 40) ?? "BOQ"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      ph.capture("excel_downloaded", { boq_id: boqId, type: "patched_original" });
    } catch (e) {
      alert("Export failed. Please try again.");
      console.error(e);
    } finally {
      setExportingPatched(false);
    }
  }

  async function handleAssistantSubmit() {
    if (!boq || assistantBusy) return;
    const instruction = assistantInput.trim();
    if (!instruction) return;

    ph.capture("assistant_used", { boq_id: boqId });
    setAssistantInput("");
    setAssistantPreview(null);
    setAssistantMessages((prev) => [...prev, { role: "user", content: instruction }]);
    setAssistantBusy(true);
    setAssistantStatus("Planning edits...");

    let assistantDraft = "";
    let receivedProposal = false;
    setAssistantMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      // Pass history excluding the empty assistant placeholder just added
      const historyForApi = assistantMessages
        .filter((m) => m.content.trim())
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch(`/api/boqs/${boqId}/assistant/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, boq, history: historyForApi }),
      });

      if (!res.ok) {
        const { error: e } = await res.json();
        throw new Error(e || "Assistant request failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Streaming is not available");

      const decoder = new TextDecoder();
      let buffer = "";

      function updateDraft() {
        setAssistantMessages((prev) => {
          const next = [...prev];
          const lastIdx = next.length - 1;
          if (lastIdx < 0) return prev;
          if (next[lastIdx].role !== "assistant") return prev;
          next[lastIdx] = { role: "assistant", content: assistantDraft };
          return next;
        });
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const evt of events) {
          const lines = evt.split("\n");
          const eventLine = lines.find((line) => line.startsWith("event:"));
          const dataLine = lines.find((line) => line.startsWith("data:"));
          if (!eventLine || !dataLine) continue;

          const eventType = eventLine.replace("event:", "").trim();
          const payload = JSON.parse(dataLine.replace("data:", "").trim()) as {
            token?: string;
            step?: string;
            question?: string;
            summary?: string;
            proposed_boq?: BOQDocument;
            diff?: AssistantDiff;
            message?: string;
            remainingCredits?: number;
          };

          if (eventType === "status") {
            if (payload.step === "planning") setAssistantStatus(null);
            if (payload.step === "proposing") setAssistantStatus(null);
          }

          if (eventType === "token" && payload.token) {
            assistantDraft += payload.token;
            updateDraft();
          }

          if (eventType === "question" && payload.question) {
            receivedProposal = true;
            assistantDraft = payload.question;
            setAssistantMessages((prev) => {
              const next = [...prev];
              const lastIdx = next.length - 1;
              if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                next[lastIdx] = { role: "assistant", content: payload.question!, tone: "question" };
              }
              return next;
            });
          }

          if (eventType === "result" && payload.proposed_boq && payload.diff) {
            receivedProposal = true;
            const summary = payload.summary || "Edits ready for review.";
            if (!assistantDraft.trim()) {
              assistantDraft = summary;
              updateDraft();
            }
            setAssistantPreview({
              summary,
              proposedBoq: payload.proposed_boq,
              diff: payload.diff,
            });
            appendAssistantMessage(
              `${summary}\n${formatAssistantDiff(payload.diff)}`,
              "success"
            );
            if (typeof payload.remainingCredits === "number") {
              setRemainingCredits(payload.remainingCredits);
            }
          }

          if (eventType === "error") {
            throw new Error(payload.message || "Assistant request failed");
          }
        }
      }

      if (!receivedProposal && !assistantDraft.trim()) {
        throw new Error("Assistant did not return a proposal. Please try again.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Assistant failed";
      await refreshCredits();
      setAssistantMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content: message,
          tone: "error",
        },
      ]);
    } finally {
      setAssistantBusy(false);
      setAssistantStatus(null);
    }
  }

  function handleApplyPreview() {
    if (!boq || !assistantPreview) return;
    const diffSummary = formatAssistantDiff(assistantPreview.diff);
    undoStack.current.push(boq);
    setUndoCount(undoStack.current.length);
    updateBOQ(assistantPreview.proposedBoq);
    appendAssistantMessage(`Applied proposed BOQ changes.\n${diffSummary}`, "success");
    setAssistantPreview(null);
  }

  function handleDiscardPreview() {
    if (!assistantPreview) return;
    appendAssistantMessage("Discarded the proposal. Your BOQ has not been changed.", "default");
    setAssistantPreview(null);
  }

  function handleUndoLastAIEdit() {
    const previous = undoStack.current.pop();
    if (!previous) return;
    setUndoCount(undoStack.current.length);
    updateBOQ(previous);
    appendAssistantMessage("Reverted the last AI-applied BOQ changes.", "success");
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] animate-pulse">
        {/* Header skeleton */}
        <div className="sticky top-0 z-20 border-b border-white/10 bg-[#0a0a0a]/95 px-4 py-3">
          <div className="max-w-[1500px] mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-7 w-28 rounded bg-white/10" />
              <div className="h-5 w-16 rounded-full bg-white/10" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-24 rounded-lg bg-white/10" />
              <div className="h-8 w-20 rounded-lg bg-white/10" />
            </div>
          </div>
        </div>
        {/* Table skeleton */}
        <div className="max-w-[1500px] mx-auto px-4 py-6 space-y-3">
          <div className="h-6 w-48 rounded bg-white/10" />
          <div className="rounded-xl border border-white/10 overflow-hidden">
            {[100, 60, 80, 45, 70, 55].map((w, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-white/5 last:border-0">
                <div className="h-4 rounded bg-white/10" style={{ width: `${w}%` }} />
                <div className="h-4 w-16 rounded bg-white/10 shrink-0" />
                <div className="h-4 w-20 rounded bg-white/10 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!boq) return null;

  const qualitySummary = getQualitySummary(boq);
  const workbookStats = boq.workbook_preservation;

  const grandTotal = boq.bills.reduce((sum, b) => {
    const billTotal = b.items.reduce((s, it) => {
      if (it.is_header) return s;
      const amt = it.amount ?? (it.qty !== null && it.rate !== null ? it.qty * it.rate : null);
      return amt !== null ? s + amt : s;
    }, 0);
    return sum + billTotal;
  }, 0);

  const PACKAGE_LABELS: Record<string, string> = {
    boq_only: "BOQ Only",
    tender_pack: "BOQ + Tender Pack",
    full_submission: "Full Submission Pack",
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {isAdminView && serviceMeta.isServiceJob && serviceMeta.serviceStatus === "pending_review" && (
        <div className="border-b border-[#f59e0b]/20 bg-[#f59e0b]/5 px-4 py-3">
          <div className="mx-auto max-w-[1500px] flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 text-[13px] min-w-0">
              <span className="text-[#f59e0b] font-semibold flex-shrink-0">Service Job</span>
              <span className="text-[#737373]">→</span>
              <span className="text-[#d4d4d4] font-mono truncate">{serviceMeta.customerEmail}</span>
              {serviceMeta.servicePackage && (
                <span className="text-[#525252] hidden sm:block">
                  {PACKAGE_LABELS[serviceMeta.servicePackage] ?? serviceMeta.servicePackage}
                </span>
              )}
              {serviceMeta.paymentReference && (
                <span className="text-[#404040] font-mono hidden md:block">ref: {serviceMeta.paymentReference}</span>
              )}
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {deliverError && (
                <span className="text-[12px] text-[#ef4444]">{deliverError}</span>
              )}
              {deliverSuccess ? (
                <span className="text-[12px] text-[#22c55e] font-medium">Delivered — redirecting…</span>
              ) : (
                <button
                  onClick={handleDeliverToCustomer}
                  disabled={delivering}
                  className="rounded bg-[#f59e0b] hover:bg-[#fbbf24] disabled:opacity-50 px-4 py-1.5 text-[12px] font-semibold text-black transition-colors"
                >
                  {delivering ? "Sending…" : "Approve & Send to Customer"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <header className="sticky top-0 z-20 border-b border-white/15 bg-[#0a0a0a]/95 backdrop-blur">
        <div className="max-w-[1500px] mx-auto px-4 pt-3 pb-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <a href="/" className="shrink-0 font-serif text-white text-base tracking-tight">
              BOQ Generator
            </a>
            <a
              href="/dashboard"
              className="inline-flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Dashboard
            </a>
          </div>
          {!loadingCredits ? <CreditBadge remainingCredits={remainingCredits} className="shrink-0" /> : null}
        </div>
        <div className="max-w-[1500px] mx-auto px-4 pb-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="min-w-0">
              <p className="text-xs text-gray-300 truncate">{boq.location}</p>
              <h1 className="font-serif text-base text-white truncate">{boq.project}</h1>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 sm:gap-3 shrink-0 flex-wrap">
            {!saved && <span className="text-xs text-gray-300 hidden sm:block">Saving…</span>}
            {grandTotal > 0 && (
              <span className="hidden md:block text-xs text-gray-200">
                Total:{" "}
                <span className="text-amber-300 font-mono">
                  ZMW {grandTotal.toLocaleString("en-ZM", { minimumFractionDigits: 2 })}
                </span>
              </span>
            )}
            {!reviewApproved && (
              <button
                onClick={() => setReviewPanelOpen((v) => !v)}
                className="hidden xl:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-sm border border-amber-500/30 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                Review rates
              </button>
            )}
            {hasSourceExcel ? (
              <button
                onClick={reviewApproved ? handleExportPatched : undefined}
                disabled={exportingPatched || !reviewApproved}
                title={!reviewApproved ? "Approve rates before downloading" : undefined}
                className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-black text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {exportingPatched ? "Exporting..." : "Download rated Excel"}
              </button>
            ) : (
              <button
                onClick={reviewApproved ? handleExport : undefined}
                disabled={exporting || !reviewApproved}
                title={!reviewApproved ? "Approve rates before downloading" : undefined}
                className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-black text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {exporting ? "Exporting..." : "Download Excel"}
              </button>
            )}
            <button
              onClick={() => setAssistantPaneOpen((v) => !v)}
              className="hidden xl:inline-flex px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-gray-100 text-sm"
            >
              {assistantPaneOpen ? "Hide assistant" : "Show assistant"}
            </button>
            <button
              onClick={() => setAssistantDrawerOpen(true)}
              className="xl:hidden px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-gray-100 text-sm"
            >
              Assistant
            </button>
          </div>
        </div>

        <div className="max-w-[1500px] mx-auto px-4 pb-2 flex flex-wrap gap-4 text-xs text-gray-300">
          <MetaField
            label="Project"
            value={boq.project}
            onChange={(v) => updateBOQ({ ...boq, project: v })}
          />
          <MetaField
            label="Location"
            value={boq.location}
            onChange={(v) => updateBOQ({ ...boq, location: v })}
          />
          <MetaField
            label="Prepared by"
            value={boq.prepared_by}
            onChange={(v) => updateBOQ({ ...boq, prepared_by: v })}
          />
          <MetaField label="Date" value={boq.date} onChange={(v) => updateBOQ({ ...boq, date: v })} />
        </div>
      </header>

     
      <main className="max-w-[1500px] mx-auto px-2 sm:px-4 py-6 space-y-4">
        {!assistantPaneOpen && (
          <div className="hidden xl:flex justify-end">
            <button
              onClick={() => setAssistantPaneOpen(true)}
              className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-gray-100 text-sm"
            >
              Open assistant pane
            </button>
          </div>
        )}

        <div
          className={`grid gap-4 ${
            assistantPaneOpen || reviewPanelOpen ? "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_440px]" : "grid-cols-1"
          }`}
        >
          <div className="space-y-6 min-w-0">
            {hasSourceExcel && workbookStats && (
              <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/[0.08] p-4 text-sm space-y-2">
                <div>
                  <p className="text-emerald-200 font-semibold">Original Workbook Preservation</p>
                  <p className="text-emerald-50 mt-1">
                    This BOQ keeps the uploaded Excel workbook intact and fills pricing only where rows can be mapped safely.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded bg-white/10 px-2 py-1 text-gray-100">
                    Measurable rows: {qualitySummary.total_items}
                  </span>
                  <span className="rounded bg-white/10 px-2 py-1 text-gray-100">
                    Mapped rows: {qualitySummary.mapped_rows ?? workbookStats.mapped_item_rows}
                  </span>
                  <span className="rounded bg-white/10 px-2 py-1 text-gray-100">
                    Rates filled: {qualitySummary.rate_filled ?? 0}
                  </span>
                  <span className="rounded bg-white/10 px-2 py-1 text-gray-100">
                    Left blank: {qualitySummary.rate_missing ?? 0}
                  </span>
                  <span className="rounded bg-white/10 px-2 py-1 text-gray-100">
                    Ambiguous rows skipped: {qualitySummary.ambiguous_rows ?? 0}
                  </span>
                  <span className="rounded bg-white/10 px-2 py-1 text-gray-100">
                    Outlier AI rates skipped: {qualitySummary.outlier_rows ?? 0}
                  </span>
                </div>
              </div>
            )}

            {boq.bills.map((bill, billIdx) => (
              <BillSection
                key={billIdx}
                bill={bill}
                onUpdateItem={(itemIdx, field, value) =>
                  updateItem(billIdx, itemIdx, field, value)
                }
                onAddItem={() => addItem(billIdx)}
                onRemoveItem={(itemIdx) => removeItem(billIdx, itemIdx)}
              />
            ))}

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex justify-between items-center">
              <span className="font-bold text-white">TOTAL (VAT EXCLUSIVE)</span>
              <span className="font-mono font-bold text-amber-400 text-lg">
                ZMW {grandTotal.toLocaleString("en-ZM", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {(reviewPanelOpen || assistantPaneOpen) && (
            <aside className="hidden xl:flex flex-col gap-4">
              <div className="sticky top-22 pb-4 flex flex-col gap-4">
                {reviewPanelOpen && boq && (
                  <RateReviewPanel
                    boq={boq}
                    onSave={(updated) => updateBOQ(updated)}
                    onApprove={(updated) => handleApproveRates(updated)}
                  />
                )}
                {assistantPaneOpen && (
                  <AssistantPanel
                    assistantBusy={assistantBusy}
                    assistantStatus={assistantStatus}
                    undoCount={undoCount}
                    assistantMessages={assistantMessages}
                    assistantInput={assistantInput}
                    assistantPreview={assistantPreview}
                    onUndo={handleUndoLastAIEdit}
                    onPickPrompt={setAssistantInput}
                    onDiscardPreview={handleDiscardPreview}
                    onApplyPreview={handleApplyPreview}
                    onSubmit={handleAssistantSubmit}
                    onInputChange={setAssistantInput}
                  />
                )}
              </div>
            </aside>
          )}
        </div>

        {assistantDrawerOpen && (
          <div className="xl:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm">
            <div className="absolute inset-y-0 right-0 w-full max-w-md bg-[#111214] border-l border-white/10 p-3 overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">BOQ Assistant</h3>
                <button
                  onClick={() => setAssistantDrawerOpen(false)}
                  className="px-2 py-1 rounded-md bg-white/10 text-gray-100 text-xs"
                >
                  Close
                </button>
              </div>
              <AssistantPanel
                assistantBusy={assistantBusy}
                assistantStatus={assistantStatus}
                undoCount={undoCount}
                assistantMessages={assistantMessages}
                assistantInput={assistantInput}
                assistantPreview={assistantPreview}
                onUndo={handleUndoLastAIEdit}
                onPickPrompt={setAssistantInput}
                onDiscardPreview={handleDiscardPreview}
                onApplyPreview={handleApplyPreview}
                onSubmit={handleAssistantSubmit}
                onInputChange={setAssistantInput}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function getQualitySummary(boq: BOQDocument): BOQQualitySummary {
  let total = 0;
  let qtyWithEvidence = 0;
  let qtyMissing = 0;
  let lowConfidence = 0;
  let rateFilled = 0;
  let rateMissing = 0;

  for (const bill of boq.bills) {
    for (const item of bill.items) {
      if (item.is_header) continue;
      total += 1;
      if (item.qty == null) qtyMissing += 1;
      if (item.qty != null && item.source_excerpt && item.source_excerpt.trim().length >= 12) {
        qtyWithEvidence += 1;
      }
      if ((item.quantity_confidence ?? 0.4) < 0.6) lowConfidence += 1;
      if (item.rate == null) rateMissing += 1;
      else rateFilled += 1;
    }
  }

  return {
    total_items: total,
    qty_with_evidence: qtyWithEvidence,
    qty_missing: qtyMissing,
    low_confidence: lowConfidence,
    rate_filled: boq.quality_summary?.rate_filled ?? rateFilled,
    rate_missing: boq.quality_summary?.rate_missing ?? rateMissing,
    mapped_rows: boq.quality_summary?.mapped_rows ?? boq.workbook_preservation?.mapped_item_rows,
    ambiguous_rows: boq.quality_summary?.ambiguous_rows ?? boq.workbook_preservation?.ambiguous_item_rows ?? 0,
    outlier_rows: boq.quality_summary?.outlier_rows ?? boq.workbook_preservation?.outlier_rate_rows ?? 0,
  };
}

function AssistantPanel({
  assistantBusy,
  assistantStatus,
  undoCount,
  assistantMessages,
  assistantInput,
  assistantPreview,
  onUndo,
  onPickPrompt,
  onDiscardPreview,
  onApplyPreview,
  onSubmit,
  onInputChange,
}: {
  assistantBusy: boolean;
  assistantStatus: string | null;
  undoCount: number;
  assistantMessages: AssistantMessage[];
  assistantInput: string;
  assistantPreview: AssistantPreview | null;
  onUndo: () => void;
  onPickPrompt: (value: string) => void;
  onDiscardPreview: () => void;
  onApplyPreview: () => void;
  onSubmit: () => void;
  onInputChange: (value: string) => void;
}) {
  const threadRef = useRef<HTMLDivElement | null>(null);
  const hasUserMessages = assistantMessages.some((message) => message.role === "user");
  const showWelcome = !hasUserMessages && !assistantPreview && !assistantBusy;

  function displayMessage(content: string) {
    return content
      .replace(/\s\*\s/g, "\n• ")
      .replace(/\*\s/g, "• ");
  }

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [assistantMessages, assistantStatus]);

  const quickPrompts = [
    "Rewrite descriptions to ASAQS standard.",
    "Fill ZMW rates for all unpriced items.",
    "Add a 10% contingency to the Preliminaries bill.",
    "Reorder bills to correct trade sequence.",
  ];

  return (
    <section className="rounded-xl border border-white/10 bg-[#111214] h-[calc(100dvh-9rem)] max-h-[calc(100dvh-9rem)] min-h-[520px] flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">BOQ Assistant</h2>
        <button
          onClick={onUndo}
          disabled={undoCount === 0 || assistantBusy}
          className="px-2.5 py-1 rounded-md text-[11px] bg-white/[0.08] hover:bg-white/[0.12] text-gray-400 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Undo ({undoCount})
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
        {showWelcome ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
            <div className={`grid gap-1.5 transition-opacity ${assistantBusy ? "opacity-40 pointer-events-none" : ""}`}>
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => onPickPrompt(prompt)}
                  disabled={assistantBusy}
                  className="text-left px-2.5 py-2 rounded-md bg-white/[0.06] hover:bg-white/[0.10] text-[11px] text-gray-300 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-[280px] rounded-lg border border-white/10 bg-[#0d0e10] overflow-hidden">
            <div ref={threadRef} className="h-full overflow-y-auto p-2.5 space-y-2">
              {assistantMessages.map((message, idx) => (
                <div
                  key={idx}
                  className={`max-w-[95%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    message.role === "user"
                      ? "ml-auto bg-white/10 text-white border border-white/15"
                      : message.tone === "error"
                        ? "mr-auto bg-red-500/10 text-red-100 border border-red-500/20"
                        : message.tone === "success"
                          ? "mr-auto bg-emerald-500/10 text-emerald-100 border border-emerald-500/20"
                        : message.tone === "question"
                          ? "mr-auto bg-amber-500/10 text-amber-100 border border-amber-500/30"
                        : "mr-auto bg-white/[0.04] text-gray-300 border border-white/10"
                  }`}
                >
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-white/45">
                    {message.role === "user" ? "You" : "BOQ Assistant"}
                  </p>
                  {message.role === "assistant" && !message.content ? (
                    <span className="flex flex-col gap-2">
                      {assistantStatus && (
                        <span className="text-[11px] text-gray-500">{assistantStatus}</span>
                      )}
                      <span className="text-[11px] text-gray-400">AI is typing...</span>
                      <span className="inline-flex gap-1.5 items-center h-5">
                        <span className="w-2 h-2 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: "160ms" }} />
                        <span className="w-2 h-2 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: "320ms" }} />
                      </span>
                    </span>
                  ) : message.role === "assistant" && assistantBusy && idx === assistantMessages.length - 1 ? (
                    <span className="flex flex-col gap-1.5">
                      {assistantStatus && (
                        <span className="text-[11px] text-gray-500">{assistantStatus}</span>
                      )}
                      <p className="whitespace-pre-wrap break-words">
                        {displayMessage(message.content)}
                        <span className="inline-block w-0.5 h-3.5 bg-gray-400 ml-0.5 animate-pulse align-middle" />
                      </p>
                    </span>
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{displayMessage(message.content)}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {assistantPreview && (
          <div className="rounded-lg border border-white/15 bg-white/[0.04] p-3">
            <p className="text-xs text-white font-medium mb-1">Proposal ready</p>
            <p className="text-xs text-gray-400 mb-2">{assistantPreview.summary}</p>
            <div className="flex flex-wrap gap-2 mb-3 text-[11px] text-gray-400">
              <span className="px-2 py-1 rounded bg-white/[0.08]">
                Bills: {assistantPreview.diff.billDelta >= 0 ? "+" : ""}
                {assistantPreview.diff.billDelta}
              </span>
              <span className="px-2 py-1 rounded bg-white/[0.08]">
                Items: {assistantPreview.diff.itemDelta >= 0 ? "+" : ""}
                {assistantPreview.diff.itemDelta}
              </span>
              <span className="px-2 py-1 rounded bg-white/[0.08]">
                Priced: {assistantPreview.diff.pricedItemsDelta >= 0 ? "+" : ""}
                {assistantPreview.diff.pricedItemsDelta}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={onApplyPreview}
                className="px-3 py-1.5 rounded-md bg-amber-400 hover:bg-amber-300 text-black text-xs font-semibold"
              >
                Apply changes
              </button>
              <button
                onClick={onDiscardPreview}
                className="px-3 py-1.5 rounded-md bg-white/[0.08] hover:bg-white/[0.12] text-gray-300 text-xs"
              >
                Discard
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="p-3 border-t border-white/10 space-y-2">
        <textarea
          className="boq-cell-editable text-white w-full min-h-[76px]"
          placeholder="Tell me what to change…"
          value={assistantInput}
          onChange={(e) => onInputChange(e.target.value)}
          disabled={assistantBusy}
        />
        <button
          onClick={onSubmit}
          disabled={assistantBusy || !assistantInput.trim()}
          className="w-full px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-black text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {assistantBusy ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-black/40 border-t-transparent animate-spin" />
              Working…
            </span>
          ) : "Generate proposal"}
        </button>
      </div>
    </section>
  );
}

function MetaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-gray-200">{label}:</span>
      <input
        className="boq-cell-editable text-white text-xs min-w-[100px] max-w-[200px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function BillSection({
  bill,
  onUpdateItem,
  onAddItem,
  onRemoveItem,
}: {
  bill: BOQBill;
  onUpdateItem: (itemIdx: number, field: keyof BOQItem, value: string | number | null) => void;
  onAddItem: () => void;
  onRemoveItem: (itemIdx: number) => void;
}) {
  const [open, setOpen] = useState(true);

  const billTotal = bill.items.reduce((s, it) => {
    if (it.is_header) return s;
    const amt = it.amount ?? (it.qty !== null && it.rate !== null ? it.qty * it.rate : null);
    return amt !== null ? s + amt : s;
  }, 0);

  return (
    <div className="rounded-xl border border-white/15 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-[#1c1f25] hover:bg-[#22262e] transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-200 font-mono">BILL {bill.number}</span>
          <span className="font-semibold text-white text-sm">{bill.title}</span>
          <span className="text-xs text-gray-200">({bill.items.filter((i) => !i.is_header).length} items)</span>
        </div>
        <div className="flex items-center gap-4">
          {billTotal > 0 && (
            <span className="text-xs font-mono text-amber-400">
              ZMW {billTotal.toLocaleString("en-ZM", { minimumFractionDigits: 2 })}
            </span>
          )}
          <ChevronIcon open={open} />
        </div>
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#141922] text-gray-100 border-b border-white/10">
                <th className="px-3 py-2 text-left w-[70px]">ITEM</th>
                <th className="px-3 py-2 text-left">DESCRIPTION</th>
                <th className="px-2 py-2 text-center w-[60px]">UNIT</th>
                <th className="px-2 py-2 text-right w-[70px]">QTY</th>
                <th className="px-2 py-2 text-right w-[100px]">RATE (ZMW)</th>
                <th className="px-2 py-2 text-right w-[110px]">AMOUNT (ZMW)</th>
                <th className="w-[30px]" />
              </tr>
            </thead>
            <tbody>
              {bill.items.map((item, itemIdx) => (
                <ItemRow
                  key={itemIdx}
                  item={item}
                  onUpdate={(field, value) => onUpdateItem(itemIdx, field, value)}
                  onRemove={() => onRemoveItem(itemIdx)}
                />
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between px-4 py-2 bg-[#12161e] border-t border-white/10">
            <button
              onClick={onAddItem}
              className="text-xs text-gray-200 hover:text-amber-300 transition-colors"
            >
              + Add item
            </button>
            {billTotal > 0 && (
              <div className="text-xs font-mono text-gray-200">
                Subtotal:{" "}
                <span className="text-white font-semibold">
                  ZMW {billTotal.toLocaleString("en-ZM", { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  onUpdate,
  onRemove,
}: {
  item: BOQItem;
  onUpdate: (field: keyof BOQItem, value: string | number | null) => void;
  onRemove: () => void;
}) {
  const amount = item.amount ?? (item.qty !== null && item.rate !== null ? item.qty * item.rate : null);
  const placeholder = unresolvedPlaceholder(item);

  if (item.is_header) {
    return (
      <tr className="border-b border-white/10 bg-[#1a1f28]">
        <td colSpan={6} className="px-3 py-2 text-gray-100 font-semibold text-xs uppercase tracking-wide">
          {item.description}
        </td>
        <td>
          <button onClick={onRemove} className="px-1 text-gray-400 hover:text-red-300 text-xs">
            ✕
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-white/10 group hover:bg-white/[0.04]">
      <td className="px-3 py-1.5">
        <input
          className="boq-cell-editable text-gray-200 font-mono w-full"
          value={item.item_no}
          onChange={(e) => onUpdate("item_no", e.target.value)}
        />
      </td>
      <td className="px-3 py-1.5 max-w-xs">
        <textarea
          className="boq-cell-editable text-white w-full min-h-[1.25rem]"
          value={item.description}
          rows={item.description.length > 80 ? 2 : 1}
          onChange={(e) => onUpdate("description", e.target.value)}
        />
      </td>
      <td className="px-2 py-1.5 text-center">
        <input
          className="boq-cell-editable text-gray-100 text-center w-full"
          value={item.unit}
          onChange={(e) => onUpdate("unit", e.target.value)}
        />
      </td>
      <td className="px-2 py-1.5 text-right">
        <input
          className="boq-cell-editable text-gray-100 text-right w-full font-mono"
          value={item.qty ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onUpdate("qty", v === "" ? null : parseFloat(v) || null);
          }}
        />
      </td>
      <td className="px-2 py-1.5 text-right">
        <input
          className="boq-cell-editable text-amber-200 text-right w-full font-mono"
          placeholder="—"
          value={item.rate ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onUpdate("rate", v === "" ? null : parseFloat(v) || null);
          }}
        />
      </td>
      <td className="px-2 py-1.5 text-right font-mono text-gray-100">
        {item.note === "Incl" ? (
          <span className="text-gray-200 italic">{item.note}</span>
        ) : amount !== null ? (
          amount.toLocaleString("en-ZM", { minimumFractionDigits: 2 })
        ) : placeholder ? (
          <span className="text-gray-300 italic">{placeholder}</span>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
      <td>
        <button
          onClick={onRemove}
          className="px-1 text-transparent group-hover:text-gray-300 hover:!text-red-300 text-xs transition-colors"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-gray-300 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
