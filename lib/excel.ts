import ExcelJS from "exceljs";
import type {
  BOQBill,
  BOQDocument,
  BOQItem,
  BOQWorkbookPreservation,
  BOQWorkbookSheetStat,
} from "./types";

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

function extractSabsSectionTitle(row: unknown[]): string | null {
  const cells = row.map((cell) => toTrimmed(cell)).filter(Boolean);
  const hasSabsCode = cells.some((c) => /^sabs\b/i.test(c));
  const sectionCell = cells.find((c) => /\bSECTION\s+\d+[:.]/i.test(c));
  if (!hasSabsCode || !sectionCell) return null;
  return sectionCell;
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

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const load = workbook.xlsx.load.bind(workbook.xlsx) as unknown as (data: Uint8Array) => Promise<ExcelJS.Workbook>;
  await load(new Uint8Array(buffer));
  return workbook;
}

function excelJsCellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value && typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value) return value.text;
    if ("result" in value) return value.result;
  }
  return value;
}

function excelJsRowToArray(row: ExcelJS.Row, columnCount: number): unknown[] {
  const values: unknown[] = [];
  for (let col = 1; col <= columnCount; col += 1) {
    values.push(excelJsCellValue(row.getCell(col)));
  }
  return values;
}

function excelJsWorksheetToRows(ws: ExcelJS.Worksheet): unknown[][] {
  const columnCount = Math.max(ws.actualColumnCount, ws.columnCount, 20);
  const rows: unknown[][] = [];
  for (let rowIndex = 1; rowIndex <= ws.rowCount; rowIndex += 1) {
    rows.push(excelJsRowToArray(ws.getRow(rowIndex), columnCount));
  }
  return rows;
}

function excelJsCellHasFormula(cell: ExcelJS.Cell): boolean {
  const value = cell.value;
  return Boolean(value && typeof value === "object" && "formula" in value);
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
  ws: ExcelJS.Worksheet,
  options: WorkbookExtractionOptions = {}
): SheetExtractionResult {
  const rows = excelJsWorksheetToRows(ws);

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

    const sabsTitle = extractSabsSectionTitle(row);
    if (sabsTitle) {
      currentBillNumber += 1;
      currentBillTitle = sabsTitle;
      currentSection = null;
      pendingBillTitle = false;
      ensureBill();
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
    source_row_count: ws.rowCount,
    source_col_count: Math.max(ws.actualColumnCount, ws.columnCount),
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

export async function extractWorkbookBOQ(
  buffer: Buffer,
  options: WorkbookExtractionOptions = {}
): Promise<BOQDocument> {
  const wb = await loadWorkbook(buffer);
  const sheetNames = wb.worksheets.map((ws) => ws.name);
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
    const ws = wb.getWorksheet(sheetName);
    if (!ws) continue;

    const rows = excelJsWorksheetToRows(ws);
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

function computeAmount(item: BOQItem): number | null {
  if (item.amount !== null) return Math.round(item.amount * 100) / 100;
  if (item.qty !== null && item.rate !== null) return Math.round(item.qty * item.rate * 100) / 100;
  return null;
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
export async function patchExcelWithRates(
  originalBuffer: Buffer,
  boq: BOQDocument,
  rateColumnHeader: string,
  amountColumnHeader: string
): Promise<Buffer> {
  const wb = await loadWorkbook(originalBuffer);
  const allItems = boq.bills.flatMap((bill) => bill.items.filter((item) => !item.is_header));
  const fallbackRowsBySheet = new Map<string, Map<string, WorkbookRowRecord[]>>();
  const columnsBySheet = new Map<string, { rateCol: number; amountCol: number }>();
  const perSheetStats = boq.workbook_preservation?.per_sheet_stats ?? [];

  for (const ws of wb.worksheets) {
    const sheetName = ws.name;
    if (!ws) continue;

    let currentColumns: WorkbookColumnMap | null = null;
    let currentBillTitle = "Front Matter";
    let currentSection: string | null = null;
    let pendingBillTitle = false;
    const columnCount = Math.max(ws.actualColumnCount, ws.columnCount, 20);

    const fallbackRows = new Map<string, WorkbookRowRecord[]>();

    for (let rowIndex = 0; rowIndex < ws.rowCount; rowIndex += 1) {
      const row = excelJsRowToArray(ws.getRow(rowIndex + 1), columnCount);
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

      const sabsPatchTitle = extractSabsSectionTitle(row);
      if (sabsPatchTitle) {
        currentBillTitle = sabsPatchTitle;
        currentSection = null;
        pendingBillTitle = false;
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

    const ws = wb.getWorksheet(targetSheetName);
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
    const row = ws.getRow(r + 1);
    const rateCell = row.getCell(rateCol + 1);

    if (item.note && /incl/i.test(item.note)) {
      rateCell.value = "Incl";
      if (amountCol !== -1) {
        const amountCell = row.getCell(amountCol + 1);
        if (!excelJsCellHasFormula(amountCell)) {
          amountCell.value = "Incl";
        }
      }
      continue;
    }

    if (item.rate !== null) {
      rateCell.value = item.rate;
      rateCell.numFmt = rateCell.numFmt || "#,##0.00";
    }

    if (amountCol !== -1) {
      const amountCell = row.getCell(amountCol + 1);
      if (!excelJsCellHasFormula(amountCell)) {
        const amount = computeAmount(item);
        if (amount !== null) {
          amountCell.value = amount;
          amountCell.numFmt = amountCell.numFmt || "#,##0.00";
        }
      }
    }
  }

  const output = await wb.xlsx.writeBuffer();
  return Buffer.from(output);
}

