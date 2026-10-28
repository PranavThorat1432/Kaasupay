// test/withdrawal_root_cause_and_recovery.test.js
// Acceptance test suite verifying:
// 1. Successful withdrawal (Happy path)
// 2. Definitive bank refusal (Compensating reversal with CREDIT ledger entry)
// 3. Bank unavailable (Retries, no premature refund, safe parking in NEEDS_REVIEW)
// 4. Bank becomes available again (Pending payout recovers and completes)
// 5. Worker restart (Persisted outbox job recovered and processed)
// 6. Duplicate requests and concurrent workers (No double-debit, no duplicate payout)
// 7. Reversal idempotency (Repeat failure resolution never creates duplicate refund)
// 8. Financial reconciliation (moneyIsConserved is true across all states)
// 9. Staff manual resolution workflow (REFUND, CONFIRM_SUCCESS, bank status query, idempotency)

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import mongoose from "mongoose";
import http from "node:http";
import { createFakeBankApp } from "../tools/fake-bank.js";
import BankAccount from "../models/bankAccountModel.js";
import Withdrawal from "../models/withdrawalModel.js";
import OutboxEvent from "../models/outboxEventModel.js";
import Wallet from "../models/walletModel.js";
import Transaction from "../models/transactionModel.js";
import LedgerEntry from "../models/ledgerEntryModel.js";
import { claimNextJob, processJob } from "../worker.js";
import { reverseWithdrawal } from "../services/money.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3319;
const BASE = `http://localhost:${PORT}`;
const FAKE_BANK_PORT = 4319;
const BANK_URL = `http://localhost:${FAKE_BANK_PORT}`;
const ADMIN_KEY = "test_admin_key_root_cause_1432";
const JWT_SECRET = "test_jwt_secret_root_cause_recovery_32bytes_ok";
const ENCRYPTION_KEY = "test_enc_key_32bytes_shared_ok_1432";

let failures = 0;
let passedAssertions = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passedAssertions += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name} -> ${detail}`);
  }
}

function spawnServer(env = {}) {
  const child = spawn(process.execPath, ["index.js"], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  child.getOutput = () => output;
  return child;
}

async function waitForHealth(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.status === 200) return true;
    } catch {
      // waiting for server
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function run() {
  console.log("=== Starting Withdrawal Root Cause & Recovery Test Suite ===");

  // 1. In-memory replica set
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await replSet.waitUntilRunning();
  const mongoUri = replSet.getUri("kaasupay");

  // 2. Fake bank server
  const fakeBank = createFakeBankApp();
  const bankServer = http.createServer(fakeBank.app);
  await new Promise((resolve) => bankServer.listen(FAKE_BANK_PORT, resolve));
  console.log(`Fake bank listening on ${BANK_URL}`);

  // 3. Connect mongoose
  await mongoose.connect(mongoUri, { dbName: "kaasupay" });
  process.env.BANK_ENCRYPTION_KEY = ENCRYPTION_KEY;

  // 4. Spawn backend API with worker disabled so we control job execution steps
  const server = spawnServer({
    PORT: String(PORT),
    MONGO_URL: mongoUri,
    ADMIN_KEY,
    JWT_SECRET,
    BANK_URL,
    BANK_ENCRYPTION_KEY: ENCRYPTION_KEY,
    NODE_ENV: "development",
    DISABLE_WORKER: "true",
  });

  const healthy = await waitForHealth();
  if (!healthy) {
    console.error("Backend server failed to start:\n", server.getOutput());
    process.exit(1);
  }
  console.log("Backend server started and healthy.");

  try {
    // Helpers
    async function createUser(firstName, lastName, email, password) {
      const res = await fetch(`${BASE}/api/v1/user/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, username: email, password }),
      });
      return await res.json();
    }

    async function loginUser(email, password) {
      const res = await fetch(`${BASE}/api/v1/user/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email, password }),
      });
      const data = await res.json();
      return data.token;
    }

    async function staffDeposit(to, amount) {
      const res = await fetch(`${BASE}/api/v1/admin/deposit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": ADMIN_KEY,
        },
        body: JSON.stringify({ to, amount }),
      });
      return await res.json();
    }

    // Setup User and Wallet with ₹1,000 (100,000 paise)
    await createUser("Test", "User", "testuser@banktest.com", "Password123!");
    const token = await loginUser("testuser@banktest.com", "Password123!");
    await staffDeposit("testuser@banktest.com", 100000);

    // Add standard bank account
    const addAcc1 = await fetch(`${BASE}/api/v1/wallet/bank-accounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        holderName: "Test User",
        accountNumber: "112233445566",
        ifsc: "HDFC0001234",
      }),
    });
    const acc1Data = await addAcc1.json();
    const validAccId = acc1Data.id;

    // Add closed bank account (ending in 0000)
    const addAccClosed = await fetch(`${BASE}/api/v1/wallet/bank-accounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        holderName: "Test User",
        accountNumber: "998877660000",
        ifsc: "SBIN0001234",
      }),
    });
    const accClosedData = await addAccClosed.json();
    const closedAccId = accClosedData.id;

    // -------------------------------------------------------------------------
    // TEST 1: Successful withdrawal
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 1: Successful Withdrawal ---");
    const t1Req = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": "test1-wd-001",
      },
      body: JSON.stringify({ bankAccountId: validAccId, amount: 20000 }),
    });
    const t1Data = await t1Req.json();
    check("Test 1: Withdrawal returns 202 Accepted", t1Req.status === 202, `Status: ${t1Req.status}`);
    check("Test 1: Balance reserved (debited to 80000)", t1Data.balance === 80000, `Balance: ${t1Data.balance}`);

    const t1Job = await claimNextJob();
    check("Test 1: Worker claims job", Boolean(t1Job));
    const t1Res = await processJob(t1Job, { bankUrl: BANK_URL });
    check("Test 1: Bank payout returns SUCCESS", t1Res.status === "SUCCESS", JSON.stringify(t1Res));

    const t1Doc = await Withdrawal.findById(t1Data.withdrawal.id);
    check("Test 1: Withdrawal record is marked SUCCESS", t1Doc.status === "SUCCESS", t1Doc.status);
    check("Test 1: Bank UTR recorded", Boolean(t1Doc.bankRef?.startsWith("UTR")), t1Doc.bankRef);

    // -------------------------------------------------------------------------
    // TEST 2: Definitive bank refusal
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 2: Definitive Bank Refusal ---");
    const t2Req = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": "test2-wd-002",
      },
      body: JSON.stringify({ bankAccountId: closedAccId, amount: 15000 }),
    });
    const t2Data = await t2Req.json();
    check("Test 2: Closed account withdrawal returns 202", t2Req.status === 202);
    check("Test 2: Balance held to 65000", t2Data.balance === 65000, `Balance: ${t2Data.balance}`);

    const t2Job = await claimNextJob();
    const t2Res = await processJob(t2Job, { bankUrl: BANK_URL });
    check("Test 2: Worker reports REVERSED status", t2Res.status === "REVERSED", JSON.stringify(t2Res));

    const t2Doc = await Withdrawal.findById(t2Data.withdrawal.id);
    check("Test 2: Withdrawal status is REVERSED", t2Doc.status === "REVERSED");
    check("Test 2: failureReason recorded as 'Account closed'", t2Doc.failureReason === "Account closed");

    // Check wallet balance restored from 65000 to 80000
    const userWallet2 = await Wallet.findOne({ userId: t1Doc.userId });
    check("Test 2: Balance refunded back to 80000", userWallet2.balance === 80000, `Balance: ${userWallet2.balance}`);

    // Verify exactly 1 REVERSAL transaction and exactly 1 CREDIT ledger entry for this refund
    const reversalTxns = await Transaction.find({ toUserId: t1Doc.userId, type: "REVERSAL", amount: 15000 });
    check("Test 2: Exactly 1 REVERSAL transaction created", reversalTxns.length === 1, `Count: ${reversalTxns.length}`);

    const creditLedger = await LedgerEntry.find({ userId: t1Doc.userId, transactionId: reversalTxns[0]._id, direction: "CREDIT" });
    check("Test 2: Exactly 1 CREDIT ledger entry created", creditLedger.length === 1, `Count: ${creditLedger.length}`);

    // -------------------------------------------------------------------------
    // TEST 3: Bank unavailable
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 3: Bank Unavailable ---");
    fakeBank.setMode("down");

    const t3Req = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": "test3-wd-003",
      },
      body: JSON.stringify({ bankAccountId: validAccId, amount: 10000 }),
    });
    const t3Data = await t3Req.json();
    check("Test 3: API returns 202 even when bank is down", t3Req.status === 202);
    check("Test 3: Balance held to 70000", t3Data.balance === 70000);

    const t3Job = await claimNextJob();
    const t3Res = await processJob(t3Job, { bankUrl: BANK_URL, backoffBaseMs: 50 });
    check("Test 3: Worker schedules RETRY (not refund)", t3Res.status === "RETRY", JSON.stringify(t3Res));

    const userWallet3 = await Wallet.findOne({ userId: t1Doc.userId });
    check("Test 3: Funds NOT refunded while ambiguous/retrying", userWallet3.balance === 70000, `Balance: ${userWallet3.balance}`);

    // -------------------------------------------------------------------------
    // TEST 4: Bank becomes available again
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 4: Bank Becomes Available Again ---");
    fakeBank.setMode("normal");

    // Fast forward retry timer
    await OutboxEvent.updateOne({ withdrawalId: t3Data.withdrawal.id }, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });
    const t4Job = await claimNextJob();
    const t4Res = await processJob(t4Job, { bankUrl: BANK_URL });
    check("Test 4: Withdrawal recovers and completes with SUCCESS", t4Res.status === "SUCCESS", JSON.stringify(t4Res));

    const t4Doc = await Withdrawal.findById(t3Data.withdrawal.id);
    check("Test 4: Withdrawal status updated to SUCCESS", t4Doc.status === "SUCCESS");
    check("Test 4: Bank UTR recorded", Boolean(t4Doc.bankRef?.startsWith("UTR")));

    // -------------------------------------------------------------------------
    // TEST 5: Worker restart
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 5: Worker Restart Recovery ---");
    const t5Req = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": "test5-wd-005",
      },
      body: JSON.stringify({ bankAccountId: validAccId, amount: 10000 }),
    });
    const t5Data = await t5Req.json();
    const t5WdId = t5Data.withdrawal.id;

    // Verify outbox event persisted before worker processes it
    const persistedJob = await OutboxEvent.findOne({ withdrawalId: t5WdId });
    check("Test 5: Outbox event persisted in MongoDB before worker run", persistedJob && persistedJob.status === "NEW");

    // Worker starts fresh and picks up persisted job
    const t5Claimed = await claimNextJob();
    const t5Res = await processJob(t5Claimed, { bankUrl: BANK_URL });
    check("Test 5: Recovered outbox job completes as SUCCESS", t5Res.status === "SUCCESS");

    // -------------------------------------------------------------------------
    // TEST 6: Duplicate requests and concurrent workers
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 6: Duplicate Requests & Concurrent Workers ---");
    // Idempotent duplicate replay of test1-wd-001
    const replayReq = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": "test1-wd-001",
      },
      body: JSON.stringify({ bankAccountId: validAccId, amount: 20000 }),
    });
    const replayData = await replayReq.json();
    check("Test 6: Idempotent replay returns 202 with same ID", replayReq.status === 202 && replayData.withdrawal.id === t1Data.withdrawal.id);

    // Verify balance was not debited a second time
    const userWallet6 = await Wallet.findOne({ userId: t1Doc.userId });
    check("Test 6: Wallet balance preserved without double-debit (balance = 60000)", userWallet6.balance === 60000, `Balance: ${userWallet6.balance}`);

    // Concurrent job lease contest
    const concurrentEvent = await OutboxEvent.create({
      withdrawalId: new mongoose.Types.ObjectId(),
      status: "NEW",
      attempts: 0,
      nextAttemptAt: new Date(),
    });

    const [claimA, claimB] = await Promise.all([claimNextJob(), claimNextJob()]);
    const winnerCount = [claimA, claimB].filter((c) => c && c._id.toString() === concurrentEvent._id.toString()).length;
    check("Test 6: Exactly one worker wins the atomic lease", winnerCount === 1, `Winner count: ${winnerCount}`);

    // -------------------------------------------------------------------------
    // TEST 7: Reversal idempotency
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 7: Reversal Idempotency ---");
    // Attempt to reverse the already reversed t2 withdrawal
    const repeatReversal = await reverseWithdrawal({
      withdrawalId: t2Data.withdrawal.id,
      reason: "Second reversal attempt",
    });
    check("Test 7: Repeat reversal returns alreadyReversed: true", repeatReversal.alreadyReversed === true);

    const userWallet7 = await Wallet.findOne({ userId: t1Doc.userId });
    check("Test 7: No additional funds refunded to wallet", userWallet7.balance === 60000, `Balance: ${userWallet7.balance}`);

    const reversalTxnsAfter = await Transaction.find({ toUserId: t1Doc.userId, type: "REVERSAL", amount: 15000 });
    check("Test 7: Still exactly 1 REVERSAL transaction in database", reversalTxnsAfter.length === 1);

    // -------------------------------------------------------------------------
    // TEST 8: Financial reconciliation
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 8: Financial Reconciliation ---");
    const recRes = await fetch(`${BASE}/api/v1/admin/reconcile`, {
      headers: { "x-admin-key": ADMIN_KEY },
    });
    const recData = await recRes.json();
    check("Test 8: Reconcile endpoint returns 200", recRes.status === 200);
    check("Test 8: moneyIsConserved is true", recData.moneyIsConserved === true, JSON.stringify(recData));
    check("Test 8: 0 mismatches", recData.mismatches?.length === 0);
    check("Test 8: Money In (100000) - Money Out (40000) === Total Balance (60000)", recData.moneyIn - recData.moneyOut === recData.totalBalance);

    // -------------------------------------------------------------------------
    // TEST 9: Staff Manual Review Workflow (NEEDS_REVIEW resolution)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 9: Staff Manual Review Workflow ---");
    // Create a withdrawal parked in NEEDS_REVIEW after 5 failed attempts
    fakeBank.setMode("down");
    const t9Req = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": "test9-wd-009",
      },
      body: JSON.stringify({ bankAccountId: validAccId, amount: 10000 }),
    });
    const t9Data = await t9Req.json();
    const t9WdId = t9Data.withdrawal.id;

    for (let i = 1; i <= 5; i++) {
      await OutboxEvent.updateOne({ withdrawalId: t9WdId }, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });
      const job = await claimNextJob();
      if (job) await processJob(job, { bankUrl: BANK_URL, backoffBaseMs: 10 });
    }

    const t9DocBefore = await Withdrawal.findById(t9WdId);
    check("Test 9: Withdrawal is in NEEDS_REVIEW", t9DocBefore.status === "NEEDS_REVIEW");

    // Staff queries bank status endpoint
    const bankStatusRes = await fetch(`${BASE}/api/v1/admin/withdrawals/${t9WdId}/bank-status`, {
      headers: { "x-admin-key": ADMIN_KEY },
    });
    const bankStatusData = await bankStatusRes.json();
    check("Test 9: Staff can inspect bank status", bankStatusRes.status === 200 && bankStatusData.reference === t9DocBefore.reference);

    // Staff resolves via REFUND
    const resolveRefund = await fetch(`${BASE}/api/v1/admin/withdrawals/${t9WdId}/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": ADMIN_KEY,
      },
      body: JSON.stringify({
        action: "REFUND",
        reason: "Staff verified bank down; non-payment confirmed",
      }),
    });
    const refundData = await resolveRefund.json();
    check("Test 9: Staff refund returns 200", resolveRefund.status === 200);
    check("Test 9: Withdrawal marked REVERSED", refundData.withdrawal?.status === "REVERSED");
    check("Test 9: Balance restored to 60000", refundData.newBalance === 60000, `NewBalance: ${refundData.newBalance}`);

    // Replay resolution: must be idempotent and not refund twice
    const replayResolve = await fetch(`${BASE}/api/v1/admin/withdrawals/${t9WdId}/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": ADMIN_KEY,
      },
      body: JSON.stringify({ action: "REFUND" }),
    });
    const replayResolveData = await replayResolve.json();
    check("Test 9: Repeat resolve is idempotent (alreadyResolved: true)", replayResolveData.alreadyResolved === true);

    const userWallet9 = await Wallet.findOne({ userId: t1Doc.userId });
    check("Test 9: Balance remains 60000 without double-refund", userWallet9.balance === 60000);

    // Reconcile after staff review
    const finalRec = await fetch(`${BASE}/api/v1/admin/reconcile`, {
      headers: { "x-admin-key": ADMIN_KEY },
    });
    const finalRecData = await finalRec.json();
    check("Test 9: Reconciliation holds after staff resolution (moneyIsConserved: true)", finalRecData.moneyIsConserved === true);

    console.log("\n==========================================");
    console.log(`ROOT CAUSE & RECOVERY SUITE: ${passedAssertions} PASSED, ${failures} FAILED`);
    console.log("==========================================");

    if (failures > 0) process.exit(1);
  } finally {
    server.kill("SIGTERM");
    bankServer.close();
    await mongoose.disconnect();
    await replSet.stop();
  }
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
