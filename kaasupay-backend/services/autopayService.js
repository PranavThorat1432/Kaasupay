import { indiaDay } from "./dailyLimitService.js";

/**
 * Calculates the next run day for a given dayOfMonth (1-28) from a reference date in India Standard Time.
 * Non-negotiable rule: Never charge on the creation date.
 * If dayOfMonth <= currentDay, next occurrence is in the following month.
 * If dayOfMonth > currentDay, next occurrence is in the current month.
 *
 * @param {number} dayOfMonth - Integer between 1 and 28
 * @param {Date|string} [fromDate=new Date()] - Reference date (Date object or "YYYY-MM-DD" string)
 * @returns {string} Formatted date string "YYYY-MM-DD"
 */
export function calculateNextRunDay(dayOfMonth, fromDate = new Date()) {
  let todayStr;
  if (typeof fromDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    todayStr = fromDate;
  } else {
    todayStr = indiaDay(fromDate);
  }

  const [yearStr, monthStr, dayStr] = todayStr.split("-");
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10);
  const currentDay = parseInt(dayStr, 10);

  if (dayOfMonth <= currentDay) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(dayOfMonth).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Given a "YYYY-MM-DD" string, returns the identical day of the following month.
 * Automatically increments year on December rollover.
 *
 * @param {string} dateStr - Date string "YYYY-MM-DD"
 * @returns {string} Date string "YYYY-MM-DD"
 */
export function nextMonthDay(dateStr) {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  month += 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}
