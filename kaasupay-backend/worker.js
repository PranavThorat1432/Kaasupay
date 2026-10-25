// worker.js — Outbox payout worker for processing bank payouts
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "./db.js";
import { BANK_URL } from "./config.js";
import Withdrawal from "./models/withdrawalModel.js";
import OutboxEvent from "./models/outboxEventModel.js";
import BankAccount from "./models/bankAccountModel.js";
import { reverseWithdrawal } from "./services/money.js";
import { decryptAccountNumber } from "./services/encryption.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Claims the next due outbox job atomically.
 * Finds either:
 *  - A NEW job whose nextAttemptAt <= now
 *  - A PROCESSING job whose lockedAt is older than staleTimeoutMs (worker crashed / died)
 *
 * @param {Object} options
 * @param {Date} [options.now]
 * @param {number} [options.staleTimeoutMs]
 * @returns {Promise<Object|null>}
 */
export async function claimNextJob({ now = new Date(), staleTimeoutMs = 60000 } = {}) {
  const staleThreshold = new Date(now.getTime() - staleTimeoutMs);

  return await OutboxEvent.findOneAndUpdate(
    {
      $or: [
        { status: "NEW", nextAttemptAt: { $lte: now } },
        { status: "PROCESSING", lockedAt: { $lte: staleThreshold } },
      ],
    },
    {
      $set: { status: "PROCESSING", lockedAt: now },
      $inc: { attempts: 1 },
    },
    {
      returnDocument: "after",
      sort: { nextAttemptAt: 1 },
    }
  );
}

/**
 * Processes a single claimed outbox job through the bank payout lifecycle.
 *
 * @param {Object} job - OutboxEvent document
 * @param {Object} [options]
 * @param {string} [options.bankUrl]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.backoffBaseMs]
 * @returns {Promise<{ status: string, detail?: string }>}
 */
export async function processJob(
  job,
  {
    bankUrl = BANK_URL,
    timeoutMs = 3000,
    backoffBaseMs = 1000,
  } = {}
) {
  if (!job) return { status: "NO_JOB" };

  try {
    const withdrawal = await Withdrawal.findById(job.withdrawalId).populate(
      "bankAccountId"
    );

    if (!withdrawal) {
      console.warn(`[worker] Withdrawal ${job.withdrawalId} not found. Marking job DONE.`);
      await OutboxEvent.updateOne({ _id: job._id }, { $set: { status: "DONE" } });
      return { status: "DONE", detail: "Withdrawal not found" };
    }

    // Terminal states check
    if (withdrawal.status === "SUCCESS" || withdrawal.status === "REVERSED") {
      await OutboxEvent.updateOne({ _id: job._id }, { $set: { status: "DONE" } });
      return { status: "DONE", detail: "Already terminal" };
    }

    // Transition PENDING -> PROCESSING on first attempt
    if (withdrawal.status === "PENDING") {
      await Withdrawal.updateOne(
        { _id: withdrawal._id, status: "PENDING" },
        { $set: { status: "PROCESSING" } }
      );
    }

    if (!withdrawal.bankAccountId) {
      console.error(`[worker] Bank account missing for withdrawal ${withdrawal._id}`);
      await reverseWithdrawal({
        withdrawalId: withdrawal._id,
        reason: "Bank account details missing",
      });
      await OutboxEvent.updateOne({ _id: job._id }, { $set: { status: "DONE" } });
      return { status: "REVERSED", detail: "Missing bank account" };
    }

    // Decrypt the account number before calling the bank (Bonus 7)
    const rawAccountNumber = decryptAccountNumber(
      withdrawal.bankAccountId.accountNumber
    );

    // Call fake bank API with timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response = null;
    let resData = null;
    let errorName = null;
    let errorMessage = null;

    try {
      response = await fetch(`${bankUrl}/payouts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: withdrawal.reference,
          accountNumber: rawAccountNumber,
          ifsc: withdrawal.bankAccountId.ifsc,
          amount: withdrawal.amount,
        }),
        signal: controller.signal,
      });

      resData = await response.json().catch(() => ({}));
    } catch (err) {
      errorName = err.name;
      errorMessage = err.message;
    } finally {
      clearTimeout(timer);
    }

    // 1. CONFIRMED BANK SUCCESS (HTTP 200 with SUCCESS)
    if (response && response.status === 200 && resData?.status === "SUCCESS") {
      const bankRef = resData.bankRef || `UTR${Date.now()}`;
      await Withdrawal.updateOne(
        { _id: withdrawal._id },
        { $set: { status: "SUCCESS", bankRef } }
      );
      await OutboxEvent.updateOne({ _id: job._id }, { $set: { status: "DONE" } });
      console.log(`[worker] attempt ${job.attempts}, then SUCCESS ${bankRef}`);
      return { status: "SUCCESS", bankRef };
    }

    // 2. DEFINITIVE REFUSAL (HTTP 200 with FAILED, e.g. closed account)
    if (response && response.status === 200 && resData?.status === "FAILED") {
      const reason = resData.reason || "Account closed";
      await reverseWithdrawal({ withdrawalId: withdrawal._id, reason });
      await OutboxEvent.updateOne({ _id: job._id }, { $set: { status: "DONE" } });
      console.log(
        `[worker] attempt ${job.attempts}, then FAILED (${reason}), money returned`
      );
      return { status: "REVERSED", reason };
    }

    // 3. MALFORMED REQUEST (HTTP 400)
    if (response && response.status === 400) {
      const reason = resData?.error || "Bad request";
      await reverseWithdrawal({ withdrawalId: withdrawal._id, reason });
      await OutboxEvent.updateOne({ _id: job._id }, { $set: { status: "DONE" } });
      console.log(
        `[worker] attempt ${job.attempts}, then 400 (${reason}), money refunded`
      );
      return { status: "REVERSED", reason };
    }

    // 4. AMBIGUOUS / TEMPORARY FAILURE (202 PROCESSING, 5xx, timeout, network error)
    let errDesc = "Unknown error";
    if (errorName === "AbortError") {
      errDesc = "Bank timed out";
    } else if (response && response.status === 202) {
      errDesc = "Bank is still processing";
    } else if (response) {
      errDesc = `Bank said ${response.status}`;
    } else if (errorMessage) {
      errDesc = `Could not reach bank: ${errorMessage}`;
    }

    // Check maximum attempts threshold (5 tries)
    if (job.attempts < 5) {
      // Exponential backoff: 2s, 4s, 8s, 16s + jitter
      const waitMs =
        backoffBaseMs * 2 ** job.attempts + Math.floor(Math.random() * 500);
      const nextAttemptAt = new Date(Date.now() + waitMs);

      await OutboxEvent.updateOne(
        { _id: job._id },
        {
          $set: {
            status: "NEW",
            nextAttemptAt,
            lastError: errDesc,
          },
        }
      );

      console.log(
        `[worker] attempt ${job.attempts} -> ${errDesc}, retry in ${Math.round(
          waitMs / 1000
        )} s`
      );
      return { status: "RETRY", detail: errDesc, nextAttemptAt };
    }

    // 5 attempts exhausted -> mark NEEDS_REVIEW, outbox STUCK, NO automatic refund
    await Withdrawal.updateOne(
      { _id: withdrawal._id, status: { $in: ["PENDING", "PROCESSING"] } },
      { $set: { status: "NEEDS_REVIEW", failureReason: errDesc } }
    );
    await OutboxEvent.updateOne(
      { _id: job._id },
      { $set: { status: "STUCK", lastError: errDesc } }
    );

    console.log(
      `[worker] attempt ${job.attempts} -> NEEDS_REVIEW after 5 attempts`
    );
    return { status: "NEEDS_REVIEW", detail: errDesc };
  } catch (err) {
    console.error(`[worker] Unexpected error handling job ${job._id}:`, err);
    return { status: "ERROR", error: err.message };
  }
}

/**
 * PayoutWorker class providing start/stop lifecycle management.
 */
export class PayoutWorker {
  constructor(options = {}) {
    this.options = options;
    this.running = false;
    this.loopPromise = null;
    this.lastPollAt = null;
    this.pollCount = 0;
    this.startedAt = null;
    this.lastError = null;
  }

  async start() {
    this.running = true;
    this.startedAt = new Date();
    console.log("[worker] Payout worker started.");

    while (this.running) {
      try {
        this.lastPollAt = new Date();
        this.pollCount++;
        const job = await claimNextJob(this.options);
        if (!job) {
          await sleep(1000);
          continue;
        }

        await processJob(job, this.options);
      } catch (err) {
        this.lastError = err.message;
        console.error("[worker] Loop error:", err.message);
        await sleep(1000);
      }
    }
  }

  stop() {
    this.running = false;
    console.log("[worker] Payout worker stopped.");
  }

  getStatus() {
    const now = Date.now();
    const isAlive = Boolean(
      this.running &&
      this.lastPollAt &&
      (now - this.lastPollAt.getTime()) < 30000
    );

    return {
      running: this.running,
      loopAlive: isAlive,
      startedAt: this.startedAt ? this.startedAt.toISOString() : null,
      lastPollAt: this.lastPollAt ? this.lastPollAt.toISOString() : null,
      pollCount: this.pollCount,
      lastError: this.lastError || null,
    };
  }
}

// Standalone runner
if (
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("worker.js")
) {
  (async () => {
    await connectDB();
    const worker = new PayoutWorker();

    process.on("SIGINT", () => {
      console.log("\n[worker] Gracefully shutting down worker...");
      worker.stop();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      worker.stop();
      process.exit(0);
    });

    await worker.start();
  })();
}
