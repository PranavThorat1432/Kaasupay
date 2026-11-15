import mongoose from "mongoose";

const mandateSchema = new mongoose.Schema(
  {
    payerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    payeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 100,
      max: 500000,
      validate: {
        validator: Number.isInteger,
        message: "Amount must be an integer number of paise",
      },
    },
    dayOfMonth: {
      type: Number,
      required: true,
      min: 1,
      max: 28,
      validate: {
        validator: Number.isInteger,
        message: "dayOfMonth must be an integer between 1 and 28",
      },
    },
    status: {
      type: String,
      enum: ["ACTIVE", "PAUSED", "CANCELLED"],
      default: "ACTIVE",
      required: true,
    },
    nextRunDay: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    failedCount: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "failedCount must be an integer",
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes:
// Required by PRD 4.1: { status: 1, nextRunDay: 1 }
mandateSchema.index({ status: 1, nextRunDay: 1 });
mandateSchema.index({ payerId: 1, status: 1 });

const Mandate = mongoose.model("Mandate", mandateSchema);
export default Mandate;
