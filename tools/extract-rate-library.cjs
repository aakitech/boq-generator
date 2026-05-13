/**
 * Extracts accepted rates from all priced BOQs in inspo_docs/ and writes
 * lib/rate-library.json. Re-run whenever new priced BOQs are added.
 *
 * Usage: node tools/extract-rate-library.cjs
 */

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const INSPO_DIR = path.resolve(__dirname, "../inspo_docs");
const OUT_FILE = path.resolve(__dirname, "../lib/rate-library.json");

const PRICED_FILES = [
  {
    file: "PRICED BOQ _ DRIP AND FILTER STATION BUILDING AND ASSOCIATED WORKS _ PHASE 4.xlsx",
    project: "Drip and Filter Station Phase 4",
    province: "Copperbelt",
    project_type: "commercial",
  },
  {
    file: "PRICED BOQ _  NAKAMBALA PRIVATE SCHOOL.xlsx",
    project: "Nakambala Private School",
    province: "Copperbelt",
    project_type: "commercial",
  },
  {
    file: "PRICED BOQ _ PIPELINE 2 PLINTH AND PEDASTAL PIPE SUPPORT FROM SHIMUNGALU TO P 2.xlsx",
    project: "Pipeline 2 Plinth and Pedestal Pipe Support",
    province: "Copperbelt",
    project_type: "commercial",
  },
  {
    file: "PRICED BOQ _ People vehicle separation Ph 4 of 6 _ Between Marshaling and Total Filling Station _ Lot 1 (1).xlsx",
    project: "People Vehicle Separation Ph 4 of 6",
    province: "Copperbelt",
    project_type: "commercial",
  },
  {
    file: "PRICED ZS P9-D10 WS CMEWorks TenderDoc BOQ Rev B 20260308.xlsx",
    project: "P9-D10 Water Supply CME Works",
    province: "Southern",
    project_type: "government",
  },
];

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isHeaderRow(row, headerColIndex) {
  // Detect the column header row (ITEM, DESCRIPTION, UNIT, QTY, RATE, AMOUNT)
  const desc = normalize(row[headerColIndex] ?? "");
  return desc === "description" || desc === "item description";
}

function detectHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const row = rows[i];
    const normalized = (row ?? []).map((v) => normalize(v));
    const hasDesc = normalized.some((v) => v === "description");
    const hasRate = normalized.some((v) => v === "rate" || v === "unit rate" || v.startsWith("rate "));
    const hasUnit = normalized.some((v) => v === "unit");
    if (hasDesc && hasRate && hasUnit) {
      return {
        headerRowIndex: i,
        descCol: normalized.findIndex((v) => v === "description"),
        unitCol: normalized.findIndex((v) => v === "unit"),
        qtyCol: normalized.findIndex((v) => v === "qty" || v === "quantity"),
        rateCol: normalized.findIndex((v) => v === "rate" || v === "unit rate" || v.startsWith("rate ")),
        amountCol: normalized.findIndex((v) => v === "amount"),
      };
    }
  }
  return null;
}

function worksheetRows(ws) {
  const rows = [];
  for (let rowIndex = 1; rowIndex <= ws.rowCount; rowIndex++) {
    const row = ws.getRow(rowIndex);
    const values = [];
    for (let colIndex = 1; colIndex <= Math.max(ws.columnCount, 20); colIndex++) {
      values.push(row.getCell(colIndex).value ?? null);
    }
    rows.push(values);
  }
  return rows;
}

function extractFromSheet(ws, sheetName, meta) {
  const rows = worksheetRows(ws);
  const cols = detectHeaderRow(rows);
  if (!cols) return [];

  const entries = [];
  let currentBill = sheetName;

  for (let i = cols.headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((v) => v === null)) continue;

    const description = String(row[cols.descCol] ?? "").trim();
    const rawUnit = row[cols.unitCol];
    const unit = (rawUnit && typeof rawUnit === "object" && rawUnit.richText)
      ? rawUnit.richText.map((r) => r.text).join("").trim()
      : String(rawUnit ?? "").trim();
    const qty = row[cols.qtyCol];
    const rate = row[cols.rateCol];

    // Track bill title rows (no unit, no qty, no rate — just a heading)
    if (description && !unit && qty === null && (rate === null || rate === 0)) {
      // Looks like a section/bill header
      if (description.length < 120 && !/^(the |a |all |where |contractor)/i.test(description)) {
        currentBill = description;
      }
      continue;
    }

    if (!description) continue;
    if (typeof rate !== "number" || rate <= 0) continue;
    if (!unit) continue;

    entries.push({
      description,
      unit,
      rate,
      qty: typeof qty === "number" ? qty : null,
      bill: currentBill,
      project: meta.project,
      province: meta.province,
      project_type: meta.project_type,
      source_file: meta.file,
    });
  }

  return entries;
}

async function extractFromFile(meta) {
  const filePath = path.join(INSPO_DIR, meta.file);
  if (!fs.existsSync(filePath)) {
    console.warn(`  SKIP (not found): ${meta.file}`);
    return [];
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const entries = [];

  for (const ws of wb.worksheets) {
    const sheetEntries = extractFromSheet(ws, ws.name, meta);
    entries.push(...sheetEntries);
  }

  return entries;
}

async function main() {
  console.log("Extracting rates from priced BOQs...\n");

  const allEntries = [];

  for (const meta of PRICED_FILES) {
    console.log(`Reading: ${meta.file}`);
    const entries = await extractFromFile(meta);
    console.log(`  ${entries.length} priced items extracted`);
    allEntries.push(...entries);
  }

  // Deduplicate: same description+unit+rate from same project — keep one
  const seen = new Set();
  const deduped = allEntries.filter((e) => {
    const key = `${normalize(e.description)}|${normalize(e.unit)}|${e.rate}|${e.project}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const library = {
    generated_at: new Date().toISOString(),
    source_files: PRICED_FILES.map((f) => f.file),
    entry_count: deduped.length,
    entries: deduped,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(library, null, 2));
  console.log(`\nWrote ${deduped.length} entries to ${OUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
