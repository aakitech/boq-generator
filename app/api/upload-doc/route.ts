import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "boq-generator-dev";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { filename } = (await req.json()) as { filename?: string };
    if (!filename || typeof filename !== "string") {
      return NextResponse.json({ error: "filename is required" }, { status: 400 });
    }

    const lower = filename.toLowerCase();
    if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload a PDF or Word (.docx) document." },
        { status: 400 }
      );
    }

    const ext = lower.endsWith(".pdf") ? "pdf" : "docx";
    const storageKey = `temp/${randomUUID()}.${ext}`;

    const serviceClient = createServiceClient();
    const { data, error } = await serviceClient.storage
      .from(STORAGE_BUCKET)
      .createSignedUploadUrl(storageKey);

    if (error || !data?.signedUrl) {
      logger.error("upload-doc: failed to create signed upload URL", {
        error: String(error),
        bucket: STORAGE_BUCKET,
      });
      return NextResponse.json(
        { error: "Failed to prepare upload. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ signedUrl: data.signedUrl, storageKey });
  } catch (err) {
    logger.error("upload-doc error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Failed to prepare upload." }, { status: 500 });
  }
}
