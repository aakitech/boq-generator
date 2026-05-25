import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isManualPaymentAdmin } from "@/lib/auth/manual-payment-admin";
import Link from "next/link";

interface ServiceJob {
  id: string;
  title: string;
  customer_email: string | null;
  service_status: string;
  service_package: string | null;
  service_payment_reference: string | null;
  processing_status: string;
  created_at: string;
  service_delivered_at: string | null;
}

function StatusBadge({ job }: { job: ServiceJob }) {
  if (job.processing_status === "processing") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium bg-[#f59e0b]/10 text-[#f59e0b]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] animate-pulse" />
        Generating
      </span>
    );
  }
  if (job.processing_status === "failed") {
    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium bg-[#ef4444]/10 text-[#ef4444]">
        Failed
      </span>
    );
  }
  if (job.service_status === "delivered") {
    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium bg-[#262626] text-[#525252]">
        Delivered
      </span>
    );
  }
  if (job.processing_status === "completed" && job.service_status === "pending_review") {
    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium bg-[#3b82f6]/10 text-[#60a5fa]">
        Ready for Review
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium bg-[#262626] text-[#737373]">
      {job.processing_status}
    </span>
  );
}

const PACKAGE_LABELS: Record<string, string> = {
  boq_only: "BOQ Only",
  tender_pack: "Tender Pack",
  full_submission: "Full Submission",
};

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isManualPaymentAdmin(user)) {
    redirect("/login");
  }

  const db = createServiceClient();
  const { data: jobs, error } = await db
    .from("boqs")
    .select("id, title, customer_email, service_status, service_package, service_payment_reference, processing_status, created_at, service_delivered_at")
    .eq("service_tier", "done_for_you")
    .order("created_at", { ascending: false });

  const serviceJobs = (jobs ?? []) as ServiceJob[];
  const open = serviceJobs.filter((j) => j.service_status !== "delivered").length;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#f5f5f5]">
      <nav className="fixed top-0 left-0 right-0 z-20 border-b border-[#262626] bg-[#0a0a0a]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-6" style={{ height: 48 }}>
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 text-[13px] font-medium text-[#f5f5f5]">
              <div className="w-[7px] h-[7px] rounded-full bg-[#f59e0b]" />
              BOQ Generator
            </Link>
            <span className="text-[#404040]">/</span>
            <span className="text-[13px] text-[#737373]">Admin</span>
          </div>
          <Link
            href="/admin/service-job/new"
            className="rounded bg-[#f59e0b] hover:bg-[#fbbf24] px-4 py-1.5 text-[12px] font-semibold text-black transition-colors"
          >
            + New Job
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-[1100px] px-6 pt-20 pb-16">
        <div className="mb-8">
          <h1 className="font-serif text-[28px] font-normal text-[#f5f5f5] mb-1">Service Jobs</h1>
          <p className="text-[13px] text-[#737373]">
            {open > 0 ? `${open} open` : "All jobs delivered"} · {serviceJobs.length} total
          </p>
        </div>

        {error && (
          <div className="rounded border border-[#ef4444]/30 bg-[#ef4444]/5 px-4 py-3 text-[13px] text-[#ef4444] mb-6">
            Failed to load service jobs: {error.message}
          </div>
        )}

        {serviceJobs.length === 0 ? (
          <div className="rounded-[8px] border border-[#262626] bg-[#111] px-8 py-12 text-center">
            <p className="text-[13px] text-[#737373] mb-4">No service jobs yet.</p>
            <Link
              href="/admin/service-job/new"
              className="inline-block rounded bg-[#f59e0b] hover:bg-[#fbbf24] px-5 py-2 text-[13px] font-semibold text-black transition-colors"
            >
              Create first job
            </Link>
          </div>
        ) : (
          <div className="rounded-[8px] border border-[#262626] overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#262626] bg-[#111]">
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#404040]">Project</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#404040]">Customer</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#404040]">Package</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#404040]">Status</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#404040]">Created</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#404040]"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1c1c1c]">
                {serviceJobs.map((job) => (
                  <tr key={job.id} className="bg-[#0a0a0a] hover:bg-[#111] transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-[13px] text-[#f5f5f5] truncate max-w-[220px]">{job.title}</p>
                      {job.service_payment_reference && (
                        <p className="text-[11px] text-[#404040] font-mono mt-0.5">ref: {job.service_payment_reference}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[13px] text-[#737373] font-mono">{job.customer_email ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[12px] text-[#737373]">
                        {PACKAGE_LABELS[job.service_package ?? "boq_only"] ?? job.service_package ?? "—"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge job={job} />
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[12px] text-[#404040] font-mono">
                        {new Date(job.created_at).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {job.processing_status === "completed" && job.service_status === "pending_review" && (
                        <Link
                          href={`/boq/${job.id}?admin=1`}
                          className="rounded border border-[#262626] hover:bg-[#111] px-3 py-1.5 text-[12px] text-[#f5f5f5] transition-colors"
                        >
                          Review &amp; Approve
                        </Link>
                      )}
                      {job.service_status === "delivered" && job.service_delivered_at && (
                        <p className="text-[11px] text-[#404040] font-mono">
                          Sent {new Date(job.service_delivered_at).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                          })}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
