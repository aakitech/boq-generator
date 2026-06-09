# Issue #123: Simba Document Assessment

Date: 2026-06-07

## Purpose

Classify the project files received from Simba and identify how each can support:

- issue #123 interior remodel/shopfit structure verification
- later generated-versus-professional BOQ evaluation
- issues #124 and #125 quantity and provisional-sum calibration

All findings below were produced offline using local PDF text extraction and ExcelJS workbook inspection.

## Hungry Lion East Park One

### `HL EAST PARK ONE LUSAKA, ZAMBIA IFC 2026.02.20.pdf`

Classification: primary generation input.

- 23-page IFC architectural drawing pack.
- Text-based PDF with strong extractability: approximately 251,000 characters.
- Project title identifies a proposed Hungry Lion revamp.
- Drawing register includes:
  - general plan
  - demolition plan
  - wetworks and partitioning
  - electrical plan
  - plumbing plan
  - ceiling plan
  - lighting plan
  - floor finishes
  - wall finishes
  - internal and external graphics
  - evacuation plan

Use now:

- Primary real-project fixture for issue #123.
- Generate with `projectType = shopfit` or `interior_remodel`.
- Confirm the output contains alteration and fit-out trades but no default Substructure bill.
- Confirm explicitly documented local supports remain where required.

### `HL Priced BoQ.xlsx`

Classification: professional reference BOQ.

- One worksheet with approximately 1,040 rows.
- Identifies the project as `HL East Park 1 - remodel`.
- Main reference sections are:
  1. General Requirements
  2. Demolition
  3. Plumbing / Sanitary Ware
  4. Wet Works
  5. Shop Fronts
  6. Wall & Bulkhead Painting
  7. Electrical
  8. Ceilings
  9. Furniture and Shopfitting
  10. Ironmongery
  11. Fire Equipment
  12. Sound Installations
  13. Floor and Wall Finishes
  14. Other Supplied Items
  15. Mandatory Certification
  16. Pergola Canopy
  17. External Grease Trap
  18. Pylon Structure
  19. Additional Items

Key issue #123 evidence:

- The professional BOQ has no general Substructure bill.
- Demolition and fit-out work appear immediately after general requirements.
- Local external items such as a grease trap and pylon structure are included without implying a full ground-up substructure scope.

Reference-quality caveat:

- The workbook's summary formula cells currently evaluate to `#VALUE!`.
- Valid cached section budget totals sum to approximately ZMW 1,275,105 before the ceiling section.
- A visible ceiling figure of ZMW 71,476 brings the recoverable benchmark to approximately ZMW 1,346,581.
- Item and section values should be used for comparison instead of trusting the broken grand-total formula.

## Vedanta Office Fitout

### `Vendeta Office Fitout BOQ rev1.pdf`

Classification: professional reference BOQ.

- The filename says `Vendeta`, but the document title and drawings identify the project as `Vedanta`.
- Six-page priced BOQ.
- Total: ZMW 6,811,508.32.
- Includes:
  - demolitions
  - new masonry and partition work
  - superstructure/local new works
  - paintwork
  - ceilings and partitions
  - plumbing and drainage
  - electrical and IT
  - specialist trades
  - preliminaries and general items

Use:

- Second benchmark after Hungry Lion.
- Useful for checking that an interior-project rule does not remove legitimate new walls, local masonry, ceiling work, or documented structural alterations.
- Useful for issues #124 and #125 because it contains professional quantities and explicit specialist-work allowances.

### Recommended Vedanta generation bundle

Primary construction evidence:

- `LUSAKA-GROUND FLOOR DEMOLITIONS-REV G.pdf`
- `LUSAKA-GROUND FLOOR CEILING DEMOLITIONS-REV A.pdf`
- `LUSAKA-GROUND FLOOR CONSTRUCTION-REV A.pdf`
- `LUSAKA-GROUND FLOOR CEILING & LIGHTING LAYOUT-REV A.pdf`
- `LUSAKA-GROUND FLOOR PVD LAYOUT-REV A.pdf`
- `LUSAKA-GROUND FLOOR FLOOR FINISHES-REV A.pdf`
- `LUSAKA-GROUND FLOOR WALL FINISHES-REV A.pdf`

These drawings provide the most direct evidence for demolition, new partitions, plumbing fixtures, ceilings, lighting, power/data, floor finishes, and wall finishes.

Supporting context:

- `LUSAKA-GROUND FLOOR SPACE PLANNING-REV G.pdf`
- `LUSAKA-GROUND FLOOR SPACE PLANNING SITE PLAN-REV G.pdf`

The ground-floor space-planning drawing provides room names and areas. The site plan may help with external scope such as parking or access. Both should remain supporting documents because their notes state that space-planning layouts are informational and not construction drawings.

Exclude from the initial generation run:

- `LUSAKA-GROUND FLOOR SPACE PLANNING WITH DEMO-REV G.pdf`
  - Largely duplicates the current space-planning and demolition sheets.
  - Including it may double-count demolition or room evidence.
- `LUSAKA-FIRST FLOOR SPACE PLANNING-REV A.pdf`
  - Explicitly informational and not for construction.
  - Include only if the confirmed contracted scope covers first-floor work.

## Recommended Verification Sequence

1. Run Hungry Lion first using the 23-page IFC pack and `projectType = shopfit`.
2. Compare generated bill titles and items against the Hungry Lion reference workbook.
3. Confirm:
   - no default Substructure bill
   - no invented foundations, hardcore, DPM, plinth walls, columns, or suspended slabs
   - demolition, finishes, ceilings, plumbing, electrical, signage, and shopfitting remain
   - explicit grease-trap, pylon, lintel, channel, or local support work is retained when evidenced
4. Record any remaining scope errors separately from quantity and pricing errors.
5. Run the curated Vedanta bundle as a second regression case.
6. Compare against the ZMW 6,811,508.32 professional BOQ and its bill structure.

## Current Verification Status

- Shared project types and interior-specific prompt rules implemented.
- Self-serve and admin intake project-type controls implemented.
- Production Inngest and local inline generation paths updated.
- Focused prompt regression tests: 5 passed.
- Synthetic shopfit Gemini integration: passed after one refinement.
- Production build: passed.
- Offline source/reference assessment: complete.
- Real Gemini-backed Hungry Lion generation could not be run from this environment because policy prevents transmitting the private project-document text to an external AI service.

## Synthetic Gemini Findings

The synthetic integration scope described an existing commercial tenant unit with:

- demolition and strip-out
- new lightweight partitions and bulkheads
- finishes, ceilings, shopfitting, plumbing, electrical, ventilation, signage, and fire work
- one explicit local lintel
- explicit menu-board support channels
- an explicit statement that no foundations or ground-up structural work were required

### First run

Passed:

- no Substructure bill
- no foundations, hardcore, plinth walls, columns, or suspended structural slabs
- explicit lintel retained
- explicit signage support channels retained

Finding:

- demolition items were grouped under Preliminary and General.
- local partitions and supports were grouped under a bill titled `SUPERSTRUCTURE`.

Refinement:

- added an interior-specific bill sequence
- required a dedicated `DEMOLITION AND ALTERATIONS` bill
- required `PARTITIONS AND LOCAL STRUCTURAL ALTERATIONS` instead of `SUPERSTRUCTURE`
- explicitly prohibited demolition work from being placed in Preliminary and General

### Second run

Passed:

- Bill 1: Preliminary and General Items
- Bill 2: Demolition and Alterations
- Bill 3: Partitions and Local Structural Alterations
- Bill 4: Ceilings and Bulkheads
- Bill 5: Internal Finishes
- Bill 6: Joinery, Shopfitting and Ironmongery
- Bill 7: Plumbing and Drainage
- Bill 8: Electrical and Data
- Bill 9: Mechanical, Fire, and Signage
- no Substructure or generic Superstructure bill
- no ground-up structural items
- explicit lintel and support channels retained

Conclusion:

- The updated prompt now behaves correctly for the issue #123 scope in a real Gemini call using non-private synthetic project data.
- Hungry Lion remains the best private acceptance fixture and should be run through the approved application upload flow using `shopfit`.
- Vedanta should follow as the second regression fixture using `interior_remodel`.
