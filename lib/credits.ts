import type { SupabaseClient } from "@supabase/supabase-js";
import { STARTER_WALLET_CREDITS } from "@/lib/gemini-pricing";

export const STARTER_CREDITS = STARTER_WALLET_CREDITS;

export type CreditConsumptionReason = "generate_boq" | "rate_boq" | "assistant_boq";

type CreditStatus = "consumed" | "already_consumed" | "insufficient";

type ConsumeWalletCreditsResult = {
  status: CreditStatus;
  remainingCredits: number;
};

export async function getRemainingCredits(
  client: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data, error } = await client
    .from("profiles")
    .select("wallet_credits_balance")
    .eq("id", userId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data?.wallet_credits_balance ?? 0;
}

export async function consumeWalletCredits(
  client: SupabaseClient,
  options: {
    userId: string;
    reason: CreditConsumptionReason;
    referenceType: string;
    referenceId: string;
    credits: number;
    deltaUsd: number;
    metadata?: Record<string, unknown>;
  },
): Promise<ConsumeWalletCreditsResult> {
  const { data, error } = await client.rpc("consume_wallet_credits", {
    p_user_id: options.userId,
    p_reason: options.reason,
    p_reference_type: options.referenceType,
    p_reference_id: options.referenceId,
    p_credits: options.credits,
    p_delta_usd: options.deltaUsd,
    p_metadata: options.metadata ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    status: (row?.status ?? "insufficient") as CreditStatus,
    remainingCredits: Number(row?.remaining_credits ?? 0),
  };
}

export async function refundWalletCredits(
  client: SupabaseClient,
  options: {
    userId: string;
    credits: number;
    deltaUsd?: number;
    reason: CreditConsumptionReason;
    referenceType: string;
    referenceId: string;
  },
): Promise<void> {
  const { data: current, error: currentError } = await client
    .from("profiles")
    .select("wallet_credits_balance")
    .eq("id", options.userId)
    .single();

  if (currentError) {
    throw new Error(currentError.message);
  }

  const newBalance = (current?.wallet_credits_balance ?? 0) + options.credits;

  const { error: updateError } = await client
    .from("profiles")
    .update({
      wallet_credits_balance: newBalance,
    })
    .eq("id", options.userId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const { error: insertError } = await client.from("credit_events").insert({
    user_id: options.userId,
    delta: options.credits,
    delta_usd: Math.abs(options.deltaUsd ?? 0),
    balance_after: newBalance,
    reason: "manual_refund",
    reference_type: options.referenceType,
    reference_id: `${options.reason}:${options.referenceId}`,
    metadata: {
      refunded_credits: options.credits,
      refunded_reason: options.reason,
    },
  });

  if (insertError) {
    throw new Error(insertError.message);
  }
}
