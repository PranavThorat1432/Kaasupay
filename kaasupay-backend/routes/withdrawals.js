import express from "express";
import {
  withdraw,
  getWithdrawals,
  getWithdrawalById,
} from "../controllers/bankController.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { moneyRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// GET /api/v1/withdrawals — list last 20 withdrawals
router.get("/", requireAuth, getWithdrawals);

// POST /api/v1/withdrawals — initiate withdrawal (alias)
router.post("/", requireAuth, moneyRateLimiter, withdraw);

// GET /api/v1/withdrawals/:id — retrieve single withdrawal
router.get("/:id", requireAuth, getWithdrawalById);

export default router;
