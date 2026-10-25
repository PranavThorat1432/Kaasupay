// Transaction document — one record per financial event (deposit or transfer).
// This is the header record; per-user debit/credit lines live in LedgerEntry.
import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["DEPOSIT", "TRANSFER", "TOPUP", "WITHDRAWAL", "REVERSAL"],
      required: [true, "type is required"],
    },
    // The KaasuPay user who sent money. Null for deposits, topups, reversals.
    fromUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // The KaasuPay user who received money. Null for withdrawals.
    toUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Amount in integer paise (₹1 = 100 paise). Always positive.
    amount: {
      type: Number,
      required: [true, "amount is required"],
      validate: {
        validator: (v) => Number.isInteger(v) && v > 0,
        message: "amount must be a positive integer (paise)",
      },
    },
    // Optional human note (e.g. "Lunch", "Initial deposit").
    note: {
      type: String,
      default: null,
      maxlength: [200, "note must be at most 200 characters"],
      trim: true,
    },
    // The completed financial event. COMPLETED is the only valid terminal state
    // in this educational implementation (no refunds, no chargebacks).
    status: {
      type: String,
      enum: ["COMPLETED"],
      default: "COMPLETED",
      required: true,
    },
  },
  { timestamps: true }
);

// Index to quickly fetch a user's sent/received transactions for history and
// reconciliation queries.
transactionSchema.index({ toUserId: 1, createdAt: -1 });
transactionSchema.index({ fromUserId: 1, createdAt: -1 });

export default mongoose.model("Transaction", transactionSchema);
