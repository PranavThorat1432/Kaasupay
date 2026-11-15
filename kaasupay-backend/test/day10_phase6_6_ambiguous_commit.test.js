// test/day10_phase6_6_ambiguous_commit.test.js — AutoPay Ambiguous MongoDB Commit Recovery Suite
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env") });

const mongoose = (await import("mongoose")).default;
const Mandate = (await import("../models/mandateModel.js")).default;
const MandateRun = (await import("../models/mandateRunModel.js")).default;
const Wallet = (await import("../models/walletModel.js")).default;
const Transaction = (await import("../models/transactionModel.js")).default;
const LedgerEntry = (await import("../models/ledgerEntryModel.js")).default;
const User = (await import("../models/userModel.js")).default;
const { processDueMandatePayment } = await import("../services/autopayService.js");

let passedAssertions = 0;
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passedAssertions += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name} -> ${detail}`);
  }
}

async function main() {
  console.log("===============================================================================");
  console.log("=== KAASUPAY DAY 10 PHASE 6.6: AMBIGUOUS COMMIT RECOVERY REGRESSION SUITE ===");
  console.log("===============================================================================\n");

  // Spin up dedicated isolated in-memory replica set
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const mongoUri = replSet.getUri();
  await mongoose.connect(mongoUri, { dbName: "test_ambiguous_recovery" });

  try {
    // Setup users & wallets
    const uPayer = await User.create({
      username: "payer_ambig@test.local",
      passwordHash: "dummy_hash_123",
      firstName: "Arun",
      lastName: "Kumar",
      paymentPin: {
        hash: "dummy_hash",
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    const uPayee = await User.create({
      username: "payee_ambig@test.local",
      passwordHash: "dummy_hash_123",
      firstName: "Bala",
      lastName: "Murugan",
    });

    const wPayer = await Wallet.create({
      userId: uPayer._id,
      balance: 1000000, // ₹10,000 in paise
    });

    const wPayee = await Wallet.create({
      userId: uPayee._id,
      balance: 0,
    });

    // =========================================================================
    // Step 2: Successful Commit With Ambiguous Client Error
    // =========================================================================
    console.log("--- Step 2: Successful Commit With Ambiguous Client Error ---");

    const mandate1 = await Mandate.create({
      payerId: uPayer._id,
      payeeId: uPayee._id,
      amount: 50000, // ₹500
      dayOfMonth: 5,
      status: "ACTIVE",
      nextRunDay: "2026-12-05",
      failedCount: 0,
    });

    // Intercept mongoose.startSession to simulate commit ambiguity AFTER genuine commit
    const originalStartSession = mongoose.startSession.bind(mongoose);
    let commitAmbiguityInjected = false;

    mongoose.startSession = async (...args) => {
      const session = await originalStartSession(...args);
      if (!commitAmbiguityInjected) {
        commitAmbiguityInjected = true;
        const originalWithTransaction = session.withTransaction.bind(session);

        session.withTransaction = async (fn) => {
          // 1. GENUINELY commit the transaction in MongoDB first
          await originalWithTransaction(fn);

          // 2. Immediately simulate the post-commit network disconnect / ambiguous driver error
          const ambiguousError = new Error("UnknownTransactionCommitResult: socket closed during commit acknowledgment");
          ambiguousError.name = "MongoServerError";
          ambiguousError.hasErrorLabel = (label) => label === "UnknownTransactionCommitResult";
          throw ambiguousError;
        };
      }
      return session;
    };

    // Execute payment with injected post-commit error
    const result1 = await processDueMandatePayment(mandate1, "2026-12-05");

    // Restore original startSession
    mongoose.startSession = originalStartSession;

    check("Post-commit error returns outcome 'SUCCESS'", result1.outcome === "SUCCESS");
    check("Result indicates recovered: true", result1.recovered === true);
    check("Result contains recovered MandateRun record", Boolean(result1.run));
    check("Recovered MandateRun status is SUCCESS", result1.run?.status === "SUCCESS");

    // Verify financial integrity after ambiguous commit recovery
    const payerWallet1 = await Wallet.findById(wPayer._id);
    const payeeWallet1 = await Wallet.findById(wPayee._id);
    check("Payer debited exactly once (balance 950,000 paise)", payerWallet1.balance === 950000);
    check("Payee credited exactly once (balance 50,000 paise)", payeeWallet1.balance === 50000);

    const totalTxns1 = await Transaction.countDocuments({ note: "AutoPay" });
    check("Exactly one transaction record exists in database", totalTxns1 === 1);

    const debitEntries1 = await LedgerEntry.countDocuments({ userId: uPayer._id, direction: "DEBIT" });
    const creditEntries1 = await LedgerEntry.countDocuments({ userId: uPayee._id, direction: "CREDIT" });
    check("Exactly one DEBIT ledger entry exists", debitEntries1 === 1);
    check("Exactly one CREDIT ledger entry exists", creditEntries1 === 1);

    const updatedMandate1 = await Mandate.findById(mandate1._id);
    check("Mandate nextRunDay advanced exactly once (to 2027-01-05)", updatedMandate1.nextRunDay === "2027-01-05");
    check("Mandate failedCount is 0", updatedMandate1.failedCount === 0);

    const totalRuns1 = await MandateRun.countDocuments({ mandateId: mandate1._id, dueDay: "2026-12-05" });
    check("Exactly one MandateRun document exists in database for this cycle", totalRuns1 === 1);

    // =========================================================================
    // Step 3: Aborted Transaction With Ambiguous Error
    // =========================================================================
    console.log("\n--- Step 3: Aborted Transaction With Ambiguous Error ---");

    const mandate2 = await Mandate.create({
      payerId: uPayer._id,
      payeeId: uPayee._id,
      amount: 40000, // ₹400
      dayOfMonth: 12,
      status: "ACTIVE",
      nextRunDay: "2026-12-12",
      failedCount: 0,
    });

    const payerBalanceBefore2 = (await Wallet.findById(wPayer._id)).balance;
    const payeeBalanceBefore2 = (await Wallet.findById(wPayee._id)).balance;

    // Simulate an ambiguous commit error where the transaction did NOT commit (aborted on server)
    let abortAmbiguityInjected = false;
    mongoose.startSession = async (...args) => {
      const session = await originalStartSession(...args);
      if (!abortAmbiguityInjected) {
        abortAmbiguityInjected = true;
        const originalWithTransaction = session.withTransaction.bind(session);

        session.withTransaction = async (fn) => {
          // Transaction throws before commit succeeds, simulating server-side abort
          const abortError = new Error("UnknownTransactionCommitResult: transaction aborted due to node failover");
          abortError.name = "MongoServerError";
          abortError.hasErrorLabel = (label) => label === "UnknownTransactionCommitResult";
          throw abortError;
        };
      }
      return session;
    };

    const result2 = await processDueMandatePayment(mandate2, "2026-12-12");
    mongoose.startSession = originalStartSession;

    check("Aborted ambiguous transaction returns outcome 'ERROR'", result2.outcome === "ERROR");
    check("Error category is 'TRANSIENT_INFRASTRUCTURE'", result2.category === "TRANSIENT_INFRASTRUCTURE");

    const runDoc2 = await MandateRun.findOne({ mandateId: mandate2._id, dueDay: "2026-12-12" });
    check("No MandateRun document exists for aborted transaction", runDoc2 === null);

    const payerWallet2 = await Wallet.findById(wPayer._id);
    const payeeWallet2 = await Wallet.findById(wPayee._id);
    check("No funds debited from payer (balance unchanged)", payerWallet2.balance === payerBalanceBefore2);
    check("No funds credited to payee (balance unchanged)", payeeWallet2.balance === payeeBalanceBefore2);

    const updatedMandate2 = await Mandate.findById(mandate2._id);
    check("Mandate failedCount remains 0 (not treated as business failure)", updatedMandate2.failedCount === 0);
    check("Mandate nextRunDay remains unchanged at 2026-12-12 for retry", updatedMandate2.nextRunDay === "2026-12-12");

    // =========================================================================
    // Step 4: Recovery Lookup Failure (MongoDB Completely Unreachable)
    // =========================================================================
    console.log("\n--- Step 4: Recovery Lookup Failure Handling ---");

    const mandate3 = await Mandate.create({
      payerId: uPayer._id,
      payeeId: uPayee._id,
      amount: 30000,
      dayOfMonth: 18,
      status: "ACTIVE",
      nextRunDay: "2026-12-18",
      failedCount: 0,
    });

    // Intercept MandateRun.findOne to throw network error during recovery lookup
    const originalFindOne = MandateRun.findOne.bind(MandateRun);
    let findOneInjected = false;

    MandateRun.findOne = (...args) => {
      if (!findOneInjected) {
        findOneInjected = true;
        throw new Error("MongoNetworkError: connection closed during recovery check");
      }
      return originalFindOne(...args);
    };

    let lookupAmbiguityInjected = false;
    mongoose.startSession = async (...args) => {
      const session = await originalStartSession(...args);
      if (!lookupAmbiguityInjected) {
        lookupAmbiguityInjected = true;
        session.withTransaction = async () => {
          const err = new Error("UnknownTransactionCommitResult: socket drop");
          err.hasErrorLabel = (l) => l === "UnknownTransactionCommitResult";
          throw err;
        };
      }
      return session;
    };

    const result3 = await processDueMandatePayment(mandate3, "2026-12-18");
    MandateRun.findOne = originalFindOne;
    mongoose.startSession = originalStartSession;

    check("Lookup failure falls through cleanly to outcome 'ERROR'", result3.outcome === "ERROR");
    check("Category is 'TRANSIENT_INFRASTRUCTURE'", result3.category === "TRANSIENT_INFRASTRUCTURE");
    check("Does not falsely report SUCCESS", result3.outcome !== "SUCCESS");

    const updatedMandate3 = await Mandate.findById(mandate3._id);
    check("Mandate failedCount remains 0", updatedMandate3.failedCount === 0);
    check("Mandate nextRunDay remains unchanged for safe retry", updatedMandate3.nextRunDay === "2026-12-18");

    // =========================================================================
    // Step 5: Concurrency and Retry Behavior
    // =========================================================================
    console.log("\n--- Step 5: Concurrency and Retry Behavior ---");

    // Case A: Retrying the successfully recovered mandate (Mandate 1)
    // The previous run committed and nextRunDay is now 2027-01-05.
    // Retrying with the old dueDay (2026-12-05) must skip execution:
    const retryCommitted = await processDueMandatePayment(updatedMandate1, "2026-12-05");
    check("Retrying previously committed mandate returns SKIPPED", retryCommitted.outcome === "SKIPPED");

    const finalPayerBalance1 = (await Wallet.findById(wPayer._id)).balance;
    check("Payer balance not debited on retry of committed mandate", finalPayerBalance1 === payerWallet1.balance);

    const totalRunsMandate1 = await MandateRun.countDocuments({ mandateId: mandate1._id });
    check("Total MandateRun documents remains exactly 1", totalRunsMandate1 === 1);

    // Case B: Retrying the previously aborted mandate (Mandate 2)
    // Mandate 2 is still at nextRunDay: 2026-12-12 and failedCount: 0.
    // When retried without errors, it must succeed cleanly:
    const retryAborted = await processDueMandatePayment(updatedMandate2, "2026-12-12");
    check("Retrying previously aborted mandate succeeds cleanly", retryAborted.outcome === "SUCCESS");
    check("Retry creates transaction record", Boolean(retryAborted.transaction));

    const payerWalletAfterRetry2 = await Wallet.findById(wPayer._id);
    check("Payer debited for retried mandate (950,000 - 40,000 = 910,000)", payerWalletAfterRetry2.balance === 910000);

    const runDocRetry2 = await MandateRun.findOne({ mandateId: mandate2._id, dueDay: "2026-12-12" });
    check("MandateRun document created with status SUCCESS upon clean retry", runDocRetry2?.status === "SUCCESS");

    const updatedMandateAfterRetry2 = await Mandate.findById(mandate2._id);
    check("Mandate nextRunDay advanced to next cycle (2027-01-12)", updatedMandateAfterRetry2.nextRunDay === "2027-01-12");

  } finally {
    await mongoose.disconnect();
    await replSet.stop();
  }

  console.log("\n===============================================================================");
  console.log(`=== DAY 10 PHASE 6.6 TEST SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED ===`);
  console.log("===============================================================================");

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
