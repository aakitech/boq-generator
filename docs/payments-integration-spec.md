# Payments Integration Spec

**Status:** Pre-product. Waitlist landing page is live while this is unblocked.  
**Last updated:** 2026-04-08  
**Goal:** Take first paid transaction from a Zambian professional.

---

## Corrections from v1 of this spec

- **PayChangu is a Malawi gateway, not Zambia.** Previous recommendation was wrong.
- **Flutterwave is not viable** — confirmed by team: they gate access on $5M+ revenue / registered business. We are pre-revenue and unregistered.
- **Stripe does not support Zambia** for merchant accounts. Zambia is not in Stripe's 46 supported countries. We can still charge global (non-Zambian) users via Stripe but cannot onboard as a Zambian merchant.

---

## What Zambian Customers Actually Use

This matters more than assumptions. Data from World Bank, ZICTA, Bank of Zambia:

| Payment Method | Reality |
|---|---|
| **Mobile money (Airtel Money, MTN MoMo)** | Dominant. 58.5% of adults using by 2020, grew fast since. K452 billion in transactions in 2023 (+50% YoY). Airtel has 47.9% mobile market share, MTN 31.6%. |
| **Debit cards** | Minority. Only ~20.7% of adults have formal bank accounts — debit cards exist but not widespread. |
| **Credit cards** | Negligible. 2.03% of population aged 15+ (2021 World Bank data). Down from 4.27% in 2017. |
| **USD** | Unlikely for domestic professionals unless they have international exposure. ZMW is the practical currency. |

**Implication for this app:** The spec previously said "card first, mobile money next" — this is likely inverted for Zambia. Even among professionals (QS, contractors, consultants), mobile money is the realistic primary method. Cards are secondary. If we don't support mobile money, we don't have a Zambia payment option.

---

## Audience Tiers

| Priority | Segment | Payment Reality |
|---|---|---|
| 1 | Zambian professionals | Mobile money first (Airtel Money, MTN MoMo), debit cards second |
| 2 | Southern Africa (ZA, ZW, MZ, BW, NA) | Cards more viable (ZAR Visa/MC), MTN MoMo ZA growing |
| 3 | Global | Stripe (already live, only viable for non-Zambian users) |

---

## Viable Gateways for Zambia

### Option A — ZynlePay (Zambia-indigenous)

**[zynlepay.com](https://zynlepay.com)** — built in Zambia, Bank of Zambia designated.

- Supports: Airtel Money, MTN MoMo + Visa/Mastercard/Maestro/AmEx
- Works for individuals and organisations (virtual account option — no bank account required)
- Onboarding: verification process, then account activated
- Fees: K3,500 (~$125) one-time setup fee + 3–5% per transaction depending on volume
- Has a PHP SDK; REST API available — [ZynlePay API docs](https://www.zynlepay.com/cms/content/about-us)
- **Risk:** smaller, less battle-tested documentation; support quality unknown

### Option B — Pesapal (East/Southern Africa, BoZ licensed in Zambia)

**[pesapal.com/zm](https://www.pesapal.com/zm/business)** — operates in Zambia via Sabipay Technologies, Bank of Zambia licensed.

- Supports: mobile money + cards
- Accepts sole proprietors (requires more documentation than registered companies, but not blocked)
- Has a proper REST API — [Pesapal API docs](https://www.pesapal.com/zm/business/online/api-plugins)
- Used by established Zambian businesses (hotels, retail, SMEs)
- Onboarding: sign merchant agreement, submit KYC docs, verify business nature
- **Risk:** unclear if they onboard pre-registered startups — needs a direct inquiry to [email protected]

### Option C — DPO Group / Network International (Pan-African)

**[dpogroup.com](https://dpogroup.com/online-payments/zambia/)** — in Zambia since 2008, recently rebranded to Network International.

- Pan-African platform covering 50+ African countries
- No setup fee for new merchants (confirmed on their FAQ)
- Supports cards + mobile money across the region
- More enterprise-oriented; onboarding may be slower
- **Risk:** may require business registration; not confirmed for pre-incorporation startups

---

## Recommendation

**Start with Pesapal or ZynlePay — in that order of preference.**

1. **Email Pesapal first** ([email protected]) — ask directly: "Can an unregistered individual / sole trader integrate and go live?" If yes, use Pesapal. They are BoZ-licensed, more established, and have a cleaner API. Their requirement is KYC docs (national ID, proof of business activity) — not necessarily formal company registration.

2. **If Pesapal says no, use ZynlePay** — they explicitly support individual virtual accounts. The K3,500 setup fee is a one-time cost. At $20–$100 per transaction, this is recovered quickly.

3. **Keep Stripe active** for global users who land on the app organically. Do not remove it.

4. **Hold DPO/Network for Southern Africa expansion** — once registered as a business and handling Tier 2 users.

---

## Currency: Charge in ZMW

Current tiers are USD-denominated in `lib/pricing.ts`. For Zambia:

- ZMW/USD rate is ~28 ZMW per USD (volatile)
- Zambian mobile money apps denominate in ZMW — users will see a ZMW amount
- Charging in USD via Zambian gateways adds unnecessary FX friction

Indicative ZMW tiers (at 28 ZMW/USD):

| Tier | BOQ Value | USD | ZMW (approx) |
|---|---|---|---|
| Starter | < ZMW 100K | $20 | ZMW 560 |
| Small | ZMW 100K – 1M | $50 | ZMW 1,400 |
| Medium | ZMW 1M – 10M | $100 | ZMW 2,800 |
| Large | ZMW 10M – 50M | $200 | ZMW 5,600 |
| Major | > ZMW 50M | $500 | ZMW 14,000 |

These are reasonable for a professional tool in Zambia. A QS billing a ZMW 10M project and paying ZMW 2,800 (~$100) for AI-generated BOQ is a strong value proposition.

**Decision needed:** hardcode exchange rate in `.env` (simple, manually updated) vs. live rate feed. Recommend hardcoded rate to start — update quarterly.

---

## Integration Architecture

```
/api/checkout (existing)
  ├─ provider === "stripe"     → existing Stripe session (global users)
  ├─ provider === "pesapal"    → new Pesapal session (ZM + Southern Africa)
  └─ provider === "zynlepay"   → new ZynlePay session (ZM fallback)

/api/webhooks/stripe           → existing (paid → unlock generation)
/api/webhooks/pesapal          → new (same: paid → unlock generation)
/api/webhooks/zynlepay         → new (same: paid → unlock generation)
```

All webhooks write to the same `boqs.payment_status = 'paid'` path — no changes to downstream generation logic.

**Relevant existing files:**

| File | Purpose |
|---|---|
| [`app/api/checkout/route.ts`](../app/api/checkout/route.ts) | Current Stripe checkout handler — extend this with provider branching |
| [`lib/pricing.ts`](../lib/pricing.ts) | Pricing tiers (ZMW thresholds → USD cents) — add ZMW conversion here |
| [`lib/stripe.ts`](../lib/stripe.ts) | Stripe client — model new gateway clients on this pattern |
| [`app/api/webhooks/`](../app/api/webhooks/) | Existing webhook handlers — add `pesapal/route.ts` or `zynlepay/route.ts` here |

---

## MVP Scope (Zambia only)

**Pre-code actions (do these first):**
1. Contact Pesapal Zambia — confirm unregistered sole trader can onboard
2. If yes: create Pesapal merchant account, get API keys
3. If no: sign up for ZynlePay, pay K3,500 setup, get API keys

**Code changes:**
1. `lib/pesapal.ts` (or `lib/zynlepay.ts`) — thin client: create payment session, verify webhook signature
2. `/api/checkout` — add `provider` param, branch to chosen gateway when `provider === "zm"`
3. `/api/webhooks/[provider]` — verify signature, set `payment_status = 'paid'`, trigger generation
4. Checkout UI — show "Pay with Mobile Money / Card" button (replaces or sits alongside Stripe for ZM users)
5. ZMW display on the pricing/unlock screen — show ZMW equivalent next to USD

**Out of scope for MVP:** Southern Africa gateway, multi-currency accounting, currency auto-detection.

---

## Open Questions

1. **Pesapal vs ZynlePay** — depends entirely on whether Pesapal accepts unregistered sole traders. One email resolves this.
2. **KYC docs for unregistered business** — national ID + description of the service should be sufficient for sole trader KYC in Zambia.
3. **Refund policy** — no refunds once generation starts. State this at checkout.
4. **Transaction fees** — ZynlePay is 3–5%; Pesapal fees not public. Factor into pricing or absorb at current volumes.
5. **Waitlist-to-paid conversion** — when payments go live, email waitlist. `lib/email/waitlist.ts` already has the infrastructure.

---

## What's Already Done

- Stripe checkout + webhook fully wired — [`app/api/checkout/route.ts`](../app/api/checkout/route.ts), [`lib/stripe.ts`](../lib/stripe.ts)
- Pricing tiers with ZMW-based tier selection — [`lib/pricing.ts`](../lib/pricing.ts)
- BOQ `payment_status` field and unlock flow complete — [`app/api/unlock-boq/route.ts`](../app/api/unlock-boq/route.ts)
- Waitlist email infrastructure ready for launch announcement — [`lib/email/waitlist.ts`](../lib/email/waitlist.ts)
