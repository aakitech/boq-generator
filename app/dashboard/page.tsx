"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import Footer from "@/components/Footer";
import { usePostHog } from "posthog-js/react";
import CreditBadge from "@/components/CreditBadge";
import { useCredits } from "@/components/CreditsProvider";

interface BOQRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  payment_status: "preview" | "paid";
  processing_status: "pending" | "processing" | "failed" | "completed";
  last_error?: string | null;
  source_excel_key?: string | null;
  data: { bills?: Array<{ items?: Array<{ amount?: number | null; qty?: number | null; rate?: number | null }> }> };
}

type DashboardFilter = "all" | "processing" | "needs_retry" | "completed";

export default function DashboardPage() {
  const router = useRouter();
  const ph = usePostHog();
  const [user, setUser] = useState<User | null>(null);
  const [boqs, setBOQs] = useState<BOQRow[]>([]);
  const { remainingCredits, loadingCredits } = useCredits();
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [activeFilter, setActiveFilter] = useState<DashboardFilter>("all");

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }
      setUser(user);
      ph.identify(user.id, { email: user.email });
      const res = await fetch("/api/boqs");
      if (res.ok) {
        const { boqs } = await res.json();
        setBOQs(boqs || []);
      }
      setLoading(false);
    }
    load();
  }, [ph, router]);

  useEffect(() => {
    if (!user) return;
    const interval = window.setInterval(async () => {
      const res = await fetch("/api/boqs", { cache: "no-store" });
      if (!res.ok) return;
      const { boqs } = await res.json();
      setBOQs(boqs || []);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [user]);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this BOQ? This cannot be undone.")) return;
    setDeleting(id);
    await fetch(`/api/boqs/${id}`, { method: "DELETE" });
    setBOQs((prev) => prev.filter((b) => b.id !== id));
    setDeleting(null);
  }

  function grandTotal(boq: BOQRow): number {
    return (boq.data.bills ?? []).reduce((sum, bill) => {
      return sum + (bill.items ?? []).reduce((s, it) => {
        const amt = it.amount ?? (it.qty != null && it.rate != null ? it.qty * it.rate : null);
        return amt != null ? s + amt : s;
      }, 0);
    }, 0);
  }

  function isProcessing(boq: BOQRow) {
    return boq.processing_status === "pending" || boq.processing_status === "processing";
  }

  function statusBadge(boq: BOQRow) {
    if (boq.processing_status === "completed") {
      return <span className="inline-flex rounded-[4px] border border-[#22c55e]/20 bg-[#22c55e]/8 px-2 py-0.5 text-[11px] font-medium text-[#22c55e]">✓ Completed</span>;
    }
    if (boq.processing_status === "failed") {
      return <span className="inline-flex rounded-[4px] border border-[#ef4444]/20 bg-[#ef4444]/8 px-2 py-0.5 text-[11px] font-medium text-[#ef4444]">✗ Failed</span>;
    }
    return <span className="inline-flex rounded-[4px] border border-[#f59e0b]/20 bg-[#f59e0b]/10 px-2 py-0.5 text-[11px] font-medium text-[#f59e0b]">⧗ Generating</span>;
  }

  function matchesFilter(boq: BOQRow) {
    if (activeFilter === "all") return true;
    if (activeFilter === "completed") return boq.processing_status === "completed";
    if (activeFilter === "needs_retry") return boq.processing_status === "failed";
    return isProcessing(boq);
  }

  const filteredBoqs = useMemo(() => boqs.filter(matchesFilter), [activeFilter, boqs]);

  const filterOptions: Array<{ key: DashboardFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "processing", label: "Processing" },
    { key: "needs_retry", label: "Needs Retry" },
    { key: "completed", label: "Completed" },
  ];

  function filterCount(filter: DashboardFilter) {
    return boqs.filter((boq) => {
      if (filter === "all") return true;
      if (filter === "completed") return boq.processing_status === "completed";
      if (filter === "needs_retry") return boq.processing_status === "failed";
      return isProcessing(boq);
    }).length;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#f59e0b] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      <header className="border-b border-[#262626] bg-[#0a0a0a]/92 backdrop-blur sticky top-0 z-20">
        <div className="max-w-[960px] mx-auto px-6 flex items-center justify-between" style={{ height: 48 }}>
          <div className="flex items-center gap-4">
            <a href="/" className="flex items-center gap-2 text-[13px] font-medium text-[#f5f5f5]">
              <div className="w-[7px] h-[7px] rounded-full bg-[#f59e0b]" />
              BOQ Generator
            </a>
            {!loadingCredits ? <CreditBadge remainingCredits={remainingCredits} /> : null}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[12px] text-[#404040] hidden sm:block">{user?.email}</span>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="text-[12px] text-[#737373] hover:text-[#f5f5f5] transition-colors"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[960px] mx-auto w-full px-6 py-10">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="font-serif text-[24px] font-normal text-[#f5f5f5]">Your BOQs</h1>
            <p className="text-[#737373] text-[12px] mt-1">{boqs.length} BOQ{boqs.length !== 1 ? "s" : ""}</p>
          </div>
          <a href="/upload" className="rounded bg-[#f59e0b] hover:bg-[#fbbf24] px-4 py-2 text-[11px] font-semibold text-black transition-colors">
            + New BOQ
          </a>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {filterOptions.map((filter) => (
            <button
              key={filter.key}
              onClick={() => setActiveFilter(filter.key)}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] font-medium transition-colors ${
                activeFilter === filter.key
                  ? "bg-[#f59e0b] text-black"
                  : "bg-[#111] border border-[#262626] text-[#737373] hover:text-[#f5f5f5]"
              }`}
            >
              {filter.label}
              <span className={`rounded-[4px] px-1.5 py-0.5 text-[10px] font-mono ${activeFilter === filter.key ? "bg-black/15 text-black" : "bg-[#1a1a1a] text-[#404040]"}`}>
                {filterCount(filter.key)}
              </span>
            </button>
          ))}
        </div>

        {boqs.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-[#737373] text-[13px] mb-6">No BOQs yet.</p>
            <a href="/upload" className="inline-block rounded bg-[#f59e0b] hover:bg-[#fbbf24] px-6 py-2.5 text-[13px] font-semibold text-black transition-colors">
              Generate your first BOQ →
            </a>
          </div>
        ) : filteredBoqs.length === 0 ? (
          <div className="text-center py-16 rounded border border-[#262626]">
            <p className="text-[13px] text-[#737373]">No BOQs match this filter.</p>
          </div>
        ) : (
          <div className="space-y-[5px]">
            {filteredBoqs.map((boq) => {
              const total = grandTotal(boq);
              const processing = isProcessing(boq);
              return (
                <div
                  key={boq.id}
                  className={`rounded border p-[12px_14px] flex items-center justify-between gap-4 transition-colors ${
                    processing
                      ? "border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.02)]"
                      : "border-[#262626] bg-[#0a0a0a] hover:bg-[#111] cursor-pointer"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13px] font-medium text-[#f5f5f5] truncate">{boq.title}</p>
                      {processing && <span className="text-[11px] text-[#f59e0b] font-normal">⧗ Generating...</span>}
                      {!processing && statusBadge(boq)}
                    </div>
                    <p className="text-[11px] text-[#404040] mt-0.5">
                      {new Date(boq.created_at).toLocaleDateString("en-ZM", { day: "numeric", month: "short", year: "numeric" })}
                      {total > 0 && (
                        <span className="ml-3 font-mono tabular-nums text-[#737373]">
                          ZMW {total.toLocaleString("en-ZM", { minimumFractionDigits: 2 })}
                        </span>
                      )}
                      {processing && <span className="ml-3 text-[#404040]">—</span>}
                    </p>
                    {boq.processing_status === "failed" && boq.last_error && (
                      <p className="mt-0.5 text-[11px] text-[#737373] truncate">{boq.last_error}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {boq.processing_status === "completed" ? (
                      <button
                        onClick={() => { setOpening(boq.id); router.push(`/boq/${boq.id}`); }}
                        disabled={opening === boq.id}
                        className="px-3 py-1.5 rounded border border-[#262626] hover:bg-[#1a1a1a] text-[#f5f5f5] text-[12px] font-medium transition-colors disabled:opacity-50"
                      >
                        {opening === boq.id ? "Opening…" : "Open"}
                      </button>
                    ) : processing ? (
                      <button
                        onClick={() => { setOpening(boq.id); router.push(`/generating?boq_id=${boq.id}`); }}
                        disabled={opening === boq.id}
                        className="px-3 py-1.5 rounded bg-[#f59e0b] hover:bg-[#fbbf24] text-black text-[12px] font-semibold transition-colors disabled:opacity-50"
                      >
                        {opening === boq.id ? "…" : "View"}
                      </button>
                    ) : (
                      <button
                        onClick={() => { setOpening(boq.id); router.push(`/generating?boq_id=${boq.id}`); }}
                        disabled={opening === boq.id}
                        className="px-3 py-1.5 rounded border border-[#262626] hover:bg-[#1a1a1a] text-[#f5f5f5] text-[12px] font-medium transition-colors disabled:opacity-50"
                      >
                        Retry
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(boq.id)}
                      disabled={deleting === boq.id}
                      className="px-3 py-1.5 rounded text-[#404040] hover:text-[#ef4444] hover:bg-[rgba(239,68,68,0.06)] text-[12px] transition-colors disabled:opacity-50"
                    >
                      {deleting === boq.id ? "…" : "Delete"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}
