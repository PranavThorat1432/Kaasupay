// tools/benchmark-explain.js — Runs MongoDB explain("executionStats") before and after adding compound indexes
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import Wallet from "../models/walletModel.js";
import LedgerEntry from "../models/ledgerEntryModel.js";
import { seedHistoryDirect } from "./seed-history.js";

async function runExplainBenchmark() {
  console.log("Starting in-memory replica set for explain() benchmark...");
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const mongoUri = replSet.getUri();
  await mongoose.connect(mongoUri, { dbName: "kaasupay" });

  try {
    // 1. Create test user Meena
    const user = await User.create({
      username: "meena_benchmark@kaasupay.com",
      firstName: "Meena",
      lastName: "Rao",
      passwordHash: "hash123",
      tokenVersion: 0,
    });
    await Wallet.create({ userId: user._id, balance: 0 });

    // 2. Drop all custom indexes on LedgerEntry except default _id_
    const collection = mongoose.connection.collection("ledgerentries");
    await collection.dropIndexes();
    console.log("Indexes dropped on ledgerentries collection.");

    // 3. Seed 5,000 records
    console.log("Seeding 5,000 deposits for Meena...");
    await seedHistoryDirect({ userId: user._id, count: 5000, verbose: false });
    const count = await LedgerEntry.countDocuments({ userId: user._id });
    console.log(`Verified ${count} documents in collection.`);

    // =========================================================================
    // BEFORE INDEXING: Query 1 (Main History Query)
    // =========================================================================
    console.log("\n--- EXPLAIN BEFORE INDEXING: Main History ---");
    const explainBeforeMain = await LedgerEntry.find({ userId: user._id })
      .sort({ createdAt: -1, _id: -1 })
      .limit(21)
      .explain("executionStats");

    const statsBeforeMain = explainBeforeMain.executionStats;
    const planBeforeMain = explainBeforeMain.queryPlanner.winningPlan;

    console.log("Winning Plan Stage (Before):", planBeforeMain.stage);
    console.log("totalDocsExamined (Before):", statsBeforeMain.totalDocsExamined);
    console.log("nReturned (Before):", statsBeforeMain.nReturned);
    console.log("executionTimeMillis (Before):", statsBeforeMain.executionTimeMillis);

    // =========================================================================
    // BEFORE INDEXING: Query 2 (Type-Filtered History Query)
    // =========================================================================
    console.log("\n--- EXPLAIN BEFORE INDEXING: Type Filtered History ---");
    const explainBeforeType = await LedgerEntry.find({ userId: user._id, type: "DEPOSIT" })
      .sort({ createdAt: -1, _id: -1 })
      .limit(21)
      .explain("executionStats");

    const statsBeforeType = explainBeforeType.executionStats;
    const planBeforeType = explainBeforeType.queryPlanner.winningPlan;

    console.log("Winning Plan Stage (Before, Type):", planBeforeType.stage);
    console.log("totalDocsExamined (Before, Type):", statsBeforeType.totalDocsExamined);
    console.log("nReturned (Before, Type):", statsBeforeType.nReturned);
    console.log("executionTimeMillis (Before, Type):", statsBeforeType.executionTimeMillis);

    // =========================================================================
    // ADD COMPOUND INDEXES
    // =========================================================================
    console.log("\nAdding compound indexes...");
    await collection.createIndex({ userId: 1, createdAt: -1, _id: -1 });
    await collection.createIndex({ userId: 1, type: 1, createdAt: -1, _id: -1 });
    console.log("Compound indexes created successfully.");

    // =========================================================================
    // AFTER INDEXING: Query 1 (Main History Query)
    // =========================================================================
    console.log("\n--- EXPLAIN AFTER INDEXING: Main History ---");
    const explainAfterMain = await LedgerEntry.find({ userId: user._id })
      .sort({ createdAt: -1, _id: -1 })
      .limit(21)
      .explain("executionStats");

    const statsAfterMain = explainAfterMain.executionStats;
    const planAfterMain = explainAfterMain.queryPlanner.winningPlan;

    console.log("Winning Plan Stage (After):", planAfterMain.stage);
    console.log("totalDocsExamined (After):", statsAfterMain.totalDocsExamined);
    console.log("nReturned (After):", statsAfterMain.nReturned);
    console.log("executionTimeMillis (After):", statsAfterMain.executionTimeMillis);

    // =========================================================================
    // AFTER INDEXING: Query 2 (Type-Filtered History Query)
    // =========================================================================
    console.log("\n--- EXPLAIN AFTER INDEXING: Type Filtered History ---");
    const explainAfterType = await LedgerEntry.find({ userId: user._id, type: "DEPOSIT" })
      .sort({ createdAt: -1, _id: -1 })
      .limit(21)
      .explain("executionStats");

    const statsAfterType = explainAfterType.executionStats;
    const planAfterType = explainAfterType.queryPlanner.winningPlan;

    console.log("Winning Plan Stage (After, Type):", planAfterType.stage);
    console.log("totalDocsExamined (After, Type):", statsAfterType.totalDocsExamined);
    console.log("nReturned (After, Type):", statsAfterType.nReturned);
    console.log("executionTimeMillis (After, Type):", statsAfterType.executionTimeMillis);

    return {
      beforeMain: { stats: statsBeforeMain, plan: planBeforeMain },
      beforeType: { stats: statsBeforeType, plan: planBeforeType },
      afterMain: { stats: statsAfterMain, plan: planAfterMain },
      afterType: { stats: statsAfterType, plan: planAfterType },
    };
  } finally {
    await mongoose.disconnect();
    await replSet.stop();
  }
}

runExplainBenchmark()
  .then(() => {
    console.log("\nBenchmark complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Benchmark error:", err);
    process.exit(1);
  });

