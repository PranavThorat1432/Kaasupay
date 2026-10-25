import mongoose from "mongoose";

const dailySpendSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    day: {
      type: String,
      required: true, // "YYYY-MM-DD" India date
    },
    spent: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

// Unique compound index so there is exactly one record per user per India day
dailySpendSchema.index({ userId: 1, day: 1 }, { unique: true });

export default mongoose.model("DailySpend", dailySpendSchema);
