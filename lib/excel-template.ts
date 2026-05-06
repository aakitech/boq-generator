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
  fgColor: { argb: "FFD9D9D9" },
};

const BILL_HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFBFBFBF" },
};

function baseFont(bold = false, size = FONT_SIZE, italic = false): Partial<ExcelJS.Font> {
  return { name: FONT_NAME, size, bold, italic };
}

function center(wrapText = false): Partial<ExcelJS.Alignment> {
  return { horizontal: "center", vertical: "top", wrapText };
}

function left(wrapText = false): Partial<ExcelJS.Alignment> {
  return { horizontal: "left", vertical: "top", wrapText };
}

// ─── Column layout ─────────────────────────────────────────────────────────────
// ITEM | DESCRIPTION | UNIT | QTY | RATE | AMOUNT
//   1        2           3     4     5       6

const COL_ITEM   = 1;
const COL_DESC   = 2;
const COL_UNIT   = 3;
const COL_QTY    = 4;
const COL_RATE   = 5;
const COL_AMOUNT = 6;

// Widths tuned to match Innocent's column proportions
const COLUMN_WIDTHS = [8, 58, 9, 11, 14, 18];

// ─── Row height estimation ─────────────────────────────────────────────────────
// ExcelJS doesn't auto-size row heights for wrapped text.
// Estimate based on description character count at column width ~58 chars.

const DESC_COL_CHARS = 58;
const LINE_HEIGHT_PT  = 15; // points per line at 11pt Century Gothic
const ROW_PADDING_PT  = 6;

function estimateRowHeight(text: string): number {
  if (!text) return LINE_HEIGHT_PT + ROW_PADDING_PT;
  const lines = Math.ceil(text.length / DESC_COL_CHARS);
  return Math.max(lines * LINE_HEIGHT_PT + ROW_PADDING_PT, LINE_HEIGHT_PT + ROW_PADDING_PT);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function alphaItem(index: number): string {
  let result = "";
  let i = index;
  do {
    result = String.fromCharCode(65 + (i % 26)) + result;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return result;
}

function mergeRow(sheet: ExcelJS.Worksheet, rowNum: number, startCol: number, endCol: number) {
  sheet.mergeCells(rowNum, startCol, rowNum, endCol);
}

function setColumnWidths(sheet: ExcelJS.Worksheet) {
  COLUMN_WIDTHS.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
}

function blankRow(sheet: ExcelJS.Worksheet, r: number): number {
  sheet.getRow(r).height = 14;
  return r + 1;
}

// ─── Document header ───────────────────────────────────────────────────────────

function writeHeaderBlock(sheet: ExcelJS.Worksheet, boq: BOQDocument): number {
  let r = 1;

  r = blankRow(sheet, r);

  // "BILL OF QUANTITIES"
  mergeRow(sheet, r, COL_ITEM, COL_AMOUNT);
  const titleCell = sheet.getRow(r).getCell(COL_ITEM);
  titleCell.value = "BILL OF QUANTITIES";
  titleCell.font = baseFont(true, 14);
  titleCell.fill = HEADER_FILL;
  titleCell.alignment = center();
  sheet.getRow(r).height = 26;
  r++;

  // "FOR"
  mergeRow(sheet, r, COL_ITEM, COL_AMOUNT);
  const forCell = sheet.getRow(r).getCell(COL_ITEM);
  forCell.value = "FOR";
  forCell.font = baseFont(true, 11);
  forCell.fill = HEADER_FILL;
  forCell.alignment = center();
  sheet.getRow(r).height = 18;
  r++;

  // Project name
  mergeRow(sheet, r, COL_ITEM, COL_AMOUNT);
  const projCell = sheet.getRow(r).getCell(COL_ITEM);
  projCell.value = boq.project.toUpperCase();
  projCell.font = baseFont(true, 12);
  projCell.fill = HEADER_FILL;
  projCell.alignment = center(true);
  sheet.getRow(r).height = 22;
  r++;

  r = blankRow(sheet, r);

  return r;
}

// ─── Column headers ────────────────────────────────────────────────────────────

function writeColumnHeaders(sheet: ExcelJS.Worksheet, rowNum: number): void {
  const headers = ["ITEM", "DESCRIPTION", "UNIT", "QTY", "RATE", "AMOUNT"];
  const row = sheet.getRow(rowNum);
  headers.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value = h;
    cell.font = baseFont(true);
    cell.fill = HEADER_FILL;
    cell.alignment = i === 1 ? left() : center();
    cell.border = THIN_BORDER;
  });
  row.height = 20;
}

// ─── Bill title block ──────────────────────────────────────────────────────────

function writeBillTitle(
  sheet: ExcelJS.Worksheet,
  rowNum: number,
  boq: BOQDocument,
  billNum: string | number,
  billTitle: string,
): number {
  let r = rowNum;

  // "BILL No. X"
  mergeRow(sheet, r, COL_ITEM, COL_AMOUNT);
  const numCell = sheet.getRow(r).getCell(COL_ITEM);
  numCell.value = `BILL No. ${billNum}`;
  numCell.font = baseFont(true, 12);
  numCell.fill = BILL_HEADER_FILL;
  numCell.alignment = center();
  sheet.getRow(r).height = 20;
  r++;

  // Project name repeated (Innocent's format includes this per bill)
  mergeRow(sheet, r, COL_ITEM, COL_AMOUNT);
  const projCell = sheet.getRow(r).getCell(COL_ITEM);
  projCell.value = boq.project.toUpperCase();
  projCell.font = baseFont(false, 11);
  projCell.fill = BILL_HEADER_FILL;
  projCell.alignment = center();
  sheet.getRow(r).height = 18;
  r++;

  // Bill title
  mergeRow(sheet, r, COL_ITEM, COL_AMOUNT);
  const titleCell = sheet.getRow(r).getCell(COL_ITEM);
  titleCell.value = billTitle.toUpperCase();
  titleCell.font = baseFont(true, 11);
  titleCell.fill = BILL_HEADER_FILL;
  titleCell.alignment = center();
  sheet.getRow(r).height = 20;
  r++;

  r = blankRow(sheet, r);

  // Column headers
  writeColumnHeaders(sheet, r);
  r++;

  r = blankRow(sheet, r);

  return r;
}

// ─── Bill items ────────────────────────────────────────────────────────────────

function writeBillItems(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  bill: BOQDocument["bills"][0],
  amountRows: number[],
): number {
  let r = startRow;
  let itemIndex = 0;

  for (const item of bill.items) {
    if (item.is_header) {
      // Section heading — description column only, bold, no fill
      // Innocent uses italic for sub-section headings (Preambles, trade sections)
      mergeRow(sheet, r, COL_DESC, COL_AMOUNT);
      const cell = sheet.getRow(r).getCell(COL_DESC);
      cell.value = item.description;
      cell.font = baseFont(true, FONT_SIZE, false);
      cell.alignment = left(true);
      sheet.getRow(r).height = estimateRowHeight(item.description);
    } else {
      // Measurable item row
      const row = sheet.getRow(r);

      // Item letter — left-aligned (matches Innocent's style)
      const itemRef = row.getCell(COL_ITEM);
      itemRef.value = alphaItem(itemIndex);
      itemRef.font = baseFont(false);
      itemRef.alignment = left();

      const desc = row.getCell(COL_DESC);
      desc.value = item.description;
      desc.font = baseFont(false);
      desc.alignment = left(true);

      const unit = row.getCell(COL_UNIT);
      unit.value = item.unit ?? "";
      unit.font = baseFont(false);
      unit.alignment = center();

      const qty = row.getCell(COL_QTY);
      qty.value = item.qty ?? null;
      qty.font = baseFont(false);
      qty.alignment = center();
      qty.numFmt = "#,##0.00";

      const rate = row.getCell(COL_RATE);
      rate.value = item.rate ?? null;
      rate.font = baseFont(false);
      rate.alignment = center();
      rate.numFmt = "#,##0.00";

      const amount = row.getCell(COL_AMOUNT);
      amount.value = {
        formula: `${String.fromCharCode(64 + COL_QTY)}${r}*${String.fromCharCode(64 + COL_RATE)}${r}`,
        result: item.qty != null && item.rate != null ? item.qty * item.rate : undefined,
      };
      amount.font = baseFont(false);
      amount.alignment = center();
      amount.numFmt = "#,##0.00";

      amountRows.push(r);
      itemIndex++;

      // Row height based on description length so text never clips
      row.height = estimateRowHeight(item.description);
    }

    r++;
    // Full-height spacer between items (matches Innocent's generous spacing)
    r = blankRow(sheet, r);
  }

  return r;
}

// ─── Bill total ────────────────────────────────────────────────────────────────

function writeBillTotal(
  sheet: ExcelJS.Worksheet,
  rowNum: number,
  billTitle: string,
  amountRows: number[],
): number {
  let r = rowNum;
  const row = sheet.getRow(r);

  mergeRow(sheet, r, COL_DESC, COL_UNIT);
  const labelCell = row.getCell(COL_DESC);
  labelCell.value = `${billTitle.toUpperCase()} - TOTAL TO SUMMARY`;
  labelCell.font = baseFont(true);
  labelCell.fill = HEADER_FILL;
  labelCell.alignment = left();
  labelCell.border = THIN_BORDER;

  const currencyCell = row.getCell(COL_RATE);
  currencyCell.value = "ZMW";
  currencyCell.font = baseFont(true);
  currencyCell.fill = HEADER_FILL;
  currencyCell.alignment = center();
  currencyCell.border = THIN_BORDER;

  const totalCell = row.getCell(COL_AMOUNT);
  totalCell.value = amountRows.length > 0
    ? { formula: `SUM(${amountRows.map((rn) => `F${rn}`).join(",")})`, result: undefined }
    : 0;
  totalCell.font = baseFont(true);
  totalCell.fill = HEADER_FILL;
  totalCell.alignment = center();
  totalCell.border = THIN_BORDER;
  totalCell.numFmt = "#,##0.00";

  row.height = 20;
  r++;

  r = blankRow(sheet, r);
  r = blankRow(sheet, r);

  return r;
}

// ─── Grand summary ─────────────────────────────────────────────────────────────

function writeGrandSummary(
  sheet: ExcelJS.Worksheet,
  rowNum: number,
  bills: BOQDocument["bills"],
  billTotalRows: number[],
): void {
  let r = rowNum;

  // Title
  mergeRow(sheet, r, COL_ITEM, COL_AMOUNT);
  const titleCell = sheet.getRow(r).getCell(COL_ITEM);
  titleCell.value = "SUMMARY OF BILLS";
  titleCell.font = baseFont(true, 12);
  titleCell.fill = BILL_HEADER_FILL;
  titleCell.alignment = center();
  titleCell.border = THIN_BORDER;
  sheet.getRow(r).height = 22;
  r++;

  r = blankRow(sheet, r);

  const summaryTotalRefs: string[] = [];

  bills.forEach((bill, idx) => {
    const row = sheet.getRow(r);

    const numCell = row.getCell(COL_ITEM);
    numCell.value = `Bill ${bill.number}`;
    numCell.font = baseFont(false);
    numCell.alignment = left();
    numCell.border = THIN_BORDER;

    mergeRow(sheet, r, COL_DESC, COL_UNIT);
    const descCell = row.getCell(COL_DESC);
    descCell.value = bill.title;
    descCell.font = baseFont(false);
    descCell.alignment = left(true);
    descCell.border = THIN_BORDER;

    const currCell = row.getCell(COL_RATE);
    currCell.value = "ZMW";
    currCell.font = baseFont(false);
    currCell.alignment = center();
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
    totalCell.alignment = center();
    totalCell.border = THIN_BORDER;
    totalCell.numFmt = "#,##0.00";

    row.height = 18;
    r++;
    r = blankRow(sheet, r);
  });

  r = blankRow(sheet, r);

  // Grand total row
  const gtRow = sheet.getRow(r);
  mergeRow(sheet, r, COL_ITEM, COL_UNIT);
  const gtLabel = gtRow.getCell(COL_ITEM);
  gtLabel.value = "GRAND TOTAL (excl. VAT)";
  gtLabel.font = baseFont(true, 12);
  gtLabel.fill = BILL_HEADER_FILL;
  gtLabel.alignment = left();
  gtLabel.border = THIN_BORDER;

  const gtCurr = gtRow.getCell(COL_RATE);
  gtCurr.value = "ZMW";
  gtCurr.font = baseFont(true);
  gtCurr.fill = BILL_HEADER_FILL;
  gtCurr.alignment = center();
  gtCurr.border = THIN_BORDER;

  const gtTotal = gtRow.getCell(COL_AMOUNT);
  gtTotal.value = summaryTotalRefs.length > 0
    ? { formula: `SUM(${summaryTotalRefs.join(",")})`, result: undefined }
    : 0;
  gtTotal.font = baseFont(true, 12);
  gtTotal.fill = BILL_HEADER_FILL;
  gtTotal.alignment = center();
  gtTotal.border = THIN_BORDER;
  gtTotal.numFmt = "#,##0.00";
  gtRow.height = 24;
}

// ─── Main export ───────────────────────────────────────────────────────────────

export async function generateBOQExcelFromTemplate(boq: BOQDocument): Promise<Buffer> {
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
    properties: { defaultRowHeight: 15 },
  });

  setColumnWidths(sheet);

  let r = writeHeaderBlock(sheet, boq);

  const billTotalRows: number[] = [];

  for (const bill of boq.bills) {
    r = writeBillTitle(sheet, r, boq, bill.number, bill.title);

    const amountRows: number[] = [];
    r = writeBillItems(sheet, r, bill, amountRows);

    const billTotalRow = r;
    r = writeBillTotal(sheet, r, bill.title, amountRows);
    billTotalRows.push(billTotalRow);
  }

  sheet.getRow(r).height = 8;
  r++;
  writeGrandSummary(sheet, r, boq.bills, billTotalRows);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
