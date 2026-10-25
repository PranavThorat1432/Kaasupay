// test/integrated_worker.test.js — Acceptance tests for integrated API + Payout Worker
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";
import mongoose from "mongoose";
import { createFakeBankApp } from "../tools/fake-bank.js";
import Withdrawal from "../models/withdrawalModel.js";
import Wallet from "../models/walletModel.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3218;
const BASE = `http://localhost:${PORT}`;
const FAKE_BANK_PORT = 4218;
const BANK_URL = `http://localhost:${FAKE_BANK_PORT}`;
const ADMIN_KEY = "test_admin_key_integrated_1432";
const JWT_SECRET = "test_jwt_secret_integrated_worker_32bytes_ok";
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
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  child.getOutput = () => output;
  return child;
}

async function waitForHealth(url = `${BASE}/`, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status === 200 || res.status === 503) {
        return { ok: true, status: res.status, json: await res.json() };
      }
    } catch {
      // server starting
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ok: false, status: 0, json: null };
}

async function run() {
  console.log("=== Starting Integrated Worker Acceptance Tests ===");

  // 1. Start in-memory replica set for multi-document ACID transactions
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await replSet.waitUntilRunning();
  const mongoUri = replSet.getUri("kaasupay");

  // 2. Start fake bank HTTP server
  const fakeBank = createFakeBankApp();
  const bankServer = http.createServer(fakeBank.app);
  await new Promise((resolve) => bankServer.listen(FAKE_BANK_PORT, resolve));
  console.log(`Fake bank listening on ${BANK_URL}`);

  // 3. Connect direct mongoose for DB inspections
  await mongoose.connect(mongoUri, { dbName: "kaasupay" });

  try {
    // -------------------------------------------------------------------------
    // TEST 1: MongoDB connection failure prevents unsafe worker & server startup
    // -------------------------------------------------------------------------
    console.log("\n--- Test 1: DB Connection Failure Guard ---");
    const badDbServer = spawnServer({
      PORT: String(PORT),
      MONGO_URL: "mongodb://127.0.0.1:1/nonexistent?serverSelectionTimeoutMS=1500",
      ADMIN_KEY,
      JWT_SECRET,
    });
    const badDbExitCode = await new Promise((resolve) => {
      badDbServer.on("close", (code) => resolve(code));
      setTimeout(() => badDbServer.kill(), 10000);
    });
    check("DB connection failure prevents startup with non-zero exit", badDbExitCode !== 0, `Exit: ${badDbExitCode}`);
    check("DB failure logs failure message", badDbServer.getOutput().includes("MongoDB connection failed"), badDbServer.getOutput());

    // -------------------------------------------------------------------------
    // TEST 2: API boots and starts worker exactly once; health check reports 200
    // -------------------------------------------------------------------------
    console.log("\n--- Test 2: Startup & Health Check Endpoint ---");
    const server = spawnServer({
      PORT: String(PORT),
      MONGO_URL: mongoUri,
      ADMIN_KEY,
      JWT_SECRET,
      BANK_URL,
      BANK_ENCRYPTION_KEY: ENCRYPTION_KEY,
      NODE_ENV: "development",
    });

    const healthRes = await waitForHealth();
    check("Server is healthy and returned HTTP 200", healthRes.status === 200, JSON.stringify(healthRes));
    check("Health response matches standard contract", healthRes.json?.status === "KaasuPay backend is running", JSON.stringify(healthRes.json));
    check("Health response reports connected database", healthRes.json?.database?.status === "connected", JSON.stringify(healthRes.json));
    check("Health response reports running worker", healthRes.json?.worker?.status === "running", JSON.stringify(healthRes.json));
    check("Health response reports loop is alive and making progress", healthRes.json?.worker?.loopAlive === true, JSON.stringify(healthRes.json));
    check("Health check works on /healthz alias", (await fetch(`${BASE}/healthz`)).status === 200);

    // Verify worker started exactly once in server output
    const out = server.getOutput();
    const workerStarts = (out.match(/\[worker\] Payout worker started\./g) || []).length;
    check("API starts worker exactly once", workerStarts === 1, `Matches: ${workerStarts}`);

    // -------------------------------------------------------------------------
    // TEST 3: Concurrent API requests while worker is actively polling
    // -------------------------------------------------------------------------
    console.log("\n--- Test 3: API Responsiveness During Worker Polling ---");
    const signupRes = await fetch(`${BASE}/api/v1/user/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Integrated",
        lastName: "User",
        username: "integrated@example.com",
        password: "Password123!",
      }),
    });
    check("API processes user signup while worker polls", signupRes.status === 201, `Status: ${signupRes.status}`);
    const signupData = await signupRes.json();
    const user = signupData.user;

    const signinRes = await fetch(`${BASE}/api/v1/user/signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "integrated@example.com",
        password: "Password123!",
      }),
    });
    check("User signin generates auth token", signinRes.status === 200);
    const signinData = await signinRes.json();
    const token = signinData.token;

    // Deposit funds via admin endpoint
    const depRes = await fetch(`${BASE}/api/v1/admin/deposit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": ADMIN_KEY,
      },
      body: JSON.stringify({
        to: "integrated@example.com",
        amount: 80000, // ₹800.00
      }),
    });
    check("Admin deposit succeeds", depRes.status === 201);

    // -------------------------------------------------------------------------
    // TEST 4: End-to-end automatic payout processing via integrated worker
    // -------------------------------------------------------------------------
    console.log("\n--- Test 4: End-to-End Automatic Payout Processing ---");
    // Add bank account
    const bankRes = await fetch(`${BASE}/api/v1/wallet/bank-accounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        holderName: "Integrated User",
        accountNumber: "987654321012",
        ifsc: "HDFC0001234",
      }),
    });
    const bankData = await bankRes.json();
    check("Bank account added", bankRes.status === 201, JSON.stringify(bankData));

    // Request withdrawal
    const withdrawRes = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": "int-wd-001",
      },
      body: JSON.stringify({
        bankAccountId: bankData.id,
        amount: 25000, // ₹250.00
      }),
    });
    const withdrawData = await withdrawRes.json();
    check("Withdrawal accepted with 202", withdrawRes.status === 202, JSON.stringify(withdrawData));
    const wdId = withdrawData.withdrawal?.id;

    // Poll DB until integrated worker automatically transitions status to SUCCESS
    const deadline = Date.now() + 10000;
    let settledDoc = null;
    while (Date.now() < deadline) {
      settledDoc = await Withdrawal.findById(wdId);
      if (settledDoc && settledDoc.status === "SUCCESS") break;
      await new Promise((r) => setTimeout(r, 200));
    }
    check("Integrated worker automatically processes withdrawal to SUCCESS without manual intervention", settledDoc?.status === "SUCCESS", `Status: ${settledDoc?.status}`);
    check("Settled withdrawal has valid bank reference (UTR)", Boolean(settledDoc?.bankRef?.startsWith("UTR")), settledDoc?.bankRef);

    // Replay with identical idempotency key returns exact same status without duplicate deduction
    const replayRes = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": "int-wd-001",
      },
      body: JSON.stringify({
        bankAccountId: bankData.id,
        amount: 25000,
      }),
    });
    const replayData = await replayRes.json();
    check("Replay returns 202 with same withdrawal ID", replayRes.status === 202 && replayData.withdrawal?.id === wdId);
    const walletDoc = await Wallet.findOne({ userId: user._id });
    check("Wallet balance remains intact at ₹550.00 without duplicate deduction", walletDoc.balance === 55000, `Balance: ${walletDoc.balance}`);

    // -------------------------------------------------------------------------
    // TEST 5: Graceful shutdown stops worker, server, and DB cleanly
    // -------------------------------------------------------------------------
    console.log("\n--- Test 5: Graceful Shutdown (SIGTERM) ---");
    if (server.send) {
      server.send("SIGTERM");
    } else {
      server.kill("SIGTERM");
    }
    const exitCode = await new Promise((resolve) => {
      server.on("close", (code) => resolve(code));
      setTimeout(() => resolve("TIMEOUT"), 8000);
    });
    check("Server exited gracefully on SIGTERM with code 0", exitCode === 0, `Exit: ${exitCode}`);
    const shutOutput = server.getOutput();
    check("Shutdown logs worker stopped", shutOutput.includes("[worker] Payout worker stopped."), shutOutput);
    check("Shutdown logs HTTP server closed", shutOutput.includes("[server] HTTP server closed."), shutOutput);
    check("Shutdown logs MongoDB connection closed", shutOutput.includes("[server] MongoDB connection closed."), shutOutput);

  } finally {
    await mongoose.disconnect();
    await new Promise((resolve) => bankServer.close(resolve));
    await replSet.stop();
  }

  console.log(`\n==========================================`);
  console.log(`INTEGRATED WORKER TEST SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED`);
  console.log(`==========================================`);

  if (failures > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
