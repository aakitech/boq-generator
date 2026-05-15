import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { sendInngestEvent } from "@/lib/inngest";
import { logger } from "@/lib/logger";
import { getRemainingCredits } from "@/lib/credits";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: boqId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServiceClient();

  // Verify BOQ belongs to user and is in a retryable state
  const { data: boq, error: boqErr } = await db
    .from("boqs")
    .select("id, user_id, processing_status, title")
    .eq("id", boqId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (boqErr || !boq) return NextResponse.json({ error: "BOQ not found" }, { status: 404 });
  if (boq.processing_status === "completed") return NextResponse.json({ error: "BOQ already completed" }, { status: 400 });
  if (boq.processing_status === "processing") return NextResponse.json({ error: "BOQ is already being processed" }, { status: 400 });

  // Check credits
  const remainingCredits = await getRemainingCredits(db, user.id);
  if (remainingCredits < 500) {
    return NextResponse.json({ error: "insufficient_credits", remainingCredits }, { status: 402 });
  }

  // Load stored extracted documents
  const { data: extractedDocs, error: docsErr } = await db
    .from("extracted_documents")
    .select("filename, text, pages, drawing_type, subject_name, used_vision")
    .eq("boq_id", boqId)
    .order("created_at", { ascending: true });

  if (docsErr || !extractedDocs?.length) {
    return NextResponse.json({ error: "No extracted documents found for this BOQ — please re-upload and generate again." }, { status: 400 });
  }

  // Rebuild documents array in the shape the Inngest job expects
  const documents = extractedDocs.map((doc, i) => ({
    document_id: `retry-doc-${i}`,
    document_type: "construction_sow" as const,
    name: doc.filename,
    role: i === 0 ? ("primary" as const) : ("supporting" as const),
    text: doc.text,
    pages: doc.pages ?? null,
    drawing_type: doc.drawing_type ?? null,
    subject_name: doc.subject_name ?? null,
  }));

  // Reset BOQ to pending so the Inngest job can update it
  const { error: resetErr } = await db
    .from("boqs")
    .update({
      processing_status: "pending",
      processing_failed_at: null,
      processing_context: null,
      last_error: null,
    })
    .eq("id", boqId);

  if (resetErr) {
    logger.error("retry: failed to reset BOQ status", { boqId, error: String(resetErr) });
    return NextResponse.json({ error: "Failed to reset BOQ for retry" }, { status: 500 });
  }

  // Re-fire Inngest event
  try {
    await sendInngestEvent({
      name: "boq/generate.requested",
      data: {
        boq_id: boqId,
        documents,
        user_id: user.id,
        user_email: user.email ?? "",
      },
    });
  } catch (err) {
    // Roll back status on failure
    await db.from("boqs").update({ processing_status: "failed" }).eq("id", boqId);
    logger.error("retry: failed to send inngest event", { boqId, error: String(err) });
    return NextResponse.json({ error: "Failed to enqueue retry job" }, { status: 500 });
  }

  logger.info("retry: re-queued generation", { boqId, docCount: documents.length });
  return NextResponse.json({ boq_id: boqId, processing_status: "pending" });
}
