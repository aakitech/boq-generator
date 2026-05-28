import { PostHog } from "posthog-node";

let _client: PostHog | null = null;

function getClient(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  if (!_client) {
    _client = new PostHog(key, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return _client;
}

/**
 * Identify a user server-side. Call once per session entry point (e.g. auth callback).
 * Fire-and-forget — never await this.
 */
export function identifyUser(
  distinctId: string,
  properties: Record<string, unknown>
): void {
  const client = getClient();
  if (!client) return;
  try {
    client.identify({ distinctId, properties });
  } catch {
    // never let analytics failures affect the response
  }
}

/**
 * Fire a server-side PostHog event. Fire-and-forget — never await this.
 * Falls back silently if PostHog is not configured.
 */
export function trackEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): void {
  const client = getClient();
  if (!client) return;
  try {
    client.capture({ distinctId, event, properties });
  } catch {
    // Never let analytics failures affect the response
  }
}
