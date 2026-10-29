// controllers/requestController.js — Controller handlers for Day 7 Request Money.
import mongoose from "mongoose";
import MoneyRequest from "../models/moneyRequestModel.js";
import User from "../models/userModel.js";
import { REQUEST_EXPIRY_DAYS } from "../config.js";
import { createRequestSchema } from "../validations/requestValidation.js";

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
 * POST /api/v1/requests
 * Creates a new money request from the authenticated user to a target payer.
 */
export async function createRequest(req, res) {
  try {
    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid inputs",
        error: "Invalid inputs",
        details: parsed.error.issues,
      });
    }

    const { to, amount, note } = parsed.data;

    // A user cannot request money from themselves.
    if (to === req.userId) {
      return res.status(400).json({
        message: "You can't request money from yourself",
        error: "You can't request money from yourself",
      });
    }

    // Payer must exist in the database.
    const payer = await User.findById(to).select("firstName lastName username");
    if (!payer) {
      return res.status(404).json({
        message: "User not found",
        error: "User not found",
      });
    }

    // Anti-spam rule (Day 7 PDF Level 5): At most 5 pending requests to the same person.
    const pendingCount = await MoneyRequest.countDocuments({
      requesterId: req.userId,
      payerId: to,
      status: "PENDING",
    });

    if (pendingCount >= 5) {
      return res.status(409).json({
        message: "You already have 5 pending requests to this person",
        error: "You already have 5 pending requests to this person",
      });
    }

    // Calculate expiration timestamp (7 days from now).
    const expiresAt = new Date(Date.now() + REQUEST_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const doc = await MoneyRequest.create({
      requesterId: req.userId,
      payerId: to,
      amount,
      note: note || null,
      status: "PENDING",
      expiresAt,
    });

    return res.status(201).json({
      message: "Request sent",
      request: {
        id: doc._id.toString(),
        to: formatUserName(payer),
        amount: doc.amount,
        note: doc.note,
        status: doc.status,
        expiresAt: doc.expiresAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[createRequest Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * GET /api/v1/requests/incoming
 * Lists requests where the authenticated user is the payer (money requested from them).
 */
export async function getIncomingRequests(req, res) {
  try {
    const now = new Date();

    // Lazy expiration: mark overdue pending incoming requests as EXPIRED in one query.
    await MoneyRequest.updateMany(
      {
        payerId: req.userId,
        status: "PENDING",
        expiresAt: { $lte: now },
      },
      {
        $set: { status: "EXPIRED" },
      }
    );

    const filter = { payerId: req.userId };
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const requests = await MoneyRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("requesterId", "firstName lastName username");

    return res.status(200).json({
      requests: requests.map((doc) => ({
        id: doc._id.toString(),
        from: formatUserName(doc.requesterId),
        amount: doc.amount,
        note: doc.note,
        status: doc.status,
        createdAt: doc.createdAt.toISOString(),
        expiresAt: doc.expiresAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[getIncomingRequests Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * GET /api/v1/requests/outgoing
 * Lists requests where the authenticated user is the requester (money requested by them).
 */
export async function getOutgoingRequests(req, res) {
  try {
    const now = new Date();

    // Lazy expiration: mark overdue pending outgoing requests as EXPIRED in one query.
    await MoneyRequest.updateMany(
      {
        requesterId: req.userId,
        status: "PENDING",
        expiresAt: { $lte: now },
      },
      {
        $set: { status: "EXPIRED" },
      }
    );

    const filter = { requesterId: req.userId };
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const requests = await MoneyRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("payerId", "firstName lastName username");

    return res.status(200).json({
      requests: requests.map((doc) => ({
        id: doc._id.toString(),
        to: formatUserName(doc.payerId),
        amount: doc.amount,
        note: doc.note,
        status: doc.status,
        createdAt: doc.createdAt.toISOString(),
        expiresAt: doc.expiresAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[getOutgoingRequests Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * GET /api/v1/requests/:id
 * Retrieves a single request. Only accessible by requester or payer.
 * Strangers receive generic 404 to avoid leaking existence.
 */
export async function getRequestById(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "Request not found" });
    }

    const doc = await MoneyRequest.findById(id)
      .populate("requesterId", "firstName lastName username")
      .populate("payerId", "firstName lastName username");

    if (!doc) {
      return res.status(404).json({ message: "Request not found" });
    }

    const reqUserStr = req.userId.toString();
    const requesterStr = doc.requesterId?._id?.toString() || doc.requesterId?.toString();
    const payerStr = doc.payerId?._id?.toString() || doc.payerId?.toString();

    // Privacy guard: Only the requester and payer may see this request.
    if (reqUserStr !== requesterStr && reqUserStr !== payerStr) {
      return res.status(404).json({ message: "Request not found" });
    }

    // Lazy expiration on single read
    if (doc.status === "PENDING" && doc.expiresAt <= new Date()) {
      doc.status = "EXPIRED";
      await MoneyRequest.updateOne({ _id: doc._id }, { $set: { status: "EXPIRED" } });
    }

    return res.status(200).json({
      request: {
        id: doc._id.toString(),
        from: formatUserName(doc.requesterId),
        to: formatUserName(doc.payerId),
        amount: doc.amount,
        note: doc.note,
        status: doc.status,
        createdAt: doc.createdAt.toISOString(),
        expiresAt: doc.expiresAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[getRequestById Error]", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
