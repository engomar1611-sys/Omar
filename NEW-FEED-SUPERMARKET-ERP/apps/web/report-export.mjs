const formulaPrefix = /^[\\s\\u0000-\\u001f]*[=+@-]/;
function normalize(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function csvCell(value) {
  let text = normalize(value);
  if (typeof value === "string" && formulaPrefix.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""').replace(/\\r?\\n/g, " ") + '"';
}
export function toCsv(rows, columns) {
  if (!Array.isArray(rows) || !Array.isArray(columns)) throw new TypeError("Invalid report data");
  const header = columns.map((column) => csvCell(column[1])).join(",");
  const body = rows.map((row) => columns.map((column) => csvCell(row?.[column[0]])).join(","));
  return [header, ...body].join("\\r\\n");
}
if (typeof window !== "undefined") window.NewFeedReportExport = { toCsv };
