// test/phase4_pay_request.test.js — Acceptance test for Level 3 & Level 4 (D3 & D4) Pay a Request.
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import mongoose from "mongoose";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3121;
const BASE = `http://localhost:${PORT}`;
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

async function main() {
  console.log("=== Starting Phase 4 / Level 3 & Level 4 Acceptance Tests (Pay a Request) ===");

  // 1. Start in-memory replica set
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await replSet.waitUntilRunning();
  const mongoUri = replSet.getUri("kaasupay");

  // 2. Spawn backend server
  const serverEnv = {
    PORT: String(PORT),
    MONGO_URL: mongoUri,
    ADMIN_KEY,
    JWT_SECRET: "test_secret_for_phase4_testing_32bytes_ok",
    REQUEST_EXPIRY_DAYS: "7",
    NODE_ENV: "development",
  };
  const server = spawnServer(serverEnv);

  const healthy = await waitForHealth();
  if (!healthy) {
    console.error("Server failed to start:\n", server.getOutput());
    process.exit(1);
  }
  console.log("Backend server started and healthy.");

  await mongoose.connect(mongoUri);

  try {
    async function post(url, body, token, customHeaders = {}) {
      const headers = { "Content-Type": "application/json", ...customHeaders };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${BASE}${url}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, json, headers: res.headers };
    }

    async function get(url, token, customHeaders = {}) {
      const headers = { ...customHeaders };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${BASE}${url}`, { headers });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    }

    // 1. Create fresh test users: Priya, Raju, Kavi
    const priyaRes = await post("/api/v1/user/signup", {
      username: "priya_p4@gmail.com",
      password: "secret123",
      firstName: "Priya",
      lastName: "S",
    });
    check("Priya signup -> 201", priyaRes.status === 201, JSON.stringify(priyaRes.json));
    const priyaSignin = await post("/api/v1/user/signin", { username: "priya_p4@gmail.com", password: "secret123" });
    const priyaToken = priyaSignin.json?.token;

    const rajuRes = await post("/api/v1/user/signup", {
      username: "raju_p4@gmail.com",
      password: "secret123",
      firstName: "Raju",
      lastName: "K",
    });
    check("Raju signup -> 201", rajuRes.status === 201, JSON.stringify(rajuRes.json));
    const rajuId = rajuRes.json?.user?._id;
    const rajuSignin = await post("/api/v1/user/signin", { username: "raju_p4@gmail.com", password: "secret123" });
    const rajuToken = rajuSignin.json?.token;

    const kaviRes = await post("/api/v1/user/signup", {
      username: "kavi_p4@gmail.com",
      password: "secret123",
      firstName: "Kavi",
      lastName: "M",
    });
    check("Kavi signup -> 201", kaviRes.status === 201, JSON.stringify(kaviRes.json));
    const kaviSignin = await post("/api/v1/user/signin", { username: "kavi_p4@gmail.com", password: "secret123" });
    const kaviToken = kaviSignin.json?.token;

    // 2. Fund Raju with ₹5,000 (500000 paise) via staff deposit
    const depositRes = await post(
      "/api/v1/admin/deposit",
      { to: "raju_p4@gmail.com", amount: 500000, note: "Initial test funding" },
      null,
      { "x-admin-key": ADMIN_KEY }
    );
    check("Admin deposit ₹5,000 to Raju -> 201", depositRes.status === 201, JSON.stringify(depositRes.json));

    // 3. Set Raju's PIN to 5829
    const pinRes = await post(
      "/api/v1/user/pin",
      { password: "secret123", pin: "5829" },
      rajuToken
    );
    check("Set Raju PIN to 5829 -> 200", pinRes.status === 200, JSON.stringify(pinRes.json));

    // --- D3: Pay a request ---
    console.log("\n--- Testing D3: Pay a request ---");

    // Priya sends D1 request to Raju for ₹500 (50000 paise)
    const req1Res = await post(
      "/api/v1/requests",
      { to: rajuId, amount: 50000, note: "Dinner at Murugan Idli" },
      priyaToken
    );
    check("Priya creates request R1 -> 201", req1Res.status === 201, JSON.stringify(req1Res.json));
    const req1Id = req1Res.json?.request?.id;

    // Priya tries to pay her own request -> 403
    const priyaPaySelf = await post(
      `/api/v1/requests/${req1Id}/pay`,
      { pin: "1234" },
      priyaToken,
      { "Idempotency-Key": "pay-priya-self" }
    );
    check("Priya tries to pay own request -> 403", priyaPaySelf.status === 403, JSON.stringify(priyaPaySelf.json));
    check(
      "Priya self-pay error message matches",
      priyaPaySelf.json?.message === "Only the person asked can pay this request"
    );

    // Raju pays with wrong PIN -> 403 {"message":"Wrong PIN. 2 tries left","triesLeft":2}
    const wrongPinRes = await post(
      `/api/v1/requests/${req1Id}/pay`,
      { pin: "9999" },
      rajuToken,
      { "Idempotency-Key": "pay-d3" }
    );
    check("Raju wrong PIN -> 403", wrongPinRes.status === 403, JSON.stringify(wrongPinRes.json));
    check(
      "Wrong PIN message matches spec",
      wrongPinRes.json?.message === "Wrong PIN. 2 tries left"
    );
    check("Wrong PIN triesLeft === 2", wrongPinRes.json?.triesLeft === 2);

    // Raju pays with correct PIN and Idempotency-Key: pay-d3
    const payRes = await post(
      `/api/v1/requests/${req1Id}/pay`,
      { pin: "5829" },
      rajuToken,
      { "Idempotency-Key": "pay-d3" }
    );
    check("Raju pays D1 request -> 200", payRes.status === 200, JSON.stringify(payRes.json));
    check("Payment message is 'Request paid'", payRes.json?.message === "Request paid");
    check("Payment returns valid transactionId", Boolean(payRes.json?.transactionId));
    check("Payment returns payer balance 450000", payRes.json?.balance === 450000);
    const txnId = payRes.json?.transactionId;

    // Same call, same key -> 200 (replayed, no second payment)
    const replayRes = await post(
      `/api/v1/requests/${req1Id}/pay`,
      { pin: "5829" },
      rajuToken,
      { "Idempotency-Key": "pay-d3" }
    );
    check("Same call, same key -> 200 cached replay", replayRes.status === 200, JSON.stringify(replayRes.json));
    check("Replayed transactionId matches", replayRes.json?.transactionId === txnId);
    check("Replayed balance is 450000", replayRes.json?.balance === 450000);

    // Same call, NEW key -> 409 {"message":"This request is already PAID"}
    const newKeyRes = await post(
      `/api/v1/requests/${req1Id}/pay`,
      { pin: "5829" },
      rajuToken,
      { "Idempotency-Key": "pay-d3-new" }
    );
    check("Same call, NEW key -> 409", newKeyRes.status === 409, JSON.stringify(newKeyRes.json));
    check(
      "Already PAID message matches spec",
      newKeyRes.json?.message === "This request is already PAID"
    );

    // Raju's balance: 200 {"balance":450000}
    const rajuBal = await get("/api/v1/wallet/balance", rajuToken);
    check("Raju's balance is 450000", rajuBal.json?.balance === 450000, JSON.stringify(rajuBal.json));

    // Priya's balance: 200 {"balance":50000}
    const priyaBal = await get("/api/v1/wallet/balance", priyaToken);
    check("Priya's balance is 50000", priyaBal.json?.balance === 50000, JSON.stringify(priyaBal.json));

    // Priya: GET /requests/outgoing status is now "PAID"
    const priyaOut = await get("/api/v1/requests/outgoing", priyaToken);
    check("Priya outgoing request status is PAID", priyaOut.json?.requests?.[0]?.status === "PAID");

    // Check Raju's history (Day 3). The payment shows as Sent with note "Request: Dinner at Murugan Idli"
    const rajuHistory = await get("/api/v1/wallet/transactions", rajuToken);
    const paidTxn = rajuHistory.json?.transactions?.find((t) => String(t.transactionId) === String(txnId));
    check("Transaction exists in Raju's history", Boolean(paidTxn), JSON.stringify(rajuHistory.json));
    check(
      "Transaction note is 'Request: Dinner at Murugan Idli'",
      paidTxn?.note === "Request: Dinner at Murugan Idli",
      `note=${paidTxn?.note}`
    );

    // --- D4: Payment fails, request stays open ---
    console.log("\n--- Testing D4: Payment fails, request stays open ---");

    // Priya requests ₹9,000 (900000 paise) from Raju, who now has ₹4,500
    const req2Res = await post(
      "/api/v1/requests",
      { to: rajuId, amount: 900000, note: "Laptop share" },
      priyaToken
    );
    check("Priya requests ₹9,000 -> 201", req2Res.status === 201, JSON.stringify(req2Res.json));
    const req2Id = req2Res.json?.request?.id;

    // Raju pays -> 400 {"message":"Insufficient balance"}
    const insufPay = await post(
      `/api/v1/requests/${req2Id}/pay`,
      { pin: "5829" },
      rajuToken,
      { "Idempotency-Key": "pay-d4-insuf" }
    );
    check("Raju pays ₹9,000 with ₹4,500 balance -> 400", insufPay.status === 400, JSON.stringify(insufPay.json));
    check("Error message is 'Insufficient balance'", insufPay.json?.message === "Insufficient balance");

    // Raju: GET /requests/:id status is still "PENDING"
    const req2Check = await get(`/api/v1/requests/${req2Id}`, rajuToken);
    check("Request status is still PENDING after failed payment", req2Check.json?.request?.status === "PENDING");

    // Raju's balance is still 450000
    const rajuBal2 = await get("/api/v1/wallet/balance", rajuToken);
    check("Raju's balance is still 450000", rajuBal2.json?.balance === 450000);

    // Give Raju ₹10,000 more with staff deposit
    const deposit2 = await post(
      "/api/v1/admin/deposit",
      { to: "raju_p4@gmail.com", amount: 1000000, note: "Top-up funds" },
      null,
      { "x-admin-key": ADMIN_KEY }
    );
    check("Deposit ₹10,000 to Raju -> 201", deposit2.status === 201);

    // Raju now has ₹14,500. He pays the ₹9,000 request again.
    // Total spent today will be ₹500 + ₹9,000 = ₹9,500 <= ₹10,000 daily limit.
    const pay2Res = await post(
      `/api/v1/requests/${req2Id}/pay`,
      { pin: "5829" },
      rajuToken,
      { "Idempotency-Key": "pay-d4-success" }
    );
    check("Raju pays ₹9,000 request after top-up -> 200", pay2Res.status === 200, JSON.stringify(pay2Res.json));
    check("Payment successful message matches", pay2Res.json?.message === "Request paid");
    check("Raju balance is 550000 (1450000 - 900000)", pay2Res.json?.balance === 550000);

    // Make one more ₹1,000 (100000 paise) request and try to pay it
    const req3Res = await post(
      "/api/v1/requests",
      { to: rajuId, amount: 100000, note: "Grocery split" },
      priyaToken
    );
    check("Priya requests ₹1,000 -> 201", req3Res.status === 201);
    const req3Id = req3Res.json?.request?.id;

    // Raju tries to pay ₹1,000. Spent today so far: ₹9,500. ₹9,500 + ₹1,000 = ₹10,500 > ₹10,000.
    // Expected: 400 "Daily limit reached"
    const limitPay = await post(
      `/api/v1/requests/${req3Id}/pay`,
      { pin: "5829" },
      rajuToken,
      { "Idempotency-Key": "pay-d4-limit" }
    );
    check("Payment exceeding daily limit -> 400", limitPay.status === 400, JSON.stringify(limitPay.json));
    check(
      "Limit error message contains 'Daily limit reached'",
      limitPay.json?.message?.includes("Daily limit reached")
    );
    check("leftToday is 50000 (₹500 left of ₹10,000 limit)", limitPay.json?.leftToday === 50000);

    // Verify request stays PENDING
    const req3Check = await get(`/api/v1/requests/${req3Id}`, rajuToken);
    check("Request exceeding limit stays PENDING", req3Check.json?.request?.status === "PENDING");

    // Reconcile check: GET /api/v1/admin/reconcile must report moneyIsConserved: true
    const reconcileRes = await get("/api/v1/admin/reconcile", null, { "x-admin-key": ADMIN_KEY });
    check("Admin reconcile -> 200", reconcileRes.status === 200, JSON.stringify(reconcileRes.json));
    check("moneyIsConserved === true", reconcileRes.json?.moneyIsConserved === true);
    check("mismatches is empty", reconcileRes.json?.mismatches?.length === 0);

  } finally {
    server.kill("SIGTERM");
    await mongoose.disconnect();
    await replSet.stop();
  }

  console.log(`\n==========================================`);
  console.log(`PHASE 4 / LEVEL 3 & 4 TEST SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED`);
  console.log(`==========================================`);

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner threw uncaught error:", err);
  process.exit(1);
});
