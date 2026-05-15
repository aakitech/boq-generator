export function cleanExtractedText(text: string): string {
  return text
    .replace(/\.{4,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[^a-zA-Z0-9\n]{5,}$/gm, "")
    .replace(/[ \t]{3,}/g, "  ")
    .trim();
}
