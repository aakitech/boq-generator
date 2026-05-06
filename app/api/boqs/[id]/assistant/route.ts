import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import type { BOQDocument } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { proposeBOQEditWithAI } from "@/lib/boq-assistant";

export const runtime = "nodejs";
export const maxDuration = 60;

function classifyAssistantError(message: string): { status: number; safeMessage: string } {
  const lower = message.toLowerCase();

  const isQuota =
    lower.includes("429") ||
    lower.includes("quota") ||
    lower.includes("too many requests");
  if (isQuota) {
    return {
      status: 429,
      safeMessage: "AI rate limit reached. Please wait a minute and try again.",
    };
  }

  const isTemporaryUnavailable =
    lower.includes("503") ||
    lower.includes("service unavailable") ||
    lower.includes("high demand") ||
    lower.includes("temporarily unavailable") ||
    lower.includes("timeout") ||
    lower.includes("etimedout") ||
    lower.includes("econnreset");

  if (isTemporaryUnavailable) {
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      instruction?: string;
      boq?: BOQDocument;
    };

    const instruction = body.instruction?.trim();
    if (!instruction) {
      return NextResponse.json({ error: "instruction is required" }, { status: 400 });
    }

    const { data: existing, error } = await supabase
      .from("boqs")
      .select("id, data")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (error || !existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const sourceBoq = body.boq ?? (existing.data as BOQDocument);
    const response = await proposeBOQEditWithAI(sourceBoq, instruction);

    if (response.mode === "question") {
      return NextResponse.json({ question: response.question });
    }

    const { summary, proposed_boq } = response.result;
    const diff = buildDiffSummary(sourceBoq, proposed_boq);

    return NextResponse.json({ summary, proposed_boq, diff });
  } catch (err) {
    logger.error("BOQ assistant error", { error: err instanceof Error ? err.message : String(err), route: "assistant" });
    const message = err instanceof Error ? err.message : "Unknown error";
    const classified = classifyAssistantError(message);
    return NextResponse.json({ error: classified.safeMessage }, { status: classified.status });
  }
}
