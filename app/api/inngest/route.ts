import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { generateBOQJob } from "@/inngest/generate-boq";
import { rateBOQJob } from "@/inngest/rate-boq";

export const runtime = "nodejs";
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generateBOQJob, rateBOQJob],
  serveHost: process.env.INNGEST_BASE_URL,
});
