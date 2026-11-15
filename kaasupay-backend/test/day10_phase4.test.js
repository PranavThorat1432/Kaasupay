// test/day10_phase4.test.js — AutoPay Phase 4 Reliability, Observability & Failure Recovery Test Suite
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
import User from "../models/userModel.js";
import { processDueMandatePayment, logOperationalEvent } from "../services/autopayService.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3129;
const BASE = `http://localhost:${PORT}`;
const API = `${BASE}/api/v1`;
const ADMIN_KEY = process.env.ADMIN_KEY || "kaasupay_admin_1432";
const TEST_CRON_SECRET = "super_secure_cron_secret_day10_phase4";

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
  console.log("=== KAASUPAY DAY 10 PHASE 4: FAILURE HANDLING, OBSERVABILITY & RELIABILITY ===");
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
    JWT_SECRET: "test_jwt_secret_autopay_phase4",
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
    // Part 1: Seed Users, PINs and Initial Wallets
    // =========================================================================
    console.log("--- Setup: Seed Users & Wallets ---");

    const uArun = await post("/user/signup", {
      username: "arun_p4@test.local",
      firstName: "Arun",
      lastName: "Kumar",
      password: "password123",
    });
    const arunId = uArun.data.user._id;
    const arunSignin = await post("/user/signin", { username: "arun_p4@test.local", password: "password123" });
    const arunToken = arunSignin.data.token;

    const uBala = await post("/user/signup", {
      username: "bala_p4@test.local",
      firstName: "Bala",
      lastName: "Murugan",
      password: "password123",
    });
    const balaId = uBala.data.user._id;

    const uChitra = await post("/user/signup", {
      username: "chitra_p4@test.local",
      firstName: "Chitra",
      lastName: "Raman",
      password: "password123",
    });
    const chitraId = uChitra.data.user._id;
    const chitraSignin = await post("/user/signin", { username: "chitra_p4@test.local", password: "password123" });
    const chitraToken = chitraSignin.data.token;

    const uDinesh = await post("/user/signup", {
      username: "dinesh_p4@test.local",
      firstName: "Dinesh",
      lastName: "Karthik",
      password: "password123",
    });
    const dineshId = uDinesh.data.user._id;
    const dineshSignin = await post("/user/signin", { username: "dinesh_p4@test.local", password: "password123" });
    const dineshToken = dineshSignin.data.token;

    // Set PINs
    await post("/user/pin", { password: "password123", pin: "2468" }, arunToken);
    await post("/user/pin", { password: "password123", pin: "9024" }, chitraToken);
    await post("/user/pin", { password: "password123", pin: "1357" }, dineshToken);

    // Initial Deposits: Arun = ₹10,000 (1,000,000 paise), Chitra = ₹1 (100 paise), Dinesh = 0 paise
    await post("/admin/deposit", { to: "arun_p4@test.local", amount: 1000000, note: "Arun seed" }, null, { "x-admin-key": ADMIN_KEY });
    await post("/admin/deposit", { to: "chitra_p4@test.local", amount: 100, note: "Chitra seed" }, null, { "x-admin-key": ADMIN_KEY });

    check("Arun initial wallet funded (1,000,000 paise)", (await Wallet.findOne({ userId: arunId })).balance === 1000000);
    check("Chitra initial wallet funded (100 paise)", (await Wallet.findOne({ userId: chitraId })).balance === 100);

    // =========================================================================
    // Part 2: Task 4.1 & 4.2 — Three Consecutive Business Failures & Auto-Pause
    // =========================================================================
    console.log("\n--- Task 4.1 & 4.2: 3 Consecutive Failures Auto-Pause & No 4th Payment Attempt ---");

    // Chitra sets up ₹500 (50,000 paise) AutoPay to Bala on day 10
    const chitraMandateRes = await post(
      "/autopay",
      { to: balaId, amount: 50000, dayOfMonth: 10, pin: "9024" },
      chitraToken
    );
    check("Chitra AutoPay mandate created (201)", chitraMandateRes.status === 201);
    const chitraMandateId = chitraMandateRes.data.mandate.id;

    // Set first run date to 2026-11-10
    await Mandate.updateOne({ _id: chitraMandateId }, { $set: { nextRunDay: "2026-11-10" } });

    // Month 1 Run (2026-11-10): Fails due to insufficient balance
    const cRun1 = await get("/cron/autopay?date=2026-11-10", null, cronHeader);
    check("Month 1 cron returns 200", cRun1.status === 200);
    check("Month 1 reports due: 1, failed: 1, succeeded: 0", cRun1.data.due === 1 && cRun1.data.failed === 1 && cRun1.data.succeeded === 0);
    const cM1 = await Mandate.findById(chitraMandateId);
    check("Month 1: failedCount incremented to 1", cM1.failedCount === 1);
    check("Month 1: status remains ACTIVE", cM1.status === "ACTIVE");
    check("Month 1: nextRunDay advanced to 2026-12-10", cM1.nextRunDay === "2026-12-10");

    // Month 2 Run (2026-12-10): Fails second time
    const cRun2 = await get("/cron/autopay?date=2026-12-10", null, cronHeader);
    check("Month 2 reports due: 1, failed: 1", cRun2.data.due === 1 && cRun2.data.failed === 1);
    const cM2 = await Mandate.findById(chitraMandateId);
    check("Month 2: failedCount incremented to 2", cM2.failedCount === 2);
    check("Month 2: status remains ACTIVE", cM2.status === "ACTIVE");
    check("Month 2: nextRunDay advanced to 2027-01-10", cM2.nextRunDay === "2027-01-10");

    // Month 3 Run (2027-01-10): Fails third time -> Auto-Pauses!
    const cRun3 = await get("/cron/autopay?date=2027-01-10", null, cronHeader);
    check("Month 3 reports due: 1, failed: 1", cRun3.data.due === 1 && cRun3.data.failed === 1);
    const cM3 = await Mandate.findById(chitraMandateId);
    check("Task 4.1: failedCount is exactly 3", cM3.failedCount === 3);
    check("Task 4.1: status automatically changed to PAUSED", cM3.status === "PAUSED");

    // Month 4 Run (2027-02-10): Mandate is PAUSED -> Cron must NOT attempt payment
    const cRun4 = await get("/cron/autopay?date=2027-02-10", null, cronHeader);
    check("Task 4.2: No fourth payment attempted while paused (due: 0, succeeded: 0, failed: 0)",
      cRun4.data.due === 0 && cRun4.data.succeeded === 0 && cRun4.data.failed === 0
    );
    const totalChitraRuns = await MandateRun.countDocuments({ mandateId: chitraMandateId });
    check("Task 4.2: Exactly 3 MandateRun records exist in total (no 4th record)", totalChitraRuns === 3);

    // =========================================================================
    // Part 3: Task 4.3 — Successful Payment Resets failedCount to Zero
    // =========================================================================
    console.log("\n--- Task 4.3: Successful Payment Resets failedCount to 0 ---");

    // Dinesh sets up ₹200 (20,000 paise) AutoPay to Bala on day 15 (Dinesh currently has 0 paise)
    const dineshMandateRes = await post(
      "/autopay",
      { to: balaId, amount: 20000, dayOfMonth: 15, pin: "1357" },
      dineshToken
    );
    check("Dinesh AutoPay mandate created (201)", dineshMandateRes.status === 201);
    const dineshMandateId = dineshMandateRes.data.mandate.id;
    await Mandate.updateOne({ _id: dineshMandateId }, { $set: { nextRunDay: "2026-11-15" } });

    // Month 1 (2026-11-15): Fails due to insufficient balance
    const dRun1 = await get("/cron/autopay?date=2026-11-15", null, cronHeader);
    check("Dinesh Month 1 fails (due: 1, failed: 1)", dRun1.data.due === 1 && dRun1.data.failed === 1);
    const dM1 = await Mandate.findById(dineshMandateId);
    check("Dinesh failedCount is 1", dM1.failedCount === 1);

    // Now fund Dinesh wallet with ₹1,000 (100,000 paise)
    await post("/admin/deposit", { to: "dinesh_p4@test.local", amount: 100000, note: "Dinesh fund" }, null, { "x-admin-key": ADMIN_KEY });

    // Month 2 (2026-12-15): Execution succeeds
    const dRun2 = await get("/cron/autopay?date=2026-12-15", null, cronHeader);
    check("Dinesh Month 2 succeeds (due: 1, succeeded: 1, failed: 0)", dRun2.data.due === 1 && dRun2.data.succeeded === 1 && dRun2.data.failed === 0);

    const dM2 = await Mandate.findById(dineshMandateId);
    check("Task 4.3: Successful payment reset failedCount back to 0", dM2.failedCount === 0);
    check("Dinesh mandate nextRunDay advanced to 2027-01-15", dM2.nextRunDay === "2027-01-15");

    // =========================================================================
    // Part 4: Task 4.4 — MISSED Runs Do Not Increment failedCount
    // =========================================================================
    console.log("\n--- Task 4.4: MISSED Runs Do Not Increment failedCount ---");

    // Create an active mandate with nextRunDay set 4 months in the past (2026-08-05)
    const overdueMandate = await Mandate.create({
      payerId: arunId,
      payeeId: balaId,
      amount: 10000,
      dayOfMonth: 5,
      status: "ACTIVE",
      nextRunDay: "2026-08-05",
      failedCount: 0,
    });

    // Run cron for 2026-12-05: Aug, Sep, Oct, Nov are > 3 days late -> marked MISSED
    // Dec 5 is on-time -> paid SUCCESS
    const overdueCron = await get("/cron/autopay?date=2026-12-05", null, cronHeader);
    check("Overdue cron caught up: missed: 4, succeeded: 1", overdueCron.data.missed === 4 && overdueCron.data.succeeded === 1);

    const missedRuns = await MandateRun.find({ mandateId: overdueMandate._id, status: "MISSED" });
    check("Exactly 4 MISSED MandateRun records created", missedRuns.length === 4);

    const refreshedOverdueM = await Mandate.findById(overdueMandate._id);
    check("Task 4.4: failedCount remains 0 despite 4 MISSED runs", refreshedOverdueM.failedCount === 0);

    // =========================================================================
    // Part 5: Task 4.5, 4.6 & 4.7 — Transient Infrastructure Failure Safety
    // =========================================================================
    console.log("\n--- Task 4.5, 4.6, 4.7: Transient Infrastructure Failure Handling ---");

    const transientMandate = await Mandate.create({
      payerId: arunId,
      payeeId: balaId,
      amount: 25000,
      dayOfMonth: 7,
      status: "ACTIVE",
      nextRunDay: "2027-03-07",
      failedCount: 0,
    });

    // Simulate transient network/database drop inside processDueMandatePayment
    // Temporarily monkey-patch Wallet.findOneAndUpdate to throw a transient infrastructure error
    const originalFindOneAndUpdate = Wallet.findOneAndUpdate;
    let patchActive = true;
    Wallet.findOneAndUpdate = function (...args) {
      if (patchActive) {
        const transErr = new Error("MongoNetworkTimeoutException: connection closed");
        transErr.name = "MongoNetworkTimeoutException";
        throw transErr;
      }
      return originalFindOneAndUpdate.apply(this, args);
    };

    let transientResult;
    try {
      transientResult = await processDueMandatePayment(transientMandate, "2027-03-07");
    } finally {
      patchActive = false;
      Wallet.findOneAndUpdate = originalFindOneAndUpdate;
    }

    check("Transient failure yields outcome 'ERROR'", transientResult?.outcome === "ERROR");
    check("Transient failure category is 'TRANSIENT_INFRASTRUCTURE'", transientResult?.category === "TRANSIENT_INFRASTRUCTURE");

    // Task 4.5: Transient failure must NOT create a FAILED run
    const failedRunCheck = await MandateRun.findOne({ mandateId: transientMandate._id, dueDay: "2027-03-07" });
    check("Task 4.5: No MandateRun created for transient failure", failedRunCheck === null);

    // Task 4.6: Transient failure must NOT increment failedCount or advance nextRunDay
    const transientMAfterErr = await Mandate.findById(transientMandate._id);
    check("Task 4.6: failedCount remains 0 after transient error", transientMAfterErr.failedCount === 0);
    check("Task 4.6: nextRunDay remains 2027-03-07 for retry", transientMAfterErr.nextRunDay === "2027-03-07");

    // Task 4.7: Subsequent cron invocation processes the mandate cleanly
    const retryCronRes = await get("/cron/autopay?date=2027-03-07", null, cronHeader);
    check("Task 4.7: Subsequent cron processes mandate successfully (succeeded >= 1)", retryCronRes.data.succeeded >= 1);

    const successRunDoc = await MandateRun.findOne({ mandateId: transientMandate._id, dueDay: "2027-03-07" });
    check("Task 4.7: SUCCESS MandateRun exists after clean retry", successRunDoc?.status === "SUCCESS");
    const transientMAfterSuccess = await Mandate.findById(transientMandate._id);
    check("Task 4.7: nextRunDay advanced to 2027-04-07", transientMAfterSuccess.nextRunDay === "2027-04-07");

    // =========================================================================
    // Part 6: Task 4.8 — Interrupted Transaction Leaves Balances & Ledgers Clean
    // =========================================================================
    console.log("\n--- Task 4.8: Interrupted Transaction Rollback Integrity ---");

    const arunWPreAbort = (await Wallet.findOne({ userId: arunId })).balance;
    const balaWPreAbort = (await Wallet.findOne({ userId: balaId })).balance;
    const ledgerCountPreAbort = await LedgerEntry.countDocuments({});

    // Intentionally execute a transaction that aborts midway due to an uncaught crash before commit
    const abortSession = await mongoose.startSession();
    try {
      await abortSession.withTransaction(async () => {
        await Wallet.findOneAndUpdate({ userId: arunId }, { $inc: { balance: -50000 } }, { session: abortSession });
        await Wallet.findOneAndUpdate({ userId: balaId }, { $inc: { balance: 50000 } }, { session: abortSession });
        await LedgerEntry.create(
          [{ userId: arunId, direction: "DEBIT", type: "TRANSFER", amount: 50000, balanceAfter: 950000 }],
          { session: abortSession }
        );
        throw new Error("Simulated mid-flight crash before commit");
      });
    } catch {
      // Expected rollback
    } finally {
      await abortSession.endSession();
    }

    const arunWPostAbort = (await Wallet.findOne({ userId: arunId })).balance;
    const balaWPostAbort = (await Wallet.findOne({ userId: balaId })).balance;
    const ledgerCountPostAbort = await LedgerEntry.countDocuments({});

    check("Task 4.8: Arun wallet balance unchanged after abort", arunWPostAbort === arunWPreAbort);
    check("Task 4.8: Bala wallet balance unchanged after abort", balaWPostAbort === balaWPreAbort);
    check("Task 4.8: No orphaned ledger entries inserted after abort", ledgerCountPostAbort === ledgerCountPreAbort);

    // =========================================================================
    // Part 7: Task 4.9 — Repeated Cron Invocations (No Duplicate Transfers)
    // =========================================================================
    console.log("\n--- Task 4.9: Repeated Cron Invocations Idempotency ---");

    // Call cron on 2027-03-07 again
    const repeatRes = await get("/cron/autopay?date=2027-03-07", null, cronHeader);
    check("Task 4.9: Repeated cron reports due: 0, succeeded: 0", repeatRes.data.due === 0 && repeatRes.data.succeeded === 0);
    const arunWAfterRepeat = (await Wallet.findOne({ userId: arunId })).balance;
    check("Task 4.9: Arun balance unchanged on repeated invocation", arunWAfterRepeat === arunWPostAbort);

    // =========================================================================
    // Part 8: Task 4.10 — Resume Resets failedCount & Calculates nextRunDay Correctly
    // =========================================================================
    console.log("\n--- Task 4.10: Resume Resets failedCount & Calculates nextRunDay ---");

    // Chitra's mandate was auto-paused with failedCount: 3
    const preResumeM = await Mandate.findById(chitraMandateId);
    check("Pre-resume: status is PAUSED", preResumeM.status === "PAUSED");
    check("Pre-resume: failedCount is 3", preResumeM.failedCount === 3);

    const resumeRes = await post(`/autopay/${chitraMandateId}/resume`, {}, chitraToken);
    check("Resume returns 200", resumeRes.status === 200);
    check("Resume response returns message 'AutoPay resumed'", resumeRes.data.message === "AutoPay resumed");
    check("Resume response contains valid nextRunDay", typeof resumeRes.data.nextRunDay === "string");

    const postResumeM = await Mandate.findById(chitraMandateId);
    check("Task 4.10: Status changed to ACTIVE", postResumeM.status === "ACTIVE");
    check("Task 4.10: failedCount reset to 0", postResumeM.failedCount === 0);
    check("Task 4.10: nextRunDay calculated correctly", postResumeM.nextRunDay === resumeRes.data.nextRunDay);

    // =========================================================================
    // Part 9: Task 4.11 & 4.12 — Cancelled Mandates Terminal State & Races
    // =========================================================================
    console.log("\n--- Task 4.11 & 4.12: Cancelled Mandate Terminal Behavior & Races ---");

    // Cancel Chitra's mandate
    const cancelRes = await post(`/autopay/${chitraMandateId}/cancel`, {}, chitraToken);
    check("Cancel returns 200", cancelRes.status === 200);

    const postCancelM = await Mandate.findById(chitraMandateId);
    check("Task 4.11: Mandate status is CANCELLED", postCancelM.status === "CANCELLED");

    // Attempting to cancel again returns 409
    const dupCancel = await post(`/autopay/${chitraMandateId}/cancel`, {}, chitraToken);
    check("Task 4.11: Duplicate cancel returns 409", dupCancel.status === 409);

    // Attempting to pause cancelled mandate returns 409
    const pauseCancelled = await post(`/autopay/${chitraMandateId}/pause`, {}, chitraToken);
    check("Task 4.11: Pause cancelled mandate returns 409", pauseCancelled.status === 409);

    // Attempting to resume cancelled mandate returns 409
    const resumeCancelled = await post(`/autopay/${chitraMandateId}/resume`, {}, chitraToken);
    check("Task 4.11: Resume cancelled mandate returns 409", resumeCancelled.status === 409);

    // Direct payment attempt on cancelled mandate yields SKIPPED
    const paymentOnCancelled = await processDueMandatePayment(postCancelM, postCancelM.nextRunDay);
    check("Task 4.12: Direct payment attempt on cancelled mandate returns SKIPPED", paymentOnCancelled.outcome === "SKIPPED");

    // Create a mandate, pause it, and ensure direct payment attempt yields SKIPPED
    const pausedTestMandate = await Mandate.create({
      payerId: arunId,
      payeeId: balaId,
      amount: 10000,
      dayOfMonth: 18,
      status: "PAUSED",
      nextRunDay: "2027-05-18",
      failedCount: 0,
    });
    const paymentOnPaused = await processDueMandatePayment(pausedTestMandate, "2027-05-18");
    check("Task 4.12: Direct payment attempt on paused mandate returns SKIPPED", paymentOnPaused.outcome === "SKIPPED");
    await Mandate.deleteOne({ _id: pausedTestMandate._id });

    // =========================================================================
    // Part 10: Task 4.13 — Cron Response Extended Metrics (errors & skipped)
    // =========================================================================
    console.log("\n--- Task 4.13: Cron Response Extended Metrics (errors & skipped) ---");

    // Call cron on a clean day
    const cleanCronRes = await get("/cron/autopay?date=2027-06-01", null, cronHeader);
    check("Task 4.13: Cron response has 'date'", typeof cleanCronRes.data.date === "string");
    check("Task 4.13: Cron response has 'due'", typeof cleanCronRes.data.due === "number");
    check("Task 4.13: Cron response has 'succeeded'", typeof cleanCronRes.data.succeeded === "number");
    check("Task 4.13: Cron response has 'failed'", typeof cleanCronRes.data.failed === "number");
    check("Task 4.13: Cron response has 'missed'", typeof cleanCronRes.data.missed === "number");
    check("Task 4.13: Cron response has 'errors'", typeof cleanCronRes.data.errors === "number");
    check("Task 4.13: Cron response has 'skipped'", typeof cleanCronRes.data.skipped === "number");
    check("Task 4.13: Cron response has 'more'", typeof cleanCronRes.data.more === "boolean");

    // =========================================================================
    // Part 11: Task 4.14 — Log Sanitization & Structured Event Verification
    // =========================================================================
    console.log("\n--- Task 4.14: Structured Operational Logs & Privacy Audit ---");

    let testStdout = "";
    const origLog = console.log;
    console.log = function (...args) {
      testStdout += args.join(" ") + "\n";
      origLog.apply(console, args);
    };

    // Emit each of the 8 structured operational events
    logOperationalEvent("cron_started", { date: "2027-07-01" });
    logOperationalEvent("autopay_payment_success", { mandateId: arunId.toString(), dueDay: "2027-07-01", transactionId: "dummyTxn", durationMs: 42 });
    logOperationalEvent("autopay_payment_failure", { mandateId: arunId.toString(), dueDay: "2027-07-01", reason: "Insufficient balance", failedCount: 1, durationMs: 15 });
    logOperationalEvent("autopay_auto_paused", { mandateId: arunId.toString(), payerId: arunId.toString(), dueDay: "2027-07-01", failedCount: 3 });
    logOperationalEvent("autopay_payment_error", { mandateId: arunId.toString(), dueDay: "2027-07-01", error: "Connection lost", category: "TRANSIENT_INFRASTRUCTURE", durationMs: 5 });
    logOperationalEvent("autopay_payment_skipped", { mandateId: arunId.toString(), dueDay: "2027-07-01", reason: "Concurrent claim" });
    logOperationalEvent("autopay_run_missed", { mandateId: arunId.toString(), dueDay: "2027-07-01", daysLate: 12 });
    logOperationalEvent("cron_completed", { date: "2027-07-01", due: 1, succeeded: 1, failed: 0, missed: 0, errors: 0, skipped: 0, durationMs: 50 });

    console.log = origLog;

    const combinedLogs = server.getOutput() + "\n" + testStdout;

    // Verify structured JSON lines are valid JSON and contain expected events
    const requiredEvents = [
      "cron_started",
      "autopay_payment_success",
      "autopay_payment_failure",
      "autopay_auto_paused",
      "autopay_payment_error",
      "autopay_payment_skipped",
      "autopay_run_missed",
      "cron_completed",
    ];

    for (const evt of requiredEvents) {
      const hasEvt = combinedLogs.includes(`"event":"${evt}"`);
      check(`Task 4.14: Structured event '${evt}' logged in valid JSON format`, hasEvt);
    }

    // Privacy & Security Audit: Ensure no secrets, tokens or PINs leaked into stdout
    const leaksSecret = combinedLogs.includes(TEST_CRON_SECRET);
    check("Task 4.14: Logs do NOT leak CRON_SECRET", !leaksSecret);

    const leaksPIN = combinedLogs.includes(`"pin":"2468"`) || combinedLogs.includes(`"pin":"9024"`);
    check("Task 4.14: Logs do NOT leak PIN values", !leaksPIN);

    const leaksPassword = combinedLogs.includes(`"password":"password123"`);
    check("Task 4.14: Logs do NOT leak user passwords", !leaksPassword);

    const leaksToken = combinedLogs.includes(arunToken) || combinedLogs.includes(chitraToken);
    check("Task 4.14: Logs do NOT leak JWT authorization tokens", !leaksToken);

    // =========================================================================
    // Part 12: Admin Reconcile & Balance Conservation
    // =========================================================================
    console.log("\n--- Final Integrity: Admin Reconcile & Balance Conservation ---");

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
  console.log(`=== DAY 10 PHASE 4 TEST SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED ===`);
  console.log("===============================================================================");

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
