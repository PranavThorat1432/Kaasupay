import mongoose from "mongoose";
import BankAccount from "../models/bankAccountModel.js";
import Withdrawal from "../models/withdrawalModel.js";
import Wallet from "../models/walletModel.js";
import IdempotencyRecord from "../models/idempotencyRecordModel.js";
import {
  bankAccountSchema,
  withdrawSchema,
} from "../validations/bankValidation.js";
import {
  encryptAccountNumber,
} from "../services/encryption.js";
import User from "../models/userModel.js";
import {
  requestWithdrawal,
  hashWithdrawRequest,
  MoneyError,
} from "../services/money.js";
import { verifyPin } from "../services/pinService.js";

// ---------------------------------------------------------------------------
// POST /api/v1/wallet/bank-accounts
// ---------------------------------------------------------------------------
export const addBankAccount = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.userId)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = bankAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { holderName, accountNumber, ifsc } = parsed.data;
    const last4 = accountNumber.slice(-4);
    const encryptedNumber = encryptAccountNumber(accountNumber);

    try {
      const bankAccount = await BankAccount.create({
        userId: req.userId,
        holderName,
        accountNumber: encryptedNumber,
        ifsc,
        last4,
      });

      // Never return the complete or raw account number
      return res.status(201).json({
        id: bankAccount._id,
        holderName: bankAccount.holderName,
        account: `XXXXXX${bankAccount.last4}`,
        ifsc: bankAccount.ifsc,
      });
    } catch (err) {
      if (err.code === 11000) {
        return res
          .status(409)
          .json({ error: "This bank account is already added" });
      }
      throw err;
    }
  } catch (err) {
    console.error("Unexpected error in addBankAccount:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/wallet/bank-accounts
// ---------------------------------------------------------------------------
export const getBankAccounts = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.userId)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const accounts = await BankAccount.find({ userId: req.userId }).sort({
      createdAt: -1,
    });

    const formatted = accounts.map((acc) => ({
      id: acc._id,
      holderName: acc.holderName,
      account: `XXXXXX${acc.last4}`,
      ifsc: acc.ifsc,
      createdAt: acc.createdAt,
    }));

    return res.status(200).json({ accounts: formatted });
  } catch (err) {
    console.error("Unexpected error in getBankAccounts:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// POST /api/v1/wallet/withdraw
// ---------------------------------------------------------------------------
export const withdraw = async (req, res) => {
  if (!mongoose.isValidObjectId(req.userId)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Idempotency-Key validation
  const idempHeader = req.headers["idempotency-key"];
  if (
    !idempHeader ||
    typeof idempHeader !== "string" ||
    idempHeader.trim().length === 0 ||
    idempHeader.trim().length > 100
  ) {
    return res.status(400).json({
      error: "Idempotency-Key header is required (max 100 characters)",
    });
  }

  const trimmedKey = idempHeader.trim();

  // Validate body
  const parsed = withdrawSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const { bankAccountId, amount } = parsed.data;

  // Validate bank account ownership
  const bankAccount = await BankAccount.findOne({
    _id: bankAccountId,
    userId: req.userId,
  });

  if (!bankAccount) {
    return res.status(404).json({ error: "Bank account not found" });
  }

  // Gate 5: PIN check
  const user = await User.findById(req.userId);
  const pin = parsed.data.pin ?? req.body?.pin;

  if (pin !== undefined || (user && user.pinHash !== null)) {
    if (!user || !user.pinHash) {
      return res.status(400).json({
        message: "Set your payment PIN first",
        error: "Set your payment PIN first",
      });
    }
    if (!pin) {
      return res.status(400).json({
        message: "PIN is required",
        error: "PIN is required",
      });
    }

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
  }

  // Check balance before reserving idempotency slot
  const currentWallet = await Wallet.findOne({ userId: req.userId });
  if (!currentWallet || currentWallet.balance < amount) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  // Compute stable request hash
  const reqHash = hashWithdrawRequest({ bankAccountId, amount });

  // Claim idempotency slot
  let ownedRecord = null;
  try {
    ownedRecord = await IdempotencyRecord.create({
      userId: req.userId,
      key: trimmedKey,
      requestHash: reqHash,
      state: "IN_PROGRESS",
    });
  } catch (err) {
    if (err.code === 11000) {
      const existing = await IdempotencyRecord.findOne({
        userId: req.userId,
        key: trimmedKey,
      });

      if (!existing) {
        return res.status(500).json({ error: "Internal Server Error" });
      }

      if (existing.requestHash !== reqHash) {
        return res.status(422).json({
          error: "Idempotency key reused with different request parameters",
        });
      }

      if (existing.state === "IN_PROGRESS") {
        return res.status(409).json({
          error: "Request with this idempotency key is already in progress",
        });
      }

      return res.status(existing.responseStatus).json(existing.responseBody);
    }
    console.error("Unexpected error creating IdempotencyRecord:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }

  // Helpers to complete or abort the idempotency record
  const finalise = async (status, body) => {
    try {
      ownedRecord.state = "DONE";
      ownedRecord.responseStatus = status;
      ownedRecord.responseBody = body;
      await ownedRecord.save();
    } catch (saveErr) {
      console.error("Failed to finalise IdempotencyRecord:", saveErr);
    }
  };

  const deleteRecord = async () => {
    try {
      await IdempotencyRecord.deleteOne({ _id: ownedRecord._id });
    } catch (delErr) {
      console.error("Failed to clean up IdempotencyRecord:", delErr);
    }
  };

  try {
    // Execute atomic hold & outbox creation
    const { withdrawal, newBalance } = await requestWithdrawal({
      userId: req.userId,
      bankAccountId: bankAccount._id,
      amount,
    });

    const responseBody = {
      message: "Withdrawal requested",
      withdrawal: {
        id: withdrawal._id,
        amount: withdrawal.amount,
        status: withdrawal.status,
        account: `XXXXXX${bankAccount.last4}`,
      },
      balance: newBalance,
    };

    await finalise(202, responseBody);
    return res.status(202).json(responseBody);
  } catch (err) {
    if (err instanceof MoneyError || err.name === "MoneyError") {
      const body = { error: err.message, message: err.message };
      if (err.leftToday !== undefined) {
        body.leftToday = err.leftToday;
      }
      await finalise(err.status, body);
      return res.status(err.status).json(body);
    }
    await deleteRecord();
    console.error("Unexpected error in withdraw controller:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/wallet/withdrawals
// ---------------------------------------------------------------------------
export const getWithdrawals = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.userId)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const withdrawals = await Withdrawal.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("bankAccountId", "holderName last4 ifsc");

    const formatted = withdrawals.map((w) => ({
      id: w._id,
      amount: w.amount,
      status: w.status,
      bankRef: w.bankRef,
      failureReason: w.failureReason,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
      reference: w.reference,
      account: w.bankAccountId ? `XXXXXX${w.bankAccountId.last4}` : null,
      holderName: w.bankAccountId?.holderName ?? null,
      ifsc: w.bankAccountId?.ifsc ?? null,
    }));

    return res.status(200).json({ withdrawals: formatted });
  } catch (err) {
    console.error("Unexpected error in getWithdrawals:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/wallet/withdrawals/:id
// ---------------------------------------------------------------------------
export const getWithdrawalById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.userId)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: "Withdrawal not found" });
    }

    const withdrawal = await Withdrawal.findOne({
      _id: req.params.id,
      userId: req.userId,
    }).populate("bankAccountId", "holderName last4 ifsc");

    if (!withdrawal) {
      return res.status(404).json({ error: "Withdrawal not found" });
    }

    return res.status(200).json({
      withdrawal: {
        id: withdrawal._id,
        amount: withdrawal.amount,
        status: withdrawal.status,
        reference: withdrawal.reference,
        bankRef: withdrawal.bankRef,
        failureReason: withdrawal.failureReason,
        createdAt: withdrawal.createdAt,
        updatedAt: withdrawal.updatedAt,
        account: withdrawal.bankAccountId
          ? `XXXXXX${withdrawal.bankAccountId.last4}`
          : null,
        holderName: withdrawal.bankAccountId?.holderName ?? null,
        ifsc: withdrawal.bankAccountId?.ifsc ?? null,
      },
    });
  } catch (err) {
    console.error("Unexpected error in getWithdrawalById:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
