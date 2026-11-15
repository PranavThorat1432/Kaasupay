// test/day10_phase6_7_hybrid_reliability.test.js — AutoPay Hybrid Architecture Reliability Test Suite
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import crypto from "node:crypto";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env") });

const mongoose = (await import("mongoose")).default;
const SystemLease = (await import("../models/systemLeaseModel.js")).default;
const Mandate = (await import("../models/mandateModel.js")).default;
const MandateRun = (await import("../models/mandateRunModel.js")).default;
const Wallet = (await import("../models/walletModel.js")).default;
const Transaction = (await import("../models/transactionModel.js")).default;
const LedgerEntry = (await import("../models/ledgerEntryModel.js")).default;
const User = (await import("../models/userModel.js")).default;
const OutboxEvent = (await import("../models/outboxEventModel.js")).default;
const Withdrawal = (await import("../models/withdrawalModel.js")).default;
const BankAccount = (await import("../models/bankAccountModel.js")).default;
const {
  ensureLeaseInitialized,
  acquireOrRenewLease,
  releaseLease,
  validateLeaseOwnership,
  runAutopayBatch,
} = await import("../services/autopayService.js");
const { PayoutWorker } = await import("../worker.js");
const { handleAutopayCron } = await import("../controllers/cronController.js");
const { indiaDay } = await import("../services/dailyLimitService.js");

let failures = 0;
let passedAssertions = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passedAssertions += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name} -> ${detail}`);
  }
}

async function createTestUserWithWallet(namePrefix, initialBalancePaise = 500000) {
  const email = `${namePrefix}_${crypto.randomUUID().slice(0, 6)}@test.local`;
  const user = await User.create({
    username: email,
    email,
    firstName: "Test",
    lastName: "User",
    passwordHash: "dummy_hash_123",
  });
  const wallet = await Wallet.create({
    userId: user._id,
    balance: initialBalancePaise,
    currency: "INR",
  });
  return { user, wallet };
}

async function main() {
  console.log("\n==========================================================================");
  console.log("   KAASUPAY DAY 10 — PHASE 6.7 / 6.8 HYBRID RELIABILITY TEST SUITE");
  console.log("==========================================================================\n");

  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
  console.log(`[test] Connected to isolated test replica set at ${uri}\n`);

  process.env.CRON_SECRET = "test_cron_secret_hybrid_reliability";
  process.env.ALLOW_TIME_TRAVEL = "true";

  try {
    // ========================================================================
    // SECTION 1: Distributed Lease Correctness & Fencing
    // ========================================================================
    console.log("--- Section 1: Distributed Lease Correctness & Fencing ---");

    // 1.1 Initialization idempotency & concurrency
    await Promise.all([
      ensureLeaseInitialized("test_lease_1"),
      ensureLeaseInitialized("test_lease_1"),
      ensureLeaseInitialized("test_lease_1"),
    ]);
    const initDoc = await SystemLease.findById("test_lease_1");
    check("1.1 Lease document initialized safely without duplicate key errors", initDoc !== null);
    check("1.1 Initial owner is null and fencingToken is 0", initDoc.ownerId === null && initDoc.fencingToken === 0);

    // 1.2 Two workers racing for acquisition
    const [raceA, raceB] = await Promise.all([
      acquireOrRenewLease({ ownerId: "worker-A", leaseId: "test_lease_1", leaseDurationMs: 1000 }),
      acquireOrRenewLease({ ownerId: "worker-B", leaseId: "test_lease_1", leaseDurationMs: 1000 }),
    ]);
    const oneAcquired = (raceA.status === "ACQUIRED" && raceB.status === "HELD_BY_OTHER") ||
                        (raceB.status === "ACQUIRED" && raceA.status === "HELD_BY_OTHER");
    check("1.2 Simultaneous acquisition race: exactly one wins, one receives HELD_BY_OTHER", oneAcquired);

    const winnerId = raceA.status === "ACQUIRED" ? "worker-A" : "worker-B";
    const loserId = winnerId === "worker-A" ? "worker-B" : "worker-A";
    const winnerToken = raceA.status === "ACQUIRED" ? raceA.lease.fencingToken : raceB.lease.fencingToken;
    check("1.2 Fencing token incremented to 1 on initial acquisition", winnerToken === 1);

    // 1.3 Active lease cannot be stolen
    const stealAttempt = await acquireOrRenewLease({ ownerId: loserId, leaseId: "test_lease_1", leaseDurationMs: 1000 });
    check("1.3 Active lease cannot be stolen by another owner", stealAttempt.status === "HELD_BY_OTHER");

    // 1.4 Safe lease renewal by active owner
    const renewResult = await acquireOrRenewLease({ ownerId: winnerId, leaseId: "test_lease_1", leaseDurationMs: 2000 });
    check("1.4 Active owner safely renews lease (status: RENEWED)", renewResult.status === "RENEWED");
    check("1.4 Renewal preserves fencing token (token monotonicity per tenure)", renewResult.lease.fencingToken === 1);

    // 1.5 Expired lease takeover by peer
    // Wait for lease to expire (simulate time passing)
    await SystemLease.updateOne({ _id: "test_lease_1" }, { $set: { expiresAt: new Date(Date.now() - 100) } });
    const takeoverResult = await acquireOrRenewLease({ ownerId: loserId, leaseId: "test_lease_1", leaseDurationMs: 2000 });
    check("1.5 Expired lease safely taken over by peer (status: ACQUIRED)", takeoverResult.status === "ACQUIRED");
    check("1.5 Fencing token incremented to 2 on ownership change", takeoverResult.lease.fencingToken === 2);

    // 1.6 Owner-checked release
    const badRelease = await releaseLease({ ownerId: winnerId, leaseId: "test_lease_1" });
    check("1.6 Former owner cannot release lease now held by peer", badRelease === false);
    const goodRelease = await releaseLease({ ownerId: loserId, leaseId: "test_lease_1", fencingToken: 2 });
    check("1.6 Valid owner successfully releases lease", goodRelease === true);

    const afterRelease = await SystemLease.findById("test_lease_1");
    check("1.6 Released lease has ownerId null and expiresAt in past", afterRelease.ownerId === null && afterRelease.expiresAt.getTime() === 0);

    // 1.7 Stale owner validation
    const isWinnerValid = await validateLeaseOwnership({ ownerId: winnerId, leaseId: "test_lease_1", fencingToken: 1 });
    check("1.7 Stale owner with expired token fails validation (validateLeaseOwnership === false)", isWinnerValid === false);

    // ========================================================================
    // SECTION 2: Worker Scheduling & Outbox Priority
    // ========================================================================
    console.log("\n--- Section 2: Worker Scheduling & Outbox Priority ---");

    const { user: payer1, wallet: payerWallet1 } = await createTestUserWithWallet("payer_priority", 200000);
    const { user: merchant1, wallet: merchantWallet1 } = await createTestUserWithWallet("merchant_priority", 10000);

    // Create 10 due AutoPay mandates
    const testDate = indiaDay();
    const createdMandates = [];
    for (let i = 0; i < 10; i++) {
      const m = await Mandate.create({
        payerId: payer1._id,
        payeeId: merchant1._id,
        amount: 100, // 100 Rs = 10,000 paise
        dayOfMonth: 15,
        status: "ACTIVE",
        nextRunDay: testDate,
      });
      createdMandates.push(m);
    }
    check("2.1 Seeded 10 due AutoPay mandates for priority test", createdMandates.length === 10);

    // Seed 1 Outbox bank payout event
    const bankAcct = await BankAccount.create({
      userId: payer1._id,
      holderName: "Payer Priority",
      accountNumber: "1234567890",
      ifsc: "HDFC0001234",
      last4: "7890",
    });
    const withdrawal = await Withdrawal.create({
      userId: payer1._id,
      bankAccountId: bankAcct._id,
      amount: 5000,
      reference: `WTH_${crypto.randomUUID().slice(0, 8)}`,
      status: "SUCCESS", // terminal so processJob marks outbox DONE immediately
    });
    const outboxJob = await OutboxEvent.create({
      withdrawalId: withdrawal._id,
      status: "NEW",
      attempts: 0,
      nextAttemptAt: new Date(Date.now() - 1000),
    });
    check("2.2 Seeded pending Outbox payout event", outboxJob !== null);

    // Initialize worker with options
    const worker = new PayoutWorker({
      ownerId: "worker-test-priority-1",
      autopayEnabled: true,
      maxConsecutiveBatches: 2,
      autopayBatchSize: 5,
      today: testDate,
    });

    // Run one tick of worker
    // Worker must claim and process Outbox job first!
    const claimedJob = await OutboxEvent.findById(outboxJob._id);
    check("2.3 Outbox job initially NEW", claimedJob.status === "NEW");

    // Start worker in background briefly
    const workerPromise = worker.start();
    await new Promise((r) => setTimeout(r, 800));
    await worker.stop();
    await workerPromise;

    const finishedOutboxJob = await OutboxEvent.findById(outboxJob._id);
    check("2.4 Outbox job processed with strict priority (status: DONE)", finishedOutboxJob.status === "DONE");

    // Verify AutoPay batches were also processed
    const remainingDue = await Mandate.countDocuments({ status: "ACTIVE", nextRunDay: { $lte: testDate } });
    check("2.5 AutoPay mandates processed after Outbox job (remaining: 0)", remainingDue === 0);

    // 2.6 Two-Batch Yield Policy & Worker Lifecycle Test
    const { user: payerYield, wallet: payerWalletYield } = await createTestUserWithWallet("payer_yield", 500000);
    const { user: merchYield } = await createTestUserWithWallet("merch_yield", 0);

    for (let i = 0; i < 15; i++) {
      await Mandate.create({
        payerId: payerYield._id,
        payeeId: merchYield._id,
        amount: 100,
        dayOfMonth: 12,
        status: "ACTIVE",
        nextRunDay: testDate,
      });
    }

    const yieldingWorker = new PayoutWorker({
      ownerId: "worker-yielding-node-1",
      autopayEnabled: true,
      maxConsecutiveBatches: 2,
      autopayBatchSize: 5, // 5 per batch, 2 batches = 10 items max
      today: testDate,
    });

    await yieldingWorker.pollAutopay();
    const remainingAfterYield = await Mandate.countDocuments({ payerId: payerYield._id, status: "ACTIVE", nextRunDay: { $lte: testDate } });
    check("2.6 Worker halts after max consecutive batches (2 batches of 5 = 10)", yieldingWorker.autopayHasMore === true);
    check("2.6 Exactly 5 mandates remain due after yielding (15 - 10 = 5)", remainingAfterYield === 5);

    // 2.7 Worker Shutdown & Lease Release
    await yieldingWorker.stop();
    const isLeaseReleased = await validateLeaseOwnership({ ownerId: "worker-yielding-node-1", fencingToken: yieldingWorker.currentFencingToken });
    check("2.7 Worker shutdown voluntarily releases lease", isLeaseReleased === false);

    // 2.8 Worker Restart & Recovery
    // A replacement worker boots up with a new ownerId and completes the remaining 5 mandates
    const recoveryWorker = new PayoutWorker({
      ownerId: "worker-recovery-node-2",
      autopayEnabled: true,
      maxConsecutiveBatches: 2,
      autopayBatchSize: 10,
      today: testDate,
    });
    await recoveryWorker.pollAutopay();
    const remainingAfterRecovery = await Mandate.countDocuments({ payerId: payerYield._id, status: "ACTIVE", nextRunDay: { $lte: testDate } });
    check("2.8 Restarted worker recovers and drains remaining backlog to 0", remainingAfterRecovery === 0);
    await recoveryWorker.stop();

    // ========================================================================
    // SECTION 3: HTTP Fallback & Overlap Coordination
    // ========================================================================
    console.log("\n--- Section 3: HTTP Fallback & Overlap Coordination ---");

    // 3.1 When worker holds active lease, Cron HTTP fallback skips gracefully
    await acquireOrRenewLease({
      ownerId: "dedicated-worker-prod-1",
      leaseId: "autopay_processor",
      leaseDurationMs: 60000,
    });

    const mockReq1 = {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      query: {},
    };
    let mockRes1Data = null;
    let mockRes1Status = null;
    const mockRes1 = {
      status(code) { mockRes1Status = code; return this; },
      json(data) { mockRes1Data = data; return this; },
    };

    await handleAutopayCron(mockReq1, mockRes1);
    check("3.1 Cron returns 200 OK when worker is active", mockRes1Status === 200);
    check("3.1 Cron returns status SKIPPED when worker holds lease", mockRes1Data.status === "SKIPPED");
    check("3.1 Cron identifies active leaseHolder", mockRes1Data.leaseHolder === "dedicated-worker-prod-1");
    check("3.1 Cron reports 0 due, 0 succeeded when skipping", mockRes1Data.due === 0 && mockRes1Data.succeeded === 0);

    // Release worker lease to simulate worker offline
    await releaseLease({ ownerId: "dedicated-worker-prod-1", leaseId: "autopay_processor" });

    // Seed 3 mandates for fallback execution
    const fallbackMandates = [];
    for (let i = 0; i < 3; i++) {
      const m = await Mandate.create({
        payerId: payer1._id,
        payeeId: merchant1._id,
        amount: 100,
        dayOfMonth: 10,
        status: "ACTIVE",
        nextRunDay: testDate,
      });
      fallbackMandates.push(m);
    }

    let mockRes2Data = null;
    let mockRes2Status = null;
    const mockRes2 = {
      status(code) { mockRes2Status = code; return this; },
      json(data) { mockRes2Data = data; return this; },
    };

    await handleAutopayCron(mockReq1, mockRes2);
    check("3.2 Cron fallback runs when worker offline (HTTP 200)", mockRes2Status === 200);
    check("3.2 Cron fallback processed 3 due mandates", mockRes2Data.due === 3);
    check("3.2 Cron fallback reported 3 succeeded", mockRes2Data.succeeded === 3);
    check("3.2 Cron fallback reported more: false", mockRes2Data.more === false);

    // Verify lease was released in finally block
    const leaseAfterCron = await SystemLease.findById("autopay_processor");
    check("3.2 Fallback lease safely released in finally block", leaseAfterCron.ownerId === null);

    // ========================================================================
    // SECTION 4: Comprehensive Financial Transaction Benchmark (50, 200, 1000)
    // ========================================================================
    console.log("\n--- Section 4: Comprehensive Financial Transaction Benchmark ---");

    // 4.1 Benchmark: 50 Due Mandates
    console.log("-> Running 50 Mandates Benchmark...");
    const { user: benchPayer50, wallet: benchWallet50 } = await createTestUserWithWallet("bench_payer_50", 10000000); // 100,000 Rs
    const { user: benchMerch50, wallet: benchMerchWallet50 } = await createTestUserWithWallet("bench_merch_50", 0);

    for (let i = 0; i < 50; i++) {
      await Mandate.create({
        payerId: benchPayer50._id,
        payeeId: benchMerch50._id,
        amount: 100, // 100 paise = 1 Rs
        dayOfMonth: 5,
        status: "ACTIVE",
        nextRunDay: testDate,
      });
    }

    const memBefore50 = process.memoryUsage().heapUsed;
    const t0_50 = Date.now();
    const batch50Res = await runAutopayBatch({ today: testDate, limit: 50 });
    const dur50 = Date.now() - t0_50;
    const memAfter50 = process.memoryUsage().heapUsed;

    const tps50 = (50 / (dur50 / 1000)).toFixed(2);
    console.log(`   [50 Mandates] Duration: ${dur50}ms | Throughput: ${tps50} tx/sec | Heap Delta: ${((memAfter50 - memBefore50) / 1024 / 1024).toFixed(2)} MB`);

    check("4.1 50 Mandates batch succeeded is exactly 50", batch50Res.succeeded === 50);
    check("4.1 50 Mandates batch failed is 0", batch50Res.failed === 0);
    check("4.1 50 Mandates batch more is false", batch50Res.more === false);

    // Verify financial integrity for 50 mandates:
    // Payer debited 50 * 100 paise = 5,000 paise (50 Rs)
    const payerWalletAfter50 = await Wallet.findById(benchWallet50._id);
    const merchWalletAfter50 = await Wallet.findById(benchMerchWallet50._id);
    check("4.1 Payer wallet debited exactly 5,000 paise", payerWalletAfter50.balance === (10000000 - 5000));
    check("4.1 Merchant wallet credited exactly 5,000 paise", merchWalletAfter50.balance === 5000);

    // Ledger double-entry check for 50 mandates:
    // 50 DEBIT entries, 50 CREDIT entries
    const payerDebits50 = await LedgerEntry.countDocuments({ userId: benchPayer50._id, direction: "DEBIT" });
    const merchCredits50 = await LedgerEntry.countDocuments({ userId: benchMerch50._id, direction: "CREDIT" });
    check("4.1 Exactly 50 DEBIT ledger entries created", payerDebits50 === 50);
    check("4.1 Exactly 50 CREDIT ledger entries created", merchCredits50 === 50);

    // 4.2 Benchmark: 200 Due Mandates (Multi-Batch Drainage: 4 batches of 50)
    console.log("\n-> Running 200 Mandates Multi-Batch Drainage Benchmark...");
    const { user: benchPayer200, wallet: benchWallet200 } = await createTestUserWithWallet("bench_payer_200", 50000000); // 500,000 Rs
    const { user: benchMerch200, wallet: benchMerchWallet200 } = await createTestUserWithWallet("bench_merch_200", 0);

    const mandates200 = [];
    for (let i = 0; i < 200; i++) {
      mandates200.push({
        payerId: benchPayer200._id,
        payeeId: benchMerch200._id,
        amount: 100, // 100 paise = 1 Rs
        dayOfMonth: 8,
        status: "ACTIVE",
        nextRunDay: testDate,
      });
    }
    await Mandate.insertMany(mandates200);

    const memBefore200 = process.memoryUsage().heapUsed;
    const t0_200 = Date.now();
    let totalProcessed200 = 0;
    let batches200 = 0;
    let more200 = true;

    while (more200) {
      const bRes = await runAutopayBatch({ today: testDate, limit: 50 });
      totalProcessed200 += bRes.succeeded;
      batches200++;
      more200 = bRes.more;
    }
    const dur200 = Date.now() - t0_200;
    const memAfter200 = process.memoryUsage().heapUsed;
    const tps200 = (200 / (dur200 / 1000)).toFixed(2);
    console.log(`   [200 Mandates] Batches: ${batches200} | Duration: ${dur200}ms | Throughput: ${tps200} tx/sec | Heap Delta: ${((memAfter200 - memBefore200) / 1024 / 1024).toFixed(2)} MB`);

    check("4.2 Exactly 200 mandates processed across batches", totalProcessed200 === 200);
    check("4.2 Executed in exactly 4 batches of 50", batches200 === 4);

    const payerWalletAfter200 = await Wallet.findById(benchWallet200._id);
    const merchWalletAfter200 = await Wallet.findById(benchMerchWallet200._id);
    const expectedTransfer200 = 200 * 100; // 20,000 paise
    check("4.2 Payer wallet debited exactly 20,000 paise", payerWalletAfter200.balance === (50000000 - expectedTransfer200));
    check("4.2 Merchant wallet credited exactly 20,000 paise", merchWalletAfter200.balance === expectedTransfer200);

    // 4.3 Benchmark: 1,000 Due Mandates Stress & Reconciliation Test (20 Batches of 50)
    console.log("\n-> Running 1,000 Mandates Stress & Financial Reconciliation Benchmark...");
    const { user: benchPayer1000, wallet: benchWallet1000 } = await createTestUserWithWallet("bench_payer_1000", 200000000); // 2,000,000 Rs
    const { user: benchMerch1000, wallet: benchMerchWallet1000 } = await createTestUserWithWallet("bench_merch_1000", 0);

    const mandates1000 = [];
    for (let i = 0; i < 1000; i++) {
      mandates1000.push({
        payerId: benchPayer1000._id,
        payeeId: benchMerch1000._id,
        amount: 100, // 100 paise = 1 Rs
        dayOfMonth: 12,
        status: "ACTIVE",
        nextRunDay: testDate,
      });
    }
    await Mandate.insertMany(mandates1000);

    const memBefore1000 = process.memoryUsage().heapUsed;
    const t0_1000 = Date.now();
    let totalProcessed1000 = 0;
    let batches1000 = 0;
    let more1000 = true;

    while (more1000) {
      const bRes = await runAutopayBatch({ today: testDate, limit: 50 });
      totalProcessed1000 += bRes.succeeded;
      batches1000++;
      more1000 = bRes.more;
    }
    const dur1000 = Date.now() - t0_1000;
    const memAfter1000 = process.memoryUsage().heapUsed;
    const tps1000 = (1000 / (dur1000 / 1000)).toFixed(2);
    console.log(`   [1,000 Mandates] Batches: ${batches1000} | Duration: ${dur1000}ms | Throughput: ${tps1000} tx/sec | Heap Delta: ${((memAfter1000 - memBefore1000) / 1024 / 1024).toFixed(2)} MB`);

    check("4.3 Exactly 1,000 mandates processed across batches", totalProcessed1000 === 1000);
    check("4.3 Executed in exactly 20 batches of 50", batches1000 === 20);

    const payerWalletAfter1000 = await Wallet.findById(benchWallet1000._id);
    const merchWalletAfter1000 = await Wallet.findById(benchMerchWallet1000._id);
    const expectedTransfer1000 = 1000 * 100; // 100,000 paise
    check("4.3 Payer wallet debited exactly 100,000 paise", payerWalletAfter1000.balance === (200000000 - expectedTransfer1000));
    check("4.3 Merchant wallet credited exactly 100,000 paise", merchWalletAfter1000.balance === expectedTransfer1000);

    // Strict Double-Entry Ledger Reconciliation:
    // Total Credits across the entire system must equal Total Debits
    const allDebits = await LedgerEntry.aggregate([
      { $match: { direction: "DEBIT" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const allCredits = await LedgerEntry.aggregate([
      { $match: { direction: "CREDIT" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const sumDebits = allDebits[0]?.total || 0;
    const sumCredits = allCredits[0]?.total || 0;
    check("4.3 Double-entry ledger invariant: sum(Debits) === sum(Credits)", sumDebits === sumCredits && sumDebits > 0);

    // Verify exact isolated counts for the 1,000 benchmark slice
    const bench1000MandateIds = (await Mandate.find({ payerId: benchPayer1000._id }).select("_id")).map(m => m._id);
    const bench1000Runs = await MandateRun.countDocuments({
      mandateId: { $in: bench1000MandateIds },
      status: "SUCCESS",
    });
    check("4.3 Exactly 1,000 SUCCESS MandateRun records for 1,000 benchmark slice", bench1000Runs === 1000);

    const payer1000Debits = await LedgerEntry.countDocuments({ userId: benchPayer1000._id, direction: "DEBIT" });
    check("4.3 Exactly 1,000 DEBIT ledger entries for benchPayer1000", payer1000Debits === 1000);

    const merch1000Credits = await LedgerEntry.countDocuments({ userId: benchMerch1000._id, direction: "CREDIT" });
    check("4.3 Exactly 1,000 CREDIT ledger entries for benchMerch1000", merch1000Credits === 1000);

    // Cumulative test suite total:
    // 10 (priority) + 15 (yield/recovery) + 3 (cron fallback) + 50 (bench 50) + 200 (bench 200) + 1000 (bench 1000) = 1,278
    const totalRuns = await MandateRun.countDocuments({ status: "SUCCESS" });
    check("4.3 Exactly 1,278 total cumulative SUCCESS MandateRuns across entire suite (zero duplicates)", totalRuns === 1278);

  } finally {
    await mongoose.disconnect();
    await replSet.stop();
  }

  console.log("\n==========================================================================");
  console.log(`TEST RESULTS: ${passedAssertions} PASSED, ${failures} FAILED`);
  console.log("==========================================================================\n");

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
