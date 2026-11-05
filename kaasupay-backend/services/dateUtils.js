// services/dateUtils.js — India Standard Time (IST, UTC+5:30) date handling utilities

const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Validates whether a string matches YYYY-MM-DD and corresponds to a real calendar day.
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isValidDateStr(dateStr) {
  if (typeof dateStr !== "string" || !DATE_REGEX.test(dateStr)) {
    return false;
  }
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/**
 * Validates whether a string matches YYYY-MM.
 * @param {string} monthStr
 * @returns {boolean}
 */
export function isValidMonthStr(monthStr) {
  if (typeof monthStr !== "string" || !MONTH_REGEX.test(monthStr)) {
    return false;
  }
  const [year, month] = monthStr.split("-").map(Number);
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12;
}

/**
 * Converts a YYYY-MM-DD string to a Date object representing 00:00:00.000 IST.
 * IST is UTC+5:30.
 * @param {string} dateStr
 * @returns {Date}
 */
export function istMidnight(dateStr) {
  return new Date(`${dateStr}T00:00:00.000+05:30`);
}

/**
 * Given a YYYY-MM-DD string, returns a Date object representing 00:00:00.000 IST of the following day.
 * Used for exclusive upper-bound range queries.
 * @param {string} dateStr
 * @returns {Date}
 */
export function istNextDayMidnight(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const yyyy = nextDay.getUTCFullYear();
  const mm = String(nextDay.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(nextDay.getUTCDate()).padStart(2, "0");
  return istMidnight(`${yyyy}-${mm}-${dd}`);
}

/**
 * Parses optional 'from' and 'to' date parameters into MongoDB date filter criteria.
 * @param {string|undefined} from
 * @param {string|undefined} to
 * @returns {{ dateCondition: Object|null, error?: string }}
 */
export function parseIstDateRange(from, to) {
  if (from !== undefined && !isValidDateStr(from)) {
    return { error: "Invalid 'from' date format. Expected YYYY-MM-DD" };
  }
  if (to !== undefined && !isValidDateStr(to)) {
    return { error: "Invalid 'to' date format. Expected YYYY-MM-DD" };
  }

  if (from && to && from > to) {
    return { error: "from must not be after to" };
  }

  const condition = {};
  if (from) {
    condition.$gte = istMidnight(from);
  }
  if (to) {
    condition.$lt = istNextDayMidnight(to);
  }

  return {
    dateCondition: Object.keys(condition).length > 0 ? { createdAt: condition } : null,
  };
}

/**
 * Converts a YYYY-MM string to UTC start and end bounds for the given month in IST.
 * Start: 1st of month 00:00:00.000 IST
 * End: 1st of next month 00:00:00.000 IST
 * @param {string} monthStr
 * @returns {{ start: Date, end: Date }}
 */
export function parseIstMonthRange(monthStr) {
  if (!isValidMonthStr(monthStr)) {
    throw new Error("Invalid month format. Expected YYYY-MM");
  }

  const [year, month] = monthStr.split("-").map(Number);
  const start = istMidnight(`${year}-${String(month).padStart(2, "0")}-01`);

  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const end = istMidnight(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01`);

  return { start, end };
}

/**
 * Formats a Date object to "YYYY-MM-DD HH:mm" in India Standard Time (+5:30).
 * @param {Date|string} date
 * @returns {string}
 */
export function formatIstDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(d.getTime() + istOffsetMs);

  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(istDate.getUTCDate()).padStart(2, "0");
  const hours = String(istDate.getUTCHours()).padStart(2, "0");
  const minutes = String(istDate.getUTCMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

