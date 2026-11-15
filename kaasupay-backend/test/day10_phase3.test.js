// test/day10_phase3.test.js — AutoPay Phase 3 Acceptance Test Suite (Exactly-Once Payment Execution)
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import mongoose from "mongoose";
import Mandate from "../models/mandateModel.js";
import MandateRun from "../models/mandateRunModel.js";
import Wallet from "../models/walletModel.js";
import Transaction from "../models/transactionModel.js";
import LedgerEntry from "../models/ledgerEntryModel.js";
import DailySpend from "../models/dailySpendModel.js";
import User from "../models/userModel.js";
import { transfer, MoneyError } from "../services/money.js";
import { indiaDay } from "../services/dailyLimitService.js";
import { processDueMandatePayment, recordFailedMandatePayment } from "../services/autopayService.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3128;
const BASE = `http://localhost:${PORT}`;
const API = `${BASE}/api/v1`;
const ADMIN_KEY = process.env.ADMIN_KEY || "kaasupay_admin_1432";
const TEST_CRON_SECRET = "super_secure_cron_secret_day10_phase3";

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

function spawnServer(env) {
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

async function waitForHealth(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.status === 200) return true;
    } catch {
      // server starting
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function post(path, body, token = null, extraHeaders = {}) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function get(path, token = null, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method: "GET",
    headers,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log("===============================================================================");
  console.log("=== KAASUPAY DAY 10 PHASE 3: EXACTLY-ONCE PAYMENT EXECUTION (D3, D4, D5) ===");
  console.log("===============================================================================");

  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const mongoUri = replSet.getUri();

  const server = spawnServer({
    PORT: String(PORT),
    MONGO_URL: mongoUri,
    MONGO_URI: mongoUri,
    ADMIN_KEY,
    JWT_SECRET: "test_jwt_secret_autopay_phase3",
    CRON_SECRET: TEST_CRON_SECRET,
    ALLOW_TIME_TRAVEL: "true",
    DISABLE_BANK: "true",
  });

  const healthy = await waitForHealth();
  if (!healthy) {
    console.error("Server failed to start. Logs:\n", server.getOutput());
    process.exit(1);
  }
  console.log(`Backend server started and healthy on port ${PORT}\n`);

  await mongoose.connect(mongoUri, { dbName: "kaasupay" });

  const cronHeader = { Authorization: `Bearer ${TEST_CRON_SECRET}` };

  try {
    // =========================================================================
    // Part 1: Setup Seed Users, PINs and Wallets
    // =========================================================================
    console.log("--- Setup: Seed Users & Wallets ---");

    const uArun = await post("/user/signup", {
      username: "arun_p3@test.local",
      firstName: "Arun",
      lastName: "Kumar",
      password: "password123",
    });
    const arunId = uArun.data.user._id;
    const arunSignin = await post("/user/signin", {
      username: "arun_p3@test.local",
      password: "password123",
    });
    const arunToken = arunSignin.data.token;

    const uBala = await post("/user/signup", {
      username: "bala_p3@test.local",
      firstName: "Bala",
      lastName: "Murugan",
      password: "password123",
    });
    const balaId = uBala.data.user._id;

    const uChitra = await post("/user/signup", {
      username: "chitra_p3@test.local",
      firstName: "Chitra",
      lastName: "Raman",
      password: "password123",
    });
    const chitraId = uChitra.data.user._id;
    const chitraSignin = await post("/user/signin", {
      username: "chitra_p3@test.local",
      password: "password123",
    });
    const chitraToken = chitraSignin.data.token;

    // Set PINs
    await post("/user/pin", { password: "password123", pin: "2468" }, arunToken);
    await post("/user/pin", { password: "password123", pin: "9024" }, chitraToken);

    // Initial Deposits: Arun = ₹10,000 (1,000,000 paise), Chitra = ₹100 (10,000 paise)
    await post("/admin/deposit", { to: "arun_p3@test.local", amount: 1000000, note: "Arun seed" }, null, { "x-admin-key": ADMIN_KEY });
    await post("/admin/deposit", { to: "chitra_p3@test.local", amount: 10000, note: "Chitra seed" }, null, { "x-admin-key": ADMIN_KEY });

    const arunWBefore = await Wallet.findOne({ userId: arunId });
    const balaWBefore = await Wallet.findOne({ userId: balaId });
    check("Arun initial wallet balance is 1,000,000 paise (₹10,000)", arunWBefore.balance === 1000000);
    check("Bala initial wallet balance is 0 paise", balaWBefore.balance === 0);

    // =========================================================================
    // Part 2: Step 1 Refactor Verification — money.js External Session Support
    // =========================================================================
    console.log("\n--- Verification: money.js External Session Support ---");

    const uSender = await post("/user/signup", {
      username: "money_sender@test.local",
      firstName: "Money",
      lastName: "Sender",
      password: "password123",
    });
    const senderId = uSender.data.user._id;

    const uReceiver = await post("/user/signup", {
      username: "money_receiver@test.local",
      firstName: "Money",
      lastName: "Receiver",
      password: "password123",
    });
    const receiverId = uReceiver.data.user._id;

    await post("/admin/deposit", { to: "money_sender@test.local", amount: 500000, note: "Sender seed" }, null, { "x-admin-key": ADMIN_KEY });

    // 1. Standalone transfer() without session (existing caller behavior)
    const standaloneRes = await transfer({
      fromUserId: senderId,
      toUserId: receiverId,
      amount: 10000, // ₹100
      note: "Standalone test",
    });
    check("Standalone transfer returns transaction", !!standaloneRes.transaction);
    check("Standalone transfer updates sender balance", standaloneRes.senderBalance === 490000);
    check("Standalone transfer updates receiver balance", standaloneRes.receiverBalance === 10000);

    // 2. Transfer with caller-provided external session
    const testSession = await mongoose.startSession();
    let extTxnId;
    await testSession.withTransaction(async () => {
      const extRes = await transfer({
        fromUserId: senderId,
        toUserId: receiverId,
        amount: 20000, // ₹200
        note: "External session test",
        session: testSession,
      });
      extTxnId = extRes.transaction._id;
      check("External session transfer executes inside caller transaction", extRes.senderBalance === 470000);
    });
    await testSession.endSession();

    const extTxnInDb = await Transaction.findById(extTxnId);
    check("External session transfer committed successfully", !!extTxnInDb);

    // 3. External session rollback test
    const abortSession = await mongoose.startSession();
    try {
      await abortSession.withTransaction(async () => {
        await transfer({
          fromUserId: senderId,
          toUserId: receiverId,
          amount: 50000, // ₹500
          note: "Aborted transfer",
          session: abortSession,
        });
        // Intentionally throw inside transaction to test complete rollback
        throw new Error("Simulated caller abort");
      });
    } catch {
      // expected
    } finally {
      await abortSession.endSession();
    }

    const senderWAfterAbort = await Wallet.findOne({ userId: senderId });
    check("Aborted external session transfer rolls back sender balance", senderWAfterAbort.balance === 470000);
    const receiverWAfterAbort = await Wallet.findOne({ userId: receiverId });
    check("Aborted external session transfer rolls back receiver balance", receiverWAfterAbort.balance === 30000);

    // =========================================================================
    // Part 3: Test 1-6 — Successful AutoPay Execution (D3 Spec)
    // =========================================================================
    console.log("\n--- D3: Pay Once, on the Due Day (Successful AutoPay) ---");

    // Setup AutoPay mandate: Arun pays Bala ₹500 (50,000 paise) on 5th of every month
    const setupRes = await post(
      "/autopay",
      {
        to: balaId,
        amount: 50000,
        dayOfMonth: 5,
        pin: "2468",
      },
      arunToken
    );
    if (setupRes.status !== 201) {
      console.log("setupRes status:", setupRes.status, "data:", setupRes.data);
    }
    check("AutoPay setup returns 201", setupRes.status === 201);
    const mandateId = setupRes.data.mandate.id;
    const initialNextRunDay = setupRes.data.mandate.nextRunDay; // e.g. "2026-12-05"

    // Call 1: Pre-due date (?date=2026-12-04) -> due: 0, succeeded: 0
    const resPreDue = await get(`/cron/autopay?date=2026-12-04`, null, cronHeader);
    check("Pre-due date (Dec 4): due: 0, succeeded: 0", resPreDue.data.due === 0 && resPreDue.data.succeeded === 0);

    // Call 2: Exact due date (?date=2026-12-05) -> due: 1, succeeded: 1
    const resDueDay = await get(`/cron/autopay?date=2026-12-05`, null, cronHeader);
    check("Exact due date (Dec 5): due is 1", resDueDay.data.due === 1);
    check("Exact due date (Dec 5): succeeded is 1", resDueDay.data.succeeded === 1);
    check("Exact due date (Dec 5): failed is 0", resDueDay.data.failed === 0);
    check("Exact due date (Dec 5): missed is 0", resDueDay.data.missed === 0);
    check("Exact due date (Dec 5): more is false", resDueDay.data.more === false);

    // Verify Financial State:
    // Payer debited by 50000 paise: 1000000 - 50000 = 950000
    const arunWAfterD3 = await Wallet.findOne({ userId: arunId });
    check("Test 2: Payer wallet debited (balance is 950,000 paise)", arunWAfterD3.balance === 950000, `Got: ${arunWAfterD3.balance}`);

    // Payee credited by 50000 paise: 0 + 50000 = 50000
    const balaWAfterD3 = await Wallet.findOne({ userId: balaId });
    check("Test 2: Payee wallet credited (balance is 50,000 paise)", balaWAfterD3.balance === 50000, `Got: ${balaWAfterD3.balance}`);

    // Test 3: Transaction record creation with note "AutoPay" and type "TRANSFER"
    const autopayTxn = await Transaction.findOne({ fromUserId: arunId, toUserId: balaId, amount: 50000 });
    check("Test 3: Transaction record created", !!autopayTxn);
    check("Test 3: Transaction type is TRANSFER", autopayTxn?.type === "TRANSFER");
    check("Test 3: Transaction note is 'AutoPay'", autopayTxn?.note === "AutoPay");
    check("Test 3: Transaction status is COMPLETED", autopayTxn?.status === "COMPLETED");

    // Test 4: Both ledger entries (DEBIT and CREDIT)
    const debitEntry = await LedgerEntry.findOne({ transactionId: autopayTxn._id, userId: arunId, direction: "DEBIT" });
    check("Test 4: Sender DEBIT ledger entry created", !!debitEntry);
    check("Test 4: Sender balanceAfter is 950000", debitEntry?.balanceAfter === 950000);

    const creditEntry = await LedgerEntry.findOne({ transactionId: autopayTxn._id, userId: balaId, direction: "CREDIT" });
    check("Test 4: Receiver CREDIT ledger entry created", !!creditEntry);
    check("Test 4: Receiver balanceAfter is 50000", creditEntry?.balanceAfter === 50000);

    // Test 5: MandateRun SUCCESS record
    const runDoc = await MandateRun.findOne({ mandateId, dueDay: "2026-12-05" });
    check("Test 5: MandateRun document exists", !!runDoc);
    check("Test 5: MandateRun status is SUCCESS", runDoc?.status === "SUCCESS");
    check("Test 5: MandateRun amount is 50000", runDoc?.amount === 50000);
    check("Test 5: MandateRun links to transactionId", runDoc?.transactionId?.toString() === autopayTxn._id.toString());
    check("Test 5: MandateRun reason is null", runDoc?.reason === null);

    // Test 6: Correct nextRunDay advancement and failedCount: 0
    const mandateAfterD3 = await Mandate.findById(mandateId);
    check("Test 6: nextRunDay advanced to 2027-01-05", mandateAfterD3.nextRunDay === "2027-01-05");
    check("Test 6: failedCount is 0", mandateAfterD3.failedCount === 0);

    // =========================================================================
    // Part 4: Test 7 — Repeated Cron Invocation (Delivered Twice Idempotency)
    // =========================================================================
    console.log("\n--- D3 'Delivered Twice': Repeated Cron Invocations ---");

    const resRepeatDue = await get(`/cron/autopay?date=2026-12-05`, null, cronHeader);
    check("Repeated call on same date reports due: 0", resRepeatDue.data.due === 0);
    check("Repeated call on same date reports succeeded: 0", resRepeatDue.data.succeeded === 0);

    // Verify balances did NOT change
    const arunWAfterRepeat = await Wallet.findOne({ userId: arunId });
    check("Arun balance remains 950,000 (no double debit)", arunWAfterRepeat.balance === 950000);

    const totalRuns = await MandateRun.countDocuments({ mandateId });
    check("Exactly 1 MandateRun record exists in total (no duplicates)", totalRuns === 1);

    // Verify GET /autopay/:id/runs API returns run with payee name and SUCCESS
    const runsApiRes = await get(`/autopay/${mandateId}/runs`, arunToken);
    check("GET /autopay/:id/runs returns 200", runsApiRes.status === 200);
    check("Runs API list contains 1 item", runsApiRes.data.runs?.length === 1);
    check("Runs API item status is SUCCESS", runsApiRes.data.runs[0]?.status === "SUCCESS");

    // =========================================================================
    // Part 5: Test 8 — Five Simultaneous Cron Invocations (Bonus 7 Concurrency)
    // =========================================================================
    console.log("\n--- Five Simultaneous Cron Requests (Concurrency Race) ---");

    // Reset mandate to be due on 2027-01-05
    await Mandate.updateOne({ _id: mandateId }, { $set: { nextRunDay: "2027-01-05" } });
    const arunBalanceBeforeBlast = (await Wallet.findOne({ userId: arunId })).balance;

    // Fire 5 simultaneous cron requests for 2027-01-05
    const blastPromises = [
      get(`/cron/autopay?date=2027-01-05`, null, cronHeader),
      get(`/cron/autopay?date=2027-01-05`, null, cronHeader),
      get(`/cron/autopay?date=2027-01-05`, null, cronHeader),
      get(`/cron/autopay?date=2027-01-05`, null, cronHeader),
      get(`/cron/autopay?date=2027-01-05`, null, cronHeader),
    ];
    const blastResults = await Promise.all(blastPromises);

    const allStatus200 = blastResults.every((r) => r.status === 200);
    check("All 5 concurrent requests returned HTTP 200", allStatus200);

    const totalSucceededInBlast = blastResults.reduce((acc, r) => acc + (r.data.succeeded || 0), 0);
    check("Across 5 concurrent workers, exactly 1 payment succeeded", totalSucceededInBlast === 1, `Got: ${totalSucceededInBlast}`);

    const arunBalanceAfterBlast = (await Wallet.findOne({ userId: arunId })).balance;
    check(
      "Arun balance debited exactly once across concurrent blast",
      arunBalanceAfterBlast === arunBalanceBeforeBlast - 50000,
      `Before: ${arunBalanceBeforeBlast}, After: ${arunBalanceAfterBlast}`
    );

    const janRunsCount = await MandateRun.countDocuments({ mandateId, dueDay: "2027-01-05" });
    check("Exactly 1 MandateRun document exists for 2027-01-05", janRunsCount === 1);

    const mandateAfterBlast = await Mandate.findById(mandateId);
    check("Mandate advanced to 2027-02-05 after concurrent blast", mandateAfterBlast.nextRunDay === "2027-02-05");

    // =========================================================================
    // Part 6: Test 9, 12 — Insufficient Payer Balance & 3-Failure Auto-Pause (D5)
    // =========================================================================
    console.log("\n--- D5: Failures, Retry Advances & 3-Failure Auto-Pause ---");

    // Chitra sets up ₹500 (50,000 paise) to Bala on 10th of every month. Chitra has only ₹100 (10,000 paise).
    const chitraMandateRes = await post(
      "/autopay",
      {
        to: balaId,
        amount: 50000,
        dayOfMonth: 10,
        pin: "9024",
      },
      chitraToken
    );
    check("Chitra AutoPay setup returns 201", chitraMandateRes.status === 201);
    const chitraMandateId = chitraMandateRes.data.mandate.id;

    // Force first run date to 2026-11-10
    await Mandate.updateOne({ _id: chitraMandateId }, { $set: { nextRunDay: "2026-11-10" } });

    // Month 1 Run (2026-11-10): Fails due to insufficient balance
    const chitraRun1 = await get(`/cron/autopay?date=2026-11-10`, null, cronHeader);
    check("Month 1: due is 1", chitraRun1.data.due === 1);
    check("Month 1: succeeded is 0", chitraRun1.data.succeeded === 0);
    check("Month 1: failed is 1", chitraRun1.data.failed === 1);

    const chitraM1 = await Mandate.findById(chitraMandateId);
    check("Month 1: failedCount incremented to 1", chitraM1.failedCount === 1);
    check("Month 1: status remains ACTIVE", chitraM1.status === "ACTIVE");
    check("Month 1: nextRunDay advanced to 2026-12-10", chitraM1.nextRunDay === "2026-12-10");

    const chitraRun1Doc = await MandateRun.findOne({ mandateId: chitraMandateId, dueDay: "2026-11-10" });
    check("Month 1: MandateRun status is FAILED", chitraRun1Doc?.status === "FAILED");
    check("Month 1: MandateRun reason is 'Insufficient balance'", chitraRun1Doc?.reason === "Insufficient balance");
    check("Month 1: MandateRun transactionId is null", chitraRun1Doc?.transactionId === null);

    // Verify Chitra's wallet was NOT debited
    const chitraWAfterR1 = await Wallet.findOne({ userId: chitraId });
    check("Chitra wallet balance untouched after failure (10,000 paise)", chitraWAfterR1.balance === 10000);

    // Month 2 Run (2026-12-10): Fails second time
    const chitraRun2 = await get(`/cron/autopay?date=2026-12-10`, null, cronHeader);
    check("Month 2: failed is 1", chitraRun2.data.failed === 1);
    const chitraM2 = await Mandate.findById(chitraMandateId);
    check("Month 2: failedCount incremented to 2", chitraM2.failedCount === 2);
    check("Month 2: nextRunDay advanced to 2027-01-10", chitraM2.nextRunDay === "2027-01-10");

    // Month 3 Run (2027-01-10): Fails third time -> Auto-Pauses!
    const chitraRun3 = await get(`/cron/autopay?date=2027-01-10`, null, cronHeader);
    check("Month 3: failed is 1", chitraRun3.data.failed === 1);
    const chitraM3 = await Mandate.findById(chitraMandateId);
    check("Month 3: failedCount is 3", chitraM3.failedCount === 3);
    check("Month 3: status automatically changed to PAUSED", chitraM3.status === "PAUSED");

    // Month 4 Run (2027-02-10): Paused mandate is NOT selected (due: 0)
    const chitraRun4 = await get(`/cron/autopay?date=2027-02-10`, null, cronHeader);
    check("Month 4: Paused mandate is not due (due is 0)", chitraRun4.data.due === 0);

    // Verify Chitra has 3 FAILED run records in total
    const chitraFailedRuns = await MandateRun.find({ mandateId: chitraMandateId, status: "FAILED" });
    check("Chitra has exactly 3 FAILED run records", chitraFailedRuns.length === 3);

    // =========================================================================
    // Part 7: Test 10 — Missing Payee Wallet Business Failure
    // =========================================================================
    console.log("\n--- Test: Missing Payee Wallet Business Failure ---");

    // Create orphan payee user without wallet
    const orphanPayee = await User.create({
      username: "orphan_payee@test.local",
      firstName: "Orphan",
      lastName: "User",
      passwordHash: "hash",
    });

    const orphanMandate = await Mandate.create({
      payerId: arunId,
      payeeId: orphanPayee._id,
      amount: 10000,
      dayOfMonth: 12,
      status: "ACTIVE",
      nextRunDay: "2026-12-12",
      failedCount: 0,
    });

    const missingWalletRun = await get(`/cron/autopay?date=2026-12-12`, null, cronHeader);
    check("Missing payee wallet records failed: 1", missingWalletRun.data.failed === 1);

    const orphanRunDoc = await MandateRun.findOne({ mandateId: orphanMandate._id, dueDay: "2026-12-12" });
    check("Orphan mandate run marked FAILED", orphanRunDoc?.status === "FAILED");
    check("Orphan mandate reason contains 'Receiver wallet not found'", orphanRunDoc?.reason === "Receiver wallet not found");

    const refreshedOrphanM = await Mandate.findById(orphanMandate._id);
    check("Orphan mandate nextRunDay advanced to 2027-01-12", refreshedOrphanM.nextRunDay === "2027-01-12");
    check("Orphan mandate failedCount is 1", refreshedOrphanM.failedCount === 1);

    // Clean up orphan mandate
    await Mandate.deleteOne({ _id: orphanMandate._id });
    await User.deleteOne({ _id: orphanPayee._id });

    // =========================================================================
    // Part 8: Test 11, 17 — Daily Limit Exceeded & DailySpend Consistency
    // =========================================================================
    console.log("\n--- Test: Daily Limit Exceeded & DailySpend Consistency ---");

    // Arun's daily limit is 1,000,000 paise (₹10,000).
    // Set Arun's DailySpend today (indiaDay()) to 960,000 paise, leaving only 40,000 paise.
    const todayIST = indiaDay();
    await DailySpend.updateOne(
      { userId: arunId, day: todayIST },
      { $set: { spent: 960000 } },
      { upsert: true }
    );

    // Mandate is ₹500 (50,000 paise), which exceeds the 40,000 paise remaining
    const limitMandate = await Mandate.create({
      payerId: arunId,
      payeeId: balaId,
      amount: 50000,
      dayOfMonth: 15,
      status: "ACTIVE",
      nextRunDay: "2026-12-15",
      failedCount: 0,
    });

    const limitRunRes = await get(`/cron/autopay?date=2026-12-15`, null, cronHeader);
    check("Daily limit overflow records failed: 1", limitRunRes.data.failed === 1);

    const limitRunDoc = await MandateRun.findOne({ mandateId: limitMandate._id, dueDay: "2026-12-15" });
    check("Daily limit run marked FAILED", limitRunDoc?.status === "FAILED");
    check("Daily limit run reason is 'Daily limit reached'", limitRunDoc?.reason === "Daily limit reached");

    // DailySpend must NOT have been incremented by the failed transaction
    const dailySpendAfter = await DailySpend.findOne({ userId: arunId, day: todayIST });
    check("DailySpend remaining spent is untouched (960000 paise)", dailySpendAfter.spent === 960000);

    await Mandate.deleteOne({ _id: limitMandate._id });
    await DailySpend.deleteOne({ userId: arunId, day: todayIST });

    // =========================================================================
    // Part 9: Test 13-15 — Transaction Atomicity & Rollback Integrity
    // =========================================================================
    console.log("\n--- Test: Transaction Rollback Integrity ---");

    // Test 15: Duplicate MandateRun key inside processDueMandatePayment
    const atomicityMandate = await Mandate.create({
      payerId: arunId,
      payeeId: balaId,
      amount: 10000,
      dayOfMonth: 20,
      status: "ACTIVE",
      nextRunDay: "2026-12-20",
      failedCount: 0,
    });

    // Pre-insert conflicting MandateRun document for (mandateId, 2026-12-20)
    await MandateRun.create({
      mandateId: atomicityMandate._id,
      dueDay: "2026-12-20",
      status: "SUCCESS",
      amount: 10000,
      transactionId: new mongoose.Types.ObjectId(),
      reason: null,
    });

    const arunWBeforeConflict = (await Wallet.findOne({ userId: arunId })).balance;
    const balaWBeforeConflict = (await Wallet.findOne({ userId: balaId })).balance;

    // Trigger processDueMandatePayment directly
    const conflictResult = await processDueMandatePayment(atomicityMandate, "2026-12-20");
    check("Duplicate MandateRun key causes transaction abort / non-success", conflictResult.outcome !== "SUCCESS");

    const arunWAfterConflict = (await Wallet.findOne({ userId: arunId })).balance;
    const balaWAfterConflict = (await Wallet.findOne({ userId: balaId })).balance;
    check("Atomicity: Arun wallet completely untouched after conflict rollback", arunWAfterConflict === arunWBeforeConflict);
    check("Atomicity: Bala wallet completely untouched after conflict rollback", balaWAfterConflict === balaWBeforeConflict);

    await Mandate.deleteOne({ _id: atomicityMandate._id });
    await MandateRun.deleteMany({ mandateId: atomicityMandate._id });

    // =========================================================================
    // Part 10: Test 16 — Pause / Cancel Race Condition
    // =========================================================================
    console.log("\n--- Test: Pause / Cancel Race Condition ---");

    const raceMandate = await Mandate.create({
      payerId: arunId,
      payeeId: balaId,
      amount: 15000,
      dayOfMonth: 22,
      status: "PAUSED", // Paused before processing
      nextRunDay: "2026-12-22",
      failedCount: 0,
    });

    const arunWBeforePauseRace = (await Wallet.findOne({ userId: arunId })).balance;
    const raceRes = await processDueMandatePayment(raceMandate, "2026-12-22");
    check("Paused mandate execution returns SKIPPED", raceRes.outcome === "SKIPPED");

    const arunWAfterPauseRace = (await Wallet.findOne({ userId: arunId })).balance;
    check("No funds debited for paused mandate", arunWAfterPauseRace === arunWBeforePauseRace);

    await Mandate.deleteOne({ _id: raceMandate._id });

    // =========================================================================
    // Part 11: Test 18 — Admin Reconcile & Balance Conservation
    // =========================================================================
    console.log("\n--- Test 18: Admin Reconcile & Balance Conservation ---");

    const reconcileRes = await get("/admin/reconcile", null, { "x-admin-key": ADMIN_KEY });
    check("Admin reconcile returns 200", reconcileRes.status === 200);
    check("moneyIsConserved is true across all user and system wallets", reconcileRes.data.moneyIsConserved === true);
    check("Ledger balance mismatches count is 0", reconcileRes.data.mismatches?.length === 0);

  } finally {
    await mongoose.disconnect();
    server.kill();
    await replSet.stop();
  }

  console.log("\n===============================================================================");
  console.log(`=== DAY 10 PHASE 3 TEST SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED ===`);
  console.log("===============================================================================");

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
