const jiti = require("jiti")(__filename, { interopDefault: true });
const { findRateAnchors } = jiti("../lib/rate-matcher.ts");

const tests = [
  { description: "Excavate in pickable material for foundation trenches", unit: "m³" },
  { description: "Concrete Grade 25 in foundations", unit: "m³" },
  { description: "Ceramic floor tiles supply and fix", unit: "m²" },
  { description: "Mobilisation and demobilisation", unit: "Item" },
  { description: "150mm uPVC soil pipe", unit: "lm" },
];
const THRESHOLD = 0.25;

for (const t of tests) {
  const anchors = findRateAnchors(t.description, t.unit, 2, THRESHOLD);
  console.log("QUERY:", t.description, "/", t.unit);
  anchors.forEach((a) =>
    console.log("  ->", a.rate, "ZMW |", a.description.slice(0, 70), "| score:", a.score.toFixed(2))
  );
  if (!anchors.length) console.log("  -> no match");
  console.log();
}
