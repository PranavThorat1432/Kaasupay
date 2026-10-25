// controllers/paymentController.js — Day 4 Razorpay payment coordination.
// Coordinates order creation and order status inspection.
// Wallet financial accounting lives in services/money.js.

import mongoose from "mongoose";
import PaymentOrder from "../models/paymentOrderModel.js";
import Wallet from "../models/walletModel.js";
import { createOrderSchema, verifyPaymentSchema } from "../validations/paymentValidation.js";
import { createGatewayOrder, verifyCheckoutSignature, fetchPayment } from "../services/razorpayService.js";
import { creditTopUp, MoneyError } from "../services/money.js";
import { RAZORPAY_KEY_ID } from "../config.js";

/**
 * POST /api/v1/wallet/add-money/order
 * Creates a Razorpay gateway order and persists the local PaymentOrder in CREATED state.
 */
export const createAddMoneyOrder = async (req, res) => {
  try {
    // 1. Authentication guard
    if (!mongoose.isValidObjectId(req.userId)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // 2. Validate payload: integer paise, bounds ₹10 (1000) to ₹10,000 (1000000), strict
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input" });
    }

    const { amount } = parsed.data;
    const userId = req.userId;

    // 3. Create order on the Razorpay gateway first
    let gatewayOrder;
    try {
      gatewayOrder = await createGatewayOrder({ amount, currency: "INR" });
    } catch (gwErr) {
      console.error("Payment gateway order creation failed:", gwErr.message);
      return res.status(gwErr.status || 502).json({ error: "Payment gateway error" });
    }

    // 4. Persist the local PaymentOrder record
    try {
      await PaymentOrder.create({
        userId,
        gatewayOrderId: gatewayOrder.id,
        amount,
        currency: "INR",
        status: "CREATED",
      });
    } catch (dbErr) {
      console.error("CRITICAL: Failed to persist local PaymentOrder for gateway order:", gatewayOrder.id, dbErr.message);
      // Gateway order was created, but local tracking failed (orphan order).
      return res.status(500).json({ error: "Failed to persist payment order" });
    }

    // 5. Return checkout details with public keyId only (never secrets)
    return res.status(201).json({
      orderId: gatewayOrder.id,
      amount: gatewayOrder.amount,
      currency: gatewayOrder.currency,
      keyId: RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error("Unexpected error in createAddMoneyOrder:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * GET /api/v1/wallet/add-money/orders/:orderId
 * Fetches order status for the authenticated owner only.
 * Returns 404 for unknown orders or orders belonging to another user.
 */
export const getAddMoneyOrderStatus = async (req, res) => {
  try {
    // 1. Authentication guard
    if (!mongoose.isValidObjectId(req.userId)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { orderId } = req.params;
    if (!orderId || typeof orderId !== "string") {
      return res.status(400).json({ error: "Invalid order ID" });
    }

    // 2. Fetch order scoped to BOTH gatewayOrderId and req.userId
    const order = await PaymentOrder.findOne({
      gatewayOrderId: orderId,
      userId: req.userId,
    });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // 3. Return status without exposing internal sensitive details
    return res.status(200).json({
      orderId: order.gatewayOrderId,
      amount: order.amount,
      status: order.status,
      paidVia: order.paidVia,
    });
  } catch (error) {
    console.error("Unexpected error in getAddMoneyOrderStatus:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * POST /api/v1/wallet/add-money/verify
 * Verifies Razorpay checkout signature, confirms payment capture, and credits wallet atomically.
 */
export const verifyAddMoneyPayment = async (req, res) => {
  try {
    // 1. Authentication guard
    if (!mongoose.isValidObjectId(req.userId)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // 2. Validate request body
    const parsed = verifyPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input" });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;

    // 3. Verify checkout signature using timingSafeEqual
    const isValidSignature = verifyCheckoutSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });

    if (!isValidSignature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // 4. Find the local payment order scoped to gatewayOrderId
    const order = await PaymentOrder.findOne({ gatewayOrderId: razorpay_order_id });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Ensure order belongs to authenticated user (no cross-user verification)
    if (order.userId.toString() !== req.userId) {
      return res.status(404).json({ error: "Order not found" });
    }

    // 5. If already paid, check if it's the exact same payment ID (idempotent replay)
    if (order.status === "PAID") {
      if (order.gatewayPaymentId === razorpay_payment_id) {
        const wallet = await Wallet.findOne({ userId: req.userId });
        return res.status(200).json({
          message: "Already added",
          orderId: order.gatewayOrderId,
          amount: order.amount,
          balance: wallet ? wallet.balance : 0,
        });
      }
      return res.status(400).json({ error: "Order already paid with different payment" });
    }

    // 6. Confirm payment corresponds to order and is captured via gateway
    let paymentDetails;
    try {
      paymentDetails = await fetchPayment(razorpay_payment_id);
    } catch (fetchErr) {
      console.error("Gateway fetch failed during verify:", fetchErr.message);
      return res.status(fetchErr.status || 502).json({ error: "Failed to verify payment with gateway" });
    }

    if (!paymentDetails || paymentDetails.status !== "captured") {
      return res.status(400).json({ error: "Payment is not captured" });
    }

    if (paymentDetails.order_id !== order.gatewayOrderId) {
      return res.status(400).json({ error: "Payment order mismatch" });
    }

    if (
      paymentDetails.amount !== order.amount ||
      (paymentDetails.currency && paymentDetails.currency !== order.currency)
    ) {
      return res.status(400).json({ error: "Payment amount or currency mismatch" });
    }

    // 7. Atomic wallet credit via creditTopUp service
    const topUpResult = await creditTopUp({
      orderId: order._id,
      paymentId: razorpay_payment_id,
      paidVia: "CALLBACK",
      expectedAmount: order.amount,
      expectedCurrency: order.currency,
    });

    if (topUpResult.alreadyCredited) {
      return res.status(200).json({
        message: "Already added",
        orderId: order.gatewayOrderId,
        amount: order.amount,
        balance: topUpResult.balance,
      });
    }

    return res.status(200).json({
      message: "Money added",
      orderId: order.gatewayOrderId,
      amount: order.amount,
      balance: topUpResult.balance,
    });
  } catch (error) {
    if (error instanceof MoneyError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("Unexpected error in verifyAddMoneyPayment:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

