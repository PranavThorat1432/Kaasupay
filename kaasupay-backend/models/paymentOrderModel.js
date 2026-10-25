// PaymentOrder document — records intent and lifecycle of an external Razorpay payment.
// Tracks an order from creation through callback/webhook settlement or expiry.
import mongoose from "mongoose";

const paymentOrderSchema = new mongoose.Schema(
  {
    // The KaasuPay user who initiated the top-up.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
    },
    // The Razorpay order ID (e.g. "order_xyz123"). Unique identifier from gateway.
    gatewayOrderId: {
      type: String,
      required: [true, "gatewayOrderId is required"],
      unique: true,
      trim: true,
    },
    // Top-up amount in integer paise (₹10 = 1000 paise).
    amount: {
      type: Number,
      required: [true, "amount is required"],
      validate: {
        validator: (v) => Number.isInteger(v) && v > 0,
        message: "amount must be a positive integer (paise)",
      },
    },
    // Currency is strictly INR for this scope.
    currency: {
      type: String,
      enum: ["INR"],
      default: "INR",
      required: true,
    },
    // Order state machine:
    //   CREATED -> PAID (upon successful Checkout verification or webhook capture)
    //   CREATED -> EXPIRED (if timeout elapsed before payment)
    status: {
      type: String,
      enum: ["CREATED", "PAID", "EXPIRED"],
      default: "CREATED",
      required: true,
    },
    // Razorpay payment ID (e.g. "pay_xyz123") recorded when verified/captured.
    gatewayPaymentId: {
      type: String,
      default: null,
      trim: true,
    },
    // Source of payment confirmation.
    paidVia: {
      type: String,
      enum: ["CALLBACK", "WEBHOOK", null],
      default: null,
    },
    // Reference to the created TOPUP transaction once settled.
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },
  },
  { timestamps: true }
);

// Indexes supporting lookup, user-scoped queries, and order-expiry sweeping.
paymentOrderSchema.index({ userId: 1, createdAt: -1 });
paymentOrderSchema.index({ status: 1, createdAt: 1 });

export default mongoose.model("PaymentOrder", paymentOrderSchema);
