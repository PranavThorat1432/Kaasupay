import crypto from "node:crypto";
import { indiaDay } from "../services/dailyLimitService.js";
import { isValidDateStr } from "../services/dateUtils.js";
import {
  runAutopayBatch,
  acquireOrRenewLease,
  releaseLease,
  logOperationalEvent,
} from "../services/autopayService.js";

/**
 * Validates the Authorization header against CRON_SECRET using length-safe timingSafeEqual.
 * Never leaks secret or timing signals.
 *
 * @param {string|undefined} authHeader
 * @returns {boolean}
 */
export function verifyCronSecret(authHeader) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || typeof cronSecret !== "string" || cronSecret.trim().length === 0) {
    return false;
  }
  if (!authHeader || typeof authHeader !== "string") {
    return false;
  }
  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) {
    return false;
  }
  const token = authHeader.slice(prefix.length).trim();

  const expectedBuf = Buffer.from(cronSecret);
  const actualBuf = Buffer.from(token);

  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * GET /api/v1/cron/autopay
 * Scheduled cron endpoint to identify and select due AutoPay mandates.
 * Phase 2 implementation: Authenticates scheduler, validates time-travel,
 * queries due active mandates oldest-first (batch max 50), applies grace-window filtering,
 * and returns summary. No financial transfers are performed.
 */
export async function handleAutopayCron(req, res) {
  try {
    // 1. Authenticate with CRON_SECRET
    if (!verifyCronSecret(req.headers.authorization)) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // 2. Determine execution date (India Standard Time) and handle controlled time-travel
    let today = indiaDay();

    if (req.query.date) {
      if (process.env.ALLOW_TIME_TRAVEL !== "true") {
        return res.status(400).json({ message: "Time travel is off" });
      }

      if (typeof req.query.date !== "string" || !isValidDateStr(req.query.date)) {
        return res.status(400).json({ message: "Invalid date format. Expected YYYY-MM-DD" });
      }

      today = req.query.date;
    }

    const cronStartTime = Date.now();
    logOperationalEvent("cron_started", {
      date: today,
    });

    // 3. Fallback Coordination via Advisory Lease
    // In normal scheduled operation (no date override): Check if dedicated worker holds active lease.
    // If so, cron skips quietly. If req.query.date is provided during time-travel testing,
    // cron processes for that specific test date directly.
    let cronOwnerId = null;

    if (!req.query.date) {
      cronOwnerId = `cron:${crypto.randomUUID().slice(0, 8)}`;
      const leaseResult = await acquireOrRenewLease({
        ownerId: cronOwnerId,
        leaseDurationMs: 30000, // Short fallback lease
        metadata: { trigger: "vercel_cron", date: today },
      });

      if (leaseResult.status === "HELD_BY_OTHER") {
        logOperationalEvent("cron_skipped_worker_active", {
          date: today,
          activeWorker: leaseResult.lease?.ownerId,
        });
        return res.status(200).json({
          status: "SKIPPED",
          reason: "Worker active",
          leaseHolder: leaseResult.lease?.ownerId,
          date: today,
          due: 0,
          succeeded: 0,
          failed: 0,
          missed: 0,
          errors: 0,
          skipped: 0,
          more: false,
        });
      }
    }

    // 4. Bounded In-Process Execution Budget
    // Default budget is 8000ms (assumes conservative 10s serverless limit with 2000ms margin)
    const EXECUTION_BUDGET_MS = parseInt(process.env.CRON_EXECUTION_BUDGET_MS || "8000", 10);
    let totalDue = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    let totalMissed = 0;
    let totalErrors = 0;
    let totalSkipped = 0;
    let batchesExecuted = 0;
    let lastBatchDurationMs = 0;
    let hasMore = true;

    try {
      while (hasMore) {
        const elapsed = Date.now() - cronStartTime;
        const estimatedNextBatchMs = batchesExecuted === 0 ? 2500 : Math.max(lastBatchDurationMs * 1.2, 1000);

        if (elapsed + estimatedNextBatchMs >= EXECUTION_BUDGET_MS) {
          break;
        }

        const batchStart = Date.now();
        const batchResult = await runAutopayBatch({ today, limit: 50 });
        lastBatchDurationMs = Date.now() - batchStart;

        batchesExecuted++;
        totalDue += batchResult.due;
        totalSucceeded += batchResult.succeeded;
        totalFailed += batchResult.failed;
        totalMissed += batchResult.missed;
        totalErrors += batchResult.errors;
        totalSkipped += batchResult.skipped;
        hasMore = batchResult.more;
      }
    } finally {
      // Always safely release fallback lease if acquired
      if (cronOwnerId) {
        await releaseLease({ ownerId: cronOwnerId });
      }
    }

    logOperationalEvent("cron_completed", {
      date: today,
      due: totalDue,
      succeeded: totalSucceeded,
      failed: totalFailed,
      missed: totalMissed,
      errors: totalErrors,
      skipped: totalSkipped,
      batchesExecuted,
      more: hasMore,
      durationMs: Date.now() - cronStartTime,
    });

    return res.status(200).json({
      date: today,
      due: totalDue,
      succeeded: totalSucceeded,
      failed: totalFailed,
      missed: totalMissed,
      errors: totalErrors,
      skipped: totalSkipped,
      batchesExecuted,
      more: hasMore,
    });
  } catch (err) {
    console.error("[handleAutopayCron Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
