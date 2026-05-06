import * as XLSX from "xlsx";
import type {
  BOQBill,
  BOQDocument,
  BOQItem,
  BOQWorkbookPreservation,
  BOQWorkbookSheetStat,
} from "./types";

type CellStyle = {
  font?: { bold?: boolean; sz?: number; name?: string; color?: { rgb: string } };
  fill?: { fgColor: { rgb: string } };
  alignment?: { horizontal?: string; vertical?: string; wrapText?: boolean };
  border?: {
    top?: { style: string; color: { rgb: string } };
    bottom?: { style: string; color: { rgb: string } };
    left?: { style: string; color: { rgb: string } };
    right?: { style: string; color: { rgb: string } };
  };
  numFmt?: string;
};

type Cell = {
  v: string | number | null;
  t: "s" | "n";
  s?: CellStyle;
};

type WorkbookColumnMap = {
  itemNoCol: number;
  descriptionCol: number;
  unitCol: number;
  qtyCol: number;
  rateCol: number;
  amountCol: number;
  headerRow: number;
  rateHeader: string | null;
  amountHeader: string | null;
  qtyHeader: string | null;
};

type WorkbookExtractionOptions = {
  rateColumnHeader?: string | null;
  amountColumnHeader?: string | null;
};

type WorkbookRowRecord = {
  sheetName: string;
  rowNumber: number;
  description: string;
  unit: string;
  context: string;
  normalizedKey: string;
};

type SheetExtractionResult = {
  bills: BOQBill[];
  stats: BOQWorkbookSheetStat;
};

function cell(v: string | number | null, s?: CellStyle): Cell {
  return { v, t: typeof v === "number" ? "n" : "s", s };
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTrimmed(value: unknown): string {
  return String(value ?? "").trim();
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = toTrimmed(value).replace(/,/g, "");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function findFirstNonEmptyCell(row: unknown[]): { index: number; value: string } | null {
  for (let i = 0; i < row.length; i += 1) {
    const value = toTrimmed(row[i]);
    if (value) return { index: i, value };
  }
  return null;
}

function nonEmptyValues(row: unknown[]): string[] {
  return row.map((cell) => toTrimmed(cell)).filter(Boolean);
}

function isBillMarkerRow(row: unknown[]): boolean {
  return nonEmptyValues(row).some((value) => /^bill\s*no\.?\s*\d+/i.test(value));
}

function detectHeaderRow(row: unknown[], rowIndex: number): WorkbookColumnMap | null {
  const normalized = row.map((cell) => normalizeText(cell));

  const descriptionCol = normalized.findIndex((value) => value === "description");
  const unitCol = normalized.findIndex((value) => value === "unit");
  const qtyCol = normalized.findIndex((value) => ["qty", "quantity", "q ty", "quantities"].includes(value));
  const rateCol = normalized.findIndex((value) => value === "rate" || value === "unit rate" || value === "rate zmw");
  const amountCol = normalized.findIndex((value) => value === "amount" || value === "total" || value === "amount zmw");

  if (descriptionCol === -1 || unitCol === -1 || qtyCol === -1) return null;

  return {
    itemNoCol: Math.max(descriptionCol - 1, 0),
    descriptionCol,
    unitCol,
    qtyCol,
    rateCol,
    amountCol,
    headerRow: rowIndex,
    rateHeader: rateCol >= 0 ? toTrimmed(row[rateCol]) : null,
    amountHeader: amountCol >= 0 ? toTrimmed(row[amountCol]) : null,
    qtyHeader: qtyCol >= 0 ? toTrimmed(row[qtyCol]) : null,
  };
}

function buildItemKey(sheetName: string, rowNumber: number, billTitle: string, description: string, unit: string): string {
  return [
    `sheet:${normalizeText(sheetName) || "sheet"}`,
    `row:${rowNumber}`,
    `bill:${normalizeText(billTitle) || "unassigned"}`,
    `desc:${normalizeText(description) || "blank"}`,
    `unit:${normalizeText(unit) || "none"}`,
  ].join("|");
}

function parseSourceAnchor(sourceAnchor?: string | null): { sheet: string; row: number } | null {
  if (!sourceAnchor) return null;
  const match = /^sheet:(.+);row:(\d+)$/i.exec(sourceAnchor.trim());
  if (!match) return null;
  return { sheet: match[1], row: Number(match[2]) };
}

function buildNormalizedRowKey(description: string, unit: string): string {
  return `${normalizeText(description)}::${normalizeText(unit)}`;
}

function looksLikeSummaryRow(description: string): boolean {
  return /total|summary|carried to/i.test(description);
}

function inferWorkbookMetadata(rows: unknown[][]): Pick<BOQDocument, "project" | "location" | "prepared_by" | "date"> {
  const defaults = {
    project: "Uploaded BOQ",
    location: "Zambia",
    prepared_by: "BOQ Generator",
    date: new Date().toISOString().slice(0, 10),
  };

  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const values = nonEmptyValues(rows[i]);
    if (values.length === 0) continue;
    if (values[0].toUpperCase() === "FOR" && rows[i + 1]) {
      const nextValues = nonEmptyValues(rows[i + 1]);
      if (nextValues.length > 0) defaults.project = nextValues[0];
    }
    if (values[0].toUpperCase() === "AT" && rows[i + 1]) {
      const nextValues = nonEmptyValues(rows[i + 1]);
      if (nextValues.length > 0) defaults.location = nextValues[0];
    }
    if (values[0].toUpperCase() === "DATE") {
      defaults.date = values[1] || values[0] || defaults.date;
    }
    if (values[0].toUpperCase() === "PREPARED BY") {
      defaults.prepared_by = values[1] || defaults.prepared_by;
    }
  }

  return defaults;
}

function mergeWorkbookMetadata(
  candidates: Array<Pick<BOQDocument, "project" | "location" | "prepared_by" | "date">>
): Pick<BOQDocument, "project" | "location" | "prepared_by" | "date"> {
  const defaults = {
    project: "Uploaded BOQ",
    location: "Zambia",
    prepared_by: "BOQ Generator",
    date: new Date().toISOString().slice(0, 10),
  };

  const pickFirstMeaningful = (
    selector: (candidate: Pick<BOQDocument, "project" | "location" | "prepared_by" | "date">) => string,
    fallback: string
  ) => {
    const meaningful = candidates
      .map(selector)
      .map((value) => value.trim())
      .find((value) => value && value !== fallback);
    return meaningful ?? fallback;
  };

  return {
    project: pickFirstMeaningful((candidate) => candidate.project, defaults.project),
    location: pickFirstMeaningful((candidate) => candidate.location, defaults.location),
    prepared_by: pickFirstMeaningful((candidate) => candidate.prepared_by, defaults.prepared_by),
    date: pickFirstMeaningful((candidate) => candidate.date, defaults.date),
  };
}

function sheetIgnoredReason(stats: BOQWorkbookSheetStat, bills: BOQBill[]): BOQWorkbookSheetStat["ignored_reason"] {
  const totalRows = bills.reduce((sum, bill) => sum + bill.items.length, 0);
  if (totalRows === 0) return "empty_sheet";
  if (stats.mapped_item_rows === 0 && stats.preserved_summary_rows > 0) return "summary_only";
  if (stats.mapped_item_rows === 0) return "no_measurable_items";
  return null;
}

function extractSheetBOQ(
  sheetName: string,
  ws: XLSX.WorkSheet,
  options: WorkbookExtractionOptions = {}
): SheetExtractionResult {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");

  let currentColumns: WorkbookColumnMap | null = null;
  let currentBillTitle = "Front Matter";
  let currentBillNumber = 0;
  let currentSection: string | null = null;
  let pendingBillTitle = false;
  let repeatedHeaderCount = 0;
  let preservedSummaryRows = 0;
  let mappedItemRows = 0;

  const bills: BOQBill[] = [];
  const ensureBill = () => {
    let bill = bills.find((entry) => entry.number === currentBillNumber && entry.title === currentBillTitle);
    if (!bill) {
      bill = { number: currentBillNumber, title: currentBillTitle, items: [] };
      bills.push(bill);
    }
    return bill;
  };

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const header = detectHeaderRow(row, rowIndex);
    if (header) {
      currentColumns = header;
      repeatedHeaderCount += 1;
      continue;
    }

    if (isBillMarkerRow(row)) {
      const values = nonEmptyValues(row);
      const marker = values.find((value) => /^bill\s*no\.?\s*\d+/i.test(value));
      const parsedBillNumber = marker ? Number((marker.match(/\d+/) ?? ["0"])[0]) : currentBillNumber + 1;
      currentBillNumber = Number.isFinite(parsedBillNumber) ? parsedBillNumber : currentBillNumber + 1;
      currentBillTitle = marker ?? `Bill ${currentBillNumber}`;
      currentSection = null;
      pendingBillTitle = true;
      continue;
    }

    const firstNonEmpty = findFirstNonEmptyCell(row);
    if (!firstNonEmpty) continue;

    if (pendingBillTitle) {
      const values = nonEmptyValues(row);
      if (values.length === 1 && !/^item$/i.test(values[0]) && !isBillMarkerRow(row)) {
        currentBillTitle = values[0];
        pendingBillTitle = false;
        ensureBill();
        continue;
      }
      pendingBillTitle = false;
    }

    const columns = currentColumns ?? {
      itemNoCol: 0,
      descriptionCol: 1,
      unitCol: 2,
      qtyCol: 3,
      rateCol: 4,
      amountCol: 5,
      headerRow: -1,
      rateHeader: options.rateColumnHeader ?? null,
      amountHeader: options.amountColumnHeader ?? null,
      qtyHeader: "QTY",
    };

    const itemNo = toTrimmed(row[columns.itemNoCol]);
    const description = toTrimmed(row[columns.descriptionCol] ?? firstNonEmpty.value);
    const unit = toTrimmed(row[columns.unitCol]);
    const qty = parseNumber(row[columns.qtyCol]);
    const rateCell = toTrimmed(row[columns.rateCol]);
    const amountCell = columns.amountCol >= 0 ? row[columns.amountCol] : null;
    const amount = parseNumber(amountCell);
    const rate = /^incl$/i.test(rateCell) ? null : parseNumber(rateCell);

    if (!description || /^item$/i.test(description) || /^description$/i.test(description)) continue;

    const isSummaryRow = looksLikeSummaryRow(description);
    const isMeasuredRow = Boolean(unit) || qty !== null;
    const isHeaderRow =
      !isMeasuredRow &&
      rate === null &&
      (amount === null || amount === 0) &&
      !/^incl$/i.test(rateCell);

    if (!isMeasuredRow && !isHeaderRow && !isSummaryRow && !itemNo) continue;

    if (isHeaderRow && !isSummaryRow) {
      currentSection = description;
    }

    const bill = ensureBill();
    if (isSummaryRow) preservedSummaryRows += 1;
    if (isMeasuredRow && !isSummaryRow) mappedItemRows += 1;

    const sourceAnchor = `sheet:${sheetName};row:${rowIndex + 1}`;
    const workbookContext = currentSection ? `${currentBillTitle} > ${currentSection}` : currentBillTitle;
    const kind =
      isSummaryRow ? "summary_row" :
      isHeaderRow ? (currentBillNumber === 0 ? "preamble" : "header") :
      "measured_item";

    bill.items.push({
      item_key: buildItemKey(sheetName, rowIndex + 1, currentBillTitle, description, unit),
      item_no: itemNo,
      description,
      unit: unit || "",
      qty,
      rate,
      amount,
      quantity_source: qty !== null ? "explicit" : undefined,
      quantity_confidence: qty !== null ? 1 : null,
      source_anchor: sourceAnchor,
      source_document: sheetName,
      evidence_type: "tabulated_scope",
      is_header: isHeaderRow || isSummaryRow,
      note: /^incl$/i.test(rateCell) ? "Incl" : undefined,
      rate_source: rate !== null ? "existing_workbook_rate" : undefined,
      rate_source_detail: rate !== null ? "Existing rate found in uploaded workbook." : null,
      rate_confidence: rate !== null ? 1 : null,
      workbook_row_kind: kind,
      workbook_context: workbookContext,
    });
  }

  const stats: BOQWorkbookSheetStat = {
    sheet_name: sheetName,
    source_row_count: range.e.r + 1,
    source_col_count: range.e.c + 1,
    mapped_item_rows: mappedItemRows,
    repeated_header_count: repeatedHeaderCount,
    preserved_summary_rows: preservedSummaryRows,
    rate_column_header: currentColumns?.rateHeader ?? options.rateColumnHeader ?? null,
    amount_column_header: currentColumns?.amountHeader ?? options.amountColumnHeader ?? null,
    qty_column_header: currentColumns?.qtyHeader ?? null,
    ignored_reason: null,
  };

  stats.ignored_reason = sheetIgnoredReason(stats, bills);

  return {
    bills: bills.filter((bill) => bill.items.length > 0),
    stats,
  };
}

export function extractWorkbookBOQ(
  buffer: Buffer,
  options: WorkbookExtractionOptions = {}
): BOQDocument {
  const wb = XLSX.read(buffer, { type: "buffer", cellFormula: true, cellStyles: true });
  const sheetNames = wb.SheetNames;
  if (sheetNames.length === 0) {
    return {
      project: "Uploaded BOQ",
      location: "Zambia",
      prepared_by: "BOQ Generator",
      date: new Date().toISOString().slice(0, 10),
      bills: [],
      pipeline_version: "excel-rate-v2.0",
    };
  }

  const sheetMetadata: Array<Pick<BOQDocument, "project" | "location" | "prepared_by" | "date">> = [];
  const perSheetStats: BOQWorkbookSheetStat[] = [];
  const bills: BOQBill[] = [];

  for (const sheetName of sheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
    sheetMetadata.push(inferWorkbookMetadata(rows));

    const { bills: sheetBills, stats } = extractSheetBOQ(sheetName, ws, options);
    perSheetStats.push(stats);

    if (stats.ignored_reason) continue;
    bills.push(...sheetBills);
  }

  const primarySheet =
    perSheetStats.find((stats) => !stats.ignored_reason) ??
    perSheetStats[0];

  const mappedSheetNames = perSheetStats.filter((stats) => !stats.ignored_reason).map((stats) => stats.sheet_name);
  const ignoredSheetNames = perSheetStats.filter((stats) => stats.ignored_reason).map((stats) => stats.sheet_name);

  const workbookPreservation: BOQWorkbookPreservation = {
    sheet_name: primarySheet?.sheet_name ?? sheetNames[0] ?? "Workbook",
    source_row_count: perSheetStats.reduce((sum, stats) => sum + stats.source_row_count, 0),
    source_col_count: perSheetStats.reduce((max, stats) => Math.max(max, stats.source_col_count), 0),
    mapped_item_rows: perSheetStats.reduce((sum, stats) => sum + stats.mapped_item_rows, 0),
    repeated_header_count: perSheetStats.reduce((sum, stats) => sum + stats.repeated_header_count, 0),
    preserved_summary_rows: perSheetStats.reduce((sum, stats) => sum + stats.preserved_summary_rows, 0),
    ambiguous_item_rows: 0,
    workbook_local_rate_matches: 0,
    ai_priced_rows: 0,
    unresolved_rate_rows: bills.flatMap((bill) => bill.items).filter((item) => !item.is_header && item.rate === null).length,
    outlier_rate_rows: 0,
    rate_column_header: primarySheet?.rate_column_header ?? options.rateColumnHeader ?? null,
    amount_column_header: primarySheet?.amount_column_header ?? options.amountColumnHeader ?? null,
    qty_column_header: primarySheet?.qty_column_header ?? null,
    workbook_sheet_names: sheetNames,
    mapped_sheet_names: mappedSheetNames,
    ignored_sheet_names: ignoredSheetNames,
    total_sheet_count: sheetNames.length,
    mapped_sheet_count: mappedSheetNames.length,
    ignored_sheet_count: ignoredSheetNames.length,
    per_sheet_stats: perSheetStats,
  };

  return {
    ...mergeWorkbookMetadata(sheetMetadata),
    bills,
    pipeline_version: "excel-rate-v2.0",
    workbook_preservation: workbookPreservation,
  };
}

const COLORS = {
  header_bg: "FFFFFF",
  bill_bg: "E5E7EB",
  subheader_bg: "F3F4F6",
  total_bg: "E5E7EB",
  white: "FFFFFF",
  black: "111111",
  light_gray: "F9FAFB",
  border: "D1D5DB",
  dark_border: "6B7280",
};

const borderThin = (color = COLORS.border) => ({
  top: { style: "thin", color: { rgb: color } },
  bottom: { style: "thin", color: { rgb: color } },
  left: { style: "thin", color: { rgb: color } },
  right: { style: "thin", color: { rgb: color } },
});

const borderMedium = (color = COLORS.dark_border) => ({
  top: { style: "medium", color: { rgb: color } },
  bottom: { style: "medium", color: { rgb: color } },
  left: { style: "medium", color: { rgb: color } },
  right: { style: "medium", color: { rgb: color } },
});

const STANDARD_PREAMBLES = [
  {
    no: "i",
    text: "A contractor shall familiarise himself with the works as no claims, due to failure to understand the scope of works shall be accepted",
  },
  {
    no: "ii",
    text: "Contractor shall allow in his rates the price of materials, transportation, plant, equipment, personnel and any other services required during execution of works",
  },
  {
    no: "iii",
    text: "All rates must include the supply and installation of new items/materials",
  },
  {
    no: "iv",
    text: "Where there is a discrepancy between the drawings and BOQ, consult the Engineer or other authorised client's site representative",
  },
  {
    no: "v",
    text: "The net quantities in the BOQ shall not be used for the purpose of ordering materials. All measurements must be confirmed prior to procurement of materials",
  },
  {
    no: "vi",
    text: "Samples of materials to be availed to the Engineer for approval prior to procurement; as applicable to the project",
  },
  {
    no: "vii",
    text: "Contractor shall provide signs and safety barrier tapes to be erected at site and to ensure good housekeeping at all times",
  },
  {
    no: "viii",
    text: "The contractor shall provide all required PPE i.e. helmets, gloves, safety boots, eye goggles, dust mask, work suit, etc. for his workmanship",
  },
  {
    no: "ix",
    text: "The contractor will be held responsible for any loss or damage of existing works",
  },
  {
    no: "x",
    text: "During the execution of works, site security will be the responsibility of the contractor",
  },
  {
    no: "xi",
    text: "Before handover, the contractor must clean up and dump the waste/debris to designated dump site",
  },
  {
    no: "xii",
    text: "The contractor is to make good disturbed works by all trades before handover",
  },
  {
    no: "xiii",
    text: "Unless indicated, a Contractor shall supply all materials, labour and equipment",
  },
  {
    no: "xiv",
    text: "The Contractor is to carefully read and understand the scope/BOQ as any cost that will arise from failure to understand the scope will fall on the contractor",
  },
];

function sanitizeSheetName(name: string): string {
  // Excel sheet name: max 31 chars, no : \ / ? * [ ]
  return name
    .replace(/[:\\/?*[\]]/g, "")
    .substring(0, 31)
    .trim() || "BOQ";
}

function unresolvedPlaceholder(item: BOQItem): string {
  if (item.note === "Incl") return "Incl";
  if (item.qty === null && item.rate === null) return "TO BE COMPLETED";
  return "";
}

export function generateBOQExcel(boq: BOQDocument): Buffer {
  const wb = XLSX.utils.book_new();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ws: { [key: string]: any } = {};
  const merges: XLSX.Range[] = [];
  const rowHeights: Array<{ hpt: number }> = [];

  let row = 1; // 1-indexed

  function setCell(r: number, c: number, v: string | number | null, s?: CellStyle) {
    const ref = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
    ws[ref] = cell(v, s);
  }

  function styleRange(r1: number, c1: number, r2: number, c2: number, s: CellStyle) {
    for (let r = r1; r <= r2; r += 1) {
      for (let c = c1; c <= c2; c += 1) {
        const ref = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
        const existing = ws[ref];
        if (existing) {
          existing.s = s;
        } else {
          ws[ref] = cell("", s);
        }
      }
    }
  }

  function merge(r1: number, c1: number, r2: number, c2: number) {
    merges.push({ s: { r: r1 - 1, c: c1 - 1 }, e: { r: r2 - 1, c: c2 - 1 } });
  }

  function setRowHeight(r: number, hpt: number) {
    rowHeights[r - 1] = { hpt };
  }

  function blankRow() {
    row++;
  }

  // ─── METADATA HEADER ─────────────────────────────────────────────────────
  const titleStyle: CellStyle = {
    font: { bold: true, sz: 16, name: "Arial", color: { rgb: COLORS.black } },
    fill: { fgColor: { rgb: COLORS.header_bg } },
    alignment: { horizontal: "center", vertical: "center" },
  };
  const metaLabelStyle: CellStyle = {
    font: { bold: true, sz: 11, name: "Arial", color: { rgb: COLORS.black } },
    fill: { fgColor: { rgb: COLORS.header_bg } },
    alignment: { horizontal: "center", vertical: "center" },
  };
  const metaValueStyle: CellStyle = {
    font: { bold: true, sz: 12, name: "Arial", color: { rgb: COLORS.black } },
    fill: { fgColor: { rgb: COLORS.header_bg } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
  };

  blankRow();
  setCell(row, 2, "BILL OF QUANTITIES", titleStyle);
  merge(row, 2, row, 5);
  styleRange(row, 2, row, 5, titleStyle);
  setRowHeight(row, 24);
  row++;

  setCell(row, 2, "FOR", metaLabelStyle);
  merge(row, 2, row, 5);
  styleRange(row, 2, row, 5, metaLabelStyle);
  setRowHeight(row, 18);
  row++;

  const projectTitleStyle: CellStyle = {
    ...metaValueStyle,
    font: { ...metaValueStyle.font, sz: 13, bold: true },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
  };
  setCell(row, 2, boq.project.toUpperCase(), projectTitleStyle);
  merge(row, 2, row, 5);
  styleRange(row, 2, row, 5, projectTitleStyle);
  setRowHeight(row, 22);
  row++;

  blankRow();

  // ─── COLUMN HEADERS (top-level, for preambles section) ───────────────────
  const colHeaderStyle: CellStyle = {
    font: { bold: true, sz: 11, name: "Arial", color: { rgb: COLORS.black } },
    fill: { fgColor: { rgb: COLORS.header_bg } },
    alignment: { horizontal: "center", vertical: "center" },
    border: borderThin(),
  };
  const headers = ["ITEM", "DESCRIPTION", "UNIT", "QTY", "RATE", "AMOUNT"];
  headers.forEach((h, i) => setCell(row, i + 1, h, colHeaderStyle));
  setRowHeight(row, 20);
  row++;

  blankRow();

  // ─── GENERAL PREAMBLES ────────────────────────────────────────────────────
  const preambleTitleStyle: CellStyle = {
    font: { bold: true, sz: 11, name: "Arial", color: { rgb: COLORS.black } },
    alignment: { horizontal: "left", vertical: "center" },
    border: borderThin(),
  };
  const preambleTextStyle: CellStyle = {
    font: { sz: 10, color: { rgb: COLORS.black } },
    alignment: { horizontal: "left", vertical: "top", wrapText: true },
    border: borderThin(),
  };
  const preambleNoStyle: CellStyle = {
    font: { sz: 10, bold: true, color: { rgb: COLORS.black } },
    alignment: { horizontal: "center", vertical: "top" },
    border: borderThin(),
  };

  setCell(row, 2, "General Preambles", preambleTitleStyle);
  merge(row, 2, row, 5);
  styleRange(row, 2, row, 5, preambleTitleStyle);
  setRowHeight(row, 20);
  row++;

  blankRow();

  setCell(row, 1, "", preambleTextStyle);
  setCell(
    row,
    2,
    "The following specifications must be taken into consideration in cases where they may not be indicated:",
    { ...preambleTextStyle, font: { ...preambleTextStyle.font, bold: true } }
  );
  merge(row, 2, row, 6);
  row++;

  blankRow();

  for (const p of STANDARD_PREAMBLES) {
    setCell(row, 1, p.no, preambleNoStyle);
    setCell(row, 2, p.text, preambleTextStyle);
    merge(row, 2, row, 6);
    row++;
    blankRow();
  }

  // Bill subtotals for summary
  const billTotals: { number: number; title: string; amount: number | null }[] = [];

  // ─── BILLS ────────────────────────────────────────────────────────────────
  for (const bill of boq.bills) {
    // Bill title row — "BILL No. X" in col A, title in col B–F (merged)
    const billTitleStyle: CellStyle = {
      font: { bold: true, sz: 12, name: "Arial", color: { rgb: COLORS.black } },
      fill: { fgColor: { rgb: COLORS.header_bg } },
      alignment: { horizontal: "left", vertical: "center" },
      border: borderThin(),
    };
    setCell(row, 2, `BILL No. ${bill.number}`, billTitleStyle);
    merge(row, 2, row, 5);
    styleRange(row, 2, row, 5, billTitleStyle);
    setRowHeight(row, 20);
    row++;

    setCell(row, 2, bill.title.toUpperCase(), billTitleStyle);
    merge(row, 2, row, 5);
    styleRange(row, 2, row, 5, billTitleStyle);
    setRowHeight(row, 20);
    row++;

    blankRow();

    // Column headers repeated for each bill
    headers.forEach((h, i) => setCell(row, i + 1, h, colHeaderStyle));
    setRowHeight(row, 20);
    row++;

    blankRow();

    let billTotal: number | null = null;

    for (const item of bill.items) {
      if (item.is_header) {
        // Subsection header
        const subStyle: CellStyle = {
          font: { bold: true, sz: 10, name: "Arial", color: { rgb: COLORS.black } },
          fill: { fgColor: { rgb: COLORS.header_bg } },
          alignment: { horizontal: "left", vertical: "center" },
          border: borderThin(),
        };
        setCell(row, 1, item.item_no || "", { ...subStyle, alignment: { horizontal: "center", vertical: "center" } });
        setCell(row, 2, item.description, subStyle);
        merge(row, 2, row, 5);
        styleRange(row, 2, row, 5, subStyle);
        setRowHeight(row, 18);
        row++;
        blankRow();
        continue;
      }

      // Work item row
      const itemStyle: CellStyle = {
        font: { sz: 10, color: { rgb: COLORS.black } },
        alignment: { horizontal: "left", vertical: "top", wrapText: true },
        border: borderThin(),
      };
      const numStyle: CellStyle = {
        font: { sz: 10, color: { rgb: COLORS.black } },
        alignment: { horizontal: "center", vertical: "top" },
        border: borderThin(),
      };
      const currencyStyle: CellStyle = {
        font: { sz: 10, color: { rgb: COLORS.black } },
        alignment: { horizontal: "right", vertical: "top" },
        border: borderThin(),
        numFmt: "#,##0.00",
      };

      const amount = computeAmount(item);
      if (amount !== null) {
        billTotal = (billTotal ?? 0) + amount;
      }

      setCell(row, 1, item.item_no || "", { ...numStyle, font: { ...numStyle.font, bold: true } });
      setCell(row, 2, item.description, itemStyle);
      setCell(row, 3, item.unit || "", { ...numStyle });
      setCell(row, 4, item.qty ?? "", numStyle);
      const placeholder = unresolvedPlaceholder(item);
      setCell(
        row,
        5,
        item.rate !== null ? item.rate : placeholder,
        item.rate !== null ? currencyStyle : { ...numStyle, alignment: { horizontal: "center", vertical: "top" } }
      );
      setCell(
        row,
        6,
        amount !== null ? amount : placeholder,
        amount !== null ? currencyStyle : { ...numStyle, alignment: { horizontal: "center", vertical: "top" } }
      );
      row++;
      blankRow();
    }

    // Bill subtotal row
    // Format: col A blank | col B–D "TOTAL CARRIED TO SUMMARY..." | col E "ZMW" | col F amount
    const totalStyle: CellStyle = {
      font: { bold: true, sz: 10, color: { rgb: COLORS.black } },
      fill: { fgColor: { rgb: COLORS.total_bg } },
      alignment: { horizontal: "left", vertical: "center" },
      border: borderMedium(),
    };
    const totalAmountStyle: CellStyle = {
      ...totalStyle,
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.00",
    };
    const totalZmwStyle: CellStyle = {
      ...totalStyle,
      alignment: { horizontal: "center", vertical: "center" },
    };
    setCell(row, 1, "", totalStyle);
    setCell(row, 2, `${bill.title.toUpperCase()} - TOTAL TO SUMMARY`, totalStyle);
    merge(row, 2, row, 4);
    setCell(row, 5, "ZMW", totalZmwStyle);
    setCell(row, 6, billTotal, billTotal !== null ? totalAmountStyle : totalStyle);
    row++;

    blankRow();

    billTotals.push({ number: bill.number, title: bill.title, amount: billTotal });
  }

  // ─── GENERAL SUMMARY ──────────────────────────────────────────────────────
  // Repeat the title block before the summary (matching sample BOQs)
  const summaryHeaderBlockStyle: CellStyle = {
    font: { bold: true, sz: 13, name: "Arial", color: { rgb: COLORS.black } },
    fill: { fgColor: { rgb: COLORS.header_bg } },
    alignment: { horizontal: "center", vertical: "center" },
    border: borderThin(),
  };

  setCell(row, 2, "BILL OF QUANTITIES", summaryHeaderBlockStyle);
  merge(row, 2, row, 5);
  styleRange(row, 2, row, 5, summaryHeaderBlockStyle);
  setRowHeight(row, 22);
  row++;

  setCell(row, 2, "FOR", summaryHeaderBlockStyle);
  merge(row, 2, row, 5);
  styleRange(row, 2, row, 5, summaryHeaderBlockStyle);
  setRowHeight(row, 18);
  row++;

  setCell(row, 2, boq.project.toUpperCase(), summaryHeaderBlockStyle);
  merge(row, 2, row, 5);
  styleRange(row, 2, row, 5, summaryHeaderBlockStyle);
  setRowHeight(row, 20);
  row++;

  blankRow();

  const generalSummaryTitleStyle: CellStyle = {
    font: { bold: true, sz: 13, name: "Arial", color: { rgb: COLORS.black } },
    fill: { fgColor: { rgb: COLORS.header_bg } },
    alignment: { horizontal: "center", vertical: "center" },
    border: borderThin(),
  };
  setCell(row, 2, "GENERAL SUMMARY", generalSummaryTitleStyle);
  merge(row, 2, row, 5);
  styleRange(row, 2, row, 5, generalSummaryTitleStyle);
  setRowHeight(row, 22);
  row++;

  blankRow();

  const summaryColHeaderStyle: CellStyle = {
    font: { bold: true, sz: 10, name: "Arial", color: { rgb: COLORS.black } },
    fill: { fgColor: { rgb: COLORS.bill_bg } },
    alignment: { horizontal: "center", vertical: "center" },
    border: borderMedium(),
  };
  setCell(row, 1, "BILL NO.", summaryColHeaderStyle);
  setCell(row, 2, "DESCRIPTION", summaryColHeaderStyle);
  merge(row, 2, row, 5);
  styleRange(row, 2, row, 5, summaryColHeaderStyle);
  setCell(row, 6, "AMOUNT (ZMW)", summaryColHeaderStyle);
  setRowHeight(row, 20);
  row++;

  blankRow();

  let grandTotal: number | null = null;
  for (const b of billTotals) {
    const summaryRowStyle: CellStyle = {
      font: { sz: 10, color: { rgb: COLORS.black } },
      alignment: { horizontal: "left", vertical: "center" },
      border: borderThin(),
    };
    const summaryAmtStyle: CellStyle = {
      font: { sz: 10, color: { rgb: COLORS.black } },
      alignment: { horizontal: "right", vertical: "center" },
      border: borderThin(),
      numFmt: "#,##0.00",
    };
    setCell(row, 1, `${b.number}`, { ...summaryRowStyle, alignment: { horizontal: "center", vertical: "center" } });
    setCell(row, 2, `${b.title.toUpperCase()}`, summaryRowStyle);
    merge(row, 2, row, 5);
    setCell(row, 6, b.amount, b.amount !== null ? summaryAmtStyle : summaryRowStyle);
    if (b.amount !== null) grandTotal = (grandTotal ?? 0) + b.amount;
    row++;
    blankRow();
  }

  // Grand total
  const grandTotalStyle: CellStyle = {
    font: { bold: true, sz: 12, name: "Arial", color: { rgb: COLORS.black } },
    fill: { fgColor: { rgb: COLORS.total_bg } },
    alignment: { horizontal: "left", vertical: "center" },
    border: borderMedium(),
  };
  const grandAmtStyle: CellStyle = {
    ...grandTotalStyle,
    alignment: { horizontal: "right", vertical: "center" },
    numFmt: "#,##0.00",
  };
  const grandZmwStyle: CellStyle = {
    ...grandTotalStyle,
    alignment: { horizontal: "center", vertical: "center" },
  };
  setCell(row, 1, "", grandTotalStyle);
  setCell(row, 2, "TOTAL      (VAT EXCLUSIVE)", grandTotalStyle);
  merge(row, 2, row, 4);
  styleRange(row, 2, row, 4, grandTotalStyle);
  setCell(row, 5, "ZMW", grandZmwStyle);
  setCell(row, 6, grandTotal, grandTotal !== null ? grandAmtStyle : grandTotalStyle);
  setRowHeight(row, 22);

  // ─── WORKSHEET SETUP ──────────────────────────────────────────────────────
  ws["!merges"] = merges;
  ws["!cols"] = [
    { wch: 10 },  // A: Item No
    { wch: 62 },  // B: Description
    { wch: 8 },   // C: Unit
    { wch: 10 },  // D: Qty
    { wch: 14 },  // E: Rate / ZMW
    { wch: 16 },  // F: Amount
  ];
  ws["!rows"] = rowHeights;
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row, c: 5 } });

  const sheetName = sanitizeSheetName(`BOQ ${boq.project}`);
  XLSX.utils.book_append_sheet(wb, ws as XLSX.WorkSheet, sheetName);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
  return buf;
}

function computeAmount(item: BOQItem): number | null {
  if (item.amount !== null) return Math.round(item.amount * 100) / 100;
  if (item.qty !== null && item.rate !== null) return Math.round(item.qty * item.rate * 100) / 100;
  return null;
}

/**
 * Converts an uploaded Excel file buffer to a CSV-like text representation
 * suitable for sending to Gemini for parsing/validation.
 */
export function excelToCSV(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return "";
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_csv(ws, { blankrows: false });
}

/**
 * Patches an original Excel file buffer by filling in rate and amount columns
 * using values from a BOQDocument.
 *
 * @param originalBuffer - The original Excel file as a Buffer
 * @param boq - The BOQDocument containing rate and amount values
 * @param rateColumnHeader - Exact header text of the Rate column (from validateBOQ)
 * @param amountColumnHeader - Exact header text of the Amount column (from validateBOQ)
 */
export function patchExcelWithRates(
  originalBuffer: Buffer,
  boq: BOQDocument,
  rateColumnHeader: string,
  amountColumnHeader: string
): Buffer {
  const wb = XLSX.read(originalBuffer, { type: "buffer" });
  const allItems = boq.bills.flatMap((bill) => bill.items.filter((item) => !item.is_header));
  const fallbackRowsBySheet = new Map<string, Map<string, WorkbookRowRecord[]>>();
  const columnsBySheet = new Map<string, { rateCol: number; amountCol: number }>();
  const perSheetStats = boq.workbook_preservation?.per_sheet_stats ?? [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
    let currentColumns: WorkbookColumnMap | null = null;
    let currentBillTitle = "Front Matter";
    let currentSection: string | null = null;
    let pendingBillTitle = false;

    const fallbackRows = new Map<string, WorkbookRowRecord[]>();

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      const detectedHeader = detectHeaderRow(row, rowIndex);
      if (detectedHeader) {
        currentColumns = detectedHeader;
        if (!columnsBySheet.has(sheetName) && detectedHeader.rateCol >= 0) {
          columnsBySheet.set(sheetName, {
            rateCol: detectedHeader.rateCol,
            amountCol: detectedHeader.amountCol,
          });
        }
        continue;
      }

      if (isBillMarkerRow(row)) {
        const values = nonEmptyValues(row);
        const marker = values.find((value) => /^bill\s*no\.?\s*\d+/i.test(value));
        currentBillTitle = marker ?? currentBillTitle;
        currentSection = null;
        pendingBillTitle = true;
        continue;
      }

      const firstNonEmpty = findFirstNonEmptyCell(row);
      if (!firstNonEmpty) continue;

      if (pendingBillTitle) {
        const values = nonEmptyValues(row);
        if (values.length === 1 && !/^item$/i.test(values[0])) {
          currentBillTitle = values[0];
          pendingBillTitle = false;
          continue;
        }
        pendingBillTitle = false;
      }

      const sheetStats = perSheetStats.find((stats) => stats.sheet_name === sheetName);
      const columns = currentColumns ?? {
        itemNoCol: 0,
        descriptionCol: 1,
        unitCol: 2,
        qtyCol: 3,
        rateCol: -1,
        amountCol: -1,
        headerRow: -1,
        rateHeader: sheetStats?.rate_column_header ?? rateColumnHeader,
        amountHeader: sheetStats?.amount_column_header ?? amountColumnHeader,
        qtyHeader: sheetStats?.qty_column_header ?? "QTY",
      };
      const description = toTrimmed(row[columns.descriptionCol] ?? firstNonEmpty.value);
      const unit = toTrimmed(row[columns.unitCol]);
      const qty = parseNumber(row[columns.qtyCol]);
      const rateValue = columns.rateCol >= 0 ? parseNumber(row[columns.rateCol]) : null;
      const amountValue = columns.amountCol >= 0 ? parseNumber(row[columns.amountCol]) : null;
      const isSummaryRow = looksLikeSummaryRow(description);
      const isMeasuredRow = Boolean(unit) || qty !== null;
      const isHeaderRow =
        !isMeasuredRow &&
        rateValue === null &&
        (amountValue === null || amountValue === 0) &&
        description.length > 0 &&
        !isSummaryRow;

      if (!description || /^description$/i.test(description) || /^item$/i.test(description)) continue;
      if (isHeaderRow) {
        currentSection = description;
        continue;
      }
      if (!isMeasuredRow) continue;

      const context = currentSection ? `${currentBillTitle} > ${currentSection}` : currentBillTitle;
      const key = buildNormalizedRowKey(description, unit);
      const existing = fallbackRows.get(key) ?? [];
      existing.push({
        sheetName,
        rowNumber: rowIndex + 1,
        description,
        unit,
        context,
        normalizedKey: key,
      });
      fallbackRows.set(key, existing);
    }

    fallbackRowsBySheet.set(sheetName, fallbackRows);
  }

  for (const item of allItems) {
    const anchor = parseSourceAnchor(item.source_anchor);
    const targetSheetName = anchor?.sheet ?? item.source_document ?? null;
    if (!targetSheetName) continue;

    const ws = wb.Sheets[targetSheetName];
    const sheetColumns = columnsBySheet.get(targetSheetName);
    if (!ws || !sheetColumns || sheetColumns.rateCol < 0) continue;

    let targetRow = anchor?.row ?? null;
    if (!targetRow) {
      const key = buildNormalizedRowKey(item.description, item.unit);
      const candidates = fallbackRowsBySheet.get(targetSheetName)?.get(key) ?? [];
      let narrowed = candidates;
      if (item.workbook_context) {
        const targetContext = normalizeText(item.workbook_context);
        const contextMatches = candidates.filter(
          (candidate) => normalizeText(candidate.context) === targetContext
        );
        if (contextMatches.length > 0) {
          narrowed = contextMatches;
        }
      }
      if (narrowed.length === 1) {
        targetRow = narrowed[0].rowNumber;
      }
    }

    if (!targetRow) continue;
    const r = targetRow - 1;
    const rateCol = sheetColumns.rateCol;
    const amountCol = sheetColumns.amountCol;

    if (item.note && /incl/i.test(item.note)) {
      ws[XLSX.utils.encode_cell({ r, c: rateCol })] = { v: "Incl", t: "s" };
      if (amountCol !== -1) {
        const amountRef = XLSX.utils.encode_cell({ r, c: amountCol });
        const existingAmountCell = ws[amountRef];
        if (!existingAmountCell?.f) {
          ws[amountRef] = { v: "Incl", t: "s" };
        }
      }
      continue;
    }

    if (item.rate !== null) {
      ws[XLSX.utils.encode_cell({ r, c: rateCol })] = { v: item.rate, t: "n", z: "#,##0.00" };
    }

    if (amountCol !== -1) {
      const amountRef = XLSX.utils.encode_cell({ r, c: amountCol });
      const existingAmountCell = ws[amountRef];
      if (!existingAmountCell?.f) {
        const amount = computeAmount(item);
        if (amount !== null) {
          ws[amountRef] = { v: amount, t: "n", z: "#,##0.00" };
        }
      }
    }
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
