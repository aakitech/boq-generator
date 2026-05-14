"use client";

import { useState, useMemo } from "react";
import type { BOQDocument, BOQItem } from "@/lib/types";

interface Props {
  boq: BOQDocument;
  onSave: (updated: BOQDocument) => void;
  onApprove: (updated: BOQDocument) => void;
}

type Bucket = "matched" | "estimated" | "unrated";

function getBucket(item: BOQItem): Bucket {
  if (item.rate === null || item.rate_skip_reason) return "unrated";
  if (item.rate_source === "embedded_market_heuristic") return "estimated";
  if (
    item.rate_source === "workbook_local_pattern" ||
    item.rate_source === "project_consistency_inference" ||
    item.rate_source === "existing_workbook_rate"
  ) return "matched";
  // external_reference_document and manual_override: use confidence as tiebreaker
  if (item.rate_confidence != null && item.rate_confidence >= 0.4) return "matched";
  if (item.rate_confidence != null && item.rate_confidence < 0.4) return "estimated";
  return "matched";
}

const BUCKET_LABELS: Record<Bucket, string> = {
  matched: "Matched from library",
  estimated: "AI estimated — review",
  unrated: "Missing — needs rate",
};

const BUCKET_COLOURS: Record<Bucket, { dot: string; badge: string; row: string }> = {
  matched:   { dot: "bg-[#22c55e]", badge: "text-[#22c55e] bg-[#22c55e]/10", row: "" },
  estimated: { dot: "bg-[#f59e0b]", badge: "text-[#f59e0b] bg-[#f59e0b]/10", row: "bg-[#f59e0b]/5" },
  unrated:   { dot: "bg-[#ef4444]", badge: "text-[#ef4444] bg-[#ef4444]/10", row: "bg-[#ef4444]/5" },
};

function flatItems(boq: BOQDocument): Array<{ billTitle: string; item: BOQItem }> {
  return boq.bills.flatMap((bill) =>
    bill.items
      .filter((item) => !item.is_header && item.workbook_row_kind !== "header")
      .map((item) => ({ billTitle: bill.title, item }))
  );
}

export default function RateReviewPanel({ boq, onSave, onApprove }: Props) {
  const [rates, setRates] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const all = useMemo(() => flatItems(boq), [boq]);

  const buckets = useMemo(() => {
    const matched: typeof all = [];
    const estimated: typeof all = [];
    const unrated: typeof all = [];
    for (const row of all) {
      const b = getBucket(row.item);
      if (b === "matched") matched.push(row);
      else if (b === "estimated") estimated.push(row);
      else unrated.push(row);
    }
    return { matched, estimated, unrated };
  }, [all]);

  const unratedCount = buckets.unrated.filter((r) => {
    const key = r.item.item_key ?? r.item.item_no;
    const edited = rates[key ?? ""];
    return !edited || isNaN(parseFloat(edited)) || parseFloat(edited) <= 0;
  }).length;

  const canApprove = unratedCount === 0;

  function handleRateChange(item: BOQItem, value: string) {
    const key = item.item_key ?? item.item_no ?? "";
    setRates((prev) => ({ ...prev, [key]: value }));
  }

  async function handleApprove() {
    setSaving(true);
    // Apply edited rates back into the BOQDocument
    const updated: BOQDocument = {
      ...boq,
      bills: boq.bills.map((bill) => ({
        ...bill,
        items: bill.items.map((item) => {
          const key = item.item_key ?? item.item_no ?? "";
          const edited = rates[key];
          if (!edited) return item;
          const rate = parseFloat(edited);
          if (isNaN(rate) || rate <= 0) return item;
          const amount = item.qty != null ? +(item.qty * rate).toFixed(2) : item.amount;
          return { ...item, rate, amount, rate_source: "manual_override" as const };
        }),
      })),
    };
    setSaving(false);
    onApprove(updated);
  }

  return (
    <div
      className="flex flex-col h-full border border-[#262626] rounded-lg bg-[#111] overflow-hidden"
      style={{ fontFamily: "Geist, sans-serif" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#262626]">
        <div>
          <p className="text-[13px] font-semibold text-[#f5f5f5] tracking-tight">Rate Review</p>
          <p className="text-[11px] text-[#737373] mt-0.5">
            {buckets.matched.length} matched · {buckets.estimated.length} estimated · {buckets.unrated.length} unrated
          </p>
        </div>
        <div className="flex gap-2">
          {(["matched", "estimated", "unrated"] as Bucket[]).map((b) => (
            <span
              key={b}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${BUCKET_COLOURS[b].badge}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${BUCKET_COLOURS[b].dot}`} />
              {b === "matched" ? buckets.matched.length : b === "estimated" ? buckets.estimated.length : buckets.unrated.length}
            </span>
          ))}
        </div>
      </div>

      {/* Scrollable item list */}
      <div className="flex-1 overflow-y-auto">
        {(["unrated", "estimated", "matched"] as Bucket[]).map((bucket) => {
          const rows = buckets[bucket];
          if (rows.length === 0) return null;
          return (
            <div key={bucket}>
              <div className="sticky top-0 z-10 px-4 py-1.5 bg-[#0f0f0f] border-b border-[#1c1c1c]">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[#404040]">
                  {BUCKET_LABELS[bucket]} ({rows.length})
                </span>
              </div>
              {rows.map(({ billTitle, item }) => {
                const key = item.item_key ?? item.item_no ?? "";
                const editedVal = rates[key];
                const displayRate = editedVal !== undefined ? editedVal : (item.rate?.toString() ?? "");
                const colours = BUCKET_COLOURS[bucket];
                return (
                  <div
                    key={key}
                    className={`flex items-start gap-3 px-4 py-2.5 border-b border-[#1c1c1c] ${colours.row}`}
                  >
                    <span className={`mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${colours.dot}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-[#f5f5f5] leading-snug line-clamp-2">
                        {item.description}
                      </p>
                      <p className="text-[10px] text-[#737373] mt-0.5">
                        {billTitle} · {item.unit}
                        {item.rate_source_detail && (
                          <span className="ml-1 text-[#404040]">· {item.rate_source_detail.slice(0, 60)}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-1">
                      <span className="text-[11px] text-[#737373]">ZMW</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={displayRate}
                        onChange={(e) => handleRateChange(item, e.target.value)}
                        placeholder="—"
                        className={`w-24 text-right text-[12px] font-mono bg-[#1a1a1a] border rounded px-2 py-1 text-[#f5f5f5] focus:outline-none focus:border-[#f59e0b] transition-colors
                          ${bucket === "unrated" && !editedVal ? "border-[#ef4444]/50" : "border-[#262626]"}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[#262626] bg-[#0f0f0f]">
        {unratedCount > 0 && (
          <p className="text-[11px] text-[#737373] mb-2">
            {unratedCount} item{unratedCount > 1 ? "s" : ""} still need{unratedCount === 1 ? "s" : ""} a rate before you can approve.
          </p>
        )}
        <button
          onClick={handleApprove}
          disabled={!canApprove || saving}
          className={`w-full py-2 rounded text-[13px] font-medium transition-colors
            ${canApprove
              ? "bg-[#f59e0b] text-black hover:bg-[#fbbf24] cursor-pointer"
              : "bg-[#1a1a1a] text-[#404040] cursor-not-allowed border border-[#262626]"}`}
        >
          {saving ? "Saving…" : canApprove ? "Approve & enable download" : "Approve & enable download"}
        </button>
      </div>
    </div>
  );
}
