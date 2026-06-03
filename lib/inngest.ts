import { Inngest } from "inngest";

const INNGEST_DEV_SERVER_URL = "http://localhost:8288";

function hasConfiguredEnvValue(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !(trimmed.startsWith("<") && trimmed.endsWith(">"));
}

const hasExplicitDevMode = process.env.INNGEST_DEV !== undefined;
const hasCloudOrCustomEventTarget = Boolean(
  hasConfiguredEnvValue(process.env.INNGEST_EVENT_KEY) ||
    hasConfiguredEnvValue(process.env.INNGEST_API_BASE_URL) ||
    hasConfiguredEnvValue(process.env.INNGEST_EVENT_API_BASE_URL)
);

const shouldDefaultToLocalDevServer =
  process.env.NODE_ENV !== "production" &&
  !hasExplicitDevMode &&
  !hasCloudOrCustomEventTarget;

export const inngest = new Inngest({
  id: "boq-generator",
  isDev: shouldDefaultToLocalDevServer ? true : undefined,
});

type InngestSendPayload = Parameters<typeof inngest.send>[0];

export class InngestEnqueueError extends Error {
  constructor(message: string, readonly originalError: unknown) {
    super(message);
    this.name = "InngestEnqueueError";
  }
}

function getErrorDetails(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const cause = "cause" in error && error.cause ? `; cause: ${String(error.cause)}` : "";
  return `${error.message}${cause}`;
}

function getEnqueueFailureMessage(error: unknown): string {
  const details = getErrorDetails(error);
  const isNetworkFailure = details.toLowerCase().includes("fetch failed");

  if (inngest.mode === "dev" && isNetworkFailure) {
    return `Could not reach the local Inngest dev server at ${INNGEST_DEV_SERVER_URL}. Start it and keep it running while Next.js is running, or configure INNGEST_EVENT_KEY/INNGEST_SIGNING_KEY to use Inngest Cloud. Original error: ${details}`;
  }

  if (inngest.mode === "cloud" && isNetworkFailure) {
    return `Could not reach the Inngest event API. Check network access and INNGEST_EVENT_KEY/INNGEST_EVENT_API_BASE_URL. Original error: ${details}`;
  }

  return details;
}

export async function sendInngestEvent(payload: InngestSendPayload) {
  try {
    return await inngest.send(payload);
  } catch (error) {
    throw new InngestEnqueueError(getEnqueueFailureMessage(error), error);
  }
}
