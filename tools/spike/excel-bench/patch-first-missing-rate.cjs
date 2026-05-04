const fs = require("fs");
const path = require("path");
const jiti = require("jiti")(__filename, { interopDefault: true });

const {
  extractWorkbookBOQ,
  patchExcelWithRatesPreservingWorkbook,
} = jiti("../../../lib/excel.ts");

const [, , inputArg, outputArg] = process.argv;

if (!inputArg || !outputArg) {
  console.error(
    "Usage: node tools/spike/excel-bench/patch-first-missing-rate.cjs <input.xlsx> <output.xlsx>"
  );
  process.exit(1);
}

async function main() {
  const inputPath = path.resolve(inputArg);
  const outputPath = path.resolve(outputArg);
  const input = fs.readFileSync(inputPath);
  const boq = extractWorkbookBOQ(input);

  let patched = false;
  for (const bill of boq.bills) {
    for (const item of bill.items) {
      if (item.is_header || item.rate !== null) continue;
      item.rate = 123.45;
      item.amount = item.qty !== null ? Number((item.qty * item.rate).toFixed(2)) : item.amount;
      patched = true;
      break;
    }
    if (patched) break;
  }

  if (!patched) {
    console.error("No missing rate found to patch.");
    process.exit(1);
  }

  const output = await patchExcelWithRatesPreservingWorkbook(input, boq, "RATE", "AMOUNT");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
