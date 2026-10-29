// test/phase2_request_creation.test.js — Acceptance test for Level 1 / D1 Request Creation & Inboxes.
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import mongoose from "mongoose";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3119;
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
  console.log("=== Starting Phase 2 / Level 1 Acceptance Tests ===");

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
    JWT_SECRET: "test_secret_for_phase2_testing_32bytes_ok",
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

    // Create 3 fresh test users: Priya, Raju, Kavi
    const priyaRes = await post("/api/v1/user/signup", {
      username: "priya@gmail.com",
      password: "secret123",
      firstName: "Priya",
      lastName: "S",
    });
    check("Priya signup -> 201", priyaRes.status === 201, JSON.stringify(priyaRes.json));
    const priyaId = priyaRes.json?.user?._id;
    const priyaSignin = await post("/api/v1/user/signin", { username: "priya@gmail.com", password: "secret123" });
    const priyaToken = priyaSignin.json?.token;

    const rajuRes = await post("/api/v1/user/signup", {
      username: "raju@gmail.com",
      password: "secret123",
      firstName: "Raju",
      lastName: "K",
    });
    check("Raju signup -> 201", rajuRes.status === 201, JSON.stringify(rajuRes.json));
    const rajuId = rajuRes.json?.user?._id;
    const rajuSignin = await post("/api/v1/user/signin", { username: "raju@gmail.com", password: "secret123" });
    const rajuToken = rajuSignin.json?.token;

    const kaviRes = await post("/api/v1/user/signup", {
      username: "kavi@gmail.com",
      password: "secret123",
      firstName: "Kavi",
      lastName: "M",
    });
    check("Kavi signup -> 201", kaviRes.status === 201, JSON.stringify(kaviRes.json));
    const kaviSignin = await post("/api/v1/user/signin", { username: "kavi@gmail.com", password: "secret123" });
    const kaviToken = kaviSignin.json?.token;

    // --- D1. Send a request and see it ---
    console.log("\n--- Testing D1: Send a request and see it ---");

    const sendRes = await post(
      "/api/v1/requests",
      { to: rajuId, amount: 50000, note: "Dinner at Murugan Idli" },
      priyaToken
    );
    check("POST /requests -> 201", sendRes.status === 201, JSON.stringify(sendRes.json));
    check("POST /requests message is 'Request sent'", sendRes.json?.message === "Request sent");
    check("POST /requests returns request object", Boolean(sendRes.json?.request));
    check("POST /requests returns recipient name 'Raju K'", sendRes.json?.request?.to === "Raju K");
    check("POST /requests returns amount 50000", sendRes.json?.request?.amount === 50000);
    check("POST /requests returns note 'Dinner at Murugan Idli'", sendRes.json?.request?.note === "Dinner at Murugan Idli");
    check("POST /requests status is PENDING", sendRes.json?.request?.status === "PENDING");
    check("POST /requests returns valid expiresAt", Boolean(sendRes.json?.request?.expiresAt));

    const requestId = sendRes.json?.request?.id;

    // Raju: GET /requests/incoming
    const incomingRes = await get("/api/v1/requests/incoming", rajuToken);
    check("Raju: GET /requests/incoming -> 200", incomingRes.status === 200, JSON.stringify(incomingRes.json));
    const incList = incomingRes.json?.requests || [];
    check("Incoming list has 1 request", incList.length === 1);
    check("Incoming request has from 'Priya S'", incList[0]?.from === "Priya S");
    check("Incoming request has amount 50000", incList[0]?.amount === 50000);
    check("Incoming request has note 'Dinner at Murugan Idli'", incList[0]?.note === "Dinner at Murugan Idli");
    check("Incoming request has status PENDING", incList[0]?.status === "PENDING");

    // Priya: GET /requests/outgoing
    const outgoingRes = await get("/api/v1/requests/outgoing", priyaToken);
    check("Priya: GET /requests/outgoing -> 200", outgoingRes.status === 200, JSON.stringify(outgoingRes.json));
    const outList = outgoingRes.json?.requests || [];
    check("Outgoing list has 1 request", outList.length === 1);
    check("Outgoing request has to 'Raju K'", outList[0]?.to === "Raju K");
    check("Outgoing request has amount 50000", outList[0]?.amount === 50000);

    // Raju & Priya inspect request by id
    const rajuView = await get(`/api/v1/requests/${requestId}`, rajuToken);
    check("Raju: GET /requests/:id -> 200", rajuView.status === 200, JSON.stringify(rajuView.json));
    check("Raju view shows from 'Priya S'", rajuView.json?.request?.from === "Priya S");
    check("Raju view shows to 'Raju K'", rajuView.json?.request?.to === "Raju K");

    const priyaView = await get(`/api/v1/requests/${requestId}`, priyaToken);
    check("Priya: GET /requests/:id -> 200", priyaView.status === 200, JSON.stringify(priyaView.json));

    // Kavi (stranger): GET /requests/:id -> 404
    const kaviView = await get(`/api/v1/requests/${requestId}`, kaviToken);
    check("Kavi (stranger): GET /requests/:id -> 404", kaviView.status === 404, JSON.stringify(kaviView.json));
    check("Stranger receives generic message 'Request not found'", kaviView.json?.message === "Request not found");

    // Invalid ObjectId URL parameter
    const badIdRes = await get("/api/v1/requests/not-a-valid-id", rajuToken);
    check("Bad ObjectId query -> 404 (no crash)", badIdRes.status === 404, JSON.stringify(badIdRes.json));

    // Priya requests money from herself -> 400
    const selfRes = await post("/api/v1/requests", { to: priyaId, amount: 50000 }, priyaToken);
    check("Priya request from herself -> 400", selfRes.status === 400, JSON.stringify(selfRes.json));
    check("Self request error message matches", selfRes.json?.message === "You can't request money from yourself");

    // Invalid amounts
    const underMin = await post("/api/v1/requests", { to: rajuId, amount: 50 }, priyaToken);
    check("amount 50 (under ₹1) -> 400", underMin.status === 400, JSON.stringify(underMin.json));
    check("Under min error message mentions Invalid inputs", underMin.json?.message === "Invalid inputs");

    const overMax = await post("/api/v1/requests", { to: rajuId, amount: 1000001 }, priyaToken);
    check("amount > ₹10,000 -> 400", overMax.status === 400, JSON.stringify(overMax.json));

    // Request to non-existent user
    const fakeUserId = new mongoose.Types.ObjectId().toString();
    const missingUserRes = await post("/api/v1/requests", { to: fakeUserId, amount: 5000 }, priyaToken);
    check("Request to non-existent user -> 404", missingUserRes.status === 404, JSON.stringify(missingUserRes.json));
    check("Missing user message is 'User not found'", missingUserRes.json?.message === "User not found");

    // Filtering by status
    const pendingFilterRes = await get("/api/v1/requests/incoming?status=PENDING", rajuToken);
    check("GET /requests/incoming?status=PENDING -> 1 request", pendingFilterRes.json?.requests?.length === 1);

    const paidFilterRes = await get("/api/v1/requests/incoming?status=PAID", rajuToken);
    check("GET /requests/incoming?status=PAID -> 0 requests", paidFilterRes.json?.requests?.length === 0);
  } finally {
    server.kill("SIGTERM");
    await mongoose.disconnect();
    await replSet.stop();
  }

  console.log(`\n==========================================`);
  console.log(`PHASE 2 / LEVEL 1 TEST SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED`);
  console.log(`==========================================`);

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner threw uncaught error:", err);
  process.exit(1);
});
