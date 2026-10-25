// validations/paymentValidation.js — Zod validation schemas for Day 4 payment operations.
import { z } from "zod";

/**
 * Validates request payload for creating a Razorpay top-up order:
 * POST /api/v1/wallet/add-money/order
 *
 * Rules:
 * - amount must be an integer in paise
 * - Minimum: 1,000 paise (₹10.00)
 * - Maximum: 1,000,000 paise (₹10,000.00)
 * - Strict: extra/unexpected fields are rejected
 */
export const createOrderSchema = z
  .object({
    amount: z
      .number({ error: "amount must be a number" })
      .int({ error: "amount must be an integer (paise)" })
      .min(1000, { error: "amount must be at least 1000 paise (₹10.00)" })
      .max(1_000_000, { error: "amount must be at most 1000000 paise (₹10,000.00)" }),
  })
  .strict();

/**
 * Validates request payload for verifying a Razorpay checkout payment:
 * POST /api/v1/wallet/add-money/verify
 */
export const verifyPaymentSchema = z
  .object({
    razorpay_order_id: z
      .string({ error: "razorpay_order_id is required" })
      .trim()
      .min(1, { error: "razorpay_order_id cannot be empty" }),
    razorpay_payment_id: z
      .string({ error: "razorpay_payment_id is required" })
      .trim()
      .min(1, { error: "razorpay_payment_id cannot be empty" }),
    razorpay_signature: z
      .string({ error: "razorpay_signature is required" })
      .trim()
      .min(1, { error: "razorpay_signature cannot be empty" }),
  })
  .strict();

