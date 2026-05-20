import { logger } from "@/lib/logger";

const ADMIN_EMAILS = ["brightontandabantu@gmail.com", "software@aakitech.com"];

function getResendConfig() {
  return {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL ?? "BOQ Generator <boq-support@aakitech.com>",
  };
}

async function sendAdminEmail(subject: string, text: string): Promise<void> {
  const { apiKey, from } = getResendConfig();
  if (!apiKey) return;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: ADMIN_EMAILS, subject, text }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend API error (${response.status}): ${details}`);
  }
}

export async function sendAdminLoginAlert(options: {
  email: string;
  userId: string;
}): Promise<void> {
  const { email, userId } = options;
  const timestamp = new Date().toISOString();
  await sendAdminEmail(
    `[BOQ] User login — ${email}`,
    `A user has logged into BOQ Generator.\n\nEmail: ${email}\nUser ID: ${userId}\nTime: ${timestamp}`
  );
}

export async function sendAdminBOQAlert(options: {
  email: string;
  userId: string;
  boqId: string;
  title: string;
  docCount: number;
}): Promise<void> {
  const { email, userId, boqId, title, docCount } = options;
  const timestamp = new Date().toISOString();
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "https://boq.aakitech.com"
  ).replace(/\/$/, "");

  await sendAdminEmail(
    `[BOQ] Generation started — ${email}`,
    `A user has started a BOQ generation.\n\nEmail: ${email}\nUser ID: ${userId}\nBOQ ID: ${boqId}\nTitle: ${title}\nDocuments: ${docCount}\nTime: ${timestamp}\n\nView: ${appUrl}/boq/${boqId}`
  );
}
