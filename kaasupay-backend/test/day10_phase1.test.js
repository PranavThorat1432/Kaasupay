// test/day10_phase1.test.js — AutoPay Phase 1 Acceptance & Concurrency Hardening Test Suite
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import Mandate from "../models/mandateModel.js";
import MandateRun from "../models/mandateRunModel.js";
import { calculateNextRunDay, nextMonthDay } from "../services/autopayService.js";
import { indiaDay } from "../services/dailyLimitService.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3126;
const BASE = `http://localhost:${PORT}`;
const API = `${BASE}/api/v1`;
const ADMIN_KEY = process.env.ADMIN_KEY || "kaasupay_admin_1432";

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
  console.log("=== KAASUPAY DAY 10 PHASE 1: AUTOPAY SETUP & MANAGEMENT (D1 & D6) ===");
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
    JWT_SECRET: "test_jwt_secret_autopay_day10",
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
    // --- Verify Indexes ---
    console.log("--- Model Indexes Verification ---");
    await Mandate.init();
    await MandateRun.init();

    const mandateIndexes = await Mandate.collection.indexes();
    const hasStatusNextRunIndex = mandateIndexes.some(
      (idx) => idx.key?.status === 1 && idx.key?.nextRunDay === 1
    );
    check("Mandate collection has { status: 1, nextRunDay: 1 } index", hasStatusNextRunIndex);

    const mandateRunIndexes = await MandateRun.collection.indexes();
    const uniqueRunIndex = mandateRunIndexes.find(
      (idx) => idx.key?.mandateId === 1 && idx.key?.dueDay === 1
    );
    check(
      "MandateRun collection has unique compound index { mandateId: 1, dueDay: 1 }",
      Boolean(uniqueRunIndex && uniqueRunIndex.unique)
    );

    // =========================================================================
    // Issue 3: Date Calculation Boundaries Verification
    // =========================================================================
    console.log("\n--- Issue 3: Date Calculation Boundaries ---");

    // 1. November 15, day 5 -> strictly next month (2026-12-05)
    const nov15Day5 = calculateNextRunDay(5, "2026-11-15");
    check("Nov 15, day 5 -> 2026-12-05", nov15Day5 === "2026-12-05", nov15Day5);

    // 2. December 5, day 5 -> strictly next month and rollover to January 2027 (2027-01-05)
    const dec5Day5 = calculateNextRunDay(5, "2026-12-05");
    check("Dec 5, day 5 -> 2027-01-05 (never on creation date)", dec5Day5 === "2027-01-05", dec5Day5);

    // 3. December 28, day 28 -> rollover to January 28 (2027-01-28)
    const dec28Day28 = calculateNextRunDay(28, "2026-12-28");
    check("Dec 28, day 28 -> 2027-01-28", dec28Day28 === "2027-01-28", dec28Day28);

    // 4. December-to-January rollover with mid-month dates:
    // When dayOfMonth <= currentDay: Dec 15, day 10 -> 2027-01-10
    const dec15Day10 = calculateNextRunDay(10, "2026-12-15");
    check("Dec 15, day 10 -> 2027-01-10 (year rollover)", dec15Day10 === "2027-01-10", dec15Day10);

    // When dayOfMonth > currentDay: Dec 15, day 20 -> 2026-12-20
    const dec15Day20 = calculateNextRunDay(20, "2026-12-15");
    check("Dec 15, day 20 -> 2026-12-20 (same month)", dec15Day20 === "2026-12-20", dec15Day20);

    // 5. India timezone midnight boundary (UTC + 5:30):
    // 2026-11-15T18:29:59.999Z is 23:59:59.999 IST on Nov 15
    const preMidnightDate = new Date("2026-11-15T18:29:59.999Z");
    const preMidnightDay = indiaDay(preMidnightDate);
    check("Pre-midnight UTC 18:29:59.999Z maps to 2026-11-15 IST", preMidnightDay === "2026-11-15");

    // 2026-11-15T18:30:00.000Z is 00:00:00.000 IST on Nov 16
    const postMidnightDate = new Date("2026-11-15T18:30:00.000Z");
    const postMidnightDay = indiaDay(postMidnightDate);
    check("Post-midnight UTC 18:30:00.000Z maps to 2026-11-16 IST", postMidnightDay === "2026-11-16");

    // Scheduling relative to midnight boundaries:
    const schedPreMidnight = calculateNextRunDay(15, preMidnightDate);
    check("Pre-midnight creation on day 15 schedules for 2026-12-15", schedPreMidnight === "2026-12-15");

    const schedPostMidnight = calculateNextRunDay(16, postMidnightDate);
    check("Post-midnight creation on day 16 schedules for 2026-12-16", schedPostMidnight === "2026-12-16");

    // nextMonthDay helper verification
    const advancedDec = nextMonthDay("2026-12-05");
    check("nextMonthDay(2026-12-05) -> 2027-01-05", advancedDec === "2027-01-05");

    // --- Setup: Users Arun, Bala, Chitra ---
    console.log("\n--- Setup: Seed Users & Payment PINs ---");
    const arunSignup = await post("/user/signup", {
      username: "arun@test.local",
      firstName: "Arun",
      lastName: "Kumar",
      password: "password123",
    });
    check("Arun signup -> 201", arunSignup.status === 201);
    const arunSignin = await post("/user/signin", {
      username: "arun@test.local",
      password: "password123",
    });
    const arunToken = arunSignin.data.token;
    const arunId = arunSignup.data.user._id;

    const balaSignup = await post("/user/signup", {
      username: "bala@test.local",
      firstName: "Bala",
      lastName: "Murugan",
      password: "password123",
    });
    check("Bala signup -> 201", balaSignup.status === 201);
    const balaSignin = await post("/user/signin", {
      username: "bala@test.local",
      password: "password123",
    });
    const balaToken = balaSignin.data.token;
    const balaId = balaSignup.data.user._id;

    const chitraSignup = await post("/user/signup", {
      username: "chitra@test.local",
      firstName: "Chitra",
      lastName: "Raman",
      password: "password123",
    });
    check("Chitra signup -> 201", chitraSignup.status === 201);
    const chitraSignin = await post("/user/signin", {
      username: "chitra@test.local",
      password: "password123",
    });
    const chitraToken = chitraSignin.data.token;
    const chitraId = chitraSignup.data.user._id;

    // Set Payment PINs
    const setArunPin = await post("/user/pin", { password: "password123", pin: "2468" }, arunToken);
    check("Set Arun PIN (2468) -> 200", setArunPin.status === 200);

    const setBalaPin = await post("/user/pin", { password: "password123", pin: "1357" }, balaToken);
    check("Set Bala PIN (1357) -> 200", setBalaPin.status === 200);

    const setChitraPin = await post("/user/pin", { password: "password123", pin: "9024" }, chitraToken);
    check("Set Chitra PIN (9024) -> 200", setChitraPin.status === 200);

    // Fund Arun with ₹10,000 (1,000,000 paise) and Chitra with ₹100 (10,000 paise)
    const depositArun = await post(
      "/admin/deposit",
      { to: "arun@test.local", amount: 1000000, note: "Staff deposit for Arun" },
      null,
      { "x-admin-key": ADMIN_KEY }
    );
    check("Deposit ₹10,000 for Arun -> 201", depositArun.status === 201);

    const depositChitra = await post(
      "/admin/deposit",
      { to: "chitra@test.local", amount: 10000, note: "Staff deposit for Chitra" },
      null,
      { "x-admin-key": ADMIN_KEY }
    );
    check("Deposit ₹100 for Chitra -> 201", depositChitra.status === 201);

    // =========================================================================
    // D1: Set up AutoPay
    // =========================================================================
    console.log("\n--- D1: Set up AutoPay ---");

    // Verify that the User write lock acquisition with timestamps: false does not modify updatedAt
    const userBeforeLock = await User.findById(arunId);
    const lockedUser = await User.findOneAndUpdate(
      { _id: arunId },
      { $inc: { autopayMandateLockVersion: 1 } },
      { returnDocument: "after", timestamps: false }
    );
    check(
      "User updatedAt remains unchanged across lock acquisition (timestamps: false)",
      lockedUser.updatedAt.getTime() === userBeforeLock.updatedAt.getTime(),
      `Before: ${userBeforeLock.updatedAt.toISOString()}, After: ${lockedUser.updatedAt.toISOString()}`
    );
    check(
      "User autopayMandateLockVersion increments by 1",
      lockedUser.autopayMandateLockVersion === (userBeforeLock.autopayMandateLockVersion || 0) + 1
    );

    // Valid setup: Arun sets up AutoPay to Bala (₹500 on the 5th)
    const validSetup = await post(
      "/autopay",
      { to: balaId, amount: 50000, dayOfMonth: 5, pin: "2468" },
      arunToken
    );
    check("Valid AutoPay setup -> 201", validSetup.status === 201);
    check("Response message is 'AutoPay set up'", validSetup.data.message === "AutoPay set up");
    check("Mandate recipient display name is 'Bala Murugan'", validSetup.data.mandate?.to === "Bala Murugan");
    check("Mandate amount is 50000 paise", validSetup.data.mandate?.amount === 50000);
    check("Mandate dayOfMonth is 5", validSetup.data.mandate?.dayOfMonth === 5);
    check("Mandate status is ACTIVE", validSetup.data.mandate?.status === "ACTIVE");
    check("Mandate nextRunDay is defined (YYYY-MM-DD)", /^\d{4}-\d{2}-\d{2}$/.test(validSetup.data.mandate?.nextRunDay));

    const arunAfterSetup = await User.findById(arunId);
    check(
      "User autopayMandateLockVersion increments on AutoPay setup",
      arunAfterSetup.autopayMandateLockVersion === lockedUser.autopayMandateLockVersion + 1,
      `Got: ${arunAfterSetup.autopayMandateLockVersion}`
    );

    const arunMandate1Id = validSetup.data.mandate?.id;

    // Invalid dayOfMonth: 31 -> 400
    const invalidDay31 = await post(
      "/autopay",
      { to: balaId, amount: 50000, dayOfMonth: 31, pin: "2468" },
      arunToken
    );
    check("dayOfMonth: 31 returns 400", invalidDay31.status === 400);
    check("Error message is 'Invalid inputs'", invalidDay31.data.message === "Invalid inputs");

    // Invalid dayOfMonth: 0 -> 400
    const invalidDay0 = await post(
      "/autopay",
      { to: balaId, amount: 50000, dayOfMonth: 0, pin: "2468" },
      arunToken
    );
    check("dayOfMonth: 0 returns 400", invalidDay0.status === 400);

    // Invalid amount: 600000 (exceeds ₹5,000 cap) -> 400
    const invalidAmountMax = await post(
      "/autopay",
      { to: balaId, amount: 600000, dayOfMonth: 5, pin: "2468" },
      arunToken
    );
    check("amount: 600000 returns 400", invalidAmountMax.status === 400);
    check("Error message is 'Invalid inputs'", invalidAmountMax.data.message === "Invalid inputs");

    // Invalid amount: 50 (below ₹1 minimum) -> 400
    const invalidAmountMin = await post(
      "/autopay",
      { to: balaId, amount: 50, dayOfMonth: 5, pin: "2468" },
      arunToken
    );
    check("amount: 50 returns 400", invalidAmountMin.status === 400);

    // Self-payment: Arun to Arun -> 400
    const selfPayment = await post(
      "/autopay",
      { to: arunId, amount: 50000, dayOfMonth: 5, pin: "2468" },
      arunToken
    );
    check("Self-payment returns 400", selfPayment.status === 400);
    check(
      "Message is 'You can't set up AutoPay to yourself'",
      selfPayment.data.message === "You can't set up AutoPay to yourself"
    );

    // Missing / Non-existent recipient -> 404
    const nonExistentRecipient = await post(
      "/autopay",
      { to: new mongoose.Types.ObjectId().toString(), amount: 50000, dayOfMonth: 5, pin: "2468" },
      arunToken
    );
    check("Non-existent recipient returns 404", nonExistentRecipient.status === 404);
    check("Message is 'User not found'", nonExistentRecipient.data.message === "User not found");

    // Wrong PIN -> 403 with triesLeft
    const wrongPin = await post(
      "/autopay",
      { to: balaId, amount: 50000, dayOfMonth: 5, pin: "9999" },
      arunToken
    );
    check("Wrong PIN returns 403", wrongPin.status === 403);
    check("Message is 'Wrong PIN. 2 tries left'", wrongPin.data.message === "Wrong PIN. 2 tries left");
    check("triesLeft is 2", wrongPin.data.triesLeft === 2);

    // Reset Arun's PIN attempt counter with correct PIN setup
    const resetPin = await post(
      "/autopay",
      { to: chitraId, amount: 10000, dayOfMonth: 15, pin: "2468" },
      arunToken
    );
    check("Correct PIN resets failed counter and creates second mandate -> 201", resetPin.status === 201);
    const arunMandate2Id = resetPin.data.mandate?.id;

    // --- List Mandates & Run History ---
    console.log("\n--- List Mandates & Run History ---");
    const listArun = await get("/autopay", arunToken);
    check("GET /autopay returns 200", listArun.status === 200);
    check("Arun has 2 mandates", listArun.data.mandates?.length === 2);
    check("First mandate payee display name is populated", Boolean(listArun.data.mandates?.[0]?.to));
    check("Mandate includes nextRunDay and failedCount", listArun.data.mandates?.[0]?.failedCount === 0);

    // Privacy isolation: Bala should see 0 mandates
    const listBala = await get("/autopay", balaToken);
    check("Bala sees 0 mandates as payer", listBala.data.mandates?.length === 0);

    // =========================================================================
    // Issue 2: Execution History Ordering Verification
    // =========================================================================
    console.log("\n--- Issue 2: Execution History Ordering ---");
    // Seed multiple runs for arunMandate1Id simulating batch catch-up
    await MandateRun.create([
      {
        mandateId: arunMandate1Id,
        dueDay: "2027-01-05",
        status: "MISSED",
        amount: 50000,
        reason: "Overdue by 33 days",
      },
      {
        mandateId: arunMandate1Id,
        dueDay: "2027-02-05",
        status: "SUCCESS",
        amount: 50000,
      },
      {
        mandateId: arunMandate1Id,
        dueDay: "2026-12-05",
        status: "SUCCESS",
        amount: 50000,
      },
    ]);

    const runsRes = await get(`/autopay/${arunMandate1Id}/runs`, arunToken);
    check("GET /autopay/:id/runs returns 200", runsRes.status === 200);
    check("Runs list contains 3 records", runsRes.data.runs?.length === 3);
    check(
      "First run is newest scheduled (2027-02-05)",
      runsRes.data.runs?.[0]?.dueDay === "2027-02-05"
    );
    check(
      "Second run is intermediate (2027-01-05)",
      runsRes.data.runs?.[1]?.dueDay === "2027-01-05"
    );
    check(
      "Third run is oldest (2026-12-05)",
      runsRes.data.runs?.[2]?.dueDay === "2026-12-05"
    );

    // Stranger isolation: Bala cannot view runs of Arun's mandate (404)
    const strangerRuns = await get(`/autopay/${arunMandate1Id}/runs`, balaToken);
    check("Stranger querying runs receives 404", strangerRuns.status === 404);
    check("Message is 'AutoPay not found'", strangerRuns.data.message === "AutoPay not found");

    // =========================================================================
    // D6: Mandate Management (Pause, Resume, Cancel, Limit)
    // =========================================================================
    console.log("\n--- D6: Pause, Resume, Cancel & Limits ---");

    // Arun pauses his AutoPay
    const pauseRes = await post(`/autopay/${arunMandate1Id}/pause`, {}, arunToken);
    check("Arun pauses his AutoPay -> 200", pauseRes.status === 200);
    check("Message is 'AutoPay paused'", pauseRes.data.message === "AutoPay paused");

    // Arun pauses it again -> 409
    const duplicatePause = await post(`/autopay/${arunMandate1Id}/pause`, {}, arunToken);
    check("Arun pauses already PAUSED mandate -> 409", duplicatePause.status === 409);
    check("Message is 'This AutoPay is already PAUSED'", duplicatePause.data.message === "This AutoPay is already PAUSED");

    // Bala tries to cancel Arun's AutoPay -> 404
    const strangerCancel = await post(`/autopay/${arunMandate1Id}/cancel`, {}, balaToken);
    check("Bala cancels Arun's AutoPay returns 404", strangerCancel.status === 404);
    check("Stranger cancel message is 'AutoPay not found'", strangerCancel.data.message === "AutoPay not found");

    // Arun cancels it -> 200
    const cancelRes = await post(`/autopay/${arunMandate1Id}/cancel`, {}, arunToken);
    check("Arun cancels it -> 200", cancelRes.status === 200);
    check("Message is 'AutoPay cancelled'", cancelRes.data.message === "AutoPay cancelled");

    // Arun resumes cancelled mandate -> 409
    const resumeCancelled = await post(`/autopay/${arunMandate1Id}/resume`, {}, arunToken);
    check("Arun resumes cancelled mandate -> 409", resumeCancelled.status === 409);
    check("Message is 'This AutoPay is already CANCELLED'", resumeCancelled.data.message === "This AutoPay is already CANCELLED");

    // Arun cancels already cancelled mandate -> 409
    const duplicateCancel = await post(`/autopay/${arunMandate1Id}/cancel`, {}, arunToken);
    check("Duplicate cancel returns 409", duplicateCancel.status === 409);
    check("Message is 'This AutoPay is already CANCELLED'", duplicateCancel.data.message === "This AutoPay is already CANCELLED");

    // Pause/Resume flow on second mandate:
    const pauseMandate2 = await post(`/autopay/${arunMandate2Id}/pause`, {}, arunToken);
    check("Pause active mandate 2 -> 200", pauseMandate2.status === 200);

    const resumeMandate2 = await post(`/autopay/${arunMandate2Id}/resume`, {}, arunToken);
    check("Resume paused mandate 2 -> 200", resumeMandate2.status === 200);
    check("Message is 'AutoPay resumed'", resumeMandate2.data.message === "AutoPay resumed");
    check("nextRunDay is recalculated and returned", Boolean(resumeMandate2.data.nextRunDay));

    const duplicateResume = await post(`/autopay/${arunMandate2Id}/resume`, {}, arunToken);
    check("Resume already ACTIVE mandate -> 409", duplicateResume.status === 409);
    check("Message is 'This AutoPay is already ACTIVE'", duplicateResume.data.message === "This AutoPay is already ACTIVE");

    // Cancel mandate 2 so Arun has 0 non-cancelled mandates
    await post(`/autopay/${arunMandate2Id}/cancel`, {}, arunToken);

    // =========================================================================
    // Issue 1: Five-Mandate Limit Concurrency Blast
    // =========================================================================
    console.log("\n--- Issue 1: Five-Mandate Limit Concurrency Blast ---");
    // Arun sets up exactly 4 active/paused mandates
    const setupIds = [];
    for (let i = 1; i <= 4; i++) {
      const res = await post(
        "/autopay",
        { to: balaId, amount: 10000 * i, dayOfMonth: i + 2, pin: "2468" },
        arunToken
      );
      check(`Arun sets up base mandate ${i}/4 -> 201`, res.status === 201);
      if (res.data.mandate?.id) setupIds.push(res.data.mandate.id);
    }

    // Verify currently exactly 4 non-cancelled mandates exist
    const countBeforeBlast = await Mandate.countDocuments({
      payerId: arunId,
      status: { $ne: "CANCELLED" },
    });
    check("Payer currently has exactly 4 non-cancelled mandates", countBeforeBlast === 4);

    // Launch TWO concurrent POST /autopay requests for Arun simultaneously
    console.log("Blasting 2 concurrent POST /autopay requests when count is 4...");
    const [blastRes1, blastRes2] = await Promise.all([
      post("/autopay", { to: balaId, amount: 25000, dayOfMonth: 12, pin: "2468" }, arunToken),
      post("/autopay", { to: chitraId, amount: 35000, dayOfMonth: 18, pin: "2468" }, arunToken),
    ]);

    const statuses = [blastRes1.status, blastRes2.status];
    const successes = statuses.filter((s) => s === 201).length;
    const conflicts = statuses.filter((s) => s === 409).length;

    check("Exactly 1 concurrent request succeeds (201)", successes === 1, `Statuses: ${statuses}`);
    check("Exactly 1 concurrent request is rejected with 409", conflicts === 1, `Statuses: ${statuses}`);

    const rejectedRes = blastRes1.status === 409 ? blastRes1 : blastRes2;
    check(
      "Rejected concurrent response message is 'You can have at most 5 AutoPays'",
      rejectedRes.data.message === "You can have at most 5 AutoPays"
    );

    // Verify database authoritative count is EXACTLY 5
    const finalCount = await Mandate.countDocuments({
      payerId: arunId,
      status: { $ne: "CANCELLED" },
    });
    check("Final non-cancelled mandate count in database is EXACTLY 5", finalCount === 5, `Got: ${finalCount}`);

    // Any subsequent mandate setup MUST return 409
    const afterBlastSetup = await post(
      "/autopay",
      { to: chitraId, amount: 40000, dayOfMonth: 22, pin: "2468" },
      arunToken
    );
    check("Subsequent setup when full returns 409", afterBlastSetup.status === 409);

    // Cancel one mandate to reduce count to 4
    await post(`/autopay/${setupIds[0]}/cancel`, {}, arunToken);
    const countAfterCancel = await Mandate.countDocuments({
      payerId: arunId,
      status: { $ne: "CANCELLED" },
    });
    check("Count after cancellation is 4", countAfterCancel === 4);

    // Now a new mandate setup succeeds -> 201
    const allowedAfterCancel = await post(
      "/autopay",
      { to: chitraId, amount: 40000, dayOfMonth: 22, pin: "2468" },
      arunToken
    );
    check("Creating 5th mandate after cancellation succeeds -> 201", allowedAfterCancel.status === 201);

    // Cancel one mandate for Arun so he has 4 mandates
    await post(`/autopay/${setupIds[1]}/cancel`, {}, arunToken);

    // Cross-user concurrency: Different users (Arun and Chitra) creating mandates concurrently
    console.log("Testing concurrent mandate creation across distinct users (Arun & Chitra)...");
    const [crossUserRes1, crossUserRes2] = await Promise.all([
      post("/autopay", { to: balaId, amount: 15000, dayOfMonth: 8, pin: "2468" }, arunToken),
      post("/autopay", { to: balaId, amount: 12000, dayOfMonth: 9, pin: "9024" }, chitraToken),
    ]);
    check("Cross-user concurrent mandate 1 (Arun) succeeds -> 201", crossUserRes1.status === 201);
    check("Cross-user concurrent mandate 2 (Chitra) succeeds -> 201", crossUserRes2.status === 201);

    // Financial check: Reconcile must confirm money is conserved (no money was moved in Phase 1)
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
  console.log(`=== DAY 10 PHASE 1 TEST SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED ===`);
  console.log("===============================================================================");

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
