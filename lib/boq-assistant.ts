import { GoogleGenerativeAI, type UsageMetadata } from "@google/generative-ai";
import type { BOQDocument } from "./types";
import { computeAICostUsd, type AIUsageEntry } from "./gemini-pricing";

const PRIMARY_MODEL = process.env.GEMINI_MODEL_PRIMARY || "gemini-2.5-pro";
const FALLBACK_MODEL = process.env.GEMINI_MODEL_FALLBACK || "gemini-2.5-flash";
const MAX_ATTEMPTS_PER_MODEL = 2;

export type AssistantUsageCollector = {
  entries: AIUsageEntry[];
};

function getGenAI() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenerativeAI(key);
}

export interface AssistantEditResult {
  summary: string;
  proposed_boq: BOQDocument;
}

const SYSTEM_PROMPT = `You are a BOQ editing assistant.

You can ONLY help edit an existing Bill of Quantities JSON.

Rules:
1. Only modify the provided BOQ JSON.
2. Do not answer unrelated questions (weather, coding, etc). If user asks unrelated request, keep BOQ unchanged and explain you only edit BOQ.
3. Keep BOQ structure valid with project, location, prepared_by, date, and bills.
4. Each bill must keep: number, title, items.
5. Each item must keep: item_no, description, unit. qty/rate/amount can be null.
6. Preserve existing data unless user explicitly asks to change it.
7. If user asks to add pricing, set rate and amount where possible. If no rate is provided, keep rate and amount null.
8. Keep the response concise in summary and return full proposed_boq JSON.`;

const STREAM_SUMMARY_PROMPT = `You are a BOQ editing assistant. The user gave an instruction for editing a BOQ.

Return a short plan summary in plain text with 2-4 concise bullets about what you will change.
Do not include markdown code blocks.`;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("service unavailable") ||
    msg.includes("high demand") ||
    msg.includes("temporar") ||
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("no longer available") ||
    (msg.includes("model") && msg.includes("not found"))
  );
}

function recordGeminiUsage(
  collector: AssistantUsageCollector | undefined,
  model: string,
  operation: string,
  usageMetadata?: UsageMetadata,
) {
  if (!collector || !usageMetadata) return;

  const inputTokens = usageMetadata.promptTokenCount ?? 0;
  const outputTokens =
    usageMetadata.candidatesTokenCount ??
    Math.max(0, (usageMetadata.totalTokenCount ?? 0) - inputTokens);
  const totalTokens = usageMetadata.totalTokenCount ?? inputTokens + outputTokens;

  collector.entries.push({
    operation,
    provider: "gemini",
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd: computeAICostUsd({
      provider: "gemini",
      model,
      inputTokens,
      outputTokens,
    }),
  });
}

async function runAssistantModel(
  modelName: string,
  currentBoq: BOQDocument,
  instruction: string,
  usageCollector?: AssistantUsageCollector,
): Promise<AssistantEditResult> {
  const model = getGenAI().getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
      thinkingConfig: { thinkingBudget: -1 },
    } as any,
  });

  const result = await model.generateContent(
    [
      "Current BOQ JSON:",
      JSON.stringify(currentBoq),
      "",
      "User edit instruction:",
      instruction,
      "",
      "Return strict JSON with shape: {\"summary\": string, \"proposed_boq\": BOQDocument }",
    ].join("\n")
  );

  const parsed = parseAssistantJson(result.response.text());
  recordGeminiUsage(usageCollector, modelName, "assistant_proposal", result.response.usageMetadata);
  const proposed = normalizeBoq(parsed.proposed_boq, currentBoq);

  if (!proposed || !Array.isArray(proposed.bills)) {
    throw new Error("Assistant returned invalid BOQ structure");
  }

  return {
    summary: parsed.summary || "Prepared BOQ edits from your instruction.",
    proposed_boq: proposed,
  };
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseAssistantJson(raw: string): { summary: string; proposed_boq: BOQDocument } {
  try {
    return JSON.parse(raw) as { summary: string; proposed_boq: BOQDocument };
  } catch {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) {
      const sliced = raw.slice(first, last + 1);
      return JSON.parse(sliced) as { summary: string; proposed_boq: BOQDocument };
    }
    throw new Error("Assistant returned non-JSON output");
  }
}

function normalizeBoq(candidate: unknown, fallback: BOQDocument): BOQDocument {
  const source = (candidate && typeof candidate === "object"
    ? (candidate as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const billsRaw = Array.isArray(source.bills) ? source.bills : fallback.bills;

  const bills = billsRaw.map((bill, billIdx) => {
    const b = (bill && typeof bill === "object" ? bill : {}) as Record<string, unknown>;
    const itemsRaw = Array.isArray(b.items) ? b.items : [];

    const items = itemsRaw.map((item) => {
      const i = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const qty = toNumberOrNull(i.qty);
      const rate = toNumberOrNull(i.rate);
      const amount = toNumberOrNull(i.amount);
      const description =
        typeof i.description === "string" && i.description.trim()
          ? i.description.trim()
          : "Updated BOQ item";
      const unit = typeof i.unit === "string" && i.unit.trim() ? i.unit.trim() : "Item";

      return {
        item_no: typeof i.item_no === "string" ? i.item_no : "",
        description,
        unit,
        qty,
        rate,
        amount: amount ?? (qty !== null && rate !== null ? +(qty * rate).toFixed(2) : null),
        is_header: typeof i.is_header === "boolean" ? i.is_header : undefined,
        note: typeof i.note === "string" ? i.note : undefined,
      };
    });

    return {
      number: typeof b.number === "number" ? b.number : billIdx + 1,
      title: typeof b.title === "string" && b.title.trim() ? b.title.trim() : `Bill ${billIdx + 1}`,
      items,
    };
  });

  return {
    project:
      typeof source.project === "string" && source.project.trim()
        ? source.project.trim()
        : fallback.project,
    location:
      typeof source.location === "string" && source.location.trim()
        ? source.location.trim()
        : fallback.location,
    prepared_by:
      typeof source.prepared_by === "string" && source.prepared_by.trim()
        ? source.prepared_by.trim()
        : fallback.prepared_by,
    date:
      typeof source.date === "string" && source.date.trim() ? source.date.trim() : fallback.date,
    bills,
  };
}

export async function proposeBOQEditWithAI(
  currentBoq: BOQDocument,
  instruction: string,
  usageCollector?: AssistantUsageCollector,
): Promise<AssistantEditResult> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL].filter(
    (value, index, arr) => Boolean(value) && arr.indexOf(value) === index
  );

  let lastError: unknown;

  for (const modelName of models) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
      try {
        return await runAssistantModel(modelName, currentBoq, instruction, usageCollector);
      } catch (err) {
        lastError = err;
        if (!isTransientGeminiError(err)) {
          throw err;
        }

        const isLastAttempt = attempt === MAX_ATTEMPTS_PER_MODEL;
        if (!isLastAttempt) {
          const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 3000);
          await delay(backoffMs);
        }
      }
    }
  }

  throw lastError instanceof Error
    ? new Error(`Gemini assistant temporarily unavailable: ${lastError.message}`)
    : new Error("Gemini assistant temporarily unavailable");
}

export async function streamAssistantSummary(
  currentBoq: BOQDocument,
  instruction: string,
  onToken: (token: string) => void,
  usageCollector?: AssistantUsageCollector,
): Promise<void> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL].filter(
    (value, index, arr) => Boolean(value) && arr.indexOf(value) === index
  );

  let lastError: unknown;

  for (const modelName of models) {
    try {
      const model = getGenAI().getGenerativeModel({
        model: modelName,
        systemInstruction: STREAM_SUMMARY_PROMPT,
        generationConfig: { temperature: 0.1 },
      });

      const stream = await model.generateContentStream(
        [
          "Current BOQ JSON:",
          JSON.stringify(currentBoq),
          "",
          "User edit instruction:",
          instruction,
        ].join("\n")
      );

      for await (const chunk of stream.stream) {
        const token = chunk.text();
        if (token) onToken(token);
      }

      const finalResponse = await stream.response;
      recordGeminiUsage(usageCollector, modelName, "assistant_summary", finalResponse.usageMetadata);

      return;
    } catch (err) {
      lastError = err;
      if (!isTransientGeminiError(err)) {
        throw err;
      }
    }
  }

  throw lastError instanceof Error
    ? new Error(`Gemini assistant temporarily unavailable: ${lastError.message}`)
    : new Error("Gemini assistant temporarily unavailable");
}
