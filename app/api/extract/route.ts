import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import mammoth from "mammoth";
import { validateSOW } from "@/lib/ai";
import { extractDrawingWithVision, formatDrawingTextForPrompt } from "@/lib/drawing-extractor";
import { getServerEnv } from "@/lib/server-env";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (
  buffer: Buffer,
  options?: { pagerender?: (pageData: { getTextContent: (opts: object) => Promise<{ items: Array<{ str: string; transform: number[] }> }> }) => Promise<string> }
) => Promise<{ text: string; numpages: number }>;

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_SIZE_SOW = 15 * 1024 * 1024;       // 15 MB for SOW / primary documents
const MAX_SIZE_DRAWING = 50 * 1024 * 1024;  // 50 MB for engineering drawings (Files API handles it)
const MIN_DIRECT_TEXT_LENGTH = 120;
const GEMINI_VISION_MODELS = [
  process.env.GEMINI_SOW_MODEL_FALLBACK,
  process.env.GEMINI_SOW_MODEL_PRIMARY,
  process.env.GEMINI_MODEL_FALLBACK,
  process.env.GEMINI_MODEL_PRIMARY,
  "gemini-2.5-flash",
].filter(Boolean) as string[];

function classifyExtractionError(error: unknown): { status: number; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("failed to parse body as formdata") ||
    lower.includes("request body exceeded") ||
    lower.includes("body exceeded") ||
    lower.includes("too large")
  ) {
    return {
      status: 413,
      message:
        "This file is too large. Main SOW uploads are limited to 15 MB. Supporting documents are limited to 50 MB.",
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
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const supportingDocsCount = Number(formData.get("supporting_docs_count") ?? 0);
    // When role="supporting", skip SOW validation — drawings and specs are never SOWs
    const role = (formData.get("role") as string | null) ?? "primary";
    const isSupporting = role === "supporting";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const name = file.name.toLowerCase();
    const isPDF = name.endsWith(".pdf");
    const isDOCX = name.endsWith(".docx");

    if (!isPDF && !isDOCX) {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload a PDF or Word (.docx) document." },
        { status: 400 }
      );
    }

    const maxSize = isSupporting ? MAX_SIZE_DRAWING : MAX_SIZE_SOW;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: `File too large (max ${isSupporting ? "50" : "15"} MB)` },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    let text = "";
    let pages: number | null = null;
    let usedDrawingExtractor = false;

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
          const { text: drawingText } = await extractDrawingWithVision(buffer, file.name);
          if (drawingText.length > trimmedText.length) {
            text = formatDrawingTextForPrompt(drawingText, file.name);
            usedDrawingExtractor = true;
          }
        } catch (drawingError) {
          logger.warn("Drawing vision extraction failed, falling back to inline vision", {
            error: drawingError instanceof Error ? drawingError.message : String(drawingError),
          });
          // Fallback to old inline vision for smaller files
          if (file.size <= 8 * 1024 * 1024) {
            try {
              const visionText = await extractPdfTextWithVision(buffer, file.name);
              if (visionText.trim().length > trimmedText.length) {
                text = enrichDrawingText(visionText);
              }
            } catch (visionError) {
              logger.warn("Inline vision fallback also failed", {
                error: visionError instanceof Error ? visionError.message : String(visionError),
              });
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

    // Supporting documents (drawings, specs) skip SOW validation — they are never SOWs
    if (isSupporting) {
      return NextResponse.json({
        text,
        pages,
        isSOW: true,
        sowWarning: null,
        sowConfidence: 1,
        documentType: usedDrawingExtractor ? "drawing_set" : "specification",
        shouldBlockGeneration: false,
        requiredAttachments: [],
        sourceBundleStatus: "complete",
        positiveSignals: [],
        negativeSignals: [],
        sowFlags: [],
      });
    }

    // Primary SOW — run validation
    let isSOW = true;
    let sowWarning: string | null = null;
    let sowConfidence: number | null = null;
    let documentType: string | null = null;
    let shouldBlockGeneration = false;
    let positiveSignals: string[] = [];
    let negativeSignals: string[] = [];
    let sowFlags: string[] = [];
    try {
      const validation = await validateSOW(text, { supportingDocsCount });
      isSOW = validation.isSOW;
      sowConfidence = validation.confidence;
      documentType = validation.documentType;
      shouldBlockGeneration = validation.should_block_generation;
      const requiredAttachments = validation.required_attachments ?? [];
      const sourceBundleStatus = validation.source_bundle_status ?? "complete";
      positiveSignals = validation.positive_signals ?? [];
      negativeSignals = validation.negative_signals ?? [];
      sowFlags = validation.flags ?? [];
      if (!isSOW) {
        sowWarning = validation.reason;
      }
      return NextResponse.json({
        text,
        pages,
        isSOW,
        sowWarning,
        sowConfidence,
        documentType,
        shouldBlockGeneration,
        requiredAttachments,
        sourceBundleStatus,
        positiveSignals,
        negativeSignals,
        sowFlags,
      });
    } catch {
      // Non-fatal — proceed without validation result
    }

    return NextResponse.json({
      text,
      pages,
      isSOW,
      sowWarning,
      sowConfidence,
      documentType,
      shouldBlockGeneration,
      requiredAttachments: [],
      sourceBundleStatus: "complete",
      positiveSignals,
      negativeSignals,
      sowFlags,
    });
  } catch (err) {
    logger.error("Extraction error", { error: err instanceof Error ? err.message : String(err), route: "extract" });
    const classified = classifyExtractionError(err);
    return NextResponse.json({ error: classified.message }, { status: classified.status });
  }
}
