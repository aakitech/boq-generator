import { describe, expect, it } from "vitest";
import {
  computeAICostUsd,
  creditsForAssistantEdit,
  creditsForGeneratedBoq,
  summarizeAIUsage,
} from "@/lib/gemini-pricing";

describe("computeAICostUsd", () => {
  it("uses Gemini pricing for Gemini entries", () => {
    expect(
      computeAICostUsd({
        provider: "gemini",
        model: "gemini-2.5-flash",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      })
    ).toBe(2.8);
  });

  it("uses OpenAI pricing for GPT-5.4 mini entries", () => {
    expect(
      computeAICostUsd({
        provider: "openai",
        model: "gpt-5.4-mini",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      })
    ).toBe(5.25);
  });
});

describe("summarizeAIUsage", () => {
  it("aggregates mixed-provider usage into one summary", () => {
    const summary = summarizeAIUsage([
      {
        operation: "validate_sow",
        provider: "gemini",
        model: "gemini-2.5-flash",
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        costUsd: 0.00008,
      },
      {
        operation: "rate_fill_batch",
        provider: "openai",
        model: "gpt-5.4-mini",
        inputTokens: 200,
        outputTokens: 40,
        totalTokens: 240,
        costUsd: 0.00033,
      },
    ]);

    expect(summary.inputTokens).toBe(300);
    expect(summary.outputTokens).toBe(60);
    expect(summary.totalTokens).toBe(360);
    expect(summary.costUsd).toBe(0.00041);
    expect(summary.creditsCharged).toBe(1);
    expect(summary.entries).toHaveLength(2);
  });
});

describe("go-live credit targets", () => {
  it("prices generated BOQs to allow at least two from starter credits", () => {
    expect(creditsForGeneratedBoq()).toBe(500);
  });

  it("prices assistant edits below BOQ generation", () => {
    expect(creditsForAssistantEdit()).toBe(50);
  });
});
