import express from "express";
import { getMyRewards, claimReward, getActiveOffers } from "../controllers/rewardController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

// GET /api/v1/rewards/active-offers — fetch current active promotions (public)
router.get("/active-offers", getActiveOffers);

// GET /api/v1/rewards — fetch user's cards
router.get("/", requireAuth, getMyRewards);

// POST /api/v1/rewards/:id/claim — scratch and claim card
router.post("/:id/claim", requireAuth, claimReward);

export default router;

