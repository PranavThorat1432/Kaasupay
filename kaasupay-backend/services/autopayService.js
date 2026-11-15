import mongoose from "mongoose";
import Mandate from "../models/mandateModel.js";
import MandateRun from "../models/mandateRunModel.js";
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

/**
 * Returns difference in calendar days between two "YYYY-MM-DD" strings (toDayStr - fromDayStr).
 * Positive number means toDayStr is after fromDayStr (e.g. days late).
 *
 * @param {string} fromDayStr - "YYYY-MM-DD"
 * @param {string} toDayStr - "YYYY-MM-DD"
 * @returns {number} Integer count of days
 */
export function getDaysDiff(fromDayStr, toDayStr) {
  const [y1, m1, d1] = fromDayStr.split("-").map(Number);
  const [y2, m2, d2] = toDayStr.split("-").map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((utc2 - utc1) / MS_PER_DAY);
}

/**
 * Checks if a due date is within the 3-day grace window relative to today.
 * On-time (0 days late) or 1-3 days late are within the grace window.
 *
 * @param {string} dueDayStr - "YYYY-MM-DD"
 * @param {string} todayStr - "YYYY-MM-DD"
 * @returns {boolean}
 */
export function isWithinGraceWindow(dueDayStr, todayStr) {
  const daysLate = getDaysDiff(dueDayStr, todayStr);
  return daysLate >= 0 && daysLate <= 3;
}

/**
 * Checks if a due date is beyond the 3-day grace window (> 3 days late).
 *
 * @param {string} dueDayStr - "YYYY-MM-DD"
 * @param {string} todayStr - "YYYY-MM-DD"
 * @returns {boolean}
 */
export function isBeyondGraceWindow(dueDayStr, todayStr) {
  const daysLate = getDaysDiff(dueDayStr, todayStr);
  return daysLate > 3;
}

/**
 * Deterministically categorizes an AutoPay mandate's eligibility on a given India date.
 *
 * @param {object} mandate - Mandate document or object with { status, nextRunDay }
 * @param {string} todayStr - "YYYY-MM-DD"
 * @returns {{ eligible: boolean, status: string, daysLate?: number, reason?: string }}
 */
export function categorizeMandateDue(mandate, todayStr) {
  if (mandate.status !== "ACTIVE") {
    return { eligible: false, status: mandate.status, reason: `Mandate is ${mandate.status}` };
  }

  const daysLate = getDaysDiff(mandate.nextRunDay, todayStr);

  if (daysLate < 0) {
    return { eligible: false, status: "FUTURE_DUE", daysLate, reason: "Due date is in the future" };
  }

  if (daysLate > 3) {
    return { eligible: false, status: "MISSED", daysLate, reason: `Overdue by ${daysLate} days (> 3 days grace window)` };
  }

  return { eligible: true, status: "ELIGIBLE_FOR_PAYMENT", daysLate };
}

/**
 * Processes missed runs for an active mandate that has nextRunDay > 3 days before target todayStr.
 * Advances nextRunDay month-by-month and persists a MandateRun record with status "MISSED" for each missed month.
 * Concurrency-safe: claims the month atomically with findOneAndUpdate and unique index { mandateId, dueDay }.
 * Never performs wallet operations or touches user balances.
 *
 * @param {object} mandate - Mandate mongoose document or object with _id, status, nextRunDay, amount
 * @param {string} todayStr - Target date "YYYY-MM-DD"
 * @returns {Promise<{ missedCount: number, finalNextRunDay: string, eligibleForPayment: boolean }>}
 */
export async function processMissedMandateRuns(mandate, todayStr) {
  let currentNextRunDay = mandate.nextRunDay;
  let missedCount = 0;

  while (isBeyondGraceWindow(currentNextRunDay, todayStr)) {
    const session = await mongoose.startSession();
    let claimed = null;
    const dueDay = currentNextRunDay;
    const nextMonth = nextMonthDay(dueDay);
    const daysLate = getDaysDiff(dueDay, todayStr);

    try {
      await session.withTransaction(async () => {
        // Lock 1: Atomically claim this overdue month
        claimed = await Mandate.findOneAndUpdate(
          {
            _id: mandate._id,
            status: "ACTIVE",
            nextRunDay: dueDay,
          },
          {
            $set: { nextRunDay: nextMonth },
          },
          {
            returnDocument: "after",
            session,
          }
        );

        if (!claimed) {
          // Another concurrent worker claimed/advanced this month
          return;
        }

        // Lock 2: Persist MandateRun record (unique compound index { mandateId, dueDay })
        await MandateRun.create(
          [
            {
              mandateId: mandate._id,
              dueDay,
              status: "MISSED",
              amount: mandate.amount,
              reason: `Overdue by ${daysLate} days (> 3 days grace window)`,
              transactionId: null,
            },
          ],
          { session }
        );
      });
    } catch (err) {
      console.error(
        `[processMissedMandateRuns] Error processing missed run for mandate ${mandate._id} on ${dueDay}:`,
        err
      );
      break;
    } finally {
      await session.endSession();
    }

    if (!claimed) {
      // Stopped because of concurrency claim by another process
      break;
    }

    missedCount++;
    currentNextRunDay = nextMonth;
  }

  const eligibleForPayment = isWithinGraceWindow(currentNextRunDay, todayStr);

  return {
    missedCount,
    finalNextRunDay: currentNextRunDay,
    eligibleForPayment,
  };
}
