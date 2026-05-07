import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import type { BOQDocument } from "@/lib/types";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { proposeBOQEditWithAI, streamAssistantSummary, buildConversationContext, type AssistantUsageCollector, type ChatMessage } from "@/lib/boq-assistant";
import { getRemainingCredits } from "@/lib/credits";
import { summarizeAIUsage } from "@/lib/gemini-pricing";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";
export const maxDuration = 60;

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function buildDiffSummary(before: BOQDocument, after: BOQDocument) {
  const beforeItems = before.bills.reduce((sum, bill) => sum + bill.items.length, 0);
  const afterItems = after.bills.reduce((sum, bill) => sum + bill.items.length, 0);
  const pricedBefore = before.bills.reduce(
    (sum, bill) => sum + bill.items.filter((item) => item.rate !== null).length,
    0
  );
  const pricedAfter = after.bills.reduce(
    (sum, bill) => sum + bill.items.filter((item) => item.rate !== null).length,
    0
  );

  return {
    billDelta: after.bills.length - before.bills.length,
    itemDelta: afterItems - beforeItems,
    pricedItemsDelta: pricedAfter - pricedBefore,
  };
}

function classifyAssistantError(message: string): { status: number; safeMessage: string } {
  const lower = message.toLowerCase();

  if (lower.includes("429") || lower.includes("quota") || lower.includes("too many requests")) {
    return {
      status: 429,
      safeMessage: "AI rate limit reached. Please wait a minute and try again.",
    };
  }

  if (
    lower.includes("503") ||
    lower.includes("service unavailable") ||
    lower.includes("high demand") ||
    lower.includes("temporarily unavailable") ||
    lower.includes("timeout") ||
    lower.includes("etimedout") ||
    lower.includes("econnreset")
  ) {
    return {
      status: 503,
      safeMessage: "AI editing assistant is temporarily busy. Please try again in a moment.",
    };
  }

  if (lower.includes("non-json") || lower.includes("invalid boq structure")) {
    return {
      status: 422,
      safeMessage:
        "AI returned an invalid edit format. Please rephrase your request with clear item-level instructions.",
    };
  }

  return { status: 500, safeMessage: "AI assistant could not process that BOQ edit request." };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sse(event, data)));
      };

      try {
        const { id } = await params;
        const supabase = await createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          write("error", { message: "Unauthorized", status: 401 });
          controller.close();
          return;
        }

        const body = (await req.json()) as {
          instruction?: string;
          boq?: BOQDocument;
          history?: ChatMessage[];
        };

        const instruction = body.instruction?.trim();
        if (!instruction) {
          write("error", { message: "instruction is required", status: 400 });
          controller.close();
          return;
        }

        const { data: existing, error } = await supabase
          .from("boqs")
          .select("id, data")
          .eq("id", id)
          .eq("user_id", user.id)
          .single();

        if (error || !existing) {
          write("error", { message: "Not found", status: 404 });
          controller.close();
          return;
        }

        const sourceBoq = body.boq ?? (existing.data as BOQDocument);
        const history: ChatMessage[] = Array.isArray(body.history) ? body.history : [];
        const serviceClient =
          process.env.SUPABASE_SERVICE_ROLE_KEY ? createServiceClient() : supabase;

        const usageCollector: AssistantUsageCollector = { entries: [] };

        // Build conversation context (summarises older turns, keeps last 4 verbatim).
        // This call is cheap (Flash) and happens before credit check so questions are free.
        const conversationContext = await buildConversationContext(history, usageCollector);

        write("status", { step: "planning" });
        const response = await proposeBOQEditWithAI(sourceBoq, instruction, usageCollector, conversationContext);

        // Question mode: free, no credits consumed. No summary streaming.
        if (response.mode === "question") {
          write("question", { question: response.question });
          write("done", { ok: true });
          return;
        }

        const { result } = response;

        write("status", { step: "proposing" });
        await streamAssistantSummary(sourceBoq, instruction, (token) => {
          write("token", { token });
        }, usageCollector);

        const diff = buildDiffSummary(sourceBoq, result.proposed_boq);
        const usageSummary = summarizeAIUsage(usageCollector.entries);
        const remainingCredits = await getRemainingCredits(serviceClient, user.id);

        trackEvent(user.id, "assistant_edit", {
          boqId: id,
          aiCostUsd: usageSummary.costUsd,
          remainingCredits,
        });

        write("result", {
          summary: result.summary,
          proposed_boq: result.proposed_boq,
          diff,
          remainingCredits,
          creditsCharged: 0,
        });
        write("done", { ok: true });
      } catch (err) {
        logger.error("BOQ assistant stream error", { error: err instanceof Error ? err.message : String(err), route: "assistant-stream" });
        const message = err instanceof Error ? err.message : "Unknown error";
        const classified = classifyAssistantError(message);
        write("error", { message: classified.safeMessage, status: classified.status });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
