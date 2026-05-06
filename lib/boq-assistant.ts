import { GoogleGenerativeAI, SchemaType, type UsageMetadata } from "@google/generative-ai";
import type { BOQDocument } from "./types";
import { computeAICostUsd, type AIUsageEntry } from "./gemini-pricing";
import { getServerEnv } from "./server-env";

const OPENAI_PRIMARY_MODEL = process.env.OPENAI_MODEL_PRIMARY || "gpt-4.1";
const OPENAI_FAST_MODEL = process.env.OPENAI_MODEL_FAST || "gpt-4.1-mini";
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_MODEL_FALLBACK || "gemini-2.5-pro";
const GEMINI_FAST_FALLBACK_MODEL = process.env.GEMINI_MODEL_FAST_FALLBACK || "gemini-2.5-flash";
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

const SYSTEM_PROMPT = `You are a senior quantity surveyor assistant helping a user edit a Bill of Quantities (BOQ) for a Zambian construction project. You practise under ASAQS conventions (Southern African QS Association), aligned with SMM7 measurement rules.

You can ONLY help edit the provided BOQ. Do not answer unrelated questions — if asked, explain you are a BOQ editing assistant only.

EDITING RULES:
1. Return the complete modified BOQ JSON plus a plain-text summary of changes made.
2. Preserve all existing data unless the user explicitly asks to change it.
3. Never add, remove, or renumber bills without an explicit instruction to do so.

DESCRIPTION STANDARDS — when writing or rewriting descriptions, follow ASAQS style:
- State work method first, then material, then location/dimension: e.g. "Excavate in pickable material for foundation trenches not exceeding 1.50m deep, get out and deposit in temporary spoil heaps on site"
- Include material grade/spec where relevant: "Vibrated reinforced in-situ concrete (Grade 30) in 200mm horizontal suspended slab"
- Use British English (metre, labour, colour)
- For items measured net, append "(measured net — no allowance made for laps)"
- Use "Ditto" only when description and unit are identical to the immediately preceding item

MEASUREMENT RULES — when the user asks to add or correct quantities:
- Concrete: net in place, no waste factor
- Reinforcement: by mass (kg), laps not measured separately
- Brickwork/blockwork: flat gross area, deduct openings over 0.1m²
- Plasterwork: net, deduct openings over 0.5m²
- Mesh/DPM: net, no allowance for laps
- Pipework: linear metres along centreline, fittings not included
- Preliminary items: qty = 1, unit = Item or LS

RATE RULES — when the user asks to price or reprice items (ZMW all-in rates, Q1 2026):
- Earthworks: pickable excavation 55–90/m³, backfill 45–85/m³, imported fill 150–320/m³
- Concrete Grade 25: 2,500–4,000/m³; Grade 30: 3,800–5,800/m³; blinding: 1,200–2,200/m²
- Reinforcement Y-bars: 38–58/kg; mesh type 257: 260–500/m²
- Blockwork 200mm: 340–550/m²; 150mm: 320–480/m²
- Plaster internal: 130–230/m²; external: 160–290/m²
- Ceramic floor tiles: 290–700/m²; wall tiles: 260–580/m²
- IBR roofing: 200–350/m²; timber rafters: 110–200/m; purlins: 70–140/m
- Doors (hardwood solid-core): 3,500–7,500/No.; frames: 2,500–5,500/No.
- uPVC soil pipe 110mm: 300–580/m; water pipe PPR 20mm: 200–420/m
- Socket outlet single: 200–450/No.; double: 350–700/No.
- Light fitting LED panel: 900–2,800/No.; distribution board 8-way: 6,500–14,000/No.
- Emulsion paint 2 coats internal: 90–180/m²; external masonry paint: 110–220/m²
- Mobilisation: 50,000–500,000/Item (2–4% of works value)
- Provisional sum/contingency: price as the PS amount, qty = 1

STRUCTURAL RULES — always maintain:
- project, location, prepared_by, date at top level
- Each bill: number, title, items array
- Each item: description (required); item_no, unit, qty, rate, amount, is_header, note (all nullable)
- amount = qty × rate exactly when both are non-null`;

const STREAM_SUMMARY_PROMPT = `You are a BOQ editing assistant. The user gave an instruction for editing a BOQ.

Return a short plan summary in plain text with 2-4 concise bullets about what you will change.
Do not include markdown code blocks.`;

const SUMMARISE_HISTORY_PROMPT = `Summarise the following BOQ assistant conversation turns into 3-5 concise sentences. Capture: what the user asked for, what was changed, and any decisions or preferences the user expressed. Omit JSON. Plain text only.`;

// A message in the conversation history passed from the frontend.
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

// The two response modes the assistant can return.
// "question" = assistant needs clarification before acting (free, no credits).
// "proposal" = assistant produced a BOQ edit (costs credits).
export type AssistantResponseMode = "question" | "proposal";

export type AssistantResponse =
  | { mode: "question"; question: string }
  | { mode: "proposal"; result: AssistantEditResult };

// Compress older turns into a single summary string using Flash (cheap).
async function summariseHistory(
  turns: ChatMessage[],
  usageCollector?: AssistantUsageCollector,
): Promise<string> {
  const transcript = turns
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const model = getGenAI().getGenerativeModel({
    model: GEMINI_FAST_FALLBACK_MODEL,
    systemInstruction: SUMMARISE_HISTORY_PROMPT,
    generationConfig: { temperature: 0 },
  });

  const result = await model.generateContent(transcript);
  recordGeminiUsage(usageCollector, GEMINI_FAST_FALLBACK_MODEL, "assistant_history_summary", result.response.usageMetadata);
  return result.response.text().trim();
}

// Build the conversation context block injected before the current instruction.
// Keeps last 4 turns verbatim; compresses anything older into a summary.
export async function buildConversationContext(
  history: ChatMessage[],
  usageCollector?: AssistantUsageCollector,
): Promise<string> {
  if (history.length === 0) return "";

  const VERBATIM_TURNS = 4; // last N messages kept as-is
  const older = history.slice(0, -VERBATIM_TURNS);
  const recent = history.slice(-VERBATIM_TURNS);

  const parts: string[] = [];

  if (older.length > 0) {
    const summary = await summariseHistory(older, usageCollector);
    parts.push(`[Earlier conversation summary]\n${summary}`);
  }

  for (const msg of recent) {
    parts.push(`${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`);
  }

  return parts.join("\n\n");
}

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
  conversationContext: string,
  usageCollector?: AssistantUsageCollector,
): Promise<AssistantResponse> {
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

  const contextBlock = conversationContext
    ? `Conversation so far:\n${conversationContext}\n\n`
    : "";

  const result = await model.generateContent(
    [
      contextBlock,
      "Current BOQ JSON:",
      JSON.stringify(currentBoq),
      "",
      "User instruction:",
      instruction,
      "",
      'Decide: if the instruction is ambiguous or missing critical information (spec, scope, which bill), ask ONE short clarifying question instead of guessing. Otherwise produce the edit.',
      'Return JSON: { "mode": "question", "question": "..." } OR { "mode": "proposal", "summary": "...", "proposed_boq": {...} }',
    ].join("\n")
  );

  recordGeminiUsage(usageCollector, modelName, "assistant_proposal", result.response.usageMetadata);

  const raw = result.response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) {
      parsed = JSON.parse(raw.slice(first, last + 1)) as Record<string, unknown>;
    } else {
      throw new Error("Assistant returned non-JSON output");
    }
  }

  if (parsed.mode === "question" && typeof parsed.question === "string") {
    return { mode: "question", question: parsed.question };
  }

  // proposal mode (or legacy shape without mode field)
  const boqData = (parsed.proposed_boq ?? parsed) as unknown;
  const proposed = normalizeBoq(boqData, currentBoq);
  if (!proposed || !Array.isArray(proposed.bills)) {
    throw new Error("Assistant returned invalid BOQ structure");
  }

  return {
    mode: "proposal",
    result: {
      summary: (typeof parsed.summary === "string" ? parsed.summary : null) || "Prepared BOQ edits from your instruction.",
      proposed_boq: proposed,
    },
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
  conversationContext: string,
  usageCollector?: AssistantUsageCollector,
): Promise<AssistantResponse> {
  const apiKey = ensureOpenAIConfigured();
  const contextBlock = conversationContext
    ? `Conversation so far:\n${conversationContext}\n\n`
    : "";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_PRIMARY_MODEL,
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            contextBlock,
            "Current BOQ JSON:",
            JSON.stringify(currentBoq),
            "",
            "User instruction:",
            instruction,
            "",
            'Decide: if the instruction is ambiguous or missing critical information, ask ONE short clarifying question. Otherwise produce the edit.',
            'Return JSON: { "mode": "question", "question": "..." } OR { "mode": "proposal", "summary": "...", "proposed_boq": {...} }',
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

  recordOpenAIUsage(usageCollector, OPENAI_PRIMARY_MODEL, "assistant_proposal", payload.usage);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    const first = rawText.indexOf("{");
    const last = rawText.lastIndexOf("}");
    if (first >= 0 && last > first) {
      parsed = JSON.parse(rawText.slice(first, last + 1)) as Record<string, unknown>;
    } else {
      throw new Error("Assistant returned non-JSON output");
    }
  }

  if (parsed.mode === "question" && typeof parsed.question === "string") {
    return { mode: "question", question: parsed.question };
  }

  const boqData = (parsed.proposed_boq ?? parsed) as unknown;
  const proposed = normalizeBoq(boqData, currentBoq);
  if (!proposed || !Array.isArray(proposed.bills)) {
    throw new Error("Assistant returned invalid BOQ structure");
  }

  return {
    mode: "proposal",
    result: {
      summary: (typeof parsed.summary === "string" ? parsed.summary : null) || "Prepared BOQ edits from your instruction.",
      proposed_boq: proposed,
    },
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
      model: OPENAI_PRIMARY_MODEL,
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

  recordOpenAIUsage(usageCollector, OPENAI_PRIMARY_MODEL, "assistant_summary", payload.usage);

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
  conversationContext = "",
): Promise<AssistantResponse> {
  // OpenAI primary with retries
  let lastOpenAIError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
    try {
      return await runAssistantModelWithOpenAI(currentBoq, instruction, conversationContext, usageCollector);
    } catch (err) {
      lastOpenAIError = err;
      if (attempt < MAX_ATTEMPTS_PER_MODEL) {
        await delay(Math.min(1000 * 2 ** (attempt - 1), 3000));
      }
    }
  }

  // Gemini emergency fallback — one attempt
  try {
    return await runAssistantModel(GEMINI_FALLBACK_MODEL, currentBoq, instruction, conversationContext, usageCollector);
  } catch (geminiError) {
    const openAIMessage = lastOpenAIError instanceof Error ? lastOpenAIError.message : "OpenAI assistant failed";
    const geminiMessage = geminiError instanceof Error ? geminiError.message : "Gemini fallback failed";
    throw new Error(`OpenAI assistant failed (${MAX_ATTEMPTS_PER_MODEL} attempts): ${openAIMessage}. Gemini fallback failed: ${geminiMessage}`);
  }
}

export async function streamAssistantSummary(
  currentBoq: BOQDocument,
  instruction: string,
  onToken: (token: string) => void,
  usageCollector?: AssistantUsageCollector,
): Promise<void> {
  // OpenAI primary with retries
  let lastOpenAIError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
    try {
      await runAssistantSummaryWithOpenAI(currentBoq, instruction, onToken, usageCollector);
      return;
    } catch (err) {
      lastOpenAIError = err;
      if (attempt < MAX_ATTEMPTS_PER_MODEL) {
        await delay(Math.min(1000 * 2 ** (attempt - 1), 3000));
      }
    }
  }

  // Gemini emergency fallback — one attempt
  try {
    const model = getGenAI().getGenerativeModel({
      model: GEMINI_FALLBACK_MODEL,
      systemInstruction: STREAM_SUMMARY_PROMPT,
      generationConfig: { temperature: 0.1 },
    });
    const stream = await model.generateContentStream(
      ["Current BOQ JSON:", JSON.stringify(currentBoq), "", "User edit instruction:", instruction].join("\n")
    );
    for await (const chunk of stream.stream) {
      const token = chunk.text();
      if (token) onToken(token);
    }
    const finalResponse = await stream.response;
    recordGeminiUsage(usageCollector, GEMINI_FALLBACK_MODEL, "assistant_summary", finalResponse.usageMetadata);
  } catch (geminiError) {
    const openAIMessage = lastOpenAIError instanceof Error ? lastOpenAIError.message : "OpenAI summary failed";
    throw new Error(`OpenAI summary failed (${MAX_ATTEMPTS_PER_MODEL} attempts): ${openAIMessage}. Gemini fallback failed.`);
  }
}
