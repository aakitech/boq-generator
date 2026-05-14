/**
 * Extracts Building & Construction rates from the ZPPA Market Price Index PDF
 * and writes lib/zppa-rate-library.json.
 *
 * Usage: node tools/extract-zppa-rates.cjs
 */

const fs = require("fs");
const path = require("path");

const PDF_FILE = path.resolve(__dirname, "../inspo_docs/Q2 2026 MPI_Trends.pdf");
const OUT_FILE = path.resolve(__dirname, "../lib/zppa-rate-library.json");

// Province x-anchors (start of Min column, from header row analysis)
const PROVINCES = [
  { name: "central",      minX: 225 },
  { name: "copperbelt",   minX: 313 },
  { name: "eastern",      minX: 405 },
  { name: "luapula",      minX: 489 },
  { name: "lusaka",       minX: 577 },
  { name: "muchinga",     minX: 660 },
  { name: "northern",     minX: 745 },
  { name: "northwestern", minX: 828 },
  { name: "southern",     minX: 914 },
  { name: "western",      minX: 996 },
  { name: "national",     minX: 1073 },
];

const COL_WIDTH = 28;

function parseNum(str) {
  if (!str || !str.trim() || str.trim() === "-") return null;
  const n = parseFloat(str.replace(/,/g, "").trim());
  return isNaN(n) ? null : n;
}

function provinceAndSlot(x) {
  for (let i = PROVINCES.length - 1; i >= 0; i--) {
    if (x >= PROVINCES[i].minX - 12) {
      const offset = x - PROVINCES[i].minX;
      const slot = offset < COL_WIDTH ? "min" : offset < COL_WIDTH * 2 ? "avg" : "max";
      return { province: PROVINCES[i].name, slot };
    }
  }
  return null;
}

async function main() {
  const pdfParse = require(path.resolve(__dirname, "../node_modules/pdf-parse"));

  const TARGET_PAGES = new Set([10, 11, 12, 13, 14]);

  let currentPage = 0;
  const pageItems = {};

  const pagerender = async (pageData) => {
    currentPage++;
    if (!TARGET_PAGES.has(currentPage)) return "";
    const tc = await pageData.getTextContent({ normalizeWhitespace: true });
    pageItems[currentPage] = tc.items.map((item) => ({
      text: item.str,
      x: Math.round(item.transform[4]),
      y: Math.round(item.transform[5]),
    }));
    return "";
  };

  console.log("Parsing Q2 2026 MPI PDF...");
  const buf = fs.readFileSync(PDF_FILE);
  await pdfParse(buf, { pagerender });

  const products = new Map();

  for (const pageNum of TARGET_PAGES) {
    const items = pageItems[pageNum];
    if (!items) { console.warn("Missing page", pageNum); continue; }

    // Group by y, sorted top-to-bottom (descending y in PDF space)
    const byY = new Map();
    for (const item of items) {
      if (!byY.has(item.y)) byY.set(item.y, []);
      byY.get(item.y).push(item);
    }
    const ys = Array.from(byY.keys()).sort((a, b) => b - a);

    // Build structured rows
    const rows = ys.map((y) => {
      const all = byY.get(y);
      const sn   = all.filter(i => i.x < 50).map(i => i.text.trim()).join("").trim();
      const code = all.filter(i => i.x >= 50 && i.x < 96).map(i => i.text.trim()).join("").trim();
      const desc = all.filter(i => i.x >= 96 && i.x < 206).map(i => i.text.trim()).join(" ").trim();
      const uom  = all.filter(i => i.x >= 206 && i.x < 232).map(i => i.text.trim()).join("").trim();
      const data = all.filter(i => i.x >= 225 && i.text.trim() && i.text.trim() !== "-");
      const isProduct = /^\d{10}$/.test(code);
      return { y, sn, code, desc, uom, data, isProduct };
    });

    // Skip header rows
    const skipDesc = new Set([
      "table 5", "building and construction", "product description", "s/n"
    ]);

    const dataRows = rows.filter(r =>
      !skipDesc.has(r.desc.toLowerCase().slice(0, 20)) &&
      !(r.sn.toLowerCase() === "s/n") &&
      !(r.code.toLowerCase() === "product code")
    );

    // Walk rows. Key insight: description-only rows can appear BEFORE or AFTER the code row.
    // Strategy: collect pending description fragments; attach when we find the code row.
    let pendingDesc = [];
    let pendingUom = "";
    let currentCode = null;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const next = dataRows[i + 1];

      if (row.isProduct) {
        const isDuplicate = products.has(row.code);
        // Start new product (or mark as duplicate to skip data)
        currentCode = isDuplicate ? null : row.code;

        if (!isDuplicate) {
          const entry = {
            product_code: row.code,
            description: "",
            unit: "",
            province_rates: {},
          };
          // Attach desc: could be pending (floated above this row) or on same row
          const descParts = [...pendingDesc];
          if (row.desc) descParts.push(row.desc);
          entry.description = descParts.join(" ").trim();
          entry.unit = row.uom || pendingUom;
          products.set(row.code, entry);
        }

        pendingDesc = [];
        pendingUom = "";
      } else if (!row.sn && !row.code) {
        // Continuation row (desc-only, uom-only, or data-only)
        if (row.desc) {
          // Could be: (a) continuation of current product desc, or (b) leading desc for next product
          // If the next row is a product row, this desc belongs to that next product
          if (next && next.isProduct) {
            pendingDesc.push(row.desc);
          } else if (currentCode) {
            // Append to current product
            const entry = products.get(currentCode);
            if (entry) entry.description = (entry.description + " " + row.desc).trim();
          }
        }
        if (row.uom && currentCode) {
          const entry = products.get(currentCode);
          if (entry && !entry.unit) entry.unit = row.uom;
        }
      }

      // Parse data columns — use currentCode (null for duplicates, so they're skipped)
      const targetCode = currentCode;
      if (targetCode && row.data.length > 0) {
        const entry = products.get(targetCode);
        if (!entry) continue;
        for (const item of row.data) {
          const ps = provinceAndSlot(item.x);
          if (!ps) continue;
          const { province, slot } = ps;
          if (!entry.province_rates[province]) {
            entry.province_rates[province] = { min: null, avg: null, max: null };
          }
          const val = parseNum(item.text);
          if (val !== null && entry.province_rates[province][slot] === null) {
            entry.province_rates[province][slot] = val;
          }
        }
      }
    }
  }

  const entries = Array.from(products.values())
    .filter(e => Object.values(e.province_rates).some(v => v && v.avg !== null))
    .map(e => ({
      product_code: e.product_code,
      description: e.description.replace(/\s+/g, " ").trim(),
      unit: e.unit,
      source: "ZPPA Q2 2026",
      project_type: "government",
      province_rates: e.province_rates,
    }))
    .sort((a, b) => a.product_code.localeCompare(b.product_code));

  const output = {
    generated_at: new Date().toISOString(),
    source_file: "Q2 2026 MPI_Trends.pdf",
    source: "ZPPA Q2 2026",
    section: "Table 5: Building and Construction Products",
    entry_count: entries.length,
    entries,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Written ${entries.length} entries to ${OUT_FILE}`);

  // Spot-check known items
  const checks = [
    { code: "1111170104", expectedDesc: "Building Sand" },
    { code: "3010362301", expectedDesc: "Brick force Wire 4 inch" },
    { code: "3016160204", expectedDesc: "Ceiling" },
    { code: "3026580201", expectedDesc: "Damp Proof Course" },
    { code: "3013170405", expectedDesc: "Tiles" },
  ];
  console.log("\nSpot checks:");
  for (const { code, expectedDesc } of checks) {
    const e = entries.find(x => x.product_code === code);
    if (!e) { console.log(`  ${code}: NOT FOUND`); continue; }
    const lu = e.province_rates.lusaka;
    const na = e.province_rates.national;
    const ok = e.description.includes(expectedDesc.split(" ")[0]) ? "OK" : "WARN desc mismatch";
    console.log(`  ${code} [${ok}] | ${e.description} | ${e.unit}`);
    console.log(`    Lusaka:   ${lu?.min} / ${lu?.avg} / ${lu?.max}`);
    console.log(`    National: ${na?.min} / ${na?.avg} / ${na?.max}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
