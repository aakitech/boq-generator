export const WAITLIST_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WaitlistPayload = {
  email?: string;
  role?: string;
  company?: string;
  source?: string;
};

export type NormalizedWaitlistPayload = {
  email: string;
  role: string | null;
  company: string | null;
  source: string;
};

function normalizeOptionalField(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeWaitlistPayload(
  payload: WaitlistPayload,
): NormalizedWaitlistPayload {
  return {
    email: payload.email?.trim().toLowerCase() ?? "",
    role: normalizeOptionalField(payload.role),
    company: normalizeOptionalField(payload.company),
    source: payload.source?.trim() || "landing_page",
  };
}

export function isValidWaitlistEmail(email: string): boolean {
  return WAITLIST_EMAIL_PATTERN.test(email);
}
