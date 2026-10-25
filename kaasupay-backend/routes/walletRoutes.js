import express from "express";
import {
  getBalance,
  transferFunds,
  getTransactions,
  getLimits,
} from "../controllers/walletController.js";
import {
  createAddMoneyOrder,
  getAddMoneyOrderStatus,
  verifyAddMoneyPayment,
} from "../controllers/paymentController.js";
import {
  addBankAccount,
  getBankAccounts,
  withdraw,
  getWithdrawals,
  getWithdrawalById,
} from "../controllers/bankController.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { moneyRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// Protected wallet endpoints - only route definitions here.
router.get("/balance", requireAuth, getBalance);

// GET /api/v1/wallet/limits — daily spending limit status (Day 6).
router.get("/limits", requireAuth, getLimits);

// POST /api/v1/wallet/transfer — atomic idempotent transfer (Day 3, Level 2-4).
router.post("/transfer", requireAuth, moneyRateLimiter, transferFunds);

// GET /api/v1/wallet/transactions — paginated history (Day 3, Level 5).
router.get("/transactions", requireAuth, getTransactions);

// Day 4 Razorpay Add-Money Endpoints
// POST /api/v1/wallet/add-money/order — create Razorpay order and local PaymentOrder
router.post("/add-money/order", requireAuth, createAddMoneyOrder);

// GET /api/v1/wallet/add-money/orders/:orderId — inspect user's payment order status
router.get("/add-money/orders/:orderId", requireAuth, getAddMoneyOrderStatus);

// POST /api/v1/wallet/add-money/verify — verify checkout signature and atomically credit wallet
router.post("/add-money/verify", requireAuth, verifyAddMoneyPayment);

// Day 5 Bank Account Endpoints
// POST /api/v1/wallet/bank-accounts — save a bank account
router.post("/bank-accounts", requireAuth, addBankAccount);

// GET /api/v1/wallet/bank-accounts — list masked bank accounts
router.get("/bank-accounts", requireAuth, getBankAccounts);

// Day 5 Withdrawal Endpoints
// POST /api/v1/wallet/withdraw — request bank withdrawal (202 Accepted)
router.post("/withdraw", requireAuth, moneyRateLimiter, withdraw);

// GET /api/v1/wallet/withdrawals — list user's last 20 withdrawals
router.get("/withdrawals", requireAuth, getWithdrawals);

// GET /api/v1/wallet/withdrawals/:id — retrieve single withdrawal
router.get("/withdrawals/:id", requireAuth, getWithdrawalById);

export default router;
