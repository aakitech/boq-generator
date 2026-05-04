const fs = require("fs");
const path = require("path");
const jiti = require("jiti")(__filename, { interopDefault: true });

const { extractWorkbookBOQ } = jiti("../../../lib/excel.ts");

const [, , workbookArg] = process.argv;

if (!workbookArg) {
  console.error("Usage: node tools/spike/excel-bench/blank-rate-report.cjs <workbook.xlsx>");
  process.exit(1);
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classify(description, unit) {
  const text = `${normalize(description)} ${normalize(unit)}`.trim();
    if (/\bditto\b/.test(text)) return "ditto_reference";
  if (/\bant proof\b|\bantproof\b|\btermite\b|\binsecticide\b|\btreatment\b|\bdestroy termites\b/.test(text)) {
    return "treatment_service";
  }
  if (/\bmantis\b|\bgrating\b|\bbaluster\b|\brsa\b|\btread support\b|\bbracing\b|\bhandrail\b|\bsteel\b|\bmetal\b/.test(text)) {
    return "steel_fabrication";
  }
  if (/\bpipe\b|\bupvc\b|\bpvc\b|\bdrain\b|\bgully\b|\btrap\b|\belbow\b|\btee\b|\bbranch\b|\bjunction\b|\bsleeve\b|\bconnector\b|\bbend\b/.test(text)) {
    if (/\belbow\b|\btee\b|\bbranch\b|\bjunction\b|\bsleeve\b|\bconnector\b|\bbend\b|\btrap\b|\bgully\b/.test(text)) {
      return "pipe_fitting";
    }
    return "pipe_run";
  }
  if (/\bdoor\b|\bframe\b|\blouvre\b|\bironmongery\b|\bwindow\b/.test(text)) return "doors_windows";
  if (/\bceiling mounted\b|\blight point\b|\blight fitting\b|\bswitch\b|\bsocket\b|\boutlet\b|\bphotocell\b|\belectrical\b/.test(text)) {
    return "electrical_fixture";
  }
  if (/\bpaint\b|\bplaster\b|\brender\b|\bscreed\b|\btiling\b|\bfloor finish\b/.test(text)) return "finishes";
  if (/\bconcrete\b|\breinforcement\b|\bformwork\b|\bfoundation\b|\bbases\b|\bcolumns\b|\bsurface bed\b|\bmesh\b/.test(text)) {
    return "concrete_structure";
  }
  if (/\bexcavat\b|\bbackfill\b|\btrench\b|\bhardcore\b|\bcompacting\b|\blevelling\b|\brock\b/.test(text)) {
    return "earthworks";
  }
  return "other";
}

function requiresLocalPrecedent(category) {
  return ["ditto_reference", "pipe_fitting", "steel_fabrication", "treatment_service"].includes(category);
}

function rowFromAnchor(anchor) {
  const match = /^sheet:.+;row:(\d+)$/i.exec(anchor ?? "");
  return match ? Number(match[1]) : null;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function similarEnough(a, b) {
  const aTokens = new Set(normalize(a).replace(/\bditto\b/g, "").split(" ").filter(Boolean));
  const bTokens = new Set(normalize(b).replace(/\bditto\b/g, "").split(" ").filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return false;
  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }
  return intersection / Math.max(aTokens.size, bTokens.size) >= 0.5;
}

const workbookPath = path.resolve(workbookArg);
const boq = extractWorkbookBOQ(fs.readFileSync(workbookPath));
const rows = boq.bills
  .flatMap((bill) =>
    bill.items
      .filter((item) => !item.is_header)
      .map((item) => ({
        bill: bill.title,
        item,
        row: rowFromAnchor(item.source_anchor),
      }))
  )
  .sort((a, b) => (a.row ?? 0) - (b.row ?? 0));

const priced = rows.filter((entry) => entry.item.rate !== null);
const blank = rows.filter((entry) => entry.item.rate === null);
const pricedByUnit = new Map();
for (const entry of priced) {
  const key = normalize(entry.item.unit);
  pricedByUnit.set(key, [...(pricedByUnit.get(key) ?? []), entry.item.rate]);
}

const blankRows = blank.map((entry) => {
  const category = entry.item.pricing_category ?? classify(entry.item.description, entry.item.unit);
  const priorPricedSameUnit = priced
    .filter((candidate) => (candidate.row ?? 0) < (entry.row ?? 0))
    .filter((candidate) => normalize(candidate.item.unit) === normalize(entry.item.unit))
    .slice(-5);
  const nearestPrior = priorPricedSameUnit.at(-1);
  const similarPrior = priorPricedSameUnit.find((candidate) =>
    similarEnough(candidate.item.description, entry.item.description)
  );
  const unitMedian = median(pricedByUnit.get(normalize(entry.item.unit)) ?? []);
  const likelyReason =
    entry.item.rate_skip_reason ??
    (requiresLocalPrecedent(category) && !nearestPrior ? "needs_local_precedent" :
      requiresLocalPrecedent(category) ? "gated_specialist_or_ditto" :
      "sent_to_ai_or_unresolved");

  return {
    row: entry.row,
    item_no: entry.item.item_no,
    description: entry.item.description,
    unit: entry.item.unit,
    qty: entry.item.qty,
    bill: entry.bill,
    context: entry.item.workbook_context,
    category,
    likelyReason,
    explicitSkipReason: entry.item.rate_skip_reason ?? null,
    hasPriorSameUnitRate: Boolean(nearestPrior),
    nearestPriorSameUnitRate: nearestPrior
      ? {
          row: nearestPrior.row,
          description: nearestPrior.item.description,
          rate: nearestPrior.item.rate,
        }
      : null,
    hasSimilarPriorSameUnitRate: Boolean(similarPrior),
    similarPriorSameUnitRate: similarPrior
      ? {
          row: similarPrior.row,
          description: similarPrior.item.description,
          rate: similarPrior.item.rate,
        }
      : null,
    unitMedianRate: unitMedian,
  };
});

function countBy(key) {
  return blankRows.reduce((acc, row) => {
    const value = row[key] ?? "unknown";
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

const report = {
  workbook: workbookArg,
  project: boq.project,
  workbookPreservation: boq.workbook_preservation,
  totals: {
    measuredRows: rows.length,
    pricedRows: priced.length,
    blankRows: blank.length,
  },
  buckets: {
    byCategory: countBy("category"),
    byLikelyReason: countBy("likelyReason"),
    withPriorSameUnitRate: blankRows.filter((row) => row.hasPriorSameUnitRate).length,
    withSimilarPriorSameUnitRate: blankRows.filter((row) => row.hasSimilarPriorSameUnitRate).length,
  },
  safestCandidates: blankRows
    .filter((row) => row.hasSimilarPriorSameUnitRate || (!requiresLocalPrecedent(row.category) && row.unitMedianRate !== null))
    .slice(0, 30),
  blankRows,
};

console.log(JSON.stringify(report, null, 2));
