import RateLimitCounter from "../models/rateLimitCounterModel.js";
import User from "../models/userModel.js";

/**
 * Middleware factory for fixed-window rate limiting stored in MongoDB.
 *
 * @param {Object} options
 * @param {string} options.name - Prefix/namespace for the limit
 * @param {number} options.max - Maximum requests allowed per window
 * @param {number} options.windowSeconds - Window duration in seconds
 * @param {Function} options.keyFrom - Function extracting discriminator string from req
 */
export function rateLimit({ name, max, windowSeconds, keyFrom }) {
  return async function rateLimitMiddleware(req, res, next) {
    try {
      const id = String(keyFrom(req) || "unknown").toLowerCase();
      const nowInSec = Math.floor(Date.now() / 1000);
      const windowStart = nowInSec - (nowInSec % windowSeconds);
      const key = `${name}:${id}:${windowStart}`;
      const expiresAt = new Date((windowStart + windowSeconds * 2) * 1000);

      // In one atomic step: create or increment the counter
      const counter = await RateLimitCounter.findOneAndUpdate(
        { key },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
        { upsert: true, returnDocument: "after" }
      );

      const remaining = Math.max(0, max - counter.count);
      res.setHeader("X-RateLimit-Limit", max);
      res.setHeader("X-RateLimit-Remaining", remaining);

      if (counter.count > max) {
        const retryAfterSeconds = Math.max(1, windowStart + windowSeconds - nowInSec);
        res.setHeader("Retry-After", retryAfterSeconds);
        return res.status(429).json({
          message: "Too many requests. Slow down",
          retryAfterSeconds,
        });
      }

      next();
    } catch (err) {
      console.error("[RateLimiter Error]", err);
      // Fail-open for unanticipated rate limiter DB errors so API availability is not blocked
      next();
    }
  };
}

const baseMoneyLimiter = rateLimit({
  name: "money_user",
  max: 10,
  windowSeconds: 60,
  keyFrom: (req) => req.userId,
});

/**
 * Shared money rate limiter for transfers and withdrawals (10 per minute per user).
 * As per Day 6 specification (D6: "with a user who has a PIN and some money").
 */
export const moneyRateLimiter = async (req, res, next) => {
  if (!req.userId) return next();
  try {
    const user = await User.findById(req.userId).select("pinHash");
    if (!user || (!user.pinHash && req.body?.pin === undefined)) {
      return next();
    }
  } catch {
    // If lookup fails, proceed to base limiter
  }
  return baseMoneyLimiter(req, res, next);
};
