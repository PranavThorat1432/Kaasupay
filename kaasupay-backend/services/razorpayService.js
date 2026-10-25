// services/razorpayService.js — Singleton Razorpay gateway client and crypto helpers.
// Handles communication with Razorpay and signature verifications.
// Financial wallet accounting logic is kept strictly separate in services/money.js.

import Razorpay from "razorpay";
import crypto from "node:crypto";
import {
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET,
  assertRazorpayConfigured,
  isRazorpayConfigured,
} from "../config.js";

let razorpayClient = null;

/**
 * Returns the singleton Razorpay instance.
 * Throws a clean 503 error if credentials are not configured.
 */
const mockOrders = new Map();

export function getRazorpayClient() {
  if (!razorpayClient) {
    if (process.env.MOCK_RAZORPAY === "true") {
      razorpayClient = {
        orders: {
          create: async (opts) => {
            if (opts.amount === 999999) {
              const err = new Error("Gateway connection timeout");
              err.error = { description: "Simulated gateway error" };
              throw err;
            }
            const orderId = `order_mock_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
            const orderObj = {
              id: orderId,
              entity: "order",
              amount: opts.amount,
              amount_paid: 0,
              amount_due: opts.amount,
              currency: opts.currency || "INR",
              receipt: opts.receipt,
              status: "created",
              attempts: 0,
              created_at: Math.floor(Date.now() / 1000),
            };
            mockOrders.set(orderId, orderObj);
            return orderObj;
          },
        },
        payments: {
          fetch: async (paymentId) => {
            // Check edge-case prefixes
            if (paymentId.startsWith("pay_unpaid") || paymentId.startsWith("pay_failed")) {
              return {
                id: paymentId,
                order_id: "order_mock_unpaid",
                amount: 50000,
                currency: "INR",
                status: "failed",
              };
            }
            if (paymentId.startsWith("pay_mismatch_order")) {
              return {
                id: paymentId,
                order_id: "order_different_999999",
                amount: 50000,
                currency: "INR",
                status: "captured",
              };
            }
            if (paymentId.startsWith("pay_mismatch_amount")) {
              const match = paymentId.match(/order_[a-zA-Z0-9_]+/);
              const orderId = match ? match[0] : "order_mock";
              return {
                id: paymentId,
                order_id: orderId,
                amount: 1000,
                currency: "INR",
                status: "captured",
              };
            }
            if (paymentId.startsWith("pay_mismatch_curr")) {
              const match = paymentId.match(/order_[a-zA-Z0-9_]+/);
              const orderId = match ? match[0] : "order_mock";
              return {
                id: paymentId,
                order_id: orderId,
                amount: 50000,
                currency: "USD",
                status: "captured",
              };
            }

            // Normal captured payment
            const match = paymentId.match(/order_[a-zA-Z0-9_]+/);
            const orderId = match ? match[0] : "order_mock";
            const stored = mockOrders.get(orderId);
            return {
              id: paymentId,
              order_id: orderId,
              amount: stored ? stored.amount : 50000,
              currency: stored ? stored.currency : "INR",
              status: "captured",
            };
          },
        },
      };
    } else {
      assertRazorpayConfigured();
      razorpayClient = new Razorpay({
        key_id: RAZORPAY_KEY_ID,
        key_secret: RAZORPAY_KEY_SECRET,
      });
    }
  }
  return razorpayClient;
}

/**
 * Allows injecting a mock client for testing without making network calls.
 */
export function setRazorpayClient(client) {
  razorpayClient = client;
}

/**
 * Generates a short, deterministic receipt identifier (<= 40 chars).
 */
export function generateReceipt() {
  const rand = crypto.randomBytes(4).toString("hex");
  return `kp_${Date.now()}_${rand}`.slice(0, 40);
}

/**
 * Creates a Razorpay gateway order.
 * @param {{ amount: number, currency?: string, receipt?: string }} options
 * @returns {Promise<object>} The Razorpay order object
 */
export async function createGatewayOrder({ amount, currency = "INR", receipt = null }) {
  const client = getRazorpayClient();
  const orderReceipt = receipt || generateReceipt();

  try {
    const order = await client.orders.create({
      amount,
      currency,
      receipt: orderReceipt,
    });
    return order;
  } catch (err) {
    console.error("Razorpay order creation failed:", err?.error?.description || err?.message || "Gateway Error");
    const error = new Error("Payment gateway order creation failed");
    error.status = 502;
    throw error;
  }
}

/**
 * Verifies the Razorpay Checkout payment signature using timingSafeEqual.
 * Signature format: HMAC-SHA256(order_id + "|" + payment_id, RAZORPAY_KEY_SECRET)
 *
 * @param {{ orderId: string, paymentId: string, signature: string }} params
 * @returns {boolean}
 */
export function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  assertRazorpayConfigured();
  if (!orderId || !paymentId || !signature) {
    return false;
  }

  const generatedSignature = crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const sigBuf = Buffer.from(signature, "utf8");
  const genBuf = Buffer.from(generatedSignature, "utf8");

  if (sigBuf.length !== genBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuf, genBuf);
}

/**
 * Verifies the Razorpay Webhook signature against raw body bytes using timingSafeEqual.
 *
 * @param {{ rawBody: Buffer|string, signature: string }} params
 * @returns {boolean}
 */
export function verifyWebhookSignature({ rawBody, signature }) {
  assertRazorpayConfigured();
  if (!rawBody || !signature) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  const sigBuf = Buffer.from(signature, "utf8");
  const expBuf = Buffer.from(expectedSignature, "utf8");

  if (sigBuf.length !== expBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Fetches payment details from Razorpay to verify captured status and order linkage.
 *
 * @param {string} paymentId
 * @returns {Promise<object>}
 */
export async function fetchPayment(paymentId) {
  const client = getRazorpayClient();
  try {
    const payment = await client.payments.fetch(paymentId);
    return payment;
  } catch (err) {
    console.error("Razorpay payment fetch failed:", err?.error?.description || err?.message || err);
    const error = new Error("Failed to verify payment with gateway");
    error.status = 502;
    throw error;
  }
}

