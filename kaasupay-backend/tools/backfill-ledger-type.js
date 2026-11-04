// tools/backfill-ledger-type.js — Safe, idempotent backfill for LedgerEntry.type
import "dotenv/config";
import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import LedgerEntry from "../models/ledgerEntryModel.js";
import Transaction from "../models/transactionModel.js";
import { connectDB } from "../db.js";

/**
 * Runs the backfill migration logic on an active Mongoose connection.
 * @param {{ verbose?: boolean }} options
 * @returns {Promise<{ scanned: number, fixed: number, unresolved: number, skipped: number }>}
 */
export async function runBackfill({ verbose = true } = {}) {
  // Query only records lacking a valid non-null type field
  const filter = {
    $or: [{ type: { $exists: false } }, { type: null }],
  };

  const cursor = LedgerEntry.find(filter).cursor();

  let scanned = 0;
  let fixed = 0;
  let unresolved = 0;
  let skipped = 0;

  for await (const entry of cursor) {
    scanned++;
    if (!entry.transactionId) {
      if (verbose) {
        console.warn(`[backfill] Entry ${entry._id} has no transactionId. Skipping.`);
      }
      unresolved++;
      continue;
    }

    const txn = await Transaction.findById(entry.transactionId).select("type").lean();
    if (!txn || !txn.type) {
      if (verbose) {
        console.warn(
          `[backfill] Related transaction ${entry.transactionId} not found or missing type for entry ${entry._id}.`
        );
      }
      unresolved++;
      continue;
    }

    // Atomic conditional update to guarantee idempotency and avoid overwriting concurrent changes
    const updateRes = await LedgerEntry.updateOne(
      { _id: entry._id, $or: [{ type: { $exists: false } }, { type: null }] },
      { $set: { type: txn.type } }
    );

    if (updateRes.modifiedCount > 0) {
      fixed++;
    } else {
      skipped++;
    }
  }

  if (verbose) {
    console.log(`[backfill] Completed: Scanned ${scanned}, Fixed ${fixed} rows, Unresolved ${unresolved}, Skipped ${skipped}.`);
  }

  return { scanned, fixed, unresolved, skipped };
}

// Standalone execution when invoked directly via Node CLI
const isDirectCall =
  process.argv[1] &&
  fileURLToPath(import.meta.url).replace(/\\/g, "/") === process.argv[1].replace(/\\/g, "/");

if (isDirectCall) {
  (async () => {
    try {
      console.log("[backfill] Connecting to MongoDB...");
      await connectDB();
      console.log("[backfill] Running idempotent backfill...");
      const result = await runBackfill({ verbose: true });
      console.log(`Fixed ${result.fixed} rows`);
      await mongoose.disconnect();
      process.exit(0);
    } catch (err) {
      console.error("[backfill] Migration failed with error:", err);
      try {
        await mongoose.disconnect();
      } catch {}
      process.exit(1);
    }
  })();
}

