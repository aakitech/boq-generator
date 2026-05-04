# Excel Preservation Spike

This harness checks whether BOQ rate patching can update original Excel workbooks without damaging presentation.

## What It Measures
- Cell value placement for rate and amount cells.
- Merge preservation.
- Formula preservation.
- Style presence on patched rate/amount cells.
- Idempotency when applying the same patch twice.

## Current Focus
The first benchmark uses the production `patchExcelWithRates` function from `lib/excel.ts` against a canonical styled workbook. It is intentionally small so we can quickly see whether the current SheetJS `xlsx` approach is enough for rollout, or whether we need a different patching library/pattern.

## Run
```bash
node tools/spike/excel-bench/run-current-xlsx-benchmark.cjs
```

There is also a Vitest coverage file for when the local Node/Vitest toolchain is healthy:

```bash
npm test -- test/excel-preservation-spike.test.ts
```

To compare a real uploaded workbook against a downloaded patched workbook:

```bash
node tools/spike/excel-bench/compare-workbook-preservation.cjs "inspo_docs/source.xlsx" "C:/Users/User/Documents/rated.xlsx"
```

To patch one missing rate in a real workbook with the current production patcher:

```bash
node tools/spike/excel-bench/patch-first-missing-rate.cjs "inspo_docs/source.xlsx" "%TEMP%/boq-patched.xlsx"
```

To run the same one-rate patch with ExcelJS:

```bash
node tools/spike/excel-bench/patch-first-missing-rate-exceljs.cjs "inspo_docs/source.xlsx" "%TEMP%/boq-patched-exceljs.xlsx"
```

To inspect why a workbook still has blank rates:

```bash
node tools/spike/excel-bench/blank-rate-report.cjs "C:/Users/User/Desktop/rated.xlsx"
```

To estimate how many rows the local-inheritance pass can fill without calling AI:

```bash
node tools/spike/excel-bench/local-inheritance-dry-run.cjs "C:/Users/User/Desktop/rated.xlsx"
```

## Decision Output
After running this spike, record:
- whether the current `xlsx` patcher preserves enough formatting for production
- which workbook attributes are lost or risky
- whether to continue with `xlsx`, switch to `exceljs`, or use a different patching strategy
