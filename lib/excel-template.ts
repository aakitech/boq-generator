/**
 * excel-template.ts
 *
 * Generates a BOQ Excel workbook using ExcelJS, styled to match Innocent's
 * accepted BOQ format (Century Gothic font, thin borders, Zambian layout).
 *
 * This replaces the SheetJS-based generateBOQExcel() for the SOW generate path,
 * ensuring visual parity with the rate-patching path (which also uses ExcelJS).
 */

import ExcelJS from "exceljs";
import type { BOQDocument } from "@/lib/types";

// ─── Style constants ───────────────────────────────────────────────────────────

const FONT_NAME = "Century Gothic";
const FONT_SIZE = 11;

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" }, // light grey, matches Innocent's header rows
};

const NO_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "none",
};

const BILL_HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFBFBFBF" },
};

function baseFont(bold = false, size = FONT_SIZE): Partial<ExcelJS.Font> {
  return { name: FONT_NAME, size, bold };
}

function centerMiddle(wrapText = false): Partial<ExcelJS.Alignment> {
  return { horizontal: "center", vertical: "middle", wrapText };
}

function leftMiddle(wrapText = false): Partial<ExcelJS.Alignment> {
  return { horizontal: "left", vertical: "middle", wrapText };
}

// ─── Column layout ─────────────────────────────────────────────────────────────
// ITEM | DESCRIPTION | UNIT | QTY | RATE | AMOUNT
// col:   1              2      3     4     5       6

const COL_ITEM = 1;
const COL_DESC = 2;
const COL_UNIT = 3;
const COL_QTY = 4;
const COL_RATE = 5;
const COL_AMOUNT = 6;

const COLUMN_WIDTHS = [8.5, 56, 9.5, 12, 15, 19];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function alphaItem(index: number): string {
  // 0 → A, 25 → Z, 26 → AA …
  let result = "";
  let i = index;
  do {
    result = String.fromCharCode(65 + (i % 26)) + result;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return result;
}

function mergeRow(
  sheet: ExcelJS.Worksheet,
  rowNum: number,
  startCol: number,
  endCol: number
) {
  sheet.mergeCells(rowNum, startCol, rowNum, endCol);
}

function setColumnWidths(sheet: ExcelJS.Worksheet) {
  COLUMN_WIDTHS.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

function writeHeaderBlock(
  sheet: ExcelJS.Worksheet,
  boq: BOQDocument
): number {
  let r = 1;

  // Row 1 — blank
  sheet.getRow(r).height = 8;
  r++;

  // Row 2 — "BILL OF QUANTITIES"
  const titleRow = sheet.getRow(r);
  mergeRow(sheet, r, COL_DESC, COL_AMOUNT);
  const titleCell = titleRow.getCell(COL_DESC);
  titleCell.value = "BILL OF QUANTITIES";
  titleCell.font = baseFont(true, 16);
  titleCell.fill = HEADER_FILL;
  titleCell.alignment = centerMiddle();
  titleRow.height = 28;
  r++;

  // Row 3 — "FOR"
  const forRow = sheet.getRow(r);
  mergeRow(sheet, r, COL_DESC, COL_AMOUNT);
  const forCell = forRow.getCell(COL_DESC);
  forCell.value = "FOR";
  forCell.font = baseFont(true, 12);
  forCell.fill = HEADER_FILL;
  forCell.alignment = centerMiddle();
  forRow.height = 18;
  r++;

  // Row 4 — project name
  const projRow = sheet.getRow(r);
  mergeRow(sheet, r, COL_DESC, COL_AMOUNT);
  const projCell = projRow.getCell(COL_DESC);
  projCell.value = boq.project.toUpperCase();
  projCell.font = baseFont(true, 13);
  projCell.fill = HEADER_FILL;
  projCell.alignment = centerMiddle(true);
  projRow.height = 24;
  r++;

  // Row 5 — blank
  sheet.getRow(r).height = 8;
  r++;

  return r;
}

function writeColumnHeaders(
  sheet: ExcelJS.Worksheet,
  rowNum: number
): void {
  const headers = ["ITEM", "DESCRIPTION", "UNIT", "QTY", "RATE", "AMOUNT"];
  const row = sheet.getRow(rowNum);
  headers.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value = h;
    cell.font = baseFont(true);
    cell.fill = HEADER_FILL;
    cell.alignment = centerMiddle();
    cell.border = THIN_BORDER;
  });
  row.height = 22;
}

function writeBillTitle(
  sheet: ExcelJS.Worksheet,
  rowNum: number,
  billNum: number,
  billTitle: string
): number {
  let r = rowNum;

  // "BILL No. X"
  const numRow = sheet.getRow(r);
  mergeRow(sheet, r, COL_ITEM, COL_AMOUNT);
  const numCell = numRow.getCell(COL_ITEM);
  numCell.value = `BILL No. ${billNum}`;
  numCell.font = baseFont(true, 12);
  numCell.fill = BILL_HEADER_FILL;
  numCell.alignment = leftMiddle();
  numRow.height = 20;
  r++;

  // Bill title
  const titleRow = sheet.getRow(r);
  mergeRow(sheet, r, COL_ITEM, COL_AMOUNT);
  const titleCell = titleRow.getCell(COL_ITEM);
  titleCell.value = billTitle.toUpperCase();
  titleCell.font = baseFont(true, 12);
  titleCell.fill = BILL_HEADER_FILL;
  titleCell.alignment = leftMiddle(true);
  titleRow.height = 20;
  r++;

  // Blank row
  sheet.getRow(r).height = 8;
  r++;

  // Column headers repeated per bill
  writeColumnHeaders(sheet, r);
  r++;

  // Blank row
  sheet.getRow(r).height = 8;
  r++;

  return r;
}

function writeBillItems(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  bill: BOQDocument["bills"][0],
  // track row numbers for the amount formula range
  amountRows: number[]
): number {
  let r = startRow;
  let itemIndex = 0;

  for (const item of bill.items) {
    if (item.is_header) {
      // Section heading — spans description through amount, no border
      const row = sheet.getRow(r);
      mergeRow(sheet, r, COL_DESC, COL_AMOUNT);
      const cell = row.getCell(COL_DESC);
      cell.value = item.description;
      cell.font = baseFont(true);
      cell.fill = NO_FILL;
      cell.alignment = leftMiddle();
      row.height = 18;
    } else {
      // Measurable item row — no borders, clean open look
      const row = sheet.getRow(r);

      const itemRef = row.getCell(COL_ITEM);
      itemRef.value = alphaItem(itemIndex);
      itemRef.font = baseFont(false);
      itemRef.alignment = centerMiddle();

      const desc = row.getCell(COL_DESC);
      desc.value = item.description;
      desc.font = baseFont(false);
      desc.alignment = leftMiddle(true);

      const unit = row.getCell(COL_UNIT);
      unit.value = item.unit ?? "";
      unit.font = baseFont(false);
      unit.alignment = centerMiddle();

      const qty = row.getCell(COL_QTY);
      qty.value = item.qty ?? null;
      qty.font = baseFont(false);
      qty.alignment = centerMiddle();
      qty.numFmt = "#,##0.00";

      const rate = row.getCell(COL_RATE);
      rate.value = item.rate ?? null;
      rate.font = baseFont(false);
      rate.alignment = centerMiddle();
      rate.numFmt = "#,##0.00";

      const amount = row.getCell(COL_AMOUNT);
      // Formula: qty * rate (D=col4, E=col5)
      amount.value = {
        formula: `${String.fromCharCode(64 + COL_QTY)}${r}*${String.fromCharCode(64 + COL_RATE)}${r}`,
        result: item.qty != null && item.rate != null ? item.qty * item.rate : undefined,
      };
      amount.font = baseFont(false);
      amount.alignment = centerMiddle();
      amount.numFmt = "#,##0.00";

      amountRows.push(r);
      itemIndex++;
      row.height = 18;
    }

    r++;
    // Blank row after each item
    sheet.getRow(r).height = 8;
    r++;
  }

  return r;
}

function writeBillTotal(
  sheet: ExcelJS.Worksheet,
  rowNum: number,
  billTitle: string,
  amountRows: number[]
): number {
  let r = rowNum;

  const row = sheet.getRow(r);
  mergeRow(sheet, r, COL_DESC, COL_UNIT);
  const labelCell = row.getCell(COL_DESC);
  labelCell.value = `${billTitle.toUpperCase()} — TOTAL`;
  labelCell.font = baseFont(true);
  labelCell.fill = HEADER_FILL;
  labelCell.alignment = leftMiddle();
  labelCell.border = THIN_BORDER;

  const currencyCell = row.getCell(COL_RATE);
  currencyCell.value = "ZMW";
  currencyCell.font = baseFont(true);
  currencyCell.fill = HEADER_FILL;
  currencyCell.alignment = centerMiddle();
  currencyCell.border = THIN_BORDER;

  const totalCell = row.getCell(COL_AMOUNT);
  if (amountRows.length > 0) {
    const refs = amountRows
      .map((rn) => `F${rn}`)
      .join(",");
    totalCell.value = { formula: `SUM(${refs})`, result: undefined };
  } else {
    totalCell.value = 0;
  }
  totalCell.font = baseFont(true);
  totalCell.fill = HEADER_FILL;
  totalCell.alignment = centerMiddle();
  totalCell.border = THIN_BORDER;
  totalCell.numFmt = "#,##0.00";

  row.height = 20;
  r++;

  sheet.getRow(r).height = 8;
  r++;

  return r;
}

function writeGrandSummary(
  sheet: ExcelJS.Worksheet,
  rowNum: number,
  bills: BOQDocument["bills"],
  billTotalRows: number[]
): void {
  let r = rowNum;

  // Title
  const titleRow = sheet.getRow(r);
  mergeRow(sheet, r, COL_ITEM, COL_AMOUNT);
  const titleCell = titleRow.getCell(COL_ITEM);
  titleCell.value = "SUMMARY OF BILLS";
  titleCell.font = baseFont(true, 13);
  titleCell.fill = BILL_HEADER_FILL;
  titleCell.alignment = centerMiddle();
  titleCell.border = THIN_BORDER;
  titleRow.height = 22;
  r++;

  sheet.getRow(r).height = 8;
  r++;

  const summaryTotalRefs: string[] = [];

  bills.forEach((bill, idx) => {
    const row = sheet.getRow(r);

    const numCell = row.getCell(COL_ITEM);
    numCell.value = `Bill ${bill.number}`;
    numCell.font = baseFont(false);
    numCell.alignment = centerMiddle();
    numCell.border = THIN_BORDER;

    mergeRow(sheet, r, COL_DESC, COL_UNIT);
    const descCell = row.getCell(COL_DESC);
    descCell.value = bill.title;
    descCell.font = baseFont(false);
    descCell.alignment = leftMiddle(true);
    descCell.border = THIN_BORDER;

    const currCell = row.getCell(COL_RATE);
    currCell.value = "ZMW";
    currCell.font = baseFont(false);
    currCell.alignment = centerMiddle();
    currCell.border = THIN_BORDER;

    const totalCell = row.getCell(COL_AMOUNT);
    if (billTotalRows[idx] !== undefined) {
      const ref = `F${billTotalRows[idx]}`;
      totalCell.value = { formula: ref, result: undefined };
      summaryTotalRefs.push(ref);
    } else {
      totalCell.value = 0;
    }
    totalCell.font = baseFont(false);
    totalCell.alignment = centerMiddle();
    totalCell.border = THIN_BORDER;
    totalCell.numFmt = "#,##0.00";

    row.height = 18;
    r++;
    sheet.getRow(r).height = 4;
    r++;
  });

  sheet.getRow(r).height = 8;
  r++;

  // Grand total row
  const gtRow = sheet.getRow(r);
  mergeRow(sheet, r, COL_ITEM, COL_UNIT);
  const gtLabel = gtRow.getCell(COL_ITEM);
  gtLabel.value = "GRAND TOTAL (excl. VAT)";
  gtLabel.font = baseFont(true, 12);
  gtLabel.fill = BILL_HEADER_FILL;
  gtLabel.alignment = leftMiddle();
  gtLabel.border = THIN_BORDER;

  const gtCurr = gtRow.getCell(COL_RATE);
  gtCurr.value = "ZMW";
  gtCurr.font = baseFont(true);
  gtCurr.fill = BILL_HEADER_FILL;
  gtCurr.alignment = centerMiddle();
  gtCurr.border = THIN_BORDER;

  const gtTotal = gtRow.getCell(COL_AMOUNT);
  if (summaryTotalRefs.length > 0) {
    gtTotal.value = { formula: `SUM(${summaryTotalRefs.join(",")})`, result: undefined };
  } else {
    gtTotal.value = 0;
  }
  gtTotal.font = baseFont(true, 12);
  gtTotal.fill = BILL_HEADER_FILL;
  gtTotal.alignment = centerMiddle();
  gtTotal.border = THIN_BORDER;
  gtTotal.numFmt = "#,##0.00";
  gtRow.height = 24;
}

// ─── Main export ───────────────────────────────────────────────────────────────

export async function generateBOQExcelFromTemplate(
  boq: BOQDocument
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BOQ Generator";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("BOQ", {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
    properties: {
      defaultRowHeight: 15,
    },
  });

  setColumnWidths(sheet);

  let r = writeHeaderBlock(sheet, boq);

  const billTotalRows: number[] = [];

  for (const bill of boq.bills) {
    r = writeBillTitle(sheet, r, bill.number, bill.title);

    const amountRows: number[] = [];
    r = writeBillItems(sheet, r, bill, amountRows);

    const billTotalRow = r;
    r = writeBillTotal(sheet, r, bill.title, amountRows);
    billTotalRows.push(billTotalRow);
  }

  // Grand summary
  sheet.getRow(r).height = 8;
  r++;
  writeGrandSummary(sheet, r, boq.bills, billTotalRows);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
