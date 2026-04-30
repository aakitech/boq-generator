# BOQ Generation Spike — Investigation Plan

## Purpose
Define a focused, research-first spike to evaluate options for improving BOQ generation quality, Excel handling, async processing, rate accuracy, drawings extraction (OCR/vision), and observability/admin recovery. This plan outlines experiments, deliverables, acceptance criteria, and a recommended next step sequence.

## Goals
- Determine an Excel manipulation approach that preserves workbook presentation while injecting rates reliably and idempotently.
- Design an async/resumable job architecture for generation with admin re-run and failure recovery.
- Measure LLM-driven rate lookup accuracy and cost per item; propose mitigation strategies.
- Evaluate drawing/OCR approaches and their ROI for quantity extraction.
- Add step-level traces and observability to enable debugging and admin recovery.

## Scope & Constraints
- Work in current repo; prefer minimal new infra unless benefits justify it.
- Use existing AI stack (Gemini primary, OpenAI fallback) and `lib/gemini-pricing.ts` for cost calculations.
- Prefer solutions that allow incremental rollout and manual opt-in for production workloads.

## Experiments (PoCs)

1) Excel library benchmark
- Objective: Find library/pattern that preserves styles, merges, borders, formulas when updating rate cells.
- Candidates: `exceljs`, `xlsx` (SheetJS community), `openpyxl` (Python) and consider SheetJS Pro (commercial) if OSS fails.
- Test plan:
  - Create canonical test workbooks: header with bold/all-caps, merged title, borders, formulas, multiple sheets.
  - For each lib: read -> update rate cells -> write -> compare style/formula/merge preservation and file integrity.
  - Metrics: percentage of preserved style attributes, formula integrity, time per RW, idempotency over repeated writes.
- Acceptance: >=95% header styles preserved, no formula corruption, idempotent patching.

2) Excel patcher prototype (idempotent)
- Objective: implement a patcher that emits a JSON patch and applies only numeric cells without altering styles.
- Features:
  - Locate rows by `source_anchor` or normalized description.
  - Produce readable patch: sheet, cell, oldValue, newValue, oldStyle.
  - Preview mode (no-write) and apply mode.
- Acceptance: applying patch preserves header formatting; applying twice is a no-op.

3) Async job architecture PoC
- Objective: evaluate job queue options and implement minimal worker to run `generateBOQ()` off-request.
- Options: Postgres-job-table (pg-boss style), simple Postgres jobs table + polling worker, BullMQ (Redis), Inngest (hosted).
- Tests:
  - Submit job, worker processes, result persisted into `boqs` table.
  - Simulate worker crash and confirm job resumes or is retried.
  - Admin can re-run from a trace step.
- Acceptance: job resume after worker crash; admin can see job status and re-run; retries with backoff.

4) Observability & tracing PoC
- Objective: record step-level traces and per-step AI usage (tokens/cost/model) for each generation.
- Implementation options: new `generation_traces` DB table (preferred) or PostHog / Sentry enriched events.
- Data model (example): job_id, step_name, started_at, finished_at, success, message, ai_entries (tokens/cost), meta.
- Acceptance: for any failed job you can see failing step, token counts, and model used; admin UI can display traces.

5) Rate accuracy benchmark
- Objective: measure LLM rate suggestion accuracy vs ground truth and cost per suggested rate.
- Dataset: 30–100 items with verified ground-truth rates (sample from historical BOQs or synthetic test set).
- Metrics: exact match rate, within +/-5% and +/-10%, coverage (% items with suggestion), cost per item (USD).
- Acceptance: defined threshold (e.g., >=70% within +/-10%) or proposal for fallback rules (human review threshold, hybrid lookup).

6) Drawing / OCR evaluation
- Objective: determine viability of adding OCR/vision to improve counts and evidence extraction.
- Options: Gemini Vision (LLM multimodal), Google Vision / OCR APIs, Tesseract (local), server-side PDF->image + OCR.
- Tests:
  - Run OCR on 20 sample drawing pages and extract labels/dimensions.
  - Feed extracted text to `applyDrawingCountHeuristics` to measure improved quantity recall.
- Acceptance: meaningful improvement to quantity extraction (e.g., >=15% recall lift) or evidence that only semi-automatic workflows are viable.

## Deliverables
- `/docs/investigation-plan.md` (this document).
- Benchmark scripts and test workbooks under `/tools/spike/` (PoC code + simple README).
- Excel patcher prototype and small worker PoC (branch-ready PRs).
- Trace schema migration and admin traces UI mockup.
- Spike report summarizing outcomes and final recommended path with effort estimates.

## Acceptance Criteria (Spike-level)
- A clear decision for the Excel approach (library + patch pattern) with test evidence.
- A recommended async job architecture with a minimal PoC that demonstrates resilience and admin re-run.
- Quantified rate accuracy and cost numbers with recommended mitigations (fallbacks, thresholds, manual review flows).
- A recommendation for drawings/OCR (Level 1/2/3) with cost/benefit analysis.

## Timeline & estimates (rough)
- Day 0–1: Create test workbooks, scaffold benchmark harness.
- Day 1–2: Run Excel library benchmarks, select primary approach (4–8 hours).
- Day 2–3: Implement small patcher PoC and run idempotency tests (6–10 hours).
- Day 3–4: Implement async job PoC (Postgres jobs table) and trace recording (8–12 hours).
- Day 4–5: Rate accuracy benchmark + drawing OCR quick tests (6–10 hours).
- Final: Summarize findings and recommended plan (4 hours).

## Next steps (what I will do if you approve)
1. Scaffold `/tools/spike/excel-bench/` and add canonical test workbooks.  
2. Run `exceljs` vs `xlsx` tests and report results.  
3. Build the small Excel patcher prototype and verify idempotency.  
4. PoC a Postgres-backed job worker and add trace writes for one sample job.  

If you prefer a different priority (e.g., start with async PoC before Excel), tell me and I'll reorder.

---
Document created by the spike investigation runner.
