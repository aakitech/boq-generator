/**
 * End-to-end benchmark: P9-D10 Water Supply project
 * Usage: node tools/benchmark-p9d10.cjs
 */
const ROOT = "c:/Users/User/source/repos/boq-generator";
const jiti = require("jiti")(__filename, { interopDefault: true, alias: { "@": ROOT } });
const { generateBOQ } = jiti(`${ROOT}/lib/ai.ts`);
const { extractDrawingWithVision, formatDrawingTextForPrompt } = jiti(`${ROOT}/lib/drawing-extractor.ts`);
const pdfParse = require("pdf-parse");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

const DRAWINGS_DIR = path.resolve(ROOT, "inspo_docs/P9-D10-drawings");
// The priced copy lives in inspo_docs/, not in the drawings subfolder
const PRICED_BOQ_PATH = path.resolve(ROOT, "inspo_docs/PRICED ZS P9-D10 WS CMEWorks TenderDoc BOQ Rev B 20260308.xlsx");

// Minimum chars to consider a PDF text extraction useful without Vision fallback
const MIN_TEXT_CHARS = 200;

const INPUT_FILES = [
  { name: "P9 Line _ Dam 10 Water Plant Design Report.pdf", role: "primary" },
  { name: "ZS P9WS 001 Rev A 20260204.pdf",  role: "supporting" },
  { name: "ZS P9WS 002 Rev A 20260204.pdf",  role: "supporting" },
  { name: "ZS P9WS 003 Rev B 20260304.pdf",  role: "supporting" },
  { name: "ZS P9WS 004 Rev B 20260304.pdf",  role: "supporting" },
  { name: "ZSP9WS 005 Rev A 20260223.pdf",   role: "supporting" },
  { name: "ZSP9WS 006 Rev A 20260223.pdf",   role: "supporting" },
  { name: "ZS P9WS 007 Rev A 20260227.pdf",  role: "supporting" },
  { name: "ZS P9WS 008 Rev A 20260227.pdf",  role: "supporting" },
  { name: "ZS P9WS 009 Rev A 20260304.pdf",  role: "supporting" },
  { name: "ZSP9WS 011 Rev B 20260304.pdf",   role: "supporting" },
  { name: "ZSP9WS 012 Rev B 20260304.pdf",   role: "supporting" },
  { name: "ZSP9WS 013 Rev B 20260304.pdf",   role: "supporting" },
  { name: "ZSP9WS 014 Rev B 20260304.pdf",   role: "supporting" },
  { name: "ZSP9WS 015 Rev B 20260304.pdf",   role: "supporting" },
  { name: "ZSP9WS 016 Rev A 20260304.pdf",   role: "supporting" },
];

function log(msg)  { console.log(`[${new Date().toISOString()}] ${msg}`); }
function step(msg) {
  const bar = "=".repeat(70);
  console.log(`\n${bar}\n[STEP] ${msg}\n${bar}`);
}

async function extractPdf(filePath, useVisionIfSparse = true) {
  const buf = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  let pageNum = 0;
  const pagerender = async (pageData) => {
    pageNum++;
    const tc = await pageData.getTextContent({ normalizeWhitespace: true });
    let text = `\n[PAGE ${pageNum}]\n`;
    let lastY;
    for (const item of tc.items) {
      if (lastY === item.transform[5] || lastY === undefined) text += item.str;
      else text += `\n${item.str}`;
      lastY = item.transform[5];
    }
    return `${text}\n`;
  };
  const data = await pdfParse(buf, { pagerender });
  const directText = data.text.trim();

  // If text is sparse (scanned/drawing PDF), use Gemini Vision
  if (useVisionIfSparse && directText.length < MIN_TEXT_CHARS) {
    log(`  [sparse text: ${directText.length} chars] — using Gemini Vision extractor`);
    try {
      const result = await extractDrawingWithVision(buf, filename);
      if (result.text && result.text.length > directText.length) {
        const formatted = formatDrawingTextForPrompt(result.text, filename);
        log(`  [Vision] extracted ${formatted.length} chars, drawing_type=${result.drawing_type}, subject=${result.subject_name}`);
        return { text: formatted, pages: data.numpages, via: "vision", drawing_type: result.drawing_type, subject_name: result.subject_name };
      }
    } catch (err) {
      log(`  [Vision] failed: ${err.message} — using sparse direct text`);
    }
  }
  return { text: directText, pages: data.numpages, via: "direct" };
}

async function loadPricedBOQ() {
  log(`Loading priced BOQ: ${path.basename(PRICED_BOQ_PATH)}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(PRICED_BOQ_PATH);
  const ws = wb.getWorksheet("BOQ");
  const items = [];
  let currentBill = "General";
  for (let r = 9; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const desc = String(row.getCell(4).value || "").trim();
    const unitRaw = row.getCell(5).value;
    const qty = row.getCell(6).value;
    const rate = row.getCell(7).value;
    if (!desc) continue;
    const unit = unitRaw && typeof unitRaw === "object" && unitRaw.richText
      ? unitRaw.richText.map((r) => r.text).join("").trim()
      : String(unitRaw || "").trim();
    if (typeof rate === "number" && rate > 0 && unit) {
      items.push({ description: desc, unit, qty: typeof qty === "number" ? qty : null, rate, bill: currentBill });
    } else if (desc && !unit && (rate === null || rate === undefined)) {
      currentBill = desc.slice(0, 60);
    }
  }
  log(`Priced BOQ loaded: ${items.length} rated line items`);
  return items;
}

function compareRates(generatedBills, pricedItems) {
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  const allGenItems = generatedBills.flatMap((b) =>
    b.items.filter((i) => !i.is_header && i.rate != null).map((i) => ({ ...i, bill: b.title }))
  );
  log(`Comparing ${allGenItems.length} generated rated items vs ${pricedItems.length} priced items`);
  const results = [];
  for (const gen of allGenItems) {
    const genNorm = normalize(gen.description);
    let best = null, bestScore = 0;
    for (const p of pricedItems) {
      const pNorm = normalize(p.description);
      const tokA = new Set(genNorm.split(" ").filter((t) => t.length > 2));
      const tokB = new Set(pNorm.split(" ").filter((t) => t.length > 2));
      let inter = 0;
      for (const t of tokA) if (tokB.has(t)) inter++;
      const union = tokA.size + tokB.size - inter;
      const score = union > 0 ? inter / union : 0;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (best && bestScore > 0.3) {
      const diff = ((gen.rate - best.rate) / best.rate) * 100;
      results.push({
        bill: gen.bill.slice(0, 30),
        description: gen.description.slice(0, 55),
        unit: gen.unit,
        generated_rate: gen.rate,
        actual_rate: best.rate,
        diff_pct: parseFloat(diff.toFixed(1)),
        match_score: parseFloat(bestScore.toFixed(2)),
        matched_desc: best.description.slice(0, 55),
      });
    }
  }
  return results.sort((a, b) => Math.abs(b.diff_pct) - Math.abs(a.diff_pct));
}

async function main() {
  const runStart = Date.now();

  step("1 of 4 — Extracting input documents");
  const documents = [];
  for (const f of INPUT_FILES) {
    const filePath = path.join(DRAWINGS_DIR, f.name);
    if (!fs.existsSync(filePath)) { log(`SKIP (not found): ${f.name}`); continue; }
    log(`Extracting [${f.role}]: ${f.name}`);
    const t0 = Date.now();
    const extracted = await extractPdf(filePath, f.role === "supporting");
    const trimmed = extracted.text.trim();
    const truncated = trimmed.length > 80000 ? trimmed.slice(0, 80000) + "\n...[truncated]" : trimmed;
    const { pages } = extracted;
    log(`  => ${pages}p, ${trimmed.length} chars${trimmed.length > 80000 ? " [TRUNCATED to 80k]" : ""}, via=${extracted.via}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    log(`  Preview: "${trimmed.slice(0, 150).replace(/\n/g, " ").trim()}"`);
    documents.push({
      document_id: f.name.replace(/[^a-z0-9]/gi, "_"),
      name: f.name,
      text: truncated,
      pages,
      role: f.role,
      drawing_type: extracted.drawing_type ?? null,
      subject_name: extracted.subject_name ?? null,
    });
  }
  log(`\nDocuments ready: ${documents.length} (${documents.filter((d) => d.role === "primary").length} primary, ${documents.filter((d) => d.role === "supporting").length} supporting)`);

  step("2 of 4 — Running generateBOQ");
  const rateContext = {
    province: "Southern",
    projectType: "water_sanitation",
    accessibility: "main_road",
    labourSource: "mixed",
    marginPct: 15,
    estimatedValueZMW: 27_000_000,  // from Innocent's priced BOQ
    isGovernmentTender: true,
  };
  log(`Rate context: ${JSON.stringify(rateContext)}`);
  log("Calling generateBOQ... (may take several minutes)");

  const genStart = Date.now();
  const boq = await generateBOQ({ documents }, { suggestRates: true, rateContext });
  const genElapsed = ((Date.now() - genStart) / 1000).toFixed(1);
  log(`generateBOQ done in ${genElapsed}s`);

  step("3 of 4 — Generated BOQ structure");
  const allItems = boq.bills.flatMap((b) => b.items.filter((i) => !i.is_header));
  const ratedItems = allItems.filter((i) => i.rate != null);
  const missingRate = allItems.filter((i) => i.rate == null);
  const grandTotal = allItems.reduce(
    (s, i) => s + (i.amount ?? (i.qty != null && i.rate != null ? i.qty * i.rate : 0)),
    0
  );

  log(`Project:     ${boq.project}`);
  log(`Location:    ${boq.location}`);
  log(`Bills:       ${boq.bills.length}`);
  log(`Items:       ${allItems.length} total | ${ratedItems.length} rated | ${missingRate.length} missing rate`);
  log(`Grand total: ZMW ${grandTotal.toLocaleString()}`);
  log("");
  for (const b of boq.bills) {
    const its = b.items.filter((i) => !i.is_header);
    const rt = its.filter((i) => i.rate != null);
    const bt = its.reduce((s, i) => s + (i.amount ?? (i.qty != null && i.rate != null ? i.qty * i.rate : 0)), 0);
    log(`  ${b.title.slice(0, 55).padEnd(55)} ${String(its.length).padStart(3)} items | ${String(rt.length).padStart(3)} rated | ZMW ${bt.toLocaleString()}`);
    its.slice(0, 3).forEach((i) => log(`    - ${i.description.slice(0, 60)} [${i.unit}] rate=${i.rate}`));
  }
  if (missingRate.length > 0) {
    log(`\nMissing rates (first 10):`);
    missingRate.slice(0, 10).forEach((i) => log(`  - ${i.description.slice(0, 60)} [${i.unit}]`));
  }

  step("4 of 4 — Rate comparison vs priced BOQ");
  const pricedItems = await loadPricedBOQ();
  const pricedTotal = pricedItems.reduce((s, i) => s + (i.qty != null ? i.qty * i.rate : i.rate), 0);
  log(`Priced total:    ZMW ${pricedTotal.toLocaleString()}`);
  log(`Generated total: ZMW ${grandTotal.toLocaleString()}`);
  log(`Total variance:  ${((grandTotal - pricedTotal) / pricedTotal * 100).toFixed(1)}%`);

  const comparison = compareRates(boq.bills, pricedItems);
  if (comparison.length > 0) {
    const w20 = comparison.filter((r) => Math.abs(r.diff_pct) <= 20).length;
    const w50 = comparison.filter((r) => Math.abs(r.diff_pct) <= 50).length;
    const over100 = comparison.filter((r) => Math.abs(r.diff_pct) > 100).length;
    log(`Within +-20%: ${w20}/${comparison.length} (${(w20 / comparison.length * 100).toFixed(0)}%)`);
    log(`Within +-50%: ${w50}/${comparison.length} (${(w50 / comparison.length * 100).toFixed(0)}%)`);
    log(`Over +-100%:  ${over100}/${comparison.length}`);
    log("\nTop variances (worst first):");
    const cols = [32, 6, 12, 12, 8, 6];
    const hdr = ["Description", "Unit", "Generated", "Actual", "Diff%", "Score"].map((h, i) => h.padEnd(cols[i])).join(" ");
    log(hdr);
    log("-".repeat(hdr.length));
    for (const r of comparison.slice(0, 40)) {
      const flag = Math.abs(r.diff_pct) > 100 ? " !!!" : Math.abs(r.diff_pct) > 50 ? " !" : "";
      log(
        [
          r.description.slice(0, 32).padEnd(cols[0]),
          r.unit.padEnd(cols[1]),
          String(r.generated_rate).padStart(cols[2]),
          String(r.actual_rate).padStart(cols[3]),
          `${r.diff_pct}%`.padStart(cols[4]),
          r.match_score.toString().padStart(cols[5]),
        ].join(" ") + flag
      );
    }
  }

  const outPath = path.join(DRAWINGS_DIR, "benchmark-output.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        run_at: new Date().toISOString(),
        elapsed_generation_sec: genElapsed,
        rate_context: rateContext,
        summary: {
          project: boq.project,
          bills: boq.bills.length,
          items: allItems.length,
          rated: ratedItems.length,
          missing_rate: missingRate.length,
          grand_total_zmw: grandTotal,
        },
        priced_total_zmw: pricedTotal,
        comparison,
        full_boq: boq,
      },
      null,
      2
    )
  );
  log(`\nOutput written: ${outPath}`);
  log(`Total run time: ${((Date.now() - runStart) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error("\nFATAL:", e.message, "\n", e.stack);
  process.exit(1);
});
