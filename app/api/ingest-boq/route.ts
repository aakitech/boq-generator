import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureProfileExists } from "@/lib/supabase/ensure-profile";
import { extractWorkbookBOQ } from "@/lib/excel";
import { randomUUID } from "crypto";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";
import { getTierForItemCount, loadRateTiers } from "@/lib/pricing";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB (storage bucket limit)
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "boq-generator-dev";

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse multipart form
    const form = await req.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".xlsx") && !fileName.endsWith(".xls")) {
      return NextResponse.json(
        { error: "Please upload an Excel file (.xlsx or .xls)" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB.` },
        { status: 400 }
      );
    }

    // Read file bytes
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Deterministic workbook inspection for existing BOQ uploads
    let workbookBoq;
    try {
      workbookBoq = await extractWorkbookBOQ(buffer);
    } catch {
      return NextResponse.json(
        { error: "Could not read the Excel file. Please check it is not password-protected or corrupted." },
        { status: 400 }
      );
    }

    const measurableItems = workbookBoq.bills.flatMap((bill) =>
      bill.items.filter((item) => !item.is_header && (item.unit || item.qty !== null))
    );
    const workbookPreservation = workbookBoq.workbook_preservation;

    if (measurableItems.length === 0) {
      const ignoredReasons = workbookPreservation?.per_sheet_stats
        ?.map((stats) => stats.ignored_reason)
        .filter(Boolean);
      const summaryOnly = ignoredReasons?.includes("summary_only");
      return NextResponse.json(
        {
          error:
            summaryOnly
              ? "This workbook appears to contain summaries or preliminaries only, but no measurable BOQ item sheets we can rate yet."
              : "This spreadsheet does not appear to contain measurable BOQ items on any supported sheet. Please upload a BOQ with descriptions, units, and quantities.",
        },
        { status: 400 }
      );
    }
    const missingRateCount = measurableItems.filter((item) => item.rate === null).length;

    if (missingRateCount === 0) {
      return NextResponse.json(
        { error: "All rates are already filled in this BOQ. There's nothing for us to add. Try the Generate tab if you'd like a fresh BOQ from a scope of work." },
        { status: 400 }
      );
    }

    // Upload original Excel to Supabase Storage using service role client (no RLS on bucket)
    const serviceClient = createServiceClient();
    await ensureProfileExists(serviceClient, user);
    const storageKey = `pending/${randomUUID()}.xlsx`;

    const { error: uploadError } = await serviceClient.storage
      .from(STORAGE_BUCKET)
      .upload(storageKey, buffer, {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false,
      });

    if (uploadError) {
      logger.error("Storage upload error", {
        error: String(uploadError),
        message: uploadError.message,
        bucket: STORAGE_BUCKET,
        route: "ingest-boq",
      });
      return NextResponse.json(
        {
          error:
            uploadError.message ||
            `Failed to store the uploaded file in bucket "${STORAGE_BUCKET}". Please verify the bucket exists and the service role key is correct.`,
        },
        { status: 500 }
      );
    }

    // Compute pricing tier based on item count (no rates to sum yet)
    const rateTiers = loadRateTiers();
    const pricingTier = getTierForItemCount(measurableItems.length, rateTiers);

    // Save a preview BOQ row so the boq_id can be passed through checkout → rate-boq
    const { data: previewBoq, error: dbError } = await serviceClient
      .from("boqs")
      .insert({
        user_id: user.id,
        title: file.name.replace(/\.[^/.]+$/, "") || "Untitled BOQ",
        data: workbookBoq,
        payment_status: "preview",
        processing_status: "pending",
        source_excel_key: storageKey,
        rate_col_header: workbookPreservation?.rate_column_header ?? null,
        amount_col_header: workbookPreservation?.amount_column_header ?? null,
      })
      .select("id")
      .single();

    if (dbError) {
      logger.error("Failed to save preview BOQ for rate_boq", { error: String(dbError), route: "ingest-boq" });
      // Non-fatal: return without boq_id; checkout will fall back to legacy flow
    }

    trackEvent(user.id, "excel_ingested", {
      totalItems: measurableItems.length,
      missingRateCount,
      pricingTier: pricingTier.label,
      amountCents: pricingTier.usdCents,
    });

    return NextResponse.json({
      storageKey,
      boq_id: previewBoq?.id ?? null,
      amountCents: pricingTier.usdCents,
      preview: {
        totalItems: measurableItems.length,
        missingRateCount,
        rateColumnHeader: workbookPreservation?.rate_column_header ?? null,
        amountColumnHeader: workbookPreservation?.amount_column_header ?? null,
      },
    });
  } catch (err) {
    logger.error("ingest-boq error", { error: err instanceof Error ? err.message : String(err), route: "ingest-boq" });
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
