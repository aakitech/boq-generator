import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Lazy-initialise rate limiter only when Upstash env vars are present.
// Falls back gracefully in local dev (no Upstash required).
let _ratelimit: Ratelimit | null = null;
function getRatelimit(): Ratelimit | null {
  if (_ratelimit) return _ratelimit;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _ratelimit = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(10, "15 m"),
    analytics: false,
  });
  return _ratelimit;
}

const RATE_LIMITED_ROUTES = [
  "/api/generate",
  "/api/rate-boq",
  "/api/ingest-boq",
  "/api/extract",
];

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Capture referral code from ?ref= query param and persist in a 30-day cookie.
  // First-click wins: don't overwrite an existing ref_code cookie.
  const refCode = request.nextUrl.searchParams.get("ref");
  if (refCode && !request.cookies.has("ref_code") && /^[a-zA-Z0-9]{4,20}$/.test(refCode)) {
    supabaseResponse.cookies.set("ref_code", refCode, {
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "lax",
      httpOnly: false,
    });
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session (required for SSR)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Always allow: landing page, auth pages, policy pages, webhooks, Sentry tunnel, health check
  if (
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/terms") ||
    pathname.startsWith("/contact") ||
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/monitoring")
  ) {
    return supabaseResponse;
  }

  // Rate limit AI-heavy routes
  if (RATE_LIMITED_ROUTES.some((r) => pathname.startsWith(r))) {
    const rl = getRatelimit();
    if (rl) {
      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
        "unknown";
      const { success } = await rl.limit(ip);
      if (!success) {
        return NextResponse.json(
          { error: "Too many requests. Please wait a moment before trying again." },
          { status: 429 }
        );
      }
    }
  }

  // Require auth for everything else
  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm|ogg)$).*)",
  ],
};
