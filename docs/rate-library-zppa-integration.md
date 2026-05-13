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
- **Incoming:** Innocent will share at least 8 BOQs from won tenders — these will expand the library significantly. He will also share a costing sheet suitable for rating commercial BOQs (received via email 11 May 2026, attachment: "PRICED ZS P9-D10 WS CME...").

### 2. ZPPA Market Price Index (quarterly PDF)
- Source: Zambia Public Procurement Authority — official government procurement body
- Coverage: ~220+ construction materials, Min/Avg/Max across all 10 provinces
- Limitation: **Materials/supply only** — no labour rates
- Best for: Material supply rates on government tenders; authoritative reference
- Update cadence: Quarterly — replace PDF and re-run extraction script
- Current document: `inspo_docs/ZPPA RATES.pdf` (Q1 2026); Q2 2026 MPI in `inspo_docs/Q2 2026 MPI_Trends.pdf`
- Government pool: Innocent to acquire government-type BOQs from Mr Banda; he already has 4 to share

### 3. AI estimation (Gemini fallback)
- Used when neither of the above has a match
- Least reliable — general knowledge, not grounded in Zambian project data
- Source provenance is internal only — not surfaced to users (see decision below)

---

## Rate Source Tagging — Decision

**Source tags (`ZPPA`, `Historical`, `AI estimate`) will NOT be shown in the user-facing UI.**

Rationale: Users don't know about the rate library internals and the tags would be confusing rather than helpful. Source provenance is most valuable internally — for QA, debugging rate quality, and future admin tooling.

**Where tags will be used:**
- Internally in the rate matcher and job logs (already tracked via source field in the JSON)
- Future admin dashboard — surface per-rate source breakdown, flag AI-estimated rates for review, track library coverage over time

---

## The Rate Provenance Problem

The current `rate-library.json` is a mixed pool — some entries likely come from government tender BOQs, some from private commercial projects. This matters because:

- Government tender rates are benchmarked against ZPPA and procurement rules
- Private project rates reflect negotiated market pricing, which can differ significantly
- Using a private project rate as a reference for a government tender (or vice versa) could mislead the user

**Decision:** Separate rate pools by project type (government / private / commercial) is the right direction. Needs scoping — see roadmap item 6 below.

---

## Project Type Context at Generation Time

The user should declare project type upfront ("government tender" vs "commercial/private"). This drives:
- Which rate pool(s) to query
- Preliminaries conventions
- Potentially compliance warnings for government submissions

Innocent confirmed this split is meaningful in practice. He is acquiring government-type BOQs from Mr Banda (4 already available) to populate the government pool.

---

## File Format Support

Current scope: **PDF only** (continue with this for now).

Brighton to investigate ingestion of DXF/DWG/IFC/TXT files in a future spike — not blocking current work.

---

## Recommended Priority Order

### Now (next sprint)
1. **Implement Options 1 + 2 from the rate matcher improvements** — lower threshold to pass weak matches, add unit-based floor/ceiling anchors. Low effort, immediate improvement for all users.

### Soon (before government tender users onboard at scale)
2. **Ingest Innocent's incoming BOQs** — at least 8 won-tender BOQs + costing sheet. Run through `tools/extract-rate-library.cjs`, tag each entry by project type (government / commercial) based on source. This directly expands both rate pools.
3. **Extract ZPPA data into structured JSON** — parse `inspo_docs/ZPPA RATES.pdf` pages 10–15 using an adapted version of `tools/extract-rate-library.cjs`. Commit as `lib/zppa-rate-library.json`.
4. **Integrate ZPPA into rate matcher** — query alongside existing library, use province-specific Avg rate based on user's province selection. Source label tracked internally, not shown in UI.

### Later (needs scoping)
5. **Separate rate pools for government vs private context** — let user declare project type at upload time; weight rate sources accordingly. Needs design work — how does the UI collect this context cleanly?
6. **Tag historical BOQ entries by project type** — government vs private. Requires going back through source BOQs with Innocent to classify. Will happen naturally as new tagged BOQs come in.
7. **Quarterly ZPPA refresh process** — replace PDF, re-run extraction, commit updated JSON. Document the process so it can be done without developer involvement.
8. **Labour rate expansion** — ZPPA covers materials only. Labour rates still depend on historical BOQs. More government project BOQs from Innocent will directly improve this.
9. **Admin dashboard** — surface rate source breakdown, flag AI-estimated rates, track library coverage. This is where internal source tagging becomes visible.

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
  "project_type": "government",
  "province_rates": {
    "lusaka": { "min": 280, "avg": 350, "max": 420 },
    "copperbelt": { "min": 260, "avg": 310, "max": 380 }
  }
}
```

### Rate matcher changes (`lib/rate-matcher.ts`)
- Accept optional `province` and `project_type` params
- Query both `rate-library.json` and `zppa-rate-library.json`
- Return source label alongside each anchor (internal use only — not passed to UI)
- Pass province-specific avg from ZPPA when province is known

---

## Related files
- `inspo_docs/ZPPA RATES.pdf` — Q1 2026 source document
- `inspo_docs/Q2 2026 MPI_Trends.pdf` — Q2 2026 MPI trends reference
- `lib/rate-library.json` — current historical rate library
- `lib/rate-matcher.ts` — fuzzy matching logic
- `tools/extract-rate-library.cjs` — existing extraction tooling to adapt
