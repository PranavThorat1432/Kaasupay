// Admin controller — staff-only operations.
// Day 3: POST /api/v1/admin/deposit
// Bonus: GET /api/v1/admin/reconcile
//
// Staff authorization uses the x-admin-key header compared to ADMIN_KEY from
// validated config. This is a simplified educational mechanism — not full RBAC.

import { z } from "zod";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import Wallet from "../models/walletModel.js";
import Transaction from "../models/transactionModel.js";
import LedgerEntry from "../models/ledgerEntryModel.js";
import Withdrawal from "../models/withdrawalModel.js";
import OutboxEvent from "../models/outboxEventModel.js";
import { deposit as depositMoney, reverseWithdrawal, MoneyError } from "../services/money.js";
import { unlockUserPin } from "../services/pinService.js";
import { ADMIN_KEY, BANK_URL } from "../config.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

// Deposit limits (paise):
//   Minimum: 100 paise (₹1.00)
//   Maximum: 10,000,000 paise (₹100,000.00)
const depositSchema = z.object({
  to: z
    .string({ error: "to is required" })
    .trim()
    .toLowerCase()
    .email({ error: "to must be a valid email" }),
  amount: z
    .number({ error: "amount must be a number" })
    .int({ error: "amount must be an integer (paise)" })
    .min(100, { error: "amount must be at least 100 paise (₹1.00)" })
    .max(10_000_000, { error: "amount must be at most 10,000,000 paise (₹100,000.00)" }),
  note: z
    .string()
    .trim()
    .max(200, { error: "note must be at most 200 characters" })
    .optional(),
});

// ---------------------------------------------------------------------------
// Staff-key guard (reused across admin endpoints)
// ---------------------------------------------------------------------------

/**
 * Checks the x-admin-key header. Returns true if valid; sends 401 and returns
 * false if missing or incorrect. Never exposes the actual key value.
 */
function checkAdminKey(req, res) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== ADMIN_KEY) {
    res.status(401).json({ error: "Staff only" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// POST /api/v1/admin/deposit
// ---------------------------------------------------------------------------

/**
 * Credits money to a user's wallet. Only reachable with a valid x-admin-key.
 *
 * Processing order (Level 1):
 *  1. Verify staff key.
 *  2. Validate body with Zod.
 *  3. Resolve recipient by normalized email.
 *  4. Run deposit transaction (wallet credit + Transaction + LedgerEntry).
 *  5. Return 201 with the deposit summary.
 */
const adminDeposit = async (req, res) => {
  // 1. Staff key gate — not a JWT; a normal user token is not staff authorization.
  if (!checkAdminKey(req, res)) return;

  // 2. Validate body.
  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input" });
  }

  const { to, amount, note } = parsed.data;
  const resolvedNote = note ?? "Bank deposit";

  try {
    // 3. Find recipient by normalized email (Zod already lowercased it).
    const recipient = await User.findOne({ username: to });
    if (!recipient) {
      return res.status(404).json({ error: "User not found" });
    }

    // 4. Run the atomic deposit (wallet + transaction + ledger entry).
    //    The money service also returns 404 if the wallet is missing.
    const { transaction, ledgerEntry, newBalance } = await depositMoney({
      toUserId: recipient._id,
      amount,
      note: resolvedNote,
    });

    // 5. Return success (201). Never expose internal IDs unnecessarily — but
    //    transactionId lets the caller trace the deposit if needed.
    return res.status(201).json({
      message: "Deposit successful",
      transactionId: transaction._id,
      to: recipient.username,
      amount,
      newBalance,
      note: resolvedNote,
    });
  } catch (err) {
    if (err instanceof MoneyError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("Unexpected error in adminDeposit:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/admin/reconcile (Bonus)
// ---------------------------------------------------------------------------

/**
 * Reports the financial health of the system:
 *   - Number of wallets and total balance.
 *   - Total deposited amount (sum of all DEPOSIT transactions).
 *   - Whether total deposits == total wallet balances (money is conserved).
 *   - Wallets whose current balance doesn't match their ledger net total.
 *
 * Uses MongoDB aggregation — does NOT load every document into JS memory.
 */
const adminReconcile = async (req, res) => {
  if (!checkAdminKey(req, res)) return;

  try {
    // Total wallet balances (aggregation — not a JS-side sum).
    const [walletStats] = await Wallet.aggregate([
      {
        $group: {
          _id: null,
          totalBalance: { $sum: "$balance" },
          walletCount: { $sum: 1 },
        },
      },
    ]);

    const totalBalance = walletStats?.totalBalance ?? 0;
    const walletCount = walletStats?.walletCount ?? 0;

    // Money In: Sum of all DEPOSIT and TOPUP transactions
    const [depositStats] = await Transaction.aggregate([
      { $match: { type: { $in: ["DEPOSIT", "TOPUP"] }, status: "COMPLETED" } },
      {
        $group: {
          _id: null,
          totalDeposited: { $sum: "$amount" },
        },
      },
    ]);

    const moneyIn = depositStats?.totalDeposited ?? 0;

    // Money Out: Withdrawals minus Reversals
    const [withdrawalStats] = await Transaction.aggregate([
      { $match: { type: "WITHDRAWAL", status: "COMPLETED" } },
      {
        $group: {
          _id: null,
          totalWithdrawals: { $sum: "$amount" },
        },
      },
    ]);
    const totalWithdrawals = withdrawalStats?.totalWithdrawals ?? 0;

    const [reversalStats] = await Transaction.aggregate([
      { $match: { type: "REVERSAL", status: "COMPLETED" } },
      {
        $group: {
          _id: null,
          totalReversals: { $sum: "$amount" },
        },
      },
    ]);
    const totalReversals = reversalStats?.totalReversals ?? 0;

    const moneyOut = totalWithdrawals - totalReversals;
    const isConserved = totalBalance === (moneyIn - moneyOut);

    // For each wallet, compute the ledger net (credits - debits) and compare.
    const ledgerNetByUser = await LedgerEntry.aggregate([
      {
        $group: {
          _id: "$userId",
          ledgerNet: {
            $sum: {
              $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }],
            },
          },
        },
      },
    ]);

    // Index ledger net by userId string for quick lookup.
    const ledgerNetMap = new Map(
      ledgerNetByUser.map((r) => [r._id.toString(), r.ledgerNet])
    );

    // Fetch all wallets to compare.
    const wallets = await Wallet.find({}).select("userId balance");
    const mismatches = [];

    for (const w of wallets) {
      const ledgerNet = ledgerNetMap.get(w.userId.toString()) ?? 0;
      if (w.balance !== ledgerNet) {
        mismatches.push({
          userId: w.userId,
          walletBalance: w.balance,
          ledgerNet,
          discrepancy: w.balance - ledgerNet,
        });
      }
    }

    return res.status(200).json({
      wallets: walletCount,
      walletCount,
      totalBalance,
      moneyIn,
      moneyOut,
      totalDeposited: moneyIn,
      moneyConserved: isConserved,
      moneyIsConserved: isConserved,
      mismatches,
    });
  } catch (err) {
    console.error("Unexpected error in adminReconcile:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Returns withdrawals requiring staff check (e.g. status=NEEDS_REVIEW).
 * GET /api/v1/admin/withdrawals
 */
const getAdminWithdrawals = async (req, res) => {
  if (!checkAdminKey(req, res)) return;

  try {
    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const withdrawals = await Withdrawal.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("userId", "firstName lastName username")
      .populate("bankAccountId", "holderName last4 ifsc");

    const formatted = withdrawals.map((w) => ({
      id: w._id,
      amount: w.amount,
      status: w.status,
      reference: w.reference,
      bankRef: w.bankRef,
      failureReason: w.failureReason,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
      account: w.bankAccountId ? `XXXXXX${w.bankAccountId.last4}` : null,
      holderName: w.bankAccountId?.holderName ?? null,
      ifsc: w.bankAccountId?.ifsc ?? null,
      user: w.userId
        ? {
            id: w.userId._id,
            name: `${w.userId.firstName} ${w.userId.lastName}`.trim(),
            username: w.userId.username,
          }
        : null,
    }));

    return res.status(200).json({ withdrawals: formatted });
  } catch (err) {
    console.error("Unexpected error in getAdminWithdrawals:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Staff-only unlock of locked user payment PIN.
 * POST /api/v1/admin/users/:id/unlock-pin
 */
const adminUnlockPin = async (req, res) => {
  if (!checkAdminKey(req, res)) return;

  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    const result = await unlockUserPin(id);
    return res.status(200).json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ message: err.message, error: err.message });
  }
};

/**
 * Staff-only manual resolution of withdrawals in NEEDS_REVIEW.
 * POST /api/v1/admin/withdrawals/:id/resolve
 *
 * Body:
 * {
 *   action: "REFUND" | "CONFIRM_SUCCESS",
 *   reason?: string,
 *   bankRef?: string
 * }
 */
const resolveAdminWithdrawal = async (req, res) => {
  if (!checkAdminKey(req, res)) return;

  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid withdrawal ID" });
    }

    const { action, reason, bankRef } = req.body || {};
    if (!action || !["REFUND", "CONFIRM_SUCCESS"].includes(action)) {
      return res.status(400).json({
        error: "action is required and must be either 'REFUND' or 'CONFIRM_SUCCESS'",
      });
    }

    const withdrawal = await Withdrawal.findById(id);
    if (!withdrawal) {
      return res.status(404).json({ error: "Withdrawal not found" });
    }

    // Idempotency: if already settled, return safe confirmation without duplicate financial action
    if (withdrawal.status === "SUCCESS") {
      return res.status(200).json({
        message: "Withdrawal is already completed (SUCCESS)",
        withdrawal,
        alreadyResolved: true,
      });
    }

    if (withdrawal.status === "REVERSED") {
      return res.status(200).json({
        message: "Withdrawal is already reversed and refunded (REVERSED)",
        withdrawal,
        alreadyResolved: true,
      });
    }

    if (withdrawal.status !== "NEEDS_REVIEW") {
      return res.status(400).json({
        error: `Only withdrawals in NEEDS_REVIEW can be manually resolved (current status: ${withdrawal.status})`,
      });
    }

    if (action === "REFUND") {
      const refundReason = reason || "Staff manual review: bank confirmed non-payment";
      const result = await reverseWithdrawal({
        withdrawalId: withdrawal._id,
        reason: refundReason,
      });

      // Mark outbox event as DONE
      await OutboxEvent.updateMany(
        { withdrawalId: withdrawal._id, status: { $in: ["NEW", "PROCESSING", "STUCK"] } },
        { $set: { status: "DONE", lastError: `Resolved via staff refund: ${refundReason}` } }
      );

      return res.status(200).json({
        message: "Withdrawal successfully refunded and marked REVERSED",
        withdrawal: result.withdrawal,
        transactionId: result.transaction?._id,
        newBalance: result.newBalance,
        alreadyResolved: false,
      });
    }

    if (action === "CONFIRM_SUCCESS") {
      const resolvedBankRef = bankRef || withdrawal.bankRef || `UTR-STAFF-${Date.now()}`;

      const updated = await Withdrawal.findOneAndUpdate(
        { _id: withdrawal._id, status: "NEEDS_REVIEW" },
        { $set: { status: "SUCCESS", bankRef: resolvedBankRef } },
        { returnDocument: "after" }
      );

      if (!updated) {
        const latest = await Withdrawal.findById(id);
        return res.status(200).json({
          message: `Withdrawal already resolved to ${latest.status}`,
          withdrawal: latest,
          alreadyResolved: true,
        });
      }

      await OutboxEvent.updateMany(
        { withdrawalId: withdrawal._id, status: { $in: ["NEW", "PROCESSING", "STUCK"] } },
        { $set: { status: "DONE" } }
      );

      return res.status(200).json({
        message: "Withdrawal confirmed and marked SUCCESS",
        withdrawal: updated,
        bankRef: resolvedBankRef,
        alreadyResolved: false,
      });
    }
  } catch (err) {
    console.error("Unexpected error in resolveAdminWithdrawal:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Staff query of bank status for a withdrawal's immutable reference.
 * GET /api/v1/admin/withdrawals/:id/bank-status
 */
const getAdminWithdrawalBankStatus = async (req, res) => {
  if (!checkAdminKey(req, res)) return;

  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid withdrawal ID" });
    }

    const withdrawal = await Withdrawal.findById(id);
    if (!withdrawal) {
      return res.status(404).json({ error: "Withdrawal not found" });
    }

    try {
      const bankRes = await fetch(`${BANK_URL}/payouts/${withdrawal.reference}`);
      const bankData = await bankRes.json().catch(() => ({}));
      return res.status(200).json({
        withdrawalId: withdrawal._id,
        reference: withdrawal.reference,
        status: withdrawal.status,
        bankHttpStatus: bankRes.status,
        bankRecord: bankData,
      });
    } catch (bankErr) {
      return res.status(200).json({
        withdrawalId: withdrawal._id,
        reference: withdrawal.reference,
        status: withdrawal.status,
        bankReachable: false,
        error: bankErr.message,
      });
    }
  } catch (err) {
    console.error("Unexpected error in getAdminWithdrawalBankStatus:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

export {
  adminDeposit,
  adminReconcile,
  getAdminWithdrawals,
  adminUnlockPin,
  resolveAdminWithdrawal,
  getAdminWithdrawalBankStatus,
};
