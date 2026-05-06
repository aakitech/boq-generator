import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { extractWorkbookBOQ, patchExcelWithRates } from "@/lib/excel";
import type { BOQDocument } from "@/lib/types";

async function workbookFromSheets(sheets: Array<{ name: string; rows: unknown[][] }>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    sheet.rows.forEach((row) => ws.addRow(row));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function worksheetRows(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  for (let rowIndex = 1; rowIndex <= ws.rowCount; rowIndex += 1) {
    const row = ws.getRow(rowIndex);
    const values: unknown[] = [];
    for (let colIndex = 1; colIndex <= Math.max(ws.columnCount, 6); colIndex += 1) {
      values.push(row.getCell(colIndex).value ?? "");
    }
    rows.push(values);
  }
  return rows;
}

async function buildWorkbookBuffer(): Promise<Buffer> {
  return workbookFromSheets([
    {
      name: "P&Gs",
      rows: [
    ["Item", "Description", "Qty", "Unit", "Rate", "Amount"],
    ["", "General Preambles", "", "", "", ""],
    ["i", "Contractor to verify all dimensions on site", "", "", "", ""],
    ["ii", "Allow for safety measures and housekeeping", "", "", "", ""],
      ],
    },
    {
      name: "MAIN BILL",
      rows: [
    ["Item", "Description", "Qty", "Unit", "Rate", "Amount"],
    ["", "DEMOLITIONS", "", "", "", ""],
    ["A", "Remove existing ceiling boards", 274.4, "m2", "", ""],
    ["B", "Hack out wall tiles", 75.04, "m2", "", ""],
    ["", "", "", "Carried Forward", "ZMW", 0],
    ["Item", "Description", "Qty", "Unit", "Rate", "Amount"],
    ["", "NEW WORKS", "", "", "", ""],
    ["A", "Install plasterboard ceiling", 274.4, "m2", "", ""],
      ],
    },
    {
      name: "GENERAL SUMMARY",
      rows: [
    ["ITEM", "DESCRIPTION", "", "AMOUNT"],
    ["", "", "", "(ZMW)"],
    ["", "BILL No 1: PRELIMINARIES AND GENERALS", "ZMW", 0],
    ["", "BILL No 2: MAIN BILL", "ZMW", 0],
    ["", "GRAND TOTAL", "", 0],
      ],
    },
  ]);
}

function cloneWithRates(boq: BOQDocument): BOQDocument {
  let measurableIndex = 0;
  return {
    ...boq,
    bills: boq.bills.map((bill) => ({
      ...bill,
      items: bill.items.map((item) => {
        if (item.is_header) return item;
        const rate = item.rate ?? 100 + measurableIndex;
        measurableIndex += 1;
        return {
          ...item,
          rate,
          amount: item.qty !== null ? rate * item.qty : item.amount,
        };
      }),
    })),
  };
}

describe("extractWorkbookBOQ", () => {
  it("parses measurable BOQ items from later sheets and ignores non-item sheets", async () => {
    const boq = await extractWorkbookBOQ(await buildWorkbookBuffer());
    const measurableItems = boq.bills.flatMap((bill) => bill.items.filter((item) => !item.is_header));

    expect(measurableItems).toHaveLength(3);
    expect(measurableItems.every((item) => item.source_document === "MAIN BILL")).toBe(true);
    expect(boq.workbook_preservation?.mapped_sheet_names).toEqual(["MAIN BILL"]);
    expect(boq.workbook_preservation?.ignored_sheet_names).toEqual(["P&Gs", "GENERAL SUMMARY"]);
    expect(boq.workbook_preservation?.mapped_sheet_count).toBe(1);
    expect(boq.workbook_preservation?.ignored_sheet_count).toBe(2);
    expect(boq.workbook_preservation?.per_sheet_stats?.find((sheet) => sheet.sheet_name === "GENERAL SUMMARY")?.ignored_reason)
      .toBe("summary_only");
  });

  it("preserves single-sheet behavior for straightforward workbooks", async () => {
    const buffer = await workbookFromSheets([{
      name: "BOQ",
      rows: [
      ["Item", "Description", "Qty", "Unit", "Rate", "Amount"],
      ["A", "Excavate trench", 10, "m3", "", ""],
      ["B", "Backfill selected material", 8, "m3", "", ""],
      ],
    }]);

    const boq = await extractWorkbookBOQ(buffer);
    const measurableItems = boq.bills.flatMap((bill) => bill.items.filter((item) => !item.is_header));

    expect(measurableItems).toHaveLength(2);
    expect(boq.workbook_preservation?.mapped_sheet_names).toEqual(["BOQ"]);
    expect(boq.workbook_preservation?.ignored_sheet_count).toBe(0);
  });
});

describe("patchExcelWithRates", () => {
  it("writes rates and amounts back to the originating worksheet only", async () => {
    const original = await buildWorkbookBuffer();
    const boq = cloneWithRates(await extractWorkbookBOQ(original));

    const patched = await patchExcelWithRates(original, boq, "Rate", "Amount");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(patched);
    const pgRows = worksheetRows(wb.getWorksheet("P&Gs")!);
    const mainRows = worksheetRows(wb.getWorksheet("MAIN BILL")!);

    expect(pgRows[2][4]).toBe("");
    expect(pgRows[2][5]).toBe("");
    expect(mainRows[2][4]).toBe(100);
    expect(mainRows[2][5]).toBe(27440);
    expect(mainRows[3][4]).toBe(101);
    expect(mainRows[7][4]).toBe(102);
  });

  it("preserves original workbook formatting and print setup while patching rates", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("MAIN BILL", {
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      properties: { tabColor: { argb: "FF00FF00" } },
    });

    ws.columns = [
      { width: 8 },
      { width: 42 },
      { width: 10 },
      { width: 10 },
      { width: 14 },
      { width: 16 },
    ];
    ws.getRow(1).values = ["Item", "Description", "Qty", "Unit", "Rate", "Amount"];
    ws.getRow(2).values = ["A", "Remove existing ceiling boards", 274.4, "m2", "", ""];
    ws.getCell("B2").font = { bold: true, color: { argb: "FFFF0000" } };
    ws.getCell("E2").numFmt = "#,##0.000";
    ws.getCell("F2").numFmt = "#,##0.000";
    ws.views = [{ state: "frozen", ySplit: 1 }];

    const original = Buffer.from(await wb.xlsx.writeBuffer());
    const boq = cloneWithRates(await extractWorkbookBOQ(original));
    const patched = await patchExcelWithRates(original, boq, "Rate", "Amount");

    const patchedWb = new ExcelJS.Workbook();
    await patchedWb.xlsx.load(patched);
    const patchedWs = patchedWb.getWorksheet("MAIN BILL");

    expect(patchedWs?.pageSetup.orientation).toBe("landscape");
    expect(patchedWs?.pageSetup.fitToPage).toBe(true);
    expect(patchedWs?.views[0]?.state).toBe("frozen");
    expect(patchedWs?.getColumn(2).width).toBe(42);
    expect(patchedWs?.getCell("B2").font?.bold).toBe(true);
    expect(patchedWs?.getCell("B2").font?.color?.argb).toBe("FFFF0000");
    expect(patchedWs?.getCell("E2").value).toBe(100);
    expect(patchedWs?.getCell("E2").numFmt).toBe("#,##0.000");
    expect(patchedWs?.getCell("F2").value).toBe(27440);
    expect(patchedWs?.getCell("F2").numFmt).toBe("#,##0.000");
  });
});
