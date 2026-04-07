import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { trackEvent } from "@/lib/analytics";
import { logger } from "@/lib/logger";
import {
  isValidWaitlistEmail,
  normalizeWaitlistPayload,
  type WaitlistPayload,
} from "@/lib/waitlist";
import { sendWaitlistConfirmation } from "@/lib/email/waitlist";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as WaitlistPayload;
    const { email, role, company, source } = normalizeWaitlistPayload(body);

    if (!email) {
      return NextResponse.json(
        { ok: false, error: "Email is required" },
        { status: 400 },
      );
    }

    if (!isValidWaitlistEmail(email)) {
      return NextResponse.json(
        { ok: false, error: "A valid email address is required" },
        { status: 400 },
      );
    }

    const serviceClient = createServiceClient();
    const { data, error } = await serviceClient
      .from("waitlist_signups")
      .insert({
        email,
        role,
        company,
        source,
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({
          ok: true,
          status: "existing",
          message: "You're already on the waitlist. We'll be in touch soon.",
        });
      }

      logger.error("waitlist signup insert failed", {
        error: error.message,
        route: "waitlist",
        email,
      });

      return NextResponse.json(
        { ok: false, error: "Could not join the waitlist right now" },
        { status: 500 },
      );
    }

    trackEvent(`waitlist:${email}`, "waitlist_joined", {
      source,
      role,
      company,
      signupId: data.id,
    });

    try {
      await sendWaitlistConfirmation({ email, role });
    } catch (mailError) {
      logger.error("waitlist confirmation email failed", {
        error: mailError instanceof Error ? mailError.message : String(mailError),
        route: "waitlist",
        email,
      });
    }

    return NextResponse.json({
      ok: true,
      status: "created",
      message: "You're on the waitlist. We'll send launch updates to your inbox.",
    });
  } catch (err) {
    logger.error("waitlist signup error", {
      error: err instanceof Error ? err.message : String(err),
      route: "waitlist",
    });

    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
