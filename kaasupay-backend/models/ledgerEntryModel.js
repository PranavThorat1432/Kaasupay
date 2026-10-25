// LedgerEntry — one document per user per transaction.
// A transfer produces exactly two entries (DEBIT for sender, CREDIT for receiver).
// A deposit produces exactly one entry (CREDIT for recipient).
// Ledger entries are immutable once created. Corrections are new compensating events.
import mongoose from "mongoose";

const ledgerEntrySchema = new mongoose.Schema(
  {
    // The user whose balance changed.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
    },
    // The parent transaction that caused this entry.
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      required: [true, "transactionId is required"],
    },
    // DEBIT = money left the wallet; CREDIT = money entered the wallet.
    direction: {
      type: String,
      enum: ["DEBIT", "CREDIT"],
      required: [true, "direction is required"],
    },
    // Amount of this entry in paise. Always the absolute value (positive).
    amount: {
      type: Number,
      required: [true, "amount is required"],
      validate: {
        validator: (v) => Number.isInteger(v) && v > 0,
        message: "amount must be a positive integer (paise)",
      },
    },
    // The wallet balance immediately after this entry was applied.
    balanceAfter: {
      type: Number,
      required: [true, "balanceAfter is required"],
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 0,
        message: "balanceAfter must be a non-negative integer (paise)",
      },
    },
  },
  { timestamps: true }
);

// Primary index for newest-first history queries: "give me all entries for
// this user, newest first". This is the most common history access pattern.
ledgerEntrySchema.index({ userId: 1, createdAt: -1 });

// Secondary index for reconciliation: "all entries for a given transaction".
ledgerEntrySchema.index({ transactionId: 1 });

export default mongoose.model("LedgerEntry", ledgerEntrySchema);
