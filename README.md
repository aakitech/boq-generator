# BOQ Generator

AI-powered Bill of Quantities generator for construction projects in Southern Africa (Zambian context). Upload a Scope of Work PDF or rate an existing BOQ Excel, pay once, and receive a structured BOQ you can edit and export.

## Features

- **PDF/DOCX upload & extraction** — drag-and-drop one or more Scope of Work documents; drawings and supporting docs are detected and classified automatically
- **AI-generated BOQ** — Gemini 2.5 Pro extracts line items, quantities, units, and groups them into standard trade bills across a 7-step async pipeline (Inngest)
- **Rate an existing BOQ** — upload an unrated Excel BOQ; AI fills in Zambian market rates calibrated to province, site accessibility, labour source, and margin
- **Rate library** — vector-indexed rate anchors (sourced from real Zambian BOQs) used to ground AI pricing; entries carry `created_at` and `rate_date` for auditability
- **Rate-source traceability** — rated BOQs record the pricing basis used, plus packaged reference documents that were assessed and excluded
- **BOQ comparison API** — compare an AI-rated BOQ against a human-priced BOQ to track coverage and pricing accuracy
- **Retry & recovery** — failed or stuck BOQ generations can be retried; stuck jobs auto-expire after a timeout
- **Dynamic pricing checkout** — generation is priced by BOQ size; existing-BOQ rating is priced by item count
- **Stripe payment gate** — generation priced by BOQ size (ZMW range); rating priced by item count; no account needed to pay
- **Google OAuth auth** — sign in to save and revisit past BOQs
- **BOQ editor** — edit rates in-browser; amounts auto-calculate; changes auto-save
- **AI edit assistant** — natural-language instructions to add/remove/edit BOQ items via streaming assistant
- **Excel export** — download a formatted `.xlsx` in Zambian tender format, or patch your original Excel file with rates added in-place
- **Dashboard** — view and reopen all previously generated BOQs
- **Health check** — `GET /api/health` returns DB connectivity status (for uptime monitors)

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Auth + DB | Supabase (Postgres + Row Level Security) |
| AI | Google Gemini (primary) with OpenAI fallback; workflow-specific model routing |
| Background jobs | Inngest (multi-step async pipeline, beats Vercel's 5-min function limit) |
| Payments | Stripe Checkout |
| Deployment | Vercel |
| Styling | Tailwind CSS |
| Analytics | PostHog |
| Error tracking | Sentry |
| Rate limiting | Upstash Redis |

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd boq-generator
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in every value:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
DATABASE_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres
DATABASE_DIRECT_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres
DATABASE_POOLER_URL=postgresql://postgres.<project>:<password>@<pooler-host>:5432/postgres
SUPABASE_STORAGE_BUCKET=boq-generator-dev

# Stripe
STRIPE_SECRET_KEY=sk_live_...          # or sk_test_... for local dev / preview
STRIPE_WEBHOOK_SECRET=whsec_...        # from Stripe dashboard -> Webhooks

# Gemini (primary AI provider)
GEMINI_API_KEY=<your-google-ai-key>
GEMINI_MODEL_PRIMARY=gemini-2.5-pro
GEMINI_MODEL_FALLBACK=gemini-2.5-flash

# Optional workflow-specific Gemini overrides
# Existing BOQ rating: prefer speed and structured output stability
GEMINI_RATE_MODEL_PRIMARY=gemini-2.5-flash
GEMINI_RATE_MODEL_FALLBACK=gemini-2.5-pro

# SOW generation / extraction: prefer stronger reasoning
GEMINI_SOW_MODEL_PRIMARY=gemini-2.5-pro
GEMINI_SOW_MODEL_FALLBACK=gemini-2.5-flash

# OpenAI (fallback AI provider)
OPENAI_API_KEY=<your-openai-key>

# Inngest (background job orchestration)
# Leave blank in local dev — the app defaults to the local Inngest dev server (port 8288)
INNGEST_EVENT_KEY=<from-inngest-dashboard>
INNGEST_SIGNING_KEY=<from-inngest-dashboard>
# Set INNGEST_DEV=1 to force dev mode even when the above keys are present

# Resend
RESEND_API_KEY=<your-resend-key>

# App URL (no trailing slash)
NEXT_PUBLIC_BASE_URL=https://your-app.vercel.app   # or http://localhost:3000 locally

# PostHog analytics
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com

# Sentry
SENTRY_DSN=https://...@....ingest.sentry.io/...
NEXT_PUBLIC_SENTRY_DSN=<same value as SENTRY_DSN>

# Upstash Redis (optional in local dev)
UPSTASH_REDIS_REST_URL=https://<name>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<token>
```

Local dev notes:
- **Inngest**: if `INNGEST_EVENT_KEY` is absent, the app auto-connects to the local Inngest dev server at `http://localhost:8288`. You must start it separately (see step 5).
- **Upstash**: rate limiting is skipped when Upstash vars are absent.
- **Sentry / PostHog**: server events are suppressed when `NODE_ENV !== "production"`.

### 2.1 Vercel environment matrix

Set the following in `Vercel -> Settings -> Environment Variables`:

| Variable | Development | Preview | Production |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | preview/dev value | preview/dev value | production value |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | preview/dev value | preview/dev value | production value |
| `SUPABASE_SERVICE_ROLE_KEY` | preview/dev value | preview/dev value | production value |
| `DATABASE_URL` | preview/dev value | preview/dev value | production value |
| `DATABASE_DIRECT_URL` | preview/dev value | preview/dev value | production value |
| `DATABASE_POOLER_URL` | preview/dev value | preview/dev value | production value |
| `SUPABASE_STORAGE_BUCKET` | shared preview/dev bucket | shared preview/dev bucket | production bucket |
| `STRIPE_SECRET_KEY` | test key | test key | live key |
| `STRIPE_WEBHOOK_SECRET` | local Stripe CLI secret | preview Stripe test secret | production Stripe webhook secret |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` | preview deployment URL | production domain |
| `GEMINI_API_KEY` | shared value | shared value | shared value or production-only |
| `OPENAI_API_KEY` | shared value | shared value | shared value or production-only |
| `INNGEST_EVENT_KEY` | (leave blank — uses local dev server) | Inngest test/branch key | production Inngest key |
| `INNGEST_SIGNING_KEY` | (leave blank) | Inngest test signing key | production signing key |
| `RESEND_API_KEY` | shared value | shared value | shared value or production-only |
| `NEXT_PUBLIC_POSTHOG_KEY` | shared value | shared value | shared value or production-only |
| `NEXT_PUBLIC_POSTHOG_HOST` | shared value | shared value | shared value |
| `SENTRY_DSN` | shared value | shared value | shared value or production-only |
| `NEXT_PUBLIC_SENTRY_DSN` | shared value | shared value | shared value or production-only |
| `UPSTASH_REDIS_REST_URL` | shared value | shared value | shared value or production-only |
| `UPSTASH_REDIS_REST_TOKEN` | shared value | shared value | shared value or production-only |

### 3. Database migrations

Migrations live in `supabase/migrations/`. Run them in order:

```bash
psql "$DATABASE_URL" -f supabase/migrations/001_initial.sql
psql "$DATABASE_URL" -f supabase/migrations/002_excel_rate_ingestion.sql
psql "$DATABASE_URL" -f supabase/migrations/003_indexes.sql
psql "$DATABASE_URL" -f supabase/migrations/004_dynamic_pricing.sql
psql "$DATABASE_URL" -f supabase/migrations/005_affiliates.sql
psql "$DATABASE_URL" -f supabase/migrations/006_waitlist.sql
psql "$DATABASE_URL" -f supabase/migrations/007_waitlist_schema_fix.sql
psql "$DATABASE_URL" -f supabase/migrations/008_free_boq_credits.sql
psql "$DATABASE_URL" -f supabase/migrations/009_manual_payment_whatsapp.sql
psql "$DATABASE_URL" -f supabase/migrations/010_boq_processing_recovery.sql
psql "$DATABASE_URL" -f supabase/migrations/011_spend_based_credit_wallet.sql
psql "$DATABASE_URL" -f supabase/migrations/012_go_live_credit_updates.sql
psql "$DATABASE_URL" -f supabase/migrations/013_topup_requests.sql
psql "$DATABASE_URL" -f supabase/migrations/014_rate_library_vectors.sql
psql "$DATABASE_URL" -f supabase/migrations/014b_fix_index_and_rpc.sql
psql "$DATABASE_URL" -f supabase/migrations/015_extracted_documents.sql
psql "$DATABASE_URL" -f supabase/migrations/016_rate_library_dates.sql
```

In production, migrations run automatically on first cold-start via `instrumentation.ts` → `lib/db/migrate.ts`.

### 4. Configure Supabase Auth

In your Supabase project:

- Enable Google auth
- Add your Google OAuth client ID and secret
- Add `https://<your-app>.vercel.app/auth/callback` as an authorized redirect URI
- Set Site URL to your app URL
- Add the callback URL to Redirect URLs

### 5. Local development

Start the Next.js dev server:

```bash
npm run dev
```

Start the Inngest dev server (required for BOQ generation — runs background job steps):

```bash
npx inngest-cli@latest dev
```

The Inngest dev server runs at `http://localhost:8288`. Keep both processes running. The app auto-connects to it when `INNGEST_EVENT_KEY` is not set.

For local Stripe testing:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Use the printed `whsec_...` value as `STRIPE_WEBHOOK_SECRET` in `.env.local`.

Open `http://localhost:3000`.

## Deploying to Vercel

1. Push to GitHub and import the repo in [Vercel](https://vercel.com/new)
2. Add all environment variables to Vercel → **Settings → Environment Variables**
3. Set `NEXT_PUBLIC_BASE_URL` to your actual Vercel URL
4. Deploy — migrations run automatically on first cold-start

### Inngest (production)

1. Create a production app at [app.inngest.com](https://app.inngest.com)
2. Copy your **Event Key** and **Signing Key** into Vercel env as `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`
3. In the Inngest dashboard, add your app's serve URL: `https://<your-app>.vercel.app/api/inngest`

### Stripe webhook (production)

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**
2. URL: `https://<your-app>.vercel.app/api/webhooks/stripe`
3. Events to listen for: `checkout.session.completed`
4. Copy the signing secret (`whsec_...`) into Vercel env as `STRIPE_WEBHOOK_SECRET`

### Storage bucket

The app uses `SUPABASE_STORAGE_BUCKET` (default: `boq-generator-dev`) to store uploaded Excel files before rate filling. Create that bucket in Supabase → **Storage** with private access (RLS handled by the service role key).

Recommended names:

- Development + Preview: `boq-generator-dev`
- Production: `boq-generator-prod`

## Project structure

```text
app/
  upload/page.tsx
  dashboard/page.tsx
  login/page.tsx
  api/
    extract/          # PDF/DOCX → text extraction + SOW detection
    checkout/         # Create Stripe Checkout session
    generate/         # Enqueue Inngest BOQ generation job
    rate-boq/         # Gemini rate filling for uploaded Excel BOQs
    compare-boqs/     # Compare baseline vs candidate BOQ pricing accuracy
    ingest-boq/       # Validate + upload Excel BOQ to Storage
    upload-doc/       # Upload supporting documents
    boqs/             # GET list, GET by id, PUT (auto-save)
    boqs/[id]/
      assistant/      # AI edit assistant (streaming + preview modes)
    export/           # Excel export (formatted output)
    export-patched/   # Excel export (patch rates into original file)
    inngest/          # Inngest serve endpoint (handles all background steps)
    health/           # GET /api/health — DB connectivity check
    webhooks/stripe/  # Stripe payment confirmation
    credits/          # Credit wallet
    topup/            # Manual topup requests
    affiliate/        # Affiliate tracking
    waitlist/         # Waitlist signup
  auth/callback/

lib/
  ai.ts             # Gemini + OpenAI provider wrapper, BOQ generation logic
  inngest.ts        # Inngest client + event helpers
  boq-jobs.ts       # Inngest function definitions (7-step generation pipeline)
  rate-matcher.ts   # Vector rate anchor lookup
  excel.ts          # Excel generation
  excel-template.ts # Zambian tender format template
  config.ts
  supabase/
  stripe.ts
  analytics.ts
  logger.ts
  db/

supabase/
  migrations/       # 16 migrations (001–016)
```

## How BOQ generation works

Generation runs as a 7-step Inngest function to avoid Vercel's 5-minute serverless timeout:

1. **extract** — pull text from each uploaded document; classify drawings vs. SOW
2. **structure** — Gemini Pro identifies trade bills and line items from the SOW bundle
3. **save-structure** — persist the structure to DB (avoids Inngest step serialization limits)
4. **fill-rates** — batch rate-fill using vector rate anchors + Gemini; 5 concurrent batches
5. **qa** — deterministic QA pass; flags missing rates, inconsistent units, low-confidence items
6. **save-result** — write the finished BOQ to DB and mark as complete
7. **notify** — send email notification to the user

If a step fails, Inngest retries it automatically. Users can also manually retry from the dashboard.

## Observability

| Tool | What it covers |
|---|---|
| **Sentry** | Unhandled server errors, React error boundaries, edge errors, Session Replay |
| **PostHog** | `boq_generated`, `boq_rated`, `excel_ingested`, `payment_completed` server events + client-side page views |
| **Structured logs** | All API routes emit JSON logs (`lib/logger.ts`) — visible in Vercel log drain |
| **Health check** | `GET /api/health` — returns `{ status, timestamp, db }` for uptime monitors |
| **Rate limiting** | Upstash Redis sliding window: 10 requests / 15 min per IP on AI routes |
| **Inngest dashboard** | Per-step execution traces, retry history, and event logs for every BOQ job |

## Notes on Zambian Rate References

The rate-fill step grounds AI pricing with a vector-indexed library of real Zambian construction rates (sourced from historical BOQs). Each rate entry carries a `rate_date` so the AI can assess temporal relevance. Rates are stored in the `rate_library` table and queried via pgvector similarity search before each Gemini rate-fill call.

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| Tables do not exist | Migrations have not run | Run the SQL files in order or check the migration workflow |
| Auth redirect loop | Supabase redirect URLs are wrong | Add `/auth/callback` in Supabase Auth settings |
| Stripe checkout fails | `STRIPE_SECRET_KEY` is missing | Add the correct key in Vercel |
| BOQ generation never starts | Inngest dev server not running | Run `npx inngest-cli@latest dev` and keep it running |
| BOQ generation fails | `GEMINI_API_KEY` is missing or invalid | Add a valid Gemini key |
| BOQ generation stuck | Inngest cloud not configured in production | Add `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` to Vercel and register the serve URL |
| Sentry not receiving events | DSN is missing | Add `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` |
