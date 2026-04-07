"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import Footer from "@/components/Footer";
import { usePostHog } from "posthog-js/react";
import CreditBadge from "@/components/CreditBadge";

interface BOQRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  data: { bills?: Array<{ items?: Array<{ amount?: number | null; qty?: number | null; rate?: number | null }> }> };
}

export default function DashboardPage() {
  const router = useRouter();
  const ph = usePostHog();
  const [user, setUser] = useState<User | null>(null);
  const [boqs, setBOQs] = useState<BOQRow[]>([]);
  const [remainingCredits, setRemainingCredits] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

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

      const creditRes = await fetch("/api/credits");
      if (creditRes.ok) {
        const { remainingCredits } = await creditRes.json();
        setRemainingCredits(remainingCredits ?? 0);
      }
      setLoading(false);
    }
    load();
  }, [router]);

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
            <CreditBadge remainingCredits={remainingCredits} />
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
              {boqs.length === 0 ? "No BOQs yet" : `${boqs.length} BOQ${boqs.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <a
            href="/upload"
            className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-black text-sm font-semibold transition-colors"
          >
            + New BOQ
          </a>
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
        ) : (
          <div className="space-y-3">
            {boqs.map((boq) => {
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
                    <p className="font-medium text-white truncate">{boq.title}</p>
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
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleOpen(boq.id)}
                      disabled={opening === boq.id}
                      className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white text-xs font-medium transition-colors disabled:opacity-60"
                    >
                      {opening === boq.id ? "Opening..." : "Open"}
                    </button>
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
