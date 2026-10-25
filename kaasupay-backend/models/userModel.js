// User document for the `users` collection in the `kaasupay` database.
// Mongoose handles persistence-level constraints; Zod still validates the
// HTTP payloads in the controller (both layers are required).
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "username is required"],
      unique: true, // database-level duplicate protection (E11000 → 409)
      trim: true,
      lowercase: true, // stores the normalized email
      match: [/^\S+@\S+\.\S+$/, "username must be a valid email"],
    },
    firstName: {
      type: String,
      required: [true, "firstName is required"],
      trim: true,
      maxlength: 50,
    },
    lastName: {
      type: String,
      required: [true, "lastName is required"],
      trim: true,
      maxlength: 50,
    },
    passwordHash: {
      type: String,
      required: [true, "passwordHash is required"],
      // Never store plaintext passwords - the controller only ever passes a bcrypt hash.
    },
    pinHash: {
      type: String,
      default: null,
    },
    pinFailedCount: {
      type: Number,
      default: 0,
    },
    pinLockedUntil: {
      type: Date,
      default: null,
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true } // adds createdAt / updatedAt
);

export default mongoose.model("User", userSchema);
