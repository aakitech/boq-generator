import { logger } from "@/lib/logger";

function getAppUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "https://boq.aakitech.com"
  ).replace(/\/$/, "");
}

function buildDashboardLink() {
  return `${getAppUrl()}/dashboard`;
}

export async function sendManualPaymentApprovedEmail(options: {
  email: string;
  boqId: string;
  title: string;
  sourceExcelKey?: string | null;
  processingStatus?: string | null;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn("RESEND_API_KEY not set - skipping manual payment approval email", {
      route: "manual-payment-approved-email",
      boqId: options.boqId,
      email: options.email,
    });
    return;
  }

  const from =
    process.env.RESEND_FROM_EMAIL ??
    "BOQ Generator <boq-support@aakitech.com>";
  const continueUrl = buildDashboardLink();
  const subject = "Your BOQ payment was confirmed";
  const text = `Your payment has been confirmed for "${options.title}".

You can now continue from your dashboard:
${continueUrl}

Yours,
BOQ Team`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [options.email],
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend API error (${response.status}): ${details}`);
  }
}
