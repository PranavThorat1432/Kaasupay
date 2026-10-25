import mongoose from "mongoose";

const bankAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
    },
    holderName: {
      type: String,
      required: [true, "holderName is required"],
      trim: true,
      minlength: [2, "holderName must be at least 2 characters"],
      maxlength: [60, "holderName must be at most 60 characters"],
    },
    accountNumber: {
      type: String,
      required: [true, "accountNumber is required"],
    },
    ifsc: {
      type: String,
      required: [true, "ifsc is required"],
      trim: true,
      uppercase: true,
    },
    last4: {
      type: String,
      required: [true, "last4 is required"],
    },
  },
  { timestamps: true }
);

// Compound unique index ensuring a user cannot add the same bank account twice
bankAccountSchema.index({ userId: 1, accountNumber: 1 }, { unique: true });

export default mongoose.model("BankAccount", bankAccountSchema);
