import { logger } from "@/lib/logger";

function getResendConfig() {
  return {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL ?? "BOQ Generator <boq-support@aakitech.com>",
  };
}

export async function sendServiceDeliveryEmail(options: {
  customerEmail: string;
  title: string;
  boqId: string;
  excelBuffer: Buffer;
}): Promise<void> {
  const { apiKey, from } = getResendConfig();

  if (!apiKey) {
    logger.warn("RESEND_API_KEY not set — skipping service delivery email", {
      boqId: options.boqId,
      customerEmail: options.customerEmail,
    });
    return;
  }

  const safeTitle = options.title.replace(/[^\w\s]/g, "").replace(/\s+/g, "_").slice(0, 50);
  const filename = `BOQ_${safeTitle}.xlsx`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [options.customerEmail],
      subject: `Your Bill of Quantities is ready — ${options.title}`,
      text: [
        `Dear Client,`,
        ``,
        `Your Bill of Quantities for "${options.title}" has been prepared and is attached to this email as an Excel file.`,
        ``,
        `Please review it carefully. If you have any questions or need adjustments, reply to this email and we will assist you.`,
        ``,
        `BOQ Generator`,
        `aakitech.com`,
      ].join("\n"),
      attachments: [
        {
          filename,
          content: options.excelBuffer.toString("base64"),
        },
      ],
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend API error (${response.status}): ${details}`);
  }
}
