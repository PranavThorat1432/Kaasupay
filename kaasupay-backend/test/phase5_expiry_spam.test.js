// test/phase5_expiry_spam.test.js — Acceptance test for Level 4 & Level 5 (D5 & D6) Expiry, Spam & Concurrency.
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import mongoose from "mongoose";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3122;
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
  console.log("=== Starting Phase 5 / Level 4 & Level 5 Acceptance Tests (Expiry, Spam & Concurrency) ===");

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
    JWT_SECRET: "test_secret_for_phase5_testing_32bytes_ok",
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
      username: "priya_p5@gmail.com",
      password: "secret123",
      firstName: "Priya",
      lastName: "S",
    });
    check("Priya signup -> 201", priyaRes.status === 201, JSON.stringify(priyaRes.json));
    const priyaSignin = await post("/api/v1/user/signin", { username: "priya_p5@gmail.com", password: "secret123" });
    const priyaToken = priyaSignin.json?.token;

    const rajuRes = await post("/api/v1/user/signup", {
      username: "raju_p5@gmail.com",
      password: "secret123",
      firstName: "Raju",
      lastName: "K",
    });
    check("Raju signup -> 201", rajuRes.status === 201, JSON.stringify(rajuRes.json));
    const rajuId = rajuRes.json?.user?._id;
    const rajuSignin = await post("/api/v1/user/signin", { username: "raju_p5@gmail.com", password: "secret123" });
    const rajuToken = rajuSignin.json?.token;

    const kaviRes = await post("/api/v1/user/signup", {
      username: "kavi_p5@gmail.com",
      password: "secret123",
      firstName: "Kavi",
      lastName: "M",
    });
    check("Kavi signup -> 201", kaviRes.status === 201, JSON.stringify(kaviRes.json));
    const kaviSignin = await post("/api/v1/user/signin", { username: "kavi_p5@gmail.com", password: "secret123" });
    const kaviToken = kaviSignin.json?.token;

    // 2. Fund Raju with ₹5,000 (500000 paise) via staff deposit
    const depositRes = await post(
      "/api/v1/admin/deposit",
      { to: "raju_p5@gmail.com", amount: 500000, note: "Phase 5 seed funds" },
      null,
      { "x-admin-key": ADMIN_KEY }
    );
    check("Admin deposit ₹5,000 to Raju -> 201", depositRes.status === 201);

    // 3. Set Raju's PIN to 5829
    const pinRes = await post(
      "/api/v1/user/pin",
      { password: "secret123", pin: "5829" },
      rajuToken
    );
    check("Set Raju PIN to 5829 -> 200", pinRes.status === 200);

    // =========================================================================
    // D5: Lazy Expiry
    // =========================================================================
    console.log("\n--- Testing D5: Lazy Expiry ---");

    // Priya creates a request to Raju for ₹500
    const expReqRes = await post(
      "/api/v1/requests",
      { to: rajuId, amount: 50000, note: "Expired test request" },
      priyaToken
    );
    check("Priya creates request -> 201", expReqRes.status === 201, JSON.stringify(expReqRes.json));
    const expReqId = expReqRes.json?.request?.id;

    // Directly alter expiresAt to yesterday in MongoDB collection
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await mongoose.connection
      .collection("moneyrequests")
      .updateOne({ _id: new mongoose.Types.ObjectId(expReqId) }, { $set: { expiresAt: yesterday } });

    // Raju pays it -> 410 {"message":"This request has expired"}
    const payExpired = await post(
      `/api/v1/requests/${expReqId}/pay`,
      { pin: "5829" },
      rajuToken,
      { "Idempotency-Key": "pay-expired-1" }
    );
    check("Raju pays expired request -> 410", payExpired.status === 410, JSON.stringify(payExpired.json));
    check(
      "Pay expired message is 'This request has expired'",
      payExpired.json?.message === "This request has expired"
    );

    // Raju declines it -> 410 {"message":"This request has expired"}
    const declineExpired = await post(`/api/v1/requests/${expReqId}/decline`, {}, rajuToken);
    check("Raju declines expired request -> 410", declineExpired.status === 410, JSON.stringify(declineExpired.json));
    check(
      "Decline expired message is 'This request has expired'",
      declineExpired.json?.message === "This request has expired"
    );

    // Priya cancels it -> 410 {"message":"This request has expired"}
    const cancelExpired = await post(`/api/v1/requests/${expReqId}/cancel`, {}, priyaToken);
    check("Priya cancels expired request -> 410", cancelExpired.status === 410, JSON.stringify(cancelExpired.json));
    check(
      "Cancel expired message is 'This request has expired'",
      cancelExpired.json?.message === "This request has expired"
    );

    // Raju: GET /requests/incoming its status now shows "EXPIRED"
    const incomingRes = await get("/api/v1/requests/incoming", rajuToken);
    check("Raju gets incoming requests -> 200", incomingRes.status === 200);
    const expiredItem = incomingRes.json?.requests?.find((r) => r.id === expReqId);
    check("Request in incoming list has status EXPIRED", expiredItem?.status === "EXPIRED", `status=${expiredItem?.status}`);

    // Raju's balance unchanged
    const rajuBalAfterExp = await get("/api/v1/wallet/balance", rajuToken);
    check("Raju's balance unchanged at 500000", rajuBalAfterExp.json?.balance === 500000);

    // =========================================================================
    // D6: Anti-Spam Limits (5 pending requests & 20/hr rate limit)
    // =========================================================================
    console.log("\n--- Testing D6: Anti-Spam Limits ---");

    const kaviRequestIds = [];
    // Kavi sends 5 requests to Raju -> 201 each time
    for (let i = 1; i <= 5; i++) {
      const res = await post(
        "/api/v1/requests",
        { to: rajuId, amount: 10000, note: `Spam test ${i}` },
        kaviToken
      );
      check(`Kavi sends request ${i}/5 -> 201`, res.status === 201, JSON.stringify(res.json));
      if (res.json?.request?.id) kaviRequestIds.push(res.json.request.id);
    }

    // Kavi sends a 6th -> 409 {"message":"You already have 5 pending requests to this person"}
    const spam6Res = await post(
      "/api/v1/requests",
      { to: rajuId, amount: 10000, note: "Spam test 6" },
      kaviToken
    );
    check("Kavi sends 6th request -> 409", spam6Res.status === 409, JSON.stringify(spam6Res.json));
    check(
      "Spam message matches spec exactly",
      spam6Res.json?.message === "You already have 5 pending requests to this person"
    );

    // Raju declines one of them -> 200
    const declineOneRes = await post(`/api/v1/requests/${kaviRequestIds[0]}/decline`, {}, rajuToken);
    check("Raju declines one of the 5 requests -> 200", declineOneRes.status === 200, JSON.stringify(declineOneRes.json));

    // Kavi sends again -> 201 (now it fits again!)
    const kaviRetryRes = await post(
      "/api/v1/requests",
      { to: rajuId, amount: 10000, note: "Spam test replacement" },
      kaviToken
    );
    check("Kavi sends request after decline -> 201 (now it fits)", kaviRetryRes.status === 201, JSON.stringify(kaviRetryRes.json));

    // Verify rate limit header on request creation (20 per hour)
    check(
      "RateLimit-Limit header is 20",
      kaviRetryRes.headers?.get("x-ratelimit-limit") === "20",
      `limit=${kaviRetryRes.headers?.get("x-ratelimit-limit")}`
    );

    // =========================================================================
    // Concurrency Race Test (Bonus 8 / Invariant 3: Pay vs Cancel)
    // =========================================================================
    console.log("\n--- Testing Concurrency Race: Simultaneous Pay vs Cancel ---");

    // Perform 5 concurrent race trials
    for (let round = 1; round <= 5; round++) {
      const raceReq = await post(
        "/api/v1/requests",
        { to: rajuId, amount: 2000, note: `Race trial ${round}` },
        priyaToken
      );
      const raceReqId = raceReq.json?.request?.id;

      // Fire pay (Raju) and cancel (Priya) at the exact same millisecond
      const payPromise = post(
        `/api/v1/requests/${raceReqId}/pay`,
        { pin: "5829" },
        rajuToken,
        { "Idempotency-Key": `race-pay-key-${round}-${Date.now()}` }
      );
      const cancelPromise = post(
        `/api/v1/requests/${raceReqId}/cancel`,
        {},
        priyaToken
      );

      const [payRes, cancelRes] = await Promise.all([payPromise, cancelPromise]);

      const payWon = payRes.status === 200 && cancelRes.status === 409;
      const cancelWon = payRes.status === 409 && cancelRes.status === 200;

      check(
        `Race round ${round}: Exactly one action won (Pay 200/Cancel 409 OR Cancel 200/Pay 409)`,
        payWon || cancelWon,
        `payStatus=${payRes.status}, cancelStatus=${cancelRes.status}`
      );

      // Verify the database state matches the winner
      const finalDoc = await mongoose.connection
        .collection("moneyrequests")
        .findOne({ _id: new mongoose.Types.ObjectId(raceReqId) });

      if (payWon) {
        check(`Race round ${round}: DB state is PAID`, finalDoc.status === "PAID");
        check(`Race round ${round}: transactionId is assigned`, Boolean(finalDoc.transactionId));
      } else {
        check(`Race round ${round}: DB state is CANCELLED`, finalDoc.status === "CANCELLED");
        check(`Race round ${round}: transactionId remains null`, finalDoc.transactionId === null);
      }
    }

    // =========================================================================
    // Administrative Financial Reconciliation Conservation Check
    // =========================================================================
    console.log("\n--- Testing Financial Reconciliation ---");
    const reconcileRes = await get("/api/v1/admin/reconcile", null, { "x-admin-key": ADMIN_KEY });
    check("Admin reconcile -> 200", reconcileRes.status === 200, JSON.stringify(reconcileRes.json));
    check("Reconciliation confirms moneyIsConserved: true", reconcileRes.json?.moneyIsConserved === true);
    check("Reconciliation has 0 balance mismatches", reconcileRes.json?.mismatches?.length === 0);

  } finally {
    server.kill("SIGTERM");
    await mongoose.disconnect();
    await replSet.stop();
  }

  console.log(`\n==========================================`);
  console.log(`PHASE 5 / LEVEL 4 & 5 TEST SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED`);
  console.log(`==========================================`);

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner threw uncaught error:", err);
  process.exit(1);
});
