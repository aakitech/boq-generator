/**
 * drawing-extractor.ts
 *
 * Extracts structured text from engineering drawing PDFs using the Gemini
 * Files API. Uploads the raw PDF (up to ~1 GB) server-side, then asks
 * Gemini Vision to read all visible content: labels, dimensions, schedules,
 * room counts, notes, and title block details.
 *
 * Uses the Files API instead of inline base64 data to handle large files
 * (17 MB+ engineering drawings) that exceed the inline data limit (~8 MB).
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { getServerEnv } from "./server-env";

const DRAWING_VISION_MODEL = "gemini-2.5-pro";

const DRAWING_EXTRACTION_PROMPT = `You are analysing an engineering drawing for a construction project in Zambia. Extract ALL visible information that a quantity surveyor would need to prepare a Bill of Quantities.

Be exhaustive. Return structured plain text under these headings:

TITLE BLOCK
- Project name, drawing title, drawing number, scale, date, revision, architect/engineer

SPACES AND ROOMS
- Every room name and label visible on the plan
- Count of each room type (e.g. "8 × Classroom", "3 × Office", "2 × Toilet block")

DIMENSIONS
- All dimensions shown on the drawing (in mm or m as stated)
- Room sizes where readable (e.g. "Classroom: 8000 × 6000 mm")
- Overall building footprint dimensions
- Floor-to-ceiling heights if shown

STRUCTURAL ELEMENTS
- Column grid references and spacing
- Slab thickness notes
- Foundation type if indicated
- Wall types (brick, block, stud, etc.)

SCHEDULES
- Door schedule (sizes, types, quantities)
- Window schedule (sizes, types, quantities)
- Finish schedule (floor, wall, ceiling finishes per room)

NOTES AND SPECIFICATIONS
- All written notes on the drawing
- Material specifications
- Any BOQ-relevant callouts

AREAS AND QUANTITIES
- Any areas stated on the drawing (m²)
- Any item counts visible
- Any quantities or take-off notes

If certain information is absent from the drawing, say so briefly. Do not invent or assume — only report what is visible.`;

interface DrawingExtractionResult {
  text: string;
  fileUri: string;
  tokenCount: number;
}

async function uploadToFilesAPI(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
  const key = getServerEnv("GEMINI_API_KEY") as string;

  // Initiate resumable upload
  const initRes = await fetch(
    "https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable",
    {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(buffer.length),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: filename } }),
    }
  );

  if (!initRes.ok) {
    throw new Error(`Files API init failed: ${initRes.status} ${await initRes.text()}`);
  }

  const uploadUrl = initRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Files API did not return an upload URL");
  }

  // Upload the file bytes
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Type": mimeType,
    },
    body: new Uint8Array(buffer),
  });

  if (!uploadRes.ok) {
    throw new Error(`Files API upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }

  const fileInfo = (await uploadRes.json()) as { file?: { uri?: string; state?: string } };
  const uri = fileInfo?.file?.uri;
  if (!uri) {
    throw new Error("Files API upload succeeded but returned no file URI");
  }

  return uri;
}

async function deleteFromFilesAPI(fileUri: string): Promise<void> {
  const key = getServerEnv("GEMINI_API_KEY");
  // Extract file name from URI: https://...googleapis.com/v1beta/files/XXXXX
  const fileName = fileUri.split("/").slice(-2).join("/"); // "files/XXXXX"
  await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${key}`,
    { method: "DELETE" }
  ).catch(() => {
    // Non-fatal — files expire after 48h anyway
  });
}

export async function extractDrawingWithVision(
  buffer: Buffer,
  filename: string
): Promise<DrawingExtractionResult> {
  const key = getServerEnv("GEMINI_API_KEY") as string;
  const client = new GoogleGenerativeAI(key);

  // Upload to Files API to handle large PDFs
  const fileUri = await uploadToFilesAPI(buffer, filename, "application/pdf");

  try {
    const model = client.getGenerativeModel({
      model: DRAWING_VISION_MODEL,
      generationConfig: { temperature: 0 },
    });

    const result = await model.generateContent([
      { text: DRAWING_EXTRACTION_PROMPT },
      { fileData: { mimeType: "application/pdf", fileUri } },
    ]);

    const text = result.response.text().trim();
    const tokenCount = result.response.usageMetadata?.totalTokenCount ?? 0;

    return { text, fileUri, tokenCount };
  } finally {
    // Clean up uploaded file — don't wait for it
    deleteFromFilesAPI(fileUri);
  }
}

export function formatDrawingTextForPrompt(rawText: string, filename: string): string {
  return [
    `[ENGINEERING DRAWING: ${filename}]`,
    rawText,
    "[END DRAWING]",
  ].join("\n");
}
