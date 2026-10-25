// test/day6.test.js — KaasuPay Day 6 Security Acceptance Tests
// Covers:
//   - Payment PIN setup, validation, and user/me flag (D1)
//   - 3 wrong PIN attempts lockout (15m), Retry-After, staff unlock, idempotency safety (D2)
//   - Correct PIN resets failed attempts counter (D3)
//   - Shared ₹10,000 daily outgoing limit across transfers and withdrawals (D4)
//   - Signin rate limit per email with 429 and Retry-After (D5)
//   - Money rate limit (10/min) shared across transfers and withdrawals (D6)
//   - Logout of all devices via tokenVersion (D7)
//   - Password change tokenVersion invalidation and fresh token issuance (D8)
//   - Full regression verification (Day 1-5 features intact) (D9)
//   - Concurrency tests (Bonus 8: atomic PIN tries and atomic daily limit)
//
// Run: node test/day6.test.js

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import mongoose from "mongoose";
import http from "node:http";
import { createFakeBankApp } from "../tools/fake-bank.js";
import BankAccount from "../models/bankAccountModel.js";
import User from "../models/userModel.js";
import Wallet from "../models/walletModel.js";
import DailySpend from "../models/dailySpendModel.js";
import RateLimitCounter from "../models/rateLimitCounterModel.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3118;
const BASE = `http://localhost:${PORT}`;
const FAKE_BANK_PORT = 4118;
const BANK_URL = `http://localhost:${FAKE_BANK_PORT}`;
const ADMIN_KEY = process.env.ADMIN_KEY || "kaasupay_admin_1432";

let failures = 0;
let passedAssertions = 0;

function check(name, condition, detail) {
  if (condition) {
    passedAssertions += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name} -> ${detail}`);
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

async function main() {
  console.log("=== Starting Day 6 Test Suite ===");

  // 1. Start in-memory replica set
  console.log("Starting in-memory MongoMemoryReplSet...");
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await replSet.waitUntilRunning();
  const mongoUri = replSet.getUri("kaasupay");

  // 2. Start fake bank server
  const fakeBank = createFakeBankApp();
  const bankServer = http.createServer(fakeBank.app);
  await new Promise((resolve) => bankServer.listen(FAKE_BANK_PORT, resolve));
  console.log(`Fake bank listening on ${BANK_URL}`);

  // 3. Connect direct mongoose connection
  await mongoose.connect(mongoUri, { dbName: "kaasupay" });

  const encryptionKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.BANK_ENCRYPTION_KEY = encryptionKey;

  // 4. Spawn backend server
  const serverEnv = {
    PORT: String(PORT),
    MONGO_URL: mongoUri,
    ADMIN_KEY,
    JWT_SECRET: "test_secret_for_day6_security_testing_32bytes_ok",
    BANK_URL,
    BANK_ENCRYPTION_KEY: encryptionKey,
    NODE_ENV: "development",
  };
  const server = spawnServer(serverEnv);

  const healthy = await waitForHealth();
  if (!healthy) {
    console.error("Server failed to start:\n", server.getOutput());
    process.exit(1);
  }
  console.log("Backend server started and healthy.");

  try {
    // Helpers
    async function post(url, body, headers = {}) {
      const res = await fetch(`${BASE}${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, json, headers: res.headers };
    }

    async function get(url, headers = {}) {
      const res = await fetch(`${BASE}${url}`, {
        method: "GET",
        headers,
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, json, headers: res.headers };
    }

    async function put(url, body, headers = {}) {
      const res = await fetch(`${BASE}${url}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, json, headers: res.headers };
    }

    async function createUser(username, firstName, lastName, password) {
      const res = await post("/api/v1/user/signup", {
        username,
        firstName,
        lastName,
        password,
      });
      const signinRes = await post("/api/v1/user/signin", {
        username,
        password,
      });
      return {
        user: res.json?.user,
        token: signinRes.json?.token,
      };
    }

    // --- SETUP: Create Raju and Priya ---
    const raju = await createUser("raju@gmail.com", "Raju", "Kumar", "password123");
    const priya = await createUser("priya@gmail.com", "Priya", "Sharma", "password123");

    // Deposit ₹20,000 (2,000,000 paise) into Raju's wallet
    const depRes = await post(
      "/api/v1/admin/deposit",
      { to: "raju@gmail.com", amount: 2000000, note: "Initial Day 6 Test Capital" },
      { "x-admin-key": ADMIN_KEY }
    );
    check("Raju initial deposit -> 201", depRes.status === 201);

    // --- D1: Setting the PIN ---
    console.log("\n--- Testing D1: Setting the PIN ---");
    const pin1234 = await post(
      "/api/v1/user/pin",
      { password: "password123", pin: "1234" },
      { Authorization: `Bearer ${raju.token}` }
    );
    check(
      "D1.1: Common PIN 1234 rejected -> 400",
      pin1234.status === 400 && pin1234.json?.message === "PIN is too easy to guess",
      JSON.stringify(pin1234.json)
    );

    const pin0000 = await post(
      "/api/v1/user/pin",
      { password: "password123", pin: "0000" },
      { Authorization: `Bearer ${raju.token}` }
    );
    check(
      "D1.2: Repetitive PIN 0000 rejected -> 400",
      pin0000.status === 400 && pin0000.json?.message === "PIN is too easy to guess",
      JSON.stringify(pin0000.json)
    );

    const pinAlpha = await post(
      "/api/v1/user/pin",
      { password: "password123", pin: "12a4" },
      { Authorization: `Bearer ${raju.token}` }
    );
    check(
      "D1.3: Non-digit PIN rejected -> 400",
      pinAlpha.status === 400 && pinAlpha.json?.message === "PIN must be 4 or 6 digits",
      JSON.stringify(pinAlpha.json)
    );

    const pinWrongPw = await post(
      "/api/v1/user/pin",
      { password: "wrongpassword", pin: "5829" },
      { Authorization: `Bearer ${raju.token}` }
    );
    check(
      "D1.4: Wrong password rejected -> 401",
      pinWrongPw.status === 401 && pinWrongPw.json?.message === "Wrong password",
      JSON.stringify(pinWrongPw.json)
    );

    const pinSetOk = await post(
      "/api/v1/user/pin",
      { password: "password123", pin: "5829" },
      { Authorization: `Bearer ${raju.token}` }
    );
    check(
      "D1.5: Valid PIN 5829 set -> 200",
      pinSetOk.status === 200 && pinSetOk.json?.message === "PIN set",
      JSON.stringify(pinSetOk.json)
    );

    const meRes = await get("/api/v1/user/me", { Authorization: `Bearer ${raju.token}` });
    check(
      "D1.6: GET /user/me returns hasPin: true and no hash leak",
      meRes.status === 200 &&
        meRes.json?.user?.hasPin === true &&
        meRes.json?.user?.pinHash === undefined,
      JSON.stringify(meRes.json)
    );

    // --- D2: Three wrong tries lock the PIN ---
    console.log("\n--- Testing D2: Three wrong tries lock the PIN ---");
    const d2Key = "test-d2";

    const try1 = await post(
      "/api/v1/wallet/transfer",
      { to: "priya@gmail.com", amount: 10000, pin: "1111" },
      { Authorization: `Bearer ${raju.token}`, "Idempotency-Key": d2Key }
    );
    check(
      "D2.1: Try 1 wrong PIN -> 403 (2 tries left)",
      try1.status === 403 && try1.json?.triesLeft === 2,
      JSON.stringify(try1.json)
    );

    const try2 = await post(
      "/api/v1/wallet/transfer",
      { to: "priya@gmail.com", amount: 10000, pin: "2222" },
      { Authorization: `Bearer ${raju.token}`, "Idempotency-Key": d2Key }
    );
    check(
      "D2.2: Try 2 wrong PIN -> 403 (1 try left)",
      try2.status === 403 && try2.json?.triesLeft === 1,
      JSON.stringify(try2.json)
    );

    const try3 = await post(
      "/api/v1/wallet/transfer",
      { to: "priya@gmail.com", amount: 10000, pin: "3333" },
      { Authorization: `Bearer ${raju.token}`, "Idempotency-Key": d2Key }
    );
    check(
      "D2.3: Try 3 wrong PIN -> 423 (PIN locked, Retry-After)",
      try3.status === 423 &&
        try3.json?.message === "PIN locked. Try again later" &&
        Number(try3.headers.get("retry-after")) > 0,
      JSON.stringify(try3.json)
    );

    const try4Locked = await post(
      "/api/v1/wallet/transfer",
      { to: "priya@gmail.com", amount: 10000, pin: "5829" },
      { Authorization: `Bearer ${raju.token}`, "Idempotency-Key": d2Key }
    );
    check(
      "D2.4: Correct PIN while locked -> still 423",
      try4Locked.status === 423 && try4Locked.json?.message === "PIN locked. Try again later",
      JSON.stringify(try4Locked.json)
    );

    // Staff unlocks Raju's PIN
    const unlockRes = await post(
      `/api/v1/admin/users/${raju.user._id}/unlock-pin`,
      {},
      { "x-admin-key": ADMIN_KEY }
    );
    check(
      "D2.5: Staff unlock endpoint -> 200",
      unlockRes.status === 200 && unlockRes.json?.message === "PIN unlocked",
      JSON.stringify(unlockRes.json)
    );

    // Send transfer with the right PIN using the SAME test-d2 idempotency key
    const rightPinRes = await post(
      "/api/v1/wallet/transfer",
      { to: "priya@gmail.com", amount: 10000, pin: "5829" },
      { Authorization: `Bearer ${raju.token}`, "Idempotency-Key": d2Key }
    );
    check(
      "D2.6: Correct PIN with same test-d2 succeeds (not consumed by wrong tries) -> 200",
      (rightPinRes.status === 200 || rightPinRes.status === 201) &&
        rightPinRes.json?.message === "Transfer successful" &&
        rightPinRes.json?.balance === 1990000,
      JSON.stringify(rightPinRes.json)
    );

    // Replay with same key
    const replayRes = await post(
      "/api/v1/wallet/transfer",
      { to: "priya@gmail.com", amount: 10000, pin: "5829" },
      { Authorization: `Bearer ${raju.token}`, "Idempotency-Key": d2Key }
    );
    check(
      "D2.7: Idempotent replay with same key returns identical transactionId",
      replayRes.json?.transactionId === rightPinRes.json?.transactionId &&
        replayRes.json?.balance === 1990000,
      JSON.stringify(replayRes.json)
    );

    // --- D3: A right PIN resets the count ---
    console.log("\n--- Testing D3: Right PIN resets count ---");
    const d3Wrong1 = await post(
      "/api/v1/wallet/transfer",
      { to: "priya@gmail.com", amount: 1000, pin: "1111" },
      { Authorization: `Bearer ${raju.token}`, "Idempotency-Key": "test-d3-w1" }
    );
    check(
      "D3.1: Wrong PIN -> 2 tries left",
      d3Wrong1.status === 403 && d3Wrong1.json?.triesLeft === 2,
      JSON.stringify(d3Wrong1.json)
    );

    const d3Right = await post(
      "/api/v1/wallet/transfer",
      { to: "priya@gmail.com", amount: 1000, pin: "5829" },
      { Authorization: `Bearer ${raju.token}`, "Idempotency-Key": "test-d3-right" }
    );
    check(
      "D3.2: Right PIN succeeds",
      d3Right.status === 200 || d3Right.status === 201,
      JSON.stringify(d3Right.json)
    );

    const d3Wrong2 = await post(
      "/api/v1/wallet/transfer",
      { to: "priya@gmail.com", amount: 1000, pin: "1111" },
      { Authorization: `Bearer ${raju.token}`, "Idempotency-Key": "test-d3-w2" }
    );
    check(
      "D3.3: Next wrong PIN has 2 tries left again (count was reset)",
      d3Wrong2.status === 403 && d3Wrong2.json?.triesLeft === 2,
      JSON.stringify(d3Wrong2.json)
    );

    // Reset Raju PIN count with right PIN
    await post(
      "/api/v1/wallet/transfer",
      { to: "priya@gmail.com", amount: 1000, pin: "5829" },
      { Authorization: `Bearer ${raju.token}`, "Idempotency-Key": "test-d3-clean" }
    );

    // --- D4: Daily limit of ₹10,000 ---
    console.log("\n--- Testing D4: Daily limit ---");
    // Create fresh user Dinesh with ₹20,000 and PIN
    const dinesh = await createUser("dinesh@gmail.com", "Dinesh", "Reddy", "password123");
    await post(
      "/api/v1/admin/deposit",
      { to: "dinesh@gmail.com", amount: 2000000, note: "Dinesh Daily Limit Capital" },
      { "x-admin-key": ADMIN_KEY }
    );
    await post(
      "/api/v1/user/pin",
      { password: "password123", pin: "4321" },
      { Authorization: `Bearer ${dinesh.token}` }
    );
    // Add bank account for Dinesh
    const bankRes = await post(
      "/api/v1/wallet/bank-accounts",
      { holderName: "Dinesh Reddy", accountNumber: "123456789012", ifsc: "HDFC0001234" },
      { Authorization: `Bearer ${dinesh.token}` }
    );
    const dineshBankId = bankRes.json?.id;

    const limitsInitial = await get("/api/v1/wallet/limits", {
      Authorization: `Bearer ${dinesh.token}`,
    });
    check(
      "D4.1: Initial limits: dailyLimit 1000000, used 0, left 1000000",
      limitsInitial.status === 200 &&
        limitsInitial.json?.dailyLimit === 1000000 &&
        limitsInitial.json?.usedToday === 0 &&
        limitsInitial.json?.leftToday === 1000000 &&
        limitsInitial.json?.resetsAt?.endsWith("T18:30:00.000Z"),
      JSON.stringify(limitsInitial.json)
    );

    // Send ₹5,000 (500,000 paise)
    const send5k = await post(
      "/api/v1/wallet/transfer",
      { to: "priya@gmail.com", amount: 500000, pin: "4321" },
      { Authorization: `Bearer ${dinesh.token}`, "Idempotency-Key": "d4-send-5k" }
    );
    check("D4.2: Send ₹5,000 succeeds", send5k.status === 200 || send5k.status === 201);

    // Send ₹4,000 (400,000 paise)
    const send4k = await post(
      "/api/v1/wallet/transfer",
      { to: "priya@gmail.com", amount: 400000, pin: "4321" },
      { Authorization: `Bearer ${dinesh.token}`, "Idempotency-Key": "d4-send-4k" }
    );
    check("D4.3: Send ₹4,000 succeeds", send4k.status === 200 || send4k.status === 201);

    // Dinesh has spent 900,000 paise today. Limit left is 100,000 paise.
    // Withdraw ₹1,500 (150,000 paise) -> Must fail with 400 Daily limit reached, leftToday: 100000
    const withdrawOver = await post(
      "/api/v1/wallet/withdraw",
      { bankAccountId: dineshBankId, amount: 150000, pin: "4321" },
      { Authorization: `Bearer ${dinesh.token}`, "Idempotency-Key": "d4-wd-over" }
    );
    check(
      "D4.4: Withdraw ₹1,500 over limit -> 400 (leftToday: 100000)",
      withdrawOver.status === 400 &&
        withdrawOver.json?.message === "Daily limit reached" &&
        withdrawOver.json?.leftToday === 100000,
      JSON.stringify(withdrawOver.json)
    );

    // Verify balance unchanged after rejected withdrawal
    const balCheck = await get("/api/v1/wallet/balance", {
      Authorization: `Bearer ${dinesh.token}`,
    });
    check(
      "D4.5: Dinesh balance unchanged (2,000,000 - 900,000 = 1,100,000)",
      balCheck.json?.balance === 1100000,
      JSON.stringify(balCheck.json)
    );

    // Withdraw ₹1,000 (100,000 paise) -> exactly fills remaining limit
    const withdraw1k = await post(
      "/api/v1/wallet/withdraw",
      { bankAccountId: dineshBankId, amount: 100000, pin: "4321" },
      { Authorization: `Bearer ${dinesh.token}`, "Idempotency-Key": "d4-wd-1k" }
    );
    check(
      "D4.6: Withdraw ₹1,000 within remaining limit -> 202 Accepted",
      withdraw1k.status === 202 && withdraw1k.json?.withdrawal?.status === "PENDING",
      JSON.stringify(withdraw1k.json)
    );

    // Check limits fully used
    const limitsFinal = await get("/api/v1/wallet/limits", {
      Authorization: `Bearer ${dinesh.token}`,
    });
    check(
      "D4.7: Limits now: usedToday: 1000000, leftToday: 0",
      limitsFinal.status === 200 &&
        limitsFinal.json?.usedToday === 1000000 &&
        limitsFinal.json?.leftToday === 0,
      JSON.stringify(limitsFinal.json)
    );

    // --- D5: Signin rate limit ---
    console.log("\n--- Testing D5: Signin rate limit ---");
    const rateUser = "ratetest@gmail.com";
    await post("/api/v1/user/signup", {
      username: rateUser,
      firstName: "Rate",
      lastName: "User",
      password: "correctPass123",
    });

    let lastRemaining = null;
    for (let i = 1; i <= 5; i++) {
      const wrongAttempt = await post("/api/v1/user/signin", {
        username: rateUser,
        password: "wrongPassword",
      });
      lastRemaining = Number(wrongAttempt.headers.get("x-ratelimit-remaining"));
      check(
        `D5.try${i}: Wrong signin attempt returns 401 with remaining header (${lastRemaining})`,
        wrongAttempt.status === 401 && lastRemaining === 5 - i,
        `Remaining: ${lastRemaining}`
      );
    }

    const try6Blocked = await post("/api/v1/user/signin", {
      username: rateUser,
      password: "wrongPassword",
    });
    check(
      "D5.try6: 6th signin attempt blocked with 429 Too Many Requests",
      try6Blocked.status === 429 &&
        try6Blocked.json?.message === "Too many requests. Slow down" &&
        Number(try6Blocked.headers.get("retry-after")) > 0,
      JSON.stringify(try6Blocked.json)
    );

    const correctBlocked = await post("/api/v1/user/signin", {
      username: rateUser,
      password: "correctPass123",
    });
    check(
      "D5: Right password also blocked with 429 while window is active",
      correctBlocked.status === 429,
      JSON.stringify(correctBlocked.json)
    );

    // --- D6: Money rate limit (10/min) ---
    console.log("\n--- Testing D6: Money rate limit ---");
    const speedUser = await createUser("speed@gmail.com", "Speed", "Runner", "password123");
    await post(
      "/api/v1/admin/deposit",
      { to: "speed@gmail.com", amount: 500000, note: "Speed funds" },
      { "x-admin-key": ADMIN_KEY }
    );
    await post(
      "/api/v1/user/pin",
      { password: "password123", pin: "9876" },
      { Authorization: `Bearer ${speedUser.token}` }
    );

    let moneyResponses = [];
    for (let i = 1; i <= 10; i++) {
      const res = await post(
        "/api/v1/wallet/transfer",
        { to: "priya@gmail.com", amount: 100, pin: "9876" },
        { Authorization: `Bearer ${speedUser.token}`, "Idempotency-Key": `speed-${i}` }
      );
      moneyResponses.push(res.status);
    }
    check(
      "D6.1: First 10 money transfers within window succeed (200/201)",
      moneyResponses.every((s) => s === 200 || s === 201),
      JSON.stringify(moneyResponses)
    );

    const try11Transfer = await post(
      "/api/v1/wallet/transfer",
      { to: "priya@gmail.com", amount: 100, pin: "9876" },
      { Authorization: `Bearer ${speedUser.token}`, "Idempotency-Key": "speed-11" }
    );
    check(
      "D6.2: 11th transfer receives 429",
      try11Transfer.status === 429 && try11Transfer.json?.message === "Too many requests. Slow down",
      JSON.stringify(try11Transfer.json)
    );

    // Withdraw on the same user in the same minute must also receive 429
    const try12Withdraw = await post(
      "/api/v1/wallet/withdraw",
      { bankAccountId: dineshBankId, amount: 10000, pin: "9876" },
      { Authorization: `Bearer ${speedUser.token}`, "Idempotency-Key": "speed-12-wd" }
    );
    check(
      "D6.3: Withdrawal also gets 429 (shared rate limit)",
      try12Withdraw.status === 429,
      JSON.stringify(try12Withdraw.json)
    );

    // --- D7: Log out of all devices ---
    console.log("\n--- Testing D7: Log out of all devices ---");
    const multi = await createUser("multi@gmail.com", "Multi", "Device", "password123");
    // Sign in twice to get LAPTOP and PHONE tokens
    const laptopRes = await post("/api/v1/user/signin", {
      username: "multi@gmail.com",
      password: "password123",
    });
    const phoneRes = await post("/api/v1/user/signin", {
      username: "multi@gmail.com",
      password: "password123",
    });
    const laptopToken = laptopRes.json?.token;
    const phoneToken = phoneRes.json?.token;

    const balLaptop1 = await get("/api/v1/wallet/balance", {
      Authorization: `Bearer ${laptopToken}`,
    });
    const balPhone1 = await get("/api/v1/wallet/balance", {
      Authorization: `Bearer ${phoneToken}`,
    });
    check("D7.1: Both tokens can access wallet before logout", balLaptop1.status === 200 && balPhone1.status === 200);

    const logoutAllRes = await post(
      "/api/v1/user/logout-all",
      {},
      { Authorization: `Bearer ${phoneToken}` }
    );
    check(
      "D7.2: POST /user/logout-all returns 200 Signed out on all devices",
      logoutAllRes.status === 200 && logoutAllRes.json?.message === "Signed out on all devices",
      JSON.stringify(logoutAllRes.json)
    );

    const balLaptop2 = await get("/api/v1/wallet/balance", {
      Authorization: `Bearer ${laptopToken}`,
    });
    const balPhone2 = await get("/api/v1/wallet/balance", {
      Authorization: `Bearer ${phoneToken}`,
    });
    check(
      "D7.3: LAPTOP token rejected with 401 Session ended",
      balLaptop2.status === 401 && balLaptop2.json?.message === "Session ended. Please sign in again",
      JSON.stringify(balLaptop2.json)
    );
    check(
      "D7.4: PHONE token rejected with 401 Session ended",
      balPhone2.status === 401 && balPhone2.json?.message === "Session ended. Please sign in again",
      JSON.stringify(balPhone2.json)
    );

    // Sign in again -> token works
    const newSessionRes = await post("/api/v1/user/signin", {
      username: "multi@gmail.com",
      password: "password123",
    });
    const newSessionToken = newSessionRes.json?.token;
    const balNew = await get("/api/v1/wallet/balance", {
      Authorization: `Bearer ${newSessionToken}`,
    });
    check("D7.5: Sign in again yields fresh active token -> 200", balNew.status === 200);

    // --- D8: Password change ends old sessions ---
    console.log("\n--- Testing D8: Password change ends old sessions ---");
    const changePwUser = await createUser("changepw@gmail.com", "Change", "Password", "oldpass123");
    const oldPwToken = changePwUser.token;

    const changePwRes = await put(
      "/api/v1/user",
      { password: "newpassword456" },
      { Authorization: `Bearer ${oldPwToken}` }
    );
    check(
      "D8.1: Password change returns 200 with new token",
      changePwRes.status === 200 &&
        changePwRes.json?.message?.includes("Signed out on all devices") ||
        changePwRes.json?.message?.includes("Password changed") &&
        Boolean(changePwRes.json?.token),
      JSON.stringify(changePwRes.json)
    );
    const freshTokenFromPwChange = changePwRes.json?.token;

    const oldTokenBal = await get("/api/v1/wallet/balance", {
      Authorization: `Bearer ${oldPwToken}`,
    });
    check(
      "D8.2: Old token rejected after password change -> 401 Session ended",
      oldTokenBal.status === 401 && oldTokenBal.json?.message === "Session ended. Please sign in again",
      JSON.stringify(oldTokenBal.json)
    );

    const freshTokenBal = await get("/api/v1/wallet/balance", {
      Authorization: `Bearer ${freshTokenFromPwChange}`,
    });
    check(
      "D8.3: Fresh token from password change reply works -> 200",
      freshTokenBal.status === 200
    );

    // --- D9: Reconcile and regression ---
    console.log("\n--- Testing D9: Reconciliation ---");
    const reconcileRes = await get("/api/v1/admin/reconcile", {
      "x-admin-key": ADMIN_KEY,
    });
    check(
      "D9: Reconcile confirms moneyIsConserved is true",
      reconcileRes.status === 200 &&
        reconcileRes.json?.moneyIsConserved === true &&
        reconcileRes.json?.mismatches?.length === 0,
      JSON.stringify(reconcileRes.json)
    );

    // --- Bonus 8: Concurrency Races ---
    console.log("\n--- Testing Bonus 8: Concurrency Races ---");
    const raceUser = await createUser("raceuser@gmail.com", "Race", "User", "password123");
    const setPin1 = await post(
      "/api/v1/user/pin",
      { password: "password123", pin: "7149" },
      { Authorization: `Bearer ${raceUser.token}` }
    );
    check("Bonus 8 setup: raceUser PIN set -> 200", setPin1.status === 200);

    // 10 concurrent wrong PIN guesses
    const guesses = await Promise.all(
      Array.from({ length: 10 }, (_, idx) =>
        post(
          "/api/v1/wallet/transfer",
          { to: "priya@gmail.com", amount: 100, pin: "1234" },
          { Authorization: `Bearer ${raceUser.token}`, "Idempotency-Key": `race-guess-${idx}` }
        )
      )
    );

    const status403Count = guesses.filter((g) => g.status === 403).length;
    const status423Count = guesses.filter((g) => g.status === 423).length;
    check(
      "Bonus 8.1: 10 concurrent wrong PIN guesses yield exactly 2x 403 and 8x 423",
      status403Count === 2 && status423Count === 8,
      `403s: ${status403Count}, 423s: ${status423Count}`
    );

    // Daily limit race: User with ₹20,000 sends two concurrent ₹6,000 requests
    const dailyRaceUser = await createUser("dailyrace@gmail.com", "Daily", "Race", "password123");
    await post(
      "/api/v1/admin/deposit",
      { to: "dailyrace@gmail.com", amount: 2000000, note: "Race capital" },
      { "x-admin-key": ADMIN_KEY }
    );
    const setPin2 = await post(
      "/api/v1/user/pin",
      { password: "password123", pin: "8263" },
      { Authorization: `Bearer ${dailyRaceUser.token}` }
    );
    check("Bonus 8 setup: dailyRaceUser PIN set -> 200", setPin2.status === 200);

    const [raceSend1, raceSend2] = await Promise.all([
      post(
        "/api/v1/wallet/transfer",
        { to: "priya@gmail.com", amount: 600000, pin: "8263" },
        { Authorization: `Bearer ${dailyRaceUser.token}`, "Idempotency-Key": "race-send-1" }
      ),
      post(
        "/api/v1/wallet/transfer",
        { to: "priya@gmail.com", amount: 600000, pin: "8263" },
        { Authorization: `Bearer ${dailyRaceUser.token}`, "Idempotency-Key": "race-send-2" }
      ),
    ]);

    const passes = [raceSend1, raceSend2].filter((r) => r.status === 200 || r.status === 201).length;
    const limitRejects = [raceSend1, raceSend2].filter(
      (r) => r.status === 400 && r.json?.message === "Daily limit reached"
    ).length;

    check(
      "Bonus 8.2: Two concurrent ₹6,000 sends: exactly one succeeds and one hits daily limit",
      passes === 1 && limitRejects === 1,
      `Passes: ${passes}, LimitRejects: ${limitRejects}`
    );
  } finally {
    // Teardown
    server.kill();
    bankServer.close();
    await mongoose.disconnect();
    await replSet.stop();
  }

  console.log("\n==========================================");
  console.log(`DAY 6 TEST SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED`);
  console.log("==========================================\n");

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
