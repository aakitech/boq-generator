import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isManualPaymentAdmin } from "@/lib/auth/manual-payment-admin";
import NewServiceJobForm from "./NewServiceJobForm";
import Link from "next/link";

export default async function NewServiceJobPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isManualPaymentAdmin(user)) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#f5f5f5]">
      <nav className="fixed top-0 left-0 right-0 z-20 border-b border-[#262626] bg-[#0a0a0a]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[720px] items-center gap-3 px-6" style={{ height: 48 }}>
          <Link href="/admin" className="text-[13px] text-[#737373] hover:text-[#f5f5f5] transition-colors">
            ← Admin
          </Link>
          <span className="text-[#404040]">/</span>
          <span className="text-[13px] text-[#f5f5f5]">New Service Job</span>
        </div>
      </nav>

      <main className="mx-auto max-w-[720px] px-6 pt-20 pb-16">
        <div className="mb-8">
          <h1 className="font-serif text-[28px] font-normal text-[#f5f5f5] mb-2">New Service Job</h1>
          <p className="text-[13px] text-[#737373]">
            Upload the customer&apos;s project documents and fill in their details. Generation starts immediately after submission.
          </p>
        </div>

        <NewServiceJobForm />
      </main>
    </div>
  );
}
