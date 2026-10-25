// routes/webhookRoutes.js — Webhook endpoints called directly by payment gateways.
// No JWT authentication.
import express from "express";
import { handleRazorpayWebhook } from "../controllers/webhookController.js";

const router = express.Router();

// POST /api/v1/webhooks/razorpay — raw bytes body parsed and signature verified
router.post("/razorpay", handleRazorpayWebhook);

export default router;
