import crypto from "node:crypto";
import Mandate from "../models/mandateModel.js";
import { indiaDay } from "../services/dailyLimitService.js";
import { isValidDateStr } from "../services/dateUtils.js";
import {
  isWithinGraceWindow,
  isBeyondGraceWindow,
  processMissedMandateRuns,
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

    // 3. Batch query due ACTIVE mandates from MongoDB (oldest due date first)
    // Fetch up to 51 items to detect if more eligible mandates exist without unbounded memory load
    const rawBatch = await Mandate.find({
      status: "ACTIVE",
      nextRunDay: { $lte: today },
    })
      .sort({ nextRunDay: 1, createdAt: 1, _id: 1 })
      .limit(51);

    const more = rawBatch.length > 50;
    const candidates = rawBatch.slice(0, 50);

    // 4. Mandate Processing & Eligibility:
    // - If beyond 3-day grace window (> 3 days late): persist MISSED MandateRun, advance nextRunDay month-by-month.
    //   If its caught-up nextRunDay lands inside the grace window for today, it becomes eligible for payment.
    // - If on-time or 1-3 days late (within grace window): eligible for payment ('due').
    // - Phase 2 Processing Boundary: Zero wallet transfers, debits, or credits. Level 3 performs payments.
    let totalDue = 0;
    let totalMissed = 0;

    for (const m of candidates) {
      if (isBeyondGraceWindow(m.nextRunDay, today)) {
        const { missedCount, eligibleForPayment } = await processMissedMandateRuns(m, today);
        totalMissed += missedCount;
        if (eligibleForPayment) {
          totalDue++;
        }
      } else if (isWithinGraceWindow(m.nextRunDay, today)) {
        totalDue++;
      }
    }

    return res.status(200).json({
      date: today,
      due: totalDue,
      succeeded: 0,
      failed: 0,
      missed: totalMissed,
      more,
    });
  } catch (err) {
    console.error("[handleAutopayCron Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
