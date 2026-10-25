import bcrypt from "bcryptjs";
import User from "../models/userModel.js";

const COMMON_EASY_PINS = new Set([
  "1234",
  "0000",
  "1111",
  "2580",
  "123456",
  "000000",
  "111111",
  "654321",
]);

/**
 * Validates PIN strength.
 * Must be 4 or 6 digits string, not repetitive or common.
 */
export function validatePinStrength(pin) {
  if (typeof pin !== "string" || !(/^\d{4}$|^\d{6}$/.test(pin))) {
    const error = new Error("PIN must be 4 or 6 digits");
    error.statusCode = 400;
    throw error;
  }

  // All digits the same (e.g., 0000, 1111, 999999)
  if (/^(\d)\1+$/.test(pin) || COMMON_EASY_PINS.has(pin)) {
    const error = new Error("PIN is too easy to guess");
    error.statusCode = 400;
    throw error;
  }
}

/**
 * Sets or changes the user's payment PIN.
 * Requires user password verification.
 */
export async function setOrUpdatePin(userId, password, pin) {
  validatePinStrength(pin);

  const user = await User.findById(userId);
  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    const error = new Error("Wrong password");
    error.statusCode = 401;
    throw error;
  }

  const isChange = Boolean(user.pinHash);
  const pinHash = await bcrypt.hash(pin, 10);

  user.pinHash = pinHash;
  user.pinFailedCount = 0;
  user.pinLockedUntil = null;
  await user.save();

  return {
    message: isChange ? "PIN changed" : "PIN set",
  };
}

/**
 * Verifies the user's PIN before a payment action.
 * Enforces atomic try reservation to prevent "check, then act" race conditions.
 * Locks the PIN for 15 minutes after 3 consecutive wrong guesses.
 */
export async function verifyPin(userId, pin) {
  if (typeof pin !== "string" || pin.trim() === "") {
    const error = new Error("PIN is required");
    error.statusCode = 400;
    throw error;
  }

  const user = await User.findById(userId);
  if (!user || !user.pinHash) {
    const error = new Error("Set your payment PIN first");
    error.statusCode = 400;
    throw error;
  }

  const now = new Date();

  // 1. Check if currently locked
  if (user.pinLockedUntil && user.pinLockedUntil > now) {
    const retryAfterSeconds = Math.max(1, Math.ceil((user.pinLockedUntil.getTime() - now.getTime()) / 1000));
    const error = new Error("PIN locked. Try again later");
    error.statusCode = 423;
    error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }

  // If previous lock time has passed, automatically clear it
  if (user.pinLockedUntil && user.pinLockedUntil <= now) {
    await User.updateOne(
      { _id: userId },
      { pinLockedUntil: null, pinFailedCount: 0 }
    );
  }

  // 2. Atomically reserve one attempt (only if tries < 3)
  const reserved = await User.findOneAndUpdate(
    {
      _id: userId,
      pinFailedCount: { $lt: 3 },
      $or: [{ pinLockedUntil: null }, { pinLockedUntil: { $lte: now } }],
    },
    { $inc: { pinFailedCount: 1 } },
    { returnDocument: "after" }
  );

  // If no document returned, 3 attempts were already exhausted concurrently
  if (!reserved) {
    const lockDurationMs = 15 * 60 * 1000; // 15 minutes
    const lockedUntil = new Date(now.getTime() + lockDurationMs);
    await User.updateOne({ _id: userId }, { pinLockedUntil: lockedUntil });

    const error = new Error("PIN locked. Try again later");
    error.statusCode = 423;
    error.retryAfterSeconds = 900;
    throw error;
  }

  // 3. Compare the PIN with the stored hash
  const isMatch = await bcrypt.compare(pin, reserved.pinHash);

  if (isMatch) {
    // Correct PIN resets the failed counter to 0
    await User.updateOne(
      { _id: userId },
      { pinFailedCount: 0, pinLockedUntil: null }
    );
    return true;
  }

  // Wrong PIN:
  if (reserved.pinFailedCount >= 3) {
    const lockDurationMs = 15 * 60 * 1000; // 15 minutes
    const lockedUntil = new Date(now.getTime() + lockDurationMs);
    await User.updateOne({ _id: userId }, { pinLockedUntil: lockedUntil });

    const error = new Error("PIN locked. Try again later");
    error.statusCode = 423;
    error.retryAfterSeconds = 900;
    throw error;
  }

  const triesLeft = 3 - reserved.pinFailedCount;
  const error = new Error(`Wrong PIN. ${triesLeft} ${triesLeft === 1 ? "try left" : "tries left"}`);
  error.statusCode = 403;
  error.triesLeft = triesLeft;
  throw error;
}

/**
 * Staff-only unlock function.
 */
export async function unlockUserPin(userId) {
  const result = await User.findByIdAndUpdate(
    userId,
    { pinFailedCount: 0, pinLockedUntil: null },
    { returnDocument: "after" }
  );

  if (!result) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  return { message: "PIN unlocked" };
}
