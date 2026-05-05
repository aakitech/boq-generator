/**
 * Generates Excel artifacts from real workbooks for manual inspection.
 *
 * Outputs (written to tools/spike/excel-bench/review-artifacts/):
 *   original-drip-filter.xlsx          — unchanged source, reference copy
 *   patched-xlsx-drip-filter.xlsx      — SheetJS patcher (old approach)
 *   patched-exceljs-drip-filter.xlsx   — ExcelJS patcher (new approach on this branch)
 *   ground-truth-drip-filter.xlsx      — Innocent's manually priced version
 *
 * Open all four in Excel/LibreOffice to compare formatting, rates, formulas.
 */

const fs = require("fs");
const path = require("path");
const jiti = require("jiti")(__filename, { interopDefault: true });
const XLSX = require("xlsx");

const { extractWorkbookBOQ, patchExcelWithRates, patchExcelWithRatesPreservingWorkbook } =
  jiti("../../../lib/excel.ts");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const OUT_DIR = path.join(__dirname, "review-artifacts");
fs.mkdirSync(OUT_DIR, { recursive: true });

const SOURCE = path.join(
  REPO_ROOT,
  "inspo_docs",
  "BOQ _ DRIP AND FILTER STATION BUILDING AND ASSOCIATED WORKS _ PHASE 4.xlsx"
);
const GROUND_TRUTH = path.join(
  REPO_ROOT,
  "inspo_docs",
  "PRICED BOQ _ DRIP AND FILTER STATION BUILDING AND ASSOCIATED WORKS _ PHASE 4.xlsx"
);

async function main() {
  console.log("Reading source workbook...");
  const originalBuffer = fs.readFileSync(SOURCE);

  // 1. Original — just copy it so you have it alongside the others
  fs.copyFileSync(SOURCE, path.join(OUT_DIR, "original-drip-filter.xlsx"));
  console.log("  wrote original-drip-filter.xlsx");

  // 2. Ground truth — Innocent's manually priced version
  fs.copyFileSync(GROUND_TRUTH, path.join(OUT_DIR, "ground-truth-drip-filter.xlsx"));
  console.log("  wrote ground-truth-drip-filter.xlsx");

  // 3. Extract the BOQ so we can patch both ways
  console.log("Extracting BOQ structure...");
  const boq = extractWorkbookBOQ(originalBuffer);

  // Simulate what the app does: assign a plausible rate to every measurable item
  // that doesn't already have one, so the patchers have something to write.
  let patchedCount = 0;
  for (const bill of boq.bills) {
    for (const item of bill.items) {
      if (item.is_header) continue;
      if (item.rate !== null) continue;
      // Use a deterministic fake rate based on position so the two patchers get identical input
      item.rate = 500 + patchedCount * 7.5;
      item.amount =
        item.qty !== null ? Number((item.qty * item.rate).toFixed(2)) : item.amount;
      patchedCount++;
    }
  }
  console.log(`  assigned rates to ${patchedCount} previously-blank items`);

  const rateHeader =
    boq.workbook_preservation?.per_sheet_stats?.[0]?.rate_column_header ?? "RATE";
  const amountHeader =
    boq.workbook_preservation?.per_sheet_stats?.[0]?.amount_column_header ?? "AMOUNT";

  // 4. SheetJS patcher (old approach)
  console.log("Running SheetJS patcher...");
  const xlsxPatched = patchExcelWithRates(originalBuffer, boq, rateHeader, amountHeader);
  fs.writeFileSync(path.join(OUT_DIR, "patched-xlsx-drip-filter.xlsx"), xlsxPatched);
  console.log("  wrote patched-xlsx-drip-filter.xlsx");

  // 5. ExcelJS patcher (new approach — what this branch ships)
  console.log("Running ExcelJS patcher...");
  const excelJsPatched = await patchExcelWithRatesPreservingWorkbook(
    originalBuffer,
    boq,
    rateHeader,
    amountHeader
  );
  fs.writeFileSync(path.join(OUT_DIR, "patched-exceljs-drip-filter.xlsx"), excelJsPatched);
  console.log("  wrote patched-exceljs-drip-filter.xlsx");

  console.log(`\nDone. Open these four files side by side:\n  ${OUT_DIR}`);
  console.log(`
  original-drip-filter.xlsx        — source (no rates)
  patched-xlsx-drip-filter.xlsx    — SheetJS patcher output
  patched-exceljs-drip-filter.xlsx — ExcelJS patcher output  <-- what the branch uses
  ground-truth-drip-filter.xlsx    — Innocent's manually priced version
  `);
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
