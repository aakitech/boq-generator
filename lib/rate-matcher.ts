import rateLibrary from "./rate-library.json";

export type RateAnchor = {
  description: string;
  unit: string;
  rate: number;
  project: string;
  province: string;
  score: number;
};

type LibraryEntry = {
  description: string;
  unit: string;
  rate: number;
  project: string;
  province: string;
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

const entries = rateLibrary.entries as LibraryEntry[];

// Pre-tokenize library once at module load
const tokenizedEntries = entries.map((e) => ({
  entry: e,
  tokens: tokenize(e.description),
  normUnit: canonicalUnit(e.unit),
}));

/**
 * Find the best matching rate anchors from the library for a given item.
 * Returns up to `limit` matches above the score threshold.
 */
export function findRateAnchors(
  description: string,
  unit: string,
  limit = 3,
  threshold = 0.25
): RateAnchor[] {
  const queryTokens = tokenize(description);
  const queryUnit = canonicalUnit(unit);

  const scored = tokenizedEntries
    .map(({ entry, tokens, normUnit }) => {
      const descScore = jaccardScore(queryTokens, tokens);
      // Unit must match or be close — penalise mismatches hard
      const unitMatch = normUnit === queryUnit ? 1 : normUnit.includes(queryUnit) || queryUnit.includes(normUnit) ? 0.6 : 0;
      if (unitMatch === 0) return null;
      return { entry, score: descScore * unitMatch };
    })
    .filter((r): r is { entry: LibraryEntry; score: number } => r !== null && r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ entry, score }) => ({
    description: entry.description,
    unit: entry.unit,
    rate: entry.rate,
    project: entry.project,
    province: entry.province,
    score,
  }));
}
