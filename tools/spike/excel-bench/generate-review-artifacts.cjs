/**
 * Generates Excel artifacts from real workbooks for manual inspection.
 *
 * Outputs (written to tools/spike/excel-bench/review-artifacts/):
 *   original-drip-filter.xlsx        - unchanged source, reference copy
 *   patched-exceljs-drip-filter.xlsx - ExcelJS patcher used by the app
 *   ground-truth-drip-filter.xlsx    - Innocent's manually priced version
 *
 * Open all three in Excel/LibreOffice to compare formatting, rates, formulas.
 */

const fs = require("fs");
const path = require("path");
const jiti = require("jiti")(__filename, { interopDefault: true });

const { extractWorkbookBOQ, patchExcelWithRates } = jiti("../../../lib/excel.ts");

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

  fs.copyFileSync(SOURCE, path.join(OUT_DIR, "original-drip-filter.xlsx"));
  console.log("  wrote original-drip-filter.xlsx");

  fs.copyFileSync(GROUND_TRUTH, path.join(OUT_DIR, "ground-truth-drip-filter.xlsx"));
  console.log("  wrote ground-truth-drip-filter.xlsx");

  console.log("Extracting BOQ structure...");
  const boq = await extractWorkbookBOQ(originalBuffer);

  let patchedCount = 0;
  for (const bill of boq.bills) {
    for (const item of bill.items) {
      if (item.is_header) continue;
      if (item.rate !== null) continue;
      item.rate = 500 + patchedCount * 7.5;
      item.amount = item.qty !== null ? Number((item.qty * item.rate).toFixed(2)) : item.amount;
      patchedCount++;
    }
  }
  console.log(`  assigned rates to ${patchedCount} previously-blank items`);

  const rateHeader = boq.workbook_preservation?.per_sheet_stats?.[0]?.rate_column_header ?? "RATE";
  const amountHeader = boq.workbook_preservation?.per_sheet_stats?.[0]?.amount_column_header ?? "AMOUNT";

  console.log("Running ExcelJS patcher...");
  const patched = await patchExcelWithRates(originalBuffer, boq, rateHeader, amountHeader);
  fs.writeFileSync(path.join(OUT_DIR, "patched-exceljs-drip-filter.xlsx"), patched);
  console.log("  wrote patched-exceljs-drip-filter.xlsx");

  console.log(`\nDone. Open these files side by side:\n  ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
