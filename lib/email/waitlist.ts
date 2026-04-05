import { logger } from "@/lib/logger";

type SendWaitlistConfirmationParams = {
  email: string;
  role: string | null;
};

function getAppUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "https://boqgenerator.com"
  );
}

export async function sendWaitlistConfirmation({
  email,
  role,
}: SendWaitlistConfirmationParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    logger.warn("RESEND_API_KEY not set - skipping waitlist confirmation", {
      route: "waitlist-email",
      email,
    });
    return;
  }

  const from =
    process.env.RESEND_FROM_EMAIL ??
    "BOQ Generator <updates@boqgenerator.com>";
  const greeting = role
    ? `Thanks for joining the BOQ Generator waitlist as a ${role}.`
    : "Thanks for joining the BOQ Generator waitlist.";
  const appUrl = getAppUrl();

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "You joined the BOQ Generator waitlist",
      text: `${greeting}

We will send launch updates, early access news, and product milestones to this email.

You can follow our progress at ${appUrl}.

BOQ Generator`,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend API error (${response.status}): ${details}`);
  }
}
