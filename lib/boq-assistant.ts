import { GoogleGenerativeAI, SchemaType, type UsageMetadata } from "@google/generative-ai";
import type { BOQDocument } from "./types";
import { computeAICostUsd, type AIUsageEntry } from "./gemini-pricing";
import { getServerEnv } from "./server-env";

const PRIMARY_MODEL = process.env.GEMINI_MODEL_PRIMARY || "gemini-2.5-pro";
const FALLBACK_MODEL = process.env.GEMINI_MODEL_FALLBACK || "gemini-2.5-flash";
const OPENAI_FALLBACK_MODEL = process.env.OPENAI_MODEL_FALLBACK || "gpt-5.4-mini";
const MAX_ATTEMPTS_PER_MODEL = 2;

export type AssistantUsageCollector = {
  entries: AIUsageEntry[];
};

function getGenAI() {
  const key = getServerEnv("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenerativeAI(key);
}

export interface AssistantEditResult {
  summary: string;
  proposed_boq: BOQDocument;
}

type GeminiSchemaNode = {
  type?: SchemaType;
  properties?: Record<string, GeminiSchemaNode>;
  items?: GeminiSchemaNode;
  required?: string[];
  nullable?: boolean;
  description?: string;
};

const ASSISTANT_RESULT_SCHEMA: GeminiSchemaNode = {
  type: SchemaType.OBJECT,
  properties: {
    summary: { type: SchemaType.STRING },
    proposed_boq: {
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
    },
  },
  required: ["summary", "proposed_boq"],
};

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

function getOpenAIKey() {
  return getServerEnv("OPENAI_API_KEY");
}

function ensureOpenAIConfigured() {
  const key = getOpenAIKey();
  if (!key) {
    throw new Error("OpenAI assistant fallback is not configured. Set OPENAI_API_KEY to enable it.");
  }
  return key;
}

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

  const schema: Record<string, unknown> = {
    type: node.nullable ? [baseType, "null"] : baseType,
  };

  if (node.description) schema.description = node.description;

  if (node.type === SchemaType.OBJECT) {
    const requiredKeys = new Set(node.required ?? []);
    schema.properties = Object.fromEntries(
      Object.entries(node.properties ?? {}).map(([key, value]) => {
        const normalized = !requiredKeys.has(key) && !value.nullable ? { ...value, nullable: true } : value;
        return [key, toOpenAIJsonSchema(normalized)];
      })
    );
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

function recordOpenAIUsage(
  collector: AssistantUsageCollector | undefined,
  model: string,
  operation: string,
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
) {
  if (!collector || !usage) return;

  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? inputTokens + outputTokens;

  collector.entries.push({
    operation,
    provider: "openai",
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd: computeAICostUsd({
      provider: "openai",
      model,
      inputTokens,
      outputTokens,
    }),
  });
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

async function runAssistantModelWithOpenAI(
  currentBoq: BOQDocument,
  instruction: string,
  usageCollector?: AssistantUsageCollector,
): Promise<AssistantEditResult> {
  const apiKey = ensureOpenAIConfigured();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_FALLBACK_MODEL,
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            "Current BOQ JSON:",
            JSON.stringify(currentBoq),
            "",
            "User edit instruction:",
            instruction,
            "",
            'Return strict JSON with shape: {"summary": string, "proposed_boq": BOQDocument }',
          ].join("\n"),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "assistant_edit_result",
          strict: true,
          schema: toOpenAIJsonSchema(ASSISTANT_RESULT_SCHEMA),
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(await parseOpenAIError(response));
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const content = payload.choices?.[0]?.message?.content;
  const rawText = Array.isArray(content)
    ? content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
    : typeof content === "string"
      ? content
      : "";

  recordOpenAIUsage(usageCollector, OPENAI_FALLBACK_MODEL, "assistant_proposal", payload.usage);

  const parsed = parseAssistantJson(rawText);
  const proposed = normalizeBoq(parsed.proposed_boq, currentBoq);

  if (!proposed || !Array.isArray(proposed.bills)) {
    throw new Error("Assistant returned invalid BOQ structure");
  }

  return {
    summary: parsed.summary || "Prepared BOQ edits from your instruction.",
    proposed_boq: proposed,
  };
}

async function runAssistantSummaryWithOpenAI(
  currentBoq: BOQDocument,
  instruction: string,
  onToken: (token: string) => void,
  usageCollector?: AssistantUsageCollector,
): Promise<void> {
  const apiKey = ensureOpenAIConfigured();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_FALLBACK_MODEL,
      temperature: 0.1,
      messages: [
        { role: "system", content: STREAM_SUMMARY_PROMPT },
        {
          role: "user",
          content: [
            "Current BOQ JSON:",
            JSON.stringify(currentBoq),
            "",
            "User edit instruction:",
            instruction,
          ].join("\n"),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(await parseOpenAIError(response));
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const content = payload.choices?.[0]?.message?.content;
  const rawText = Array.isArray(content)
    ? content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
    : typeof content === "string"
      ? content
      : "";

  recordOpenAIUsage(usageCollector, OPENAI_FALLBACK_MODEL, "assistant_summary", payload.usage);

  if (rawText.trim()) {
    onToken(rawText.trim());
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
          break;
        }

        const isLastAttempt = attempt === MAX_ATTEMPTS_PER_MODEL;
        if (!isLastAttempt) {
          const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 3000);
          await delay(backoffMs);
        }
      }
    }
  }

  try {
    return await runAssistantModelWithOpenAI(currentBoq, instruction, usageCollector);
  } catch (openAIError) {
    const geminiMessage = lastError instanceof Error ? lastError.message : "Gemini assistant temporarily unavailable";
    const openAIMessage = openAIError instanceof Error ? openAIError.message : "OpenAI assistant fallback failed";
    throw new Error(`Gemini assistant failed: ${geminiMessage}. OpenAI fallback failed: ${openAIMessage}`);
  }
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
        break;
      }
    }
  }

  try {
    await runAssistantSummaryWithOpenAI(currentBoq, instruction, onToken, usageCollector);
    return;
  } catch (openAIError) {
    const geminiMessage = lastError instanceof Error ? lastError.message : "Gemini assistant temporarily unavailable";
    const openAIMessage = openAIError instanceof Error ? openAIError.message : "OpenAI assistant fallback failed";
    throw new Error(`Gemini assistant failed: ${geminiMessage}. OpenAI fallback failed: ${openAIMessage}`);
  }
}
