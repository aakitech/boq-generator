import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isManualPaymentAdmin } from "@/lib/auth/manual-payment-admin";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isManualPaymentAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const serviceClient = createServiceClient();
  const { data: boqs, error } = await serviceClient
    .from("boqs")
    .select("id, user_id, title, created_at, manual_payment_requested_at, manual_payment_contact, payment_status, processing_status, source_excel_key")
    .eq("payment_source", "manual_whatsapp")
    .eq("payment_status", "preview")
    .not("manual_payment_requested_at", "is", null)
    .order("manual_payment_requested_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = Array.from(new Set((boqs ?? []).map((boq) => boq.user_id).filter(Boolean)));
  let emailMap = new Map<string, string | null>();

  if (userIds.length > 0) {
    const { data: profiles } = await serviceClient
      .from("profiles")
      .select("id, email")
      .in("id", userIds);

    emailMap = new Map((profiles ?? []).map((profile) => [profile.id, profile.email ?? null]));
  }

  const items = (boqs ?? []).map((boq) => ({
    ...boq,
    user_email: emailMap.get(boq.user_id) ?? null,
  }));

  return NextResponse.json({ items });
}
