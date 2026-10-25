import DailySpend from "../models/dailySpendModel.js";

export const DAILY_LIMIT_PAISE = 1000000; // ₹10,000

/**
 * Returns India calendar date formatted as YYYY-MM-DD
 * India is UTC + 5:30
 */
export function indiaDay(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const indiaTime = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return indiaTime.toISOString().slice(0, 10);
}

/**
 * Returns ISO string for the next midnight in India.
 * For any India day YYYY-MM-DD, midnight at the end of that day corresponds
 * to YYYY-MM-DDT18:30:00.000Z in UTC.
 */
export function getResetsAt(date = new Date()) {
  const dayStr = indiaDay(date);
  return `${dayStr}T18:30:00.000Z`;
}

/**
 * Atomically checks and reserves daily limit within an existing MongoDB transaction session.
 * Throws 400 with leftToday if limit would be exceeded.
 */
export async function checkAndConsumeDailyLimit(userId, amount, session) {
  const day = indiaDay();

  // 1. Ensure today's counter exists (upsert, catching concurrent E11000)
  try {
    await DailySpend.updateOne(
      { userId, day },
      { $setOnInsert: { spent: 0 } },
      { upsert: true, session }
    );
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  // 2. Add amount only if it still fits within the limit
  const updated = await DailySpend.findOneAndUpdate(
    { userId, day, spent: { $lte: DAILY_LIMIT_PAISE - amount } },
    { $inc: { spent: amount } },
    { session, returnDocument: "after" }
  );

  if (!updated) {
    const current = await DailySpend.findOne({ userId, day }).session(session);
    const spentSoFar = current ? current.spent : DAILY_LIMIT_PAISE;
    const leftToday = Math.max(0, DAILY_LIMIT_PAISE - spentSoFar);
    const error = new Error("Daily limit reached");
    error.name = "MoneyError";
    error.status = 400;
    error.statusCode = 400;
    error.leftToday = leftToday;
    throw error;
  }

  return updated;
}

/**
 * Retrieves daily limit status for the given user.
 */
export async function getDailyLimitStatus(userId) {
  const day = indiaDay();
  const record = await DailySpend.findOne({ userId, day });
  const usedToday = record ? record.spent : 0;
  const leftToday = Math.max(0, DAILY_LIMIT_PAISE - usedToday);
  const resetsAt = getResetsAt();

  return {
    dailyLimit: DAILY_LIMIT_PAISE,
    usedToday,
    leftToday,
    resetsAt,
  };
}
