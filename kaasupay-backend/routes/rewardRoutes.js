import express from "express";
import { getMyRewards, claimReward, getActiveOffers } from "../controllers/rewardController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

// GET /api/v1/rewards — fetch user's cards
router.get("/", requireAuth, getMyRewards);

// GET /api/v1/rewards/active-offers — fetch current active promotions
router.get("/active-offers", requireAuth, getActiveOffers);

// POST /api/v1/rewards/:id/claim — scratch and claim card
router.post("/:id/claim", requireAuth, claimReward);

export default router;
