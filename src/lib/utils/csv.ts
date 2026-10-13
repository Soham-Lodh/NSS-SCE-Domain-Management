/**
 * RFC 4180-style CSV serialization for report copy-to-clipboard.
 *
 * - Quotes/escapes commas, double quotes, CR/LF.
 * - Neutralizes spreadsheet formula injection: a cell whose first
 *   non-whitespace character is = + - @ TAB or CR is prefixed with a single
 *   quote so Sheets/Excel treat it as text. Normal values are untouched.
 */

const DANGEROUS_FIRST_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (s.length > 0 && DANGEROUS_FIRST_CHARS.has(s[0])) {
    s = `'${s}`;
  }
  return s;
}

function escapeCell(value: unknown): string {
  const sanitized = sanitizeCsvCell(value);
  if (/[",\r\n]/.test(sanitized)) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [
    headers.map(escapeCell).join(","),
    ...rows.map((row) => row.map(escapeCell).join(",")),
  ];
  // \r\n per RFC 4180.
  return lines.join("\r\n") + "\r\n";
}
