# Rate Filling Clarity Questions

## Purpose
This document captures the questions we need answered by a QS, engineer, or experienced estimator before we turn more BOQ rating behavior into product rules.

The current spike has improved workbook preservation and safe local inheritance, but some remaining blank rows are intentionally ambiguous. We should not keep guessing. These notes should guide the next review session and help decide which rules can be automated safely.

## Current Spike Status
- Original workbook preservation is now good enough to continue testing.
- Obvious `Ditto` inheritance is working for nearby parent rows.
- Weighted steel inheritance is working for some `Kg` / `kg` steel items.
- Remaining blanks are mostly specialist or context-sensitive rows.
- The app should continue leaving genuinely risky rows blank until we understand the real rating practice.

## Key Principle
When in doubt, preserve trust over coverage.

It is better to leave a row blank with a clear reason than to insert a confident-looking but wrong rate.

## Questions For QS / Engineer Review

### 1. Ditto Rows
- When a row says `Ditto`, should it always inherit the nearest previous rate with the same unit?
- If there are multiple prior rows with the same unit, should it inherit from:
  - the immediately previous measured row
  - the nearest previous row in the same section
  - the previous row with the same trade/material
  - another rule?
- When should `Ditto` not inherit?
- Should `Ditto` with a different unit ever inherit from the parent row?
- How should `Ditto` rows behave across section boundaries?

### 2. Steel / Metalwork
- For structural steel measured in `Kg`, when is it acceptable to reuse a nearby `Kg` rate?
- Should RSA, channel, plate, purlin, reinforcement, and grating share rate families, or should they be separate?
- Is the rate for steel reinforcement bars comparable to structural steel members?
- Is a steel item measured in `m`, `m2`, or `No.` ever safe to inherit from a `Kg` steel rate?
- Should doors, windows, frames, louvres, bolts, and grating be treated as separate pricing families?
- What are common rate ranges for:
  - reinforcement steel per kg
  - structural steel per kg
  - steel doors per number
  - steel windows per number
  - steel grating per m2

### 3. Pipework And Fittings
- When can pipe fittings inherit from nearby pipe/fitting rates?
- Should pipe runs, bends, tees, sleeves, traps, gullies, and connectors be separate families?
- Is it safe for a `No.` pipe fitting to inherit from another `No.` item in the same section?
- Should pipe diameter be mandatory for matching?
- Should material type be mandatory for matching, e.g. PVC, uPVC, cast iron, HDPE?
- How should `ditto` pipe rows be handled when the parent row has a different diameter?

### 4. Treatment / Specialist Items
- Should ant-proofing, termite treatment, insecticide treatment, and similar items be priced automatically?
- Are these usually priced per `m2`, per `Item`, or another basis?
- Can they reuse nearby site preparation rates, or do they require their own benchmark table?
- Should these remain manual-review items until we have verified rates?

### 5. Preliminaries
- How should mobilization and demobilization be rated?
- Are they usually:
  - fixed lump sums
  - percentages of construction value
  - based on project duration
  - based on distance/accessibility
  - based on plant/equipment needs?
- Can we infer preliminaries from the existing BOQ total?
- What minimum project metadata is required before pricing preliminaries?

### 6. Summary / Collection Rows
- Should collection summary rows ever be included as measurable rows?
- Rows like `CONCRETE WORKS`, `STRUCTURAL STEEL WORK`, `PAINTING WORKS`, etc. appear in the workbook. Should these always be classified as summary rows and excluded from rating?
- How do we detect summary rows reliably when they have item numbers but no unit or quantity?
- Should the UI show summary rows as preserved but not rateable?

### 7. Amount Formulas
- If the amount cell has a formula like `D74*E74`, should the app only fill the rate and leave the amount formula untouched?
- If the amount cell has no formula, should the app write the amount value?
- If the amount cell has `0` and a formula, should the app leave it as-is and let Excel recalculate?
- Should we force workbook recalculation metadata on export?

### 8. Local Precedent Rules
- How close does a prior rate need to be before it is safe to reuse?
- Does "same bill section" matter more than "same unit"?
- Should we consider row distance, e.g. only previous 5-10 measured rows?
- Should we use median by unit within the same bill as a fallback?
- Should local precedent be blocked when the candidate description has high-value keywords like `door`, `window`, `pump`, `manhole cover`, or `specialist`?

### 9. AI Fallback
- Which row types are safe for AI heuristic pricing when no local precedent exists?
- Which row types should never be AI-priced without a benchmark table?
- Should the AI return a confidence score and skip anything below a threshold?
- Should AI-filled rates be visually marked as lower confidence in the UI/export?
- Should the app show "left blank because..." for skipped rows?

## Ambiguous Rules Discovered In The Spike

### Rule: Explicit Ditto Inheritance
Current approach:
- If the row explicitly contains `Ditto`, use the nearest prior compatible rate in the same bill/context.

Open question:
- Is nearest compatible always correct, or do we need stricter parent detection?

### Rule: Weighted Steel Inheritance
Current approach:
- For steel-family rows measured in `Kg` or `kg`, reuse nearby same-family weighted steel rates in the same bill/context.

Open question:
- Should reinforcement steel and structural steel be separate families?

### Rule: Avoid Broad `No.` Item Inheritance
Current approach:
- Do not let generic `No.` items inherit just because another `No.` row nearby has a rate.

Reason:
- A bolt, door, window, pump, fitting, and manhole cover can all be `No.` but have totally different pricing.

Open question:
- Which `No.` item families are safe to inherit within?

### Rule: Keep Specialist Items Blank
Current approach:
- Treatment services, pipe fittings, steel/metalwork, and specialist rows are gated unless local precedent is strong.

Open question:
- Which of these can be supported by benchmark tables instead of manual review?

### Rule: Preserve Formulas
Current approach:
- The app fills rate cells and leaves existing amount formulas untouched.

Open question:
- Should the export force recalculation, or is preserving the formula enough?

## Data We Should Capture During Testing
- Original row number.
- Bill and section context.
- Item description.
- Unit and quantity.
- Original rate and amount.
- Filled rate and source.
- Whether the rate came from:
  - exact workbook match
  - explicit `Ditto` inheritance
  - weighted steel inheritance
  - AI fallback
  - manual override
- Skip reason for blank rows.
- Confidence score where available.

## Suggested Next Review Session
Use the current `DRIP AND FILTER STATION` workbook and review:
- 10 filled `Ditto` rows.
- 5 filled weighted steel rows.
- 10 still-blank steel/metalwork rows.
- 5 still-blank pipe/fitting rows.
- mobilization and demobilization.
- treatment-service rows.
- summary rows that should not be rateable.

The goal is to decide which rules are safe enough for rollout and which must remain manual-review or benchmark-table items.
