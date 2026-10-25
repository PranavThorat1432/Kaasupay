// IdempotencyRecord — persisted per (userId, key) pair to make transfer
// requests replay-safe across server restarts and multiple instances.
//
// State machine:
//   IN_PROGRESS  →  DONE  (transfer succeeded or a business error occurred)
//   IN_PROGRESS  →  deleted  (unexpected infrastructure failure recovery)
//
// The unique compound index on { userId, key } is the exclusive gate:
// only ONE request can ever move from "no record" → IN_PROGRESS for a given
// (userId, key) pair. Duplicate-key error 11000 = another request already owns it.
import mongoose from "mongoose";

const idempotencyRecordSchema = new mongoose.Schema(
  {
    // The authenticated user who submitted the request.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
    },
    // Client-supplied idempotency key (from the Idempotency-Key header).
    key: {
      type: String,
      required: [true, "key is required"],
      maxlength: [100, "key must be at most 100 characters"],
      trim: true,
    },
    // SHA-256 hash of the canonical request (recipient email + amount + note).
    // Used to detect key reuse with a DIFFERENT request body → 422.
    requestHash: {
      type: String,
      required: [true, "requestHash is required"],
    },
    // IN_PROGRESS: the transfer is being executed right now.
    // DONE: the transfer completed (success or expected business failure).
    state: {
      type: String,
      enum: ["IN_PROGRESS", "DONE"],
      default: "IN_PROGRESS",
      required: true,
    },
    // The HTTP status code of the original response (stored when DONE).
    responseStatus: {
      type: Number,
      default: null,
    },
    // The original JSON response body (stored when DONE, replayed on retry).
    responseBody: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

// Unique compound index: the exclusive gate that prevents duplicate processing.
// Only ONE (userId, key) pair can exist at a time.
idempotencyRecordSchema.index({ userId: 1, key: 1 }, { unique: true });

// TTL index: automatically remove old DONE records after 30 days to prevent
// unbounded growth. A re-used key after 30 days will be treated as new.
idempotencyRecordSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 }
);

export default mongoose.model("IdempotencyRecord", idempotencyRecordSchema);
