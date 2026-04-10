import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { STARTER_CREDITS, getRemainingCredits } from "@/lib/credits";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const remainingCredits = await getRemainingCredits(supabase, user.id);

  return NextResponse.json({
    remainingCredits,
    starterCredits: STARTER_CREDITS,
  });
}
