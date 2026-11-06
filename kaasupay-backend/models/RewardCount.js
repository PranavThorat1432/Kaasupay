import mongoose from "mongoose";

const rewardCountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    day: {
      type: String,
      required: true, // Format "YYYY-MM-DD" in IST
    },
    cards: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

rewardCountSchema.index({ userId: 1, day: 1 }, { unique: true });

export default mongoose.model("RewardCount", rewardCountSchema);

