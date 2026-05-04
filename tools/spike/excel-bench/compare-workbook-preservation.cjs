const path = require("path");
const XLSX = require("xlsx");

const [, , beforeArg, afterArg] = process.argv;

if (!beforeArg || !afterArg) {
  console.error(
    "Usage: node tools/spike/excel-bench/compare-workbook-preservation.cjs <before.xlsx> <after.xlsx>"
  );
  process.exit(1);
}

function readWorkbook(file) {
  return XLSX.readFile(path.resolve(file), {
    cellFormula: true,
    cellStyles: true,
  });
}

function normalizeCell(cell) {
  if (!cell) return null;
  return {
    v: cell.v ?? null,
    t: cell.t ?? null,
    f: cell.f ?? null,
    z: cell.z ?? null,
    s: cell.s ?? null,
  };
}

function styleKey(cell) {
  return JSON.stringify(normalizeCell(cell)?.s ?? null);
}

function usedRefs(ws) {
  return Object.keys(ws)
    .filter((key) => !key.startsWith("!"))
    .sort((a, b) => {
      const da = XLSX.utils.decode_cell(a);
      const db = XLSX.utils.decode_cell(b);
      return da.r - db.r || da.c - db.c;
    });
}

function compareSheet(beforeWs, afterWs) {
  const beforeRefs = new Set(usedRefs(beforeWs));
  const afterRefs = new Set(usedRefs(afterWs));
  const allRefs = Array.from(new Set([...beforeRefs, ...afterRefs]));

  const valueChanges = [];
  const formulaChanges = [];
  const styleChanges = [];
  const missingCells = [];
  const addedCells = [];

  for (const ref of allRefs) {
    const beforeCell = normalizeCell(beforeWs[ref]);
    const afterCell = normalizeCell(afterWs[ref]);

    if (beforeCell && !afterCell) {
      missingCells.push(ref);
      continue;
    }
    if (!beforeCell && afterCell) {
      addedCells.push(ref);
      continue;
    }
    if (!beforeCell || !afterCell) continue;

    if (String(beforeCell.v ?? "") !== String(afterCell.v ?? "")) {
      valueChanges.push({ ref, before: beforeCell.v, after: afterCell.v });
    }
    if ((beforeCell.f ?? null) !== (afterCell.f ?? null)) {
      formulaChanges.push({ ref, before: beforeCell.f, after: afterCell.f });
    }
    if (styleKey(beforeWs[ref]) !== styleKey(afterWs[ref])) {
      styleChanges.push({ ref });
    }
  }

  return {
    rangeBefore: beforeWs["!ref"] ?? null,
    rangeAfter: afterWs["!ref"] ?? null,
    mergesBefore: beforeWs["!merges"]?.length ?? 0,
    mergesAfter: afterWs["!merges"]?.length ?? 0,
    colsBefore: beforeWs["!cols"]?.length ?? 0,
    colsAfter: afterWs["!cols"]?.length ?? 0,
    rowsBefore: beforeWs["!rows"]?.length ?? 0,
    rowsAfter: afterWs["!rows"]?.length ?? 0,
    valueChanges: valueChanges.slice(0, 40),
    valueChangeCount: valueChanges.length,
    formulaChanges: formulaChanges.slice(0, 40),
    formulaChangeCount: formulaChanges.length,
    styleChanges: styleChanges.slice(0, 40),
    styleChangeCount: styleChanges.length,
    missingCells: missingCells.slice(0, 40),
    missingCellCount: missingCells.length,
    addedCells: addedCells.slice(0, 40),
    addedCellCount: addedCells.length,
  };
}

const before = readWorkbook(beforeArg);
const after = readWorkbook(afterArg);

const report = {
  beforeFile: beforeArg,
  afterFile: afterArg,
  beforeSheets: before.SheetNames,
  afterSheets: after.SheetNames,
  sheets: {},
};

for (const sheetName of before.SheetNames) {
  if (!after.Sheets[sheetName]) {
    report.sheets[sheetName] = { missingAfter: true };
    continue;
  }
  report.sheets[sheetName] = compareSheet(before.Sheets[sheetName], after.Sheets[sheetName]);
}

for (const sheetName of after.SheetNames) {
  if (!before.Sheets[sheetName]) {
    report.sheets[sheetName] = { addedAfter: true };
  }
}

console.log(JSON.stringify(report, null, 2));
