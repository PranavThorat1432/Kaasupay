import mongoose from "mongoose";

const offerSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    percent: {
      type: Number,
      required: true,
      min: 1,
      max: 50,
    },
    maxCashback: {
      type: Number,
      required: true,
      min: 1, // In integer paise
    },
    minPayment: {
      type: Number,
      required: true,
      min: 1, // In integer paise
    },
    budget: {
      type: Number,
      required: true,
      min: 1, // In integer paise
    },
    budgetLeft: {
      type: Number,
      required: true,
      min: 0, // In integer paise
    },
    startsAt: {
      type: Date,
      required: true,
    },
    endsAt: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

offerSchema.index({ startsAt: 1, endsAt: 1, isActive: 1 });

export default mongoose.model("Offer", offerSchema);
