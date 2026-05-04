const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const [, , inputArg, outputArg] = process.argv;

if (!inputArg || !outputArg) {
  console.error(
    "Usage: node tools/spike/excel-bench/patch-first-missing-rate-exceljs.cjs <input.xlsx> <output.xlsx>"
  );
  process.exit(1);
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isEmpty(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

async function main() {
  const inputPath = path.resolve(inputArg);
  const outputPath = path.resolve(outputArg);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);

  let patched = false;

  for (const sheet of workbook.worksheets) {
    let rateCol = null;
    let descriptionCol = null;
    let unitCol = null;
    let qtyCol = null;

    sheet.eachRow((row) => {
      if (patched) return;

      const values = Array.isArray(row.values) ? row.values : [];
      const normalized = values.map(normalize);

      const maybeDescriptionCol = normalized.findIndex((value) => value === "description");
      const maybeRateCol = normalized.findIndex(
        (value) => value === "rate" || value === "unit rate" || value === "rate zmw"
      );

      if (maybeDescriptionCol > 0 && maybeRateCol > 0) {
        descriptionCol = maybeDescriptionCol;
        rateCol = maybeRateCol;
        unitCol = normalized.findIndex((value) => value === "unit");
        qtyCol = normalized.findIndex((value) => value === "qty" || value === "quantity");
        return;
      }

      if (!rateCol || !descriptionCol) return;

      const description = row.getCell(descriptionCol).value;
      const unit = unitCol > 0 ? row.getCell(unitCol).value : null;
      const qty = qtyCol > 0 ? row.getCell(qtyCol).value : null;
      const rateCell = row.getCell(rateCol);
      const hasMeasuredShape = !isEmpty(unit) || !isEmpty(qty);

      if (!isEmpty(description) && hasMeasuredShape && isEmpty(rateCell.value)) {
        rateCell.value = 123.45;
        rateCell.numFmt = rateCell.numFmt || "#,##0.00";
        patched = true;
      }
    });

    if (patched) break;
  }

  if (!patched) {
    throw new Error("No missing rate found to patch.");
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await workbook.xlsx.writeFile(outputPath);
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
