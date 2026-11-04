// Wallet controller — Day 3 additions: transfer and transaction history.
// Day 2: getBalance (unchanged).
// Day 3:
//   POST /api/v1/wallet/transfer — atomic, idempotent transfer with ledger.
//   GET  /api/v1/wallet/transactions — paginated history from LedgerEntry.

import { z } from "zod";
import crypto from "node:crypto";
import mongoose from "mongoose";
import Wallet from "../models/walletModel.js";
import User from "../models/userModel.js";
import LedgerEntry from "../models/ledgerEntryModel.js";
import IdempotencyRecord from "../models/idempotencyRecordModel.js";
import { transfer as transferMoney, MoneyError, hashRequest } from "../services/money.js";
import { verifyPin } from "../services/pinService.js";
import { getDailyLimitStatus } from "../services/dailyLimitService.js";
import { parseIstDateRange } from "../services/dateUtils.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Integer paise → human display: 0 → "₹0.00", 1250 → "₹12.50"
function formatPaise(paise) {
  const rupees = paise / 100;
  return `₹${rupees.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

// Transfer limits (paise):
//   Minimum: 100 paise (₹1.00)
//   Maximum: 1,000,000 paise (₹10,000.00)
const transferSchema = z
  .object({
    to: z
      .string({ error: "to is required" })
      .trim()
      .toLowerCase()
      .email({ error: "to must be a valid email" }),
    amount: z
      .number({ error: "amount must be a number" })
      .int({ error: "amount must be an integer (paise)" })
      .min(100, { error: "amount must be at least 100 paise (₹1.00)" })
      .max(1_000_000, { error: "amount must be at most 1,000,000 paise (₹10,000.00)" }),
    note: z
      .string()
      .trim()
      .max(200, { error: "note must be at most 200 characters" })
      .optional(),
    pin: z.string().optional(),
  })
  .strict();

// Pagination schema for transaction history.
const historySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 1 : parseInt(v, 10)))
    .pipe(z.number().int().min(1, { error: "page must be >= 1" })),
  limit: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 10 : parseInt(v, 10)))
    .pipe(
      z
        .number()
        .int()
        .min(1, { error: "limit must be >= 1" })
        .max(50, { error: "limit must be <= 50" })
    ),
});

// ---------------------------------------------------------------------------
// GET /api/v1/wallet/balance (Day 2 — unchanged)
// ---------------------------------------------------------------------------

const getBalance = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.userId)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const wallet = await Wallet.findOne({ userId: req.userId });

    if (!wallet) {
      // Signup is the only place wallets are created - never create one here.
      return res.status(404).json({ error: "Wallet not found" });
    }

    return res.status(200).json({
      balance: wallet.balance,
      display: formatPaise(wallet.balance),
    });
  } catch (error) {
    console.error("Unexpected error in getBalance:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// POST /api/v1/wallet/transfer (Day 3 — Level 2+3+4+5)
// ---------------------------------------------------------------------------

/**
 * Atomically transfers money from the authenticated sender to a recipient.
 *
 * Idempotency processing (Level 4):
 *  1. Validate auth, key, and request.
 *  2. Compute requestHash from canonical inputs.
 *  3. Insert IN_PROGRESS idempotency record (unique index is the exclusive gate).
 *  4. If key already exists → check state, hash, replay or error.
 *  5. Execute the transfer in a MongoDB transaction.
 *  6. Mark the record DONE and persist the response.
 *  7. Return the response.
 *
 * Failure recovery:
 *  - Expected business errors (insufficient balance, etc.) → stored as DONE.
 *  - Unexpected infrastructure errors → record is DELETED so the client can retry.
 *    (A crashed server leaves IN_PROGRESS records; a cleanup job or TTL can sweep them.)
 */
const transferFunds = async (req, res) => {
  // 1a. Identity guard (requireAuth already sets req.userId; this is defence-in-depth).
  if (!mongoose.isValidObjectId(req.userId)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // 1b. Idempotency key header validation.
  const idempKey = req.headers["idempotency-key"];
  if (!idempKey || typeof idempKey !== "string" || idempKey.trim().length === 0) {
    return res.status(400).json({ error: "Idempotency-Key header is required" });
  }
  const trimmedKey = idempKey.trim();
  if (trimmedKey.length > 100) {
    return res.status(400).json({ error: "Idempotency-Key must be at most 100 characters" });
  }

  // 1c. Validate transfer request body.
  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input" });
  }

  const { to, amount } = parsed.data;
  const note = parsed.data.note ?? "";
  const pin = parsed.data.pin ?? req.body?.pin;
  const senderId = req.userId;

  // 2. Compute a stable canonical hash of the business inputs (PIN is strictly excluded).
  const reqHash = hashRequest({ to, amount, note });

  // If this key was already completed or in progress, handle replay or hash mismatch immediately
  const existingKey = await IdempotencyRecord.findOne({
    userId: senderId,
    key: trimmedKey,
  });

  if (existingKey) {
    if (existingKey.state === "IN_PROGRESS") {
      return res.status(409).json({
        error: "This request is already being processed",
      });
    }
    if (existingKey.state === "DONE") {
      if (existingKey.requestHash !== reqHash) {
        return res.status(422).json({
          error: "Idempotency-Key reused with a different request",
        });
      }
      return res.status(existingKey.responseStatus).json(existingKey.responseBody);
    }
  }

  // Gate 4: Resolve receiver by normalized email and prevent self-transfers.
  const receiver = await User.findOne({ username: to });
  if (!receiver) {
    return res.status(404).json({ error: "Recipient not found" });
  }

  if (receiver._id.toString() === senderId.toString()) {
    return res.status(400).json({ error: "Cannot transfer to yourself" });
  }

  // Gate 5: PIN check (reserve a try first)
  const senderUser = await User.findById(senderId);
  if (pin !== undefined || (senderUser && senderUser.pinHash !== null)) {
    if (!senderUser || !senderUser.pinHash) {
      return res.status(400).json({
        message: "Set your payment PIN first",
        error: "Set your payment PIN first",
      });
    }
    if (!pin) {
      return res.status(400).json({
        message: "PIN is required",
        error: "PIN is required",
      });
    }

    try {
      await verifyPin(senderId, pin);
    } catch (pinErr) {
      const status = pinErr.statusCode || 400;
      if (status === 423 && pinErr.retryAfterSeconds) {
        res.setHeader("Retry-After", pinErr.retryAfterSeconds);
        return res.status(423).json({
          message: pinErr.message,
          retryAfterSeconds: pinErr.retryAfterSeconds,
        });
      }
      if (status === 403) {
        return res.status(403).json({
          message: pinErr.message,
          triesLeft: pinErr.triesLeft,
        });
      }
      return res.status(status).json({
        message: pinErr.message,
        error: pinErr.message,
      });
    }
  }

  // Gate 6: Claim the idempotency slot atomically.
  let ownedRecord = null;
  try {
    ownedRecord = await IdempotencyRecord.create({
      userId: senderId,
      key: trimmedKey,
      requestHash: reqHash,
      state: "IN_PROGRESS",
    });
  } catch (createErr) {
    if (createErr.code === 11000) {
      // Key already exists — fetch it to determine what to do.
      const existing = await IdempotencyRecord.findOne({
        userId: senderId,
        key: trimmedKey,
      });

      if (!existing) {
        // Extremely rare: record was deleted between the insert attempt and now.
      } else if (existing.state === "IN_PROGRESS") {
        return res.status(409).json({
          error: "This request is already being processed",
        });
      } else if (existing.state === "DONE") {
        if (existing.requestHash !== reqHash) {
          return res.status(422).json({
            error: "Idempotency-Key reused with a different request",
          });
        }
        return res.status(existing.responseStatus).json(existing.responseBody);
      }
    } else {
      console.error("Unexpected error creating idempotency record:", createErr);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }

  // Helpers to persist or clean up idempotency record
  async function finalise(status, body) {
    try {
      if (ownedRecord) {
        await IdempotencyRecord.findByIdAndUpdate(ownedRecord._id, {
          state: "DONE",
          responseStatus: status,
          responseBody: body,
        });
      }
    } catch (err) {
      console.error("Failed to finalise idempotency record:", err);
    }
  }

  async function deleteRecord() {
    try {
      if (ownedRecord) {
        await IdempotencyRecord.findByIdAndDelete(ownedRecord._id);
      }
    } catch (err) {
      console.error("Failed to delete IN_PROGRESS idempotency record:", err);
    }
  }

  // Gate 7-9: One Transaction (daily limit, hold, credit, ledger)
  try {
    const { transaction, senderBalance } = await transferMoney({
      fromUserId: senderId,
      toUserId: receiver._id,
      amount,
      note,
    });

    const responseBody = {
      message: "Transfer successful",
      transactionId: transaction._id,
      to: receiver.username,
      amount,
      senderBalance,
      balance: senderBalance,
      note,
    };

    // Return 200 for Day 6 (with PIN) / 201 for Day 3 compatibility (without PIN)
    const successStatus = req.body?.pin !== undefined ? 200 : 201;
    await finalise(successStatus, responseBody);
    return res.status(successStatus).json(responseBody);
  } catch (err) {
    if (err instanceof MoneyError || err.name === "MoneyError") {
      const body = { error: err.message, message: err.message };
      if (err.leftToday !== undefined) {
        body.leftToday = err.leftToday;
      }
      await finalise(err.status, body);
      return res.status(err.status).json(body);
    }
    // Unexpected infrastructure error — delete IN_PROGRESS so the client can retry.
    await deleteRecord();
    console.error("Unexpected error in transferFunds:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/wallet/transactions?page=1&limit=10 (Day 3 — Level 5)
// ---------------------------------------------------------------------------

/**
 * Returns a paginated, newest-first transaction history for the authenticated
 * user. Each entry is a ledger entry enriched with transaction type/note and
 * the other party's name.
 *
 * Authorization: only the authenticated user's own entries are returned.
 * The userId filter is always { userId: req.userId } — never from the client.
 */
const getTransactions = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.userId)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Validate and parse pagination query params.
    const parsed = historySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input" });
    }

    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    // Count total entries for this user (for pagination metadata).
    const total = await LedgerEntry.countDocuments({ userId: req.userId });

    // Fetch the requested page, newest first, with transaction and user data.
    const entries = await LedgerEntry.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: "transactionId",
        select: "type fromUserId toUserId note amount",
        populate: [
          {
            path: "fromUserId",
            select: "firstName lastName",
          },
          {
            path: "toUserId",
            select: "firstName lastName",
          },
        ],
      });

    const data = entries.map((entry) => {
      const txn = entry.transactionId;
      let withWhom = "Bank deposit";

      if (txn && txn.type === "TOPUP") {
        withWhom = "Added via Razorpay";
      } else if (txn && txn.type === "WITHDRAWAL") {
        withWhom = "Withdrawal to bank";
      } else if (txn && txn.type === "REVERSAL") {
        withWhom = "Refund of failed withdrawal";
      } else if (txn && txn.type === "TRANSFER") {
        // "With whom" is the OTHER party, not ourselves.
        const senderIdStr = txn.fromUserId?._id?.toString();
        const meStr = req.userId;
        if (senderIdStr === meStr) {
          // We are the sender → the other party is the receiver.
          const r = txn.toUserId;
          withWhom = r ? `${r.firstName} ${r.lastName}` : "Unknown";
        } else {
          // We are the receiver → the other party is the sender.
          const s = txn.fromUserId;
          withWhom = s ? `${s.firstName} ${s.lastName}` : "Unknown";
        }
      }

      return {
        transactionId: txn?._id ?? null,
        type: txn?.type ?? "UNKNOWN",
        direction: entry.direction,
        amount: entry.amount,
        withWhom,
        note: txn?.note ?? null,
        balanceAfter: entry.balanceAfter,
        createdAt: entry.createdAt,
      };
    });

    return res.status(200).json({
      data,
      transactions: data,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Unexpected error in getTransactions:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * GET /api/v1/wallet/history — cursor-based transaction history (Day 8 Level 1)
 *
 * Query params:
 *   - limit: optional number (default 20, min 1, max 50)
 *   - cursor: optional Base64URL encoded cursor { t: string, id: string }
 *
 * Sort: { createdAt: -1, _id: -1 }
 * Fetches: limit + 1 records to determine if there is a next page
 */
const getHistory = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.userId)) {
      return res.status(401).json({ error: "Unauthorized", message: "Unauthorized" });
    }

    // 1. Limit validation: default 20, min 1, max 50
    let limit = 20;
    if (req.query.limit !== undefined) {
      const parsedLimit = Number(req.query.limit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
        return res.status(400).json({ error: "Invalid limit", message: "Invalid limit" });
      }
      limit = parsedLimit;
    }

    // 2. Cursor validation and decoding
    let cursorCondition = null;
    if (req.query.cursor) {
      try {
        const decodedStr = Buffer.from(req.query.cursor, "base64url").toString("utf8");
        const parsed = JSON.parse(decodedStr);
        if (!parsed || typeof parsed !== "object" || !parsed.t || !parsed.id) {
          return res.status(400).json({ error: "Bad cursor", message: "Bad cursor" });
        }
        const cursorDate = new Date(parsed.t);
        if (isNaN(cursorDate.getTime()) || !mongoose.isValidObjectId(parsed.id)) {
          return res.status(400).json({ error: "Bad cursor", message: "Bad cursor" });
        }
        const cursorId = new mongoose.Types.ObjectId(parsed.id);
        cursorCondition = {
          $or: [
            { createdAt: { $lt: cursorDate } },
            { createdAt: cursorDate, _id: { $lt: cursorId } },
          ],
        };
      } catch (err) {
        return res.status(400).json({ error: "Bad cursor", message: "Bad cursor" });
      }
    }

    // 3. Direction and Type filter validation (Day 8 Level 2)
    const VALID_DIRECTIONS = ["DEBIT", "CREDIT"];
    const VALID_TYPES = ["TRANSFER", "DEPOSIT", "TOPUP", "WITHDRAWAL", "REVERSAL"];

    if (req.query.direction !== undefined) {
      if (!VALID_DIRECTIONS.includes(req.query.direction)) {
        return res.status(400).json({ error: "Invalid direction filter", message: "Invalid direction filter" });
      }
    }

    if (req.query.type !== undefined) {
      if (!VALID_TYPES.includes(req.query.type)) {
        return res.status(400).json({ error: "Invalid type filter", message: "Invalid type filter" });
      }
    }

    // 4. India Standard Time Date Range validation (Day 8 Level 2)
    const { dateCondition, error: dateError } = parseIstDateRange(req.query.from, req.query.to);
    if (dateError) {
      return res.status(400).json({ error: dateError, message: dateError });
    }

    // 5. Build combined query filter using $and
    const andClauses = [];
    if (cursorCondition) {
      andClauses.push(cursorCondition);
    }
    if (req.query.direction) {
      andClauses.push({ direction: req.query.direction });
    }
    if (req.query.type) {
      andClauses.push({ type: req.query.type });
    }
    if (dateCondition) {
      andClauses.push(dateCondition);
    }

    const query = {
      userId: req.userId,
    };
    if (andClauses.length > 0) {
      query.$and = andClauses;
    }

    // 6. Fetch limit + 1 items with populated transaction details
    const entries = await LedgerEntry.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .populate({
        path: "transactionId",
        select: "type fromUserId toUserId note amount",
        populate: [
          { path: "fromUserId", select: "firstName lastName" },
          { path: "toUserId", select: "firstName lastName" },
        ],
      });

    // 5. Evaluate hasMore and generate nextCursor from limit-th record (entries[limit - 1])
    const hasMore = entries.length > limit;
    const itemsToReturn = hasMore ? entries.slice(0, limit) : entries;

    let nextCursor = null;
    if (hasMore) {
      const last = itemsToReturn[itemsToReturn.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({
          t: last.createdAt.toISOString(),
          id: last._id.toString(),
        })
      ).toString("base64url");
    }

    // 6. Map to standardized response fields
    const items = itemsToReturn.map((entry) => {
      const txn = entry.transactionId;
      let withWhom = "Bank deposit";
      const txnType = entry.type || txn?.type || "UNKNOWN";

      if (txnType === "TOPUP") {
        withWhom = "Added via Razorpay";
      } else if (txnType === "WITHDRAWAL") {
        withWhom = "Withdrawal to bank";
      } else if (txnType === "REVERSAL") {
        withWhom = "Refund of failed withdrawal";
      } else if (txnType === "TRANSFER") {
        const senderIdStr = txn?.fromUserId?._id?.toString() || txn?.fromUserId?.toString();
        const meStr = req.userId.toString();
        if (senderIdStr === meStr) {
          const r = txn.toUserId;
          withWhom = r?.firstName ? `${r.firstName} ${r.lastName || ""}`.trim() : "Unknown";
        } else {
          const s = txn.fromUserId;
          withWhom = s?.firstName ? `${s.firstName} ${s.lastName || ""}`.trim() : "Unknown";
        }
      }

      return {
        id: entry._id.toString(),
        _id: entry._id.toString(),
        transactionId: txn?._id?.toString() ?? null,
        type: txnType,
        label: withWhom,
        withWhom,
        direction: entry.direction,
        amount: entry.amount,
        balanceAfter: entry.balanceAfter,
        note: txn?.note ?? null,
        at: entry.createdAt.toISOString(),
        createdAt: entry.createdAt,
      };
    });

    return res.status(200).json({
      items,
      nextCursor,
    });
  } catch (error) {
    console.error("Unexpected error in getHistory:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * GET /api/v1/wallet/limits — returns daily spending limit status.
 */
const getLimits = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.userId)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const limits = await getDailyLimitStatus(req.userId);
    return res.status(200).json(limits);
  } catch (error) {
    console.error("Unexpected error in getLimits:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

export { getBalance, transferFunds, getTransactions, getHistory, getLimits };
