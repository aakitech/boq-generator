import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { generateBOQExcelFromTemplate } from "@/lib/excel-template";
import type { BOQDocument } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const boq = (await req.json()) as BOQDocument;

    if (!boq || !boq.bills || !Array.isArray(boq.bills)) {
      return NextResponse.json({ error: "Invalid BOQ data" }, { status: 400 });
    }

    const buffer = await generateBOQExcelFromTemplate(boq);

    const filename = `BOQ_${boq.project.replace(/[^\w\s]/g, "").replace(/\s+/g, "_").slice(0, 50)}.xlsx`;

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (err) {
    logger.error("Excel export error", { error: err instanceof Error ? err.message : String(err), route: "export" });
    return NextResponse.json({ error: "Failed to generate Excel file" }, { status: 500 });
  }
}
