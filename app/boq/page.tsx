"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BOQDocument } from "@/lib/types";
import CreditBadge from "@/components/CreditBadge";

function countItems(boq: BOQDocument): number {
  return boq.bills.reduce((sum, bill) => sum + bill.items.filter((item) => !item.is_header).length, 0);
}

function totalAmount(boq: BOQDocument): number {
  return boq.bills.reduce(
    (sum, bill) =>
      sum +
      bill.items.reduce((billSum, item) => {
        if (item.is_header) return billSum;
        const amount = item.amount ?? (item.qty !== null && item.rate !== null ? item.qty * item.rate : null);
        return amount !== null ? billSum + amount : billSum;
      }, 0),
    0
  );
}

export default function BOQPreviewPage() {
  const router = useRouter();
  const [boq, setBoq] = useState<BOQDocument | null>(null);
  const [remainingCredits, setRemainingCredits] = useState<number | null>(null);

  useEffect(() => {
    const raw =
      localStorage.getItem("boq_data") ??
      sessionStorage.getItem("boq_data");

    if (!raw) {
      router.replace("/dashboard");
      return;
    }

    try {
      const parsed = JSON.parse(raw) as BOQDocument;
      setBoq(parsed);
    } catch {
      localStorage.removeItem("boq_data");
      sessionStorage.removeItem("boq_data");
      router.replace("/dashboard");
    }
  }, [router]);

  useEffect(() => {
    async function loadCredits() {
      const res = await fetch("/api/credits");
      if (!res.ok) return;
      const body = (await res.json()) as { remainingCredits?: number };
      setRemainingCredits(body.remainingCredits ?? 0);
    }

    void loadCredits();
  }, []);

  const itemCount = useMemo(() => (boq ? countItems(boq) : 0), [boq]);
  const grandTotal = useMemo(() => (boq ? totalAmount(boq) : 0), [boq]);

  if (!boq) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white px-4 py-8">
      <div className="max-w-5xl mx-auto mb-6 flex items-center justify-between gap-4">
        <a href="/">
          <img src="/boqlogo.png" alt="BOQ Generator" className="h-7 w-auto" width="28" height="28" />
        </a>
        {remainingCredits !== null ? <CreditBadge remainingCredits={remainingCredits} /> : null}
      </div>

      <div className="max-w-5xl mx-auto space-y-6">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <h1 className="text-xl font-semibold">Generated BOQ preview</h1>
          <p className="text-sm text-amber-100/90 mt-1">
            The BOQ was generated, but it was not saved to the database. You can still review the output here.
          </p>
          <p className="text-xs text-amber-100/70 mt-2">
            This usually means a database migration or save configuration issue still needs attention.
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-2">
          <h2 className="text-2xl font-bold">{boq.project || "Untitled BOQ"}</h2>
          <p className="text-sm text-gray-400">
            {boq.location || "Unknown location"} · {boq.prepared_by || "BOQ Generator"} · {boq.date || "No date"}
          </p>
          <p className="text-sm text-gray-300">
            {boq.bills.length} bills · {itemCount} items · ZMW {grandTotal.toLocaleString("en-ZM", { minimumFractionDigits: 2 })}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => router.push("/upload")}
            className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-black text-sm font-semibold transition-colors"
          >
            Rate another BOQ
          </button>
          <button
            onClick={() => router.push("/dashboard")}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-colors"
          >
            Go to dashboard
          </button>
        </div>

        <div className="space-y-4">
          {boq.bills.map((bill, billIndex) => (
            <section key={`${bill.number}-${billIndex}`} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <h3 className="text-lg font-semibold text-amber-300">
                Bill {bill.number}: {bill.title}
              </h3>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-white/10">
                      <th className="py-2 pr-3">Item</th>
                      <th className="py-2 pr-3">Description</th>
                      <th className="py-2 pr-3">Unit</th>
                      <th className="py-2 pr-3">Qty</th>
                      <th className="py-2 pr-3">Rate</th>
                      <th className="py-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bill.items.map((item, itemIndex) => (
                      <tr key={`${billIndex}-${itemIndex}`} className="border-b border-white/5 align-top">
                        <td className="py-2 pr-3 text-gray-300">{item.item_no || ""}</td>
                        <td className={`py-2 pr-3 ${item.is_header ? "font-semibold text-amber-200" : "text-white"}`}>
                          {item.description}
                        </td>
                        <td className="py-2 pr-3 text-gray-300">{item.is_header ? "" : item.unit}</td>
                        <td className="py-2 pr-3 text-gray-300">{item.is_header ? "" : item.qty ?? ""}</td>
                        <td className="py-2 pr-3 text-gray-300">{item.is_header ? "" : item.rate ?? item.note ?? ""}</td>
                        <td className="py-2 text-gray-300">
                          {item.is_header ? "" : item.amount ?? (item.qty !== null && item.rate !== null ? (item.qty * item.rate).toFixed(2) : "")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
