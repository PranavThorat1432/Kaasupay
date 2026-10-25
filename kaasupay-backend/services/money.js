// services/money.js — Shared transactional money operations.
//
// Both deposit and transfer use MongoDB transactions so that every involved
// write (wallet update + transaction doc + ledger entries) commits atomically
// or rolls back entirely. No partial financial state can persist.
//
// session.withTransaction() automatically handles:
//   - Starting the transaction.
//   - Committing on success.
//   - Aborting + retrying on transient write conflicts (TransientTransactionError).
//   - Aborting on any other error thrown inside the callback.
//
// IMPORTANT: Do not send HTTP responses from inside the callback — it can be
// retried by the driver. Throw business errors; handle HTTP outside.

import crypto from "node:crypto";
import mongoose from "mongoose";
import Wallet from "../models/walletModel.js";
import Transaction from "../models/transactionModel.js";
import LedgerEntry from "../models/ledgerEntryModel.js";
import PaymentOrder from "../models/paymentOrderModel.js";
import Withdrawal from "../models/withdrawalModel.js";
import OutboxEvent from "../models/outboxEventModel.js";
import { checkAndConsumeDailyLimit } from "./dailyLimitService.js";

// ---------------------------------------------------------------------------
// Custom business error
// ---------------------------------------------------------------------------

/**
 * Thrown by money operations when the failure has a defined HTTP meaning.
 * The controller catches this and maps it to the appropriate HTTP response
 * without exposing internal details.
 */
export class MoneyError extends Error {
  /**
   * @param {number} status - HTTP status code (400, 404, …)
   * @param {string} message - Safe public-facing message
   * @param {Object} [extra] - Additional context (e.g. leftToday)
   */
  constructor(status, message, extra = {}) {
    super(message);
    this.name = "MoneyError";
    this.status = status;
    Object.assign(this, extra);
  }
}

// ---------------------------------------------------------------------------
// Canonical request hash (for idempotency)
// ---------------------------------------------------------------------------

/**
 * Returns a stable SHA-256 hex hash of the canonical transfer inputs.
 * The same (recipient email, amount, note) always produce the same hash.
 * Different inputs produce a different hash so key reuse is detected.
 *
 * @param {{ to: string, amount: number, note: string }} canonical
 * @returns {string} hex SHA-256
 */
export function hashRequest({ to, amount, note }) {
  const payload = JSON.stringify({
    to: to.trim().toLowerCase(),
    amount: Number(amount),
    note: (note ?? "").trim(),
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

// ---------------------------------------------------------------------------
// Deposit (Level 1 + 3)
// ---------------------------------------------------------------------------

/**
 * Credits the recipient's wallet and writes the matching transaction + ledger
 * entry inside one MongoDB transaction.
 *
 * @param {string|ObjectId} toUserId   - Recipient's user ObjectId
 * @param {number}          amount     - Integer paise (validated by caller)
 * @param {string}          note       - Human note (already defaulted by caller)
 * @returns {{ transaction, ledgerEntry, newBalance }}
 * @throws {MoneyError} if the wallet is not found
 */
export async function deposit({ toUserId, amount, note }) {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      // Credit the recipient's wallet atomically.
      const wallet = await Wallet.findOneAndUpdate(
        { userId: toUserId },
        { $inc: { balance: amount } },
        { session, new: true }
      );

      if (!wallet) {
        // Throw inside the callback — withTransaction will abort.
        throw new MoneyError(404, "Wallet not found");
      }

      const newBalance = wallet.balance;

      // Create the DEPOSIT transaction record.
      const [txn] = await Transaction.create(
        [
          {
            type: "DEPOSIT",
            fromUserId: null,
            toUserId,
            amount,
            note,
            status: "COMPLETED",
          },
        ],
        { session }
      );

      // Create one CREDIT ledger entry for the recipient.
      const [entry] = await LedgerEntry.create(
        [
          {
            userId: toUserId,
            transactionId: txn._id,
            direction: "CREDIT",
            amount,
            balanceAfter: newBalance,
          },
        ],
        { session }
      );

      result = { transaction: txn, ledgerEntry: entry, newBalance };
    });
  } finally {
    await session.endSession();
  }

  return result;
}

// ---------------------------------------------------------------------------
// Transfer (Level 2 + 3)
// ---------------------------------------------------------------------------

/**
 * Debits the sender and credits the receiver inside one MongoDB transaction.
 * Uses a conditional findOneAndUpdate so the balance check and debit are
 * atomic — there is no separate read/write that could race.
 *
 * @param {string|ObjectId} fromUserId - Sender's user ObjectId (from JWT)
 * @param {string|ObjectId} toUserId   - Receiver's user ObjectId
 * @param {number}          amount     - Integer paise (validated by caller)
 * @param {string}          note       - Human note
 * @returns {{ transaction, debitEntry, creditEntry, senderBalance, receiverBalance }}
 * @throws {MoneyError} on insufficient balance or missing wallet
 */
export async function transfer({ fromUserId, toUserId, amount, note }) {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      // 0. Daily limit check: add amount only if it still fits within limit
      await checkAndConsumeDailyLimit(fromUserId, amount, session);

      // Atomic conditional debit: only succeeds when balance >= amount.
      // This is ONE database operation — no separate read, no race window.
      const senderWallet = await Wallet.findOneAndUpdate(
        { userId: fromUserId, balance: { $gte: amount } },
        { $inc: { balance: -amount } },
        { session, new: true }
      );

      if (!senderWallet) {
        // Distinguish "wallet missing" from "insufficient balance" where possible.
        const exists = await Wallet.findOne(
          { userId: fromUserId },
          null,
          { session }
        );
        if (!exists) {
          throw new MoneyError(404, "Sender wallet not found");
        }
        throw new MoneyError(400, "Insufficient balance");
      }

      // Credit the receiver's wallet.
      const receiverWallet = await Wallet.findOneAndUpdate(
        { userId: toUserId },
        { $inc: { balance: amount } },
        { session, new: true }
      );

      if (!receiverWallet) {
        throw new MoneyError(404, "Receiver wallet not found");
      }

      const senderBalance = senderWallet.balance;
      const receiverBalance = receiverWallet.balance;

      // Create the TRANSFER transaction record.
      const [txn] = await Transaction.create(
        [
          {
            type: "TRANSFER",
            fromUserId,
            toUserId,
            amount,
            note,
            status: "COMPLETED",
          },
        ],
        { session }
      );

      // Create DEBIT entry for the sender.
      const [debitEntry] = await LedgerEntry.create(
        [
          {
            userId: fromUserId,
            transactionId: txn._id,
            direction: "DEBIT",
            amount,
            balanceAfter: senderBalance,
          },
        ],
        { session }
      );

      // Create CREDIT entry for the receiver.
      const [creditEntry] = await LedgerEntry.create(
        [
          {
            userId: toUserId,
            transactionId: txn._id,
            direction: "CREDIT",
            amount,
            balanceAfter: receiverBalance,
          },
        ],
        { session }
      );

      result = {
        transaction: txn,
        debitEntry,
        creditEntry,
        senderBalance,
        receiverBalance,
      };
    });
  } finally {
    await session.endSession();
  }

  return result;
}

// ---------------------------------------------------------------------------
// Credit Top-Up (Day 4 - Atomic Razorpay Wallet Credit)
// ---------------------------------------------------------------------------

/**
 * Atomically credits a wallet following verified Razorpay payment.
 * Shared between Checkout signature verification and Webhook processing.
 *
 * Invariant & Idempotency Rules:
 * 1. Atomically claims order: CREATED (or EXPIRED) -> PAID.
 * 2. If already PAID, returns { alreadyCredited: true, balance } without moving money.
 * 3. Uses amount on the trusted local PaymentOrder, never client input.
 * 4. Creates exactly one TOPUP transaction.
 * 5. Creates exactly one CREDIT ledger entry.
 * 6. Stores transactionId on the PaymentOrder.
 * 7. All operations commit or roll back together inside one MongoDB transaction.
 *
 * @param {object} params
 * @param {string|ObjectId} params.orderId - PaymentOrder _id or gatewayOrderId
 * @param {string} params.paymentId - Gateway payment ID (e.g. "pay_...")
 * @param {string} params.paidVia - "CALLBACK" | "WEBHOOK"
 * @param {number} [params.expectedAmount] - Optional verification of captured amount
 * @param {string} [params.expectedCurrency] - Optional verification of currency ("INR")
 * @returns {Promise<{ alreadyCredited: boolean, balance: number, transaction: object, ledgerEntry: object, order: object }>}
 */
export async function creditTopUp({
  orderId,
  paymentId,
  paidVia,
  expectedAmount,
  expectedCurrency = "INR",
}) {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      // 1. Fetch current PaymentOrder within transaction
      const orderQuery = mongoose.isValidObjectId(orderId)
        ? { _id: orderId }
        : { gatewayOrderId: orderId };

      const order = await PaymentOrder.findOne(orderQuery).session(session);

      if (!order) {
        throw new MoneyError(404, "Payment order not found");
      }

      // Check amount / currency match if passed
      if (expectedAmount !== undefined && order.amount !== expectedAmount) {
        throw new MoneyError(400, "Payment amount mismatch");
      }
      if (expectedCurrency !== undefined && order.currency !== expectedCurrency) {
        throw new MoneyError(400, "Payment currency mismatch");
      }

      // If already marked PAID, return idempotent result without moving money
      if (order.status === "PAID") {
        const wallet = await Wallet.findOne({ userId: order.userId }).session(session);
        result = {
          alreadyCredited: true,
          balance: wallet ? wallet.balance : 0,
          order,
          transaction: null,
          ledgerEntry: null,
        };
        return;
      }

      // 2. Atomically claim order: transition CREATED or EXPIRED -> PAID
      const claimedOrder = await PaymentOrder.findOneAndUpdate(
        {
          _id: order._id,
          status: { $in: ["CREATED", "EXPIRED"] },
        },
        {
          $set: {
            status: "PAID",
            gatewayPaymentId: paymentId,
            paidVia,
          },
        },
        { session, new: true }
      );

      if (!claimedOrder) {
        // Another concurrent request claimed it; fetch latest wallet balance
        const wallet = await Wallet.findOne({ userId: order.userId }).session(session);
        result = {
          alreadyCredited: true,
          balance: wallet ? wallet.balance : 0,
          order,
          transaction: null,
          ledgerEntry: null,
        };
        return;
      }

      const creditAmount = claimedOrder.amount;
      const targetUserId = claimedOrder.userId;

      // 3. Atomically credit the wallet
      const wallet = await Wallet.findOneAndUpdate(
        { userId: targetUserId },
        { $inc: { balance: creditAmount } },
        { session, new: true }
      );

      if (!wallet) {
        throw new MoneyError(404, "Wallet not found for payment order");
      }

      const newBalance = wallet.balance;

      // 4. Create one TOPUP transaction record
      const [txn] = await Transaction.create(
        [
          {
            type: "TOPUP",
            fromUserId: null,
            toUserId: targetUserId,
            amount: creditAmount,
            note: `Razorpay top-up (${paymentId})`,
            status: "COMPLETED",
          },
        ],
        { session }
      );

      // 5. Create one CREDIT ledger entry
      const [ledgerEntry] = await LedgerEntry.create(
        [
          {
            userId: targetUserId,
            transactionId: txn._id,
            direction: "CREDIT",
            amount: creditAmount,
            balanceAfter: newBalance,
          },
        ],
        { session }
      );

      // 6. Link transaction reference back to PaymentOrder
      claimedOrder.transactionId = txn._id;
      await claimedOrder.save({ session });

      result = {
        alreadyCredited: false,
        balance: newBalance,
        transaction: txn,
        ledgerEntry,
        order: claimedOrder,
      };
    });
  } finally {
    await session.endSession();
  }

  return result;
}

// ---------------------------------------------------------------------------
// Day 5: Bank Withdrawal & Reversal Operations
// ---------------------------------------------------------------------------

/**
 * Computes a stable hash of withdrawal inputs for idempotency deduplication.
 *
 * @param {{ bankAccountId: string, amount: number }} params
 * @returns {string} hex SHA-256
 */
export function hashWithdrawRequest({ bankAccountId, amount }) {
  const payload = JSON.stringify({
    bankAccountId: String(bankAccountId),
    amount: Number(amount),
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * Executes a withdrawal request atomically:
 * 1. Atomically holds the money (debited only if sufficient balance).
 * 2. Creates the Withdrawal document in PENDING state with unique reference.
 * 3. Creates the Transaction document (type: "WITHDRAWAL").
 * 4. Creates the DEBIT LedgerEntry recording the balance after hold.
 * 5. Creates the OutboxEvent (type: "PAYOUT_REQUESTED", status: "NEW") for the worker.
 *
 * @param {{ userId: string|ObjectId, bankAccountId: string|ObjectId, amount: number }} params
 * @returns {Promise<{ withdrawal: Object, transaction: Object, ledgerEntry: Object, outboxEvent: Object, newBalance: number }>}
 */
export async function requestWithdrawal({ userId, bankAccountId, amount }) {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      // 0. Daily limit check: add amount only if it still fits within limit
      await checkAndConsumeDailyLimit(userId, amount, session);

      // 1. Hold money from wallet atomically only if balance is sufficient
      const wallet = await Wallet.findOneAndUpdate(
        { userId, balance: { $gte: amount } },
        { $inc: { balance: -amount } },
        { session, new: true }
      );

      if (!wallet) {
        // Inspect whether wallet is missing or balance is insufficient
        const existingWallet = await Wallet.findOne({ userId }).session(session);
        if (!existingWallet) {
          throw new MoneyError(404, "Wallet not found");
        }
        throw new MoneyError(400, "Insufficient balance");
      }

      const newBalance = wallet.balance;
      const withdrawalId = new mongoose.Types.ObjectId();
      const reference = `wd_${withdrawalId.toString()}`;

      // 2. Create Withdrawal record in PENDING status
      const [withdrawal] = await Withdrawal.create(
        [
          {
            _id: withdrawalId,
            userId,
            bankAccountId,
            amount,
            reference,
            status: "PENDING",
          },
        ],
        { session }
      );

      // 3. Create WITHDRAWAL Transaction header
      const [txn] = await Transaction.create(
        [
          {
            type: "WITHDRAWAL",
            fromUserId: userId,
            toUserId: null,
            amount,
            note: "Withdrawal to bank",
            status: "COMPLETED",
          },
        ],
        { session }
      );

      // 4. Create DEBIT LedgerEntry
      const [ledgerEntry] = await LedgerEntry.create(
        [
          {
            userId,
            transactionId: txn._id,
            direction: "DEBIT",
            amount,
            balanceAfter: newBalance,
          },
        ],
        { session }
      );

      // 5. Create durable OutboxEvent in the same database transaction
      const [outboxEvent] = await OutboxEvent.create(
        [
          {
            type: "PAYOUT_REQUESTED",
            withdrawalId: withdrawal._id,
            status: "NEW",
            attempts: 0,
            nextAttemptAt: new Date(),
          },
        ],
        { session }
      );

      result = {
        withdrawal,
        transaction: txn,
        ledgerEntry,
        outboxEvent,
        newBalance,
      };
    });
  } finally {
    await session.endSession();
  }

  return result;
}

/**
 * Compensating transaction when a withdrawal is definitively rejected by the bank.
 * Atomically:
 * 1. Claims status REVERSED only if PENDING, PROCESSING, or NEEDS_REVIEW (idempotent, single execution).
 * 2. Restores the balance back to the user's wallet.
 * 3. Records a REVERSAL Transaction header.
 * 4. Records a compensating CREDIT LedgerEntry.
 *
 * @param {{ withdrawalId: string|ObjectId, reason: string }} params
 * @returns {Promise<{ alreadyReversed: boolean, withdrawal: Object, transaction?: Object, ledgerEntry?: Object, newBalance?: number }>}
 */
export async function reverseWithdrawal({ withdrawalId, reason }) {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      // 1. Conditional status claim: only if PENDING, PROCESSING, or NEEDS_REVIEW
      const withdrawal = await Withdrawal.findOneAndUpdate(
        {
          _id: withdrawalId,
          status: { $in: ["PENDING", "PROCESSING", "NEEDS_REVIEW"] },
        },
        {
          $set: {
            status: "REVERSED",
            failureReason: reason || "Bank payout rejected",
          },
        },
        { session, new: true }
      );

      if (!withdrawal) {
        // Already in terminal state (SUCCESS, REVERSED) - do not reverse again
        const existing = await Withdrawal.findById(withdrawalId).session(session);
        result = {
          alreadyReversed: true,
          withdrawal: existing,
        };
        return;
      }

      // 2. Add the money back to the user's wallet
      const wallet = await Wallet.findOneAndUpdate(
        { userId: withdrawal.userId },
        { $inc: { balance: withdrawal.amount } },
        { session, new: true }
      );

      if (!wallet) {
        throw new MoneyError(404, "Wallet not found for withdrawal reversal");
      }

      const newBalance = wallet.balance;

      // 3. Create REVERSAL Transaction record
      const [txn] = await Transaction.create(
        [
          {
            type: "REVERSAL",
            fromUserId: null,
            toUserId: withdrawal.userId,
            amount: withdrawal.amount,
            note: "Refund of failed withdrawal",
            status: "COMPLETED",
          },
        ],
        { session }
      );

      // 4. Create compensating CREDIT LedgerEntry
      const [ledgerEntry] = await LedgerEntry.create(
        [
          {
            userId: withdrawal.userId,
            transactionId: txn._id,
            direction: "CREDIT",
            amount: withdrawal.amount,
            balanceAfter: newBalance,
          },
        ],
        { session }
      );

      result = {
        alreadyReversed: false,
        withdrawal,
        transaction: txn,
        ledgerEntry,
        newBalance,
      };
    });
  } finally {
    await session.endSession();
  }

  return result;
}


