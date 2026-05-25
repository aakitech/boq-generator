# BOQ Generator — Project Guidelines

## Start of every session

Before doing anything else:

**What are we working on?** — ask for the GitHub issue number if there is one, or a brief description if exploratory. Read the issue before starting.

If the user's first message makes the task obvious (e.g. "fix the rate-fill step timeout"), skip the question and start.

---

## What this project is

AI-powered Bill of Quantities generator for Zambian construction. Two tracks:

1. **Self-serve SaaS:** QSs upload a Scope of Work (PDF/DOCX), pay with credits, and receive a structured, priced BOQ in ~10 minutes. There's also a "Rate an existing BOQ" flow where users upload an unrated Excel file and AI fills in market rates.

2. **Done-for-you service (experiment, launched May 2026):** Customers email project docs to Brighton. Brighton creates a job in the admin UI (`/admin`), AI generates the BOQ, Brighton reviews and approves, the system emails the customer a finished Excel BOQ directly (no customer account needed). See GitHub issue #101. Phase 2 (method statement, programme of works, prelims, resource schedule) follows if Phase 1 validates demand.

**Primary user:** Innocent — a professional QS in Zambia. His manually-produced BOQs (especially Nakambala) are the style and formatting ground truth for all Excel output.

**Measurement standard:** ASAQS/SMM7 conventions. Net-in-place quantities, British English descriptions, work method + material + location format.

## Team

| Person | Role | GitHub |
|---|---|---|
| Brighton | Tech lead, repo owner | @dev-thandabantu |
| Kundai | Developer | @kundaiclayton |
| Munashe | Developer | @dev-munashe |

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Auth + DB | Supabase (Postgres + RLS) |
| AI | Gemini 2.5 Pro (primary) / Flash (fast ops); OpenAI gpt-4.1 / gpt-4.1-mini as fallback |
| Background jobs | Inngest (8-step async pipeline — beats Vercel's 5-min limit) |
| Payments | Credits wallet (Stripe + WhatsApp manual + MoMo top-ups) |
| Deployment | Vercel |
| Styling | Tailwind CSS |
| Analytics | PostHog |
| Error tracking | Sentry |
| Rate limiting | Upstash Redis |

## Backlog

All open work is tracked as GitHub issues at https://github.com/aakitech/boq-generator/issues

Before starting any task: check if there's a matching open issue. If Brighton gives you a task without an issue number, ask — or create one. Issues are the source of truth for scope, context, and acceptance criteria.

Current open issues as of May 2026: #87 (WinQS research), #88 (SA rate library), #89–90 (partner follow-ups), #91 (BOQ negotiation feature), #92 (Inngest prod URL fix), #93 (API credits top-up), #94–95 (E2E testing), #96 (QS outreach), #101 (done-for-you service tier — active).

## Where to find context

Before starting any task, check the relevant source:

**Wiki (canonical — more current than README):** https://github.com/aakitech/boq-generator/wiki

| Wiki page | When to read it |
|---|---|
| [Architecture Overview](https://github.com/aakitech/boq-generator/wiki/Architecture-Overview) | System layers, data flow, tech stack |
| [Generate BOQ Flow](https://github.com/aakitech/boq-generator/wiki/Generate-BOQ-Flow) | SOW upload → Inngest pipeline → payment → editor |
| [Rate Existing BOQ Flow](https://github.com/aakitech/boq-generator/wiki/Rate-Existing-BOQ-Flow) | Excel upload → rate filling → payment |
| [BOQ Assistant Flow](https://github.com/aakitech/boq-generator/wiki/BOQ-Assistant-Flow) | Conversation memory, proposal mode, credits |
| [Payment & Credits](https://github.com/aakitech/boq-generator/wiki/Payment-and-Credits) | Credit wallet, manual payment, MoMo |
| [AI & Prompt Architecture](https://github.com/aakitech/boq-generator/wiki/AI-and-Prompt-Architecture) | Models, prompts, rate library, ASAQS conventions |
| [Data Model](https://github.com/aakitech/boq-generator/wiki/Data-Model) | BOQDocument, BOQBill, BOQItem, RateContext |
| [Operations & Admin](https://github.com/aakitech/boq-generator/wiki/Operations-and-Admin) | Env vars, background jobs, admin actions, monitoring |

**In-repo:**

- **Visual and design rules:** `DESIGN.md` — read before any UI change
- **Go-live implementation plan:** `docs/go-live-implementation-plan.md`
- **Deferred work and open TODOs:** `TODOS.md`
- **BOQ generation pipeline:** `lib/boq-jobs.ts`
- **AI provider wrapper + generation logic:** `lib/ai.ts`
- **Rate library lookup:** `lib/rate-matcher.ts`
- **Excel output:** `lib/excel.ts`, `lib/excel-template.ts`
- **All API routes:** `app/api/` — includes `app/api/admin/` for service-tier operations
- **DB migrations:** `supabase/migrations/` (017 migrations — always create a new file, never edit existing ones)
- **Admin UI:** `app/admin/` — service job dashboard and intake form; Brighton-only (guarded by `isManualPaymentAdmin`)
- **Structured logging:** `lib/logger.ts`

## Key architectural implications

Things that are non-obvious and must not be forgotten when touching related code:

- **`boqs` table is dual-purpose:** rows with `service_tier = 'done_for_you'` are operator-managed service jobs (owned by Brighton's `user_id`). Rows with `service_tier IS NULL` are self-serve. The dashboard query (`GET /api/boqs`) filters to `.is('service_tier', null)` — never remove this or Brighton's dashboard fills with service jobs.
- **Service jobs bypass the credit gate:** `app/api/admin/service-job/route.ts` uses `createServiceClient()` and inserts directly, skipping `getRemainingCredits`. The credit deduction in `lib/boq-jobs.ts` is fault-tolerant for service jobs (logs warning, continues). Do not introduce a hard credit gate for service jobs.
- **Email routing in `lib/boq-jobs.ts`:** If `service_tier = 'done_for_you'`, completion sends an admin "ready for review" alert — NOT a "BOQ ready" email to Brighton. Self-serve still sends to `user_email`. Always preserve this branch when editing the job completion section.
- **Admin guard:** All `/app/admin/` pages and `/app/api/admin/` routes call `isManualPaymentAdmin(user)` from `lib/auth/manual-payment-admin.ts`. This checks `MANUAL_PAYMENT_APPROVER_EMAILS` env var. If you add a new admin route, this guard is mandatory.
- **`boqs` migrations are numbered and immutable.** Current highest: `017`. Next migration must be `018_*.sql`. Never edit existing migration files.
- **Landing page contact email:** Driven by `NEXT_PUBLIC_CONTACT_EMAIL` env var (Vercel: `software@aakitech.com`). Used in service offer mailto links. If you change the contact mechanism, update `app/page.tsx` and this env var together.
- **Analytics `service_tier` property:** All PostHog events in the generation flow carry `service_tier: 'done_for_you' | null`. Preserve this when adding new `trackEvent` calls so self-serve vs service metrics can be separated in PostHog.
- **The `boq/[id]/page.tsx` admin banner:** Visible when `?admin=1` is in the URL AND `service_tier = 'done_for_you'` AND `service_status = 'pending_review'`. It calls `POST /api/admin/service-job/[id]/deliver`. If you refactor the BOQ page, keep these three conditions intact.

## Current phase

**Pre-launch — Phase 0 go-live fixes.**

The core flows work. The main thing blocking first real users is **BOQ output quality** — generated BOQs need to look and feel like Innocent's real Zambian tender BOQs, not AI output. The Inngest pipeline reliability is the secondary concern if anything fails.

Other open Phase 0 items (in priority order):
1. BOQ output quality — Innocent's Nakambala style as reference; structure + density should vary by project scope
2. Inngest pipeline reliability — if a step is failing or stuck
3. Upload requirements — SOW-only should generate; drawings optional; schedules/specs/test certs not required
4. Credit pricing — starter credit $1.00; BOQ generation $0.50–$0.75; AI assistant deductions
5. Long-running job UX — clearer processing messages; no silent AI assistant failures

When a task maps to one of these, work within that scope. Anything else: check with Brighton first.

## Scope rule

Every task is one of:
- **Launch blocker** — must be done before first live user
- **Launch support** — useful for operating early users; okay to do now
- **Post-launch** — record in `TODOS.md`, don't implement now

If a change doesn't directly improve BOQ quality, QS onboarding, or production reliability: it's post-launch. **This is the most common mistake — don't scope-creep into post-launch work.**

## Rate library

5,000+ entries extracted from Innocent's accepted Zambian BOQs. Stored as pgvector embeddings in Supabase. Vector-matched per item and injected as concrete ZMW anchors before AI pricing. Static JSON fallback (777 entries) used when DB is unavailable.

## Keeping CLAUDE.md current

CLAUDE.md is a living document. Update it in the same PR as any change that affects one of these:

- **New product track or flow** — a new way users or operators interact with the system (e.g. the service tier added May 2026)
- **New architectural constraint** — any non-obvious coupling, bypass, or routing decision that a future code change could silently break
- **New env var** — any new `process.env.*` that affects production behaviour; add it to "Key architectural implications" and `.env.example`
- **New admin capability** — new routes under `app/admin/` or `app/api/admin/`; note the guard used
- **Schema changes** — update the migration count and add a note if the new columns introduce non-obvious behaviour
- **Scope or phase shift** — if "Current phase" or priority list changes
- **New team member or role change**

Do NOT add to CLAUDE.md: implementation details readable from the code, step-by-step how-tos already in the wiki, or summaries of completed work (those go in PRs and issues).

## Design system

Always read `DESIGN.md` before any UI work. Key rules:
- Fonts: Instrument Serif (display headings), Geist (UI/body), Geist Mono (all numbers and amounts)
- Dark surfaces, data-dense, zero decoration — closer to Bloomberg/Linear than to construction software
- All monetary amounts use `font-variant-numeric: tabular-nums` with Geist Mono
- No gradients, no colored icon circles, no decorative elements

## BOQ output style

Innocent's BOQs are the ground truth. Key conventions:
- Structure: PRELIMINARIES → trade bills → SUMMARY
- Each item: item code, description, unit, quantity, rate, amount
- Summary page: per-bill subtotals, Grand Total, Contingencies, VAT
- Excel: Century Gothic font, ZMW amounts, SUM formulas (see `lib/excel-template.ts`)
- Generated BOQs must not look identical across projects — bill structure and item density should vary with project scope

## Shipping flow

1. Branch off `master` — one branch per issue
2. Open a PR when ready
3. Brighton reviews and merges
4. Vercel auto-deploys on merge to `master`

Never push directly to `master`.

### GitHub project linking

When creating a new issue, always add it to the **BOQ Generator** project:

```bash
gh issue edit <number> --add-project "BOQ Generator"
```

All open issues should appear on the project board. If you create an issue without linking it, run the command above immediately after.

## Migrations

Immutable once committed. Always create a new file:

```bash
psql "$DATABASE_URL" -f supabase/migrations/<new>.sql
```

Commit the migration file with the same PR as the schema change.

## Running locally

```bash
npm run dev                      # Next.js (port 3000)
npx inngest-cli@latest dev       # Inngest dev server (port 8288) — required for generation
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

## Testing

```bash
npx vitest run    # Vitest + @testing-library/react unit tests
```

## Observability

| Tool | What it covers |
|---|---|
| Sentry | Server errors, edge errors, React error boundaries |
| PostHog | `boq_generated`, `boq_rated`, `excel_ingested`, `payment_completed` + page views |
| Inngest dashboard | Per-step traces, retry history, event logs for every BOQ job |
| Structured logs | All API routes emit JSON via `lib/logger.ts` |
| Health check | `GET /api/health` — DB connectivity for uptime monitors |

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| BOQ generation never starts locally | Inngest dev server not running | `npx inngest-cli@latest dev` |
| BOQ stuck in production | Inngest not configured | Add `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` to Vercel; register serve URL |
| Tables missing | Migrations haven't run | Run SQL files in order from `supabase/migrations/` |
| Stripe checkout fails | `STRIPE_SECRET_KEY` missing | Add correct key in Vercel |
| Auth redirect loop | Supabase redirect URLs wrong | Add `/auth/callback` in Supabase Auth settings |
