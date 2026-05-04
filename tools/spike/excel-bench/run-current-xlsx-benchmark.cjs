const jiti = require("jiti")(__filename, { interopDefault: true });

const {
  buildCanonicalStyledWorkbook,
  patchCanonicalWorkbookOnce,
  snapshotWorkbook,
} = jiti("./preservation-fixture.ts");

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const original = buildCanonicalStyledWorkbook();
const patchedOnce = patchCanonicalWorkbookOnce(original);
const patchedTwice = patchCanonicalWorkbookOnce(patchedOnce);

const before = snapshotWorkbook(original);
const after = snapshotWorkbook(patchedOnce);
const afterSecondPatch = snapshotWorkbook(patchedTwice);

const checks = {
  sheetNamesPreserved: sameJson(after.sheetNames, before.sheetNames),
  mergesPreserved: after.mergeCount === before.mergeCount,
  firstRatePatched: after.rateValue === 125.5,
  amountFormulaPreserved: after.amountFormula === before.amountFormula,
  idempotentSecondPatch: sameJson(afterSecondPatch, after),
};

const report = {
  before,
  after,
  afterSecondPatch,
  checks,
};

console.log(JSON.stringify(report, null, 2));

const failed = Object.entries(checks).filter(([, passed]) => !passed);
if (failed.length > 0) {
  console.error(
    `Excel preservation benchmark failed checks: ${failed.map(([name]) => name).join(", ")}`
  );
  process.exit(1);
}
