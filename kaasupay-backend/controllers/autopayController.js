import mongoose from "mongoose";
import Mandate from "../models/mandateModel.js";
import MandateRun from "../models/mandateRunModel.js";
import User from "../models/userModel.js";
import { verifyPin } from "../services/pinService.js";
import { calculateNextRunDay } from "../services/autopayService.js";
import { createMandateSchema } from "../validations/autopayValidation.js";

/**
 * Helper to format a user's full name.
 * If user has firstName and lastName, returns "FirstName LastName".
 */
export function formatUserName(user) {
  if (!user) return "Unknown";
  const name = `${user.firstName || ""} ${user.lastName || ""}`.trim();
  return name || user.username || "Unknown";
}

/**
 * POST /api/v1/autopay
 * Creates a new AutoPay mandate with PIN step-up verification.
 * Enforces concurrency-safe 5 non-cancelled mandate cap via a transactional write-lock.
 */
export async function createMandate(req, res) {
  try {
    const parsed = createMandateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid inputs",
        error: "Invalid inputs",
        details: parsed.error.issues,
      });
    }

    const { to, amount, dayOfMonth, pin } = parsed.data;

    // Self-mandate guard
    if (to === req.userId.toString()) {
      return res.status(400).json({
        message: "You can't set up AutoPay to yourself",
        error: "You can't set up AutoPay to yourself",
      });
    }

    // Payee existence guard
    const payee = await User.findById(to).select("firstName lastName username");
    if (!payee) {
      return res.status(404).json({
        message: "User not found",
        error: "User not found",
      });
    }

    // Step-up authentication: Verify Payment PIN BEFORE starting transaction
    try {
      await verifyPin(req.userId, pin);
    } catch (pinErr) {
      const status = pinErr.statusCode || 400;
      if (status === 423 && pinErr.retryAfterSeconds) {
        res.setHeader("Retry-After", pinErr.retryAfterSeconds);
        return res.status(423).json({
          message: pinErr.message,
          retryAfterSeconds: pinErr.retryAfterSeconds,
        });
      }
      if (status === 403) {
        return res.status(403).json({
          message: pinErr.message,
          triesLeft: pinErr.triesLeft,
        });
      }
      return res.status(status).json({
        message: pinErr.message,
        error: pinErr.message,
      });
    }

    // Calculate next scheduled payment day (strictly never on creation date)
    const nextRunDay = calculateNextRunDay(dayOfMonth);

    // Concurrency-Safe Mandate Creation:
    // Execute inside a MongoDB transaction with a write-intent lock on the payer's User document.
    // This serializes mandate creation attempts for this specific payer across concurrent requests.
    const session = await mongoose.startSession();
    let mandate = null;

    try {
      await session.withTransaction(async () => {
        // 1. Lock the payer's User document via dedicated autopayMandateLockVersion without updating timestamps
        const userLock = await User.findOneAndUpdate(
          { _id: req.userId },
          { $inc: { autopayMandateLockVersion: 1 } },
          {
            session,
            new: true,
            timestamps: false,
          }
        );

        if (!userLock) {
          const err = new Error("User not found");
          err.statusCode = 404;
          throw err;
        }

        // 2. Authoritative non-cancelled count within the serialized lock
        const nonCancelledCount = await Mandate.countDocuments(
          {
            payerId: req.userId,
            status: { $ne: "CANCELLED" },
          },
          { session }
        );

        if (nonCancelledCount >= 5) {
          const err = new Error("You can have at most 5 AutoPays");
          err.statusCode = 409;
          throw err;
        }

        // 3. Create the mandate in the session
        const [created] = await Mandate.create(
          [
            {
              payerId: req.userId,
              payeeId: to,
              amount,
              dayOfMonth,
              status: "ACTIVE",
              nextRunDay,
              failedCount: 0,
            },
          ],
          { session }
        );

        mandate = created;
      });
    } catch (txErr) {
      if (txErr.statusCode === 409) {
        return res.status(409).json({
          message: txErr.message,
          error: txErr.message,
        });
      }
      if (txErr.statusCode === 404) {
        return res.status(404).json({
          message: txErr.message,
          error: txErr.message,
        });
      }
      throw txErr;
    } finally {
      await session.endSession();
    }

    return res.status(201).json({
      message: "AutoPay set up",
      mandate: {
        id: mandate._id.toString(),
        to: formatUserName(payee),
        amount: mandate.amount,
        dayOfMonth: mandate.dayOfMonth,
        status: mandate.status,
        nextRunDay: mandate.nextRunDay,
      },
    });
  } catch (err) {
    console.error("[createMandate Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * GET /api/v1/autopay
 * Lists all mandates created by the authenticated user as payer.
 */
export async function listMandates(req, res) {
  try {
    const mandates = await Mandate.find({ payerId: req.userId })
      .populate("payeeId", "firstName lastName username")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      mandates: mandates.map((m) => ({
        id: m._id.toString(),
        to: formatUserName(m.payeeId),
        payee: {
          id: m.payeeId?._id?.toString() || m.payeeId?.toString(),
          name: formatUserName(m.payeeId),
          username: m.payeeId?.username,
        },
        amount: m.amount,
        dayOfMonth: m.dayOfMonth,
        status: m.status,
        nextRunDay: m.nextRunDay,
        failedCount: m.failedCount,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[listMandates Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * GET /api/v1/autopay/:id/runs
 * Retrieves execution history for a single mandate.
 * Sorts by dueDay descending for chronological schedule accuracy,
 * with createdAt and _id as deterministic tie-breakers.
 * Strictly verifies ownership.
 */
export async function getMandateRuns(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "AutoPay not found" });
    }

    const mandate = await Mandate.findById(id);
    if (!mandate || mandate.payerId.toString() !== req.userId.toString()) {
      return res.status(404).json({ message: "AutoPay not found" });
    }

    const runs = await MandateRun.find({ mandateId: id }).sort({ dueDay: -1, createdAt: -1, _id: -1 });

    return res.status(200).json({
      runs: runs.map((r) => ({
        id: r._id.toString(),
        mandateId: r.mandateId.toString(),
        dueDay: r.dueDay,
        status: r.status,
        amount: r.amount,
        reason: r.reason,
        transactionId: r.transactionId ? r.transactionId.toString() : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[getMandateRuns Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * POST /api/v1/autopay/:id/pause
 * Moves an ACTIVE mandate to PAUSED.
 */
export async function pauseMandate(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "AutoPay not found" });
    }

    // Atomic state transition: Only the payer can pause an ACTIVE mandate.
    const updated = await Mandate.findOneAndUpdate(
      {
        _id: id,
        payerId: req.userId,
        status: "ACTIVE",
      },
      {
        $set: { status: "PAUSED" },
      },
      { returnDocument: "after" }
    );

    if (updated) {
      return res.status(200).json({ message: "AutoPay paused" });
    }

    // If update returned null, inspect state to return exact status code
    const existing = await Mandate.findById(id);
    if (!existing || existing.payerId.toString() !== req.userId.toString()) {
      return res.status(404).json({ message: "AutoPay not found" });
    }

    return res.status(409).json({
      message: `This AutoPay is already ${existing.status}`,
    });
  } catch (err) {
    console.error("[pauseMandate Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * POST /api/v1/autopay/:id/resume
 * Moves a PAUSED mandate back to ACTIVE.
 * Resets failedCount to 0 and recalculates nextRunDay from actual current India date.
 */
export async function resumeMandate(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "AutoPay not found" });
    }

    const existing = await Mandate.findById(id);
    if (!existing || existing.payerId.toString() !== req.userId.toString()) {
      return res.status(404).json({ message: "AutoPay not found" });
    }

    if (existing.status !== "PAUSED") {
      return res.status(409).json({
        message: `This AutoPay is already ${existing.status}`,
      });
    }

    // Recalculate nextRunDay from real current India date (never charging paused months)
    const nextRunDay = calculateNextRunDay(existing.dayOfMonth);

    const updated = await Mandate.findOneAndUpdate(
      {
        _id: id,
        payerId: req.userId,
        status: "PAUSED",
      },
      {
        $set: {
          status: "ACTIVE",
          failedCount: 0,
          nextRunDay,
        },
      },
      { returnDocument: "after" }
    );

    if (!updated) {
      return res.status(409).json({ message: "AutoPay state changed concurrently" });
    }

    return res.status(200).json({
      message: "AutoPay resumed",
      nextRunDay,
    });
  } catch (err) {
    console.error("[resumeMandate Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * POST /api/v1/autopay/:id/cancel
 * Permanently cancels an ACTIVE or PAUSED mandate.
 */
export async function cancelMandate(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "AutoPay not found" });
    }

    // Atomic state transition: Only the payer can cancel an ACTIVE or PAUSED mandate.
    const updated = await Mandate.findOneAndUpdate(
      {
        _id: id,
        payerId: req.userId,
        status: { $in: ["ACTIVE", "PAUSED"] },
      },
      {
        $set: { status: "CANCELLED" },
      },
      { returnDocument: "after" }
    );

    if (updated) {
      return res.status(200).json({ message: "AutoPay cancelled" });
    }

    // Inspect existing to distinguish 404 from 409
    const existing = await Mandate.findById(id);
    if (!existing || existing.payerId.toString() !== req.userId.toString()) {
      return res.status(404).json({ message: "AutoPay not found" });
    }

    return res.status(409).json({
      message: `This AutoPay is already ${existing.status}`,
    });
  } catch (err) {
    console.error("[cancelMandate Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
