import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { generateBOQJob } from "@/inngest/generate-boq";
import { rateBOQJob } from "@/inngest/rate-boq";

export const runtime = "nodejs";
export const maxDuration = 900;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generateBOQJob, rateBOQJob],
});
