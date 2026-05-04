import { describe, expect, it } from "vitest";
import {
  buildCanonicalStyledWorkbook,
  patchCanonicalWorkbookOnce,
  snapshotWorkbook,
} from "../tools/spike/excel-bench/preservation-fixture";

describe("Excel preservation spike", () => {
  it("captures the current preservation behavior of patchExcelWithRates", () => {
    const original = buildCanonicalStyledWorkbook();
    const patched = patchCanonicalWorkbookOnce(original);

    const before = snapshotWorkbook(original);
    const after = snapshotWorkbook(patched);

    expect(after.sheetNames).toEqual(before.sheetNames);
    expect(after.mergeCount).toBe(before.mergeCount);
    expect(after.rateValue).toBe(125.5);
    expect(after.amountFormula).toBe(before.amountFormula);
  });

  it("keeps patching idempotent for the same rated BOQ values", () => {
    const original = buildCanonicalStyledWorkbook();
    const patchedOnce = patchCanonicalWorkbookOnce(original);
    const patchedTwice = patchCanonicalWorkbookOnce(patchedOnce);

    expect(snapshotWorkbook(patchedTwice)).toMatchObject(snapshotWorkbook(patchedOnce));
  });
});
