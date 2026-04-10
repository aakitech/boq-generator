export const STARTER_WALLET_CREDITS = 1000;
export const STARTER_WALLET_USD = 2.5;
export const USD_PER_CREDIT = STARTER_WALLET_USD / STARTER_WALLET_CREDITS;

type GeminiPrice = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
};

export type GeminiUsageEntry = {
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type GeminiUsageSummary = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  creditsCharged: number;
  entries: GeminiUsageEntry[];
};

const GEMINI_PRICING: Array<{ match: RegExp; price: GeminiPrice }> = [
  {
    match: /gemini-2\.5-pro/i,
    price: {
      inputPerMillionUsd: 1.25,
      outputPerMillionUsd: 10,
    },
  },
  {
    match: /gemini-2\.5-flash/i,
    price: {
      inputPerMillionUsd: 0.3,
      outputPerMillionUsd: 2.5,
    },
  },
];

function resolvePricing(model: string): GeminiPrice {
  const normalized = model.trim();
  const matched = GEMINI_PRICING.find((entry) => entry.match.test(normalized));
  return matched?.price ?? GEMINI_PRICING[0].price;
}

export function computeGeminiCostUsd(options: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  const pricing = resolvePricing(options.model);
  const inputCost = (options.inputTokens / 1_000_000) * pricing.inputPerMillionUsd;
  const outputCost = (options.outputTokens / 1_000_000) * pricing.outputPerMillionUsd;
  return Number((inputCost + outputCost).toFixed(6));
}

export function creditsFromUsdCost(costUsd: number): number {
  if (costUsd <= 0) return 0;
  return Math.max(1, Math.ceil(costUsd / USD_PER_CREDIT));
}

export function summarizeGeminiUsage(entries: GeminiUsageEntry[]): GeminiUsageSummary {
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
