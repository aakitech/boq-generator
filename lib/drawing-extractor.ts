import { GoogleGenerativeAI } from "@google/generative-ai";
import { getServerEnv } from "./server-env";
import type { DrawingType } from "./types";

const DRAWING_VISION_MODELS = [
  process.env.GEMINI_DRAWING_MODEL_PRIMARY ?? process.env.GEMINI_MODEL_PRIMARY ?? "gemini-2.5-pro",
  process.env.GEMINI_MODEL_FALLBACK ?? "gemini-2.5-flash",
];

const VALID_DRAWING_TYPES: DrawingType[] = [
  "site_plan", "floor_plan", "elevation", "section",
  "structural", "services", "schedule_of_finishes", "other",
];

const DRAWING_EXTRACTION_PROMPT = `You are analysing an engineering drawing for a construction project in Zambia. Extract ALL visible information that a quantity surveyor would need to prepare a Bill of Quantities.

CLASSIFICATION (output these two lines first, before anything else):
DRAWING_TYPE: <one of: site_plan | floor_plan | elevation | section | structural | services | schedule_of_finishes | other>
SUBJECT_NAME: <block or structure name from title block, e.g. "Block A Administration" — or NONE if not applicable>

Identify the drawing type from the title block drawing title or drawing content. If this drawing covers a named block or structure (e.g. "Block A - Administration Block", "Classroom Block"), extract that name exactly as written. Use NONE if no specific block name is visible.

Then extract ALL visible information under these headings:

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
  drawing_type: DrawingType;
  subject_name: string | null;
}

async function uploadToFilesAPI(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
  const key = getServerEnv("GEMINI_API_KEY") as string;

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
  const fileName = fileUri.split("/").slice(-2).join("/");
  await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${key}`,
    { method: "DELETE" }
  ).catch(() => {
    // Non-fatal — files expire after 48h anyway
  });
}

function parseClassificationHeader(raw: string): {
  drawing_type: DrawingType;
  subject_name: string | null;
  text: string;
} {
  const lines = raw.split("\n");
  let drawing_type: DrawingType = "other";
  let subject_name: string | null = null;
  let bodyStart = 0;

  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const line = lines[i].trim();
    if (line.startsWith("DRAWING_TYPE:")) {
      const val = line.slice("DRAWING_TYPE:".length).trim().toLowerCase() as DrawingType;
      if (VALID_DRAWING_TYPES.includes(val)) drawing_type = val;
      bodyStart = i + 1;
    } else if (line.startsWith("SUBJECT_NAME:")) {
      const val = line.slice("SUBJECT_NAME:".length).trim();
      subject_name = val && val.toUpperCase() !== "NONE" ? val : null;
      bodyStart = Math.max(bodyStart, i + 1);
    }
  }

  const text = lines.slice(bodyStart).join("\n").trim();
  return { drawing_type, subject_name, text };
}

export async function extractDrawingWithVision(
  buffer: Buffer,
  filename: string
): Promise<DrawingExtractionResult> {
  const key = getServerEnv("GEMINI_API_KEY") as string;
  const client = new GoogleGenerativeAI(key);

  const fileUri = await uploadToFilesAPI(buffer, filename, "application/pdf");

  const models = Array.from(new Set(DRAWING_VISION_MODELS));
  let lastError: unknown;

  try {
    for (const modelName of models) {
      try {
        const model = client.getGenerativeModel({
          model: modelName,
          generationConfig: { temperature: 0 },
        });

        const result = await model.generateContent([
          { text: DRAWING_EXTRACTION_PROMPT },
          { fileData: { mimeType: "application/pdf", fileUri } },
        ]);

        const raw = result.response.text().trim();
        const tokenCount = result.response.usageMetadata?.totalTokenCount ?? 0;
        const { drawing_type, subject_name, text } = parseClassificationHeader(raw);

        return { text, fileUri, tokenCount, drawing_type, subject_name };
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("503") ||
          msg.includes("overloaded") ||
          msg.includes("high demand") ||
          msg.includes("unavailable")
        ) {
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  } finally {
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
