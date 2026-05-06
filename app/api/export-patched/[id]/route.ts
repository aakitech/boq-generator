import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { patchExcelWithRates } from "@/lib/excel";

export const runtime = "nodejs";

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "boq-generator-dev";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Auth check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Load BOQ record (user-scoped — RLS ensures they own it)
    const { data: row, error: fetchError } = await supabase
      .from("boqs")
      .select("data, source_excel_key, rate_col_header, amount_col_header, title")
      .eq("id", id)
      .single();

    if (fetchError || !row) {
      return NextResponse.json({ error: "BOQ not found" }, { status: 404 });
    }

    if (!row.source_excel_key) {
      return NextResponse.json(
        { error: "This BOQ does not have an original Excel file to patch" },
        { status: 400 }
      );
    }

    // Download original Excel from Storage
    const serviceClient = createServiceClient();
    const { data: fileData, error: downloadError } = await serviceClient.storage
      .from(STORAGE_BUCKET)
      .download(row.source_excel_key);

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: "Could not retrieve the original Excel file" },
        { status: 500 }
      );
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);

    // Patch the original Excel with rates from the BOQ
    const patched = await patchExcelWithRates(
      originalBuffer,
      row.data,
      row.rate_col_header ?? "Rate",
      row.amount_col_header ?? "Amount"
    );

    // Sanitize filename
    const safeTitle = (row.title ?? "BOQ")
      .replace(/[^a-zA-Z0-9\s\-_]/g, "")
      .trim()
      .slice(0, 50) || "BOQ";

    return new NextResponse(new Uint8Array(patched), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Rated_${safeTitle}.xlsx"`,
        "Content-Length": String(patched.length),
      },
    });
  } catch (err) {
    logger.error("export-patched error", { error: err instanceof Error ? err.message : String(err), route: "export-patched" });
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
