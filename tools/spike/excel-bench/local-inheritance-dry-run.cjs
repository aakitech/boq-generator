const fs = require("fs");
const path = require("path");
const jiti = require("jiti")(__filename, { interopDefault: true });

const { extractWorkbookBOQ } = jiti("../../../lib/excel.ts");

const [, , workbookArg] = process.argv;

if (!workbookArg) {
  console.error("Usage: node tools/spike/excel-bench/local-inheritance-dry-run.cjs <workbook.xlsx>");
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
  if (/\bant proof\b|\bantproof\b|\btermite\b|\binsecticide\b|\btreatment\b|\bdestroy termites\b/.test(text)) return "treatment_service";
  if (/\bmantis\b|\bgrating\b|\bbaluster\b|\brsa\b|\btread support\b|\bbracing\b|\bhandrail\b|\bsteel\b|\bmetal\b|\bchannel\b|\bpurlin\b|\bpurlins\b|\bplate\b|\bplates\b|\bbars\b|\bbar\b|\breinforcement\b|\bconforce\b/.test(text)) return "steel_fabrication";
  if (/\bpipe\b|\bupvc\b|\bpvc\b|\bdrain\b|\bgully\b|\btrap\b|\belbow\b|\btee\b|\bbranch\b|\bjunction\b|\bsleeve\b|\bconnector\b|\bbend\b/.test(text)) {
    if (/\belbow\b|\btee\b|\bbranch\b|\bjunction\b|\bsleeve\b|\bconnector\b|\bbend\b|\btrap\b|\bgully\b/.test(text)) return "pipe_fitting";
    return "pipe_run";
  }
  if (/\bdoor\b|\bframe\b|\blouvre\b|\bironmongery\b|\bwindow\b/.test(text)) return "doors_windows";
  if (/\bceiling mounted\b|\blight point\b|\blight fitting\b|\bswitch\b|\bsocket\b|\boutlet\b|\bphotocell\b|\belectrical\b/.test(text)) return "electrical_fixture";
  if (/\bpaint\b|\bplaster\b|\brender\b|\bscreed\b|\btiling\b|\bfloor finish\b/.test(text)) return "finishes";
  if (/\bconcrete\b|\breinforcement\b|\bformwork\b|\bfoundation\b|\bbases\b|\bcolumns\b|\bsurface bed\b|\bmesh\b/.test(text)) return "concrete_structure";
  if (/\bexcavat\b|\bbackfill\b|\btrench\b|\bhardcore\b|\bcompacting\b|\blevelling\b|\brock\b/.test(text)) return "earthworks";
  return "other";
}

function requiresLocalPrecedent(category) {
  return ["ditto_reference", "pipe_fitting", "steel_fabrication", "treatment_service"].includes(category);
}

function normalizeUnit(unit) {
  return normalize(unit).replace(/\s+/g, "");
}

function localRateFamily(description, unit, category) {
  const normalizedUnit = normalizeUnit(unit);
  if (category === "steel_fabrication" && (normalizedUnit === "kg" || normalizedUnit === "kgs")) {
    return "weighted_steel";
  }
  return null;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function rateKey(description, unit) {
  return `${normalize(description)}::${normalize(unit)}`;
}

function rowFromAnchor(anchor) {
  const match = /^sheet:.+;row:(\d+)$/i.exec(anchor ?? "");
  return match ? Number(match[1]) : null;
}

const boq = extractWorkbookBOQ(fs.readFileSync(path.resolve(workbookArg)));
const existingRates = boq.bills.flatMap((bill) =>
  bill.items
    .filter((item) => !item.is_header && item.rate !== null)
    .map((item) => ({
      description: item.description,
      unit: item.unit,
      rate: item.rate,
    }))
);

const exactRateMap = new Map();
for (const row of existingRates) {
  const key = rateKey(row.description, row.unit);
  exactRateMap.set(key, [...(exactRateMap.get(key) ?? []), row.rate]);
}

const billLocalRates = new Map();
const filled = [];
const stillBlank = [];

function addBillRate(billKey, entry) {
  billLocalRates.set(billKey, [...(billLocalRates.get(billKey) ?? []), entry]);
}

for (const bill of boq.bills) {
  for (const item of bill.items) {
    if (item.is_header) continue;
    const category = classify(item.description, item.unit);
    const billKey = `${normalize(bill.title)}::${normalize(item.workbook_context ?? "")}`;

    if (item.rate !== null) {
      const family = localRateFamily(item.description, item.unit, category);
      addBillRate(billKey, {
        description: item.description,
        unit: item.unit,
        rate: item.rate,
        category,
        family,
      });
      continue;
    }

    let matchedRate = median(exactRateMap.get(rateKey(item.description, item.unit)) ?? []);
    let reason = matchedRate !== null ? "exact_duplicate" : null;
    const priorBillRates = billLocalRates.get(billKey) ?? [];
    const isExplicitDitto = /\bditto\b/i.test(item.description);

    if (matchedRate === null && category === "ditto_reference" && isExplicitDitto) {
      const inherited = [...priorBillRates]
        .reverse()
        .find((candidate) => candidate.unit === item.unit || !item.unit || !candidate.unit);
      if (inherited) {
        matchedRate = inherited.rate;
        reason = "explicit_ditto_nearest_parent";
      }
    }

    if (matchedRate === null && requiresLocalPrecedent(category) && category !== "ditto_reference") {
      const family = localRateFamily(item.description, item.unit, category);
      const precedent = [...priorBillRates]
        .reverse()
        .find(
          (candidate) =>
            normalizeUnit(candidate.unit) === normalizeUnit(item.unit) &&
            (candidate.category === category || (family !== null && candidate.family === family))
        );
      if (precedent) {
        matchedRate = precedent.rate;
        reason = "same_category_same_unit_precedent";
      }
    }

    if (matchedRate !== null) {
      addBillRate(billKey, {
        description: item.description,
        unit: item.unit,
        rate: matchedRate,
        category,
        family: localRateFamily(item.description, item.unit, category),
      });
      filled.push({
        row: rowFromAnchor(item.source_anchor),
        item_no: item.item_no,
        description: item.description,
        unit: item.unit,
        qty: item.qty,
        category,
        rate: matchedRate,
        reason,
      });
    } else {
      stillBlank.push({
        row: rowFromAnchor(item.source_anchor),
        item_no: item.item_no,
        description: item.description,
        unit: item.unit,
        qty: item.qty,
        category,
        likelyReason: requiresLocalPrecedent(category) ? "still_gated" : "needs_ai",
      });
    }
  }
}

console.log(JSON.stringify({
  workbook: workbookArg,
  filledByLocalInheritance: filled.length,
  stillBlank: stillBlank.length,
  filledByReason: filled.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1;
    return acc;
  }, {}),
  sampleFilled: filled.slice(0, 40),
  sampleStillBlank: stillBlank.slice(0, 40),
}, null, 2));
