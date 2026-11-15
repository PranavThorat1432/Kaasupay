import mongoose from "mongoose";
import Mandate from "../models/mandateModel.js";
import MandateRun from "../models/mandateRunModel.js";
import SystemLease from "../models/systemLeaseModel.js";
import { transfer, MoneyError } from "./money.js";
import { indiaDay } from "./dailyLimitService.js";

/**
 * Emits sanitized structured JSON operational logs.
 * Never logs PINs, passwords, secrets, tokens, or wallet balances.
 *
 * @param {string} event - Event name
 * @param {object} [data={}] - Sanitized event metadata
 */
export function logOperationalEvent(event, data = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    event,
    ...data,
  };
  console.log(JSON.stringify(logEntry));
}

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

        logOperationalEvent("autopay_run_missed", {
          mandateId: mandate._id.toString(),
          dueDay,
          daysLate,
        });
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

/**
 * Records a failed payment run and advances the mandate's nextRunDay in an independent transaction.
 * Automatically pauses the mandate if consecutive failures reach 3.
 *
 * @param {object} mandate - Mandate mongoose document or object
 * @param {string} dueDay - "YYYY-MM-DD"
 * @param {string} reason - Business failure reason (e.g. "Insufficient balance")
 * @returns {Promise<{ claimed: boolean, paused: boolean, failedCount: number }|null>}
 */
export async function recordFailedMandatePayment(mandate, dueDay, reason) {
  const failSession = await mongoose.startSession();
  let result = null;

  try {
    await failSession.withTransaction(async () => {
      // 1. Atomically claim this due period for failure
      const claimed = await Mandate.findOneAndUpdate(
        { _id: mandate._id, status: "ACTIVE", nextRunDay: dueDay },
        {
          $set: { nextRunDay: nextMonthDay(dueDay) },
          $inc: { failedCount: 1 },
        },
        { returnDocument: "after", session: failSession }
      );

      if (!claimed) {
        // Another concurrent worker claimed or handled this mandate
        return;
      }

      // 2. Automatically change status to PAUSED when third consecutive failure occurs
      if (claimed.failedCount >= 3) {
        await Mandate.updateOne(
          { _id: mandate._id },
          { $set: { status: "PAUSED" } },
          { session: failSession }
        );
        logOperationalEvent("autopay_auto_paused", {
          mandateId: mandate._id.toString(),
          payerId: mandate.payerId.toString(),
          dueDay,
          failedCount: claimed.failedCount,
        });
      }

      // 3. Create one FAILED MandateRun record
      await MandateRun.create(
        [
          {
            mandateId: mandate._id,
            dueDay,
            status: "FAILED",
            amount: mandate.amount,
            reason: reason || "Payment failed",
            transactionId: null,
          },
        ],
        { session: failSession }
      );

      result = {
        claimed: true,
        paused: claimed.failedCount >= 3,
        failedCount: claimed.failedCount,
      };
    });
  } catch (err) {
    console.error(`[recordFailedMandatePayment] Error recording failure for mandate ${mandate._id}:`, err);
  } finally {
    await failSession.endSession();
  }

  return result;
}

/**
 * Processes a single due mandate payment with exactly-once transactional semantics.
 *
 * All operations execute inside a single MongoDB transaction:
 * 1. Lock 1: Atomically claim mandate by matching { _id, status: "ACTIVE", nextRunDay: dueDay }
 *    and advancing nextRunDay to next month, resetting failedCount to 0.
 * 2. Transfer: Call shared transfer() with external session (debit payer, credit payee,
 *    create transaction record with note "AutoPay", create ledger entries, check daily limits,
 *    evaluate promo cards).
 * 3. Lock 2: Persist MandateRun record with status "SUCCESS" and transactionId.
 *
 * If a business failure occurs (insufficient balance, daily limit, wallet missing):
 * The transaction aborts completely, and recordFailedMandatePayment() is invoked
 * in a separate transaction to record the failure, advance nextRunDay, and auto-pause if needed.
 *
 * @param {object} mandate - Mandate mongoose document or object
 * @param {string} dueDay - "YYYY-MM-DD"
 * @returns {Promise<{ outcome: "SUCCESS"|"FAILED"|"SKIPPED"|"ERROR", transaction?: object, run?: object, reason?: string, paused?: boolean, error?: string, category?: string }>}
 */
export async function processDueMandatePayment(mandate, dueDay) {
  const startTime = Date.now();
  const session = await mongoose.startSession();
  let paymentResult = null;
  let businessError = null;

  try {
    await session.withTransaction(async () => {
      // 1. Lock 1: Atomically claim mandate & advance nextRunDay to next month, reset failedCount: 0
      const claimed = await Mandate.findOneAndUpdate(
        { _id: mandate._id, status: "ACTIVE", nextRunDay: dueDay },
        {
          $set: {
            nextRunDay: nextMonthDay(dueDay),
            failedCount: 0,
          },
        },
        { returnDocument: "after", session }
      );

      if (!claimed) {
        // Another concurrent worker claimed this month, or mandate was paused/cancelled
        paymentResult = { outcome: "SKIPPED" };
        return;
      }

      // 2. Financial transfer: call existing transfer() with caller session
      const transferRes = await transfer({
        fromUserId: mandate.payerId,
        toUserId: mandate.payeeId,
        amount: mandate.amount,
        note: "AutoPay",
        session,
      });

      // 3. Lock 2: Persist MandateRun record
      const [runDoc] = await MandateRun.create(
        [
          {
            mandateId: mandate._id,
            dueDay,
            status: "SUCCESS",
            amount: mandate.amount,
            transactionId: transferRes.transaction._id,
            reason: null,
          },
        ],
        { session }
      );

      paymentResult = {
        outcome: "SUCCESS",
        mandate: claimed,
        transaction: transferRes.transaction,
        run: runDoc,
      };
    });
  } catch (err) {
    // 1. Transaction Outcome Safety: Handle ambiguous commit outcomes
    // (e.g. UnknownTransactionCommitResult or network disconnect during commit acknowledgment)
    const isCommitAmbiguous =
      (typeof err.hasErrorLabel === "function" && err.hasErrorLabel("UnknownTransactionCommitResult")) ||
      err.message?.includes("UnknownTransactionCommitResult") ||
      err.name === "MongoNetworkTimeoutError" ||
      err.name === "MongoNetworkError";

    if (isCommitAmbiguous) {
      try {
        const existingRun = await MandateRun.findOne({ mandateId: mandate._id, dueDay });
        if (existingRun && existingRun.status === "SUCCESS") {
          logOperationalEvent("autopay_payment_success", {
            mandateId: mandate._id.toString(),
            dueDay,
            transactionId: existingRun.transactionId ? existingRun.transactionId.toString() : null,
            recoveredFromCommitError: true,
            durationMs: Date.now() - startTime,
          });
          return {
            outcome: "SUCCESS",
            run: existingRun,
            recovered: true,
          };
        }
      } catch {
        // Ignore lookup error and fall through to classification
      }
    }

    // 2. Distinguish business failures from transient infrastructure errors
    const isBusiness =
      err instanceof MoneyError ||
      err.name === "MoneyError" ||
      err.statusCode === 400 ||
      err.statusCode === 404 ||
      err.message === "Insufficient balance" ||
      err.message === "Daily limit reached" ||
      err.message === "Receiver wallet not found" ||
      err.message === "Sender wallet not found";

    if (isBusiness) {
      businessError = err;
    } else {
      logOperationalEvent("autopay_payment_error", {
        mandateId: mandate._id.toString(),
        dueDay,
        error: err.message || "Unknown infrastructure error",
        category: "TRANSIENT_INFRASTRUCTURE",
        durationMs: Date.now() - startTime,
      });
      return {
        outcome: "ERROR",
        error: err.message,
        category: "TRANSIENT_INFRASTRUCTURE",
      };
    }
  } finally {
    await session.endSession();
  }

  if (paymentResult) {
    if (paymentResult.outcome === "SUCCESS") {
      logOperationalEvent("autopay_payment_success", {
        mandateId: mandate._id.toString(),
        dueDay,
        transactionId: paymentResult.transaction?._id?.toString() || null,
        durationMs: Date.now() - startTime,
      });
    } else if (paymentResult.outcome === "SKIPPED") {
      logOperationalEvent("autopay_payment_skipped", {
        mandateId: mandate._id.toString(),
        dueDay,
        reason: "Concurrent claim or mandate no longer ACTIVE",
      });
    }
    return paymentResult;
  }

  if (businessError) {
    // Execute failure recording in separate transaction
    const failOutcome = await recordFailedMandatePayment(mandate, dueDay, businessError.message);
    logOperationalEvent("autopay_payment_failure", {
      mandateId: mandate._id.toString(),
      dueDay,
      reason: businessError.message,
      failedCount: failOutcome?.failedCount ?? (mandate.failedCount + 1),
      durationMs: Date.now() - startTime,
    });
    return {
      outcome: "FAILED",
      reason: businessError.message,
      paused: failOutcome?.paused || false,
    };
  }

  logOperationalEvent("autopay_payment_skipped", {
    mandateId: mandate._id.toString(),
    dueDay,
    reason: "Mandate was not processed",
  });
  return { outcome: "SKIPPED" };
}

// ============================================================================
// Phase 6.8: Distributed Lease & Shared Batch Processor Infrastructure
// ============================================================================

export const DEFAULT_AUTOPAY_LEASE_ID = "autopay_processor";

/**
 * Ensures the singleton lease document exists in the collection.
 * Uses unconditional _id matching so upsert will NEVER collide with duplicate key errors.
 *
 * @param {string} [leaseId=DEFAULT_AUTOPAY_LEASE_ID]
 * @returns {Promise<void>}
 */
export async function ensureLeaseInitialized(leaseId = DEFAULT_AUTOPAY_LEASE_ID) {
  try {
    await SystemLease.updateOne(
      { _id: leaseId },
      {
        $setOnInsert: {
          ownerId: null,
          fencingToken: 0,
          expiresAt: new Date(0), // Initialized as expired
          acquiredAt: new Date(0),
          lastHeartbeat: new Date(0),
        },
      },
      { upsert: true }
    );
  } catch (err) {
    // If two workers initialize concurrently, one inserts, the other encounters E11000 and ignores it
    if (err.code !== 11000) throw err;
  }
}

/**
 * Atomically acquires or renews the AutoPay advisory lease.
 *
 * Guaranteed Properties:
 * 1. Safe renewal: Current owner extends expiry without changing fencingToken.
 * 2. Safe takeover: Expired lease or unowned lease increments fencingToken atomically.
 * 3. Race-safe: Never overwrites an active lease owned by another active worker.
 * 4. Deterministic return status: ACQUIRED, RENEWED, HELD_BY_OTHER, or ERROR.
 *
 * @param {object} params
 * @param {string} params.ownerId - Unique identifier (e.g. "worker:hostname:pid:uuid")
 * @param {string} [params.leaseId=DEFAULT_AUTOPAY_LEASE_ID] - Lease ID
 * @param {number} [params.leaseDurationMs=60000] - Lease validity duration in ms
 * @param {object} [params.metadata={}] - Optional metadata (hostname, pid, etc.)
 * @returns {Promise<{ status: "ACQUIRED"|"RENEWED"|"HELD_BY_OTHER"|"ERROR", lease?: object, error?: string }>}
 */
export async function acquireOrRenewLease({
  ownerId,
  leaseId = DEFAULT_AUTOPAY_LEASE_ID,
  leaseDurationMs = 60000,
  metadata = {},
} = {}) {
  if (!ownerId) {
    throw new Error("acquireOrRenewLease requires a valid ownerId");
  }

  try {
    await ensureLeaseInitialized(leaseId);
    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + leaseDurationMs);

    // Step 1: Attempt Safe Renewal (Owner already holds a non-expired lease)
    // Fencing token is NOT incremented on renewals (preserves monotonicity per tenure)
    const renewed = await SystemLease.findOneAndUpdate(
      {
        _id: leaseId,
        ownerId: ownerId,
        expiresAt: { $gte: now },
      },
      {
        $set: {
          expiresAt: newExpiresAt,
          lastHeartbeat: now,
          metadata,
        },
      },
      { returnDocument: "after" }
    );

    if (renewed) {
      return { status: "RENEWED", lease: renewed.toObject ? renewed.toObject() : renewed };
    }

    // Step 2: Attempt Safe Acquisition / Takeover (Lease is unowned or expired)
    // Fencing token is monotonically incremented on ownership changes
    const acquired = await SystemLease.findOneAndUpdate(
      {
        _id: leaseId,
        $or: [
          { expiresAt: { $lt: now } },
          { ownerId: null },
        ],
      },
      {
        $set: {
          ownerId: ownerId,
          expiresAt: newExpiresAt,
          acquiredAt: now,
          lastHeartbeat: now,
          metadata,
        },
        $inc: { fencingToken: 1 },
      },
      { returnDocument: "after" }
    );

    if (acquired) {
      return { status: "ACQUIRED", lease: acquired.toObject ? acquired.toObject() : acquired };
    }

    // Step 3: Held by another active owner
    const activeLease = await SystemLease.findById(leaseId).lean();
    return {
      status: "HELD_BY_OTHER",
      lease: activeLease,
    };
  } catch (err) {
    return {
      status: "ERROR",
      error: err.message,
    };
  }
}

/**
 * Releases the lease if held by the caller with the matching ownerId and optional fencingToken.
 *
 * @param {object} params
 * @param {string} params.ownerId - Owner identifier
 * @param {string} [params.leaseId=DEFAULT_AUTOPAY_LEASE_ID] - Lease ID
 * @param {number} [params.fencingToken] - Optional fencing token for strict release
 * @returns {Promise<boolean>} True if released, false if unheld or owned by another
 */
export async function releaseLease({
  ownerId,
  leaseId = DEFAULT_AUTOPAY_LEASE_ID,
  fencingToken = null,
} = {}) {
  if (!ownerId) return false;

  const query = { _id: leaseId, ownerId };
  if (typeof fencingToken === "number") {
    query.fencingToken = fencingToken;
  }

  const released = await SystemLease.findOneAndUpdate(
    query,
    {
      $set: {
        ownerId: null,
        expiresAt: new Date(0),
        lastHeartbeat: new Date(),
      },
    },
    { returnDocument: "after" }
  );

  return Boolean(released);
}

/**
 * Validates that the specified ownerId (and optional fencingToken) currently holds a valid,
 * non-expired lease. Used before initiating every new mandate batch.
 *
 * @param {object} params
 * @param {string} params.ownerId
 * @param {string} [params.leaseId=DEFAULT_AUTOPAY_LEASE_ID]
 * @param {number} [params.fencingToken]
 * @returns {Promise<boolean>}
 */
export async function validateLeaseOwnership({
  ownerId,
  leaseId = DEFAULT_AUTOPAY_LEASE_ID,
  fencingToken = null,
} = {}) {
  if (!ownerId) return false;
  const now = new Date();

  const query = {
    _id: leaseId,
    ownerId,
    expiresAt: { $gte: now },
  };

  if (typeof fencingToken === "number") {
    query.fencingToken = fencingToken;
  }

  const doc = await SystemLease.findOne(query).lean();
  return Boolean(doc);
}

/**
 * Executes a single bounded batch of due AutoPay mandates.
 * Shared by both the dedicated worker (worker.js) and the Vercel Cron HTTP fallback.
 *
 * Preserves exact Day 10 Phase 3-5 financial and grace-period invariants:
 * - Queries active mandates due on or before target date, oldest first.
 * - Handles multi-month overdue mandates via processMissedMandateRuns().
 * - Processes due mandates within grace window via processDueMandatePayment().
 * - Returns detailed batch execution statistics and whether additional candidates exist.
 *
 * @param {object} [options]
 * @param {string} [options.today=indiaDay()] - Reference date (IST "YYYY-MM-DD")
 * @param {number} [options.limit=50] - Maximum mandates to process in this single batch
 * @returns {Promise<{ date: string, candidatesCount: number, due: number, succeeded: number, failed: number, missed: number, errors: number, skipped: number, processed: number, more: boolean }>}
 */
export async function runAutopayBatch({ today = indiaDay(), limit = 50 } = {}) {
  // Query limit + 1 items to reliably detect if more eligible mandates exist
  const rawBatch = await Mandate.find({
    status: "ACTIVE",
    nextRunDay: { $lte: today },
  })
    .sort({ nextRunDay: 1, createdAt: 1, _id: 1 })
    .limit(limit + 1);

  const more = rawBatch.length > limit;
  const candidates = rawBatch.slice(0, limit);

  let totalDue = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  let totalMissed = 0;
  let totalErrors = 0;
  let totalSkipped = 0;

  for (const m of candidates) {
    let targetPaymentDueDay = null;

    if (isBeyondGraceWindow(m.nextRunDay, today)) {
      const { missedCount, finalNextRunDay, eligibleForPayment } = await processMissedMandateRuns(m, today);
      totalMissed += missedCount;
      if (eligibleForPayment) {
        totalDue++;
        targetPaymentDueDay = finalNextRunDay;
      }
    } else if (isWithinGraceWindow(m.nextRunDay, today)) {
      totalDue++;
      targetPaymentDueDay = m.nextRunDay;
    }

    if (targetPaymentDueDay) {
      const paymentResult = await processDueMandatePayment(m, targetPaymentDueDay);
      if (paymentResult.outcome === "SUCCESS") {
        totalSucceeded++;
      } else if (paymentResult.outcome === "FAILED") {
        totalFailed++;
      } else if (paymentResult.outcome === "ERROR") {
        totalErrors++;
      } else if (paymentResult.outcome === "SKIPPED") {
        totalSkipped++;
      }
    }
  }

  return {
    date: today,
    candidatesCount: candidates.length,
    due: totalDue,
    succeeded: totalSucceeded,
    failed: totalFailed,
    missed: totalMissed,
    errors: totalErrors,
    skipped: totalSkipped,
    processed: candidates.length,
    more,
  };
}
