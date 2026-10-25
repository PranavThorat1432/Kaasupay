// Wallet document for the `wallets` collection in the `kaasupay` database.
// One wallet per user: userId is unique and references User._id.
import mongoose from "mongoose";

const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
      unique: true, // exactly one wallet per user
    },
    balance: {
      type: Number,
      required: [true, "balance is required"],
      default: 0,
      // Balance is always an integer amount of PAISE:
      // ₹0 → 0, ₹12.50 → 1250, ₹100.00 → 10000
      validate: {
        validator: Number.isInteger,
        message: "balance must be an integer (paise)",
      },
    },
  },
  { timestamps: true } // adds createdAt / updatedAt
);

export default mongoose.model("Wallet", walletSchema);
