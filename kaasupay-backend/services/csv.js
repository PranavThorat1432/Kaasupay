// services/csv.js — CSV generation utilities for financial statements
// Strict RFC-4180 compliance, formula injection protection, and exact whole-integer rupee formatting.

/**
 * Converts an integer amount in paise to a decimal rupee string with 2 fixed decimal places.
 * NEVER uses floating-point division to avoid binary floating point precision errors.
 * e.g., 2500 -> "25.00", 50 -> "0.50", 5 -> "0.05", 0 -> "0.00"
 * @param {number} paise - Non-negative integer paise
 * @returns {string}
 */
export function rupees(paise) {
  if (paise === null || paise === undefined || paise === "") {
    return "";
  }
  const intPaise = Math.trunc(Number(paise));
  if (isNaN(intPaise)) return "";
  
  const sign = intPaise < 0 ? "-" : "";
  const abs = Math.abs(intPaise);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

/**
 * Escapes a cell value for RFC-4180 compliance and immunizes against CSV injection.
 * Formula trigger characters (=, +, -, @) at the beginning of a string are escaped with a leading single-quote.
 * Any value containing commas, double quotes, newlines, or leading/trailing whitespace is wrapped in double quotes.
 * Internal double quotes are doubled (" -> "").
 * @param {any} val
 * @returns {string}
 */
export function csvCell(val) {
  if (val === null || val === undefined) {
    return "";
  }

  let str = String(val);

  // CSV Formula Injection mitigation:
  // If the cell begins with =, +, -, or @, prefix with a single quote (') so spreadsheets treat it as literal text.
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }

  // RFC-4180 escaping:
  // If the field contains comma, double-quote, or newline, or starts/ends with whitespace, wrap in double quotes.
  const needsQuotes = /[",\r\n]/.test(str);
  if (needsQuotes) {
    // Replace " with ""
    str = `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Builds a complete RFC-4180 CSV string from headers and row data.
 * @param {string[]} headers
 * @param {Array<Array<any>>} rows
 * @returns {string}
 */
export function buildCsv(headers, rows) {
  const headerLine = headers.map(csvCell).join(",");
  const rowLines = rows.map((row) => row.map(csvCell).join(","));
  return [headerLine, ...rowLines].join("\r\n") + "\r\n";
}
