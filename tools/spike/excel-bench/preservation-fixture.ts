import * as XLSX from "xlsx";
import { extractWorkbookBOQ, patchExcelWithRates } from "../../../lib/excel";
import type { BOQDocument } from "../../../lib/types";

type CellLike = {
  v?: unknown;
  f?: string;
  s?: unknown;
  z?: string;
};

export type WorkbookPreservationSnapshot = {
  sheetNames: string[];
  mergeCount: number;
  rateValue: unknown;
  amountValue: unknown;
  amountFormula: string | null;
  rateHasStyle: boolean;
  amountHasStyle: boolean;
  rateFormat: string | null;
  amountFormat: string | null;
};

const headerStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" } },
  fill: { fgColor: { rgb: "1F4E78" } },
  alignment: { horizontal: "center", vertical: "center" },
  border: {
    top: { style: "thin", color: { rgb: "000000" } },
    bottom: { style: "thin", color: { rgb: "000000" } },
    left: { style: "thin", color: { rgb: "000000" } },
    right: { style: "thin", color: { rgb: "000000" } },
  },
};

const currencyStyle = {
  numFmt: "#,##0.00",
  alignment: { horizontal: "right" },
  border: {
    top: { style: "thin", color: { rgb: "888888" } },
    bottom: { style: "thin", color: { rgb: "888888" } },
    left: { style: "thin", color: { rgb: "888888" } },
    right: { style: "thin", color: { rgb: "888888" } },
  },
};

function setCellStyle(ws: XLSX.WorkSheet, ref: string, style: unknown) {
  const cell = ws[ref] as CellLike | undefined;
  if (!cell) return;
  cell.s = style;
}

export function buildCanonicalStyledWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["", "BILL OF QUANTITIES", "", "", "", ""],
    ["Item", "Description", "Qty", "Unit", "Rate", "Amount"],
    ["A", "Install plasterboard ceiling", 274.4, "m2", "", 0],
    ["B", "Hack out wall tiles", 75.04, "m2", "", 0],
    ["", "TOTAL CARRIED TO SUMMARY", "", "", "ZMW", 0],
  ]);

  ws["!merges"] = [
    { s: { r: 0, c: 1 }, e: { r: 0, c: 5 } },
    { s: { r: 4, c: 1 }, e: { r: 4, c: 3 } },
  ];
  ws["!cols"] = [
    { wch: 10 },
    { wch: 42 },
    { wch: 10 },
    { wch: 10 },
    { wch: 14 },
    { wch: 16 },
  ];

  for (const ref of ["A2", "B2", "C2", "D2", "E2", "F2"]) {
    setCellStyle(ws, ref, headerStyle);
  }

  for (const ref of ["E3", "F3", "E4", "F4", "E5", "F5"]) {
    setCellStyle(ws, ref, currencyStyle);
  }

  ws["F3"] = { ...(ws["F3"] as CellLike), t: "n", v: 0, f: "C3*E3", s: currencyStyle };
  ws["F4"] = { ...(ws["F4"] as CellLike), t: "n", v: 0, f: "C4*E4", s: currencyStyle };
  ws["F5"] = { ...(ws["F5"] as CellLike), t: "n", v: 0, f: "SUM(F3:F4)", s: currencyStyle };

  XLSX.utils.book_append_sheet(wb, ws, "MAIN BILL");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
}

export function addDeterministicRates(boq: BOQDocument): BOQDocument {
  let measuredItemIndex = 0;
  return {
    ...boq,
    bills: boq.bills.map((bill) => ({
      ...bill,
      items: bill.items.map((item) => {
        if (item.is_header) return item;
        const rate = measuredItemIndex === 0 ? 125.5 : 87.25;
        measuredItemIndex += 1;
        return {
          ...item,
          rate,
          amount: item.qty !== null ? Number((item.qty * rate).toFixed(2)) : item.amount,
        };
      }),
    })),
  };
}

export function patchCanonicalWorkbookOnce(buffer = buildCanonicalStyledWorkbook()): Buffer {
  const boq = addDeterministicRates(extractWorkbookBOQ(buffer));
  return patchExcelWithRates(buffer, boq, "Rate", "Amount");
}

export function snapshotWorkbook(buffer: Buffer): WorkbookPreservationSnapshot {
  const wb = XLSX.read(buffer, { type: "buffer", cellStyles: true, cellFormula: true });
  const ws = wb.Sheets["MAIN BILL"];
  if (!ws) {
    throw new Error("MAIN BILL worksheet not found");
  }

  const rateCell = ws["E3"] as CellLike | undefined;
  const amountCell = ws["F3"] as CellLike | undefined;

  return {
    sheetNames: wb.SheetNames,
    mergeCount: ws["!merges"]?.length ?? 0,
    rateValue: rateCell?.v,
    amountValue: amountCell?.v,
    amountFormula: amountCell?.f ?? null,
    rateHasStyle: Boolean(rateCell?.s),
    amountHasStyle: Boolean(amountCell?.s),
    rateFormat: rateCell?.z ?? null,
    amountFormat: amountCell?.z ?? null,
  };
}
