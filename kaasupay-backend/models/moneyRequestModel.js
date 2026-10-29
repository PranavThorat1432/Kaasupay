// models/moneyRequestModel.js — MoneyRequest schema for Day 7 Request Money.
// A request is not money. It is a record of one user asking another for money.
// Money moves only later, during the atomic payment step.

import mongoose from "mongoose";

const moneyRequestSchema = new mongoose.Schema(
  {
    // The user asking for money (recipient of money if paid).
    requesterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // The user being asked for money (payer of money if paid).
    payerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Amount in integer paise (₹1 to ₹10,000 => 100 to 1,000,000 paise).
    amount: {
      type: Number,
      required: true,
      min: 100,
      max: 1000000,
      validate: {
        validator: Number.isInteger,
        message: "Amount must be an integer number of paise",
      },
    },

    // Optional note explaining the request (e.g. "Dinner at Murugan Idli", max 100 chars).
    note: {
      type: String,
      maxlength: 100,
      default: null,
      trim: true,
    },

    // Lifecycle status: PENDING, PAID, DECLINED, CANCELLED, or EXPIRED.
    status: {
      type: String,
      enum: ["PENDING", "PAID", "DECLINED", "CANCELLED", "EXPIRED"],
      default: "PENDING",
      required: true,
    },

    // Date after which the pending request can no longer be paid or acted on (default: 7 days).
    expiresAt: {
      type: Date,
      required: true,
    },

    // Linked transaction record created when request is paid.
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },

    // Timestamp when the request transitioned out of PENDING.
    decidedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes (Day 7 PDF Part A9 & Part B):
// 1. Incoming requests inbox: query by payerId, optionally filter by status, sort newest first.
moneyRequestSchema.index({ payerId: 1, status: 1, createdAt: -1 });

// 2. Outgoing requests inbox: query by requesterId, optionally filter by status, sort newest first.
moneyRequestSchema.index({ requesterId: 1, status: 1, createdAt: -1 });

// 3. Anti-spam guard: query pending requests from user A to user B (max 5 limit).
moneyRequestSchema.index({ requesterId: 1, payerId: 1, status: 1 });

export default mongoose.model("MoneyRequest", moneyRequestSchema);
