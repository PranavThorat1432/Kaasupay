// Day 2 acceptance tests.
// Self-contained: starts a throwaway MongoDB (mongodb-memory-server), spawns
// the real server (`node index.js`), runs the full PRD matrix, restarts the
// server to prove persistence, and checks the startup failure paths.
//
// Run: node test/day2.test.js
import { MongoMemoryServer } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JWT_SECRET = process.env.JWT_SECRET; // the secret the server reads from .env
const PORT = 3114;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name} -> ${detail}`);
  }
}

// --- server helpers -------------------------------------------------------

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

// Spawns index.js and captures its output + exit code. Listeners are attached
// immediately so nothing is missed before the process exits.
function spawnCaptured(env) {
  const child = spawn(process.execPath, ["index.js"], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const exited = new Promise((resolve) => {
    child.on("exit", (code) => resolve(code));
    setTimeout(() => {
      if (child.exitCode === null) child.kill();
    }, 40000);
  });
  return { child, exited, getOutput: () => output };
}

async function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.status === 200) return true;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill();
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 3000);
  });
}

async function post(pathname, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + pathname, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON body
  }
  return { status: res.status, json };
}

async function get(pathname, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + pathname, { headers });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON body
  }
  return { status: res.status, json };
}

async function signinToken(username, password) {
  const r = await post("/api/v1/user/signin", { username, password });
  return r.json?.token;
}

const unique = Date.now();
const idOk = (v) => typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v);
const noHashLeaks = (obj) => {
  const s = JSON.stringify(obj);
  return !s.includes("passwordHash") && !s.includes('"password"');
};

// --- 0. start throwaway MongoDB + server ----------------------------------

console.log("Starting in-memory MongoDB (first run may download the mongod binary)...");
const mongod = await MongoMemoryServer.create();

// Always clean up child processes, even if a check throws.
let server = null;
async function cleanup() {
  try {
    await stopServer(server);
  } catch {
    // ignore
  }
  try {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  } catch {
    // ignore
  }
  try {
    await mongod.stop();
  } catch {
    // ignore
  }
}
process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});

try {
  const mongoUri = mongod.getUri();

  server = spawnServer({ MONGO_URL: mongoUri, PORT: String(PORT) });
  let up = await waitForHealth();
  check("server starts after MongoDB connects", up, server.getOutput());
  if (!up) {
    console.log(server.getOutput());
    throw new Error("server never became healthy");
  }
  check(
    "startup logs MongoDB connected then server running",
    server.getOutput().includes("MongoDB connected") &&
      server.getOutput().includes(`Server running on port ${PORT}`),
    server.getOutput()
  );

  // --- 1. Day 1 regression: health, signup, signin -------------------------

  const health = await get("/");
  check(
    "GET / health -> 200",
    health.status === 200 &&
      health.json?.status === "KaasuPay backend is running",
    JSON.stringify(health)
  );

  const signup1 = await post("/api/v1/user/signup", {
    username: "raju@gmail.com",
    firstName: "Raju",
    lastName: "Kumar",
    password: "secret123",
  });
  check("signup valid -> 201", signup1.status === 201, JSON.stringify(signup1));
  check(
    "signup returns ObjectId _ids, wallet balance 0, no password fields",
    idOk(signup1.json?.user?._id) &&
      idOk(signup1.json?.wallet?._id) &&
      signup1.json?.wallet?.balance === 0 &&
      noHashLeaks(signup1.json),
    JSON.stringify(signup1.json)
  );
  const rajuId = signup1.json?.user?._id;

  const dup = await post("/api/v1/user/signup", {
    username: "raju@gmail.com",
    firstName: "Raju",
    lastName: "Kumar",
    password: "secret123",
  });
  check(
    "signup duplicate -> 409 with exact message",
    dup.status === 409 && dup.json?.error === "This email is already registered",
    JSON.stringify(dup)
  );

  const norm = await post("/api/v1/user/signup", {
    username: " Raju@Gmail.com ",
    firstName: "Raju",
    lastName: "Kumar",
    password: "secret123",
  });
  check(
    "signup ' Raju@Gmail.com ' normalized -> 409 (same account)",
    norm.status === 409,
    JSON.stringify(norm)
  );

  const badEmail = await post("/api/v1/user/signup", {
    username: "not-an-email",
    firstName: "Raju",
    lastName: "Kumar",
    password: "secret123",
  });
  check(
    "signup invalid email -> 400 Invalid input",
    badEmail.status === 400 && badEmail.json?.error === "Invalid input",
    JSON.stringify(badEmail)
  );

  const noFirst = await post("/api/v1/user/signup", {
    username: `x${unique}@gmail.com`,
    lastName: "Kumar",
    password: "secret123",
  });
  check("signup missing firstName -> 400", noFirst.status === 400, JSON.stringify(noFirst));

  const shortPw = await post("/api/v1/user/signup", {
    username: `y${unique}@gmail.com`,
    firstName: "Raju",
    lastName: "Kumar",
    password: "abc",
  });
  check("signup short password -> 400", shortPw.status === 400, JSON.stringify(shortPw));

  const signup2 = await post("/api/v1/user/signup", {
    username: "sita@gmail.com",
    firstName: "Sita",
    lastName: "Devi",
    password: "secret456",
  });
  check(
    "signup second valid user -> 201 with distinct _id",
    signup2.status === 201 &&
      idOk(signup2.json?.user?._id) &&
      signup2.json?.user?._id !== rajuId,
    JSON.stringify(signup2)
  );
  const sitaId = signup2.json?.user?._id;

  const okSignin = await post("/api/v1/user/signin", {
    username: "raju@gmail.com",
    password: "secret123",
  });
  check(
    "signin correct credentials -> 200 + token",
    okSignin.status === 200 && !!okSignin.json?.token,
    JSON.stringify(okSignin)
  );
  let rajuToken = okSignin.json?.token;
  if (rajuToken) {
    const payload = JSON.parse(
      Buffer.from(rajuToken.split(".")[1], "base64url").toString()
    );
    check(
      "JWT payload userId is the MongoDB _id string",
      payload.userId === rajuId,
      JSON.stringify(payload)
    );
    check(
      "JWT expires in 1 hour",
      payload.exp - payload.iat === 3600,
      `ttl=${payload.exp - payload.iat}`
    );
    // Proves the server signs with JWT_SECRET from .env: verifying the
    // server's token with that secret must succeed.
    let verifiedWithEnvSecret = true;
    try {
      jwt.verify(rajuToken, JWT_SECRET);
    } catch {
      verifiedWithEnvSecret = false;
    }
    check("JWT is signed with JWT_SECRET from .env", verifiedWithEnvSecret, "verify failed");
  }

  const badPw = await post("/api/v1/user/signin", {
    username: "raju@gmail.com",
    password: "wrongpass",
  });
  check("signin wrong password -> 401", badPw.status === 401, JSON.stringify(badPw));

  const unknown = await post("/api/v1/user/signin", {
    username: `nobody${unique}@gmail.com`,
    password: "secret123",
  });
  check(
    "unknown email -> 401 identical generic message",
    unknown.status === 401 &&
      unknown.json?.error === badPw.json?.error &&
      unknown.json?.error === "Wrong email or password",
    `unknown=${JSON.stringify(unknown.json)} badPw=${JSON.stringify(badPw.json)}`
  );

  const noPw = await post("/api/v1/user/signin", { username: "raju@gmail.com" });
  check("signin missing password -> 400", noPw.status === 400, JSON.stringify(noPw));

  // --- 2. MongoDB contents: collections + wallet reference ----------------

  await mongoose.connect(mongoUri, { dbName: "kaasupay" });
  const db = mongoose.connection.db;
  check("database name is kaasupay", db.databaseName === "kaasupay", db.databaseName);
  const collectionNames = (await db.listCollections().toArray()).map((c) => c.name);
  check(
    "collections users and wallets exist",
    collectionNames.includes("users") && collectionNames.includes("wallets"),
    JSON.stringify(collectionNames)
  );
  const userDoc = await db.collection("users").findOne({ username: "raju@gmail.com" });
  const userDocSita = await db.collection("users").findOne({ username: "sita@gmail.com" });
  check(
    "user stored with normalized email and bcrypt hash (no plaintext)",
    !!userDoc &&
      typeof userDoc.passwordHash === "string" &&
      userDoc.passwordHash.startsWith("$2") &&
      !userDoc.passwordHash.includes("secret123") &&
      !!userDoc.createdAt,
    JSON.stringify({ ...userDoc, passwordHash: userDoc?.passwordHash?.slice(0, 7) })
  );
  const walletDoc = await db.collection("wallets").findOne({ userId: userDoc._id });
  check(
    "wallet references the user's _id and balance is 0 paise",
    !!walletDoc && String(walletDoc.userId) === String(userDoc._id) && walletDoc.balance === 0,
    JSON.stringify(walletDoc)
  );
  const userIndexes = await db.collection("users").indexes();
  const walletIndexes = await db.collection("wallets").indexes();
  check(
    "DB-level unique indexes on users.username and wallets.userId",
    userIndexes.some((i) => i.key.username === 1 && i.unique) &&
      walletIndexes.some((i) => i.key.userId === 1 && i.unique),
    JSON.stringify({ userIndexes, walletIndexes })
  );

  // --- 3. Auth matrix on GET /api/v1/user/me ------------------------------

  const noToken = await get("/api/v1/user/me");
  check(
    "/me without token -> 401 Unauthorized",
    noToken.status === 401 && noToken.json?.error === "Unauthorized",
    JSON.stringify(noToken)
  );

  const garbage = await get("/api/v1/user/me", "not.a.jwt");
  check(
    "/me garbage token -> 401",
    garbage.status === 401 && garbage.json?.error === "Unauthorized",
    JSON.stringify(garbage)
  );

  const expired = jwt.sign({ userId: rajuId }, JWT_SECRET, { expiresIn: "-10s" });
  const expiredRes = await get("/api/v1/user/me", expired);
  check(
    "/me expired token -> 401",
    expiredRes.status === 401 && expiredRes.json?.error === "Unauthorized",
    JSON.stringify(expiredRes)
  );

  // Tamper: swap the payload but keep the original signature.
  const parts = rajuToken.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({ userId: sitaId })).toString("base64url");
  const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
  const tamperedRes = await get("/api/v1/user/me", tampered);
  check(
    "/me tampered signature -> 401",
    tamperedRes.status === 401 && tamperedRes.json?.error === "Unauthorized",
    JSON.stringify(tamperedRes)
  );

  const wrongSecret = jwt.sign({ userId: rajuId }, "some-other-secret", { expiresIn: "1h" });
  const wrongSecretRes = await get("/api/v1/user/me", wrongSecret);
  check(
    "/me token signed with wrong secret -> 401",
    wrongSecretRes.status === 401,
    JSON.stringify(wrongSecretRes)
  );

  const notBare = await fetch(`${BASE}/api/v1/user/me`, {
    headers: { Authorization: rajuToken },
  });
  check("/me missing 'Bearer ' scheme -> 401", notBare.status === 401, String(notBare.status));

  const me = await get("/api/v1/user/me", rajuToken);
  check(
    "/me valid token -> 200 with own profile, no hash",
    me.status === 200 &&
      me.json?.user?._id === rajuId &&
      me.json?.user?.username === "raju@gmail.com" &&
      noHashLeaks(me.json),
    JSON.stringify(me)
  );

  const sitaToken = await signinToken("sita@gmail.com", "secret456");
  const meSita = await get("/api/v1/user/me", sitaToken);
  check(
    "/me identity comes from JWT (sita sees sita)",
    meSita.status === 200 &&
      meSita.json?.user?._id === sitaId &&
      meSita.json?.user?.username === "sita@gmail.com",
    JSON.stringify(meSita)
  );

  const ghostToken = jwt.sign({ userId: "000000000000000000000000" }, JWT_SECRET, { expiresIn: "1h" });
  const ghost = await get("/api/v1/user/me", ghostToken);
  check("/me valid token but user missing -> 404", ghost.status === 404, JSON.stringify(ghost));

  const badOidToken = jwt.sign({ userId: "not-an-objectid" }, JWT_SECRET, { expiresIn: "1h" });
  const badOid = await get("/api/v1/user/me", badOidToken);
  check(
    "/me invalid ObjectId in token -> 401, server survives",
    badOid.status === 401,
    JSON.stringify(badOid)
  );
  const stillUp = await get("/");
  check("server alive after invalid ObjectId", stillUp.status === 200, JSON.stringify(stillUp));

  // --- 4. GET /api/v1/wallet/balance --------------------------------------

  const balNoToken = await get("/api/v1/wallet/balance");
  check(
    "/wallet/balance without token -> 401",
    balNoToken.status === 401 && balNoToken.json?.error === "Unauthorized",
    JSON.stringify(balNoToken)
  );

  const bal0 = await get("/api/v1/wallet/balance", rajuToken);
  check(
    "/wallet/balance -> { balance: 0, display: '₹0.00' }",
    bal0.status === 200 && bal0.json?.balance === 0 && bal0.json?.display === "₹0.00",
    JSON.stringify(bal0)
  );

  // Give sita 10000 paise, then make sure raju cannot read it - even when
  // explicitly asking for sita's wallet via query param.
  await db.collection("wallets").updateOne(
    { userId: userDocSita._id },
    { $set: { balance: 10000 } }
  );
  const cross1 = await get(`/api/v1/wallet/balance?userId=${sitaId}`, rajuToken);
  check(
    "balance ignores client-supplied userId query param",
    cross1.status === 200 && cross1.json?.balance === 0,
    JSON.stringify(cross1)
  );
  const sitaSeesOwn = await get("/api/v1/wallet/balance", sitaToken);
  check(
    "sita's own token reads sita's 10000 paise",
    sitaSeesOwn.status === 200 &&
      sitaSeesOwn.json?.balance === 10000 &&
      sitaSeesOwn.json?.display === "₹100.00",
    JSON.stringify(sitaSeesOwn)
  );

  await db.collection("wallets").updateOne(
    { userId: userDoc._id },
    { $set: { balance: 1250 } }
  );
  const bal1250 = await get("/api/v1/wallet/balance", rajuToken);
  check(
    "/wallet/balance 1250 paise -> display ₹12.50",
    bal1250.status === 200 &&
      bal1250.json?.balance === 1250 &&
      bal1250.json?.display === "₹12.50",
    JSON.stringify(bal1250)
  );
  await db.collection("wallets").updateOne(
    { userId: userDoc._id },
    { $set: { balance: 0 } }
  );

  // User without a wallet -> 404, and the endpoint must not create one.
  await db.collection("wallets").deleteOne({ userId: userDocSita._id });
  const noWallet = await get("/api/v1/wallet/balance", sitaToken);
  check(
    "/wallet/balance without wallet -> 404 and no wallet auto-created",
    noWallet.status === 404 &&
      (await db.collection("wallets").countDocuments({ userId: userDocSita._id })) === 0,
    JSON.stringify(noWallet)
  );
  // Restore sita's wallet so later counts are predictable.
  await db.collection("wallets").insertOne({
    userId: userDocSita._id,
    balance: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // --- 5. Duplicate race: E11000 handled as 409 (never 500) ---------------

  const raceResults = await Promise.all(
    [1, 2, 3].map(() =>
      post("/api/v1/user/signup", {
        username: `race${unique}@gmail.com`,
        firstName: "Race",
        lastName: "Test",
        password: "secret123",
      })
    )
  );
  const statuses = raceResults.map((r) => r.status);
  check(
    "parallel duplicate signups -> one 201, rest 409, never 500",
    statuses.filter((s) => s === 201).length === 1 &&
      statuses.every((s) => s === 201 || s === 409),
    JSON.stringify(statuses)
  );
  check(
    "race losers get the friendly 409 message",
    raceResults
      .filter((r) => r.status === 409)
      .every((r) => r.json?.error === "This email is already registered"),
    JSON.stringify(raceResults)
  );

  // --- 5b. Optional Day 2 endpoints: PUT /user + GET /user/bulk ----------

  const putJson = (pathname, body, token) =>
    fetch(BASE + pathname, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).then(async (res) => {
      let json = null;
      try {
        json = await res.json();
      } catch {
        // non-JSON body
      }
      return { status: res.status, json };
    });

  const updName = await putJson("/api/v1/user", { lastName: "Patil" }, sitaToken);
  check(
    "PUT /user updates lastName -> 200, username untouched",
    updName.status === 200 &&
      updName.json?.user?.lastName === "Patil" &&
      updName.json?.user?.username === "sita@gmail.com" &&
      updName.json?.user?._id === sitaId &&
      noHashLeaks(updName.json),
    JSON.stringify(updName)
  );

  const updUsername = await putJson(
    "/api/v1/user",
    { username: "attacker@example.com" },
    sitaToken
  );
  check(
    "PUT /user rejects username field (strict schema) -> 400",
    updUsername.status === 400 && updUsername.json?.error === "Invalid input",
    JSON.stringify(updUsername)
  );

  const updEmpty = await putJson("/api/v1/user", {}, sitaToken);
  check(
    "PUT /user with no fields -> 400",
    updEmpty.status === 400,
    JSON.stringify(updEmpty)
  );

  const updShort = await putJson("/api/v1/user", { password: "abc" }, sitaToken);
  check(
    "PUT /user short new password -> 400",
    updShort.status === 400,
    JSON.stringify(updShort)
  );

  const updPw = await putJson("/api/v1/user", { password: "newpass99" }, sitaToken);
  check(
    "PUT /user changes password -> 200 without leaking hash",
    updPw.status === 200 && noHashLeaks(updPw.json),
    JSON.stringify(updPw)
  );
  const oldPwSignin = await post("/api/v1/user/signin", {
    username: "sita@gmail.com",
    password: "secret456",
  });
  const newPwSignin = await post("/api/v1/user/signin", {
    username: "sita@gmail.com",
    password: "newpass99",
  });
  check(
    "old password stops working, new password signs in",
    oldPwSignin.status === 401 && newPwSignin.status === 200,
    JSON.stringify({ oldPwSignin, newPwSignin })
  );

  const bulkNoToken = await get("/api/v1/user/bulk?filter=ra");
  check("GET /user/bulk without token -> 401", bulkNoToken.status === 401, JSON.stringify(bulkNoToken));

  const bulk = await get("/api/v1/user/bulk?filter=ra", rajuToken);
  const bulkNames = (bulk.json?.users ?? []).map((u) => u.firstName);
  check(
    "GET /user/bulk?filter=ra matches Raju + Race case-insensitively, no hashes",
    bulk.status === 200 &&
      bulkNames.includes("Raju") &&
      bulkNames.includes("Race") &&
      bulkNames.length === 2 &&
      noHashLeaks(bulk.json),
    JSON.stringify(bulk)
  );

  const bulkUpper = await get("/api/v1/user/bulk?filter=RAJ", rajuToken);
  check(
    "GET /user/bulk filter is case-insensitive (RAJ matches Raju)",
    bulkUpper.status === 200 &&
      (bulkUpper.json?.users ?? []).some((u) => u.firstName === "Raju"),
    JSON.stringify(bulkUpper)
  );

  const bulkRegex = await get("/api/v1/user/bulk?filter=ra(", rajuToken);
  check(
    "GET /user/bulk with regex special chars does not crash -> 200",
    bulkRegex.status === 200 && Array.isArray(bulkRegex.json?.users),
    JSON.stringify(bulkRegex)
  );

  const bulkNoFilter = await get("/api/v1/user/bulk", rajuToken);
  check(
    "GET /user/bulk without filter -> 400",
    bulkNoFilter.status === 400,
    JSON.stringify(bulkNoFilter)
  );

  // --- 6. Persistence across restart (PRD section 38) ---------------------

  await stopServer(server);
  const down = await waitForHealth(2000);
  check("server actually stopped", down === false, "still responding");

  server = spawnServer({ MONGO_URL: mongoUri, PORT: String(PORT) });
  up = await waitForHealth();
  check("server restarted with same MongoDB", up, server.getOutput());

  const afterRestart = await post("/api/v1/user/signin", {
    username: "raju@gmail.com",
    password: "secret123",
  });
  check(
    "signin AFTER restart -> 200 (data persisted in MongoDB)",
    afterRestart.status === 200 && !!afterRestart.json?.token,
    JSON.stringify(afterRestart)
  );
  rajuToken = afterRestart.json?.token || rajuToken;
  const meAfter = await get("/api/v1/user/me", rajuToken);
  check(
    "/me AFTER restart -> 200 same user",
    meAfter.status === 200 && meAfter.json?.user?._id === rajuId,
    JSON.stringify(meAfter)
  );
  const balAfter = await get("/api/v1/wallet/balance", rajuToken);
  check(
    "wallet balance AFTER restart -> 200 (balance survived)",
    balAfter.status === 200 && balAfter.json?.balance === 0,
    JSON.stringify(balAfter)
  );
  const dbCounts = {
    users: await db.collection("users").countDocuments(),
    wallets: await db.collection("wallets").countDocuments(),
  };
  // raju + sita + 1 race winner = 3 users, 3 wallets.
  check(
    "user and wallet counts preserved across restart",
    dbCounts.users === 3 && dbCounts.wallets === 3,
    JSON.stringify(dbCounts)
  );

  await stopServer(server);

  // --- 7. Startup failure paths (PRD section 41) --------------------------

  // Missing MONGO_URL: .env has an empty value and no env override is given.
  const envWithoutMongo = { ...process.env, MONGO_URL: "" };
  const missingVar = spawnCaptured(envWithoutMongo);
  const missingCode = await missingVar.exited;
  check(
    "missing MONGO_URL -> exits non-zero with clear message, server never starts",
    missingCode !== 0 &&
      missingVar.getOutput().includes("Missing required environment variable: MONGO_URL") &&
      !missingVar.getOutput().includes("Server running"),
    `code=${missingCode} out=${missingVar.getOutput()}`
  );

  // Missing JWT_SECRET (empty value): must fail, not fall back to a default.
  const missingSecret = spawnCaptured({ ...process.env, MONGO_URL: mongoUri, JWT_SECRET: "" });
  const secretCode = await missingSecret.exited;
  check(
    "missing JWT_SECRET -> exits non-zero, no hard-coded fallback",
    secretCode !== 0 &&
      missingSecret.getOutput().includes("Missing required environment variable: JWT_SECRET"),
    `code=${secretCode} out=${missingSecret.getOutput()}`
  );

  // Unreachable database: fails during connect, never reaches listen.
  const badDb = spawnCaptured({ ...process.env, MONGO_URL: "mongodb://127.0.0.1:9/kaasupay", PORT: String(PORT) });
  const badCode = await badDb.exited;
  check(
    "unreachable MongoDB -> clear error, non-zero exit, never listens",
    badCode !== 0 &&
      badDb.getOutput().includes("MongoDB connection failed") &&
      !badDb.getOutput().includes("Server running"),
    `code=${badCode} out=${badDb.getOutput()}`
  );
  check(
    "startup output never contains JWT_SECRET",
    !badDb.getOutput().includes(JWT_SECRET),
    "JWT_SECRET appeared in output"
  );
} finally {
  await cleanup();
}

console.log(failures === 0 ? "ALL_TESTS_PASSED" : `${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
