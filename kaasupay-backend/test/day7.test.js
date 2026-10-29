// test/day7.test.js — Canonical Day 7 Unified Acceptance Test Suite (D1 through D6, Concurrency & Reconciliation).
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import mongoose from "mongoose";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3123;
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
  console.log("===============================================================================");
  console.log("=== KAASUPAY DAY 7: REQUEST MONEY — CANONICAL ACCEPTANCE SUITE (D1 to D6) ===");
  console.log("===============================================================================");

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
    JWT_SECRET: "test_secret_for_day7_testing_32bytes_ok",
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

    // -------------------------------------------------------------------------
    // Setup: Create Priya, Raju, Kavi. Fund Raju with ₹5,000, set PIN to 5829.
    // -------------------------------------------------------------------------
    console.log("\n--- Setup: Seed Users, Balance & Payment PIN ---");
    const priyaSignup = await post("/api/v1/user/signup", {
      username: "priya_day7@gmail.com",
      password: "secret123",
      firstName: "Priya",
      lastName: "S",
    });
    check("Priya signup -> 201", priyaSignup.status === 201);
    const priyaId = priyaSignup.json?.user?._id;
    const priyaToken = (await post("/api/v1/user/signin", { username: "priya_day7@gmail.com", password: "secret123" })).json?.token;

    const rajuSignup = await post("/api/v1/user/signup", {
      username: "raju_day7@gmail.com",
      password: "secret123",
      firstName: "Raju",
      lastName: "K",
    });
    check("Raju signup -> 201", rajuSignup.status === 201);
    const rajuId = rajuSignup.json?.user?._id;
    const rajuToken = (await post("/api/v1/user/signin", { username: "raju_day7@gmail.com", password: "secret123" })).json?.token;

    const kaviSignup = await post("/api/v1/user/signup", {
      username: "kavi_day7@gmail.com",
      password: "secret123",
      firstName: "Kavi",
      lastName: "M",
    });
    check("Kavi signup -> 201", kaviSignup.status === 201);
    const kaviId = kaviSignup.json?.user?._id;
    const kaviToken = (await post("/api/v1/user/signin", { username: "kavi_day7@gmail.com", password: "secret123" })).json?.token;

    // Staff deposit ₹5,000 to Raju
    const initDeposit = await post(
      "/api/v1/admin/deposit",
      { to: "raju_day7@gmail.com", amount: 500000, note: "Initial Day 7 test balance" },
      null,
      { "x-admin-key": ADMIN_KEY }
    );
    check("Staff deposit ₹5,000 to Raju -> 201", initDeposit.status === 201);

    // Set Raju's PIN to 5829
    const pinRes = await post("/api/v1/user/pin", { password: "secret123", pin: "5829" }, rajuToken);
    check("Set Raju PIN to 5829 -> 200", pinRes.status === 200);

    // -------------------------------------------------------------------------
    // D1. Send a request and see it
    // -------------------------------------------------------------------------
    console.log("\n--- D1: Send a request and see it ---");
    const d1Req = await post(
      "/api/v1/requests",
      { to: rajuId, amount: 50000, note: "Dinner at Murugan Idli" },
      priyaToken
    );
    check("Priya sends D1 request to Raju -> 201", d1Req.status === 201);
    check("D1 response message is 'Request sent'", d1Req.json?.message === "Request sent");
    check("D1 recipient is 'Raju K'", d1Req.json?.request?.to === "Raju K");
    check("D1 amount is 50000", d1Req.json?.request?.amount === 50000);
    check("D1 status is 'PENDING'", d1Req.json?.request?.status === "PENDING");
    const d1Id = d1Req.json?.request?.id;

    // Raju: GET /requests/incoming
    const rajuInc = await get("/api/v1/requests/incoming", rajuToken);
    check("Raju: GET /requests/incoming -> 200", rajuInc.status === 200);
    const incR1 = rajuInc.json?.requests?.find((r) => r.id === d1Id);
    check("Incoming shows from 'Priya S'", incR1?.from === "Priya S");
    check("Incoming shows amount 50000", incR1?.amount === 50000);
    check("Incoming shows status PENDING", incR1?.status === "PENDING");

    // Priya: GET /requests/outgoing
    const priyaOut = await get("/api/v1/requests/outgoing", priyaToken);
    check("Priya: GET /requests/outgoing -> 200", priyaOut.status === 200);
    const outR1 = priyaOut.json?.requests?.find((r) => r.id === d1Id);
    check("Outgoing shows to 'Raju K'", outR1?.to === "Raju K");
    check("Outgoing shows amount 50000", outR1?.amount === 50000);

    // Kavi (stranger): GET /requests/:id -> 404
    const kaviGetD1 = await get(`/api/v1/requests/${d1Id}`, kaviToken);
    check("Kavi (stranger): GET /requests/:id -> 404", kaviGetD1.status === 404);
    check("Stranger isolation returns 'Request not found'", kaviGetD1.json?.message === "Request not found");

    // Priya: request from herself -> 400
    const selfReq = await post("/api/v1/requests", { to: priyaId, amount: 50000 }, priyaToken);
    check("Priya request from herself -> 400", selfReq.status === 400);
    check("Self request error matches", selfReq.json?.message === "You can't request money from yourself");

    // amount 50 (under ₹1) -> 400
    const underMin = await post("/api/v1/requests", { to: rajuId, amount: 50 }, priyaToken);
    check("amount 50 (under ₹1) -> 400", underMin.status === 400);
    check("Under min error mentions 'Invalid inputs'", underMin.json?.message === "Invalid inputs");

    // -------------------------------------------------------------------------
    // D2. Decline and cancel
    // -------------------------------------------------------------------------
    console.log("\n--- D2: Decline and cancel ---");
    const r2Res = await post("/api/v1/requests", { to: rajuId, amount: 20000, note: "R2 request" }, priyaToken);
    const r3Res = await post("/api/v1/requests", { to: rajuId, amount: 30000, note: "R3 request" }, priyaToken);
    const r2Id = r2Res.json?.request?.id;
    const r3Id = r3Res.json?.request?.id;

    // Raju declines R2 -> 200
    const declineR2 = await post(`/api/v1/requests/${r2Id}/decline`, {}, rajuToken);
    check("Raju declines R2 -> 200", declineR2.status === 200);
    check("Decline message is 'Request declined'", declineR2.json?.message === "Request declined");

    // Raju declines R2 again -> 409
    const declineR2Again = await post(`/api/v1/requests/${r2Id}/decline`, {}, rajuToken);
    check("Raju declines R2 again -> 409", declineR2Again.status === 409);
    check("Duplicate decline says 'already DECLINED'", declineR2Again.json?.message === "This request is already DECLINED");

    // Priya tries to decline R3 -> 403
    const priyaDeclineR3 = await post(`/api/v1/requests/${r3Id}/decline`, {}, priyaToken);
    check("Priya tries to decline R3 -> 403", priyaDeclineR3.status === 403);
    check("Decline by requester error matches", priyaDeclineR3.json?.message === "Only the person asked can decline this request");

    // Priya cancels R3 -> 200
    const cancelR3 = await post(`/api/v1/requests/${r3Id}/cancel`, {}, priyaToken);
    check("Priya cancels R3 -> 200", cancelR3.status === 200);
    check("Cancel message is 'Request cancelled'", cancelR3.json?.message === "Request cancelled");

    // Raju tries to pay R3 -> 409
    const payCancelled = await post(
      `/api/v1/requests/${r3Id}/pay`,
      { pin: "5829" },
      rajuToken,
      { "Idempotency-Key": "pay-cancelled-r3" }
    );
    check("Raju tries to pay R3 -> 409", payCancelled.status === 409);
    check("Pay cancelled request error matches", payCancelled.json?.message === "This request is already CANCELLED");

    // Kavi tries to cancel R3 -> 404
    const kaviCancel = await post(`/api/v1/requests/${r3Id}/cancel`, {}, kaviToken);
    check("Kavi tries to cancel R3 -> 404", kaviCancel.status === 404);
    check("Stranger cancel returns 'Request not found'", kaviCancel.json?.message === "Request not found");

    // -------------------------------------------------------------------------
    // D3. Pay a request
    // -------------------------------------------------------------------------
    console.log("\n--- D3: Pay a request ---");
    // Priya tries to pay her own request -> 403
    const priyaPaySelf = await post(
      `/api/v1/requests/${d1Id}/pay`,
      { pin: "1234" },
      priyaToken,
      { "Idempotency-Key": "pay-priya-d1" }
    );
    check("Priya tries to pay own request -> 403", priyaPaySelf.status === 403);
    check("Self pay message matches", priyaPaySelf.json?.message === "Only the person asked can pay this request");

    // Wrong PIN -> 403
    const wrongPin = await post(
      `/api/v1/requests/${d1Id}/pay`,
      { pin: "9999" },
      rajuToken,
      { "Idempotency-Key": "pay-d3" }
    );
    check("Wrong PIN -> 403", wrongPin.status === 403);
    check("Wrong PIN message matches", wrongPin.json?.message === "Wrong PIN. 2 tries left");
    check("triesLeft is 2", wrongPin.json?.triesLeft === 2);

    // Raju pays the D1 request -> 200
    const payD1 = await post(
      `/api/v1/requests/${d1Id}/pay`,
      { pin: "5829" },
      rajuToken,
      { "Idempotency-Key": "pay-d3" }
    );
    check("Raju pays D1 request -> 200", payD1.status === 200);
    check("Pay response message is 'Request paid'", payD1.json?.message === "Request paid");
    check("Valid transactionId returned", Boolean(payD1.json?.transactionId));
    check("Payer balance is 450000", payD1.json?.balance === 450000);
    const d1TxnId = payD1.json?.transactionId;

    // Same call, same key -> 200 (replayed, no second payment)
    const replayD1 = await post(
      `/api/v1/requests/${d1Id}/pay`,
      { pin: "5829" },
      rajuToken,
      { "Idempotency-Key": "pay-d3" }
    );
    check("Same call, same key -> 200 cached replay", replayD1.status === 200);
    check("Replayed transactionId matches", replayD1.json?.transactionId === d1TxnId);
    check("Replayed balance is 450000", replayD1.json?.balance === 450000);

    // Same call, NEW key -> 409
    const newKeyD1 = await post(
      `/api/v1/requests/${d1Id}/pay`,
      { pin: "5829" },
      rajuToken,
      { "Idempotency-Key": "pay-d3-new-key" }
    );
    check("Same call, NEW key -> 409", newKeyD1.status === 409);
    check("Already PAID message matches", newKeyD1.json?.message === "This request is already PAID");

    // Balances
    const rajuBalD3 = (await get("/api/v1/wallet/balance", rajuToken)).json?.balance;
    const priyaBalD3 = (await get("/api/v1/wallet/balance", priyaToken)).json?.balance;
    check("Raju balance is 450000", rajuBalD3 === 450000);
    check("Priya balance is 50000", priyaBalD3 === 50000);

    // Priya: GET /requests/outgoing status is now "PAID"
    const priyaOutAfter = await get("/api/v1/requests/outgoing", priyaToken);
    const d1OutDoc = priyaOutAfter.json?.requests?.find((r) => r.id === d1Id);
    check("Priya outgoing request status is PAID", d1OutDoc?.status === "PAID");

    // History: payment shows note "Request: Dinner at Murugan Idli"
    const rajuHist = await get("/api/v1/wallet/transactions", rajuToken);
    const histTxn = rajuHist.json?.transactions?.find((t) => String(t.transactionId) === String(d1TxnId));
    check("Transaction found in Raju history", Boolean(histTxn));
    check("Transaction note matches", histTxn?.note === "Request: Dinner at Murugan Idli");

    // -------------------------------------------------------------------------
    // D4. Payment fails, request stays open
    // -------------------------------------------------------------------------
    console.log("\n--- D4: Payment fails, request stays open ---");
    // Priya requests ₹9,000 from Raju (who has ₹4,500)
    const reqD4 = await post("/api/v1/requests", { to: rajuId, amount: 900000, note: "Big split" }, priyaToken);
    const d4Id = reqD4.json?.request?.id;

    // Raju pays -> 400 {"message":"Insufficient balance"}
    const payFail = await post(
      `/api/v1/requests/${d4Id}/pay`,
      { pin: "5829" },
      rajuToken,
      { "Idempotency-Key": "pay-d4-fail" }
    );
    check("Raju pays ₹9,000 with ₹4,500 balance -> 400", payFail.status === 400);
    check("Error message is 'Insufficient balance'", payFail.json?.message === "Insufficient balance");

    // Raju: GET /requests/:id status is still "PENDING"
    const d4Inspect = await get(`/api/v1/requests/${d4Id}`, rajuToken);
    check("Request status is still PENDING", d4Inspect.json?.request?.status === "PENDING");

    // Raju balance still 450000
    const rajuBalD4 = (await get("/api/v1/wallet/balance", rajuToken)).json?.balance;
    check("Raju balance is still 450000", rajuBalD4 === 450000);

    // Give Raju ₹10,000 more with staff deposit
    const topupRes = await post(
      "/api/v1/admin/deposit",
      { to: "raju_day7@gmail.com", amount: 1000000, note: "Top-up" },
      null,
      { "x-admin-key": ADMIN_KEY }
    );
    check("Staff deposit ₹10,000 -> 201", topupRes.status === 201);

    // Pay again (now Raju has ₹14,500; daily spend will be ₹500 + ₹9,000 = ₹9,500 <= ₹10,000)
    const paySuccess = await post(
      `/api/v1/requests/${d4Id}/pay`,
      { pin: "5829" },
      rajuToken,
      { "Idempotency-Key": "pay-d4-retry" }
    );
    check("Pay ₹9,000 succeeds -> 200", paySuccess.status === 200);
    check("Raju new balance is 550000", paySuccess.json?.balance === 550000);

    // Make one more ₹1,000 request and try to pay it
    const reqLimit = await post("/api/v1/requests", { to: rajuId, amount: 100000, note: "Over limit" }, priyaToken);
    const limitId = reqLimit.json?.request?.id;

    // ₹9,500 + ₹1,000 = ₹10,500 > ₹10,000 daily limit -> 400 Daily limit reached
    const payOverLimit = await post(
      `/api/v1/requests/${limitId}/pay`,
      { pin: "5829" },
      rajuToken,
      { "Idempotency-Key": "pay-over-limit" }
    );
    check("Payment exceeding limit -> 400", payOverLimit.status === 400);
    check("Limit message contains 'Daily limit reached'", payOverLimit.json?.message?.includes("Daily limit reached"));
    check("leftToday is 50000", payOverLimit.json?.leftToday === 50000);

    // Request stays PENDING
    const limitInspect = await get(`/api/v1/requests/${limitId}`, rajuToken);
    check("Over-limit request stays PENDING", limitInspect.json?.request?.status === "PENDING");

    // -------------------------------------------------------------------------
    // D5. Expiry
    // -------------------------------------------------------------------------
    console.log("\n--- D5: Expiry ---");
    const expReq = await post("/api/v1/requests", { to: rajuId, amount: 10000, note: "Expiry test" }, priyaToken);
    const expId = expReq.json?.request?.id;

    // Change expiresAt in MongoDB collection to yesterday
    await mongoose.connection
      .collection("moneyrequests")
      .updateOne({ _id: new mongoose.Types.ObjectId(expId) }, { $set: { expiresAt: new Date(Date.now() - 86400000) } });

    // Raju pays it -> 410
    const payExpired = await post(`/api/v1/requests/${expId}/pay`, { pin: "5829" }, rajuToken, { "Idempotency-Key": "pay-exp" });
    check("Pay expired -> 410", payExpired.status === 410);
    check("Pay expired message matches", payExpired.json?.message === "This request has expired");

    // Raju declines it -> 410
    const declineExpired = await post(`/api/v1/requests/${expId}/decline`, {}, rajuToken);
    check("Decline expired -> 410", declineExpired.status === 410);

    // Raju: GET /requests/incoming its status now shows "EXPIRED"
    const incExp = await get("/api/v1/requests/incoming", rajuToken);
    const expDoc = incExp.json?.requests?.find((r) => r.id === expId);
    check("Incoming list shows status 'EXPIRED'", expDoc?.status === "EXPIRED");

    // Raju's balance unchanged
    const rajuBalExp = (await get("/api/v1/wallet/balance", rajuToken)).json?.balance;
    check("Raju balance unchanged after expired actions", rajuBalExp === 550000);

    // -------------------------------------------------------------------------
    // D6. Limits
    // -------------------------------------------------------------------------
    console.log("\n--- D6: Limits ---");
    // Kavi sends 5 requests to Raju -> 201 each
    const kaviIds = [];
    for (let i = 1; i <= 5; i++) {
      const res = await post("/api/v1/requests", { to: rajuId, amount: 10000 * i, note: `Req ${i}` }, kaviToken);
      check(`Kavi sends #${i} -> 201`, res.status === 201);
      kaviIds.push(res.json?.request?.id);
    }

    // Kavi sends a 6th -> 409
    const kavi6 = await post("/api/v1/requests", { to: rajuId, amount: 60000, note: "Req 6" }, kaviToken);
    check("Kavi sends 6th request -> 409", kavi6.status === 409);
    check("5-pending error message matches", kavi6.json?.message === "You already have 5 pending requests to this person");

    // Raju declines one of them -> 200
    const decOne = await post(`/api/v1/requests/${kaviIds[0]}/decline`, {}, rajuToken);
    check("Raju declines one request -> 200", decOne.status === 200);

    // Kavi sends again -> 201 (now it fits again)
    const kaviAgain = await post("/api/v1/requests", { to: rajuId, amount: 60000, note: "Req after decline" }, kaviToken);
    check("Kavi sends again -> 201", kaviAgain.status === 201);

    // Rate limiting: 20 per hour per user
    const rateUser = await post("/api/v1/user/signup", { username: "rate_day7@gmail.com", password: "secret123", firstName: "Rate", lastName: "L" });
    const rateToken = (await post("/api/v1/user/signin", { username: "rate_day7@gmail.com", password: "secret123" })).json?.token;
    let rateHit = false;
    for (let i = 1; i <= 21; i++) {
      const target = i % 2 === 0 ? priyaId : rajuId;
      const res = await post("/api/v1/requests", { to: target, amount: 5000 }, rateToken);
      if (res.status === 429) {
        rateHit = true;
        check("21st request triggers rate limiter -> 429", res.status === 429);
        break;
      }
    }
    check("Rate limit enforced on request creation", rateHit);

    // -------------------------------------------------------------------------
    // Concurrency Race Test: Simultaneous Pay vs Cancel
    // -------------------------------------------------------------------------
    console.log("\n--- Concurrency Race: Pay vs Cancel ---");
    const raceReq = await post("/api/v1/requests", { to: rajuId, amount: 20000, note: "Race test" }, priyaToken);
    const raceId = raceReq.json?.request?.id;

    const [racePay, raceCancel] = await Promise.all([
      post(`/api/v1/requests/${raceId}/pay`, { pin: "5829" }, rajuToken, { "Idempotency-Key": `race-${Date.now()}` }),
      post(`/api/v1/requests/${raceId}/cancel`, {}, priyaToken),
    ]);

    const payWon = racePay.status === 200 && raceCancel.status === 409;
    const cancelWon = racePay.status === 409 && raceCancel.status === 200;
    check("Simultaneous pay vs cancel has exactly 1 winner and 1 loser", payWon || cancelWon);

    // -------------------------------------------------------------------------
    // Final Reconcile Check: Conservation of Money
    // -------------------------------------------------------------------------
    console.log("\n--- Final Check: Admin Reconcile ---");
    const recRes = await get("/api/v1/admin/reconcile", null, { "x-admin-key": ADMIN_KEY });
    check("GET /api/v1/admin/reconcile -> 200", recRes.status === 200);
    check("moneyIsConserved === true", recRes.json?.moneyIsConserved === true);
    check("Zero balance mismatches", recRes.json?.mismatches?.length === 0);

  } finally {
    server.kill("SIGTERM");
    await mongoose.disconnect();
    await replSet.stop();
  }

  console.log(`\n===============================================================================`);
  console.log(`=== DAY 7 ACCEPTANCE SUITE SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED ===`);
  console.log(`===============================================================================\n`);

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Day 7 unified test runner threw uncaught error:", err);
  process.exit(1);
});
