// test/phase3_decline_cancel.test.js — Acceptance test for Level 2 / D2 Decline and Cancel Transitions.
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import mongoose from "mongoose";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3120;
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
  console.log("=== Starting Phase 3 / Level 2 Acceptance Tests (Decline & Cancel) ===");

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
    JWT_SECRET: "test_secret_for_phase3_testing_32bytes_ok",
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

  // Direct mongoose connection for deep DB verification
  await mongoose.connect(mongoUri);

  try {
    async function post(url, body, token) {
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${BASE}${url}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    }

    async function get(url, token) {
      const headers = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${BASE}${url}`, { headers });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    }

    // Create 3 test users: Priya, Raju, Kavi
    const priyaRes = await post("/api/v1/user/signup", {
      username: "priya_p3@gmail.com",
      password: "secret123",
      firstName: "Priya",
      lastName: "S",
    });
    check("Priya signup -> 201", priyaRes.status === 201, JSON.stringify(priyaRes.json));
    const priyaId = priyaRes.json?.user?._id;
    const priyaSignin = await post("/api/v1/user/signin", { username: "priya_p3@gmail.com", password: "secret123" });
    const priyaToken = priyaSignin.json?.token;

    const rajuRes = await post("/api/v1/user/signup", {
      username: "raju_p3@gmail.com",
      password: "secret123",
      firstName: "Raju",
      lastName: "K",
    });
    check("Raju signup -> 201", rajuRes.status === 201, JSON.stringify(rajuRes.json));
    const rajuId = rajuRes.json?.user?._id;
    const rajuSignin = await post("/api/v1/user/signin", { username: "raju_p3@gmail.com", password: "secret123" });
    const rajuToken = rajuSignin.json?.token;

    const kaviRes = await post("/api/v1/user/signup", {
      username: "kavi_p3@gmail.com",
      password: "secret123",
      firstName: "Kavi",
      lastName: "M",
    });
    check("Kavi signup -> 201", kaviRes.status === 201, JSON.stringify(kaviRes.json));
    const kaviSignin = await post("/api/v1/user/signin", { username: "kavi_p3@gmail.com", password: "secret123" });
    const kaviToken = kaviSignin.json?.token;

    // --- Scenario 1: Priya sends R2 to Raju. Raju declines R2 ---
    console.log("\n--- Scenario 1: Priya sends R2 to Raju -> Raju declines R2 ---");
    const r2Res = await post("/api/v1/requests", { to: rajuId, amount: 25000, note: "Lunch split" }, priyaToken);
    check("Priya sends R2 -> 201", r2Res.status === 201, JSON.stringify(r2Res.json));
    const r2Id = r2Res.json?.request?.id;

    // Kavi (stranger) tries to decline R2 -> 404
    const kaviDeclineR2 = await post(`/api/v1/requests/${r2Id}/decline`, {}, kaviToken);
    check("Kavi (stranger) decline R2 -> 404", kaviDeclineR2.status === 404, JSON.stringify(kaviDeclineR2.json));
    check("Stranger decline message is 'Request not found'", kaviDeclineR2.json?.message === "Request not found");

    // Raju declines R2 -> 200 {"message":"Request declined"}
    const rajuDeclineR2 = await post(`/api/v1/requests/${r2Id}/decline`, {}, rajuToken);
    check("Raju declines R2 -> 200", rajuDeclineR2.status === 200, JSON.stringify(rajuDeclineR2.json));
    check("Decline message is 'Request declined'", rajuDeclineR2.json?.message === "Request declined");

    // Raju declines R2 again -> 409 {"message":"This request is already DECLINED"}
    const rajuDeclineR2Again = await post(`/api/v1/requests/${r2Id}/decline`, {}, rajuToken);
    check("Raju declines R2 again -> 409", rajuDeclineR2Again.status === 409, JSON.stringify(rajuDeclineR2Again.json));
    check(
      "Already declined message contains 'already DECLINED'",
      rajuDeclineR2Again.json?.message === "This request is already DECLINED"
    );

    // Priya tries to decline R2 (already declined) -> 403 (role check comes before status check for requester)
    const priyaDeclineR2 = await post(`/api/v1/requests/${r2Id}/decline`, {}, priyaToken);
    check("Priya tries to decline R2 -> 403", priyaDeclineR2.status === 403, JSON.stringify(priyaDeclineR2.json));
    check(
      "Requester decline error message matches",
      priyaDeclineR2.json?.message === "Only the person asked can decline this request"
    );

    // Check DB document for R2: status DECLINED and decidedAt recorded
    const r2DbDoc = await mongoose.connection.collection("moneyrequests").findOne({ _id: new mongoose.Types.ObjectId(r2Id) });
    check("R2 DB status is DECLINED", r2DbDoc.status === "DECLINED");
    check("R2 decidedAt is recorded Date", r2DbDoc.decidedAt instanceof Date);

    // --- Scenario 2: Priya sends R3 to Raju. Priya cancels R3 ---
    console.log("\n--- Scenario 2: Priya sends R3 to Raju -> Priya cancels R3 ---");
    const r3Res = await post("/api/v1/requests", { to: rajuId, amount: 35000, note: "Concert tickets" }, priyaToken);
    check("Priya sends R3 -> 201", r3Res.status === 201, JSON.stringify(r3Res.json));
    const r3Id = r3Res.json?.request?.id;

    // Priya tries to decline R3 -> 403 {"message":"Only the person asked can decline this request"}
    const priyaDeclineR3 = await post(`/api/v1/requests/${r3Id}/decline`, {}, priyaToken);
    check("Priya tries to decline R3 -> 403", priyaDeclineR3.status === 403, JSON.stringify(priyaDeclineR3.json));
    check(
      "Priya decline error matches spec",
      priyaDeclineR3.json?.message === "Only the person asked can decline this request"
    );

    // Raju (payer) tries to cancel R3 -> 403 {"message":"Only the requester can cancel this request"}
    const rajuCancelR3 = await post(`/api/v1/requests/${r3Id}/cancel`, {}, rajuToken);
    check("Raju tries to cancel R3 -> 403", rajuCancelR3.status === 403, JSON.stringify(rajuCancelR3.json));
    check(
      "Payer cancel error matches spec",
      rajuCancelR3.json?.message === "Only the requester can cancel this request"
    );

    // Kavi (stranger) tries to cancel R3 -> 404 {"message":"Request not found"}
    const kaviCancelR3 = await post(`/api/v1/requests/${r3Id}/cancel`, {}, kaviToken);
    check("Kavi (stranger) cancel R3 -> 404", kaviCancelR3.status === 404, JSON.stringify(kaviCancelR3.json));
    check("Stranger cancel message is 'Request not found'", kaviCancelR3.json?.message === "Request not found");

    // Priya cancels R3 -> 200 {"message":"Request cancelled"}
    const priyaCancelR3 = await post(`/api/v1/requests/${r3Id}/cancel`, {}, priyaToken);
    check("Priya cancels R3 -> 200", priyaCancelR3.status === 200, JSON.stringify(priyaCancelR3.json));
    check("Cancel message is 'Request cancelled'", priyaCancelR3.json?.message === "Request cancelled");

    // Priya cancels R3 again -> 409 {"message":"This request is already CANCELLED"}
    const priyaCancelR3Again = await post(`/api/v1/requests/${r3Id}/cancel`, {}, priyaToken);
    check("Priya cancels R3 again -> 409", priyaCancelR3Again.status === 409, JSON.stringify(priyaCancelR3Again.json));
    check(
      "Already cancelled message contains 'already CANCELLED'",
      priyaCancelR3Again.json?.message === "This request is already CANCELLED"
    );

    // Raju tries to decline R3 (which is already CANCELLED) -> 409 {"message":"This request is already CANCELLED"}
    const rajuDeclineCancelledR3 = await post(`/api/v1/requests/${r3Id}/decline`, {}, rajuToken);
    check("Raju tries to decline CANCELLED R3 -> 409", rajuDeclineCancelledR3.status === 409, JSON.stringify(rajuDeclineCancelledR3.json));
    check(
      "Decline on cancelled request returns 409 with 'already CANCELLED'",
      rajuDeclineCancelledR3.json?.message === "This request is already CANCELLED"
    );

    // Check DB document for R3: status CANCELLED and decidedAt recorded
    const r3DbDoc = await mongoose.connection.collection("moneyrequests").findOne({ _id: new mongoose.Types.ObjectId(r3Id) });
    check("R3 DB status is CANCELLED", r3DbDoc.status === "CANCELLED");
    check("R3 decidedAt is recorded Date", r3DbDoc.decidedAt instanceof Date);

    // --- Scenario 3: Bad Object ID checks ---
    console.log("\n--- Scenario 3: Bad ID parameter tests ---");
    const badIdDecline = await post("/api/v1/requests/invalid-mongo-id/decline", {}, rajuToken);
    check("Bad id decline -> 404", badIdDecline.status === 404, JSON.stringify(badIdDecline.json));

    const badIdCancel = await post("/api/v1/requests/invalid-mongo-id/cancel", {}, priyaToken);
    check("Bad id cancel -> 404", badIdCancel.status === 404, JSON.stringify(badIdCancel.json));

    // Non-existent Mongo ObjectId
    const nonExistentId = new mongoose.Types.ObjectId().toString();
    const missingDecline = await post(`/api/v1/requests/${nonExistentId}/decline`, {}, rajuToken);
    check("Non-existent id decline -> 404", missingDecline.status === 404, JSON.stringify(missingDecline.json));

    const missingCancel = await post(`/api/v1/requests/${nonExistentId}/cancel`, {}, priyaToken);
    check("Non-existent id cancel -> 404", missingCancel.status === 404, JSON.stringify(missingCancel.json));

    // Verify GET /api/v1/requests/:id reflects status
    const r2View = await get(`/api/v1/requests/${r2Id}`, rajuToken);
    check("GET R2 reflects status DECLINED", r2View.json?.request?.status === "DECLINED");

    const r3View = await get(`/api/v1/requests/${r3Id}`, priyaToken);
    check("GET R3 reflects status CANCELLED", r3View.json?.request?.status === "CANCELLED");

  } finally {
    server.kill("SIGTERM");
    await mongoose.disconnect();
    await replSet.stop();
  }

  console.log(`\n==========================================`);
  console.log(`PHASE 3 / LEVEL 2 TEST SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED`);
  console.log(`==========================================`);

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner threw uncaught error:", err);
  process.exit(1);
});
