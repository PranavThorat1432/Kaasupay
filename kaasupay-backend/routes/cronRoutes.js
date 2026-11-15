import express from "express";
import { handleAutopayCron } from "../controllers/cronController.js";

const router = express.Router();

// GET /api/v1/cron/autopay
// Protected by CRON_SECRET (does not use standard user authMiddleware)
router.get("/autopay", handleAutopayCron);

export default router;
