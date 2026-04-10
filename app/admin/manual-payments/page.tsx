"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type PendingManualPayment = {
  id: string;
  title: string;
  created_at: string;
  manual_payment_requested_at: string | null;
  manual_payment_contact: string | null;
  payment_status: "preview" | "paid";
  processing_status: "pending" | "processing" | "failed" | "completed";
  source_excel_key: string | null;
  user_email: string | null;
};

export default function ManualPaymentsAdminPage() {
  const router = useRouter();
  const [items, setItems] = useState<PendingManualPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login?next=/admin/manual-payments");
        return;
      }

      const res = await fetch("/api/admin/manual-payments", { cache: "no-store" });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error || "Could not load manual payments");
        setLoading(false);
        return;
      }

      setItems(body.items || []);
      setLoading(false);
    }

    void load();
  }, [router]);

  async function handleApprove(boqId: string) {
    setApproving(boqId);
    setError(null);
    const reference = window.prompt("Optional payment reference or note:", "confirmed by admin");

    try {
      const res = await fetch("/api/admin/manual-payments/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boq_id: boqId,
          manual_payment_reference: reference ?? undefined,
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Could not approve payment");
      }

      setItems((prev) => prev.filter((item) => item.id !== boqId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not approve payment");
    } finally {
      setApproving(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-4 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-amber-300">Admin</p>
            <h1 className="mt-2 text-3xl font-bold">Manual Payments</h1>
            <p className="mt-2 text-sm text-gray-400">
              Review pending WhatsApp payments, approve them, and automatically email users their next link.
            </p>
          </div>
          <a
            href="/dashboard"
            className="rounded-lg bg-white/5 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
          >
            Back to dashboard
          </a>
        </div>

        {error ? (
          <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-[240px] items-center justify-center">
            <div className="h-6 w-6 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-16 text-center text-sm text-gray-400">
            No manual payments are waiting right now.
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-white/10 bg-white/[0.02] p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-white">{item.title || "Untitled BOQ"}</h2>
                      <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-300">
                        Awaiting payment
                      </span>
                    </div>
                    <div className="mt-2 space-y-1 text-sm text-gray-400">
                      <p>User: {item.user_email || item.id}</p>
                      <p>BOQ ID: {item.id}</p>
                      <p>
                        Requested:{" "}
                        {item.manual_payment_requested_at
                          ? new Date(item.manual_payment_requested_at).toLocaleString("en-ZM")
                          : "Unknown"}
                      </p>
                      {item.manual_payment_contact ? <p>WhatsApp: {item.manual_payment_contact}</p> : null}
                      <p>
                        Next step after email:{" "}
                        {item.source_excel_key && item.processing_status !== "completed"
                          ? "Resume processing"
                          : "Open completed BOQ"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleApprove(item.id)}
                      disabled={approving === item.id}
                      className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-amber-300 disabled:opacity-60"
                    >
                      {approving === item.id ? "Approving..." : "Approve & Email User"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
