import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { extractWorkbookBOQ, patchExcelWithRates } from "@/lib/excel";
import type { BOQDocument } from "@/lib/types";

function buildWorkbookBuffer(): Buffer {
  const wb = XLSX.utils.book_new();

  const pgSheet = XLSX.utils.aoa_to_sheet([
    ["Item", "Description", "Qty", "Unit", "Rate", "Amount"],
    ["", "General Preambles", "", "", "", ""],
    ["i", "Contractor to verify all dimensions on site", "", "", "", ""],
    ["ii", "Allow for safety measures and housekeeping", "", "", "", ""],
  ]);

  const mainBillSheet = XLSX.utils.aoa_to_sheet([
    ["Item", "Description", "Qty", "Unit", "Rate", "Amount"],
    ["", "DEMOLITIONS", "", "", "", ""],
    ["A", "Remove existing ceiling boards", 274.4, "m2", "", ""],
    ["B", "Hack out wall tiles", 75.04, "m2", "", ""],
    ["", "", "", "Carried Forward", "ZMW", 0],
    ["Item", "Description", "Qty", "Unit", "Rate", "Amount"],
    ["", "NEW WORKS", "", "", "", ""],
    ["A", "Install plasterboard ceiling", 274.4, "m2", "", ""],
  ]);

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ["ITEM", "DESCRIPTION", "", "AMOUNT"],
    ["", "", "", "(ZMW)"],
    ["", "BILL No 1: PRELIMINARIES AND GENERALS", "ZMW", 0],
    ["", "BILL No 2: MAIN BILL", "ZMW", 0],
    ["", "GRAND TOTAL", "", 0],
  ]);

  XLSX.utils.book_append_sheet(wb, pgSheet, "P&Gs");
  XLSX.utils.book_append_sheet(wb, mainBillSheet, "MAIN BILL");
  XLSX.utils.book_append_sheet(wb, summarySheet, "GENERAL SUMMARY");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
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
  it("parses measurable BOQ items from later sheets and ignores non-item sheets", () => {
    const boq = extractWorkbookBOQ(buildWorkbookBuffer());
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

  it("preserves single-sheet behavior for straightforward workbooks", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Item", "Description", "Qty", "Unit", "Rate", "Amount"],
      ["A", "Excavate trench", 10, "m3", "", ""],
      ["B", "Backfill selected material", 8, "m3", "", ""],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "BOQ");

    const boq = extractWorkbookBOQ(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const measurableItems = boq.bills.flatMap((bill) => bill.items.filter((item) => !item.is_header));

    expect(measurableItems).toHaveLength(2);
    expect(boq.workbook_preservation?.mapped_sheet_names).toEqual(["BOQ"]);
    expect(boq.workbook_preservation?.ignored_sheet_count).toBe(0);
  });
});

describe("patchExcelWithRates", () => {
  it("writes rates and amounts back to the originating worksheet only", () => {
    const original = buildWorkbookBuffer();
    const boq = cloneWithRates(extractWorkbookBOQ(original));

    const patched = patchExcelWithRates(original, boq, "Rate", "Amount");
    const wb = XLSX.read(patched, { type: "buffer" });
    const pgRows = XLSX.utils.sheet_to_json(wb.Sheets["P&Gs"], { header: 1, defval: "" }) as unknown[][];
    const mainRows = XLSX.utils.sheet_to_json(wb.Sheets["MAIN BILL"], { header: 1, defval: "" }) as unknown[][];

    expect(pgRows[2][4]).toBe("");
    expect(pgRows[2][5]).toBe("");
    expect(mainRows[2][4]).toBe(100);
    expect(mainRows[2][5]).toBe(27440);
    expect(mainRows[3][4]).toBe(101);
    expect(mainRows[7][4]).toBe(102);
  });
});
