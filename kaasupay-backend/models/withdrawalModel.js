import mongoose from "mongoose";

const withdrawalSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
    },
    bankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BankAccount",
      required: [true, "bankAccountId is required"],
    },
    amount: {
      type: Number,
      required: [true, "amount is required"],
      validate: {
        validator: (v) => Number.isInteger(v) && v > 0,
        message: "amount must be a positive integer in paise",
      },
    },
    reference: {
      type: String,
      required: [true, "reference is required"],
      unique: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "SUCCESS", "REVERSED", "NEEDS_REVIEW"],
      default: "PENDING",
      required: true,
    },
    bankRef: {
      type: String,
      default: null,
      trim: true,
    },
    failureReason: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { timestamps: true }
);

withdrawalSchema.index({ userId: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1 });

export default mongoose.model("Withdrawal", withdrawalSchema);
