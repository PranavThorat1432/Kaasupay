import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import Wallet from "../models/walletModel.js";
import Transaction from "../models/transactionModel.js";
import LedgerEntry from "../models/ledgerEntryModel.js";
import Offer from "../models/Offer.js";
import RewardCard from "../models/RewardCard.js";
import RewardCount from "../models/RewardCount.js";
import { indiaDay } from "./dailyLimitService.js";
import { rupees } from "./csv.js";

export const PROMO_SYSTEM_EMAIL = "rewards@kaasupay.system";

/**
 * Custom error for promo operations with HTTP status codes.
 */
export class PromoError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "PromoError";
    this.status = status;
    this.statusCode = status;
  }
}

/**
 * Finds or provisions the KaasuPay Promo System User and linked Wallet.
 * Guaranteed to have an unguessable password hash and role SYSTEM_REWARD.
 *
 * @param {mongoose.ClientSession} [session]
 * @returns {Promise<{ promoUser: Object, promoWallet: Object }>}
 */
export async function getOrCreatePromoWallet(session = null) {
  let promoUser = await User.findOne({ username: PROMO_SYSTEM_EMAIL }).session(session);

  if (!promoUser) {
    // Generate 64-character cryptographically random unguessable password
    const unguessablePassword = crypto.randomBytes(32).toString("hex");
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(unguessablePassword, salt);

    try {
      const [createdUser] = await User.create(
        [
          {
            username: PROMO_SYSTEM_EMAIL,
            firstName: "KaasuPay",
            lastName: "Rewards",
            passwordHash,
            role: "SYSTEM_REWARD",
          },
        ],
        session ? { session } : {}
      );
      promoUser = createdUser;
    } catch (createErr) {
      if (createErr.code === 11000) {
        promoUser = await User.findOne({ username: PROMO_SYSTEM_EMAIL }).session(session);
      } else {
        throw createErr;
      }
    }
  }

  let promoWallet = await Wallet.findOne({ userId: promoUser._id }).session(session);

  if (!promoWallet) {
    try {
      const [createdWallet] = await Wallet.create(
        [
          {
            userId: promoUser._id,
            balance: 0,
          },
        ],
        session ? { session } : {}
      );
      promoWallet = createdWallet;
    } catch (wErr) {
      if (wErr.code === 11000) {
        promoWallet = await Wallet.findOne({ userId: promoUser._id }).session(session);
      } else {
        throw wErr;
      }
    }
  }

  return { promoUser, promoWallet };
}

/**
 * Creates an offer and atomically deposits its budget into the Promo System Wallet
 * with full double-entry ledger tracking.
 */
export async function createOfferWithDeposit({ code, percent, maxCashback, minPayment, budget, days }) {
  const normalizedCode = code.trim().toUpperCase();

  const session = await mongoose.startSession();
  try {
    let createdOffer = null;
    await session.withTransaction(async () => {
      // 1. Conflict check on code
      const existing = await Offer.findOne({ code: normalizedCode }).session(session);
      if (existing) {
        throw new PromoError(409, "Offer code already exists");
      }

      const startsAt = new Date();
      const endsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

      // 2. Create Offer document
      const [offer] = await Offer.create(
        [
          {
            code: normalizedCode,
            percent,
            maxCashback,
            minPayment,
            budget,
            budgetLeft: budget,
            startsAt,
            endsAt,
            isActive: true,
          },
        ],
        { session }
      );

      // 3. Obtain promo wallet
      const { promoUser, promoWallet } = await getOrCreatePromoWallet(session);

      // 4. Deposit budget into promo wallet atomically
      const updatedPromoWallet = await Wallet.findOneAndUpdate(
        { userId: promoUser._id },
        { $inc: { balance: budget } },
        { session, returnDocument: "after" }
      );

      // 5. Create DEPOSIT Transaction
      const [depositTxn] = await Transaction.create(
        [
          {
            type: "DEPOSIT",
            fromUserId: null,
            toUserId: promoUser._id,
            amount: budget,
            note: `Budget deposit for offer ${normalizedCode}`,
            status: "COMPLETED",
          },
        ],
        { session }
      );

      // 6. Create CREDIT LedgerEntry
      await LedgerEntry.create(
        [
          {
            userId: promoUser._id,
            transactionId: depositTxn._id,
            direction: "CREDIT",
            type: "DEPOSIT",
            amount: budget,
            balanceAfter: updatedPromoWallet.balance,
          },
        ],
        { session }
      );

      createdOffer = offer;
    });

    return createdOffer;
  } finally {
    await session.endSession();
  }
}

/**
 * Checks all eligibility rules and issues a reward scratch card if eligible.
 * Designed to run INSIDE the money payment's existing session.
 *
 * Transaction Safety & Concurrency Rules (Phase 1):
 * - Checks existing card by transactionId first as an idempotency optimization.
 * - Expected business ineligibility conditions cleanly return null.
 * - Technical database and transaction errors propagate to the caller to prevent aborted-session corruption.
 * - Caller session is propagated across all queries and mutations.
 * - Authoritative duplicate prevention remains the unique index on transactionId.
 */
export async function issueRewardCardIfEligible({ payerId, recipientId, paymentAmount, transactionId, session }) {
  // Idempotency optimization: if a card already exists for this payment transaction, return it.
  // Note: This optimization prevents redundant checks and duplicate inserts on retried calls,
  // but the unique index on transactionId remains the authoritative duplicate-prevention lock.
  if (transactionId) {
    const existingCard = await RewardCard.findOne({ transactionId }).session(session);
    if (existingCard) {
      return existingCard;
    }
  }

  const now = new Date();

  // 1. Active Offer Check (Expected ineligibility -> return null)
  const offer = await Offer.findOne({
    isActive: true,
    startsAt: { $lte: now },
    endsAt: { $gt: now },
  })
    .sort({ createdAt: -1 })
    .session(session);

  if (!offer) {
    return null;
  }

  // 2. Minimum Payment Check (Expected ineligibility -> return null)
  if (paymentAmount < offer.minPayment) {
    return null;
  }

  // 3. Anti-Ping-Pong Check (Level 4 Rule 2) (Expected ineligibility -> return null)
  // No card if recipient sent a TRANSFER to payer in the last 24 hours
  const recentPingPong = await Transaction.findOne({
    fromUserId: recipientId,
    toUserId: payerId,
    type: "TRANSFER",
    status: "COMPLETED",
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  }).session(session);

  if (recentPingPong) {
    return null;
  }

  // 4. Daily Cap Check (Level 4 Rule 1)
  // At most 3 cards per payer per India day.
  // Concurrency-safe atomic reservation via pipeline update with upsert in one step:
  // - If doc does not exist, it inserts with cards: 1 (returning null for 'before')
  // - If doc exists and cards < 3, it increments cards by 1 (returning doc with cards < 3)
  // - If doc exists and cards >= 3, it leaves cards unchanged (returning doc with cards >= 3)
  const todayIST = indiaDay();

  let beforeDoc;
  try {
    beforeDoc = await RewardCount.findOneAndUpdate(
      { userId: payerId, day: todayIST },
      [
        {
          $set: {
            cards: {
              $cond: {
                if: { $lt: [{ $ifNull: ["$cards", 0] }, 3] },
                then: { $add: [{ $ifNull: ["$cards", 0] }, 1] },
                else: "$cards",
              },
            },
            updatedAt: "$$NOW",
            createdAt: { $ifNull: ["$createdAt", "$$NOW"] },
          },
        },
      ],
      {
        upsert: true,
        returnDocument: "before",
        session,
        updatePipeline: true,
      }
    );
  } catch (err) {
    // If running outside a transaction session and hit a rare first-creation upsert race (E11000),
    // retry once against the newly inserted document.
    if (!session && err.code === 11000) {
      beforeDoc = await RewardCount.findOneAndUpdate(
        { userId: payerId, day: todayIST },
        [
          {
            $set: {
              cards: {
                $cond: {
                  if: { $lt: [{ $ifNull: ["$cards", 0] }, 3] },
                  then: { $add: [{ $ifNull: ["$cards", 0] }, 1] },
                  else: "$cards",
                },
              },
              updatedAt: "$$NOW",
            },
          },
        ],
        {
          returnDocument: "before",
          updatePipeline: true,
        }
      );
    } else {
      // Inside a session, or for unexpected errors, propagate immediately.
      // In MongoDB transactions, an error aborts the session; propagating allows
      // the transaction manager (session.withTransaction) to roll back and retry cleanly.
      throw err;
    }
  }

  if (beforeDoc && beforeDoc.cards >= 3) {
    return null; // Already reached the maximum 3 cards per India day
  }

  // 5. Reward Calculation: rawPaise = floor(paymentAmount * percent / 100)
  const rawPaise = Math.floor((paymentAmount * offer.percent) / 100);
  const reward = Math.max(1, Math.min(rawPaise, offer.maxCashback));

  // 6. Insert RewardCard (Unique index on transactionId enforces single card per payment)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  try {
    const [card] = await RewardCard.create(
      [
        {
          userId: payerId,
          offerId: offer._id,
          transactionId,
          amount: reward,
          status: "UNCLAIMED",
          expiresAt,
        },
      ],
      session ? { session } : {}
    );
    return card;
  } catch (createErr) {
    // If running outside a transaction session, compensate by releasing the reserved quota.
    // Inside a transaction session, session rollback automatically reverts the increment.
    if (!session) {
      try {
        await RewardCount.updateOne(
          { userId: payerId, day: todayIST, cards: { $gt: 0 } },
          { $inc: { cards: -1 } }
        );
      } catch (compErr) {
        console.error("[issueRewardCardIfEligible] Warning: compensation decrement failed:", compErr);
        createErr.compensationError = compErr;
      }
    }
    throw createErr;
  }
}

/**
 * Claims a scratch card atomically inside a single MongoDB transaction.
 */
export async function claimRewardCard({ cardId, userId }) {
  if (!mongoose.isValidObjectId(cardId)) {
    throw new PromoError(404, "Card not found");
  }

  const session = await mongoose.startSession();
  try {
    let result = null;
    await session.withTransaction(async () => {
      const now = new Date();

      // Step 1: Find Card
      const card = await RewardCard.findOne({ _id: cardId, userId }).session(session);
      if (!card) {
        throw new PromoError(404, "Card not found");
      }

      if (card.status === "CLAIMED") {
        throw new PromoError(409, "This card is already CLAIMED");
      }

      if (card.status === "EXHAUSTED") {
        throw new PromoError(409, "This card is already EXHAUSTED");
      }

      if (card.status === "EXPIRED" || card.expiresAt <= now) {
        if (card.status !== "EXPIRED") {
          card.status = "EXPIRED";
          await card.save({ session });
        }
        throw new PromoError(410, "This card has expired");
      }

      // Step 2: Atomic Budget Reservation
      const offer = await Offer.findOneAndUpdate(
        { _id: card.offerId, budgetLeft: { $gte: card.amount } },
        { $inc: { budgetLeft: -card.amount } },
        { session, returnDocument: "after" }
      );

      // Branch A: Budget Exhausted
      if (!offer) {
        card.status = "EXHAUSTED";
        card.claimedAt = now;
        await card.save({ session });

        result = {
          exhausted: true,
          message: "Better luck next time",
          amount: 0,
          status: "EXHAUSTED",
        };
        return;
      }

      // Branch B: Budget Succeeded
      const { promoUser, promoWallet } = await getOrCreatePromoWallet(session);

      // Debit Promo Wallet
      const updatedPromoWallet = await Wallet.findOneAndUpdate(
        { userId: promoUser._id, balance: { $gte: card.amount } },
        { $inc: { balance: -card.amount } },
        { session, returnDocument: "after" }
      );

      if (!updatedPromoWallet) {
        throw new PromoError(500, "Promo wallet has insufficient funds to honor budget");
      }

      // Credit User Wallet
      const updatedUserWallet = await Wallet.findOneAndUpdate(
        { userId },
        { $inc: { balance: card.amount } },
        { session, returnDocument: "after" }
      );

      if (!updatedUserWallet) {
        throw new PromoError(404, "User wallet not found");
      }

      // Create CASHBACK Transaction
      const [cashbackTx] = await Transaction.create(
        [
          {
            type: "CASHBACK",
            fromUserId: promoUser._id,
            toUserId: userId,
            amount: card.amount,
            note: `Cashback for offer ${offer.code}`,
            status: "COMPLETED",
          },
        ],
        { session }
      );

      // Ledger: DEBIT for Promo Wallet
      await LedgerEntry.create(
        [
          {
            userId: promoUser._id,
            transactionId: cashbackTx._id,
            direction: "DEBIT",
            type: "CASHBACK",
            amount: card.amount,
            balanceAfter: updatedPromoWallet.balance,
          },
        ],
        { session }
      );

      // Ledger: CREDIT for User Wallet
      await LedgerEntry.create(
        [
          {
            userId,
            transactionId: cashbackTx._id,
            direction: "CREDIT",
            type: "CASHBACK",
            amount: card.amount,
            balanceAfter: updatedUserWallet.balance,
          },
        ],
        { session }
      );

      // Mark Card CLAIMED
      card.status = "CLAIMED";
      card.claimedAt = now;
      card.cashbackTransactionId = cashbackTx._id;
      await card.save({ session });

      const rupeesWon = rupees(card.amount);

      result = {
        exhausted: false,
        message: `You won ₹${rupeesWon}`,
        amount: card.amount,
        balance: updatedUserWallet.balance,
        status: "CLAIMED",
      };
    });

    return result;
  } finally {
    await session.endSession();
  }
}

