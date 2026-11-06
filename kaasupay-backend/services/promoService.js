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
 * Never throws errors that would abort the caller's payment transaction.
 */
export async function issueRewardCardIfEligible({ payerId, recipientId, paymentAmount, transactionId, session }) {
  try {
    const now = new Date();

    // 1. Active Offer Check
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

    // 2. Minimum Payment Check
    if (paymentAmount < offer.minPayment) {
      return null;
    }

    // 3. Anti-Ping-Pong Check (Level 4 Rule 2)
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
    // At most 3 cards per payer per India day
    const todayIST = indiaDay();

    try {
      await RewardCount.updateOne(
        { userId: payerId, day: todayIST },
        { $setOnInsert: { cards: 0 } },
        { upsert: true, session }
      );
    } catch (err) {
      if (err.code !== 11000) throw err;
    }

    const countDoc = await RewardCount.findOneAndUpdate(
      { userId: payerId, day: todayIST, cards: { $lt: 3 } },
      { $inc: { cards: 1 } },
      { session, returnDocument: "after" }
    );

    if (!countDoc) {
      return null; // Already hit 3 cards today
    }

    // 5. Reward Calculation: rawPaise = floor(paymentAmount * percent / 100)
    const rawPaise = Math.floor((paymentAmount * offer.percent) / 100);
    const reward = Math.max(1, Math.min(rawPaise, offer.maxCashback));

    // 6. Insert RewardCard
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
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
      { session }
    );

    return card;
  } catch (err) {
    // A scratch card is a bonus; failure to create must never fail the underlying payment.
    console.error("[issueRewardCardIfEligible] Warning: card creation skipped due to error:", err);
    return null;
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
