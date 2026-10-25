import mongoose from "mongoose";

const outboxEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      default: "PAYOUT_REQUESTED",
      required: true,
    },
    withdrawalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Withdrawal",
      required: [true, "withdrawalId is required"],
    },
    status: {
      type: String,
      enum: ["NEW", "PROCESSING", "DONE", "STUCK"],
      default: "NEW",
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    nextAttemptAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    lockedAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

outboxEventSchema.index({ status: 1, nextAttemptAt: 1 });

export default mongoose.model("OutboxEvent", outboxEventSchema);
