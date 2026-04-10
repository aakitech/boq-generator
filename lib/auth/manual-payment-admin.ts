import type { User } from "@supabase/supabase-js";

function getAllowedEmails(): string[] {
  const raw =
    process.env.MANUAL_PAYMENT_APPROVER_EMAILS ??
    process.env.ADMIN_APPROVER_EMAILS ??
    "";

  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isManualPaymentAdmin(user: User | null | undefined): boolean {
  const email = user?.email?.trim().toLowerCase();
  if (!email) return false;
  const allowedEmails = getAllowedEmails();
  return allowedEmails.includes(email);
}

export function getManualPaymentAdminConfig() {
  return {
    allowedEmails: getAllowedEmails(),
  };
}
