import mongoose from "mongoose";

const mandateRunSchema = new mongoose.Schema(
  {
    mandateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Mandate",
      required: true,
      index: true,
    },
    dueDay: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    status: {
      type: String,
      enum: ["SUCCESS", "FAILED", "MISSED"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 100,
      validate: {
        validator: Number.isInteger,
        message: "Amount must be an integer number of paise",
      },
    },
    reason: {
      type: String,
      default: null,
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Unique compound index required by PRD 4.2: { mandateId: 1, dueDay: 1 }
mandateRunSchema.index({ mandateId: 1, dueDay: 1 }, { unique: true });

const MandateRun = mongoose.model("MandateRun", mandateRunSchema);
export default MandateRun;
