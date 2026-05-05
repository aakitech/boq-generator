/**
 * strip-to-template.cjs
 *
 * Reads a priced BOQ Excel workbook and writes a blank template shell:
 * - Preserves all structure: merges, styles, column widths, row heights, fonts, borders
 * - Preserves description, item number, unit cells
 * - Blanks QTY and RATE cells on measurable rows
 * - Keeps formula cells (e.g. AMOUNT = QTY * RATE) intact so they recalculate when filled
 *
 * Usage:
 *   node tools/strip-to-template.cjs <source.xlsx> <output.xlsx>
 */

const path = require("path");
const ExcelJS = require("exceljs");

const [, , sourceArg, outArg] = process.argv;
if (!sourceArg || !outArg) {
  console.error("Usage: node strip-to-template.cjs <source.xlsx> <output.xlsx>");
  process.exit(1);
}

const sourcePath = path.resolve(sourceArg);
const outPath = path.resolve(outArg);

const RATE_KEYWORDS = ["rate", "unit rate", "unit cost"];
const QTY_KEYWORDS = ["qty", "quantity", "quant"];
const AMOUNT_KEYWORDS = ["amount", "total", "subtotal", "sub total", "sub-total", "extended"];

function lc(v) {
  return String(v ?? "").toLowerCase().trim();
}

function findHeaderRow(sheet) {
  for (let r = 1; r <= 20; r++) {
    const row = sheet.getRow(r);
    const vals = [];
    row.eachCell({ includeEmpty: false }, (cell) => vals.push(lc(cell.value)));
    const joined = vals.join(" ");
    if (
      (joined.includes("description") || joined.includes("desc")) &&
      (joined.includes("rate") || joined.includes("amount"))
    ) {
      return r;
    }
  }
  return null;
}

function classifyColumns(sheet, headerRowNum) {
  const row = sheet.getRow(headerRowNum);
  const rateCols = new Set();
  const qtyCols = new Set();
  const amountCols = new Set();

  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const v = lc(cell.value);
    if (RATE_KEYWORDS.some((k) => v.includes(k))) rateCols.add(colNumber);
    if (QTY_KEYWORDS.some((k) => v.includes(k))) qtyCols.add(colNumber);
    if (AMOUNT_KEYWORDS.some((k) => v.includes(k))) amountCols.add(colNumber);
  });

  // blankCols = qty + rate (numeric-input cols we blank)
  // keepFormulaCols = amount cols (formula-driven, keep formulas but allow clearing cached result)
  const blankCols = new Set([...rateCols, ...qtyCols]);
  const keepFormulaCols = new Set([...amountCols]);

  if (blankCols.size === 0) {
    console.warn("  [warn] Could not identify rate/qty columns from header — falling back to cols 4,5");
    blankCols.add(4);
    blankCols.add(5);
  }
  if (keepFormulaCols.size === 0) {
    console.warn("  [warn] Could not identify amount column from header — falling back to col 6");
    keepFormulaCols.add(6);
  }

  return { blankCols, keepFormulaCols };
}

function isMeasurableRow(row, blankCols) {
  // A measurable row has at least one numeric value > 0 in qty/rate columns
  let hasNumeric = false;
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    if (blankCols.has(colNumber) && typeof cell.value === "number" && cell.value > 0) {
      hasNumeric = true;
    }
  });
  return hasNumeric;
}

function isSummaryRow(row, allDataCols) {
  // A summary row has no numeric input values but has formulas in the data range
  // (e.g. bill totals that SUM a column range)
  let hasFormula = false;
  let hasPlainNumericInput = false;
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    if (allDataCols.has(colNumber)) {
      if (cell.type === ExcelJS.ValueType.Formula) hasFormula = true;
      if (typeof cell.value === "number") hasPlainNumericInput = true;
    }
  });
  return hasFormula && !hasPlainNumericInput;
}

async function main() {
  console.log("Source:", sourcePath);
  console.log("Output:", outPath);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourcePath);

  let totalBlanked = 0;

  workbook.eachSheet((sheet) => {
    console.log(`\nSheet: "${sheet.name}" (${sheet.rowCount} rows)`);

    const headerRowNum = findHeaderRow(sheet);
    if (headerRowNum === null) {
      console.log("  [skip] No recognisable BOQ header row found");
      return;
    }
    console.log(`  Header row: ${headerRowNum}`);

    const { blankCols, keepFormulaCols } = classifyColumns(sheet, headerRowNum);
    const allDataCols = new Set([...blankCols, ...keepFormulaCols]);
    console.log(`  Blank (qty/rate) cols: ${[...blankCols].join(", ")}`);
    console.log(`  Keep-formula (amount) cols: ${[...keepFormulaCols].join(", ")}`);

    let blankCount = 0;
    let rowsProcessed = 0;

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= headerRowNum) return;

      // On every data row: blank qty/rate numeric cells, keep formula cells as-is
      let rowBlanked = 0;

      if (isMeasurableRow(row, blankCols)) {
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          if (blankCols.has(colNumber) && typeof cell.value === "number") {
            cell.value = null;
            rowBlanked++;
          }
          // Amount formula cells: keep formula, clear cached numeric result
          if (keepFormulaCols.has(colNumber) && cell.type === ExcelJS.ValueType.Formula) {
            const formula = cell.formula || (cell.value && cell.value.formula);
            if (formula) {
              cell.value = { formula, result: undefined };
            }
          }
        });
        blankCount += rowBlanked;
        rowsProcessed++;
      }
    });

    console.log(`  Processed ${rowsProcessed} measurable rows, blanked ${blankCount} cells`);
    totalBlanked += blankCount;
  });

  await workbook.xlsx.writeFile(outPath);
  console.log(`\nDone. Total cells blanked: ${totalBlanked}`);
  console.log("Written:", outPath);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
