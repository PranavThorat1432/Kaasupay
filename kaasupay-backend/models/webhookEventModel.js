// models/webhookEventModel.js — Persists Razorpay webhook events for deduplication.
import mongoose from "mongoose";

const webhookEventSchema = new mongoose.Schema(
  {
    // Unique identifier assigned by Razorpay (from x-razorpay-event-id or payload id)
    eventId: {
      type: String,
      required: [true, "eventId is required"],
      unique: true,
      trim: true,
    },
    eventType: {
      type: String,
      required: [true, "eventType is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["PROCESSED", "IGNORED", "FLAGGED", "FAILED"],
      default: "PROCESSED",
      required: true,
    },
    gatewayOrderId: {
      type: String,
      default: null,
      trim: true,
    },
    gatewayPaymentId: {
      type: String,
      default: null,
      trim: true,
    },
    notes: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("WebhookEvent", webhookEventSchema);
