// test/day10_phase2.test.js — AutoPay Phase 2 Acceptance Test Suite (Cron Infrastructure, MISSED Persistence & Continuation)
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
import { indiaDay } from "../services/dailyLimitService.js";
import {
  getDaysDiff,
  isWithinGraceWindow,
  isBeyondGraceWindow,
  categorizeMandateDue,
  processMissedMandateRuns,
} from "../services/autopayService.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3127;
const BASE = `http://localhost:${PORT}`;
const API = `${BASE}/api/v1`;
const ADMIN_KEY = process.env.ADMIN_KEY || "kaasupay_admin_1432";
const TEST_CRON_SECRET = "super_secure_cron_secret_day10_test";

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
  console.log("=== KAASUPAY DAY 10 PHASE 2: CRON INFRASTRUCTURE, MISSED RUNS & BATCHING ===");
  console.log("===============================================================================");

  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const mongoUri = replSet.getUri();

  // Server instance with time travel enabled (for testing)
  let server = spawnServer({
    PORT: String(PORT),
    MONGO_URL: mongoUri,
    MONGO_URI: mongoUri,
    ADMIN_KEY,
    JWT_SECRET: "test_jwt_secret_autopay_phase2",
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

  try {
    // =========================================================================
    // Part 1: Date & Grace Window Unit Logic
    // =========================================================================
    console.log("--- Grace Window & Categorization Unit Tests ---");

    // Days diff
    check("getDaysDiff same day is 0", getDaysDiff("2026-12-05", "2026-12-05") === 0);
    check("getDaysDiff 3 days late is 3", getDaysDiff("2026-12-05", "2026-12-08") === 3);
    check("getDaysDiff 4 days late is 4", getDaysDiff("2026-12-05", "2026-12-09") === 4);
    check("getDaysDiff future date is negative (-1)", getDaysDiff("2026-12-05", "2026-12-04") === -1);

    // Grace window checks
    check("isWithinGraceWindow true on due day", isWithinGraceWindow("2026-12-05", "2026-12-05") === true);
    check("isWithinGraceWindow true 1 day late", isWithinGraceWindow("2026-12-05", "2026-12-06") === true);
    check("isWithinGraceWindow true 2 days late", isWithinGraceWindow("2026-12-05", "2026-12-07") === true);
    check("isWithinGraceWindow true 3 days late", isWithinGraceWindow("2026-12-05", "2026-12-08") === true);
    check("isWithinGraceWindow false 4 days late", isWithinGraceWindow("2026-12-05", "2026-12-09") === false);
    check("isWithinGraceWindow false on future date", isWithinGraceWindow("2026-12-05", "2026-12-04") === false);

    check("isBeyondGraceWindow true 4 days late", isBeyondGraceWindow("2026-12-05", "2026-12-09") === true);
    check("isBeyondGraceWindow false 3 days late", isBeyondGraceWindow("2026-12-05", "2026-12-08") === false);

    // Mandate categorization
    const activeOnTime = categorizeMandateDue({ status: "ACTIVE", nextRunDay: "2026-12-05" }, "2026-12-05");
    check("Active on-time mandate is ELIGIBLE_FOR_PAYMENT", activeOnTime.eligible === true && activeOnTime.status === "ELIGIBLE_FOR_PAYMENT");

    const active3DaysLate = categorizeMandateDue({ status: "ACTIVE", nextRunDay: "2026-12-05" }, "2026-12-08");
    check("Active 3-days-late mandate is ELIGIBLE_FOR_PAYMENT", active3DaysLate.eligible === true && active3DaysLate.status === "ELIGIBLE_FOR_PAYMENT");

    const active4DaysLate = categorizeMandateDue({ status: "ACTIVE", nextRunDay: "2026-12-05" }, "2026-12-09");
    check("Active 4-days-late mandate is MISSED", active4DaysLate.eligible === false && active4DaysLate.status === "MISSED");

    const pausedDue = categorizeMandateDue({ status: "PAUSED", nextRunDay: "2026-12-05" }, "2026-12-05");
    check("PAUSED mandate is not eligible", pausedDue.eligible === false);

    const cancelledDue = categorizeMandateDue({ status: "CANCELLED", nextRunDay: "2026-12-05" }, "2026-12-05");
    check("CANCELLED mandate is not eligible", cancelledDue.eligible === false);

    const futureDue = categorizeMandateDue({ status: "ACTIVE", nextRunDay: "2026-12-06" }, "2026-12-05");
    check("Future-due mandate is not eligible", futureDue.eligible === false);

    // =========================================================================
    // Part 2: Cron Security & Authentication (D2 Tests)
    // =========================================================================
    console.log("\n--- D2: Cron Authentication & Security ---");

    // No Authorization header -> 401
    const noAuth = await get("/cron/autopay");
    check("No Authorization header returns 401", noAuth.status === 401);
    check("Message is 'Unauthorized'", noAuth.data.message === "Unauthorized");

    // Invalid secret header -> 401
    const wrongAuth = await get("/cron/autopay", null, {
      Authorization: "Bearer wrong_secret_key",
    });
    check("Wrong Authorization secret returns 401", wrongAuth.status === 401);
    check("Message is 'Unauthorized'", wrongAuth.data.message === "Unauthorized");

    // Malformed header without Bearer prefix -> 401
    const malformedAuth = await get("/cron/autopay", null, {
      Authorization: TEST_CRON_SECRET,
    });
    check("Header missing Bearer prefix returns 401", malformedAuth.status === 401);

    // Timing safe equal length mismatch test (shorter or longer token) -> returns 401 without crashing
    const shorterToken = await get("/cron/autopay", null, {
      Authorization: "Bearer abc",
    });
    check("Shorter token returns 401 cleanly without exception", shorterToken.status === 401);

    const longerToken = await get("/cron/autopay", null, {
      Authorization: `Bearer ${TEST_CRON_SECRET}_extra_characters_123456`,
    });
    check("Longer token returns 401 cleanly without exception", longerToken.status === 401);

    // Valid secret header -> 200
    const validAuth = await get("/cron/autopay", null, {
      Authorization: `Bearer ${TEST_CRON_SECRET}`,
    });
    check("Valid Authorization secret returns 200", validAuth.status === 200);
    check("Response includes date string", /^\d{4}-\d{2}-\d{2}$/.test(validAuth.data.date));
    check("Response includes due count (number)", typeof validAuth.data.due === "number");
    check("Response succeeded is 0", validAuth.data.succeeded === 0);
    check("Response failed is 0", validAuth.data.failed === 0);
    check("Response missed is 0", validAuth.data.missed === 0);
    check("Response more is boolean", typeof validAuth.data.more === "boolean");

    // Valid secret with time-travel query (?date=2026-12-05) -> 200
    const timeTravelRes = await get("/cron/autopay?date=2026-12-05", null, {
      Authorization: `Bearer ${TEST_CRON_SECRET}`,
    });
    check("Time travel with valid date returns 200", timeTravelRes.status === 200);
    check("Date matches requested simulated date", timeTravelRes.data.date === "2026-12-05");

    // Invalid simulated date format -> 400
    const invalidDateRes = await get("/cron/autopay?date=2026-13-45", null, {
      Authorization: `Bearer ${TEST_CRON_SECRET}`,
    });
    check("Invalid date format returns 400", invalidDateRes.status === 400);

    // =========================================================================
    // Part 3: Test Time Travel Lockout (Production Simulation)
    // =========================================================================
    console.log("\n--- Testing Production Time-Travel Gating (ALLOW_TIME_TRAVEL off) ---");
    server.kill();
    server = spawnServer({
      PORT: String(PORT),
      MONGO_URL: mongoUri,
      MONGO_URI: mongoUri,
      ADMIN_KEY,
      JWT_SECRET: "test_jwt_secret_autopay_phase2",
      CRON_SECRET: TEST_CRON_SECRET,
      // ALLOW_TIME_TRAVEL omitted
      DISABLE_BANK: "true",
    });

    const prodHealthy = await waitForHealth();
    check("Server restarted with ALLOW_TIME_TRAVEL off", prodHealthy);

    // In production mode, any ?date= parameter MUST be rejected with HTTP 400 {"message":"Time travel is off"}
    const prodTimeTravel = await get("/cron/autopay?date=2026-12-05", null, {
      Authorization: `Bearer ${TEST_CRON_SECRET}`,
    });
    check("Time travel query when disabled returns 400", prodTimeTravel.status === 400);
    check("Message is 'Time travel is off'", prodTimeTravel.data.message === "Time travel is off");

    // Normal invocation without ?date= parameter continues to return 200 in production mode
    const prodNormal = await get("/cron/autopay", null, {
      Authorization: `Bearer ${TEST_CRON_SECRET}`,
    });
    check("Normal cron call without date in production mode returns 200", prodNormal.status === 200);

    // Restart server back with ALLOW_TIME_TRAVEL="true" for subsequent mandate scheduling tests
    server.kill();
    server = spawnServer({
      PORT: String(PORT),
      MONGO_URL: mongoUri,
      MONGO_URI: mongoUri,
      ADMIN_KEY,
      JWT_SECRET: "test_jwt_secret_autopay_phase2",
      CRON_SECRET: TEST_CRON_SECRET,
      ALLOW_TIME_TRAVEL: "true",
      DISABLE_BANK: "true",
    });
    await waitForHealth();

    // =========================================================================
    // Part 4: Mandate Eligibility & Grace Window Selection
    // =========================================================================
    console.log("\n--- Mandate Eligibility, Grace Window & Batch Selection ---");

    // Setup seed users
    const u1 = await post("/user/signup", {
      username: "cron_payer@test.local",
      firstName: "Cron",
      lastName: "Payer",
      password: "password123",
    });
    const payerId = u1.data.user._id;

    const u2 = await post("/user/signup", {
      username: "cron_payee@test.local",
      firstName: "Cron",
      lastName: "Payee",
      password: "password123",
    });
    const payeeId = u2.data.user._id;

    // Fund payer and payee for clean financial baseline
    await post(
      "/admin/deposit",
      { to: "cron_payer@test.local", amount: 500000, note: "Payer seed" },
      null,
      { "x-admin-key": ADMIN_KEY }
    );
    await post(
      "/admin/deposit",
      { to: "cron_payee@test.local", amount: 100000, note: "Payee seed" },
      null,
      { "x-admin-key": ADMIN_KEY }
    );

    const payerWalletBefore = await Wallet.findOne({ userId: payerId });
    const payeeWalletBefore = await Wallet.findOne({ userId: payeeId });

    // Seed test mandates directly into database:
    // 1. Mandate due 2026-12-05 (ACTIVE)
    const mActiveDueDec5 = await Mandate.create({
      payerId,
      payeeId,
      amount: 10000,
      dayOfMonth: 5,
      status: "ACTIVE",
      nextRunDay: "2026-12-05",
      failedCount: 0,
    });

    // 2. Mandate due 2026-12-05 but PAUSED
    await Mandate.create({
      payerId,
      payeeId,
      amount: 20000,
      dayOfMonth: 5,
      status: "PAUSED",
      nextRunDay: "2026-12-05",
      failedCount: 0,
    });

    // 3. Mandate due 2026-12-05 but CANCELLED
    await Mandate.create({
      payerId,
      payeeId,
      amount: 30000,
      dayOfMonth: 5,
      status: "CANCELLED",
      nextRunDay: "2026-12-05",
      failedCount: 0,
    });

    // 4. Mandate due 2026-12-06 (Future relative to Dec 5)
    await Mandate.create({
      payerId,
      payeeId,
      amount: 40000,
      dayOfMonth: 6,
      status: "ACTIVE",
      nextRunDay: "2026-12-06",
      failedCount: 0,
    });

    const cronHeader = { Authorization: `Bearer ${TEST_CRON_SECRET}` };

    // Test on 2026-12-04: Mandate is future-due relative to Dec 4 -> due: 0
    const resDec4 = await get("/cron/autopay?date=2026-12-04", null, cronHeader);
    check("On 2026-12-04: due is 0 (future-due exclusion)", resDec4.data.due === 0);

    // Test on 2026-12-05: Exactly 1 ACTIVE mandate is due today (PAUSED & CANCELLED excluded)
    const resDec5 = await get("/cron/autopay?date=2026-12-05", null, cronHeader);
    check("On 2026-12-05: due is 1 (ACTIVE on-time selected, PAUSED/CANCELLED excluded)", resDec5.data.due === 1);

    // Test Grace Window boundaries relative to mandate due on 2026-12-05:
    // Day 1 late (Dec 6): Dec 5 mandate (1 day late) + Dec 6 mandate (on time) -> due: 2
    const resDec6 = await get("/cron/autopay?date=2026-12-06", null, cronHeader);
    check("On 2026-12-06: due is 2 (1 day late + on time)", resDec6.data.due === 2);

    // Day 2 late (Dec 7): due: 2
    const resDec7 = await get("/cron/autopay?date=2026-12-07", null, cronHeader);
    check("On 2026-12-07: due is 2 (both inside grace window)", resDec7.data.due === 2);

    // Day 3 late (Dec 8): Dec 5 mandate is 3 days late (still in grace window) -> due: 2
    const resDec8 = await get("/cron/autopay?date=2026-12-08", null, cronHeader);
    check("On 2026-12-08: due is 2 (3 days late is still in grace window)", resDec8.data.due === 2);

    // Day 4 late (Dec 9):
    // Dec 5 mandate is 4 days late (> 3 days grace window) -> processed as MISSED, advances nextRunDay to 2027-01-05!
    // Dec 6 mandate is 3 days late (still in grace window) -> due: 1
    const resDec9 = await get("/cron/autopay?date=2026-12-09", null, cronHeader);
    check("On 2026-12-09: due is 1", resDec9.data.due === 1, `Got: ${resDec9.data.due}`);
    check("On 2026-12-09: missed is 1 (Dec 5 mandate marked MISSED)", resDec9.data.missed === 1, `Got: ${resDec9.data.missed}`);

    // Verify Dec 5 mandate advanced to 2027-01-05 and MandateRun was persisted
    const updatedDec5 = await Mandate.findById(mActiveDueDec5._id);
    check("Dec 5 mandate nextRunDay advanced to 2027-01-05", updatedDec5.nextRunDay === "2027-01-05");

    const missedRunDoc = await MandateRun.findOne({ mandateId: mActiveDueDec5._id, dueDay: "2026-12-05" });
    check("MandateRun record exists for Dec 5", !!missedRunDoc);
    check("MandateRun status is MISSED", missedRunDoc?.status === "MISSED");
    check("MandateRun amount matches mandate amount (10000)", missedRunDoc?.amount === 10000);
    check("MandateRun reason contains overdue details", missedRunDoc?.reason?.includes("Overdue by 4 days"));
    check("MandateRun transactionId is null", missedRunDoc?.transactionId === null);

    // Repeated call on Dec 9: does NOT duplicate MISSED record
    const repeatDec9 = await get("/cron/autopay?date=2026-12-09", null, cronHeader);
    check("Repeat call on Dec 9 reports missed: 0", repeatDec9.data.missed === 0);
    const missedRunsTotal = await MandateRun.countDocuments({ mandateId: mActiveDueDec5._id });
    check("Exactly 1 MandateRun document exists (no duplicates)", missedRunsTotal === 1);

    // =========================================================================
    // Part 5: Multi-Month Outage Catch-Up (D4 Scenario)
    // =========================================================================
    console.log("\n--- Multi-Month Outage Catch-Up (D4 Scenario) ---");
    // Remove other mandates so only mActiveDueDec5 is evaluated
    await Mandate.deleteMany({ _id: { $ne: mActiveDueDec5._id } });

    // Mandate originally due on 2027-01-05 (which was 33 days late on 2027-02-07)
    // Calling cron on 2027-02-07 should mark 2027-01-05 as MISSED, advance to 2027-02-05,
    // and identify 2027-02-05 as due (within grace window, 2 days late).
    const resD4 = await get("/cron/autopay?date=2027-02-07", null, cronHeader);
    check("D4 on 2027-02-07: missed is 1 (Jan 5 marked MISSED)", resD4.data.missed === 1);
    check("D4 on 2027-02-07: due includes Feb 5 inside grace window", resD4.data.due >= 1);

    const janRunDoc = await MandateRun.findOne({ mandateId: mActiveDueDec5._id, dueDay: "2027-01-05" });
    check("Jan 5 MISSED run record persisted", janRunDoc?.status === "MISSED");
    const mAfterD4 = await Mandate.findById(mActiveDueDec5._id);
    check("Mandate nextRunDay is now 2027-02-05", mAfterD4.nextRunDay === "2027-02-05");

    // =========================================================================
    // Part 6: Concurrency Safety on MISSED Mandate Processing
    // =========================================================================
    console.log("\n--- Concurrency Safety on MISSED Mandate Processing ---");
    // Create a new mandate overdue by 10 days
    const concurrentMandate = await Mandate.create({
      payerId,
      payeeId,
      amount: 15000,
      dayOfMonth: 1,
      status: "ACTIVE",
      nextRunDay: "2026-12-01",
      failedCount: 0,
    });

    // Launch two parallel processMissedMandateRuns concurrently
    const [c1, c2] = await Promise.all([
      processMissedMandateRuns(concurrentMandate, "2026-12-15"),
      processMissedMandateRuns(concurrentMandate, "2026-12-15"),
    ]);

    // Exactly one worker must successfully claim and record the missed run
    const totalClaimed = c1.missedCount + c2.missedCount;
    check("Concurrency: exactly 1 worker claimed the missed run", totalClaimed === 1, `Total: ${totalClaimed}`);

    const concurrentRuns = await MandateRun.find({ mandateId: concurrentMandate._id, dueDay: "2026-12-01" });
    check("Concurrency: exactly 1 MISSED MandateRun persisted in DB", concurrentRuns.length === 1);

    const refreshedConcurrent = await Mandate.findById(concurrentMandate._id);
    check("Concurrency: mandate nextRunDay advanced to 2027-01-01", refreshedConcurrent.nextRunDay === "2027-01-01");

    // Clean up
    await Mandate.deleteMany({ payerId });
    await MandateRun.deleteMany({});

    // =========================================================================
    // Part 7: Batch Limit of 50, Continuation & Pagination
    // =========================================================================
    console.log("\n--- Batch Limit of 50, Continuation & Pagination ---");

    // Seed 60 active mandates overdue by 5 days (due 2026-12-01, tested on 2026-12-06)
    const bulkOverdue = [];
    for (let i = 1; i <= 60; i++) {
      bulkOverdue.push({
        payerId,
        payeeId,
        amount: 2000 + i,
        dayOfMonth: 1,
        status: "ACTIVE",
        nextRunDay: "2026-12-01",
        failedCount: 0,
      });
    }
    await Mandate.insertMany(bulkOverdue);

    const totalOverdueSeeded = await Mandate.countDocuments({ payerId, status: "ACTIVE", nextRunDay: "2026-12-01" });
    check("Seeded 60 active overdue mandates", totalOverdueSeeded === 60);

    // Invocations 1: selects at most 50, marks 50 MISSED, returns more: true
    const batch1 = await get("/cron/autopay?date=2026-12-06", null, cronHeader);
    check("Batch 1: missed is exactly 50", batch1.data.missed === 50, `Got: ${batch1.data.missed}`);
    check("Batch 1: more is true", batch1.data.more === true);

    const countAfterBatch1 = await MandateRun.countDocuments({ status: "MISSED" });
    check("After Batch 1: exactly 50 MandateRun records persisted", countAfterBatch1 === 50);

    // Invocations 2: reaches the remaining 10 mandates without skipping, returns more: false
    const batch2 = await get("/cron/autopay?date=2026-12-06", null, cronHeader);
    check("Batch 2: reaches remaining 10 mandates (missed: 10)", batch2.data.missed === 10, `Got: ${batch2.data.missed}`);
    check("Batch 2: more is false", batch2.data.more === false);

    const countAfterBatch2 = await MandateRun.countDocuments({ status: "MISSED" });
    check("After Batch 2: all 60 MandateRun records persisted", countAfterBatch2 === 60);

    // Invocations 3: all handled, zero remaining
    const batch3 = await get("/cron/autopay?date=2026-12-06", null, cronHeader);
    check("Batch 3: due is 0, missed is 0, more is false", batch3.data.due === 0 && batch3.data.missed === 0 && batch3.data.more === false);

    // Verify all 60 mandates have their nextRunDay advanced to 2027-01-01
    const advancedCount = await Mandate.countDocuments({ payerId, nextRunDay: "2027-01-01" });
    check("All 60 mandates advanced their nextRunDay cleanly", advancedCount === 60);

    // =========================================================================
    // Part 8: Simultaneous HTTP Cron Invocations (Due and Overdue Concurrency)
    // =========================================================================
    console.log("\n--- Simultaneous HTTP Cron Invocations (Due and Overdue Concurrency) ---");
    await Mandate.deleteMany({ payerId });
    await MandateRun.deleteMany({});

    // 1 Overdue mandate (9 days late, beyond grace window)
    const overdueMandate = await Mandate.create({
      payerId,
      payeeId,
      amount: 11000,
      dayOfMonth: 1,
      status: "ACTIVE",
      nextRunDay: "2026-12-01",
      failedCount: 0,
    });

    // 1 Due mandate (1 day late, within grace window)
    const dueMandate = await Mandate.create({
      payerId,
      payeeId,
      amount: 22000,
      dayOfMonth: 9,
      status: "ACTIVE",
      nextRunDay: "2026-12-09",
      failedCount: 0,
    });

    // Fire two simultaneous cron requests for 2026-12-10
    const [concurrentA, concurrentB] = await Promise.all([
      get("/cron/autopay?date=2026-12-10", null, cronHeader),
      get("/cron/autopay?date=2026-12-10", null, cronHeader),
    ]);

    check("Both concurrent cron requests return HTTP 200", concurrentA.status === 200 && concurrentB.status === 200);

    // Overdue mandate verification: Exactly 1 missed record claimed across both concurrent requests
    const totalMissedClaimed = concurrentA.data.missed + concurrentB.data.missed;
    check("Across concurrent invocations, exactly 1 MISSED run was recorded", totalMissedClaimed === 1, `Total: ${totalMissedClaimed}`);

    const missedRunsInDb = await MandateRun.find({ mandateId: overdueMandate._id, dueDay: "2026-12-01" });
    check("Database has exactly 1 MISSED MandateRun document", missedRunsInDb.length === 1);
    check("MISSED MandateRun status is MISSED", missedRunsInDb[0]?.status === "MISSED");

    const refreshedOverdue = await Mandate.findById(overdueMandate._id);
    check("Overdue mandate nextRunDay advanced to 2027-01-01", refreshedOverdue.nextRunDay === "2027-01-01");

    // Due mandate verification:
    // In Phase 2, due mandates are candidate-evaluated without money transfers or payment claiming (Level 3 responsibility).
    // Both invocations observe the due mandate as a candidate (due === 1) without moving money or creating runs.
    check("Concurrent invocation A reports due: 1", concurrentA.data.due === 1);
    check("Concurrent invocation B reports due: 1", concurrentB.data.due === 1);

    const dueRunsInDb = await MandateRun.find({ mandateId: dueMandate._id });
    check("Zero MandateRun records created for due mandate in Phase 2", dueRunsInDb.length === 0);

    const refreshedDue = await Mandate.findById(dueMandate._id);
    check("Due mandate nextRunDay remains unchanged in Phase 2 (awaiting Level 3 claim)", refreshedDue.nextRunDay === "2026-12-09");

    // =========================================================================
    // Part 9: Phase 2 Processing Boundary Verification
    // =========================================================================
    console.log("\n--- Phase 2 Processing Boundary (Strict Financial Non-Execution) ---");
    // Verify that NO money operations were executed
    const payerWalletAfter = await Wallet.findOne({ userId: payerId });
    const payeeWalletAfter = await Wallet.findOne({ userId: payeeId });

    check(
      "Payer wallet balance is untouched (no money moved)",
      payerWalletAfter.balance === payerWalletBefore.balance,
      `Before: ${payerWalletBefore.balance}, After: ${payerWalletAfter.balance}`
    );
    check(
      "Payee wallet balance is untouched (no money moved)",
      payeeWalletAfter.balance === payeeWalletBefore.balance,
      `Before: ${payeeWalletBefore.balance}, After: ${payeeWalletAfter.balance}`
    );

    const txnCount = await Transaction.countDocuments({ note: /AutoPay/i });
    check("Zero AutoPay transactions created in Phase 2", txnCount === 0, `Got: ${txnCount}`);

    const successRunCount = await MandateRun.countDocuments({ status: "SUCCESS" });
    check("Zero SUCCESS MandateRun records created in Phase 2", successRunCount === 0);

    const reconcileRes = await get("/admin/reconcile", null, { "x-admin-key": ADMIN_KEY });
    check("Admin reconcile returns 200", reconcileRes.status === 200);
    check("moneyIsConserved is true", reconcileRes.data.moneyIsConserved === true);
    check("mismatches count is 0", reconcileRes.data.mismatches?.length === 0);

  } finally {
    await mongoose.disconnect();
    server.kill();
    await replSet.stop();
  }

  console.log("\n===============================================================================");
  console.log(`=== DAY 10 PHASE 2 TEST SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED ===`);
  console.log("===============================================================================");

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
