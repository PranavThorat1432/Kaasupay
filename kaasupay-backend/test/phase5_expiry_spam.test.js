// test/phase5_expiry_spam.test.js — Acceptance test for Level 4 & Level 5 (D5 & D6) Expiry, Spam Limits & Race Condition.
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
  console.log("=== Starting Phase 5 / Level 4 & Level 5 Acceptance Tests (Expiry, Spam & Race) ===");

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
    const priyaId = priyaRes.json?.user?._id;
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
    const kaviId = kaviRes.json?.user?._id;
    const kaviSignin = await post("/api/v1/user/signin", { username: "kavi_p5@gmail.com", password: "secret123" });
    const kaviToken = kaviSignin.json?.token;

    // 2. Fund Raju with ₹5,000 (500000 paise) via staff deposit
    const depositRes = await post(
      "/api/v1/admin/deposit",
      { to: "raju_p5@gmail.com", amount: 500000, note: "Phase 5 seed funds" },
      null,
      { "x-admin-key": ADMIN_KEY }
    );
    check("Staff deposit to Raju -> 201", depositRes.status === 201);

    // 3. Set Raju's PIN to 5829
    const pinRes = await post(
      "/api/v1/user/pin",
      { password: "secret123", pin: "5829" },
      rajuToken
    );
    check("Set Raju PIN to 5829 -> 200", pinRes.status === 200);

    // =========================================================================
    // D5: Expiry
    // =========================================================================
    console.log("\n--- Testing D5: Expiry ---");

    // Create a request from Priya to Raju
    const rExpRes = await post(
      "/api/v1/requests",
      { to: rajuId, amount: 20000, note: "Expired test request" },
      priyaToken
    );
    check("Priya creates request for expiry test -> 201", rExpRes.status === 201);
    const rExpId = rExpRes.json?.request?.id;

    // Change expiresAt in MongoDB collection to yesterday
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await mongoose.connection
      .collection("moneyrequests")
      .updateOne({ _id: new mongoose.Types.ObjectId(rExpId) }, { $set: { expiresAt: yesterday } });

    // Raju pays it -> 410 {"message":"This request has expired"}
    const payExpRes = await post(
      `/api/v1/requests/${rExpId}/pay`,
      { pin: "5829" },
      rajuToken,
      { "Idempotency-Key": "pay-exp-key" }
    );
    check("Raju pays expired request -> 410", payExpRes.status === 410, JSON.stringify(payExpRes.json));
    check(
      "Pay expired message is 'This request has expired'",
      payExpRes.json?.message === "This request has expired"
    );

    // Raju declines it -> 410 {"message":"This request has expired"}
    const declineExpRes = await post(`/api/v1/requests/${rExpId}/decline`, {}, rajuToken);
    check("Raju declines expired request -> 410", declineExpRes.status === 410, JSON.stringify(declineExpRes.json));
    check(
      "Decline expired message is 'This request has expired'",
      declineExpRes.json?.message === "This request has expired"
    );

    // Priya cancels it -> 410 {"message":"This request has expired"}
    const cancelExpRes = await post(`/api/v1/requests/${rExpId}/cancel`, {}, priyaToken);
    check("Priya cancels expired request -> 410", cancelExpRes.status === 410, JSON.stringify(cancelExpRes.json));
    check(
      "Cancel expired message is 'This request has expired'",
      cancelExpRes.json?.message === "This request has expired"
    );

    // Raju: GET /requests/incoming its status now shows "EXPIRED"
    const incRes = await get("/api/v1/requests/incoming", rajuToken);
    const expiredDocIn = incRes.json?.requests?.find((r) => r.id === rExpId);
    check("Incoming list contains expired request", Boolean(expiredDocIn));
    check("Incoming list status shows 'EXPIRED'", expiredDocIn?.status === "EXPIRED");

    // Priya: GET /requests/outgoing its status now shows "EXPIRED"
    const outRes = await get("/api/v1/requests/outgoing", priyaToken);
    const expiredDocOut = outRes.json?.requests?.find((r) => r.id === rExpId);
    check("Outgoing list contains expired request", Boolean(expiredDocOut));
    check("Outgoing list status shows 'EXPIRED'", expiredDocOut?.status === "EXPIRED");

    // Raju's balance is unchanged (500000)
    const rajuBalExp = await get("/api/v1/wallet/balance", rajuToken);
    check("Raju's balance unchanged at 500000", rajuBalExp.json?.balance === 500000);

    // =========================================================================
    // D6: Limits against spam
    // =========================================================================
    console.log("\n--- Testing D6: Limits against spam ---");

    // Kavi sends 5 requests to Raju -> 201 each time
    const kaviReqIds = [];
    for (let i = 1; i <= 5; i++) {
      const res = await post(
        "/api/v1/requests",
        { to: rajuId, amount: i * 10000, note: `Kavi request #${i}` },
        kaviToken
      );
      check(`Kavi sends request #${i} -> 201`, res.status === 201);
      kaviReqIds.push(res.json?.request?.id);
    }

    // Kavi sends a 6th request to Raju -> 409 {"message":"You already have 5 pending requests to this person"}
    const kavi6thRes = await post(
      "/api/v1/requests",
      { to: rajuId, amount: 60000, note: "Kavi request #6" },
      kaviToken
    );
    check("Kavi sends 6th request -> 409", kavi6thRes.status === 409, JSON.stringify(kavi6thRes.json));
    check(
      "5-pending spam message matches spec",
      kavi6thRes.json?.message === "You already have 5 pending requests to this person"
    );

    // Raju declines one of Kavi's requests -> 200
    const declineKaviRes = await post(`/api/v1/requests/${kaviReqIds[0]}/decline`, {}, rajuToken);
    check("Raju declines one of Kavi's requests -> 200", declineKaviRes.status === 200);

    // Kavi sends again -> 201 (now it fits again)
    const kaviRetryRes = await post(
      "/api/v1/requests",
      { to: rajuId, amount: 60000, note: "Kavi request after decline" },
      kaviToken
    );
    check("Kavi sends again after decline -> 201", kaviRetryRes.status === 201, JSON.stringify(kaviRetryRes.json));

    // Rate limit test: 20 requests per hour per user
    console.log("\n--- Testing Rate Limit (20 requests/hour) ---");
    // Create an extra 4th user specifically for rate limit stress test
    const spammerRes = await post("/api/v1/user/signup", {
      username: "spammer_p5@gmail.com",
      password: "secret123",
      firstName: "Sam",
      lastName: "S",
    });
    const spammerToken = (await post("/api/v1/user/signin", { username: "spammer_p5@gmail.com", password: "secret123" })).json?.token;

    // Sam sends requests across multiple recipients (or declining in between) to hit 20
    let rateLimited = false;
    for (let i = 1; i <= 21; i++) {
      // Rotate recipient between Priya, Raju, and Kavi
      const targetId = i % 3 === 0 ? priyaId : (i % 3 === 1 ? rajuId : kaviId);
      const res = await post(
        "/api/v1/requests",
        { to: targetId, amount: 5000, note: `Rate test ${i}` },
        spammerToken
      );
      if (res.status === 429) {
        rateLimited = true;
        check("21st request is rate limited -> 429", res.status === 429);
        check(
          "Rate limit message is 'Too many requests. Slow down'",
          res.json?.message === "Too many requests. Slow down"
        );
        check("Retry-After header exists", Boolean(res.headers.get("retry-after")));
        break;
      }
    }
    check("Rate limit triggered on excessive request creation", rateLimited);

    // =========================================================================
    // Concurrency Race Test (Bonus 8 / PDF Page 10)
    // =========================================================================
    console.log("\n--- Testing Concurrency Race: Pay vs Cancel ---");

    // Priya sends fresh request to Raju for ₹300 (30000 paise)
    const raceReqRes = await post(
      "/api/v1/requests",
      { to: rajuId, amount: 30000, note: "Race condition test" },
      priyaToken
    );
    check("Priya creates race test request -> 201", raceReqRes.status === 201);
    const raceReqId = raceReqRes.json?.request?.id;

    // Raju balance before race
    const balBefore = (await get("/api/v1/wallet/balance", rajuToken)).json?.balance;

    // Send pay and cancel simultaneously
    const [payRace, cancelRace] = await Promise.all([
      post(
        `/api/v1/requests/${raceReqId}/pay`,
        { pin: "5829" },
        rajuToken,
        { "Idempotency-Key": `race-key-${Date.now()}` }
      ),
      post(`/api/v1/requests/${raceReqId}/cancel`, {}, priyaToken),
    ]);

    console.log(`Race results: Pay status=${payRace.status}, Cancel status=${cancelRace.status}`);

    const payWon = payRace.status === 200 && cancelRace.status === 409;
    const cancelWon = payRace.status === 409 && cancelRace.status === 200;

    check(
      "Simultaneous pay vs cancel has exactly one winner (200) and one loser (409)",
      payWon || cancelWon,
      `pay=${payRace.status}, cancel=${cancelRace.status}`
    );

    const balAfter = (await get("/api/v1/wallet/balance", rajuToken)).json?.balance;
    if (payWon) {
      check("Pay won: Raju debited exactly 30000 paise", balAfter === balBefore - 30000);
      check(
        "Cancel error indicates request is already PAID",
        cancelRace.json?.message === "This request is already PAID"
      );
    } else {
      check("Cancel won: Raju balance unchanged", balAfter === balBefore);
      check(
        "Pay error indicates request is already CANCELLED",
        payRace.json?.message === "This request is already CANCELLED"
      );
    }

    // =========================================================================
    // Admin Reconcile
    // =========================================================================
    console.log("\n--- Final Reconcile Check ---");
    const reconcileRes = await get("/api/v1/admin/reconcile", null, { "x-admin-key": ADMIN_KEY });
    check("Admin reconcile -> 200", reconcileRes.status === 200);
    check("moneyIsConserved === true", reconcileRes.json?.moneyIsConserved === true);
    check("0 balance mismatches", reconcileRes.json?.mismatches?.length === 0);

  } finally {
    server.kill("SIGTERM");
    await mongoose.disconnect();
    await replSet.stop();
  }

  console.log(`\n==========================================`);
  console.log(`PHASE 5 TEST SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED`);
  console.log(`==========================================`);

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner threw uncaught error:", err);
  process.exit(1);
});
