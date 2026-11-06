import mongoose from "mongoose";

const rewardCardSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    offerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Offer",
      required: true,
      index: true,
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
      unique: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1, // In integer paise (hidden until claimed)
    },
    status: {
      type: String,
      enum: ["UNCLAIMED", "CLAIMED", "EXHAUSTED", "EXPIRED"],
      default: "UNCLAIMED",
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    cashbackTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },
    claimedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

rewardCardSchema.index({ userId: 1, status: 1, createdAt: -1 });

export default mongoose.model("RewardCard", rewardCardSchema);
