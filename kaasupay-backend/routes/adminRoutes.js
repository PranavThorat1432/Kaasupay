import express from "express";
import {
  adminDeposit,
  adminReconcile,
  getAdminWithdrawals,
  adminUnlockPin,
  resolveAdminWithdrawal,
  getAdminWithdrawalBankStatus,
} from "../controllers/adminController.js";

const router = express.Router();

// POST /api/v1/admin/deposit — credit a user's wallet (staff only).
router.post("/deposit", adminDeposit);

// GET /api/v1/admin/reconcile — system financial health report (staff only).
router.get("/reconcile", adminReconcile);

// GET /api/v1/admin/withdrawals — withdrawals requiring staff review (staff only).
router.get("/withdrawals", getAdminWithdrawals);

// GET /api/v1/admin/withdrawals/:id/bank-status — inspect bank record for withdrawal (staff only).
router.get("/withdrawals/:id/bank-status", getAdminWithdrawalBankStatus);

// POST /api/v1/admin/withdrawals/:id/resolve — resolve a withdrawal in NEEDS_REVIEW (staff only).
router.post("/withdrawals/:id/resolve", resolveAdminWithdrawal);

// POST /api/v1/admin/users/:id/unlock-pin — staff-only PIN unlock.
router.post("/users/:id/unlock-pin", adminUnlockPin);

export default router;
