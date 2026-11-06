import mongoose from "mongoose";
import RewardCard from "../models/RewardCard.js";
import Offer from "../models/Offer.js";
import { claimRewardCard, PromoError } from "../services/promoService.js";

/**
 * GET /api/v1/rewards
 * Returns all cards for the authenticated user, sorted newest first.
 * Lazy-expires outdated cards and obfuscates reward amounts for UNCLAIMED cards.
 */
export async function getMyRewards(req, res) {
  try {
    const now = new Date();

    // Lazy expiration: mark overdue unclaimed cards as EXPIRED in one atomic update
    await RewardCard.updateMany(
      {
        userId: req.userId,
        status: "UNCLAIMED",
        expiresAt: { $lte: now },
      },
      {
        $set: { status: "EXPIRED" },
      }
    );

    const cards = await RewardCard.find({ userId: req.userId })
      .populate("offerId", "code percent maxCashback minPayment")
      .sort({ createdAt: -1 });

    const formattedCards = cards.map((card) => {
      const offerCode = card.offerId?.code || "FESTIVAL";
      const isUnclaimed = card.status === "UNCLAIMED";
      const isExpired = card.status === "EXPIRED";

      return {
        id: card._id.toString(),
        _id: card._id.toString(),
        offer: offerCode,
        offerCode,
        amount: isUnclaimed || isExpired ? null : card.amount,
        status: card.status,
        expiresAt: card.expiresAt.toISOString(),
        createdAt: card.createdAt.toISOString(),
        claimedAt: card.claimedAt ? card.claimedAt.toISOString() : null,
      };
    });

    return res.status(200).json({ cards: formattedCards });
  } catch (err) {
    console.error("Unexpected error in getMyRewards:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * POST /api/v1/rewards/:id/claim
 * Atomically scratches and claims a reward card.
 */
export async function claimReward(req, res) {
  const { id } = req.params;

  try {
    const claimResult = await claimRewardCard({
      cardId: id,
      userId: req.userId,
    });

    return res.status(200).json(claimResult);
  } catch (err) {
    if (err instanceof PromoError) {
      return res.status(err.status).json({ message: err.message, error: err.message });
    }
    console.error("Unexpected error in claimReward:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * GET /api/v1/rewards/active-offers
 * Public/authenticated view of active festival promotions for the frontend banner.
 */
export async function getActiveOffers(req, res) {
  try {
    const now = new Date();
    const activeOffers = await Offer.find({
      isActive: true,
      startsAt: { $lte: now },
      endsAt: { $gt: now },
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      offers: activeOffers.map((o) => ({
        id: o._id.toString(),
        code: o.code,
        percent: o.percent,
        maxCashback: o.maxCashback,
        minPayment: o.minPayment,
        budget: o.budget,
        budgetLeft: o.budgetLeft,
        startsAt: o.startsAt.toISOString(),
        endsAt: o.endsAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("Unexpected error in getActiveOffers:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
