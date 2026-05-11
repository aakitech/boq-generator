import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import mammoth from "mammoth";
import { extractDrawingWithVision, formatDrawingTextForPrompt } from "@/lib/drawing-extractor";
import { getServerEnv } from "@/lib/server-env";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (
  buffer: Buffer,
  options?: { pagerender?: (pageData: { getTextContent: (opts: object) => Promise<{ items: Array<{ str: string; transform: number[] }> }> }) => Promise<string> }
) => Promise<{ text: string; numpages: number }>;

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB for all documents
const MIN_DIRECT_TEXT_LENGTH = 120;
const GEMINI_VISION_MODELS = [
  process.env.GEMINI_SOW_MODEL_FALLBACK,
  process.env.GEMINI_SOW_MODEL_PRIMARY,
  process.env.GEMINI_MODEL_FALLBACK,
  process.env.GEMINI_MODEL_PRIMARY,
  "gemini-2.5-flash",
].filter(Boolean) as string[];

function isGeminiSpendCapError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("monthly spending cap") ||
    lower.includes("project spend cap") ||
    lower.includes("exceeded its monthly spending cap")
  );
}

function classifyExtractionError(error: unknown): { status: number; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (isGeminiSpendCapError(error)) {
    return {
      status: 503,
      message:
        "AI drawing extraction is temporarily unavailable because the Gemini project has exceeded its monthly spending cap. Increase the cap in Google AI Studio or switch to a funded API key, then try again.",
    };
  }

  if (lower.includes("429") || lower.includes("quota") || lower.includes("too many requests")) {
    return {
      status: 503,
      message:
        "AI drawing extraction is temporarily unavailable because the AI provider quota was reached. Please try again later or use a funded API key.",
    };
  }

  if (
    lower.includes("failed to parse body as formdata") ||
    lower.includes("request body exceeded") ||
    lower.includes("body exceeded") ||
    lower.includes("entity too large") ||
    lower.includes("payload too large")
  ) {
    return {
      status: 413,
      message:
        "This file is too large to upload. Maximum size is 50 MB. If it is a scanned PDF, try compressing it or exporting only the relevant pages.",
    };
  }

  if (lower.includes("invalid pdf")) {
    return {
      status: 400,
      message: "This PDF looks invalid or corrupted. Please re-export it as a standard PDF and try again.",
    };
  }

  if (lower.includes("mammoth")) {
    return {
      status: 400,
      message:
        "We could not read this Word document. Please re-save it as a .docx file with selectable text and try again.",
    };
  }

  if (lower.includes("pdf")) {
    return {
      status: 400,
      message:
        "We could not read this PDF properly. Please make sure it is not corrupted and that the text is selectable, or upload a cleaner export.",
    };
  }

  return {
    status: 500,
    message:
      "We could not extract readable text from this document. Please check that it is a valid PDF or Word file with readable text, then try again.",
  };
}

function getVisionClient() {
  const key = getServerEnv("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenerativeAI(key);
}

async function extractPdfTextWithVision(buffer: Buffer, filename: string) {
  const client = getVisionClient();
  let lastError: unknown;

  for (const modelName of Array.from(new Set(GEMINI_VISION_MODELS))) {
    try {
      const model = client.getGenerativeModel({
        model: modelName,
        systemInstruction:
          "You extract visible text and drawing labels from scanned construction PDFs. Return plain text only. Preserve page order, dimensions, room names, notes, legends, schedules, and title-block details when visible. Do not add commentary.",
        generationConfig: {
          temperature: 0,
        },
      });

      const result = await model.generateContent([
        {
          text:
            "Extract all readable visible text from this PDF. This may be a construction drawing or scanned document. Return plain text only. Include page markers like [PAGE 1]. If text is sparse, still return whatever labels, dimensions, title block fields, schedules, callouts, and notes are visible.",
        },
        {
          inlineData: {
            mimeType: "application/pdf",
            data: buffer.toString("base64"),
          },
        },
      ]);

      const text = result.response.text().trim();
      if (text.length > 0) {
        return text;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Vision extraction failed for ${filename}`);
}

function enrichDrawingText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const drawingLike = lines.filter(
    (line) =>
      /\b(?:drawing|layout|elevation|section|detail|grid|room|classroom|office|parking|pool|gate|road|walkway|drain|toilet|store|lab|library|ablution|seating)\b/i.test(
        line
      ) ||
      /\b\d+(?:\.\d+)?\s*(?:m|mm)\b/i.test(line)
  );

  const labelLike = drawingLike.filter((line) => line.length <= 80);
  const countSummary = new Map<string, number>();
  for (const label of labelLike) {
    const key = label.toLowerCase();
    countSummary.set(key, (countSummary.get(key) ?? 0) + 1);
  }

  const repeatedLabels = Array.from(countSummary.entries())
    .filter(([, count]) => count > 1)
    .slice(0, 20)
    .map(([label, count]) => `LABEL COUNT: ${label} :: ${count}`);

  if (drawingLike.length === 0 && repeatedLabels.length === 0) {
    return text;
  }

  return [
    text,
    "",
    "[DRAWING TEXT SUMMARY]",
    ...drawingLike.slice(0, 60),
    ...repeatedLabels,
  ].join("\n");
}

function createPageRender() {
  let pageNumber = 0;
  return async (pageData: {
    getTextContent: (opts: object) => Promise<{ items: Array<{ str: string; transform: number[] }> }>;
  }) => {
    pageNumber += 1;
    const textContent = await pageData.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });

    let lastY: number | undefined;
    let text = `\n[PAGE ${pageNumber}]\n`;

    for (const item of textContent.items) {
      if (lastY === item.transform[5] || typeof lastY === "undefined") {
        text += item.str;
      } else {
        text += `\n${item.str}`;
      }
      lastY = item.transform[5];
    }

    return `${text}\n`;
  };
}

export async function POST(req: NextRequest) {
  // storage_key path: browser uploaded directly to Supabase, we download server-side
  // file body path: local dev / legacy — multipart form with file bytes
  const contentType = req.headers.get("content-type") ?? "";
  const isStorageKeyRequest = contentType.includes("application/json");

  let buffer: Buffer;
  let filename: string;
  let storageKeyToDelete: string | null = null;

  try {
    if (isStorageKeyRequest) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { storage_key } = (await req.json()) as { storage_key?: string };
      if (!storage_key || typeof storage_key !== "string") {
        return NextResponse.json({ error: "storage_key is required" }, { status: 400 });
      }

      const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "boq-generator-dev";
      const serviceClient = createServiceClient();
      const { data: fileData, error: downloadError } = await serviceClient.storage
        .from(STORAGE_BUCKET)
        .download(storage_key);

      if (downloadError || !fileData) {
        logger.error("extract: storage download failed", { storage_key, error: String(downloadError) });
        return NextResponse.json({ error: "Could not retrieve the uploaded file. Please try again." }, { status: 500 });
      }

      buffer = Buffer.from(await fileData.arrayBuffer());
      filename = storage_key.split("/").pop() ?? storage_key;
      storageKeyToDelete = storage_key;
    } else {
      // Legacy multipart path — used in local dev
      const formData = await req.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: "File too large. Maximum file size is 50 MB." },
          { status: 400 }
        );
      }

      buffer = Buffer.from(await file.arrayBuffer());
      filename = file.name;
    }

    const name = filename.toLowerCase();
    const isPDF = name.endsWith(".pdf");
    const isDOCX = name.endsWith(".docx");

    if (!isPDF && !isDOCX) {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload a PDF or Word (.docx) document." },
        { status: 400 }
      );
    }

    let text = "";
    let pages: number | null = null;
    let usedDrawingExtractor = false;
    let drawingType: string | undefined;
    let subjectName: string | null | undefined;

    if (isPDF) {
      if (buffer[0] !== 0x25 || buffer[1] !== 0x50) {
        return NextResponse.json({ error: "Invalid PDF file" }, { status: 400 });
      }
      const data = await pdfParse(buffer, { pagerender: createPageRender() });
      text = data.text;
      pages = data.numpages;

      const trimmedText = text.trim();
      const looksLikeDrawing =
        trimmedText.length < MIN_DIRECT_TEXT_LENGTH ||
        /drawing|layout|elevation|section|detail|floor plan|site plan/i.test(trimmedText);

      if (looksLikeDrawing) {
        // Use Files API + Gemini Vision for drawings — handles large files, reads detail
        try {
          const drawingResult = await extractDrawingWithVision(buffer, filename);
          if (drawingResult.text.length > trimmedText.length) {
            text = formatDrawingTextForPrompt(drawingResult.text, filename);
            drawingType = drawingResult.drawing_type;
            subjectName = drawingResult.subject_name;
            usedDrawingExtractor = true;
          }
        } catch (drawingError) {
          logger.error("Drawing vision extraction failed", {
            filename,
            fileSizeMb: (buffer.length / 1024 / 1024).toFixed(1),
            error: drawingError instanceof Error ? drawingError.message : String(drawingError),
            stack: drawingError instanceof Error ? drawingError.stack : undefined,
          });
          if (isGeminiSpendCapError(drawingError)) {
            throw drawingError;
          }
          // Fallback to old inline vision for smaller files
          if (buffer.length <= 8 * 1024 * 1024) {
            try {
              const visionText = await extractPdfTextWithVision(buffer, filename);
              if (visionText.trim().length > trimmedText.length) {
                text = enrichDrawingText(visionText);
              }
            } catch (visionError) {
              logger.warn("Inline vision fallback also failed", {
                error: visionError instanceof Error ? visionError.message : String(visionError),
              });
              if (isGeminiSpendCapError(visionError)) {
                throw visionError;
              }
            }
          }
        }
      } else if (/drawing|layout|elevation|section|detail/i.test(text)) {
        text = enrichDrawingText(text);
      }
    } else {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
      pages = null;
    }

    if (!text || text.trim().length < 50) {
      return NextResponse.json(
        {
          error: isPDF
            ? "Could not extract text from this PDF. It may be a scanned image — please use a text-based PDF."
            : "Could not extract text from this Word document. Please ensure it contains readable text.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      text,
      pages,
      drawing_type: drawingType ?? null,
      subject_name: subjectName ?? null,
    });
  } catch (err) {
    logger.error("Extraction error", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      route: "extract",
    });
    const classified = classifyExtractionError(err);
    return NextResponse.json({ error: classified.message }, { status: classified.status });
  } finally {
    // Clean up temp storage file regardless of success or failure
    if (storageKeyToDelete) {
      const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "boq-generator-dev";
      const serviceClient = createServiceClient();
      await serviceClient.storage
        .from(STORAGE_BUCKET)
        .remove([storageKeyToDelete])
        .catch((e) => logger.warn("extract: failed to delete temp file", { key: storageKeyToDelete, error: String(e) }));
    }
  }
}
