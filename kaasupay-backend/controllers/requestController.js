// controllers/requestController.js — Controller handlers for Day 7 Request Money.
import crypto from "node:crypto";
import mongoose from "mongoose";
import MoneyRequest from "../models/moneyRequestModel.js";
import User from "../models/userModel.js";
import Wallet from "../models/walletModel.js";
import Transaction from "../models/transactionModel.js";
import LedgerEntry from "../models/ledgerEntryModel.js";
import IdempotencyRecord from "../models/idempotencyRecordModel.js";
import { verifyPin } from "../services/pinService.js";
import { checkAndConsumeDailyLimit } from "../services/dailyLimitService.js";
import { MoneyError } from "../services/money.js";
import { REQUEST_EXPIRY_DAYS } from "../config.js";
import { createRequestSchema } from "../validations/requestValidation.js";

/**
 * Helper to format a user's full name.
 * If user has firstName and lastName, returns "FirstName LastName".
 */
export function formatUserName(user) {
  if (!user) return "Unknown";
  const name = `${user.firstName || ""} ${user.lastName || ""}`.trim();
  return name || user.username || "Unknown";
}

/**
 * POST /api/v1/requests
 * Creates a new money request from the authenticated user to a target payer.
 */
export async function createRequest(req, res) {
  try {
    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid inputs",
        error: "Invalid inputs",
        details: parsed.error.issues,
      });
    }

    const { to, amount, note } = parsed.data;

    // A user cannot request money from themselves.
    if (to === req.userId) {
      return res.status(400).json({
        message: "You can't request money from yourself",
        error: "You can't request money from yourself",
      });
    }

    // Payer must exist in the database.
    const payer = await User.findById(to).select("firstName lastName username");
    if (!payer) {
      return res.status(404).json({
        message: "User not found",
        error: "User not found",
      });
    }

    // Anti-spam rule (Day 7 PDF Level 5): At most 5 pending requests to the same person.
    const pendingCount = await MoneyRequest.countDocuments({
      requesterId: req.userId,
      payerId: to,
      status: "PENDING",
    });

    if (pendingCount >= 5) {
      return res.status(409).json({
        message: "You already have 5 pending requests to this person",
        error: "You already have 5 pending requests to this person",
      });
    }

    // Calculate expiration timestamp (7 days from now).
    const expiresAt = new Date(Date.now() + REQUEST_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const doc = await MoneyRequest.create({
      requesterId: req.userId,
      payerId: to,
      amount,
      note: note || null,
      status: "PENDING",
      expiresAt,
    });

    return res.status(201).json({
      message: "Request sent",
      request: {
        id: doc._id.toString(),
        to: formatUserName(payer),
        amount: doc.amount,
        note: doc.note,
        status: doc.status,
        expiresAt: doc.expiresAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[createRequest Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * GET /api/v1/requests/incoming
 * Lists requests where the authenticated user is the payer (money requested from them).
 */
export async function getIncomingRequests(req, res) {
  try {
    const now = new Date();

    // Lazy expiration: mark overdue pending incoming requests as EXPIRED in one query.
    await MoneyRequest.updateMany(
      {
        payerId: req.userId,
        status: "PENDING",
        expiresAt: { $lte: now },
      },
      {
        $set: { status: "EXPIRED" },
      }
    );

    const filter = { payerId: req.userId };
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const requests = await MoneyRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("requesterId", "firstName lastName username");

    return res.status(200).json({
      requests: requests.map((doc) => ({
        id: doc._id.toString(),
        from: formatUserName(doc.requesterId),
        amount: doc.amount,
        note: doc.note,
        status: doc.status,
        createdAt: doc.createdAt.toISOString(),
        expiresAt: doc.expiresAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[getIncomingRequests Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * GET /api/v1/requests/outgoing
 * Lists requests where the authenticated user is the requester (money requested by them).
 */
export async function getOutgoingRequests(req, res) {
  try {
    const now = new Date();

    // Lazy expiration: mark overdue pending outgoing requests as EXPIRED in one query.
    await MoneyRequest.updateMany(
      {
        requesterId: req.userId,
        status: "PENDING",
        expiresAt: { $lte: now },
      },
      {
        $set: { status: "EXPIRED" },
      }
    );

    const filter = { requesterId: req.userId };
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const requests = await MoneyRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("payerId", "firstName lastName username");

    return res.status(200).json({
      requests: requests.map((doc) => ({
        id: doc._id.toString(),
        to: formatUserName(doc.payerId),
        amount: doc.amount,
        note: doc.note,
        status: doc.status,
        createdAt: doc.createdAt.toISOString(),
        expiresAt: doc.expiresAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[getOutgoingRequests Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * GET /api/v1/requests/:id
 * Retrieves a single request. Only accessible by requester or payer.
 * Strangers receive generic 404 to avoid leaking existence.
 */
export async function getRequestById(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "Request not found" });
    }

    const doc = await MoneyRequest.findById(id)
      .populate("requesterId", "firstName lastName username")
      .populate("payerId", "firstName lastName username");

    if (!doc) {
      return res.status(404).json({ message: "Request not found" });
    }

    const reqUserStr = req.userId.toString();
    const requesterStr = doc.requesterId?._id?.toString() || doc.requesterId?.toString();
    const payerStr = doc.payerId?._id?.toString() || doc.payerId?.toString();

    // Privacy guard: Only the requester and payer may see this request.
    if (reqUserStr !== requesterStr && reqUserStr !== payerStr) {
      return res.status(404).json({ message: "Request not found" });
    }

    // Lazy expiration on single read
    if (doc.status === "PENDING" && doc.expiresAt <= new Date()) {
      doc.status = "EXPIRED";
      await MoneyRequest.updateOne({ _id: doc._id }, { $set: { status: "EXPIRED" } });
    }

    return res.status(200).json({
      request: {
        id: doc._id.toString(),
        from: formatUserName(doc.requesterId),
        to: formatUserName(doc.payerId),
        amount: doc.amount,
        note: doc.note,
        status: doc.status,
        createdAt: doc.createdAt.toISOString(),
        expiresAt: doc.expiresAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[getRequestById Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * POST /api/v1/requests/:id/decline
 * Moves request from PENDING to DECLINED (Payer only).
 * Performs atomic conditional update with { returnDocument: "after" }.
 */
export async function declineRequest(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "Request not found" });
    }

    const now = new Date();

    // Atomic state transition: Only the payer can decline a PENDING non-expired request.
    const updated = await MoneyRequest.findOneAndUpdate(
      {
        _id: id,
        payerId: req.userId,
        status: "PENDING",
        expiresAt: { $gt: now },
      },
      {
        $set: {
          status: "DECLINED",
          decidedAt: now,
        },
      },
      { returnDocument: "after" }
    );

    if (updated) {
      return res.status(200).json({ message: "Request declined" });
    }

    // Atomic update returned null. Read once to build specific response.
    const existing = await MoneyRequest.findById(id);
    if (!existing) {
      return res.status(404).json({ message: "Request not found" });
    }

    const reqUserStr = req.userId.toString();
    const requesterStr = existing.requesterId.toString();
    const payerStr = existing.payerId.toString();

    // Stranger isolation (never leak request existence to third parties).
    if (reqUserStr !== requesterStr && reqUserStr !== payerStr) {
      return res.status(404).json({ message: "Request not found" });
    }

    // Role check: requester trying to decline.
    if (reqUserStr === requesterStr) {
      return res.status(403).json({
        message: "Only the person asked can decline this request",
        error: "Only the person asked can decline this request",
      });
    }

    // Expiry check.
    if (existing.expiresAt <= now) {
      return res.status(410).json({ message: "This request has expired" });
    }

    // Already decided state.
    return res.status(409).json({
      message: `This request is already ${existing.status}`,
      error: `This request is already ${existing.status}`,
    });
  } catch (err) {
    console.error("[declineRequest Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * POST /api/v1/requests/:id/cancel
 * Moves request from PENDING to CANCELLED (Requester only).
 * Performs atomic conditional update with { returnDocument: "after" }.
 */
export async function cancelRequest(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "Request not found" });
    }

    const now = new Date();

    // Atomic state transition: Only the requester can cancel a PENDING non-expired request.
    const updated = await MoneyRequest.findOneAndUpdate(
      {
        _id: id,
        requesterId: req.userId,
        status: "PENDING",
        expiresAt: { $gt: now },
      },
      {
        $set: {
          status: "CANCELLED",
          decidedAt: now,
        },
      },
      { returnDocument: "after" }
    );

    if (updated) {
      return res.status(200).json({ message: "Request cancelled" });
    }

    // Atomic update returned null. Read once to build specific response.
    const existing = await MoneyRequest.findById(id);
    if (!existing) {
      return res.status(404).json({ message: "Request not found" });
    }

    const reqUserStr = req.userId.toString();
    const requesterStr = existing.requesterId.toString();
    const payerStr = existing.payerId.toString();

    // Stranger isolation (never leak request existence to third parties).
    if (reqUserStr !== requesterStr && reqUserStr !== payerStr) {
      return res.status(404).json({ message: "Request not found" });
    }

    // Role check: payer trying to cancel.
    if (reqUserStr === payerStr) {
      return res.status(403).json({
        message: "Only the requester can cancel this request",
        error: "Only the requester can cancel this request",
      });
    }

    // Expiry check.
    if (existing.expiresAt <= now) {
      return res.status(410).json({ message: "This request has expired" });
    }

    // Already decided state.
    return res.status(409).json({
      message: `This request is already ${existing.status}`,
      error: `This request is already ${existing.status}`,
    });
  } catch (err) {
    console.error("[cancelRequest Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * POST /api/v1/requests/:id/pay
 * Executes payment for a money request in a single atomic transaction.
 * Double-lock protection: Idempotency-Key + PENDING conditional update.
 */
export async function payRequest(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "Request not found" });
    }

    // Idempotency-Key header validation
    const idempKey = req.headers["idempotency-key"];
    if (!idempKey || typeof idempKey !== "string" || idempKey.trim().length === 0) {
      return res.status(400).json({ message: "Idempotency-Key header is required" });
    }
    const trimmedKey = idempKey.trim();
    if (trimmedKey.length > 100) {
      return res.status(400).json({ message: "Idempotency-Key must be at most 100 characters" });
    }

    // PIN validation
    const pin = req.body?.pin;
    if (typeof pin !== "string" || pin.trim().length === 0) {
      return res.status(400).json({ message: "PIN is required" });
    }

    // Canonical request hash: route + request id (never the PIN)
    const reqHash = crypto
      .createHash("sha256")
      .update(`POST /api/v1/requests/${id}/pay`)
      .digest("hex");

    // Replay check before anything else
    const existingKey = await IdempotencyRecord.findOne({
      userId: req.userId,
      key: trimmedKey,
    });

    if (existingKey) {
      if (existingKey.state === "IN_PROGRESS") {
        return res.status(409).json({ message: "This request is already being processed" });
      }
      if (existingKey.state === "DONE") {
        if (existingKey.requestHash !== reqHash) {
          return res.status(422).json({ message: "Idempotency-Key reused with a different request" });
        }
        return res.status(existingKey.responseStatus).json(existingKey.responseBody);
      }
    }

    // Load the request to verify authorization and current state
    const doc = await MoneyRequest.findById(id);
    if (!doc) {
      return res.status(404).json({ message: "Request not found" });
    }

    const reqUserStr = req.userId.toString();
    const requesterStr = doc.requesterId.toString();
    const payerStr = doc.payerId.toString();

    // Stranger check (404 isolation)
    if (reqUserStr !== requesterStr && reqUserStr !== payerStr) {
      return res.status(404).json({ message: "Request not found" });
    }

    // Requester check: cannot pay own request (403)
    if (reqUserStr === requesterStr) {
      return res.status(403).json({ message: "Only the person asked can pay this request" });
    }

    const now = new Date();
    if (doc.expiresAt <= now) {
      return res.status(410).json({ message: "This request has expired" });
    }

    if (doc.status !== "PENDING") {
      return res.status(409).json({ message: `This request is already ${doc.status}` });
    }

    // Verify PIN (Day 6) BEFORE creating idempotency record so failed PIN does not consume key
    try {
      await verifyPin(req.userId, pin);
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

    // Claim idempotency slot atomically
    let ownedRecord = null;
    try {
      ownedRecord = await IdempotencyRecord.create({
        userId: req.userId,
        key: trimmedKey,
        requestHash: reqHash,
        state: "IN_PROGRESS",
      });
    } catch (createErr) {
      if (createErr.code === 11000) {
        const existing = await IdempotencyRecord.findOne({
          userId: req.userId,
          key: trimmedKey,
        });
        if (existing) {
          if (existing.state === "IN_PROGRESS") {
            return res.status(409).json({ message: "This request is already being processed" });
          }
          if (existing.state === "DONE") {
            if (existing.requestHash !== reqHash) {
              return res.status(422).json({ message: "Idempotency-Key reused with a different request" });
            }
            return res.status(existing.responseStatus).json(existing.responseBody);
          }
        }
      }
      console.error("[payRequest Idempotency Error]", createErr);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    // Execute single session transaction
    const session = await mongoose.startSession();
    let settlementResult = null;
    try {
      await session.withTransaction(async () => {
        const txNow = new Date();

        // 1. Move request from PENDING to PAID (only if still PENDING and not expired)
        const updatedReq = await MoneyRequest.findOneAndUpdate(
          {
            _id: id,
            payerId: req.userId,
            status: "PENDING",
            expiresAt: { $gt: txNow },
          },
          {
            $set: {
              status: "PAID",
              decidedAt: txNow,
            },
          },
          { session, returnDocument: "after" }
        );

        if (!updatedReq) {
          const current = await MoneyRequest.findById(id).session(session);
          if (!current) throw new MoneyError(404, "Request not found");
          if (current.expiresAt <= txNow) throw new MoneyError(410, "This request has expired");
          throw new MoneyError(409, `This request is already ${current.status}`);
        }

        // 2. Daily limit check: add amount only if it still fits within limit
        await checkAndConsumeDailyLimit(req.userId, doc.amount, session);

        // 3. Debit payer wallet atomically
        const payerWallet = await Wallet.findOneAndUpdate(
          { userId: req.userId, balance: { $gte: doc.amount } },
          { $inc: { balance: -doc.amount } },
          { session, returnDocument: "after" }
        );

        if (!payerWallet) {
          throw new MoneyError(400, "Insufficient balance");
        }

        // 4. Credit requester wallet
        const requesterWallet = await Wallet.findOneAndUpdate(
          { userId: doc.requesterId },
          { $inc: { balance: doc.amount } },
          { session, returnDocument: "after" }
        );

        if (!requesterWallet) {
          throw new MoneyError(404, "Receiver wallet not found");
        }

        // 5. Create TRANSFER transaction record
        const note = doc.note ? `Request: ${doc.note}` : "Request";
        const [txn] = await Transaction.create(
          [
            {
              type: "TRANSFER",
              fromUserId: req.userId,
              toUserId: doc.requesterId,
              amount: doc.amount,
              note,
              status: "COMPLETED",
            },
          ],
          { session }
        );

        // 6. Double-entry ledger rows
        await LedgerEntry.create(
          [
            {
              userId: req.userId,
              transactionId: txn._id,
              direction: "DEBIT",
              amount: doc.amount,
              balanceAfter: payerWallet.balance,
            },
          ],
          { session }
        );

        await LedgerEntry.create(
          [
            {
              userId: doc.requesterId,
              transactionId: txn._id,
              direction: "CREDIT",
              amount: doc.amount,
              balanceAfter: requesterWallet.balance,
            },
          ],
          { session }
        );

        // 7. Save transactionId on the request
        await MoneyRequest.updateOne(
          { _id: id },
          { $set: { transactionId: txn._id } },
          { session }
        );

        settlementResult = {
          transactionId: txn._id.toString(),
          balance: payerWallet.balance,
        };
      });
    } catch (txErr) {
      // Transaction rolled back. Delete IN_PROGRESS record so retries are permitted.
      if (ownedRecord) {
        await IdempotencyRecord.findByIdAndDelete(ownedRecord._id).catch(() => {});
      }

      if (txErr instanceof MoneyError || txErr.name === "MoneyError") {
        const resp = { message: txErr.message };
        if (txErr.leftToday !== undefined) {
          resp.leftToday = txErr.leftToday;
        }
        return res.status(txErr.status || txErr.statusCode || 400).json(resp);
      }

      console.error("[payRequest Transaction Error]", txErr);
      return res.status(500).json({ error: "Internal Server Error" });
    } finally {
      await session.endSession();
    }

    // Finalise idempotency record to DONE
    const responseBody = {
      message: "Request paid",
      transactionId: settlementResult.transactionId,
      balance: settlementResult.balance,
    };

    if (ownedRecord) {
      await IdempotencyRecord.findByIdAndUpdate(ownedRecord._id, {
        state: "DONE",
        responseStatus: 200,
        responseBody,
      }).catch((err) => console.error("Failed to finalise idempotency record:", err));
    }

    return res.status(200).json(responseBody);
  } catch (err) {
    console.error("[payRequest Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

