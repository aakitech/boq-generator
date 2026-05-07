# Rate Library: ZPPA Integration & Rate Source Strategy

## Context

BOQ Generator targets two distinct procurement environments:

- **Government tenders** — Public procurement under ZPPA rules. Rates are often mandated or benchmarked against ZPPA's published Market Price Index. A contractor submitting at the wrong rate on a government BOQ is a serious problem — this is not just a quality issue, it's a compliance risk.
- **Private/commercial projects** — Developer, corporate, or NGO-funded work. Rates are market-driven, negotiated, and more flexible. Historical project BOQs (e.g. Innocent's files) are the best reference here.

These two environments have different rate expectations, different preliminaries structures, and different conventions. The tool needs to serve both — and ideally know which context it's operating in.

---

## Rate Sources Available

### 1. Historical project BOQs (current `rate-library.json`)
- Source: Real completed BOQs from Innocent and similar QS practitioners
- Coverage: Labour + materials, work items as priced in practice
- Limitation: Small dataset, provenance unclear (some may be government, some private)
- Best for: Labour rates, work item pricing, Zambian construction conventions
- **Action needed:** Get more BOQs from Innocent — specifically government tender BOQs to separate the two pools

### 2. ZPPA Market Price Index (quarterly PDF)
- Source: Zambia Public Procurement Authority — official government procurement body
- Coverage: ~220+ construction materials, Min/Avg/Max across all 10 provinces
- Limitation: **Materials/supply only** — no labour rates
- Best for: Material supply rates on government tenders; authoritative reference
- Update cadence: Quarterly — replace PDF and re-run extraction script
- Current document: `inspo_docs/ZPPA RATES.pdf` (Q1 2026)

### 3. AI estimation (Gemini fallback)
- Used when neither of the above has a match
- Least reliable — general knowledge, not grounded in Zambian project data
- Should be clearly flagged in the UI so users know to scrutinise these rates

---

## Rate Tagging in the UI

Every rate in the generated BOQ should show its source in the browser UI (but **not** in the downloaded Excel — the export should look clean and professional):

| Tag | Meaning |
|-----|---------|
| `ZPPA Q1 2026` | Rate from ZPPA Market Price Index, province-specific |
| `Historical` | Matched from real project BOQ data |
| `AI estimate` | No library match — Gemini estimation only |

This helps the QS know immediately which rates to trust and which to verify before submission.

---

## The Rate Provenance Problem

The current `rate-library.json` is a mixed pool — some entries likely come from government tender BOQs, some from private commercial projects. This matters because:

- Government tender rates are benchmarked against ZPPA and procurement rules
- Private project rates reflect negotiated market pricing, which can differ significantly
- Using a private project rate as a reference for a government tender (or vice versa) could mislead the user

**Longer term:** The rate library should be tagged by project type (government / private / NGO) so the matcher can weight sources appropriately based on the user's selected context.

---

## Recommended Priority Order

### Now (next sprint)
1. **Implement Options 1 + 2 from the rate matcher improvements** — lower threshold to pass weak matches, add unit-based floor/ceiling anchors. Low effort, immediate improvement for all users.

### Soon (before government tender users onboard at scale)
2. **Extract ZPPA data into structured JSON** — parse `inspo_docs/ZPPA RATES.pdf` pages 10–15 using an adapted version of `tools/extract-rate-library.cjs`. Commit as `lib/zppa-rate-library.json`.
3. **Integrate ZPPA into rate matcher** — query alongside existing library, label source, use province-specific Avg rate based on user's province selection.
4. **Add rate source tags to BOQ UI** — show `ZPPA`, `Historical`, or `AI estimate` badge on each rate in the browser. Hide from Excel export.

### Later
5. **Tag historical BOQ entries by project type** — government vs private. Requires going back through source BOQs with Innocent to classify.
6. **Separate rate pools for government vs private context** — let user declare "this is a government tender" at upload time, weight sources accordingly.
7. **Quarterly ZPPA refresh process** — replace PDF, re-run extraction, commit updated JSON. Document the process so it can be done without developer involvement.
8. **Labour rate expansion** — ZPPA covers materials only. Labour rates still depend on historical BOQs. More government project BOQs from Innocent would directly improve this.

---

## Implementation Notes (when ready)

### Extraction script
Adapt `tools/extract-rate-library.cjs`. Output format per entry:
```json
{
  "zppa_code": "3011160101",
  "description": "Building Sand",
  "unit": "Ton",
  "source": "ZPPA Q1 2026",
  "province_rates": {
    "lusaka": { "min": 280, "avg": 350, "max": 420 },
    "copperbelt": { "min": 260, "avg": 310, "max": 380 },
    ...
  }
}
```

### Rate matcher changes (`lib/rate-matcher.ts`)
- Accept optional `province` and `project_type` params
- Query both `rate-library.json` and `zppa-rate-library.json`
- Return source label alongside each anchor
- Pass province-specific avg from ZPPA when province is known

### UI display (`app/boq/[id]/page.tsx`)
- Add small source badge next to each rate cell in the browser table
- Style: `ZPPA` → blue, `Historical` → amber, `AI estimate` → grey
- Tooltip with full source detail on hover
- Source tags stripped from Excel export template

---

## Related files
- `inspo_docs/ZPPA RATES.pdf` — Q1 2026 source document
- `lib/rate-library.json` — current historical rate library
- `lib/rate-matcher.ts` — fuzzy matching logic
- `tools/extract-rate-library.cjs` — existing extraction tooling to adapt
