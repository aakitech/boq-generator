# BOQ Product Go-Live Implementation Plan

## Meeting Context

These notes summarize the partner feedback from the BOQ Live Demo meeting and translate it into an implementation plan for go-live readiness.

The main product direction is:

- Keep Scope of Work (SOW) as the minimum required input for BOQ generation.
- Treat drawings and supporting documents as optional value-add inputs, not mandatory blockers.
- Improve output quality so generated BOQs look and feel closer to professional tender BOQs.
- Make generation, credits, and the AI assistant more reliable and transparent before launch.
- Defer larger tender-document automation and anti-abuse features until after the core BOQ workflow is stable.

## Key Decisions From Meeting Notes

1. SOW should be enough to generate a BOQ.
2. Drawings should be accepted when available, but should not be required.
3. The app should not ask clients for schedules, specifications, or test certificates as required uploads during SOW upload.
4. The system should eventually generate schedules, method statements, Gantt charts, and tendering documents.
5. Drawings use more AI/computing resources, so pricing or credit usage should increase when drawings are included.
6. Starter credit value should be reduced from USD 2.50 to USD 1.00.
7. Long-running BOQ processing needs clearer user messaging and better reliability.
8. AI assistant failures must be visible to the user instead of silently failing.
9. Generated BOQ formatting needs to be improved, using Innocent's BOQs, especially Nakambala, as a style reference.
10. Generated BOQs should not look mechanically identical across projects; bill structure and item density should vary based on project scope.

## Phase 0: Immediate Go-Live Fixes

Target: 1-3 working days

These are the lowest-risk changes that directly address partner concerns before launch.

### Upload Requirements

Remove schedules, specifications, and test certificates from required upload blockers.

Implementation notes:

- Update the SOW classification and required attachment logic so only truly blocking issues stop generation.
- Keep drawings/supporting documents as optional attachments.
- If the SOW mentions missing schedules/specs/drawings, show a soft warning such as: "You can continue with the SOW only, but adding drawings may improve accuracy."

Acceptance criteria:

- User can generate a BOQ with only a valid SOW.
- Drawings are optional.
- Schedules, specifications, and test certificates are not presented as required documents.

### Starter Credit Reduction

Reduce starter credit value from USD 2.50 to USD 1.00.

Also reduce the credit cost of generating a BOQ so the free trial still feels useful. The current BOQ generation cost should move from about USD 2.00 to a lower launch cost, likely USD 0.50-0.75, so the USD 1.00 starter credit gives users at least two SOW-only BOQ generations.

AI assistant usage should also contribute to credit usage instead of being treated as unlimited free usage. Assistant deductions can be smaller than BOQ generation deductions, but they should still make the credit model clear and sustainable.

Implementation notes:

- Update credit conversion constants.
- Update BOQ generation credit pricing from about USD 2.00 to a proposed USD 0.50-0.75 launch cost.
- Confirm whether drawings/supporting documents should cost more than SOW-only generation because they use more AI/computing resources.
- Add credit deduction logic for AI assistant usage, including successful chat responses and any assistant-driven BOQ edits or proposals.
- Add a database migration for new accounts.
- Decide whether existing users should keep current balances or be adjusted.

Recommendation:

- For go-live simplicity, apply USD 1.00 value to new accounts only unless there is a strong business reason to adjust existing test accounts.
- For launch, set SOW-only BOQ generation low enough that starter credits allow a minimum of two generated BOQs.
- Price assistant usage conservatively at first, then revisit once real usage and AI costs are visible.

Acceptance criteria:

- New users receive the intended free trial credit value.
- New users can generate at least two SOW-only BOQs from the starter credit allocation.
- BOQ generation deducts the updated lower credit amount.
- AI assistant usage deducts credits and is reflected in the user's balance.
- UI copy reflects the updated credit offer.
- Credit balance display, checkout, unlock, and assistant usage remain in sync.

### Free Trial Card Copy

Reduce wording on the free trial/pricing card.

Implementation notes:

- Make the card shorter and more confident.
- Avoid over-explaining credits.
- Keep only what affects user action: credits available, use credits, payment appears after credits.

Acceptance criteria:

- Free trial card is visually cleaner.
- User understands they can proceed without payment while credits remain.

### Long Processing Message

Improve user messaging when generation takes long.

Implementation notes:

- After a threshold such as 45-60 seconds, show: "This BOQ is still processing. Large files or a slow connection can take longer. Please keep this page open."
- Avoid saying the user's network is definitely low unless the browser actually detects a network failure.

Acceptance criteria:

- Users get a reassuring long-running message.
- Network errors and slow processing are not confused.

### AI Assistant Failure Handling

Fix assistant failure states so it never goes silent.

Implementation notes:

- Ensure stream errors, empty responses, provider failures, and malformed proposals produce a visible assistant message.
- Keep the user's instruction in the chat history.
- Show a retry-friendly message.

Acceptance criteria:

- If assistant fails, user sees a clear message.
- Assistant busy/loading state always clears.
- Chat history remains visible.

## Phase 1: BOQ Output Quality Before Launch

Target: 3-7 working days

This phase makes the generated output credible enough for real client review.

### Nakambala Formatting Template

Use the Nakambala BOQ as the primary style reference for exported/generated BOQs.

Implementation notes:

- Compare current generated Excel output against `inspo_docs/PRICED BOQ _  NAKAMBALA PRIVATE SCHOOL.xlsx`.
- Define a house style for:
  - project title page/header
  - bill headers
  - section headers
  - item rows
  - subtotal and summary rows
  - column widths
  - borders, fills, font weight, and alignment
- Update Excel export styling to make headers clearly distinguishable.

Acceptance criteria:

- Bill headers and section headers are visually obvious.
- Exported BOQs look consistent with the selected reference style.
- Generated BOQ can be reviewed without confusion between headers and line items.

### Better Bill and Item Variation

Make generated BOQs differ naturally by project.

Implementation notes:

- Update generation prompts and validation so bills are based on the actual SOW scope, not a fixed template.
- Require variable item density per bill depending on evidence in the SOW.
- Avoid forcing the same number of items across all BOQs.
- Preserve standard bill naming where appropriate, but vary sections and measurable items based on scope.

Acceptance criteria:

- Different SOWs produce visibly different bill structures.
- Each bill has an item count proportionate to the project scope.
- Output still remains professional and tender-like.

### Credits Sync Check

Audit the credit lifecycle.

Implementation notes:

- Check credit display on home, upload, pricing card, unlock, rated BOQ flow, dashboard badge, and API response.
- Ensure all successful credit-consuming actions refresh the client-side credit state.
- Ensure assistant usage refreshes the same credit state as BOQ generation and unlock actions.
- Ensure failed unlock/rating/generation/assistant actions do not incorrectly deduct credits.

Acceptance criteria:

- Credits shown in the UI match API/database balance after every unlock/rating/generation/assistant action.
- Failed actions do not create confusing stale balances.

## Phase 2: Reliability Foundation

Target: 1-2 weeks

The current app already has a reliability plan for job-based BOQ processing. This should become the main production-hardening track.

### Async BOQ Job Processing

Move generation/rating from long synchronous requests to durable background jobs.

Implementation notes:

- Add `boq_jobs` table.
- Add job start/status/process endpoints.
- Make `/generating` poll job status instead of owning the long-running request.
- Make retries idempotent by Stripe session or BOQ id.
- Save processing stage, progress, and last error.

Acceptance criteria:

- Refreshing the page does not lose a BOQ job.
- A browser/network disconnect does not imply the BOQ failed.
- Duplicate retries do not create duplicate BOQs or duplicate charges.

### Processing Time Visibility

Add clearer processing stages.

Example stages:

- Validating documents
- Reading SOW
- Building BOQ structure
- Estimating quantities
- Applying pricing
- Formatting output
- Saving BOQ

Acceptance criteria:

- Users can see that work is progressing.
- Support/admin can inspect failed or stuck jobs.

## Phase 3: Drawings Feature

Target: phased rollout, 2-6+ weeks depending on ambition

Adding drawings can mean several different things. The recommended approach is to split it into levels.

### Level 1: Optional Drawing Upload as Context

Effort: Medium

The system accepts drawing PDFs/images as optional supporting documents and includes extracted text or basic visual descriptions in the BOQ prompt.

Deliverables:

- Add drawing upload slot on SOW flow.
- Do not block generation if drawings are missing.
- Store drawing metadata.
- Include drawing context in BOQ generation.
- Increase credit usage or price when drawings are attached.

This is realistic for near-term launch if kept simple.

### Level 2: AI Vision Review of Drawings

Effort: Large

The system uses multimodal AI to inspect drawings for rooms, dimensions, elevations, fixtures, doors/windows, and scope clues.

Deliverables:

- Convert drawing PDFs to images.
- Run page-by-page visual extraction.
- Summarize drawing evidence into structured scope notes.
- Cite drawing evidence in BOQ items where possible.
- Add higher pricing/credit multiplier.

This should come after core reliability work because it increases processing time and cost.

### Level 3: Automated Quantity Takeoff From Drawings

Effort: Very Large

The system measures quantities directly from drawings.

Deliverables:

- Scale detection.
- Plan element recognition.
- Area/length/count extraction.
- Manual review tools.
- Strong QA and uncertainty handling.

Recommendation:

- Do not promise this for initial go-live. Treat it as a later product line.

## Phase 4: Tender Document Generation

Target: post-launch

Generate additional tendering outputs after BOQ generation is stable.

Potential outputs:

- Gantt chart / programme of works
- Method statement
- Schedules generated by the system
- Tender returnable documents
- Scope clarifications
- Material schedule
- Labour/equipment schedule

Recommendation:

- Start with generated schedules and method statement because they can be derived from the BOQ.
- Add Gantt chart next, using bill sections and estimated activity durations.
- Keep full tender-document packs for a later paid tier.

## Phase 5: Abuse Prevention

Target: post-launch once traffic exists

Stop users from creating multiple accounts to repeatedly get free credits.

Potential controls:

- Email/domain checks
- Device/browser fingerprinting
- Phone verification
- Payment-method verification
- IP/rate limits
- Manual review for suspicious usage

Recommendation:

- Do not block go-live on this unless abuse is already happening.
- Add lightweight rate limits now, then stronger controls after observing real usage.

## Prioritized Backlog

### Must Do Before Go-Live

- Remove required schedules/specifications/test certificates from SOW upload.
- Keep drawings optional.
- Reduce starter credit value from USD 2.50 to USD 1.00.
- Shorten free trial card copy.
- Add better long-processing message.
- Fix AI assistant visible failure states.
- Improve BOQ export header formatting.
- Use Nakambala as the formatting reference.
- Verify credit sync across UI and APIs.

### Strongly Recommended Before Go-Live

- Improve generated BOQ variation by SOW.
- Add processing stage labels.
- Start the async job architecture if time allows, or at least prepare the schema/API direction.

### Can Ship Shortly After Go-Live

- Optional drawing upload as contextual input.
- Drawing-based pricing/credit multiplier.
- Generated schedules.
- Method statement generation.
- Better admin visibility for processing failures.

### Later Phase

- AI vision drawing interpretation.
- Automated quantity takeoff from drawings.
- Gantt chart generation.
- Full tendering document packs.
- Anti-multiple-account free-credit security.

## Suggested Go-Live Scope

For the safest launch, go live with:

- SOW-only BOQ generation as the core promise.
- Optional supporting documents as accuracy enhancers.
- Professional Nakambala-style Excel export.
- Reliable credits and visible AI errors.
- Honest processing messaging.

Avoid promising:

- Full drawing takeoff.
- Fully automated tender packs.
- Guaranteed schedule generation.
- Perfect BOQ item counts from limited SOWs.

## Open Product Questions

1. Should existing users keep USD 2.50 worth of starter credits, or should all balances be reset to the new USD 1.00 value?
2. Should drawing uploads increase the Stripe unlock price, credit usage only, or both?
3. Should generated schedules/method statements be included in the same BOQ price or become a higher-tier package?
4. Which Innocent/Nakambala workbook should be treated as the official export template if multiple examples differ?
5. What is the minimum acceptable BOQ quality threshold for go-live approval?
