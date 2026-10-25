// controllers/webhookController.js — Razorpay webhook event processing.
// Verifies raw request body signature with RAZORPAY_WEBHOOK_SECRET and idempotently credits wallets.

import PaymentOrder from "../models/paymentOrderModel.js";
import WebhookEvent from "../models/webhookEventModel.js";
import { verifyWebhookSignature } from "../services/razorpayService.js";
import { creditTopUp, MoneyError } from "../services/money.js";

/**
 * POST /api/v1/webhooks/razorpay
 * Receives webhook events from Razorpay without JWT authentication.
 * Verified strictly against raw body bytes.
 */
export const handleRazorpayWebhook = async (req, res) => {
  let eventId = null;
  let eventType = null;
  let gatewayOrderId = null;
  let gatewayPaymentId = null;

  try {
    const signature = req.headers["x-razorpay-signature"];
    if (!signature) {
      return res.status(400).json({ error: "Missing webhook signature" });
    }

    // Exact raw body bytes must be used for HMAC verification
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body));

    const isValidSignature = verifyWebhookSignature({ rawBody, signature });
    if (!isValidSignature) {
      return res.status(400).json({ error: "Invalid webhook signature" });
    }

    // Parse the verified JSON payload
    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }

    eventType = payload.event;
    eventId =
      req.headers["x-razorpay-event-id"] ||
      payload.event_id ||
      payload.id ||
      (payload.payload?.payment?.entity?.id ? `event_${payload.payload.payment.entity.id}` : null);

    // Check for duplicate webhook event delivery
    if (eventId) {
      const existingEvent = await WebhookEvent.findOne({ eventId });
      if (existingEvent && (existingEvent.status === "PROCESSED" || existingEvent.status === "IGNORED")) {
        return res.status(200).json({
          status: existingEvent.status === "PROCESSED" ? "already credited" : "ignored",
          duplicateEvent: true,
        });
      }
    }

    // Only payment.captured initiates a top-up
    if (eventType !== "payment.captured") {
      if (eventId) {
        try {
          await WebhookEvent.findOneAndUpdate(
            { eventId },
            {
              eventId,
              eventType: eventType || "unknown",
              status: "IGNORED",
              notes: `Ignored event: ${eventType}`,
            },
            { upsert: true }
          );
        } catch {
          // Ignore duplicate insert race
        }
      }
      return res.status(200).json({ status: "ignored", event: eventType });
    }

    const payment = payload.payload?.payment?.entity;
    if (!payment || !payment.order_id) {
      return res.status(200).json({ status: "ignored: no order id" });
    }

    gatewayOrderId = payment.order_id;
    gatewayPaymentId = payment.id;
    const paymentAmount = payment.amount;
    const paymentCurrency = payment.currency || "INR";
    const paymentStatus = payment.status;

    // Find the corresponding local payment order
    const order = await PaymentOrder.findOne({ gatewayOrderId });
    if (!order) {
      if (eventId) {
        try {
          await WebhookEvent.findOneAndUpdate(
            { eventId },
            {
              eventId,
              eventType,
              status: "IGNORED",
              gatewayOrderId,
              gatewayPaymentId,
              notes: "Unknown order",
            },
            { upsert: true }
          );
        } catch {
          // Ignore
        }
      }
      return res.status(200).json({ status: "ignored: unknown order" });
    }

    // Validate amount, currency, and capture status against local trusted record
    if (paymentStatus !== "captured") {
      return res.status(200).json({ status: "ignored: payment not captured" });
    }

    if (paymentAmount !== order.amount) {
      if (eventId) {
        try {
          await WebhookEvent.findOneAndUpdate(
            { eventId },
            {
              eventId,
              eventType,
              status: "FLAGGED",
              gatewayOrderId,
              gatewayPaymentId,
              notes: `Amount mismatch: gateway=${paymentAmount}, order=${order.amount}`,
            },
            { upsert: true }
          );
        } catch {
          // Ignore
        }
      }
      return res.status(200).json({ status: "flagged: amount mismatch" });
    }

    if (paymentCurrency !== order.currency) {
      if (eventId) {
        try {
          await WebhookEvent.findOneAndUpdate(
            { eventId },
            {
              eventId,
              eventType,
              status: "FLAGGED",
              gatewayOrderId,
              gatewayPaymentId,
              notes: `Currency mismatch: gateway=${paymentCurrency}, order=${order.currency}`,
            },
            { upsert: true }
          );
        } catch {
          // Ignore
        }
      }
      return res.status(200).json({ status: "flagged: currency mismatch" });
    }

    // Atomic top-up execution
    const topUpResult = await creditTopUp({
      orderId: order._id,
      paymentId: gatewayPaymentId,
      paidVia: "WEBHOOK",
      expectedAmount: order.amount,
      expectedCurrency: order.currency,
    });

    // Record the webhook event after successful database transaction
    if (eventId) {
      try {
        await WebhookEvent.findOneAndUpdate(
          { eventId },
          {
            eventId,
            eventType,
            status: "PROCESSED",
            gatewayOrderId,
            gatewayPaymentId,
          },
          { upsert: true }
        );
      } catch {
        // Handled safely
      }
    }

    if (topUpResult.alreadyCredited) {
      return res.status(200).json({ status: "already credited" });
    }

    return res.status(200).json({ status: "credited" });
  } catch (error) {
    if (eventId) {
      try {
        await WebhookEvent.findOneAndUpdate(
          { eventId },
          {
            eventId,
            eventType: eventType || "unknown",
            status: "FAILED",
            gatewayOrderId,
            gatewayPaymentId,
            notes: error.message,
          },
          { upsert: true }
        );
      } catch {
        // Handled safely
      }
    }

    if (error instanceof MoneyError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("Unexpected error in handleRazorpayWebhook:", error.message || error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
