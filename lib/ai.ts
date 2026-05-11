import * as Sentry from "@sentry/nextjs";
import { GoogleGenerativeAI, SchemaType, type UsageMetadata } from "@google/generative-ai";
import { logger } from "@/lib/logger";
import { computeAICostUsd, type AIProvider, type AIUsageEntry } from "@/lib/gemini-pricing";
import { getServerEnv } from "@/lib/server-env";
import type {
  BOQArtifacts,
  BOQDocumentType,
  BOQEvidenceType,
  BOQDocument,
  BOQPricingCategory,
  BOQRateSkipReason,
  DocumentClassification,
  BOQItem,
  BOQQuantityArtifactItem,
  BOQQualitySummary,
  RequiredAttachment,
  RequiredAttachmentType,
  SourceBundleDocument,
  SourceBundleStatus,
  BOQStructureArtifact,
  BOQValidationFlag,
  StructureMode,
} from "./types";
import { computeDeterministicQA, mergeQAScores } from "./boq-qa";
import { buildDefaultRateReference } from "./rate-reference";
import { findRateAnchors } from "./rate-matcher";

type QuantitySource = "explicit" | "derived" | "assumed";
type SOWValidationResult = DocumentClassification;
export type GenerationInputDocument = {
  document_id: string;
  name: string;
  role: "primary" | "supporting";
  document_type?: BOQDocumentType | RequiredAttachmentType | "supporting_context";
  text: string;
  pages?: number | null;
  drawing_type?: string | null;
  subject_name?: string | null;
};
type GenerationInputBundle = {
  documents: GenerationInputDocument[];
};

export type GeminiUsageCollector = {
  entries: AIUsageEntry[];
};

type StructurePassResponse = {
  project: string;
  location: string;
  prepared_by: string;
  date: string;
  bills: Array<{
    number: number;
    title: string;
    items: Array<{
      item_key?: string;
      item_no?: string;
      description: string;
      unit?: string;
      section_context?: string | null;
      source_excerpt?: string | null;
      is_header?: boolean;
      note?: string | null;
    }>;
  }>;
};

type QuantityPassResponse = {
  items: Array<{
    item_key: string;
    qty: number | null;
    unit?: string;
    quantity_source?: QuantitySource | string;
    quantity_confidence?: number | null;
    source_excerpt?: string | null;
    source_anchor?: string | null;
    source_document?: string | null;
    evidence_type?: BOQEvidenceType | string | null;
    derivation_note?: string | null;
    note?: string | null;
  }>;
};

const OPENAI_PRIMARY_MODEL = process.env.OPENAI_MODEL_PRIMARY || "gpt-4.1";
const OPENAI_FAST_MODEL = process.env.OPENAI_MODEL_FAST || "gpt-4.1-mini";
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_MODEL_FALLBACK || "gemini-2.5-pro";
const GEMINI_FAST_FALLBACK_MODEL = process.env.GEMINI_MODEL_FAST_FALLBACK || "gemini-2.5-flash";
const MAX_ATTEMPTS_PER_MODEL = 3;
const RATE_FILL_BATCH_SIZE = 24;
const HIGH_DEMAND_RETRY_BASE_MS = 1500;
const RETRYABLE_RETRY_BASE_MS = 1000;
const OPENAI_STRUCTURED_OUTPUT_NAME = "structured_response";
const SOW_HEADING_TERMS = [
  "bill of quantities",
  "boq",
  "scope of work",
  "project introduction",
  "general preambles",
  "preliminaries",
  "instructions to contractors",
  "construction programme",
  "project documentation deliverables",
  "testing, inspection and handover",
  "testing and handover",
  "materials to be supplied",
];
const TRADE_SECTION_TERMS = [
  "excavation",
  "earthworks",
  "concrete",
  "reinforcement",
  "formwork",
  "masonry",
  "brickwork",
  "plaster",
  "roofing",
  "ceiling",
  "painting",
  "tiling",
  "drainage",
  "plumbing",
  "electrical",
  "civil works",
  "structural works",
  "doors",
  "windows",
  "foundations",
  "site clearance",
  "civil and structural works",
  "roofing works",
  "plumbing and drainage",
  "electrical works",
  "site works and external development",
  "health, safety & environmental",
];
const CONSTRUCTION_EXECUTION_TERMS = [
  "contractor",
  "drawings",
  "specifications",
  "project manager",
  "inspection",
  "testing",
  "commissioning",
  "workmanship",
  "materials",
  "procurement",
  "site",
  "permits",
  "ppe",
  "quality assurance",
  "method statements",
  "gantt chart",
  "supply and install",
];
const CONSTRUCTION_UNIT_PATTERN =
  /\b(?:m2|m²|m3|m³|m|mm|lm|kg|ton|tons|nr|no\.?|sum|ls)\b/gi;
const CONSTRUCTION_SPEC_PATTERNS = [
  /\b\d+(?:\.\d+)?\s*mpa\b/gi,
  /\bbs\d{3,5}\b/gi,
  /\b\d+\s*mm\b/gi,
  /\b\d+:\d+\b/g,
  /\b\d{2,4}\s*gauge\b/gi,
  /\b\d+%\b/g,
  /\b(?:upvc|ppr|led|acrylic|ceramic|galvanized|steel|cement|mortar|conduits)\b/gi,
];
const NON_SOW_QUESTIONNAIRE_TERMS = [
  "questionnaire",
  "survey",
  "feedback",
  "respondent",
  "interview",
  "how easy is it",
  "how confident are you",
];
const NON_SOW_PRODUCT_TERMS = [
  "product requirements",
  "technical specification",
  "technical direction",
  "implementation details",
  "dashboard",
  "workflow",
  "reporting flow",
  "admin ui",
  "user story",
  "acceptance criteria",
  "schema",
  "api",
  "configuration-driven",
];
const NON_SOW_CREATIVE_TERMS = [
  "lyrics",
  "chorus",
  "verse",
  "bridge",
  "album",
  "artist",
  "melody",
];
const NON_SOW_COMMERCIAL_TERMS = [
  "quotation",
  "quote",
  "invoice",
  "price list",
  "schedule of rates",
  "rate sheet",
  "unit rate",
  "priced boq",
  "commercial offer",
  "cost summary",
  "summary of rates",
];
const NON_SOW_ABSTRACT_SECTION_TERMS = [
  "overview",
  "background",
  "problem statement",
  "success criteria",
  "open questions",
  "assumptions",
  "dependencies",
  "rollout plan",
  "migration strategy",
  "canonical terminology",
  "whatsapp",
];
const NON_SOW_PRODUCT_PATTERN =
  /\b(?:dashboard|workflow|admin ui|user story|acceptance criteria|schema|api|configuration-driven|whatsapp)\b/gi;
const REQUIRED_ATTACHMENT_PATTERNS: Array<{
  pattern: RegExp;
  type: RequiredAttachmentType;
  reason: string;
}> = [
  { pattern: /\brefer to (the )?attached boq\b/i, type: "boq", reason: "The SOW explicitly refers to an attached BOQ." },
  { pattern: /\bunabridged boq attached\b/i, type: "boq", reason: "The SOW says the unabridged BOQ is attached." },
  { pattern: /\bappendix\s+[a-z0-9]+\b/i, type: "schedule", reason: "The SOW references an appendix that may contain scope detail." },
  { pattern: /\battached drawing\b/i, type: "drawing", reason: "The SOW references an attached drawing." },
  { pattern: /\bdrawing to be issued\b/i, type: "drawing", reason: "The SOW states that a drawing is required or will be issued separately." },
  { pattern: /\bdocuments attached to this scope\b/i, type: "schedule", reason: "The SOW lists supporting documents attached to the scope." },
];

function countTextHits(text: string, terms: string[]): number {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function countPatternHits(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Math.round(value * 100) / 100;
}

function isUnavailableModelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("404") ||
    message.includes("not found") ||
    message.includes("no longer available") ||
    (message.includes("model") && message.includes("available"))
  );
}

function isRetryableModelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("502") ||
    message.includes("bad gateway") ||
    message.includes("503") ||
    message.includes("service unavailable") ||
    message.includes("high demand") ||
    message.includes("temporarily unavailable") ||
    message.includes("deadline exceeded") ||
    message.includes("timeout") ||
    message.includes("etimedout") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("network") ||
    message.includes("socket hang up")
  );
}

function isHighDemandModelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    (message.includes("503") || message.includes("service unavailable")) &&
    (message.includes("high demand") || message.includes("temporarily unavailable"))
  );
}

function computeRetryDelayMs(attempt: number, error: unknown): number {
  const factor = 2 ** Math.max(0, attempt - 1);
  if (isHighDemandModelError(error)) {
    return HIGH_DEMAND_RETRY_BASE_MS * factor;
  }
  return RETRYABLE_RETRY_BASE_MS * factor;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMalformedJsonError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("unterminated string") ||
    message.includes("unexpected non-whitespace character") ||
    message.includes("expected ',' or ']'") ||
    message.includes("expected ',' or '}'") ||
    message.includes("unexpected end of json input") ||
    message.includes("json at position")
  );
}

function recordUsage(
  collector: GeminiUsageCollector | undefined,
  provider: AIProvider,
  model: string,
  operation: string,
  usageMetadata?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
  },
) {
  if (!collector || !usageMetadata) return;

  const inputTokens = usageMetadata.inputTokens ?? 0;
  const outputTokens = usageMetadata.outputTokens ?? Math.max(0, (usageMetadata.totalTokens ?? 0) - inputTokens);
  const totalTokens = usageMetadata.totalTokens ?? inputTokens + outputTokens;

  collector.entries.push({
    operation,
    provider,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd: computeAICostUsd({
      provider,
      model,
      inputTokens,
      outputTokens,
    }),
  });
}

function recordGeminiUsage(
  collector: GeminiUsageCollector | undefined,
  model: string,
  operation: string,
  usageMetadata?: UsageMetadata,
) {
  return recordUsage(collector, "gemini", model, operation, {
    inputTokens: usageMetadata?.promptTokenCount ?? 0,
    outputTokens:
      usageMetadata?.candidatesTokenCount ??
      Math.max(0, (usageMetadata?.totalTokenCount ?? 0) - (usageMetadata?.promptTokenCount ?? 0)),
    totalTokens:
      usageMetadata?.totalTokenCount ??
      (usageMetadata?.promptTokenCount ?? 0) + (usageMetadata?.candidatesTokenCount ?? 0),
  });
}

function getOpenAIKey() {
  return getServerEnv("OPENAI_API_KEY");
}

function ensureOpenAIConfigured() {
  const key = getOpenAIKey();
  if (!key) {
    throw new Error("OpenAI fallback is not configured. Set OPENAI_API_KEY to enable provider failover.");
  }
  return key;
}

type GeminiSchemaNode = {
  type?: SchemaType;
  properties?: Record<string, GeminiSchemaNode>;
  items?: GeminiSchemaNode;
  required?: string[];
  nullable?: boolean;
  description?: string;
};

function toOpenAIJsonSchema(node: GeminiSchemaNode): Record<string, unknown> {
  const baseType = (() => {
    switch (node.type) {
      case SchemaType.OBJECT:
        return "object";
      case SchemaType.ARRAY:
        return "array";
      case SchemaType.STRING:
        return "string";
      case SchemaType.NUMBER:
        return "number";
      case SchemaType.BOOLEAN:
        return "boolean";
      default:
        return "string";
    }
  })();

  const schema: Record<string, unknown> = {};
  schema.type = node.nullable ? [baseType, "null"] : baseType;
  if (node.description) schema.description = node.description;

  if (node.type === SchemaType.OBJECT) {
    const requiredKeys = new Set(node.required ?? []);
    const properties = Object.fromEntries(
      Object.entries(node.properties ?? {}).map(([key, value]) => {
        const isOptional = !requiredKeys.has(key);
        const normalizedValue =
          isOptional && !value.nullable
            ? {
                ...value,
                nullable: true,
              }
            : value;

        return [key, toOpenAIJsonSchema(normalizedValue)];
      })
    );
    schema.properties = properties;
    schema.required = Object.keys(node.properties ?? {});
    schema.additionalProperties = false;
  } else if (node.type === SchemaType.ARRAY) {
    schema.items = node.items ? toOpenAIJsonSchema(node.items) : {};
  }

  return schema;
}

async function parseOpenAIError(response: Response): Promise<string> {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; code?: string; type?: string } };
    const details = [parsed.error?.message, parsed.error?.type, parsed.error?.code].filter(Boolean).join(" | ");
    return `[OpenAI Error]: ${response.status} ${response.statusText}${details ? ` - ${details}` : ""}`;
  } catch {
    return `[OpenAI Error]: ${response.status} ${response.statusText}${raw ? ` - ${raw}` : ""}`;
  }
}

async function generateStructuredContentWithOpenAI<T>({
  prompt,
  responseSchema,
  systemInstruction,
  temperature,
  preferredModel,
  usageCollector,
  usageOperation,
}: {
  prompt: string;
  responseSchema: object;
  systemInstruction?: string;
  temperature: number;
  preferredModel?: string;
  usageCollector?: GeminiUsageCollector;
  usageOperation?: string;
}): Promise<T> {
  const apiKey = ensureOpenAIConfigured();
  const model = preferredModel || OPENAI_PRIMARY_MODEL;
  const response = await Sentry.startSpan(
    { name: `ai.openai/${model}`, op: "ai.call", attributes: { model } },
    () => fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: OPENAI_STRUCTURED_OUTPUT_NAME,
            strict: true,
            schema: toOpenAIJsonSchema(responseSchema as GeminiSchemaNode),
          },
        },
      }),
    })
  );

  if (!response.ok) {
    throw new Error(await parseOpenAIError(response));
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const content = payload.choices?.[0]?.message?.content;
  const rawText = Array.isArray(content)
    ? content
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("")
    : typeof content === "string"
      ? content
      : "";

  recordUsage(usageCollector, "openai", model, usageOperation ?? "structured_content", {
    inputTokens: payload.usage?.prompt_tokens ?? 0,
    outputTokens: payload.usage?.completion_tokens ?? 0,
    totalTokens: payload.usage?.total_tokens ?? 0,
  });

  return parseJsonResponse<T>(rawText);
}

async function generateStructuredContent<T>({
  prompt,
  responseSchema,
  systemInstruction,
  temperature,
  useFastModel = false,
  usageCollector,
  usageOperation,
}: {
  prompt: string;
  responseSchema: object;
  systemInstruction?: string;
  temperature: number;
  /** Use the faster/cheaper model tier (gpt-4.1-mini → gemini-2.5-flash fallback) */
  useFastModel?: boolean;
  usageCollector?: GeminiUsageCollector;
  usageOperation?: string;
}): Promise<T> {
  const openAIModel = useFastModel ? OPENAI_FAST_MODEL : OPENAI_PRIMARY_MODEL;
  const geminiModel = useFastModel ? GEMINI_FAST_FALLBACK_MODEL : GEMINI_FALLBACK_MODEL;

  // Try OpenAI first with retries — it's the primary and is reliable
  let lastOpenAIError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
    try {
      return await generateStructuredContentWithOpenAI<T>({
        prompt,
        responseSchema,
        systemInstruction,
        temperature,
        preferredModel: openAIModel,
        usageCollector,
        usageOperation,
      });
    } catch (err) {
      lastOpenAIError = err;
      if (attempt < MAX_ATTEMPTS_PER_MODEL) {
        await sleep(computeRetryDelayMs(attempt, err));
      }
    }
  }

  // Gemini fallback — try each model up to MAX_ATTEMPTS_PER_MODEL times with backoff before moving on
  const geminiModels = Array.from(new Set([geminiModel, GEMINI_FAST_FALLBACK_MODEL]));
  const geminiErrors: string[] = [];
  for (const gModel of geminiModels) {
    let lastModelError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const generationConfig: Record<string, unknown> = {
          responseMimeType: "application/json",
          responseSchema: responseSchema as any,
          temperature,
        };
        const model = getGenAI().getGenerativeModel({
          model: gModel,
          systemInstruction,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          generationConfig: generationConfig as any,
        });
        const result = await Sentry.startSpan(
          { name: `ai.gemini/${gModel}`, op: "ai.call", attributes: { model: gModel } },
          () => model.generateContent(prompt)
        );
        recordGeminiUsage(usageCollector, gModel, usageOperation ?? "structured_content", result.response.usageMetadata);
        return parseJsonResponse<T>(result.response.text());
      } catch (geminiError) {
        lastModelError = geminiError;
        const msg = geminiError instanceof Error ? geminiError.message : String(geminiError);
        const isTransient =
          msg.includes("503") ||
          msg.includes("overloaded") ||
          msg.includes("high demand") ||
          msg.includes("unavailable");
        if (isTransient && attempt < MAX_ATTEMPTS_PER_MODEL) {
          await new Promise((r) => setTimeout(r, HIGH_DEMAND_RETRY_BASE_MS * attempt));
          continue;
        }
        if (!isTransient) break;
      }
    }
    const modelMsg = lastModelError instanceof Error ? lastModelError.message : String(lastModelError);
    geminiErrors.push(`${gModel}: ${modelMsg}`);
  }
  const openAIMsg = lastOpenAIError instanceof Error ? lastOpenAIError.message : String(lastOpenAIError);
  throw new Error(`OpenAI failed (${MAX_ATTEMPTS_PER_MODEL} attempts): ${openAIMsg}. Gemini fallback failed — ${geminiErrors.join(" | ")}`);
}

function detectRequiredAttachments(text: string): RequiredAttachment[] {
  const matches = REQUIRED_ATTACHMENT_PATTERNS.filter(({ pattern }) => pattern.test(text));
  const deduped = new Map<string, RequiredAttachment>();
  for (const match of matches) {
    const key = `${match.type}:${match.reason}`;
    deduped.set(key, {
      type: match.type,
      reason: match.reason,
      required: true,
    });
  }
  return Array.from(deduped.values());
}

function inferSourceBundleStatus(
  requiredAttachments: RequiredAttachment[],
  supportingDocsCount = 0
): SourceBundleStatus {
  if (requiredAttachments.length > 0 && supportingDocsCount < requiredAttachments.length) {
    return "missing_required_attachments";
  }
  if (supportingDocsCount > 0 && requiredAttachments.length === 0) {
    return "partial_optional_context";
  }
  return "complete";
}

function toOptionalSupportingAttachments(requiredAttachments: RequiredAttachment[]): RequiredAttachment[] {
  return requiredAttachments.map((attachment) => ({
    ...attachment,
    required: false,
  }));
}

function applyGoLiveSOWRules(result: SOWValidationResult): SOWValidationResult {
  if (!result.isSOW) return result;

  const optionalAttachments = toOptionalSupportingAttachments(result.required_attachments ?? []);
  const hasOptionalAttachments = optionalAttachments.length > 0;

  return {
    ...result,
    should_block_generation: false,
    required_attachments: optionalAttachments,
    source_bundle_status:
      result.source_bundle_status === "missing_required_attachments" || hasOptionalAttachments
        ? "partial_optional_context"
        : result.source_bundle_status,
    flags: hasOptionalAttachments
      ? Array.from(
          new Set([
            ...result.flags,
            "SOW-only generation is allowed. Supporting drawings/documents may improve accuracy but are optional.",
          ])
        ).slice(0, 6)
      : result.flags,
  };
}

function normalizeSourceDocumentType(
  type: GenerationInputDocument["document_type"] | undefined,
  role: "primary" | "supporting"
): SourceBundleDocument["document_type"] {
  if (type) return type;
  return role === "primary" ? "construction_sow" : "supporting_context";
}

function buildSourceBundle(documents: GenerationInputDocument[]): SourceBundleDocument[] {
  return documents.map((doc) => ({
    document_id: doc.document_id,
    name: doc.name,
    document_type: normalizeSourceDocumentType(doc.document_type, doc.role),
    role: doc.role,
    pages: doc.pages ?? null,
  }));
}

function drawingLabel(doc: GenerationInputDocument): string {
  const type = doc.drawing_type;
  const subject = doc.subject_name ? ` (${doc.subject_name})` : "";
  switch (type) {
    case "site_plan":          return `ATTACHED SITE PLAN${subject}`;
    case "floor_plan":         return `ATTACHED FLOOR PLAN${subject}`;
    case "elevation":          return `ATTACHED ELEVATION DRAWING${subject}`;
    case "section":            return `ATTACHED SECTION DRAWING${subject}`;
    case "structural":         return `ATTACHED STRUCTURAL DRAWING${subject}`;
    case "services":           return `ATTACHED SERVICES DRAWING${subject}`;
    case "schedule_of_finishes": return `ATTACHED SCHEDULE OF FINISHES${subject}`;
    default:                   return `ATTACHED DRAWING${subject}`;
  }
}

function drawingInstruction(drawingType: string | null | undefined): string {
  switch (drawingType) {
    case "floor_plan":
      return "INSTRUCTION: Extract every room name, count, and dimensions. Note door/window positions and finish schedule.\n";
    case "site_plan":
      return "INSTRUCTION: Extract site boundaries, block positions, road/access layout, overall dimensions, and building footprints.\n";
    case "structural":
      return "INSTRUCTION: Extract column grid references and spacings, slab thicknesses, beam sizes, foundation depth and type.\n";
    case "services":
      return "INSTRUCTION: Extract pipe runs, fixture counts, circuit counts, distribution board locations.\n";
    case "elevation":
    case "section":
      return "INSTRUCTION: Extract floor-to-ceiling heights, wall heights, roof pitch, window and door sizes.\n";
    default:
      return "INSTRUCTION: Read all room labels, dimensions, counts, schedules, and structural notes from this drawing.\n";
  }
}

function buildPromptBundle(documents: GenerationInputDocument[]): string {
  const drawings = documents.filter(
    (d) => d.role === "supporting" && (
      d.document_type === "drawing_set" ||
      d.drawing_type != null ||
      /drawing|floor plan|site plan/i.test(d.name)
    )
  );

  let header = "";
  if (drawings.length > 0) {
    const drawingDescriptions = drawings.map((d) => {
      const type = d.drawing_type ?? "drawing";
      const label = type.replace(/_/g, " ");
      return d.subject_name ? `${label} (${d.subject_name})` : label;
    });
    header = `NOTE: This bundle includes engineering drawings: ${drawingDescriptions.join(", ")}. Use them to derive room counts, dimensions, structural elements, and quantities. Cross-reference with the SOW text.\n\n`;
  }

  let primaryIndex = 0;
  let supportingIndex = 0;

  const body = documents
    .map((doc) => {
      const isDrawing = doc.role === "supporting" && (
        doc.document_type === "drawing_set" ||
        doc.drawing_type != null ||
        /drawing|floor plan|site plan/i.test(doc.name)
      );

      let label: string;
      let instruction = "";

      if (doc.role === "primary") {
        primaryIndex++;
        label = `PRIMARY SOW ${primaryIndex}`;
      } else if (isDrawing) {
        supportingIndex++;
        label = `${drawingLabel(doc)} ${supportingIndex}`;
        instruction = drawingInstruction(doc.drawing_type);
      } else {
        supportingIndex++;
        label = `ATTACHED ${(doc.document_type ?? "DOCUMENT").toString().toUpperCase()} ${supportingIndex}`;
      }

      return [
        `### ${label}`,
        `document_id: ${doc.document_id}`,
        `name: ${doc.name}`,
        `pages: ${doc.pages ?? "unknown"}`,
        instruction,
        doc.text,
      ].join("\n");
    })
    .join("\n\n");

  return header + body;
}

function inferSOWHeuristics(text: string, supportingDocsCount = 0): SOWValidationResult {
  const preview = text.slice(0, 12000).toLowerCase();
  const requiredAttachments = detectRequiredAttachments(text);
  const sourceBundleStatus = inferSourceBundleStatus(requiredAttachments, supportingDocsCount);
  const headingHits = countTextHits(preview, SOW_HEADING_TERMS);
  const tradeHits = countTextHits(preview, TRADE_SECTION_TERMS);
  const executionHits = countTextHits(preview, CONSTRUCTION_EXECUTION_TERMS);
  const unitHits = countPatternHits(preview, CONSTRUCTION_UNIT_PATTERN);
  const specHits = CONSTRUCTION_SPEC_PATTERNS.reduce(
    (count, pattern) => count + countPatternHits(preview, pattern),
    0
  );
  const questionnaireHits = countTextHits(preview, NON_SOW_QUESTIONNAIRE_TERMS);
  const productHits =
    countTextHits(preview, NON_SOW_PRODUCT_TERMS) +
    countPatternHits(preview, NON_SOW_PRODUCT_PATTERN);
  const creativeHits = countTextHits(preview, NON_SOW_CREATIVE_TERMS);
  const commercialHits = countTextHits(preview, NON_SOW_COMMERCIAL_TERMS);
  const abstractSectionHits = countTextHits(preview, NON_SOW_ABSTRACT_SECTION_TERMS);
  const hasBOQTableSignals =
    preview.includes("item no") &&
    preview.includes("description") &&
    preview.includes("rate") &&
    preview.includes("amount");
  const hasConstructionDocumentSignals =
    preview.includes("scope of work") ||
    preview.includes("bill no") ||
    preview.includes("boq") ||
    preview.includes("contractor shall");
  const hasScopeLikeContent =
    headingHits >= 2 || tradeHits >= 2 || executionHits >= 4 || specHits >= 3;

  const positiveCategories = [
    headingHits >= 2,
    tradeHits >= 2,
    executionHits >= 4,
    unitHits >= 4,
    specHits >= 3,
    hasBOQTableSignals,
    hasConstructionDocumentSignals,
  ].filter(Boolean).length;
  const negativeCategories = [
    questionnaireHits >= 2,
    productHits >= 3,
    creativeHits >= 2,
    commercialHits >= 2,
    abstractSectionHits >= 4,
  ].filter(Boolean).length;

  const flags: string[] = [];
  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];
  if (positiveCategories < 2) flags.push("Missing enough construction-document markers for a reliable SOW classification.");
  if (tradeHits < 2) flags.push("Very few construction trade sections were found.");
  if (unitHits < 3 && specHits < 2) flags.push("Very little measurable or material/specification language was found.");
  if (questionnaireHits >= 2) flags.push("Document reads more like a questionnaire or survey than a works specification.");
  if (productHits >= 3) flags.push("Document reads more like a product/system specification than a construction works scope.");
  if (creativeHits >= 2) flags.push("Document reads more like creative or lyrical content than a project scope.");
  if (commercialHits >= 2) flags.push("Document reads more like a commercial/rate schedule than a scope document.");
  if (headingHits >= 2) positiveSignals.push("Contains recognised scope/BOQ headings.");
  if (tradeHits >= 2) positiveSignals.push("Contains construction trade sections.");
  if (executionHits >= 4) positiveSignals.push("Contains contractor/specification execution language.");
  if (unitHits >= 4 || specHits >= 3) positiveSignals.push("Contains measurable/specification detail.");
  if (hasBOQTableSignals) positiveSignals.push("Contains BOQ-style tabular columns.");
  if (questionnaireHits >= 2) negativeSignals.push("Questionnaire/survey style prompts detected.");
  if (productHits >= 3) negativeSignals.push("Product/software specification language detected.");
  if (creativeHits >= 2) negativeSignals.push("Creative or lyrical language detected.");
  if (commercialHits >= 2) negativeSignals.push("Commercial/rate-sheet language detected.");
  if (abstractSectionHits >= 4) negativeSignals.push("Abstract planning sections outweigh scope detail.");

  const positiveScore =
    headingHits * 1.35 +
    tradeHits * 1.2 +
    executionHits * 0.7 +
    Math.min(unitHits, 8) * 0.45 +
    Math.min(specHits, 8) * 0.6 +
    (hasBOQTableSignals ? 3 : 0) +
    (hasConstructionDocumentSignals ? 2 : 0) +
    positiveCategories * 0.8;
  const negativeScore =
    questionnaireHits * 1.5 +
    productHits * 1.1 +
    creativeHits * 1.8 +
    commercialHits * 1.3 +
    abstractSectionHits * 0.55 +
    negativeCategories * 0.8;

  if (hasBOQTableSignals && commercialHits >= 1 && !hasScopeLikeContent) {
    return {
      isSOW: false,
      reason:
        "This looks like a rate sheet, priced BOQ, or commercial schedule rather than a statement of work describing the underlying construction scope.",
      confidence: 0.9,
      documentType: "boq_or_cost_document",
      should_block_generation: true,
      required_attachments: requiredAttachments,
      source_bundle_status: sourceBundleStatus,
      positive_signals: positiveSignals,
      negative_signals: negativeSignals,
      flags,
    };
  }

  if ((positiveCategories <= 1 && positiveScore < 6) || (negativeCategories >= 2 && positiveCategories < 3)) {
    return {
      isSOW: false,
      reason:
        "This document does not contain enough construction scope, trade, and measurable works signals to be treated as a BOQ-ready statement of work.",
      confidence: clamp01(0.8 + Math.min(0.14, Math.abs(negativeScore - positiveScore) * 0.02)),
      documentType:
        creativeHits >= 2 || questionnaireHits >= 2
          ? "questionnaire_or_survey"
          : productHits >= 3
            ? "product_or_software_spec"
            : "unknown",
      should_block_generation:
        sourceBundleStatus === "missing_required_attachments" ? true : true,
      required_attachments: requiredAttachments,
      source_bundle_status: sourceBundleStatus,
      positive_signals: positiveSignals,
      negative_signals: negativeSignals,
      flags,
    };
  }

  if (positiveCategories >= 3 && positiveScore >= negativeScore + 2) {
    return {
      isSOW: true,
      reason:
        "This document contains the sectioning, trade language, contractor obligations, and measurable specification detail expected in a construction SOW/BOQ source.",
      confidence: clamp01(0.72 + Math.min(0.18, (positiveScore - negativeScore) * 0.03)),
      documentType:
        hasBOQTableSignals && hasScopeLikeContent ? "engineering_spec" : "construction_sow",
      should_block_generation: sourceBundleStatus === "missing_required_attachments",
      required_attachments: requiredAttachments,
      source_bundle_status: sourceBundleStatus,
      positive_signals: positiveSignals,
      negative_signals: negativeSignals,
      flags,
    };
  }

  return {
    isSOW: false,
    reason:
      "This document does not show enough reliable construction BOQ signals to safely treat it as a statement of work.",
    confidence: clamp01(0.55 + Math.min(0.2, Math.abs(negativeScore - positiveScore) * 0.02)),
    documentType:
      questionnaireHits >= 2 || creativeHits >= 2
        ? "creative_or_unstructured"
        : productHits >= 3
          ? "product_or_software_spec"
          : "unknown",
    should_block_generation: true,
    required_attachments: requiredAttachments,
    source_bundle_status: sourceBundleStatus,
    positive_signals: positiveSignals,
    negative_signals: negativeSignals,
    flags,
  };
}

function getGenAI() {
  const key = getServerEnv("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenerativeAI(key);
}

const STRUCTURE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    project: { type: SchemaType.STRING },
    location: { type: SchemaType.STRING },
    prepared_by: { type: SchemaType.STRING },
    date: { type: SchemaType.STRING },
    bills: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          number: { type: SchemaType.NUMBER },
          title: { type: SchemaType.STRING },
          items: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                item_key: { type: SchemaType.STRING, nullable: true },
                item_no: { type: SchemaType.STRING, nullable: true },
                description: { type: SchemaType.STRING },
                unit: { type: SchemaType.STRING, nullable: true },
                section_context: { type: SchemaType.STRING, nullable: true },
                source_excerpt: { type: SchemaType.STRING, nullable: true },
                is_header: { type: SchemaType.BOOLEAN, nullable: true },
                note: { type: SchemaType.STRING, nullable: true },
              },
              required: ["description"],
            },
          },
        },
        required: ["number", "title", "items"],
      },
    },
  },
  required: ["project", "location", "prepared_by", "date", "bills"],
};

const QUANTITY_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    items: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          item_key: { type: SchemaType.STRING },
          qty: { type: SchemaType.NUMBER, nullable: true },
          unit: { type: SchemaType.STRING, nullable: true },
          quantity_source: { type: SchemaType.STRING, nullable: true },
          quantity_confidence: { type: SchemaType.NUMBER, nullable: true },
          source_excerpt: { type: SchemaType.STRING, nullable: true },
          source_anchor: { type: SchemaType.STRING, nullable: true },
          source_document: { type: SchemaType.STRING, nullable: true },
          evidence_type: { type: SchemaType.STRING, nullable: true },
          derivation_note: { type: SchemaType.STRING, nullable: true },
          note: { type: SchemaType.STRING, nullable: true },
        },
        required: ["item_key", "qty"],
      },
    },
  },
  required: ["items"],
};

const STRUCTURE_PROMPT = `You are a senior quantity surveyor practising under ASAQS conventions (Southern African QS Association, aligned with SMM7). You produce Bills of Quantities to the standard expected by Zambian consulting firms and public-sector clients.

TASK:
Extract the complete BOQ structure from the provided Scope of Work. Output bill hierarchy and item descriptions only — no quantities, rates, or amounts.

BILL SEQUENCING (follow this trade order):
Bill 1 — PRELIMINARY AND GENERAL ITEMS (mobilisation, site establishment, health & safety, insurance, temporary works, as-builts)
Bill 2 — SUBSTRUCTURE (site clearance, earthworks, ant-proofing, hardcore, blinding, foundations, surface beds, DPM, plinth walls)
Bill 3 — SUPERSTRUCTURE (columns, beams, suspended slabs, structural frame, walling above plinth)
Bill 4 — ROOFING (roof structure/trusses, roof covering, fascias, gutters, downpipes)
Bill 5 — INTERNAL FINISHES (internal plaster, screeds, floor finishes, wall tiles, ceiling finishes, painting internal)
Bill 6 — EXTERNAL WORKS & FINISHES (external plaster, painting external, paving, drainage channels, boundary walls, fencing)
Bill 7 — JOINERY & IRONMONGERY (doors, frames, windows, ironmongery)
Bill 8 — PLUMBING & DRAINAGE (water supply pipework, sanitary fittings, soil and waste pipes, stormwater drainage, manholes, septic tanks)
Bill 9 — ELECTRICAL INSTALLATION (conduit, cables, socket outlets, switches, light fittings, distribution boards, earthing)
Bill 10+ — Any project-specific additional bills (e.g. EXTERNAL SERVICES, SPECIALIST WORKS, LANDSCAPING)

Omit any bill for which the SOW contains no measurable scope. Merge bills only when scope is genuinely combined in the SOW.

DESCRIPTION STYLE — follow ASAQS/SMM7 description rules exactly:
- State the work method first, then material, then location: e.g. "Excavate in pickable material for foundation trenches not exceeding 1.50m deep, get out and deposit in temporary spoil heaps on site"
- Include material specification where given: grade, size, mix ratio, gauge, thickness — e.g. "Vibrated reinforced in-situ concrete (Grade 30) in 200mm horizontal suspended roof slab"
- For repeated items write "Ditto" only when the description is truly identical and the unit is the same
- State dimensions that affect measurement in the description: "not exceeding 150mm wide", "exceeding 1.5m but not exceeding 3.0m high"
- For supply-and-fix items, say so: "Supply and fix ..."
- For materials measured net: add "(measured net — no allowance made for laps)" as Innocent does
- Write in British English (metre not meter, labour not labor, colour not color)

ITEM RULES:
1. Every non-header item must have a description, a unit, and a stable item_key.
2. Use section headers (is_header: true) to group trade sections within a bill: e.g. "Excavation and Earthworks", "Concrete Works", "Blockwork".
3. Do not invent quantities, rates, or amounts.
4. Preliminary items: mobilisation, demobilisation, setting out, dewatering, ant-proofing treatment of excavations, health & safety, insurance, as-built drawings — all belong in Bill 1.
5. Include provisional sums for work that cannot be fully quantified from the SOW — e.g. "Provisional Sum for Electrical Installation — PC Sum" measured as Item.
6. Include a Contingency allowance in the final bill or summary — typically 5–10% of the measured works — as a Provisional Sum item.
7. If project metadata (client name, location, date) is missing from the SOW, infer reasonable placeholders.

UNITS (use these exactly):
m² — area, m³ — volume, m — linear (not lm or lm), No. — enumerated items, Item — lump sum occurrence, LS — lump sum (for one-off allowances), kg — steel reinforcement, t — bulk materials by weight

USING ATTACHED DRAWINGS:
When the document bundle includes [ENGINEERING DRAWING: ...] sections, use them to supplement the SOW:
- Extract every room name and count (e.g. "8 × Classroom") to generate the correct number of measurable spaces and ensure no room type is omitted
- Use dimensions shown (mm or m) to add area (m²), volume (m³), and linear (m) items that the SOW prose may not state explicitly
- Use column grid references and spacings to populate concrete frame and structural items
- Use door and window schedules to populate joinery items with correct quantities and sizes
- Use finish schedules to add internal finishes items per room type
- Use the title block (project name, drawing number, scale) to confirm project scope
Cross-reference drawing labels against the SOW text to resolve ambiguities. If the SOW and drawing conflict, prefer the drawing for quantities and the SOW for specification.`;

const STRUCTURE_RECOVERY_PROMPT = `You are recovering a failed BOQ structure extraction.

TASK:
Return a non-empty BOQ structure. Prioritise capturing all measurable work items.

RULES:
1. Include at least one non-header item per relevant bill.
2. Keep PRELIMINARY AND GENERAL ITEMS as Bill No. 1.
3. Do not output quantities, rates, or amounts.
4. Use item_key for every non-header item.
5. If uncertain, include the item with best possible description rather than dropping it.
6. Write descriptions in ASAQS style: work method + material + location/dimension.`;

const QUANTITY_PROMPT = `You are a senior quantity surveyor performing a taking-off exercise under ASAQS/SMM7 measurement rules. You extract or estimate quantities from the Scope of Work for each pre-defined BOQ item.

TASK:
Given the SOW text and a predefined BOQ item list, return quantity data keyed by item_key.

MEASUREMENT RULES (ASAQS/SMM7 — apply these to every item):
- Concrete: measured net in place (no allowance for waste or over-pour). Foundations measured from stripped level to underside of next element.
- Reinforcement: measured by mass (kg) calculated from bar schedule or estimated from structural description. Laps, tying wire, and spacers not measured separately.
- Formwork: measured to the net area of concrete face in contact with formwork.
- Brickwork/blockwork: measured flat (gross area including openings up to 0.1m² — deduct openings exceeding 0.1m²). No adjustment for bonds or mortar.
- Plasterwork: measured net on face, deducting openings exceeding 0.5m².
- Floor finishes/tiles: measured net, deducting all openings exceeding 0.1m².
- DPM (polythene sheet): measured net — no allowance for laps (state this in the item description).
- Mesh reinforcement: measured net — no allowance for laps.
- Roofing sheets: measured on the slope, net.
- Timber (purlins, rafters, wall plates): measured in linear metres (m), not m².
- Doors and windows: measured by number (No.) as enumerated units.
- Pipework: measured in linear metres (m) along centreline, not including fittings.
- Excavation: measured net in the ground, no bulking factor.
- Filling/compaction: measured net compacted volume.
- Preliminary items (mobilisation, dewatering, ant-proofing treatments, insurance): measured as Item or LS — qty = 1.
- Provisional sums and contingencies: qty = 1, unit = Item.

EVIDENCE RULES:
1. Never change item_key values.
2. Any non-null qty must include source_excerpt — copy the relevant text verbatim from the SOW.
3. Use quantity_source:
   - explicit: dimension or count directly stated in SOW
   - derived: calculated from stated dimensions (show working in derivation_note)
   - assumed: not stated — use a reasonable QS estimate based on project type and description
4. If evidence is genuinely absent and no reasonable assumption can be made, set qty null.
5. Set quantity_confidence between 0 and 1 (1.0 = explicitly stated, 0.7 = reliably derived, 0.4 = assumed).
6. Set evidence_type:
   - quoted_scope: directly quoted from prose
   - tabulated_scope: from schedule or table in SOW
   - derived_calculation: calculated from stated dimensions
   - metadata_only: only header/title information available
   - missing: no usable evidence
7. Set source_anchor to nearest page marker or section heading.
8. Set source_document to the document_id the evidence came from.
9. If evidence_type is derived_calculation, add derivation_note with the arithmetic.

USING ATTACHED DRAWINGS FOR QUANTITIES:
When the document bundle includes [ENGINEERING DRAWING: ...] sections, read them carefully for take-off data:
- Room counts: multiply unit area by count to derive total m² (e.g. "8 × Classroom 8000×6000mm" → 8 × 48m² = 384m²)
- Overall building footprint from dimension strings → use for slab, foundations, roof
- Structural grid spacing → use for column spacing to count columns (No.) or calculate beam lengths (m)
- Door/window schedule quantities → use directly as No. counts
- Floor-to-ceiling heights → use for wall areas and column heights
Always show your dimensional arithmetic in derivation_note. Set evidence_type to "derived_calculation" and source_document to the drawing filename.`;

function buildMultiBlockStructurePrompt(blocks: string[]): string {
  const blockList = blocks.length > 0
    ? blocks.map((b, i) => `Bill ${i + 2} — ${b.toUpperCase()}`).join("\n")
    : "Bill 2 onwards — one bill per named structure/block";

  return STRUCTURE_PROMPT.replace(
    /BILL SEQUENCING \(follow this trade order\):[\s\S]*?Bill 10\+ — Any project-specific additional bills.*?\n/,
    `BILL STRUCTURE (multi-block project):
Bill 1 — PRELIMINARY AND GENERAL ITEMS (same rules as always — mobilisation, site establishment, health & safety, insurance, temporary works, as-builts)
${blockList}
  Within each block bill, use section headers (is_header: true) for trade groupings:
  "Substructure", "Superstructure", "Roofing", "Internal Finishes", "Joinery & Ironmongery", "Plumbing & Drainage", "Electrical Installation"
  Do NOT create separate bills per trade — trades are section headers within each block bill.
  Use exactly the block names listed above. Do not merge blocks or invent new ones.
Final bill — EXTERNAL WORKS AND SERVICES (site-wide items not belonging to a single block: external paving, boundary walls, drainage reticulation, site clearance)

`
  );
}

async function classifyProjectStructure(
  documents: GenerationInputDocument[],
  usageCollector?: GeminiUsageCollector
): Promise<{ structure_type: StructureMode; blocks: string[] }> {
  try {
    const primaryText = documents
      .filter((d) => d.role === "primary")
      .map((d) => d.text.slice(0, 3000))
      .join("\n");

    const subjectNames = documents
      .filter((d) => d.role === "supporting" && d.subject_name)
      .map((d) => d.subject_name as string);

    const contextSuffix = subjectNames.length > 0
      ? `\n\nBlocks identified in attached drawings: ${subjectNames.join(", ")}`
      : "";

    const result = await callModel<{ structure_type: string; blocks: string[] }>({
      prompt: `Classify this construction project scope:\n\n${primaryText}${contextSuffix}`,
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          structure_type: { type: SchemaType.STRING },
          blocks: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        },
        required: ["structure_type", "blocks"],
      },
      systemInstruction: `You are classifying a construction project scope. Determine whether this is a single-structure project or a multi-block project.
A multi-block project has two or more distinct named buildings or blocks in scope (e.g. Admin Block, Classroom Block, Ablution Block).
Return structure_type as "multi_block" if two or more named structures are clearly identified; otherwise return "single".
Return blocks as an array of block names in the order they appear in the SOW. Use short descriptive names (e.g. "Block A: Administration Block").`,
      temperature: 0,
      useFastModel: true,
      usageCollector,
      usageOperation: "classify_project_structure",
    });

    const isMultiBlock = result.structure_type === "multi_block" && Array.isArray(result.blocks) && result.blocks.length >= 2;
    return {
      structure_type: isMultiBlock ? "block_based" : "trade_based",
      blocks: isMultiBlock ? result.blocks : [],
    };
  } catch {
    return { structure_type: "trade_based", blocks: [] };
  }
}

async function generateStructure(
  bundleText: string,
  recoveryMode: boolean,
  structureMode: StructureMode = "trade_based",
  blocks: string[] = [],
  usageCollector?: GeminiUsageCollector
): Promise<StructurePassResponse> {
  const systemInstruction = recoveryMode
    ? STRUCTURE_RECOVERY_PROMPT
    : structureMode === "block_based"
      ? buildMultiBlockStructurePrompt(blocks)
      : STRUCTURE_PROMPT;

  return callModel<StructurePassResponse>({
    prompt: `Extract BOQ structure only from this document bundle:\n\n${bundleText}`,
    responseSchema: STRUCTURE_SCHEMA,
    systemInstruction,
    temperature: recoveryMode ? 0.3 : 0.2,
    useFastModel: true,
    usageCollector,
    usageOperation: recoveryMode ? "generate_structure_recovery" : "generate_structure",
  });
}

async function extractQuantities(
  bundleText: string,
  structure: BOQStructureArtifact,
  usageCollector?: GeminiUsageCollector
): Promise<QuantityPassResponse> {
  const itemCatalog = structure.bills.flatMap((bill) =>
    bill.items
      .filter((item) => !item.is_header)
      .map((item) => ({
        item_key: item.item_key,
        bill_number: bill.number,
        bill_title: bill.title,
        item_no: item.item_no,
        description: item.description,
        unit_hint: item.unit,
      }))
  );

  return callModel<QuantityPassResponse>({
    prompt: `DOCUMENT BUNDLE:\n${bundleText}\n\nITEMS TO QUANTIFY (JSON):\n${JSON.stringify(
      itemCatalog
    )}`,
    responseSchema: QUANTITY_SCHEMA,
    systemInstruction: QUANTITY_PROMPT,
    temperature: 0.1,
    useFastModel: true,
    usageCollector,
    usageOperation: "extract_quantities",
  });
}

async function callModel<T>({
  prompt,
  responseSchema,
  systemInstruction,
  temperature,
  useFastModel,
  usageCollector,
  usageOperation,
}: {
  prompt: string;
  responseSchema: object;
  systemInstruction: string;
  temperature: number;
  useFastModel?: boolean;
  usageCollector?: GeminiUsageCollector;
  usageOperation?: string;
}): Promise<T> {
  return generateStructuredContent<T>({
    prompt,
    responseSchema,
    systemInstruction,
    temperature,
    useFastModel,
    usageCollector,
    usageOperation,
  });
}

function parseJsonResponse<T>(raw: string): T {
  const trimmed = raw.trim();
  const cleaned = trimmed.startsWith("```")
    ? trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "")
    : trimmed;

  const candidates = [
    cleaned,
    cleaned.replace(/^\uFEFF/, ""),
  ];

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }

  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(cleaned.slice(firstBracket, lastBracket + 1));
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Could not parse model JSON response.");
}

function normalizeStructure(raw: StructurePassResponse): BOQStructureArtifact {
  return {
    project: safeText(raw.project, "Untitled BOQ"),
    location: safeText(raw.location, "Unknown Location"),
    prepared_by: safeText(raw.prepared_by, "BOQ Generator"),
    date: safeText(raw.date, new Date().toISOString().slice(0, 10)),
    bills: (raw.bills ?? []).map((bill, billIndex) => ({
      number: Number.isFinite(bill.number) ? bill.number : billIndex + 1,
      title: safeText(bill.title, `BILL ${billIndex + 1}`),
      items: (bill.items ?? []).map((item, itemIndex) => {
        const isHeader = Boolean(item.is_header);
        const itemKey =
          !isHeader && item.item_key && item.item_key.trim()
            ? item.item_key.trim()
            : `b${billIndex + 1}_i${itemIndex + 1}`;
        return {
          item_key: itemKey,
          item_no: safeText(item.item_no, ""),
          description: safeText(item.description, "Unspecified work item"),
          unit: normalizeUnit(item.unit),
          section_context: safeNullableText(item.section_context) ?? undefined,
          source_excerpt: safeNullableText(item.source_excerpt),
          is_header: isHeader,
          note: item.note ?? undefined,
        };
      }),
    })),
  };
}

function countNonHeaderItems(structure: BOQStructureArtifact): number {
  return structure.bills.reduce(
    (sum, bill) => sum + bill.items.filter((item) => !item.is_header).length,
    0
  );
}

function normalizeLabelText(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|and|for|with|including|new|approved|complete|as|per)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCountableDrawingLabel(description: string): boolean {
  const normalized = normalizeLabelText(description);
  if (!normalized) return false;
  const wordCount = normalized.split(" ").length;
  const hasComma = description.includes(",");
  const hasLongSentence = wordCount > 5;
  const actionLike = /\b(install|construct|provide|erect|supply|lay|testing|commissioning)\b/i.test(
    description
  );
  return !hasComma && !hasLongSentence && !actionLike;
}

function countLabelMatches(text: string, description: string): { count: number; excerpt: string | null } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const normalizedTarget = normalizeLabelText(description);
  if (!normalizedTarget) return { count: 0, excerpt: null };

  let count = 0;
  let excerpt: string | null = null;
  for (const line of lines) {
    const normalizedLine = normalizeLabelText(line);
    if (!normalizedLine) continue;
    if (
      normalizedLine === normalizedTarget ||
      normalizedLine.includes(normalizedTarget) ||
      normalizedTarget.includes(normalizedLine)
    ) {
      count += 1;
      if (!excerpt) excerpt = line;
    }
  }

  return { count, excerpt };
}

function supportingDocsSatisfyRequirements(
  documents: GenerationInputDocument[],
  requiredAttachments: RequiredAttachment[]
): boolean {
  const supportingTypes = new Set(
    documents
      .filter((doc) => doc.role === "supporting")
      .map((doc) => String(doc.document_type || "").toLowerCase())
  );

  return requiredAttachments.every((attachment) => {
    const type = attachment.type.toLowerCase();
    if (type === "unknown") return supportingTypes.size > 0;
    return supportingTypes.has(type) || supportingTypes.has(`${type}s`);
  });
}

function applyDrawingCountHeuristics(
  structure: BOQStructureArtifact,
  quantities: QuantityPassResponse,
  documents: GenerationInputDocument[]
): QuantityPassResponse {
  const itemMeta = new Map<string, { description: string; unit: string }>();
  for (const bill of structure.bills) {
    for (const item of bill.items) {
      if (!item.is_header) {
        itemMeta.set(item.item_key, { description: item.description, unit: item.unit });
      }
    }
  }

  const supportingDocs = documents.filter((doc) => doc.role === "supporting" && doc.text.trim().length > 0);
  if (supportingDocs.length === 0) return quantities;

  return {
    items: (quantities.items ?? []).map((item) => {
      if (item.qty !== null && item.qty !== undefined) return item;
      const meta = itemMeta.get(item.item_key);
      if (!meta || !isCountableDrawingLabel(meta.description)) return item;

      let best: { count: number; excerpt: string | null; docId: string | null } = {
        count: 0,
        excerpt: null,
        docId: null,
      };

      for (const doc of supportingDocs) {
        const match = countLabelMatches(doc.text, meta.description);
        if (match.count > best.count) {
          best = { count: match.count, excerpt: match.excerpt, docId: doc.document_id };
        }
      }

      if (best.count <= 0 || best.count > 5) return item;

      return {
        ...item,
        qty: best.count,
        unit: item.unit ?? (meta.unit && meta.unit !== "Item" ? meta.unit : "No."),
        quantity_source: "derived",
        quantity_confidence: 0.72,
        source_excerpt: best.excerpt ?? item.source_excerpt ?? null,
        source_anchor: item.source_anchor ?? "Drawing label count",
        source_document: best.docId ?? item.source_document ?? null,
        evidence_type: "derived_calculation",
        derivation_note:
          item.derivation_note ??
          `Counted ${best.count} matching drawing label${best.count === 1 ? "" : "s"} for "${meta.description}".`,
      };
    }),
  };
}

/**
 * SOW Validation
 * 
 * This function validates whether the provided text is a Scope of Work, project specification, or similar construction/engineering document suitable for BOQ extraction.
 * 
 * @param text - The text to validate.
 * @returns An object containing the validation result and the reason for the determination.
 */
const SOW_VALIDATION_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    isSOW: {
      type: SchemaType.BOOLEAN,
      description: "True if the document is a Scope of Work, project specification, or similar construction/engineering document suitable for BOQ extraction",
    },
    reason: {
      type: SchemaType.STRING,
      description: "One sentence explaining the determination",
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: "Confidence from 0 to 1",
    },
    documentType: {
      type: SchemaType.STRING,
      description:
        "One of: construction_sow, engineering_spec, boq_or_cost_document, questionnaire_or_survey, product_or_software_spec, creative_or_unstructured, unknown",
    },
    should_block_generation: {
      type: SchemaType.BOOLEAN,
      description: "True when BOQ generation should be blocked for this document",
    },
    required_attachments: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          type: { type: SchemaType.STRING },
          reason: { type: SchemaType.STRING },
          required: { type: SchemaType.BOOLEAN },
        },
        required: ["type", "reason", "required"],
      },
    },
    source_bundle_status: {
      type: SchemaType.STRING,
      description: "One of: complete, missing_required_attachments, partial_optional_context",
    },
    positive_signals: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "General construction-document signals detected in the input",
    },
    negative_signals: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "Signals suggesting the document is not a valid BOQ source",
    },
    flags: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "Specific warning flags that influenced the determination",
    },
  },
  required: [
    "isSOW",
    "reason",
    "confidence",
    "documentType",
    "should_block_generation",
    "required_attachments",
    "source_bundle_status",
    "positive_signals",
    "negative_signals",
    "flags",
  ],
};

export async function validateSOW(
  text: string,
  opts?: { supportingDocsCount?: number; usageCollector?: GeminiUsageCollector }
): Promise<SOWValidationResult> {
  const preview = text.slice(0, 6000);
  const heuristic = inferSOWHeuristics(text, opts?.supportingDocsCount ?? 0);

  if (!heuristic.isSOW && heuristic.confidence >= 0.82) {
    return heuristic;
  }

  try {
    const llm = await generateStructuredContent<SOWValidationResult>({
      useFastModel: true,
      responseSchema: SOW_VALIDATION_SCHEMA,
      temperature: 0,
      usageCollector: opts?.usageCollector,
      usageOperation: "validate_sow",
      prompt: `Analyse this document excerpt and classify whether it is suitable for construction BOQ generation.

Only classify as isSOW=true if the document is a construction/engineering scope of work, specification, BOQ, or similar works document describing measurable physical work items.

Classify as isSOW=false for software product specs, PRDs, migration plans, workflow specs, UI requirements, policy documents, meeting notes, general strategy documents, questionnaires, surveys, lyrics, and priced BOQs/rate schedules that do not describe the underlying works scope.

Deterministic signals already observed:
- heuristic_is_sow: ${heuristic.isSOW}
- heuristic_document_type: ${heuristic.documentType}
- heuristic_reason: ${heuristic.reason}
- heuristic_flags: ${heuristic.flags.join("; ") || "none"}

Document excerpt:
${preview}`,
    });

    const llmLooksNonSow =
      !llm.isSOW ||
      llm.documentType === "product_or_software_spec" ||
      llm.documentType === "questionnaire_or_survey" ||
      llm.documentType === "creative_or_unstructured" ||
      llm.documentType === "boq_or_cost_document";

    if (!heuristic.isSOW && llmLooksNonSow) {
      return {
        isSOW: false,
        reason: llm.reason || heuristic.reason,
        confidence: clamp01(Math.max(heuristic.confidence, llm.confidence ?? 0.7)),
        documentType:
          llm.documentType === "unknown" ? heuristic.documentType : llm.documentType,
        should_block_generation: llm.should_block_generation ?? true,
        required_attachments:
          llm.required_attachments?.length > 0
            ? llm.required_attachments
            : heuristic.required_attachments,
        source_bundle_status:
          llm.source_bundle_status ?? heuristic.source_bundle_status,
        positive_signals: Array.from(
          new Set([...(heuristic.positive_signals ?? []), ...(llm.positive_signals ?? [])])
        ).slice(0, 6),
        negative_signals: Array.from(
          new Set([...(heuristic.negative_signals ?? []), ...(llm.negative_signals ?? [])])
        ).slice(0, 6),
        flags: Array.from(new Set([...heuristic.flags, ...(llm.flags ?? [])])).slice(0, 6),
      };
    }

    if (heuristic.isSOW && llm.isSOW) {
      return applyGoLiveSOWRules({
        isSOW: true,
        reason: llm.reason || heuristic.reason,
        confidence: clamp01(Math.max(heuristic.confidence, llm.confidence ?? 0.65)),
        documentType:
          llm.documentType === "unknown" ? heuristic.documentType : llm.documentType,
        should_block_generation: llm.should_block_generation ?? false,
        required_attachments:
          llm.required_attachments?.length > 0
            ? llm.required_attachments
            : heuristic.required_attachments,
        source_bundle_status:
          llm.source_bundle_status ?? heuristic.source_bundle_status,
        positive_signals: Array.from(
          new Set([...(heuristic.positive_signals ?? []), ...(llm.positive_signals ?? [])])
        ).slice(0, 6),
        negative_signals: Array.from(
          new Set([...(heuristic.negative_signals ?? []), ...(llm.negative_signals ?? [])])
        ).slice(0, 6),
        flags: Array.from(new Set([...heuristic.flags, ...(llm.flags ?? [])])).slice(0, 6),
      });
    }

    return applyGoLiveSOWRules(heuristic.confidence >= (llm.confidence ?? 0.5) ? heuristic : llm);
  } catch (error) {
    logger.warn("validateSOW falling back to heuristic classification", { error: String(error) });
    return applyGoLiveSOWRules(heuristic);
  }
}

// ─── BOQ Quality Scoring ────────────────────────────────────────────────────

const QA_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    score: { type: SchemaType.NUMBER, description: "Overall quality score from 1 (very poor) to 10 (excellent)" },
    grade: { type: SchemaType.STRING, description: "One of: Strong, Good, Fair, Weak" },
    summary: { type: SchemaType.STRING, description: "One sentence overall assessment" },
    flags: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "List of specific quality warnings or issues found (empty array if none)",
    },
    subscores: {
      type: SchemaType.OBJECT,
      properties: {
        coverage: { type: SchemaType.NUMBER },
        source_completeness: { type: SchemaType.NUMBER },
        field_integrity: { type: SchemaType.NUMBER },
        evidence_traceability: { type: SchemaType.NUMBER },
        boq_semantics: { type: SchemaType.NUMBER },
      },
      required: ["coverage", "source_completeness", "field_integrity", "evidence_traceability", "boq_semantics"],
    },
  },
  required: ["score", "grade", "summary", "flags", "subscores"],
};

export async function scoreBOQ(boq: import("./types").BOQDocument): Promise<{
  score: number;
  grade: "Strong" | "Good" | "Fair" | "Weak";
  summary: string;
  flags: string[];
  subscores?: {
    coverage: number;
    source_completeness: number;
    field_integrity: number;
    evidence_traceability: number;
    boq_semantics: number;
  };
  source?: "deterministic" | "hybrid";
  updated_at?: string;
}> {
  const deterministic = computeDeterministicQA(boq);
  const totalItems = boq.bills.reduce((s, b) => s + b.items.filter((i) => !i.is_header).length, 0);
  const pricedItems = boq.bills.reduce(
    (s, b) => s + b.items.filter((i) => !i.is_header && i.rate !== null).length,
    0
  );
  const billTitles = boq.bills.map((b) => b.title).join(", ");
  const hasPreliminaries = boq.bills.some((b) =>
    b.title.toUpperCase().includes("PRELIM")
  );
  const emptyDescriptions = boq.bills.reduce(
    (s, b) => s + b.items.filter((i) => !i.is_header && (!i.description || i.description.trim().length < 5)).length,
    0
  );
  const zeroQty = boq.bills.reduce(
    (s, b) => s + b.items.filter((i) => !i.is_header && i.qty === 0).length,
    0
  );

  const summary = `Project: ${boq.project}. Bills (${boq.bills.length}): ${billTitles}. Total line items: ${totalItems}. Priced items: ${pricedItems}. Has Preliminaries bill: ${hasPreliminaries}. Empty descriptions: ${emptyDescriptions}. Zero-quantity items: ${zeroQty}.`;

  
  try {
    const llm = await generateStructuredContent<{
      score: number;
      grade: "Strong" | "Good" | "Fair" | "Weak";
      summary: string;
      flags: string[];
      subscores: {
        coverage: number;
        source_completeness: number;
        field_integrity: number;
        evidence_traceability: number;
        boq_semantics: number;
      };
    }>({
      useFastModel: true,
      responseSchema: QA_SCHEMA,
      temperature: 0,
      prompt: `You are a senior ASAQS-registered quantity surveyor performing a quality review of a generated Bill of Quantities for a Zambian construction project.

BOQ summary:
${summary}

Deterministic pre-assessment:
Score ${deterministic.score}/10, grade ${deterministic.grade}, flags: ${deterministic.flags.join("; ") || "none"}.

Full BOQ (JSON):
${JSON.stringify(boq, null, 2).slice(0, 16000)}

Review against these criteria:
1. BILL STRUCTURE — Are bills sequenced in trade order (Prelims, Substructure, Superstructure, Roofing, Finishes, External, Joinery, Plumbing, Electrical)? Are section headers present and logical?
2. DESCRIPTION QUALITY — Are descriptions written in ASAQS/SMM7 style (work method + material + location/dimension)? Flag vague descriptions like "Excavate for foundations" that omit depth or material type.
3. UNITS — Are standard units used correctly (m², m³, m, No., Item, kg)? Flag "lm", "sqm", "cum" or missing units.
4. COVERAGE — Does the BOQ appear to cover all work described? Flag obvious omissions (e.g. no Preliminaries, no finishes on a building project).
5. RATE PLAUSIBILITY — Are rates within reasonable Zambian ZMW market ranges? Flag rates that are implausibly low (under 50% of market) or high (over 300% of market) for their trade.
6. QUANTITY COMPLETENESS — What proportion of items have quantities? Flag if more than 20% are null.
7. PROVISIONAL SUMS — Is there a contingency or provisional sum? Flag if absent on any project over 5 bills.

Score each subscore 0–10. Be specific in flags — name the bill and item description where possible.`,
    });
    return mergeQAScores(deterministic, llm);
  } catch (error) {
    logger.warn("Falling back to deterministic QA score", { error: String(error) });
    return deterministic;
  }
}

// ─── Rate Estimation ────────────────────────────────────────────────────────

const RATES_INSTRUCTION = `You are pricing a Zambian construction BOQ to the standard of a senior ASAQS-registered quantity surveyor. All rates are all-in: material supply, labour, plant, waste, fixing, and contractor's overheads and profit unless otherwise stated.

ZAMBIAN MARKET RATE REFERENCE (Q1 2026, ZMW — all-in):

PRELIMINARIES & GENERAL:
- Mobilisation: 50,000–500,000 ZMW/Item (scale with project value — typically 2–4% of works)
- Demobilisation & site clearance on completion: 30,000–200,000 ZMW/Item
- Site establishment (offices, ablutions, security fencing): 25,000–150,000 ZMW/Item
- Health, safety & environmental plan: 15,000–80,000 ZMW/Item
- Insurance & performance bond: 1.5–2.5% of contract sum, measure as Item
- Setting out: 10,000–40,000 ZMW/Item
- As-built drawings & O&M manuals: 10,000–50,000 ZMW/Item
- Provisional sum — contingency (typically 5–10% of measured works): measure as Item, price is PS amount
- Provisional sum — prime cost items (PC sums for nominated suppliers): measure as Item

EARTHWORKS & SITE CLEARANCE:
- Clear site of shrubs/bush (grub up roots, burn debris): 15–45 ZMW/m²
- Topsoil strip average 150mm deep: 30–60 ZMW/m²
- Bulk excavation — pickable/soft ground: 55–90 ZMW/m³
- Bulk excavation — hard/rocky ground (drill and blast): 200–420 ZMW/m³
- Trench excavation not exceeding 1.5m deep (pickable): 90–200 ZMW/m³
- Trench excavation not exceeding 1.5m deep (hard material): 220–450 ZMW/m³
- Extra over excavation for rock: 150–350 ZMW/Item (per occurrence) or 200–500 ZMW/m³
- Backfilling from excavations in layers, well rammed: 45–85 ZMW/m³
- Imported laterite fill compacted in 150mm layers to 95% Mod AASHTO: 150–320 ZMW/m³
- Compacting ground surface/trench bottom: 40–90 ZMW/m²
- Hardcore sub-base 150mm compacted: 180–350 ZMW/m²
- Dewatering — keeping excavations free from water: 2,000–8,000 ZMW/Item
- Ant-proofing treatment to surface of excavations: 18–35 ZMW/m²
- Destroy termite nests, treat and fill voids: 15,000–35,000 ZMW/Item
- Dispose of surplus excavated material off site: 45–120 ZMW/m³

CONCRETE WORKS (measured net in place):
- Blinding 50mm Grade 15 in bases: 1,200–2,200 ZMW/m² (or 2,200–3,500 ZMW/m³)
- Concrete Grade 25 in foundation trenches: 2,500–4,000 ZMW/m³
- Concrete Grade 25 in bases and pads: 2,500–4,000 ZMW/m³
- Concrete Grade 25 surface bed (measured separately from DPM): 2,800–4,200 ZMW/m³
- Concrete Grade 30 in stub columns: 3,800–5,500 ZMW/m³
- Concrete Grade 30 in beams and lintels: 4,000–5,800 ZMW/m³
- Concrete Grade 30 in suspended slabs: 4,200–6,000 ZMW/m³
- Reinforcement Y-bars 10mm–32mm (supply, cut, bend, fix): 38–58 ZMW/kg
- Reinforcement R-bars (mild steel links/stirrups): 36–52 ZMW/kg
- BRC mesh type 193 (1.93 kg/m²): 200–380 ZMW/m²
- BRC mesh type 257 (2.57 kg/m²): 260–500 ZMW/m²
- Wrot formwork to soffits of slabs: 300–600 ZMW/m²
- Sawn formwork to sides of beams/lintels: 200–420 ZMW/m²
- Formwork to edges of slabs not exceeding 200mm: 80–180 ZMW/m
- DPM 500/1000 gauge polythene (measured net): 45–90 ZMW/m²

MASONRY & WALLING (measured flat, gross area):
- 140mm concrete hollow blockwork in foundations: 290–440 ZMW/m²
- 200mm concrete hollow blockwork in foundations: 340–520 ZMW/m²
- 150mm blockwork superstructure: 320–480 ZMW/m²
- 200mm blockwork superstructure: 370–550 ZMW/m²
- Brick cladding (burnt clay Kalulushi) in CM 1:4: 180–350 ZMW/m²
- Brickforce joint reinforcement 200mm wide: 10–20 ZMW/m
- Brickforce joint reinforcement 150mm wide: 8–16 ZMW/m
- DPC on top of plinth walls (hessian/polythene): 45–90 ZMW/m²

PLASTERWORK & SCREEDS:
- 15mm cement and sand plaster internal (1:4): 130–230 ZMW/m²
- 20mm cement and sand plaster external (1:3): 160–290 ZMW/m²
- Plinth plaster (waterproof additive): 180–320 ZMW/m²
- 50mm cement and sand screed (1:3) to floors: 160–280 ZMW/m²
- Granolithic screed 25mm: 150–270 ZMW/m²

FLOOR & WALL FINISHES:
- Ceramic floor tiles 300×300mm supply and fix: 290–550 ZMW/m²
- Ceramic floor tiles 600×600mm supply and fix: 380–700 ZMW/m²
- Ceramic wall tiles supply and fix: 260–580 ZMW/m²
- Tile skirting/cove: 260–420 ZMW/m
- Vinyl/PVC floor covering: 150–320 ZMW/m²

ROOFING:
- IBR steel sheets 0.47mm supply and fix to timber purlins: 200–350 ZMW/m² (on slope)
- Corrugated iron sheets 0.4mm supply and fix: 160–300 ZMW/m²
- Ridge capping supply and fix: 120–250 ZMW/m
- Barge board supply and fix: 90–180 ZMW/m
- Fascia board (225×12mm) supply and fix: 90–180 ZMW/m
- UPVC gutter supply and fix: 180–380 ZMW/m
- UPVC downpipe supply and fix: 160–320 ZMW/m
- Roof lining (sarking/breather membrane): 60–140 ZMW/m²
- Treated timber rafters 150×50mm supply and fix: 110–200 ZMW/m
- Treated timber purlins 75×75mm supply and fix: 70–140 ZMW/m
- Treated timber wall plate 100×75mm supply and fix: 80–160 ZMW/m
- Pre-fabricated roof trusses supply and erect (m² of plan area): 380–750 ZMW/m²

STRUCTURAL STEEL:
- Structural steel sections (fabricated, primed, erected): 90–180 ZMW/kg
- Steel base plates fabricated and fixed: 85–170 ZMW/kg
- High-strength bolts M16–M24 supply and fix: 220–500 ZMW/No.
- Anti-corrosion primer 1 coat on steel: 45–90 ZMW/m²

JOINERY — DOORS & WINDOWS:
- Hardwood (Mukwa/Rosewood) door frame supply and fix: 2,500–5,500 ZMW/No.
- Flush solid-core door 825×1960mm supply and fix: 3,500–7,000 ZMW/No.
- Flush solid-core door 925×1960mm supply and fix: 3,800–7,500 ZMW/No.
- Steel security door supply and fix: 7,000–18,000 ZMW/No.
- Aluminium glazed window supply and fix: 2,000–5,500 ZMW/m²
- Three-lever mortice lock (Yale/Union): 800–1,800 ZMW/No.
- Toilet indicator bolt: 300–700 ZMW/No.
- Pair of 100mm butt hinges: 200–450 ZMW/No.
- Door closer (overhead): 1,500–3,500 ZMW/No.

PLUMBING & DRAINAGE:
- uPVC soil/vent pipe 110mm supply and fix: 300–580 ZMW/m
- uPVC waste pipe 50mm supply and fix: 160–320 ZMW/m
- PPR hot/cold water pipe 20mm supply and fix: 200–420 ZMW/m
- PPR hot/cold water pipe 25mm supply and fix: 260–500 ZMW/m
- WC suite (close-coupled) supply and fix: 5,000–10,000 ZMW/No.
- Wash hand basin (600mm) supply and fix: 3,500–8,000 ZMW/No.
- Shower tray and fittings supply and fix: 4,000–9,000 ZMW/No.
- Floor drain/gully supply and fix: 800–2,000 ZMW/No.
- 160mm uPVC stormwater drain supply and fix: 380–700 ZMW/m
- Brick/concrete inspection manhole (600mm deep): 5,000–12,000 ZMW/No.
- Precast concrete septic tank 1500L supply and install: 20,000–40,000 ZMW/No.
- Cold water storage tank 500L (HDPE): 8,000–20,000 ZMW/No.

ELECTRICAL:
- 20mm PVC conduit surface-mounted supply and fix: 130–300 ZMW/m
- 20mm PVC conduit concealed in wall/slab supply and fix: 160–350 ZMW/m
- Single 13A socket outlet supply and fix: 200–450 ZMW/No.
- Double 13A socket outlet supply and fix: 350–700 ZMW/No.
- Single light switch supply and fix: 200–400 ZMW/No.
- LED panel fitting supply and fix: 900–2,800 ZMW/No.
- Fluorescent batten fitting 1200mm supply and fix: 450–1,000 ZMW/No.
- 8-way distribution board supply and fix: 6,500–14,000 ZMW/No.
- Main distribution board 100A supply and fix: 13,000–25,000 ZMW/No.
- Consumer unit with MCBs: 5,000–12,000 ZMW/No.
- Earthing and bonding system: 5,500–25,000 ZMW/Item
- 2.5mm² PVC insulated cable in conduit supply and draw in: 35–80 ZMW/m
- 4mm² cable: 50–110 ZMW/m

PAINTING & DECORATION:
- Emulsion paint 2 coats to internal walls and ceilings: 90–180 ZMW/m²
- Masonry paint 2 coats external: 110–220 ZMW/m²
- Gloss paint 2 coats to timber: 130–240 ZMW/m²
- Anti-corrosion primer + gloss 2 coats to steelwork: 90–200 ZMW/m²

RATE ESTIMATION RULES:
1. All rates are all-in (material + labour + plant + waste + contractor O&P) unless the item explicitly says "supply only" or "lay only".
2. Use the mid-point of the range as your base rate. Adjust up toward the top of the range for: specialist materials, remote sites, small quantities (under 10% of typical bill quantity).
3. Historical anchors (provided separately) take precedence over these ranges when the description and unit match closely — treat anchors as real market evidence.
4. Set rate to null only for: is_header=true rows, Provisional Sum items (the PS amount is the "rate"), items where qty is also null and no reasonable assumption can be made.
5. Compute amount = qty × rate exactly. Never leave amount null when both qty and rate are set.
6. All rates in Zambian Kwacha (ZMW).
7. Preliminary lump-sum items (mobilisation, dewatering, ant-proofing as Item): price the Item rate as the total cost — qty is 1.
8. "Ditto" items inherit the rate of the immediately preceding item with the same unit in the same bill section.`;

const RATES_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    items: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          item_key: { type: SchemaType.STRING },
          rate: { type: SchemaType.NUMBER, nullable: true },
          amount: { type: SchemaType.NUMBER, nullable: true },
          source_category: { type: SchemaType.STRING, nullable: true },
          rationale: { type: SchemaType.STRING, nullable: true },
          confidence: { type: SchemaType.NUMBER, nullable: true },
        },
        required: ["item_key"],
      },
    },
  },
  required: ["items"],
};

const BOQ_DOCUMENT_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    project: { type: SchemaType.STRING },
    location: { type: SchemaType.STRING },
    prepared_by: { type: SchemaType.STRING },
    date: { type: SchemaType.STRING },
    bills: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          number: { type: SchemaType.NUMBER },
          title: { type: SchemaType.STRING },
          items: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                item_no: { type: SchemaType.STRING, nullable: true },
                description: { type: SchemaType.STRING },
                unit: { type: SchemaType.STRING, nullable: true },
                qty: { type: SchemaType.NUMBER, nullable: true },
                rate: { type: SchemaType.NUMBER, nullable: true },
                amount: { type: SchemaType.NUMBER, nullable: true },
                is_header: { type: SchemaType.BOOLEAN, nullable: true },
                note: { type: SchemaType.STRING, nullable: true },
              },
              required: ["description"],
            },
          },
        },
        required: ["number", "title", "items"],
      },
    },
  },
  required: ["project", "location", "prepared_by", "date", "bills"],
};

const BOQ_VALIDATION_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    isValid: {
      type: SchemaType.BOOLEAN,
      description: "True if this spreadsheet is a genuine Bill of Quantities with item descriptions, units, and quantities",
    },
    totalItems: {
      type: SchemaType.NUMBER,
      description: "Total count of non-header line items detected in the spreadsheet",
    },
    missingRateCount: {
      type: SchemaType.NUMBER,
      description: "Count of non-header items that have a quantity but no rate (rate cell is empty or zero)",
    },
    rateColumnHeader: {
      type: SchemaType.STRING,
      nullable: true,
      description: "Exact text of the column header for rates (e.g. 'Rate', 'Unit Rate', 'Rate (ZMW)'). Null if not found.",
    },
    amountColumnHeader: {
      type: SchemaType.STRING,
      nullable: true,
      description: "Exact text of the column header for amounts/totals (e.g. 'Amount', 'Total', 'Amount (ZMW)'). Null if not found.",
    },
    errorMessage: {
      type: SchemaType.STRING,
      nullable: true,
      description: "Human-readable reason if isValid=false. Null if valid.",
    },
  },
  required: ["isValid", "totalItems", "missingRateCount"],
};

type BOQValidationResult = {
  isValid: boolean;
  totalItems: number;
  missingRateCount: number;
  rateColumnHeader: string | null;
  amountColumnHeader: string | null;
  errorMessage: string | null;
};

/**
 * Validates whether an uploaded spreadsheet is a genuine BOQ,
 * and identifies the Rate and Amount column headers for later patching.
 */
export async function validateBOQ(csvText: string): Promise<BOQValidationResult> {
  const preview = csvText.slice(0, 8000);
  return generateStructuredContent<BOQValidationResult>({
    useFastModel: true,
    responseSchema: BOQ_VALIDATION_SCHEMA,
    temperature: 0,
    usageOperation: "rate_boq_validation",
    prompt: `Analyse the following spreadsheet data (CSV/table format) and determine whether it is a genuine Bill of Quantities (BOQ).

A valid BOQ has:
- A column for item descriptions/work items
- A column for units of measurement (m², m³, lm, No., LS, kg, etc.)
- A column for quantities
- Optionally a column for rates and/or amounts

Count all non-header line items and how many are missing rates.
Identify the EXACT text of the Rate column header and Amount column header (copy them verbatim from the data — do not paraphrase).

Spreadsheet data:
${preview}`,
  });
}

function normalizeRateKey(description: string, unit: string): string {
  const normalizedDescription = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedUnit = unit
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${normalizedDescription}::${normalizedUnit}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function chunkArray<T>(items: T[], size: number): T[][];
function chunkArray<T>(items: T[], size: number): Array<T[]> {
  if (size <= 0) return [items];
  const chunks: Array<T[]> = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function buildRateLibraryAnchors(
  batch: Array<{ item_key: string; description: string; unit: string }>
): string {
  const lines: string[] = [];
  for (const item of batch) {
    const anchors = findRateAnchors(item.description, item.unit, 2, 0.25);
    for (const anchor of anchors) {
      lines.push(
        `- "${anchor.description}" (${anchor.unit}): ${anchor.rate} ZMW — from ${anchor.project}, ${anchor.province} [match score: ${anchor.score.toFixed(2)}]`
      );
    }
  }
  return lines.length > 0 ? lines.join("\n") : "No close historical matches found.";
}

function buildExistingRateReferences(
  existingRates: Array<{ description: string; unit: string; rate: number; bill: string }>,
  batch: Array<{ description: string; unit: string; bill: string }>
) {
  const batchBills = new Set(batch.map((item) => item.bill));
  const batchUnits = new Set(batch.map((item) => item.unit.toLowerCase()));

  const preferred = existingRates.filter(
    (row) => batchBills.has(row.bill) || batchUnits.has(row.unit.toLowerCase())
  );

  return (preferred.length > 0 ? preferred : existingRates).slice(0, 60);
}

function classifyPricingCategory(description: string, unit: string): BOQPricingCategory {
  const text = `${normalizeRateKey(description, unit)} ${normalizeRateKey(unit, "")}`.trim();
  if (/\bditto\b|\bincluding\b|\bincl\b/.test(text)) return "ditto_reference";
  if (/\bant proof\b|\bantproof\b|\btermite\b|\binsecticide\b|\btreatment\b|\bdestroy termites\b/.test(text)) {
    return "treatment_service";
  }
  if (/\bmantis\b|\bgrating\b|\bbaluster\b|\brsa\b|\btread support\b|\bbracing\b|\bhandrail\b|\bsteel\b|\bmetal\b/.test(text)) {
    return "steel_fabrication";
  }
  if (/\bpipe\b|\bupvc\b|\bpvc\b|\bdrain\b|\bgully\b|\btrap\b|\belbow\b|\btee\b|\bbranch\b|\bjunction\b|\bsleeve\b|\bconnector\b|\bbend\b/.test(text)) {
    if (/\belbow\b|\btee\b|\bbranch\b|\bjunction\b|\bsleeve\b|\bconnector\b|\bbend\b|\btrap\b|\bgully\b/.test(text)) {
      return "pipe_fitting";
    }
    return "pipe_run";
  }
  if (/\bdoor\b|\bframe\b|\blouvre\b|\bironmongery\b|\bwindow\b/.test(text)) return "doors_windows";
  if (/\bceiling mounted\b|\blight point\b|\blight fitting\b|\bswitch\b|\bsocket\b|\boutlet\b|\bphotocell\b|\belectrical\b/.test(text)) {
    return "electrical_fixture";
  }
  if (/\bpaint\b|\bplaster\b|\brender\b|\bscreed\b|\btiling\b|\bfloor finish\b/.test(text)) return "finishes";
  if (/\bconcrete\b|\breinforcement\b|\bformwork\b|\bfoundation\b|\bbases\b|\bcolumns\b|\bsurface bed\b|\bmesh\b/.test(text)) {
    return "concrete_structure";
  }
  if (/\bexcavat\b|\bbackfill\b|\btrench\b|\bhardcore\b|\bcompacting\b|\blevelling\b|\brock\b/.test(text)) {
    return "earthworks";
  }
  return "other";
}

function requiresLocalPrecedent(category: BOQPricingCategory): boolean {
  return (
    category === "ditto_reference" ||
    category === "pipe_fitting" ||
    category === "steel_fabrication" ||
    category === "treatment_service"
  );
}

function defaultSkipReason(category: BOQPricingCategory): BOQRateSkipReason {
  if (category === "ditto_reference") return "ditto_without_parent";
  return "specialist_item_requires_local_precedent";
}

function normalizeDescriptionForSimilarity(description: string): string {
  return description
    .toLowerCase()
    .replace(/\bditto\b/g, " ")
    .replace(/\bincluding\b/g, " ")
    .replace(/\bincl\b/g, " ")
    .replace(/\bas described\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function descriptionSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeDescriptionForSimilarity(a).split(" ").filter(Boolean));
  const tokensB = new Set(normalizeDescriptionForSimilarity(b).split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1;
  }
  return intersection / Math.max(tokensA.size, tokensB.size);
}

function summarizeRateQuality(
  boq: BOQDocument,
  metrics: {
    localMatches: number;
    aiMatches: number;
    unresolved: number;
    outliers: number;
  }
): BOQQualitySummary {
  let totalItems = 0;
  let qtyWithEvidence = 0;
  let qtyMissing = 0;
  let lowConfidence = 0;
  let rateFilled = 0;
  let rateMissing = 0;

  for (const bill of boq.bills) {
    for (const item of bill.items) {
      if (item.is_header) continue;
      totalItems += 1;
      if (item.qty == null) qtyMissing += 1;
      if (item.qty != null && item.source_excerpt && item.source_excerpt.trim().length >= 12) {
        qtyWithEvidence += 1;
      }
      if ((item.quantity_confidence ?? 0.4) < 0.6) lowConfidence += 1;
      if (item.rate == null) rateMissing += 1;
      else rateFilled += 1;
    }
  }

  return {
    total_items: totalItems,
    qty_with_evidence: qtyWithEvidence,
    qty_missing: qtyMissing,
    low_confidence: lowConfidence,
    rate_filled: rateFilled,
    rate_missing: rateMissing,
    mapped_rows: boq.workbook_preservation?.mapped_item_rows,
    ambiguous_rows: boq.workbook_preservation?.ambiguous_item_rows ?? 0,
    outlier_rows: metrics.outliers,
  };
}

async function fillRatesPass(
  boq: BOQDocument,
  options?: { rateContext?: RateContext; usageCollector?: GeminiUsageCollector }
): Promise<BOQDocument> {
  const contextBlock = options?.rateContext ? `\n\n${buildRateContextBlock(options.rateContext)}` : "";
  const existingRates = boq.bills.flatMap((bill) =>
    bill.items
      .filter((item) => !item.is_header && item.rate !== null)
      .map((item) => ({
        description: item.description,
        unit: item.unit,
        rate: item.rate!,
        bill: bill.title,
      }))
  );

  const exactRateMap = new Map<string, number[]>();
  const unitRateMap = new Map<string, number[]>();
  for (const rateRow of existingRates) {
    const key = normalizeRateKey(rateRow.description, rateRow.unit);
    exactRateMap.set(key, [...(exactRateMap.get(key) ?? []), rateRow.rate]);
    const unitKey = normalizeRateKey(rateRow.unit, "");
    unitRateMap.set(unitKey, [...(unitRateMap.get(unitKey) ?? []), rateRow.rate]);
  }

  let localMatches = 0;
  let gatedSpecialistRows = 0;
  const billLocalRates = new Map<string, Array<{ description: string; unit: string; rate: number }>>();
  const unresolvedItems: Array<{
    item_key: string;
    description: string;
    unit: string;
    qty: number | null;
    bill: string;
    workbook_context: string | null;
  }> = [];

  const locallyFilledBoq: BOQDocument = {
    ...boq,
    bills: boq.bills.map((bill) => ({
      ...bill,
      items: bill.items.map((item) => {
        if (item.is_header || item.rate !== null) return item;
        const pricingCategory = classifyPricingCategory(item.description, item.unit);
        const key = normalizeRateKey(item.description, item.unit);
        const exactMatches = exactRateMap.get(key) ?? [];
        let matchedRate = median(exactMatches);
        let matchReason = "Reused an exact matching rate from another row in the uploaded workbook.";

        const billKey = `${normalizeRateKey(bill.title, "")}::${normalizeRateKey(item.workbook_context ?? "", "")}`;
        const priorBillRates = billLocalRates.get(billKey) ?? [];

        if (matchedRate === null && pricingCategory === "ditto_reference") {
          const inherited = [...priorBillRates]
            .reverse()
            .find((candidate) => candidate.unit === item.unit || !item.unit || !candidate.unit);
          if (inherited) {
            matchedRate = inherited.rate;
            matchReason = "Inherited the nearest safe local rate for a ditto/reference row in the same bill section.";
          }
        }

        if (matchedRate === null && !requiresLocalPrecedent(pricingCategory)) {
          const nearDuplicate = priorBillRates.find((candidate) =>
            candidate.unit === item.unit &&
            descriptionSimilarity(candidate.description, item.description) >= 0.72
          );
          if (nearDuplicate) {
            matchedRate = nearDuplicate.rate;
            matchReason = "Reused a near-duplicate rate from the same bill section.";
          }
        }

        if (matchedRate === null && requiresLocalPrecedent(pricingCategory)) {
          gatedSpecialistRows += 1;
          return {
            ...item,
            pricing_category: pricingCategory,
            rate_skip_reason: defaultSkipReason(pricingCategory) as BOQRateSkipReason,
            rate_source_detail:
              pricingCategory === "ditto_reference"
                ? "Skipped auto-pricing because this ditto/reference row has no safe local parent rate."
                : "Skipped auto-pricing because this specialist item needs workbook-local precedent.",
          };
        }
        if (matchedRate === null) {
          unresolvedItems.push({
            item_key: item.item_key ?? `${item.item_no || item.description.slice(0, 20)}`,
            description: item.description,
            unit: item.unit,
            qty: item.qty,
            bill: bill.title,
            workbook_context: item.workbook_context ?? null,
          });
          return item;
        }

        localMatches += 1;
        const nextBillRates = billLocalRates.get(billKey) ?? [];
        nextBillRates.push({ description: item.description, unit: item.unit, rate: matchedRate });
        billLocalRates.set(billKey, nextBillRates);
        return {
          ...item,
          pricing_category: pricingCategory,
          rate: matchedRate,
          amount: item.qty !== null ? +(item.qty * matchedRate).toFixed(2) : null,
          rate_source: "workbook_local_pattern",
          rate_source_detail: matchReason,
          rate_confidence: 0.95,
          rate_skip_reason: null,
        };
      }),
    })),
  };

  if (unresolvedItems.length === 0) {
    return {
      ...locallyFilledBoq,
      workbook_preservation: locallyFilledBoq.workbook_preservation
        ? {
            ...locallyFilledBoq.workbook_preservation,
            workbook_local_rate_matches:
              (locallyFilledBoq.workbook_preservation.workbook_local_rate_matches ?? 0) + localMatches,
            unresolved_rate_rows: locallyFilledBoq.bills
              .flatMap((bill) => bill.items)
              .filter((item) => !item.is_header && item.rate === null).length,
          }
        : undefined,
    };
  }

  const rateMap = new Map<string, {
    rate: number | null;
    amount: number | null;
    source_category?: string | null;
    rationale?: string | null;
    confidence?: number | null;
  }>();

  for (const batch of chunkArray(unresolvedItems, RATE_FILL_BATCH_SIZE)) {
    const result = await generateStructuredContent<{
      items: Array<{
        item_key: string;
        rate: number | null;
        amount: number | null;
        source_category?: string | null;
        rationale?: string | null;
        confidence?: number | null;
      }>
    }>({
      responseSchema: RATES_SCHEMA,
      temperature: 0.1,
      useFastModel: true,
      usageCollector: options?.usageCollector,
      usageOperation: "rate_fill_batch",
      systemInstruction: `You are a quantity surveyor estimating rates for a Zambian construction BOQ.\n\n${RATES_INSTRUCTION}${contextBlock}

RATE PROVENANCE RULES:
1. Prefer existing workbook pricing conventions when similar items already have rates.
2. Prefer project-consistent rates across repeated or "Ditto" items in the same bill/section.
3. Use embedded market heuristics only when workbook-local evidence is not sufficient.
4. Return source_category as one of: embedded_market_heuristic, workbook_local_pattern, project_consistency_inference, external_reference_document.
5. Return a short rationale and confidence between 0 and 1 for every filled rate.`,
      prompt: `Estimate ZMW rates for the following BOQ items. Return rate, amount, source_category, rationale, and confidence for each item_key.

Existing workbook rates:
${JSON.stringify(buildExistingRateReferences(existingRates, batch))}

Historical anchors from accepted Zambian BOQs (use as concrete reference points — prefer these over generic ranges when description and unit match closely):
${buildRateLibraryAnchors(batch)}

Items to fill:
${JSON.stringify(batch)}`,
    });

    for (const r of result.items ?? []) {
      if (r.item_key) {
        rateMap.set(r.item_key, {
          rate: r.rate ?? null,
          amount: r.amount ?? null,
          source_category: r.source_category ?? null,
          rationale: r.rationale ?? null,
          confidence: r.confidence ?? null,
        });
      }
    }
  }

  let aiMatches = 0;
  let outlierMatches = 0;

  const filled = {
    ...locallyFilledBoq,
    bills: locallyFilledBoq.bills.map((bill) => ({
      ...bill,
      items: bill.items.map((item) => {
        if (item.is_header || item.rate !== null) return item;
        const pricingCategory = classifyPricingCategory(item.description, item.unit);
        const itemKey = item.item_key ?? `${item.item_no || item.description.slice(0, 20)}`;
        const rateData = rateMap.get(itemKey);
        if (!rateData) return item;
        const rate = rateData.rate ?? null;
        if (rate === null) return item;

        const unitMedian = median(unitRateMap.get(normalizeRateKey(item.unit, "")) ?? []);
        if (unitMedian !== null && (rate < unitMedian * 0.15 || rate > unitMedian * 6)) {
          outlierMatches += 1;
          return {
            ...item,
            pricing_category: pricingCategory,
            rate_skip_reason: "ai_outlier_rejected" as BOQRateSkipReason,
            rate_source_detail:
              "Skipped AI rate because it looked like an outlier against other workbook rates with the same unit.",
          };
        }

        const qty = item.qty;
        const amount = rateData.amount ?? (rate !== null && qty !== null ? +(qty * rate).toFixed(2) : null);
        aiMatches += 1;
        return {
          ...item,
          pricing_category: pricingCategory,
          rate,
          amount,
          rate_source: (rateData.source_category as BOQItem["rate_source"]) ?? "embedded_market_heuristic",
          rate_source_detail: rateData.rationale ?? null,
          rate_confidence: rateData.confidence ?? null,
          rate_skip_reason: null,
        };
      }),
    })),
  };

  return {
    ...filled,
    workbook_preservation: filled.workbook_preservation
      ? {
          ...filled.workbook_preservation,
          workbook_local_rate_matches:
            (filled.workbook_preservation.workbook_local_rate_matches ?? 0) + localMatches,
          ai_priced_rows: (filled.workbook_preservation.ai_priced_rows ?? 0) + aiMatches,
          outlier_rate_rows: (filled.workbook_preservation.outlier_rate_rows ?? 0) + outlierMatches,
          unresolved_rate_rows: filled.bills
            .flatMap((bill) => bill.items)
            .filter((item) => !item.is_header && item.rate === null).length,
          ambiguous_item_rows: (filled.workbook_preservation.ambiguous_item_rows ?? 0) + gatedSpecialistRows,
        }
      : undefined,
  };
}

export type RateContext = {
  province: string;        // e.g. "Lusaka", "Copperbelt", "Eastern"
  projectType: string;     // "building" | "civil" | "water_sanitation" | "road" | "mep" | "mixed"
  accessibility: string;  // "main_road" | "gravel_road" | "remote"
  labourSource: string;   // "local_unskilled" | "mixed" | "imported_skilled"
  marginPct: number;      // e.g. 10, 15, 20
};

function buildRateContextBlock(ctx: RateContext): string {
  const projectTypeLabel =
    ctx.projectType === "building" ? "Building construction (residential/commercial/institutional)" :
    ctx.projectType === "civil" ? "Civil works (structures, drainage, earthworks)" :
    ctx.projectType === "water_sanitation" ? "Water & sanitation (pipework, tanks, treatment)" :
    ctx.projectType === "road" ? "Road & pavement works" :
    ctx.projectType === "mep" ? "Mechanical, electrical & plumbing (MEP)" :
    "Mixed / multi-discipline works";

  const accessibilityLabel =
    ctx.accessibility === "main_road" ? "Good access (main road) — standard transport costs" :
    ctx.accessibility === "gravel_road" ? "Gravel/secondary road — add 10–20% transport premium" :
    "Remote/bush site — add 25–40% transport premium on materials";

  const labourLabel =
    ctx.labourSource === "local_unskilled" ? "Mostly local unskilled labour available (use lower end of skilled rates)" :
    ctx.labourSource === "mixed" ? "Mix of local and imported skilled trades (use mid-range rates)" :
    "Mostly imported or specialist skilled labour required (use upper-end rates)";

  return `
SITE-SPECIFIC CONTEXT — adjust all rates accordingly:
- Province: ${ctx.province}
- Project type: ${projectTypeLabel}
- Site accessibility: ${accessibilityLabel}
- Labour: ${labourLabel}
- Target overhead & profit margin: ${ctx.marginPct}% (apply this markup on top of base rates)

Apply these adjustments consistently. Transport-sensitive items (materials, concrete, steel) are most affected by accessibility. Weight rate library anchors toward entries from similar project types.`.trim();
}

export async function fillMissingRatesInExistingBOQ(
  boq: BOQDocument,
  rateContext?: RateContext,
  usageCollector?: GeminiUsageCollector
): Promise<BOQDocument> {
  const filled = await fillRatesPass(boq, { rateContext, usageCollector });
  const workbookPreservation = filled.workbook_preservation
    ? {
        ...filled.workbook_preservation,
        unresolved_rate_rows:
          filled.bills.flatMap((bill) => bill.items).filter((item) => !item.is_header && item.rate === null).length,
      }
    : undefined;
  const workbookLocalRateMatches = workbookPreservation?.workbook_local_rate_matches ?? 0;
  const aiPricedRows = workbookPreservation?.ai_priced_rows ?? 0;
  const outlierRateRows = workbookPreservation?.outlier_rate_rows ?? 0;
  return {
    ...filled,
    pipeline_version: "excel-rate-v2.0",
    rate_reference: buildDefaultRateReference(),
    workbook_preservation: workbookPreservation,
    quality_summary: summarizeRateQuality(filled, {
      localMatches: workbookLocalRateMatches,
      aiMatches: aiPricedRows,
      unresolved: workbookPreservation?.unresolved_rate_rows ?? 0,
      outliers: outlierRateRows,
    }),
  };
}

export async function generateBOQ(
  input: string | GenerationInputBundle,
  opts?: {
    suggestRates?: boolean;
    rateContext?: RateContext;
    documentClassification?: DocumentClassification;
    usageCollector?: GeminiUsageCollector;
  }
): Promise<BOQDocument> {
  const documents =
    typeof input === "string"
      ? [
          {
            document_id: "primary",
            name: "Primary SOW",
            role: "primary" as const,
            document_type: "construction_sow" as const,
            text: input,
            pages: null,
          },
        ]
      : input.documents;
  const bundleText = buildPromptBundle(documents);

  const { structure_type: structureMode, blocks } = await classifyProjectStructure(documents, opts?.usageCollector);

  const structureRaw = await generateStructure(bundleText, false, structureMode, blocks, opts?.usageCollector);
  let structure = normalizeStructure(structureRaw);
  structure.structure_mode = structureMode;

  if (countNonHeaderItems(structure) === 0) {
    const retryRaw = await generateStructure(bundleText, true, structureMode, blocks, opts?.usageCollector);
    structure = normalizeStructure(retryRaw);
    structure.structure_mode = structureMode;
  }

  if (countNonHeaderItems(structure) === 0) {
    throw new Error(
      "Could not extract BOQ structure from SOW (no measurable items found). Please upload a clearer scope document."
    );
  }

  const quantitiesRaw = applyDrawingCountHeuristics(
    structure,
    await extractQuantities(bundleText, structure, opts?.usageCollector),
    documents
  );
  const boq = mergeStructureAndQuantities(
    structure,
    quantitiesRaw,
    opts?.documentClassification
      ? {
          ...opts.documentClassification,
          source_bundle_status:
            opts.documentClassification.required_attachments.length > 0 &&
            supportingDocsSatisfyRequirements(documents, opts.documentClassification.required_attachments)
              ? "complete"
              : opts.documentClassification.source_bundle_status,
        }
      : undefined,
    buildSourceBundle(documents)
  );
  if (opts?.rateContext?.projectType) {
    boq.project_type = opts.rateContext.projectType;
  }
  return fillRatesPass(boq, { rateContext: opts?.rateContext, usageCollector: opts?.usageCollector });
}

function mergeStructureAndQuantities(
  structure: BOQStructureArtifact,
  quantities: QuantityPassResponse,
  documentClassification?: DocumentClassification,
  sourceBundle?: SourceBundleDocument[]
): BOQDocument {
  const quantityMap = new Map<string, BOQQuantityArtifactItem>();
  for (const item of quantities.items ?? []) {
    if (!item.item_key) continue;
    quantityMap.set(item.item_key, {
      item_key: item.item_key,
      qty: sanitizePositiveNumber(item.qty),
      unit: normalizeUnit(item.unit),
      quantity_source: normalizeSource(item.quantity_source, item.qty),
      quantity_confidence: normalizeConfidence(item.quantity_confidence),
      source_excerpt: safeNullableText(item.source_excerpt),
      source_anchor: safeNullableText(item.source_anchor),
      source_document: safeNullableText(item.source_document),
      evidence_type: normalizeEvidenceType(item.evidence_type, item.source_excerpt, item.qty),
      derivation_note: safeNullableText(item.derivation_note),
      note: safeNullableText(item.note) ?? undefined,
    });
  }

  const validationFlags: BOQValidationFlag[] = [];
  let totalItems = 0;
  let qtyWithEvidence = 0;
  let qtyMissing = 0;
  let lowConfidence = 0;

  const bills = structure.bills.map((bill) => ({
    number: bill.number,
    title: bill.title,
    items: (() => {
      const mergedItems: BOQItem[] = [];
      let currentSection: string | null = null;

      for (const baseItem of bill.items) {
        if (!baseItem.is_header && baseItem.section_context) {
          const normalizedSection = safeText(baseItem.section_context, "").trim();
          if (normalizedSection && normalizedSection !== currentSection) {
            currentSection = normalizedSection;
            mergedItems.push({
              item_key: `${baseItem.item_key}_section`,
              item_no: "",
              description: normalizedSection,
              unit: "",
              qty: null,
              rate: null,
              amount: null,
              is_header: true,
            });
          }
        }

        if (baseItem.is_header) {
          currentSection = baseItem.description;
          mergedItems.push({
            item_key: baseItem.item_key,
            item_no: "",
            description: baseItem.description,
            unit: "",
            qty: null,
            rate: null,
            amount: null,
            is_header: true,
          });
          continue;
        }

        totalItems += 1;
        const q = quantityMap.get(baseItem.item_key);
        let qty = q?.qty ?? null;
        let source = q?.quantity_source ?? "assumed";
        const confidence = q?.quantity_confidence ?? 0.4;
        const excerpt = q?.source_excerpt ?? null;
        const anchor = q?.source_anchor ?? null;
        const sourceDocument = q?.source_document ?? null;

        if (qty !== null && !hasSufficientEvidence(excerpt)) {
          validationFlags.push({
            item_key: baseItem.item_key,
            issue: "missing_evidence",
            severity: "warning",
            code: "QTY_EVIDENCE_REQUIRED",
            message: "Quantity removed because supporting source evidence was missing.",
          });
          qty = null;
          source = "assumed";
        }

        if (q?.qty != null && qty === null) {
          validationFlags.push({
            item_key: baseItem.item_key,
            issue: "invalid_quantity",
            severity: "warning",
            code: "QTY_INVALID_VALUE",
            message: "Invalid quantity value was discarded.",
          });
        }

        if (qty === null) {
          qtyMissing += 1;
          validationFlags.push({
            item_key: baseItem.item_key,
            issue: "missing_quantity",
            severity: "info",
            code: "QTY_UNRESOLVED",
            message: "Quantity is unresolved and requires manual review.",
          });
        } else if (hasSufficientEvidence(excerpt)) {
          qtyWithEvidence += 1;
        }

        if (confidence < 0.6) {
          lowConfidence += 1;
        }

        mergedItems.push({
          item_key: baseItem.item_key,
          item_no: baseItem.item_no,
          description: baseItem.description,
          unit: normalizeUnit(q?.unit || baseItem.unit),
          qty,
          rate: null,
          amount: null,
          quantity_source: source,
          quantity_confidence: confidence,
          source_excerpt: excerpt,
          source_anchor: anchor,
          source_document: sourceDocument,
          evidence_type: q?.evidence_type ?? "missing",
          derivation_note: q?.derivation_note ?? null,
          note: q?.note ?? baseItem.note,
        });
      }

      return mergedItems;
    })(),
  }));

  const qualitySummary: BOQQualitySummary = {
    total_items: totalItems,
    qty_with_evidence: qtyWithEvidence,
    qty_missing: qtyMissing,
    low_confidence: lowConfidence,
    semantic_risk_items: bills
      .flatMap((bill) => bill.items)
      .filter((item) => !item.is_header && item.evidence_type === "missing").length,
    evidence_coverage_ratio:
      totalItems > 0 ? Number((qtyWithEvidence / totalItems).toFixed(2)) : 0,
    source_bundle_status: documentClassification?.source_bundle_status ?? "complete",
    missing_required_attachments: documentClassification?.required_attachments.length ?? 0,
  };

  const artifacts: BOQArtifacts = {
    structure_v1: structure,
    quantities_v1: Array.from(quantityMap.values()),
    validation_flags: validationFlags,
  };

  return {
    project: structure.project,
    location: structure.location,
    prepared_by: structure.prepared_by,
    date: structure.date,
    bills,
    structure_mode: structure.structure_mode,
    pipeline_version: "quantity-v2.0",
    document_classification: documentClassification,
    source_bundle: sourceBundle,
    quality_summary: qualitySummary,
    artifacts,
  };
}

function safeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function safeNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function sanitizePositiveNumber(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v <= 0) return null;
  return Number(v.toFixed(4));
}

function normalizeUnit(unit: string | null | undefined): string {
  if (!unit || typeof unit !== "string") return "Item";
  const normalized = unit.trim().toLowerCase();
  if (!normalized) return "Item";
  if (normalized === "m2" || normalized === "sqm") return "m²";
  if (normalized === "m3" || normalized === "cum") return "m³";
  if (normalized === "no" || normalized === "nos" || normalized === "no.") return "No.";
  if (normalized === "ls") return "LS";
  if (normalized === "item") return "Item";
  if (normalized === "m") return "m";
  if (normalized === "m²") return "m²";
  if (normalized === "m³") return "m³";
  if (normalized === "kg") return "kg";
  if (normalized === "t") return "t";
  return unit.trim();
}

function normalizeSource(
  source: string | QuantitySource | undefined,
  qty: number | null | undefined
): QuantitySource {
  const clean = (source ?? "").toLowerCase();
  if (clean === "explicit" || clean === "derived" || clean === "assumed") {
    return clean;
  }
  return qty == null ? "assumed" : "explicit";
}

function normalizeConfidence(confidence: number | null | undefined): number {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return 0.4;
  if (confidence < 0) return 0;
  if (confidence > 1) return 1;
  return Number(confidence.toFixed(2));
}

function normalizeEvidenceType(
  evidenceType: string | BOQEvidenceType | null | undefined,
  excerpt: string | null | undefined,
  qty: number | null
): BOQEvidenceType {
  const clean = (evidenceType ?? "").toLowerCase();
  if (
    clean === "quoted_scope" ||
    clean === "tabulated_scope" ||
    clean === "derived_calculation" ||
    clean === "metadata_only" ||
    clean === "missing"
  ) {
    return clean;
  }
  if (qty == null || !excerpt?.trim()) return "missing";
  return "quoted_scope";
}

export function hasSufficientEvidence(excerpt: string | null): boolean {
  if (!excerpt) return false;
  return excerpt.trim().length >= 12;
}
