import type { SupabaseClient } from "@supabase/supabase-js";

export const STARTER_FREE_BOQ_CREDITS = 8;

export type CreditConsumptionReason = "generate_boq" | "rate_boq";

type CreditStatus = "consumed" | "already_consumed" | "insufficient";

type ConsumeFreeBoqCreditResult = {
  status: CreditStatus;
  remainingCredits: number;
};

export async function getRemainingCredits(
  client: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data, error } = await client
    .from("profiles")
    .select("free_boq_credits_balance")
    .eq("id", userId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data?.free_boq_credits_balance ?? 0;
}

export async function consumeFreeBoqCredit(
  client: SupabaseClient,
  options: {
    userId: string;
    reason: CreditConsumptionReason;
    referenceType: string;
    referenceId: string;
  },
): Promise<ConsumeFreeBoqCreditResult> {
  const { data, error } = await client.rpc("consume_free_boq_credit", {
    p_user_id: options.userId,
    p_reason: options.reason,
    p_reference_type: options.referenceType,
    p_reference_id: options.referenceId,
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

export async function refundFreeBoqCredit(
  client: SupabaseClient,
  options: {
    userId: string;
    reason: CreditConsumptionReason;
    referenceType: string;
    referenceId: string;
  },
): Promise<void> {
  const { data: current, error: currentError } = await client
    .from("profiles")
    .select("free_boq_credits_balance")
    .eq("id", options.userId)
    .single();

  if (currentError) {
    throw new Error(currentError.message);
  }

  const { error: updateError } = await client
    .from("profiles")
    .update({
      free_boq_credits_balance: (current?.free_boq_credits_balance ?? 0) + 1,
    })
    .eq("id", options.userId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const { error: insertError } = await client.from("credit_events").insert({
    user_id: options.userId,
    delta: 1,
    reason: "manual_refund",
    reference_type: options.referenceType,
    reference_id: `${options.reason}:${options.referenceId}`,
  });

  if (insertError) {
    throw new Error(insertError.message);
  }
}
