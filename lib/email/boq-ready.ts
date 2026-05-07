import { logger } from "@/lib/logger";

function getAppUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "https://boq.aakitech.com"
  ).replace(/\/$/, "");
}

export async function sendBoqReadyEmail(options: {
  email: string;
  boqId: string;
  title: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn("RESEND_API_KEY not set — skipping BOQ ready email", {
      boqId: options.boqId,
      email: options.email,
    });
    return;
  }

  const from = process.env.RESEND_FROM_EMAIL ?? "BOQ Generator <updates@boqgenerator.com>";
  const boqUrl = `${getAppUrl()}/boq/${options.boqId}`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [options.email],
      subject: `Your BOQ is ready — ${options.title}`,
      text: `Your Bill of Quantities for "${options.title}" has been generated and is ready to view.\n\nView your BOQ:\n${boqUrl}\n\nBOQ Generator`,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend API error (${response.status}): ${details}`);
  }
}
