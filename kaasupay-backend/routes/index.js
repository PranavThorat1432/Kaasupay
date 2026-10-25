import express from "express";
import userRoutes from "./userRoutes.js";
import walletRoutes from "./walletRoutes.js";
import adminRoutes from "./adminRoutes.js";
import webhookRoutes from "./webhookRoutes.js";
import withdrawalRoutes from "./withdrawals.js";

const router = express.Router();

// All user-related endpoints live under /user
// (mounted at /api/v1/user by index.js).
router.use("/user", userRoutes);

// All wallet-related endpoints live under /wallet
// (mounted at /api/v1/wallet by index.js).
router.use("/wallet", walletRoutes);

// Direct alias for withdrawals (mounted at /api/v1/withdrawals)
router.use("/withdrawals", withdrawalRoutes);

// All staff-only admin endpoints live under /admin
// (mounted at /api/v1/admin by index.js).
router.use("/admin", adminRoutes);

// External webhook endpoints live under /webhooks
// (mounted at /api/v1/webhooks by index.js).
router.use("/webhooks", webhookRoutes);

export default router;
