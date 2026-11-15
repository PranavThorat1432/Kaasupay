// test/day10_phase6_e2e.test.js — AutoPay Complete Multi-Month End-to-End Test Suite
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3135;
const BASE = `http://localhost:${PORT}`;
const API = `${BASE}/api/v1`;
const ADMIN_KEY = process.env.ADMIN_KEY || "kaasupay_admin_1432";
const TEST_CRON_SECRET = "super_secure_cron_secret_day10_phase6_e2e";

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
      const res = await fetch(`${BASE}/health`);
      if (res.status === 200) return true;
    } catch {
      // server booting
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
  console.log("=== KAASUPAY DAY 10 PHASE 6: AUTOMATED END-TO-END AUTOPAY TEST SUITE ===");
  console.log("===============================================================================\n");

  // Spin up dedicated, isolated in-memory MongoDB replica set
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const mongoUri = replSet.getUri();

  console.log("Dedicated in-memory replica set active");
  console.log("Spawning isolated test backend process on port", PORT, "...");

  const server = spawnServer({
    PORT: String(PORT),
    MONGO_URL: mongoUri,
    MONGO_URI: mongoUri,
    ADMIN_KEY,
    JWT_SECRET: "test_jwt_secret_autopay_e2e_suite",
    CRON_SECRET: TEST_CRON_SECRET,
    ALLOW_TIME_TRAVEL: "true",
    DISABLE_BANK: "true",
  });

  const healthy = await waitForHealth();
  if (!healthy) {
    console.error("Test server failed to boot. Server logs:\n", server.getOutput());
    process.exit(1);
  }
  console.log(`Backend server started and healthy on port ${PORT}\n`);

  await mongoose.connect(mongoUri, { dbName: "kaasupay" });
  const cronHeader = { Authorization: `Bearer ${TEST_CRON_SECRET}` };

  try {
    // =========================================================================
    // Scenario 1: Create a mandate successfully
    // =========================================================================
    console.log("--- Scenario 1: Create Mandate Successfully ---");

    const uArun = await post("/user/signup", {
      username: "arun_e2e@test.local",
      firstName: "Arun",
      lastName: "Kumar",
      password: "password123",
    });
    const arunId = uArun.data.user._id;
    const arunAuth = await post("/user/signin", { username: "arun_e2e@test.local", password: "password123" });
    const arunToken = arunAuth.data.token;

    const uBala = await post("/user/signup", {
      username: "bala_e2e@test.local",
      firstName: "Bala",
      lastName: "Murugan",
      password: "password123",
    });
    const balaId = uBala.data.user._id;

    // Set PIN and fund Arun's wallet
    await post("/user/pin", { password: "password123", pin: "2468" }, arunToken);
    await post("/admin/deposit", { to: "arun_e2e@test.local", amount: 1000000 }, null, { "x-admin-key": ADMIN_KEY });

    // Payer sets up ₹500 (50,000 paise) mandate for day 5
    const setupRes = await post(
      "/autopay",
      { to: balaId, amount: 50000, dayOfMonth: 5, pin: "2468" },
      arunToken
    );

    check("Mandate creation returns HTTP 201", setupRes.status === 201, `Status: ${setupRes.status}`);
    check("Response message is 'AutoPay set up'", setupRes.data.message === "AutoPay set up");
    check("Mandate amount is 50000 paise", setupRes.data.mandate?.amount === 50000);
    check("Mandate dayOfMonth is 5", setupRes.data.mandate?.dayOfMonth === 5);
    check("Mandate status is ACTIVE", setupRes.data.mandate?.status === "ACTIVE");
    check("Mandate nextRunDay is valid date string", typeof setupRes.data.mandate?.nextRunDay === "string");

    const mandateId = setupRes.data.mandate.id;
    const targetDueDay = setupRes.data.mandate.nextRunDay;

    // Verify GET /autopay reflects the new mandate
    const listRes = await get("/autopay", arunToken);
    check("GET /autopay returns 200", listRes.status === 200);
    check("Arun has exactly 1 mandate", listRes.data.mandates?.length === 1);
    check("Mandate recipient name is populated", listRes.data.mandates[0].to === "Bala Murugan");

    // =========================================================================
    // Scenario 2: Execute a due mandate and transfer the correct amount
    // =========================================================================
    console.log("\n--- Scenario 2: Execute Due Mandate & Transfer Correct Amount ---");

    // Trigger cron on the exact due date
    const cronRes1 = await get(`/cron/autopay?date=${targetDueDay}`, null, cronHeader);
    check("Cron on due day returns 200", cronRes1.status === 200);
    check("Cron response reports due is 1", cronRes1.data.due === 1);
    check("Cron response reports succeeded is 1", cronRes1.data.succeeded === 1);
    check("Cron response reports failed is 0", cronRes1.data.failed === 0);
    check("Cron response reports missed is 0", cronRes1.data.missed === 0);

    // Verify wallet balances in database
    const arunWallet1 = await Wallet.findOne({ userId: arunId });
    const balaWallet1 = await Wallet.findOne({ userId: balaId });
    check("Payer wallet debited by 50,000 paise (balance 950,000)", arunWallet1.balance === 950000);
    check("Payee wallet credited by 50,000 paise (balance 50,000)", balaWallet1.balance === 50000);

    // Verify MandateRun document
    const runDoc1 = await MandateRun.findOne({ mandateId, dueDay: targetDueDay });
    check("MandateRun document exists", Boolean(runDoc1));
    check("MandateRun status is SUCCESS", runDoc1?.status === "SUCCESS");
    check("MandateRun amount matches 50,000 paise", runDoc1?.amount === 50000);
    check("MandateRun links to a transactionId", Boolean(runDoc1?.transactionId));
    check("MandateRun reason is null", runDoc1?.reason === null);

    // Verify Mandate advanced to next month
    const updatedMandate1 = await Mandate.findById(mandateId);
    check("Mandate nextRunDay advanced to next cycle", updatedMandate1.nextRunDay > targetDueDay);
    check("Mandate failedCount remains 0", updatedMandate1.failedCount === 0);

    // Verify Transaction and double-entry Ledgers
    const txnDoc1 = await Transaction.findById(runDoc1.transactionId);
    check("Transaction type is TRANSFER", txnDoc1?.type === "TRANSFER");
    check("Transaction note is 'AutoPay'", txnDoc1?.note === "AutoPay");
    check("Transaction status is COMPLETED", txnDoc1?.status === "COMPLETED");

    const arunLedger1 = await LedgerEntry.findOne({ transactionId: txnDoc1._id, userId: arunId, direction: "DEBIT" });
    const balaLedger1 = await LedgerEntry.findOne({ transactionId: txnDoc1._id, userId: balaId, direction: "CREDIT" });
    check("Payer ledger is DEBIT with balanceAfter: 950000", arunLedger1?.direction === "DEBIT" && arunLedger1?.balanceAfter === 950000);
    check("Payee ledger is CREDIT with balanceAfter: 50000", balaLedger1?.direction === "CREDIT" && balaLedger1?.balanceAfter === 50000);

    // =========================================================================
    // Scenario 3: Duplicate cron execution does not produce duplicate payments
    // =========================================================================
    console.log("\n--- Scenario 3: Duplicate Cron Idempotency ---");

    // Re-run cron for identical date
    const repeatCronRes = await get(`/cron/autopay?date=${targetDueDay}`, null, cronHeader);
    check("Repeat cron returns 200", repeatCronRes.status === 200);
    check("Repeat cron reports due is 0", repeatCronRes.data.due === 0);
    check("Repeat cron reports succeeded is 0", repeatCronRes.data.succeeded === 0);

    // Balances must remain strictly unchanged
    const arunWalletRepeat = await Wallet.findOne({ userId: arunId });
    const balaWalletRepeat = await Wallet.findOne({ userId: balaId });
    check("Payer balance untouched on repeat call", arunWalletRepeat.balance === 950000);
    check("Payee balance untouched on repeat call", balaWalletRepeat.balance === 50000);

    // Total MandateRun documents for this mandate must remain exactly 1
    const totalRunsArun = await MandateRun.countDocuments({ mandateId });
    check("Exactly 1 MandateRun document exists (no duplicates)", totalRunsArun === 1);

    // =========================================================================
    // Scenario 4: Insufficient funds produce a FAILED run
    // =========================================================================
    console.log("\n--- Scenario 4: Insufficient Funds Failure Handling ---");

    const uChitra = await post("/user/signup", {
      username: "chitra_e2e@test.local",
      firstName: "Chitra",
      lastName: "Raman",
      password: "password123",
    });
    const chitraId = uChitra.data.user._id;
    const chitraAuth = await post("/user/signin", { username: "chitra_e2e@test.local", password: "password123" });
    const chitraToken = chitraAuth.data.token;

    // Fund Chitra with only ₹100 (10,000 paise)
    await post("/user/pin", { password: "password123", pin: "9024" }, chitraToken);
    await post("/admin/deposit", { to: "chitra_e2e@test.local", amount: 10000 }, null, { "x-admin-key": ADMIN_KEY });

    // Chitra sets up ₹500 (50,000 paise) mandate for day 10
    const chitraSetup = await post(
      "/autopay",
      { to: balaId, amount: 50000, dayOfMonth: 10, pin: "9024" },
      chitraToken
    );
    check("Chitra mandate created -> 201", chitraSetup.status === 201);
    const chitraMandateId = chitraSetup.data.mandate.id;
    const chitraMonth1Due = chitraSetup.data.mandate.nextRunDay;

    // Trigger cron on Month 1 due date
    const failCronRes1 = await get(`/cron/autopay?date=${chitraMonth1Due}`, null, cronHeader);
    check("Month 1 cron reports due: 1", failCronRes1.data.due === 1);
    check("Month 1 cron reports failed: 1", failCronRes1.data.failed === 1);
    check("Month 1 cron reports succeeded: 0", failCronRes1.data.succeeded === 0);

    // Verify FAILED MandateRun document
    const chitraRun1 = await MandateRun.findOne({ mandateId: chitraMandateId, dueDay: chitraMonth1Due });
    check("Chitra Month 1 MandateRun status is FAILED", chitraRun1?.status === "FAILED");
    check("Chitra Month 1 reason is 'Insufficient balance'", chitraRun1?.reason === "Insufficient balance");
    check("Chitra Month 1 transactionId is null", chitraRun1?.transactionId === null);

    // Verify wallet balance untouched
    const chitraWallet1 = await Wallet.findOne({ userId: chitraId });
    check("Chitra balance untouched (10,000 paise)", chitraWallet1.balance === 10000);

    // Verify mandate state
    const chitraMandateState1 = await Mandate.findById(chitraMandateId);
    check("Chitra mandate failedCount incremented to 1", chitraMandateState1.failedCount === 1);
    check("Chitra mandate status remains ACTIVE", chitraMandateState1.status === "ACTIVE");
    check("Chitra mandate nextRunDay advanced to next cycle", chitraMandateState1.nextRunDay > chitraMonth1Due);

    // =========================================================================
    // Scenario 5: Three consecutive business failures auto-pause the mandate
    // =========================================================================
    console.log("\n--- Scenario 5: Three Consecutive Failures Auto-Pause ---");

    const chitraMonth2Due = chitraMandateState1.nextRunDay;
    const failCronRes2 = await get(`/cron/autopay?date=${chitraMonth2Due}`, null, cronHeader);
    check("Month 2 cron reports failed: 1", failCronRes2.data.failed === 1);

    const chitraMandateState2 = await Mandate.findById(chitraMandateId);
    check("Month 2 failedCount incremented to 2", chitraMandateState2.failedCount === 2);
    check("Month 2 status remains ACTIVE", chitraMandateState2.status === "ACTIVE");

    const chitraMonth3Due = chitraMandateState2.nextRunDay;
    const failCronRes3 = await get(`/cron/autopay?date=${chitraMonth3Due}`, null, cronHeader);
    check("Month 3 cron reports failed: 1", failCronRes3.data.failed === 1);

    const chitraMandateState3 = await Mandate.findById(chitraMandateId);
    check("Month 3 failedCount is exactly 3", chitraMandateState3.failedCount === 3);
    check("Month 3 mandate automatically changed to PAUSED", chitraMandateState3.status === "PAUSED");

    // Month 4: Trigger cron, verify no payment attempt while paused
    const chitraMonth4Due = chitraMandateState3.nextRunDay;
    const failCronRes4 = await get(`/cron/autopay?date=${chitraMonth4Due}`, null, cronHeader);
    check("Month 4 cron reports due: 0 (paused mandate skipped)", failCronRes4.data.due === 0);
    check("Month 4 cron reports succeeded: 0", failCronRes4.data.succeeded === 0);
    check("Month 4 cron reports failed: 0", failCronRes4.data.failed === 0);

    const totalChitraRuns = await MandateRun.countDocuments({ mandateId: chitraMandateId });
    check("Chitra has exactly 3 FAILED run records in total", totalChitraRuns === 3);

    // =========================================================================
    // Scenario 6: Resume a paused mandate & recover execution
    // =========================================================================
    console.log("\n--- Scenario 6: Resume Paused Mandate & Recovery ---");

    // Deposit ₹2,000 (200,000 paise) to Chitra's wallet
    await post("/admin/deposit", { to: "chitra_e2e@test.local", amount: 200000 }, null, { "x-admin-key": ADMIN_KEY });

    // Call POST /autopay/:id/resume
    const resumeRes = await post(`/autopay/${chitraMandateId}/resume`, {}, chitraToken);
    check("Resume returns HTTP 200", resumeRes.status === 200);
    check("Resume response message is 'AutoPay resumed'", resumeRes.data.message === "AutoPay resumed");
    check("Resume response includes recalculated nextRunDay", typeof resumeRes.data.nextRunDay === "string");

    const chitraResumedMandate = await Mandate.findById(chitraMandateId);
    check("Resumed mandate status is ACTIVE", chitraResumedMandate.status === "ACTIVE");
    check("Resumed mandate failedCount reset to 0", chitraResumedMandate.failedCount === 0);

    // To test subsequent cycle execution for the recovered mandate in a fresh period (Month 4):
    const recoveredDueDay = "2027-03-10";
    await Mandate.findByIdAndUpdate(chitraMandateId, { nextRunDay: recoveredDueDay });

    // Trigger cron on resumed nextRunDay
    const recoverCronRes = await get(`/cron/autopay?date=${recoveredDueDay}`, null, cronHeader);
    check("Recovered cron reports succeeded: 1", recoverCronRes.data.succeeded === 1);
    check("Recovered cron reports failed: 0", recoverCronRes.data.failed === 0);

    const chitraWalletRecovered = await Wallet.findOne({ userId: chitraId });
    check("Chitra wallet debited (balance 160,000)", chitraWalletRecovered.balance === 160000);

    const recoveredRun = await MandateRun.findOne({ mandateId: chitraMandateId, dueDay: recoveredDueDay });
    check("Recovered MandateRun status is SUCCESS", recoveredRun?.status === "SUCCESS");

    // =========================================================================
    // Scenario 7: Overdue mandates & 3-day grace policy
    // =========================================================================
    console.log("\n--- Scenario 7: 3-Day Grace Policy & Overdue MISSED Backfill ---");

    const uDinesh = await post("/user/signup", {
      username: "dinesh_e2e@test.local",
      firstName: "Dinesh",
      lastName: "Karthik",
      password: "password123",
    });
    const dineshId = uDinesh.data.user._id;
    const dineshAuth = await post("/user/signin", { username: "dinesh_e2e@test.local", password: "password123" });
    const dineshToken = dineshAuth.data.token;

    await post("/user/pin", { password: "password123", pin: "1122" }, dineshToken);
    await post("/admin/deposit", { to: "dinesh_e2e@test.local", amount: 500000 }, null, { "x-admin-key": ADMIN_KEY });

    // Dinesh creates mandate for day 15
    const dineshSetup = await post(
      "/autopay",
      { to: balaId, amount: 30000, dayOfMonth: 15, pin: "1122" },
      dineshToken
    );
    const dineshMandateId = dineshSetup.data.mandate.id;
    const dineshOriginalDue = dineshSetup.data.mandate.nextRunDay; // e.g. 2026-12-15

    // Test A: 2 days late is within 3-day grace window
    // Compute date string for dineshOriginalDue + 2 days
    const d1 = new Date(dineshOriginalDue);
    d1.setUTCDate(d1.getUTCDate() + 2);
    const twoDaysLate = d1.toISOString().slice(0, 10);

    const graceCronRes = await get(`/cron/autopay?date=${twoDaysLate}`, null, cronHeader);
    check("2 days late within grace window executes payment (succeeded: 1)", graceCronRes.data.succeeded === 1);
    check("Grace window payment reports missed: 0", graceCronRes.data.missed === 0);

    const dineshMandateAfterGrace = await Mandate.findById(dineshMandateId);
    const dineshNextCycleDue = dineshMandateAfterGrace.nextRunDay; // e.g. 2027-01-15

    // Test B: Outage catch-up > 3 days late (simulate to 2027-03-01, leaving Jan 15 & Feb 15 overdue)
    const longOverdueDate = "2027-03-01";

    const outageCronRes = await get(`/cron/autopay?date=${longOverdueDate}`, null, cronHeader);
    check("Multi-month outage backfills missed runs (missed >= 2)", outageCronRes.data.missed >= 2);

    const dineshMissedRuns = await MandateRun.find({ mandateId: dineshMandateId, status: "MISSED" });
    check("Exactly 2 MISSED run documents persisted for overdue cycles", dineshMissedRuns.length === 2);
    check("MISSED run has null transactionId", dineshMissedRuns[0].transactionId === null);
    check("MISSED run reason contains overdue detail", dineshMissedRuns[0].reason.toLowerCase().includes("overdue"));

    const dineshWalletAfterMissed = await Wallet.findOne({ userId: dineshId });
    check("Dinesh wallet balance NOT debited for missed cycles (470,000 paise)", dineshWalletAfterMissed.balance === 470000);

    const dineshMandateAfterMissed = await Mandate.findById(dineshMandateId);
    check("Dinesh failedCount remains 0 despite missed cycles", dineshMandateAfterMissed.failedCount === 0);

    // =========================================================================
    // Scenario 8: Cancel mandate & verify terminal immutability
    // =========================================================================
    console.log("\n--- Scenario 8: Cancel Mandate & Terminal State ---");

    const cancelRes = await post(`/autopay/${dineshMandateId}/cancel`, {}, dineshToken);
    check("Cancel returns HTTP 200", cancelRes.status === 200);
    check("Cancel response message is 'AutoPay cancelled'", cancelRes.data.message === "AutoPay cancelled");

    const dineshCancelledDoc = await Mandate.findById(dineshMandateId);
    check("Mandate status in DB is CANCELLED", dineshCancelledDoc.status === "CANCELLED");

    // Attempt duplicate operations on cancelled mandate
    const dupCancel = await post(`/autopay/${dineshMandateId}/cancel`, {}, dineshToken);
    check("Duplicate cancel returns 409", dupCancel.status === 409);

    const pauseCancelled = await post(`/autopay/${dineshMandateId}/pause`, {}, dineshToken);
    check("Pause on cancelled mandate returns 409", pauseCancelled.status === 409);

    const resumeCancelled = await post(`/autopay/${dineshMandateId}/resume`, {}, dineshToken);
    check("Resume on cancelled mandate returns 409", resumeCancelled.status === 409);

    // Cron on cancelled mandate's scheduled date must ignore it
    const cancelCronRes = await get(`/cron/autopay?date=${dineshCancelledDoc.nextRunDay}`, null, cronHeader);
    check("Cron ignores cancelled mandate (due: 0)", cancelCronRes.data.due === 0);

    // =========================================================================
    // Scenario 9: Double-Entry Ledger and Wallet Consistency
    // =========================================================================
    console.log("\n--- Scenario 9: Ledger & Balance Consistency Verification ---");

    const allTxns = await Transaction.find({ note: "AutoPay" });
    check("Multiple AutoPay transactions recorded", allTxns.length >= 2);

    let allLedgersBalanced = true;
    for (const txn of allTxns) {
      const debits = await LedgerEntry.find({ transactionId: txn._id, direction: "DEBIT" });
      const credits = await LedgerEntry.find({ transactionId: txn._id, direction: "CREDIT" });
      if (debits.length !== 1 || credits.length !== 1) {
        allLedgersBalanced = false;
        break;
      }
      if (debits[0].amount !== credits[0].amount) {
        allLedgersBalanced = false;
        break;
      }
    }
    check("All AutoPay transactions have paired, equal DEBIT and CREDIT ledger entries", allLedgersBalanced);

    const allWallets = await Wallet.find({});
    const integerBalancesOnly = allWallets.every((w) => Number.isInteger(w.balance) && w.balance >= 0);
    check("All wallet balances are non-negative integer paise", integerBalancesOnly);

    // =========================================================================
    // Scenario 10: Admin Reconciliation Verification
    // =========================================================================
    console.log("\n--- Scenario 10: Admin Reconciliation Endpoint ---");

    const reconcileRes = await get("/admin/reconcile", null, { "x-admin-key": ADMIN_KEY });
    check("GET /admin/reconcile returns HTTP 200", reconcileRes.status === 200);
    check("Admin reconcile reports moneyIsConserved is true", reconcileRes.data.moneyIsConserved === true);
    check("Admin reconcile reports zero mismatches", reconcileRes.data.mismatches?.length === 0);

  } finally {
    console.log("\n--- Teardown: Clean Test Infrastructure Shutdown ---");
    await mongoose.disconnect();
    server.kill();
    await replSet.stop();
    console.log("Mongoose disconnected, test server terminated, MongoMemoryReplSet stopped cleanly.");
  }

  console.log("\n===============================================================================");
  console.log(`=== DAY 10 PHASE 6 E2E SUITE SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED ===`);
  console.log("===============================================================================");

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("E2E Test Execution Error:", err);
  process.exit(1);
});
