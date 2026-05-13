import rateLibrary from "./rate-library.json";
import zppaLibrary from "./zppa-rate-library.json";

export type RateAnchor = {
  description: string;
  unit: string;
  rate: number;
  project: string;
  province: string;
  score: number;
  source: "historical" | "zppa";
  project_type?: string;
};

type LibraryEntry = {
  description: string;
  unit: string;
  rate: number;
  project: string;
  province: string;
  project_type?: string;
};

type ZppaEntry = {
  product_code: string;
  description: string;
  unit: string;
  source: string;
  project_type: string;
  province_rates: Record<string, { min: number | null; avg: number | null; max: number | null }>;
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    // British/American spelling variants common in Zambian BOQs
    .replace(/isation/g, "ization")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Canonical unit groups — any unit in the same group matches any other
const UNIT_GROUPS: string[][] = [
  ["m", "lm", "lin m", "linear m", "lineal m", "rm", "run"],
  ["m2", "m²", "sqm", "sq m"],
  ["m3", "m³", "cum", "cu m"],
  ["no", "no.", "nr", "each", "ea", "pcs", "pc", "nos"],
  ["ls", "l.s", "l/s", "lump sum", "lumpsum", "sum"],
  ["item", "items"],
  ["kg", "kgs"],
  ["t", "ton", "tonne", "mt"],
  ["pair", "pr"],
  ["roll", "rl"],
  ["box", "bx"],
  ["bunch", "bch"],
];

function canonicalUnit(unit: string): string {
  const u = normalize(unit);
  for (const group of UNIT_GROUPS) {
    if (group.includes(u)) return group[0];
  }
  return u;
}

function tokenize(text: string): Set<string> {
  const STOP = new Set(["the", "a", "an", "in", "of", "to", "and", "or", "for", "as", "at", "on", "is", "be", "with"]);
  return new Set(
    normalize(text)
      .split(" ")
      .filter((t) => t.length > 1 && !STOP.has(t))
  );
}

function jaccardScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

const historicalEntries = rateLibrary.entries as LibraryEntry[];
const zppaEntries = zppaLibrary.entries as ZppaEntry[];

// Pre-tokenize both libraries once at module load
const tokenizedHistorical = historicalEntries.map((e) => ({
  entry: e,
  tokens: tokenize(e.description),
  normUnit: canonicalUnit(e.unit),
}));

const tokenizedZppa = zppaEntries.map((e) => ({
  entry: e,
  tokens: tokenize(e.description),
  normUnit: canonicalUnit(e.unit),
}));

function zppaRate(entry: ZppaEntry, province?: string): number | null {
  const key = province?.toLowerCase().replace(/\s+/g, "") ?? "national";
  const rates = entry.province_rates[key] ?? entry.province_rates["national"];
  return rates?.avg ?? null;
}

/**
 * Find the best matching rate anchors from both libraries for a given item.
 * Returns up to `limit` matches above the score threshold.
 *
 * @param province  Optional Zambian province slug (e.g. "lusaka", "copperbelt") — used to pick ZPPA provincial rate
 * @param projectType  Optional "government" | "commercial" — currently informational, not used to filter
 */
export function findRateAnchors(
  description: string,
  unit: string,
  limit = 3,
  threshold = 0.25,
  province?: string,
  projectType?: string,
): RateAnchor[] {
  const queryTokens = tokenize(description);
  const queryUnit = canonicalUnit(unit);

  // Score historical entries
  const historicalScored = tokenizedHistorical
    .map(({ entry, tokens, normUnit }) => {
      const descScore = jaccardScore(queryTokens, tokens);
      const unitMatch = normUnit === queryUnit ? 1 : normUnit.includes(queryUnit) || queryUnit.includes(normUnit) ? 0.6 : 0;
      if (unitMatch === 0) return null;
      const score = descScore * unitMatch;
      if (score < threshold) return null;
      return {
        description: entry.description,
        unit: entry.unit,
        rate: entry.rate,
        project: entry.project,
        province: entry.province,
        project_type: entry.project_type,
        score,
        source: "historical" as const,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // Score ZPPA entries
  const zppaScored = tokenizedZppa
    .map(({ entry, tokens, normUnit }) => {
      const descScore = jaccardScore(queryTokens, tokens);
      const unitMatch = normUnit === queryUnit ? 1 : normUnit.includes(queryUnit) || queryUnit.includes(normUnit) ? 0.6 : 0;
      if (unitMatch === 0) return null;
      const score = descScore * unitMatch;
      if (score < threshold) return null;
      const rate = zppaRate(entry, province);
      if (rate === null) return null;
      return {
        description: entry.description,
        unit: entry.unit,
        rate,
        project: "ZPPA Market Price Index",
        province: province ?? "national",
        project_type: "government",
        score,
        source: "zppa" as const,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // Merge, sort by score, deduplicate by keeping best per description+unit combo
  const combined = [...historicalScored, ...zppaScored]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 3); // over-fetch before dedup

  // Deduplicate: prefer higher score, then historical over zppa for ties
  const seen = new Set<string>();
  const deduped: RateAnchor[] = [];
  for (const r of combined) {
    const key = normalize(r.description).slice(0, 40) + "|" + canonicalUnit(r.unit);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
    if (deduped.length >= limit) break;
  }

  return deduped;
}
