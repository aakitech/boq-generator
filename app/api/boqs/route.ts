import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("boqs")
    .select("id, title, created_at, updated_at, data, payment_status, payment_source, processing_status, last_error, source_excel_key, manual_payment_requested_at")
    .or("payment_status.eq.paid,and(payment_source.eq.manual_whatsapp,manual_payment_requested_at.not.is.null)")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ boqs: data });
}
