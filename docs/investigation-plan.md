# Core BOQ Reliability & Quality Spike - Investigation Plan

## Purpose
Define a focused, research-first spike to reduce the biggest risks in the paid BOQ workflow: preserving Excel workbooks, making generation/rating resumable, measuring rate quality, and deciding whether drawings/OCR deserve near-term investment.

The spike should end with concrete technical decisions, evidence, and a recommended build sequence.

## Goals
- Choose an Excel manipulation approach that preserves workbook presentation while injecting rates reliably and idempotently.
- Choose an async/resumable job architecture for paid generation and rating workflows.
- Define the minimum tracing model needed to debug failed jobs and support admin recovery.
- Measure LLM-driven rate lookup accuracy and cost per item using real priced BOQ samples where possible.
- Decide whether drawing/OCR quantity extraction is worth near-term implementation or should remain a semi-manual/later-stage feature.

## Scope & Constraints
- Work in current repo; prefer minimal new infra unless benefits justify it.
- Use existing AI stack (Gemini primary, OpenAI fallback) and `lib/gemini-pricing.ts` for cost calculations.
- Prefer solutions that allow incremental rollout and manual opt-in for production workloads.
- Prioritize workflow dependability before expanding automation depth.

## Priority Order
1. Excel preservation and idempotent patching.
2. Async jobs and step-level traces.
3. Rate accuracy benchmark.
4. Drawing/OCR evaluation.

The first pass should focus on items 1 and 2. Items 3 and 4 can run afterward unless extra time remains.

## Experiments (PoCs)

1. Excel library benchmark

Decision: Choose the workbook library/pattern for preserving tender formatting while updating rate cells.

Objective: Find a library/pattern that preserves styles, merges, borders, and formulas when updating rate cells.

Candidates:
- `exceljs`
- `xlsx` (SheetJS community)
- `openpyxl` (Python)
- SheetJS Pro, only if OSS options fail and commercial licensing is acceptable

Test plan:
- Create canonical test workbooks: bold/all-caps headers, merged titles, borders, formulas, and multiple sheets.
- For each library: read -> update rate cells -> write -> compare style/formula/merge preservation and file integrity.
- Measure style preservation, formula integrity, read/write time, and idempotency over repeated writes.

Acceptance:
- At least 95% of key header styles preserved.
- No formula corruption.
- Repeated patching is idempotent.

2. Excel patcher prototype

Decision: Confirm the patch model for safely applying AI-generated rates to original workbooks.

Objective: Implement a patcher that emits a JSON patch and applies only numeric cells without altering styles.

Features:
- Locate rows by `source_anchor` or normalized description.
- Produce a readable patch: sheet, cell, oldValue, newValue, and oldStyle.
- Support preview mode and apply mode.

Acceptance:
- Applying the patch preserves header formatting.
- Applying the same patch twice is a no-op.
- Patch output is understandable enough for debugging and future admin review.

3. Async job architecture PoC

Decision: Choose the orchestration model for resumable paid BOQ work.

Objective: Evaluate job queue options and implement a minimal worker that runs one BOQ workflow off-request.

Options:
- Simple Postgres `boq_jobs` table + polling worker.
- Postgres job library pattern, such as pg-boss style queues.
- BullMQ with Redis.
- Hosted workflow system such as Inngest.

Tests:
- Submit job, process it, and persist result into `boqs`.
- Simulate worker crash and confirm the job resumes or retries.
- Confirm one Stripe session or credit unlock maps to one job/result.

Acceptance:
- Job status survives browser refresh.
- Retry/backoff behavior is demonstrated.
- Duplicate processing is prevented.
- Admin re-run requirements are documented, even if not fully implemented in the PoC.

4. Observability & tracing PoC

Decision: Choose the minimum trace schema needed for job debugging and future admin recovery.

Objective: Record step-level traces and per-step AI usage, including tokens, cost, provider, and model.

Implementation options:
- New `generation_traces` or `boq_job_events` DB table.
- PostHog/Sentry enriched events for supplemental visibility.

Data model example:
- `job_id`
- `step_name`
- `started_at`
- `finished_at`
- `success`
- `message`
- `ai_entries`
- `meta`

Acceptance:
- For any failed job, we can see the failing step, token counts, model used, and retry eligibility.
- Admin UI requirements are captured as a mockup or route sketch.

5. Rate accuracy benchmark

Decision: Decide whether AI-only rate filling is good enough, or whether rate memory, benchmark tables, or human review thresholds are needed.

Objective: Measure LLM rate suggestion accuracy vs ground truth and cost per suggested rate.

Dataset:
- 30-100 items with verified ground-truth rates.
- Prioritize real priced BOQs from `inspo_docs` or historical paid BOQs.
- Synthetic items may be used to test the harness, but not to claim real accuracy.

Metrics:
- Exact match rate.
- Within +/-5% and +/-10%.
- Coverage percentage.
- Cost per item in USD.

Acceptance:
- A clear threshold decision, for example >=70% within +/-10%.
- If threshold is missed, propose mitigation: human review, confidence bands, hybrid lookup, or rate memory.

6. Drawing / OCR evaluation

Decision: Decide whether drawing/OCR should be implemented soon, limited to evidence extraction, or deferred.

Objective: Determine viability of adding OCR/vision to improve counts and evidence extraction.

Options:
- Gemini Vision / multimodal extraction.
- Google Vision or OCR APIs.
- Tesseract local OCR.
- Server-side PDF-to-image + OCR.

Tests:
- Run OCR on 20 sample drawing pages and extract labels/dimensions.
- Feed extracted text into quantity/count heuristics if available.
- Compare quantity recall before and after OCR.

Acceptance:
- Meaningful improvement to quantity extraction, for example >=15% recall lift.
- Or clear evidence that only semi-automatic workflows are viable.
- This remains lower priority than Excel and async reliability unless drawing-based quantity extraction becomes a near-term product promise.

## Deliverables
- `/docs/investigation-plan.md` (this document).
- Benchmark scripts and test workbooks under `/tools/spike/`.
- Excel patcher prototype.
- Small async worker PoC.
- Trace schema migration or schema proposal.
- Admin traces UI mockup or route sketch.
- Spike report summarizing outcomes, decisions, and final recommended path with effort estimates.

## Acceptance Criteria (Spike-level)

## 2.a SOW / BOQ Quality Spike

Decision: Investigate why SOW-driven BOQ generation produces substantially fewer/mechanically different rows than a human QS, and identify interventions to increase completeness and fidelity.

Objective: Measure the gap between current automated BOQ output (from SOW upload) and high-quality QS-produced BOQs, then run targeted experiments to close that gap.

Tests:
- Collect a representative sample of SOWs and the QS-produced BOQs for the same projects (10-30 pairs).
- Run the current SOW->BOQ generator on the same SOWs and compare line counts, coverage by trade, and missing-measurement patterns.
- Instrument the generator to capture intermediate parsing outputs (clauses, extracted quantities, inferred units, and mapping heuristics).
- Run ablation experiments: change individual pipeline components (NL parsing model, chunking strategy, mapping heuristics, entity extraction thresholds) and measure the effect on BOQ line recall.

Metrics:
- BOQ line recall: fraction of QS lines matched by the generator (target lift from ~50% toward >=80%).
- Line precision: fraction of generator lines that map to QS lines (avoid blowup of false positives).
- Coverage by trade: recall per trade (concrete, finishes, mechanical, electrical, etc.).
- Structural completeness: presence of key groups (preliminaries, structural steel, reinforcement, pipework).
- Processing cost and latency per SOW.

Acceptance:
- A clear diagnosis of the main failure modes (examples: missed measured items, failed unit extraction, over-aggregation of related items).
- One or more validated interventions that increase BOQ line recall on the held-out set (for example: improved entity extraction, different chunking, additional parsing prompts, or integration of rule-based heuristics).

Deliverables:
- An experimental report with per-project comparisons and concrete examples of missing items.
- A prioritized list of changes (small/medium/large) that will increase BOQ completeness, with estimated effort.
- If quick wins found: small PRs implementing them (e.g., improved unit extraction, fallback heuristics, or post-processing expansion rules).

- Final: Summarize findings and recommended plan.

## Next Steps
1. Scaffold `/tools/spike/excel-bench/` and add canonical test workbooks.
2. Run `exceljs` vs `xlsx` tests and report results.
3. Build the small Excel patcher prototype and verify idempotency.
4. PoC a Postgres-backed job worker and add trace writes for one sample job.

If we need to compress this into a shorter spike, start with Excel preservation and async/tracing only. Rate accuracy and drawing/OCR should become follow-up spikes rather than competing for the same timebox.

---
Document created by the spike investigation runner.
