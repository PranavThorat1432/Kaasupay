// tools/seed-history.js — Seed history records for performance benchmarking and explain() analysis
import "dotenv/config";
import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import User from "../models/userModel.js";
import Wallet from "../models/walletModel.js";
import Transaction from "../models/transactionModel.js";
import LedgerEntry from "../models/ledgerEntryModel.js";
import { connectDB } from "../db.js";

const ADMIN_KEY = process.env.ADMIN_KEY || "kaasupay_admin_1432";
const API_BASE = process.env.API || "http://localhost:3000/api/v1";

/**
 * Seeds N deposit records for a target user via direct database batch insertion.
 * High-performance for local benchmark testing and MongoDB explain() measurement.
 *
 * @param {{ userId: string|mongoose.Types.ObjectId, count?: number, verbose?: boolean }} options
 */
export async function seedHistoryDirect({ userId, count = 5000, verbose = true }) {
  const targetId = new mongoose.Types.ObjectId(userId);
  const user = await User.findById(targetId);
  if (!user) {
    throw new Error(`User not found for ID: ${userId}`);
  }

  const wallet = await Wallet.findOne({ userId: targetId });
  if (!wallet) {
    throw new Error(`Wallet not found for user: ${userId}`);
  }

  if (verbose) {
    console.log(`[seed] Seeding ${count} records directly for ${user.username} (${targetId})...`);
  }

  const BATCH_SIZE = 1000;
  let runningBalance = wallet.balance;
  let totalSeeded = 0;
  const baseTime = Date.now() - count * 1000; // staggered in 1-second intervals into the past

  for (let b = 0; b < count; b += BATCH_SIZE) {
    const currentBatchCount = Math.min(BATCH_SIZE, count - b);
    const txnDocs = [];
    const ledgerDocs = [];

    for (let i = 0; i < currentBatchCount; i++) {
      const idx = b + i;
      const amount = 100 + (idx % 500); // between ₹1 and ₹6
      runningBalance += amount;
      const recordTime = new Date(baseTime + idx * 1000);
      const txnId = new mongoose.Types.ObjectId();

      txnDocs.push({
        _id: txnId,
        type: "DEPOSIT",
        fromUserId: null,
        toUserId: targetId,
        amount,
        note: `Seeded Deposit #${idx + 1}`,
        status: "COMPLETED",
        createdAt: recordTime,
        updatedAt: recordTime,
      });

      ledgerDocs.push({
        userId: targetId,
        transactionId: txnId,
        direction: "CREDIT",
        type: "DEPOSIT",
        amount,
        balanceAfter: runningBalance,
        createdAt: recordTime,
        updatedAt: recordTime,
      });
    }

    await Transaction.insertMany(txnDocs, { ordered: false });
    await LedgerEntry.insertMany(ledgerDocs, { ordered: false });
    totalSeeded += currentBatchCount;

    if (verbose && (totalSeeded % 1000 === 0 || totalSeeded === count)) {
      console.log(`[seed] Progress: ${totalSeeded} / ${count} records inserted.`);
    }
  }

  // Update wallet balance once at end of batch
  await Wallet.updateOne({ _id: wallet._id }, { $set: { balance: runningBalance } });

  if (verbose) {
    console.log(`[seed] Done! Successfully seeded ${totalSeeded} records. Final balance: ₹${(runningBalance / 100).toFixed(2)}`);
  }

  return { totalSeeded, finalBalance: runningBalance };
}

/**
 * Seeds N records via HTTP API (staff deposit endpoint).
 */
export async function seedHistoryHttp({ recipientEmail, count = 5000, verbose = true }) {
  if (verbose) {
    console.log(`[seed-http] Seeding ${count} records via API: ${API_BASE} for ${recipientEmail}...`);
  }

  let successCount = 0;
  for (let i = 1; i <= count; i++) {
    const res = await fetch(`${API_BASE}/admin/deposit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": ADMIN_KEY,
      },
      body: JSON.stringify({
        to: recipientEmail,
        amount: 100 + (i % 500),
        note: `HTTP Seed Deposit #${i}`,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[seed-http] Failed at index ${i}: ${res.status} ${errText}`);
      break;
    }

    successCount++;
    if (verbose && (i % 250 === 0 || i === count)) {
      console.log(`[seed-http] Progress: ${i} / ${count} deposits created.`);
    }
  }

  return { successCount };
}

// Standalone CLI execution
const isDirectCall =
  process.argv[1] &&
  fileURLToPath(import.meta.url).replace(/\\/g, "/") === process.argv[1].replace(/\\/g, "/");

if (isDirectCall) {
  (async () => {
    const targetArg = process.argv[2];
    const countArg = parseInt(process.argv[3] || "5000", 10);

    if (!targetArg) {
      console.error("Usage: node tools/seed-history.js <USER_ID_OR_EMAIL> [COUNT]");
      console.error("Example: API=http://localhost:3000/api/v1 node tools/seed-history.js meena@kaasupay.com 5000");
      process.exit(1);
    }

    try {
      if (process.env.DIRECT_DB === "true" || !process.env.API) {
        await connectDB();
        let userId = targetArg;
        if (!mongoose.isValidObjectId(targetArg)) {
          const user = await User.findOne({ username: targetArg.toLowerCase() });
          if (!user) throw new Error(`User not found: ${targetArg}`);
          userId = user._id;
        }
        await seedHistoryDirect({ userId, count: countArg, verbose: true });
        await mongoose.disconnect();
      } else {
        await seedHistoryHttp({ recipientEmail: targetArg, count: countArg, verbose: true });
      }
      process.exit(0);
    } catch (err) {
      console.error("[seed] Error:", err);
      process.exit(1);
    }
  })();
}

