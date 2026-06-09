const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const ExcelJS = require("exceljs");

function cleanLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function selectUsefulLines(lines) {
  const usefulPattern =
    /\b(?:project|drawing|layout|plan|demolition|construction|finish|ceiling|lighting|bill|summary|total|prelim|substructure|superstructure|plumbing|electrical|mechanical|joinery|office|hungry lion|vedanta|vendeta)\b/i;
  const selected = [];
  const seen = new Set();

  for (const line of lines) {
    if (!usefulPattern.test(line) || line.length > 220) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(line);
    if (selected.length >= 35) break;
  }

  return selected;
}

async function inspectPdf(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  const lines = cleanLines(data.text);

  return {
    type: "pdf",
    file: path.basename(filePath),
    size_bytes: buffer.length,
    pages: data.numpages,
    text_chars: data.text.trim().length,
    chars_per_page: Math.round(data.text.trim().length / Math.max(data.numpages, 1)),
    first_lines: lines.slice(0, 20),
    useful_lines: selectUsefulLines(lines),
  };
}

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    if ("result" in value && value.result != null) return String(value.result);
    if ("text" in value && value.text != null) return String(value.text);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("");
    }
  }
  return String(value);
}

async function inspectWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  return {
    type: "xlsx",
    file: path.basename(filePath),
    size_bytes: fs.statSync(filePath).size,
    sheets: workbook.worksheets.map((sheet) => {
      const nonEmptyRows = [];
      sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const values = [];
        row.eachCell({ includeEmpty: false }, (cell) => {
          const text = cellText(cell.value).replace(/\s+/g, " ").trim();
          if (text) values.push(text);
        });
        if (values.length > 0) {
          nonEmptyRows.push({ row: rowNumber, values: values.slice(0, 12) });
        }
      });

      return {
        name: sheet.name,
        row_count: sheet.rowCount,
        column_count: sheet.columnCount,
        merged_cell_ranges: Object.keys(sheet._merges ?? {}).length,
        first_rows: nonEmptyRows.slice(0, 25),
        section_rows: nonEmptyRows
          .filter(({ values }) =>
            /^\d+$/.test(values[0] ?? "") &&
            Boolean(values[1]) &&
            !/^\d+(?:[.,]\d+)?$/.test(values[1])
          )
          .slice(0, 80),
        total_rows: nonEmptyRows
          .filter(({ values }) =>
            values.some((value) => /\b(?:sub\s*total|grand total|contract total|total excl|total incl|vat)\b/i.test(value))
          )
          .slice(0, 80),
        useful_rows: nonEmptyRows
          .filter(({ values }) =>
            values.some((value) =>
              /\b(?:bill|summary|total|prelim|substructure|superstructure|plumbing|electrical|mechanical|joinery|hungry lion|project)\b/i.test(value)
            )
          )
          .slice(0, 40),
      };
    }),
  };
}

async function main() {
  const results = [];
  for (const filePath of process.argv.slice(2)) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".pdf") {
      results.push(await inspectPdf(filePath));
    } else if (extension === ".xlsx") {
      results.push(await inspectWorkbook(filePath));
    } else {
      results.push({ type: "unsupported", file: path.basename(filePath) });
    }
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
