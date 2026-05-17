/**
 * Ingest Innocent's priced BOQ Excel files into the rate_library table.
 *
 * Usage:
 *   node tools/ingest-innocent-boqs.cjs \
 *     --folder "C:/path/to/boqs from innocent" \
 *     --province southern \
 *     --env=.env.production.pulled
 *
 * Requires env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY
 */
"use strict";

const envArg = process.argv.find((a) => a.startsWith("--env="))?.slice(6) ?? ".env.local";
require("dotenv").config({ path: envArg });

const { createClient } = require("@supabase/supabase-js");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

// --- CLI args ---
const folderArg = process.argv.find((a) => a.startsWith("--folder="))?.slice(9) ??
  process.argv[process.argv.indexOf("--folder") + 1];
const provinceArg = (
  process.argv.find((a) => a.startsWith("--province="))?.slice(11) ??
  process.argv[process.argv.indexOf("--province") + 1] ??
  "southern"
).toLowerCase();
// Optional: --rate-date YYYY-MM-DD (or YYYY-MM or YYYY) — when these projects were priced
const rateDateArg =
  process.argv.find((a) => a.startsWith("--rate-date="))?.slice(12) ??
  process.argv[process.argv.indexOf("--rate-date") + 1] ??
  null;

if (!folderArg) {
  console.error("Usage: node tools/ingest-innocent-boqs.cjs --folder <path> [--province <province>] [--rate-date YYYY-MM-DD]");
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const geminiKey = process.env.GEMINI_API_KEY;

if (!supabaseUrl || !serviceRoleKey || !geminiKey) {
  console.error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMS = 768;
const BATCH_SIZE = 100;

// --- File → project name mapping ---
const FILE_PROJECT_MAP = [
  { match: /NAKAMBALA PRIVATE SCHOOL\.xlsx$/i, project: "Nakambala Private School" },
  { match: /Upgrading of the Sewarage/i, project: "Njomona Ponds Sewerage Ph1" },
  { match: /DRIP AND FILTER STATION/i, project: "Drip & Filter Station Ph4" },
  { match: /ROOFING AND CLADDING/i, project: "Cane Yard Workshop" },
  { match: /PALISADE FENCES/i, project: "Palisade Fences Lot 31" },
  { match: /House number 23/i, project: "House 23 Kabanje Renovation" },
  { match: /NAK PRIVATE SCHOOL-LOT 01/i, project: "Nakambala School Lot 01" },
  { match: /NAK PRIVATE SCHOOL-LOT 02/i, project: "Nakambala School Lot 02" },
  { match: /NAK PRIVATE SCHOOL-LOT 03/i, project: "Nakambala School Lot 03" },
];

function inferProject(filename) {
  for (const { match, project } of FILE_PROJECT_MAP) {
    if (match.test(filename)) return project;
  }
  // Fallback: clean up filename
  return path.basename(filename, path.extname(filename))
    .replace(/^(priced|BOQ|PRICED BOQ|Tender)\s*[-_]?\s*/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .slice(0, 80);
}

function normalizeHeader(h) {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function canonicalUnit(u) {
  return String(u ?? "").toLowerCase().trim().replace(/\.$/, "");
}

function cleanDescription(d) {
  return String(d ?? "").trim().replace(/\s+/g, " ");
}

function parseNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function isHeaderLike(desc) {
  if (!desc || desc.length < 2) return true;
  const d = desc.toLowerCase();
  // Skip rows that look like bill headers or column headers
  if (/^(bill|section|description|item|ref|no\.?$|total|sub.?total|carried|brought)/.test(d)) return true;
  if (/^\d+(\.\d+)*\s*$/.test(d)) return true; // pure numbers
  return false;
}

function getCellValue(cell) {
  if (!cell) return null;
  if (cell.value == null) return null;
  if (typeof cell.value === "object" && cell.value.result != null) return cell.value.result;
  if (typeof cell.value === "object" && cell.value.text != null) return cell.value.text;
  return cell.value;
}

function extractItemsFromWorksheet(ws) {
  // Collect all rows as arrays of values
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    // row.values is 1-indexed sparse array; normalize all cells to plain values
    const vals = [];
    for (let c = 1; c < row.values.length; c++) {
      const cell = row.getCell(c);
      vals.push(getCellValue(cell));
    }
    rows.push(vals);
  });

  if (rows.length < 2) return [];

  // Find header row
  let headerRowIdx = -1;
  let descCol = -1, unitCol = -1, rateCol = -1;

  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!row) continue;
    const normalized = row.map((v) => normalizeHeader(v));
    const dIdx = normalized.findIndex((h) => h.includes("description") || h === "desc");
    const uIdx = normalized.findIndex((h) => h === "unit" || h === "uom");
    const rIdx = normalized.findIndex((h) =>
      (h.includes("rate") || h.includes("unitrate")) &&
      !h.includes("amount") && !h.includes("total")
    );
    if (dIdx >= 0 && uIdx >= 0) {
      headerRowIdx = i;
      descCol = dIdx;
      unitCol = uIdx;
      rateCol = rIdx;
      break;
    }
  }

  if (headerRowIdx < 0 || descCol < 0) return [];

  const items = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const desc = cleanDescription(row[descCol]);
    const unit = canonicalUnit(row[unitCol]);
    const rate = rateCol >= 0 ? parseNumber(row[rateCol]) : null;

    if (!desc || isHeaderLike(desc)) continue;
    if (!rate || rate <= 0) continue;
    if (!unit) continue;

    items.push({ description: desc, unit, rate });
  }

  return items;
}

async function extractItemsFromFile(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const allItems = [];

  workbook.eachSheet((ws) => {
    const items = extractItemsFromWorksheet(ws);
    allItems.push(...items);
  });

  return allItems;
}

async function embedBatch(texts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${geminiKey}`;
  const body = {
    requests: texts.map((text) => ({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIMS,
    })),
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Embedding API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.embeddings.map((e) => e.values);
}

async function main() {
  console.log("=== Ingest Innocent's BOQ Files ===");
  console.log(`Folder:   ${folderArg}`);
  console.log(`Province: ${provinceArg}`);
  console.log(`Supabase: ${supabaseUrl}`);

  // Load all Excel files from folder
  const files = fs.readdirSync(folderArg)
    .filter((f) => /\.xlsx$/i.test(f))
    .map((f) => path.join(folderArg, f));

  console.log(`\nFound ${files.length} Excel files`);

  // Parse all files
  const allRows = [];
  for (const filePath of files) {
    const filename = path.basename(filePath);
    const project = inferProject(filename);
    let items;
    try {
      items = await extractItemsFromFile(filePath);
    } catch (err) {
      console.warn(`  SKIP ${filename}: ${err.message}`);
      continue;
    }
    const rated = items.filter((i) => i.rate > 0);
    console.log(`  ${filename}`);
    console.log(`    → project: "${project}", items with rate: ${rated.length}/${items.length}`);
    for (const item of rated) {
      allRows.push({
        description: item.description,
        unit: item.unit,
        rate: item.rate,
        project,
        province: provinceArg,
        project_type: "commercial",
        source: "historical",
        rate_date: rateDateArg ?? null,
      });
    }
  }

  console.log(`\nTotal rated items extracted: ${allRows.length}`);

  // Deduplicate within this batch
  const seen = new Set();
  const deduped = allRows.filter((r) => {
    const key = `${r.description.toLowerCase()}|${r.unit}|${r.rate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log(`After dedup within batch: ${deduped.length}`);

  // Check existing count
  const { count: existing } = await supabase
    .from("rate_library")
    .select("*", { count: "exact", head: true });
  console.log(`Existing rows in rate_library: ${existing ?? 0}`);

  // Embed and insert in batches
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE);
    const texts = batch.map((r) => r.description);

    let embeddings;
    try {
      embeddings = await embedBatch(texts);
    } catch (err) {
      console.error(`  Batch ${i}–${i + batch.length} embed failed: ${err.message}`);
      failed += batch.length;
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    const records = batch.map((r, idx) => ({
      description: r.description,
      unit: r.unit,
      rate: r.rate,
      project: r.project,
      province: r.province,
      project_type: r.project_type,
      source: r.source,
      embedding: embeddings[idx],
    }));

    const { error } = await supabase.from("rate_library").insert(records);
    if (error) {
      console.error(`  Batch ${i}–${i + batch.length} insert failed: ${error.message}`);
      failed += batch.length;
    } else {
      inserted += batch.length;
      process.stdout.write(`  Inserted ${inserted}/${deduped.length}\r`);
    }

    if (i + BATCH_SIZE < deduped.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`\n\nDone: ${inserted} inserted, ${failed} failed`);
  console.log(`\nVerify with SQL:`);
  console.log(`  SELECT COUNT(*), project FROM rate_library WHERE province = '${provinceArg}' GROUP BY project ORDER BY COUNT(*) DESC;`);

  if (rateDateArg && inserted > 0) {
    const projects = [...new Set(deduped.map((r) => r.project))];
    console.log(`\nBackfill rate_date (run in Supabase SQL editor):`);
    console.log(`  UPDATE rate_library SET rate_date = '${rateDateArg}'`);
    console.log(`  WHERE province = '${provinceArg}' AND rate_date IS NULL`);
    console.log(`  AND project IN (${projects.map((p) => `'${p.replace(/'/g, "''")}'`).join(", ")});`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
