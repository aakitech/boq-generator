const jiti = require("jiti")(__filename, { interopDefault: true });
const XLSX = require("xlsx");

const { buildCanonicalStyledWorkbook } = jiti("./preservation-fixture.ts");
const { extractWorkbookBOQ, patchExcelWithRatesPreservingWorkbook } = jiti("../../../lib/excel.ts");

(async function main() {
  try {
    const original = buildCanonicalStyledWorkbook();
    const boq = extractWorkbookBOQ(original);

    // Fill one deterministic rate in the BOQ to simulate the export route behavior
    let filled = false;
    for (const bill of boq.bills) {
      for (const item of bill.items) {
        if (item.is_header) continue;
        item.rate = 125.5;
        item.amount = item.qty !== null ? Number((item.qty * item.rate).toFixed(2)) : item.amount;
        filled = true;
        break;
      }
      if (filled) break;
    }

    if (!filled) throw new Error("No measurable item found in canonical workbook");

    const output = await patchExcelWithRatesPreservingWorkbook(original, boq, "Rate", "Amount");

    const before = XLSX.read(original, { type: "buffer", cellStyles: true, cellFormula: true });
    const after = XLSX.read(output, { type: "buffer", cellStyles: true, cellFormula: true });

    const wsBefore = before.Sheets["MAIN BILL"];
    const wsAfter = after.Sheets["MAIN BILL"];

    const report = {
      sheetNamesPreserved: JSON.stringify(after.SheetNames) === JSON.stringify(before.SheetNames),
      mergesPreserved: (wsAfter["!merges"]?.length ?? 0) === (wsBefore["!merges"]?.length ?? 0),
      amountFormulaPreserved: (wsAfter["F3"]?.f ?? null) === (wsBefore["F3"]?.f ?? null),
      firstRatePatched: (wsAfter["E3"]?.v ?? null) === 125.5,
    };

    console.log(JSON.stringify({ before: { sheetNames: before.SheetNames }, report }, null, 2));
    if (!report.sheetNamesPreserved || !report.mergesPreserved || !report.amountFormulaPreserved || !report.firstRatePatched) {
      process.exit(2);
    }
    process.exit(0);
  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  }
})();
