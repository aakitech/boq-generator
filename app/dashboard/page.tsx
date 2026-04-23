"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import Footer from "@/components/Footer";
import { usePostHog } from "posthog-js/react";
import CreditBadge from "@/components/CreditBadge";
import { getManualPaymentAdminConfig } from "@/lib/auth/manual-payment-admin";
import { useCredits } from "@/components/CreditsProvider";

interface BOQRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  payment_status: "preview" | "paid";
  payment_source?: "stripe" | "manual_whatsapp" | null;
  manual_payment_requested_at?: string | null;
  processing_status: "pending" | "processing" | "failed" | "completed";
  last_error?: string | null;
  source_excel_key?: string | null;
  data: { bills?: Array<{ items?: Array<{ amount?: number | null; qty?: number | null; rate?: number | null }> }> };
}

type DashboardFilter = "all" | "awaiting_payment" | "processing" | "needs_retry" | "completed";

export default function DashboardPage() {
  const adminConfig = getManualPaymentAdminConfig();
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

  const isManualPaymentAdmin = Boolean(
    user?.email && adminConfig.allowedEmails.includes(user.email.trim().toLowerCase())
  );

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

  async function handleOpen(id: string) {
    setOpening(id);
    router.push(`/boq/${id}`);
  }

  async function handleResume(id: string) {
    setOpening(id);
    router.push(`/generating?boq_id=${id}`);
  }

  function isAwaitingManualApproval(boq: BOQRow) {
    return (
      boq.payment_status === "preview" &&
      boq.payment_source === "manual_whatsapp" &&
      Boolean(boq.manual_payment_requested_at)
    );
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

  function statusBadge(boq: BOQRow) {
    if (isAwaitingManualApproval(boq)) {
      return <span className="inline-flex rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-300">Awaiting payment</span>;
    }
    if (boq.processing_status === "completed") {
      return <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">Completed</span>;
    }
    if (boq.processing_status === "failed") {
      return <span className="inline-flex rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-300">Needs retry</span>;
    }
    return <span className="inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">Processing</span>;
  }

  function matchesFilter(boq: BOQRow) {
    if (activeFilter === "all") return true;
    if (activeFilter === "awaiting_payment") return isAwaitingManualApproval(boq);
    if (activeFilter === "completed") return boq.processing_status === "completed" && !isAwaitingManualApproval(boq);
    if (activeFilter === "needs_retry") return boq.processing_status === "failed";
    return boq.processing_status === "pending" || boq.processing_status === "processing";
  }

  const filteredBoqs = useMemo(() => boqs.filter(matchesFilter), [activeFilter, boqs]);

  const filterOptions: Array<{ key: DashboardFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "awaiting_payment", label: "Awaiting Payment" },
    { key: "processing", label: "Processing" },
    { key: "needs_retry", label: "Needs Retry" },
    { key: "completed", label: "Completed" },
  ];

  function filterCount(filter: DashboardFilter) {
    return boqs.filter((boq) => {
      if (filter === "all") return true;
      if (filter === "awaiting_payment") return isAwaitingManualApproval(boq);
      if (filter === "completed") return boq.processing_status === "completed" && !isAwaitingManualApproval(boq);
      if (filter === "needs_retry") return boq.processing_status === "failed";
      return boq.processing_status === "pending" || boq.processing_status === "processing";
    }).length;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Nav */}
      <header className="border-b border-white/10 bg-[#0a0a0a]/95 backdrop-blur sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/">
              <img src="/boqlogo.png" alt="BOQ Generator" className="h-7 w-auto" width="28" height="28" />
            </a>
            {!loadingCredits ? <CreditBadge remainingCredits={remainingCredits} /> : null}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 hidden sm:block">{user?.email}</span>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <main className="w-full flex-1 max-w-5xl mx-auto px-4 py-8 sm:py-10">
        {/* Header row */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Your BOQs</h1>
            <p className="text-gray-500 text-sm mt-1">
              {filteredBoqs.length === 0 ? "No BOQs in this view" : `${filteredBoqs.length} BOQ${filteredBoqs.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isManualPaymentAdmin ? (
              <a
                href="/admin/manual-payments"
                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-colors"
              >
                Manual Payments
              </a>
            ) : null}
            <a
              href="/upload"
              className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-black text-sm font-semibold transition-colors"
            >
              + New BOQ
            </a>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {filterOptions.map((filter) => (
            <button
              key={filter.key}
              onClick={() => setActiveFilter(filter.key)}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                activeFilter === filter.key
                  ? "bg-amber-400 text-black"
                  : "bg-white/[0.04] text-gray-300 hover:bg-white/[0.08]"
              }`}
            >
              <span>{filter.label}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  activeFilter === filter.key ? "bg-black/10 text-black" : "bg-white/10 text-gray-400"
                }`}
              >
                {filterCount(filter.key)}
              </span>
            </button>
          ))}
        </div>

        {boqs.length === 0 ? (
          <div className="text-center py-24 space-y-4">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto">
              <DocumentIcon className="w-8 h-8 text-gray-600" />
            </div>
            <p className="text-gray-500">No BOQs yet. Upload a SOW to get started.</p>
            <a
              href="/upload"
              className="inline-block px-6 py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-semibold text-sm transition-colors"
            >
              Generate your first BOQ →
            </a>
          </div>
        ) : filteredBoqs.length === 0 ? (
          <div className="text-center py-20 rounded-xl border border-white/10 bg-white/[0.02]">
            <p className="text-sm text-gray-400">No BOQs match this filter right now.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredBoqs.map((boq) => {
              const total = grandTotal(boq);
              return (
                <div
                  key={boq.id}
                  className="rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-colors p-4 flex items-center gap-4"
                >
                  <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                    <DocumentIcon className="w-5 h-5 text-amber-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="font-medium text-white truncate">{boq.title}</p>
                      {statusBadge(boq)}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {new Date(boq.created_at).toLocaleDateString("en-ZM", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {total > 0 && (
                        <span className="ml-3 text-amber-400/80 font-mono">
                          ZMW {total.toLocaleString("en-ZM", { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </p>
                    {isAwaitingManualApproval(boq) ? (
                      <p className="mt-1 text-xs text-gray-400">
                        Manual payment requested. Your BOQ will unlock once payment is confirmed.
                      </p>
                    ) : null}
                    {boq.processing_status === "failed" && boq.last_error ? (
                      <p className="mt-1 text-xs text-gray-500 truncate">
                        {boq.last_error}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isAwaitingManualApproval(boq) ? (
                      <button
                        disabled
                        className="px-3 py-1.5 rounded-lg bg-white/5 text-gray-400 text-xs font-medium cursor-not-allowed"
                      >
                        Awaiting payment
                      </button>
                    ) : boq.processing_status === "completed" ? (
                      <button
                        onClick={() => handleOpen(boq.id)}
                        disabled={opening === boq.id}
                        className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white text-xs font-medium transition-colors disabled:opacity-60"
                      >
                        {opening === boq.id ? "Opening..." : "Open"}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleResume(boq.id)}
                        disabled={opening === boq.id}
                        className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-black text-xs font-semibold transition-colors disabled:opacity-60"
                      >
                        {opening === boq.id ? "Opening..." : "Resume"}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(boq.id)}
                      disabled={deleting === boq.id}
                      className="px-3 py-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 text-xs font-medium transition-colors disabled:opacity-50"
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
