/**
 * Seed the Supabase rate_library table with embeddings.
 * Usage: node tools/seed-rate-library.cjs
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   GEMINI_API_KEY
 */
"use strict";

require("dotenv").config({ path: ".env.local" });

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_DIMS = 768;
const BATCH_SIZE = 100;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const geminiKey = process.env.GEMINI_API_KEY;

if (!supabaseUrl || !serviceRoleKey || !geminiKey) {
  console.error("Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

async function embedBatch(texts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${geminiKey}`;
  const body = {
    requests: texts.map((text) => ({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
    })),
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.embeddings.map((e) => e.values);
}

function canonicalUnit(u) {
  return (u || "").toLowerCase().trim().replace(/\.$/, "");
}

async function seedEntries(rows, label) {
  console.log(`\nSeeding ${rows.length} ${label} entries...`);
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map((r) => r.description);

    let embeddings;
    try {
      embeddings = await embedBatch(texts);
    } catch (err) {
      console.error(`  Batch ${i}-${i + batch.length} embed failed:`, err.message);
      failed += batch.length;
      continue;
    }

    const records = batch.map((r, idx) => ({
      description: r.description,
      unit: canonicalUnit(r.unit),
      rate: r.rate,
      project: r.project || null,
      province: r.province ? r.province.toLowerCase() : null,
      project_type: r.project_type || null,
      source: r.source || "historical",
      embedding: embeddings[idx],
    }));

    const { error } = await supabase.from("rate_library").insert(records);
    if (error) {
      console.error(`  Batch ${i}-${i + batch.length} insert failed:`, error.message);
      failed += batch.length;
    } else {
      inserted += batch.length;
      process.stdout.write(`  ${inserted}/${rows.length}\r`);
    }

    // Small delay to avoid rate limiting
    if (i + BATCH_SIZE < rows.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`  Done: ${inserted} inserted, ${failed} failed`);
  return inserted;
}

async function main() {
  console.log("=== Rate Library Seed Script ===");
  console.log(`Supabase: ${supabaseUrl}`);
  console.log(`Embedding model: ${EMBEDDING_MODEL} (${EMBEDDING_DIMS}d)`);

  // Check existing row count
  const { count: existing } = await supabase
    .from("rate_library")
    .select("*", { count: "exact", head: true });
  console.log(`\nExisting rows in rate_library: ${existing ?? 0}`);

  if (existing > 0) {
    console.log("Table is not empty. Clearing before re-seed...");
    const { error } = await supabase.from("rate_library").delete().neq("id", 0);
    if (error) {
      console.error("Clear failed:", error.message);
      process.exit(1);
    }
    console.log("Cleared.");
  }

  // --- Historical rate library ---
  const histData = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/rate-library.json"), "utf8"));
  const histRows = histData.entries
    .filter((e) => e.description && e.rate > 0)
    .map((e) => ({
      description: e.description,
      unit: e.unit,
      rate: e.rate,
      project: e.project || null,
      province: e.province || null,
      project_type: e.project_type || null,
      source: "historical",
    }));

  await seedEntries(histRows, "historical");

  // --- ZPPA rate library ---
  // Each ZPPA entry has province_rates with min/avg/max per province.
  // We expand: one row per province using avg rate.
  const zppaData = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/zppa-rate-library.json"), "utf8"));
  const zppaRows = [];
  for (const entry of zppaData.entries) {
    if (!entry.description || !entry.province_rates) continue;
    for (const [province, rates] of Object.entries(entry.province_rates)) {
      if (!rates.avg || rates.avg <= 0) continue;
      zppaRows.push({
        description: entry.description,
        unit: entry.unit || "each",
        rate: rates.avg,
        project: "ZPPA Q2 2026",
        province,
        project_type: entry.project_type || "government",
        source: "zppa",
      });
    }
  }

  await seedEntries(zppaRows, "ZPPA");

  // Final count
  const { count: final } = await supabase
    .from("rate_library")
    .select("*", { count: "exact", head: true });
  console.log(`\nFinal row count: ${final}`);
  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
