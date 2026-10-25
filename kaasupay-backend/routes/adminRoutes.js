import express from "express";
import {
  adminDeposit,
  adminReconcile,
  getAdminWithdrawals,
  adminUnlockPin,
} from "../controllers/adminController.js";

const router = express.Router();

// POST /api/v1/admin/deposit — credit a user's wallet (staff only).
router.post("/deposit", adminDeposit);

// GET /api/v1/admin/reconcile — system financial health report (staff only).
router.get("/reconcile", adminReconcile);

// GET /api/v1/admin/withdrawals — withdrawals requiring staff review (staff only).
router.get("/withdrawals", getAdminWithdrawals);

// POST /api/v1/admin/users/:id/unlock-pin — staff-only PIN unlock.
router.post("/users/:id/unlock-pin", adminUnlockPin);

export default router;
