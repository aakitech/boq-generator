export const STARTER_WALLET_CREDITS = 1000;
export const STARTER_WALLET_USD = 2.5;
export const USD_PER_CREDIT = STARTER_WALLET_USD / STARTER_WALLET_CREDITS;

type AIPrice = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
};

export type AIProvider = "gemini" | "openai";

export type AIUsageEntry = {
  operation: string;
  provider: AIProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type AIUsageSummary = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  creditsCharged: number;
  entries: AIUsageEntry[];
};

const AI_PRICING: Array<{ provider: AIProvider; match: RegExp; price: AIPrice }> = [
  {
    provider: "gemini",
    match: /gemini-2\.5-pro/i,
    price: {
      inputPerMillionUsd: 1.25,
      outputPerMillionUsd: 10,
    },
  },
  {
    provider: "gemini",
    match: /gemini-2\.5-flash/i,
    price: {
      inputPerMillionUsd: 0.3,
      outputPerMillionUsd: 2.5,
    },
  },
  {
    provider: "openai",
    match: /gpt-5\.4-mini/i,
    price: {
      inputPerMillionUsd: 0.75,
      outputPerMillionUsd: 4.5,
    },
  },
  {
    provider: "openai",
    match: /gpt-5\.4/i,
    price: {
      inputPerMillionUsd: 2.5,
      outputPerMillionUsd: 15,
    },
  },
];

function resolvePricing(provider: AIProvider, model: string): AIPrice {
  const normalized = model.trim();
  const matched = AI_PRICING.find((entry) => entry.provider === provider && entry.match.test(normalized));
  if (matched) return matched.price;
  return provider === "openai"
    ? { inputPerMillionUsd: 0.75, outputPerMillionUsd: 4.5 }
    : { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10 };
}

export function computeAICostUsd(options: {
  provider: AIProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  const pricing = resolvePricing(options.provider, options.model);
  const inputCost = (options.inputTokens / 1_000_000) * pricing.inputPerMillionUsd;
  const outputCost = (options.outputTokens / 1_000_000) * pricing.outputPerMillionUsd;
  return Number((inputCost + outputCost).toFixed(6));
}

export function creditsFromUsdCost(costUsd: number): number {
  if (costUsd <= 0) return 0;
  return Math.max(1, Math.ceil(costUsd / USD_PER_CREDIT));
}

export function summarizeAIUsage(entries: AIUsageEntry[]): AIUsageSummary {
  const inputTokens = entries.reduce((sum, entry) => sum + entry.inputTokens, 0);
  const outputTokens = entries.reduce((sum, entry) => sum + entry.outputTokens, 0);
  const totalTokens = entries.reduce((sum, entry) => sum + entry.totalTokens, 0);
  const costUsd = Number(entries.reduce((sum, entry) => sum + entry.costUsd, 0).toFixed(6));

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd,
    creditsCharged: creditsFromUsdCost(costUsd),
    entries,
  };
}

export type GeminiUsageEntry = AIUsageEntry;
export type GeminiUsageSummary = AIUsageSummary;
export const computeGeminiCostUsd = (options: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}) =>
  computeAICostUsd({
    provider: "gemini",
    model: options.model,
    inputTokens: options.inputTokens,
    outputTokens: options.outputTokens,
  });
export const summarizeGeminiUsage = summarizeAIUsage;
