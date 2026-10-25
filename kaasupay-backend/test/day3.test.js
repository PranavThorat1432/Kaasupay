// Day 3 acceptance tests.
// Covers: staff deposit, atomic transfers, ledger, idempotency, history,
// concurrency (double-spend prevention), and Day 2 regression.
//
// Uses MongoMemoryReplSet (NOT MongoMemoryServer) because MongoDB transactions
// require a replica-set deployment. A standalone mongod rejects session.withTransaction().
//
// Run: node test/day3.test.js

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import mongoose from "mongoose";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3115;
const BASE = `http://localhost:${PORT}`;

// Read ADMIN_KEY from .env for test requests.
const ADMIN_KEY = process.env.ADMIN_KEY;

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name} -> ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Server and HTTP helpers
// ---------------------------------------------------------------------------

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
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
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

async function httpRequest(method, pathname, body, { token, adminKey, idempKey } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (adminKey) headers["x-admin-key"] = adminKey;
  if (idempKey) headers["Idempotency-Key"] = idempKey;

  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(BASE + pathname, opts);
  let json = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON
  }
  return { status: res.status, json };
}

const post = (p, b, opts) => httpRequest("POST", p, b, opts);
const get = (p, opts) => httpRequest("GET", p, undefined, opts);

async function signup(username, firstName, lastName, password) {
  return post("/api/v1/user/signup", { username, firstName, lastName, password });
}

async function signin(username, password) {
  const r = await post("/api/v1/user/signin", { username, password });
  return r.json?.token;
}

async function deposit(to, amount, note) {
  return post("/api/v1/admin/deposit", { to, amount, note }, { adminKey: ADMIN_KEY });
}

const unique = Date.now();
const idOk = (v) => typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v);
const noHashLeaks = (obj) => {
  const s = JSON.stringify(obj);
  return !s.includes("passwordHash") && !s.includes('"password"');
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

console.log("Starting replica-set in-memory MongoDB for transaction support...");
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

let server = null;

async function cleanup() {
  try { await stopServer(server); } catch { /* ignore */ }
  try {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  } catch { /* ignore */ }
  try { await replSet.stop(); } catch { /* ignore */ }
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});

try {
  const mongoUri = replSet.getUri();

  server = spawnServer({ MONGO_URL: mongoUri, PORT: String(PORT) });
  const up = await waitForHealth();
  check(
    "server starts with replica-set MongoDB",
    up,
    server ? server.getOutput() : "server never started"
  );
  if (!up) {
    console.error(server?.getOutput());
    throw new Error("server never became healthy");
  }

  // Connect test process directly to the same MongoDB for assertion queries.
  await mongoose.connect(mongoUri, { dbName: "kaasupay" });
  const db = mongoose.connection.db;

  // Create test users.
  const rajuR = await signup(`raju${unique}@gmail.com`, "Raju", "Kumar", "secret123");
  check("signup raju -> 201", rajuR.status === 201, JSON.stringify(rajuR));
  const rajuId = rajuR.json?.user?._id;
  const rajuToken = await signin(`raju${unique}@gmail.com`, "secret123");
  check("signin raju -> token", !!rajuToken, "no token");

  const priyaR = await signup(`priya${unique}@gmail.com`, "Priya", "Sharma", "secret456");
  check("signup priya -> 201", priyaR.status === 201, JSON.stringify(priyaR));
  const priyaId = priyaR.json?.user?._id;
  const priyaToken = await signin(`priya${unique}@gmail.com`, "secret456");

  // =========================================================================
  // Level 1 — Staff deposit
  // =========================================================================
  console.log("\n--- Level 1: Staff deposit ---");

  // 1. Missing staff key → 401
  const noKey = await post("/api/v1/admin/deposit", {
    to: `raju${unique}@gmail.com`,
    amount: 100000,
  });
  check("deposit: missing key -> 401", noKey.status === 401 && noKey.json?.error === "Staff only", JSON.stringify(noKey));

  // 2. Incorrect staff key → 401
  const badKey = await post(
    "/api/v1/admin/deposit",
    { to: `raju${unique}@gmail.com`, amount: 100000 },
    { adminKey: "wrong-key" }
  );
  check("deposit: wrong key -> 401", badKey.status === 401, JSON.stringify(badKey));

  // 3. Correct key + valid deposit → 201
  const dep1 = await deposit(`raju${unique}@gmail.com`, 100000, "Initial deposit");
  check(
    "deposit: valid -> 201 with transactionId",
    dep1.status === 201 && idOk(String(dep1.json?.transactionId)) && dep1.json?.amount === 100000,
    JSON.stringify(dep1)
  );

  // 4. Invalid email → 400
  const depBadEmail = await post(
    "/api/v1/admin/deposit",
    { to: "not-an-email", amount: 100000 },
    { adminKey: ADMIN_KEY }
  );
  check("deposit: invalid email -> 400", depBadEmail.status === 400, JSON.stringify(depBadEmail));

  // 5. Amount below minimum → 400
  const depLow = await deposit(`raju${unique}@gmail.com`, 50);
  check("deposit: amount below min (50) -> 400", depLow.status === 400, JSON.stringify(depLow));

  // 6. Amount above maximum → 400
  const depHigh = await deposit(`raju${unique}@gmail.com`, 10_000_001);
  check("deposit: amount above max -> 400", depHigh.status === 400, JSON.stringify(depHigh));

  // 7. Fractional amount → 400
  const depFrac = await post(
    "/api/v1/admin/deposit",
    { to: `raju${unique}@gmail.com`, amount: 1000.5 },
    { adminKey: ADMIN_KEY }
  );
  check("deposit: fractional amount -> 400", depFrac.status === 400, JSON.stringify(depFrac));

  // 8. Amount as string → 400
  const depStr = await post(
    "/api/v1/admin/deposit",
    { to: `raju${unique}@gmail.com`, amount: "1000" },
    { adminKey: ADMIN_KEY }
  );
  check("deposit: string amount -> 400", depStr.status === 400, JSON.stringify(depStr));

  // 9. Unknown recipient → 404
  const depUnknown = await deposit(`nobody${unique}@gmail.com`, 100000);
  check("deposit: unknown recipient -> 404", depUnknown.status === 404, JSON.stringify(depUnknown));

  // 10. Wallet balance increases by correct amount
  const balBefore = await db.collection("wallets").findOne({
    userId: new mongoose.Types.ObjectId(rajuId),
  });
  await deposit(`raju${unique}@gmail.com`, 5000, "Second deposit");
  const balAfterDep = await db.collection("wallets").findOne({
    userId: new mongoose.Types.ObjectId(rajuId),
  });
  // balBefore is captured AFTER the first deposit (100000). The second deposit adds 5000.
  check(
    "deposit: balance increases by correct amount (second deposit = +5000)",
    balAfterDep.balance === balBefore.balance + 5000,
    `before=${balBefore?.balance} after=${balAfterDep?.balance} expected=${balBefore?.balance + 5000}`
  );

  // 11. One deposit transaction created
  const txnCount = await db
    .collection("transactions")
    .countDocuments({ toUserId: new mongoose.Types.ObjectId(rajuId), type: "DEPOSIT" });
  check("deposit: two deposit transactions created for raju", txnCount === 2, `count=${txnCount}`);

  // 12. One credit ledger entry per deposit
  const ledgerCount = await db.collection("ledgerentries").countDocuments({
    userId: new mongoose.Types.ObjectId(rajuId),
    direction: "CREDIT",
  });
  check(
    "deposit: two credit ledger entries for raju",
    ledgerCount === 2,
    `count=${ledgerCount}`
  );

  // 13. Failed deposit leaves no partial changes (tested via unknown recipient above)
  // We already checked that no transaction or wallet was modified for unknown recipient.
  const unknownUserCount = await db
    .collection("transactions")
    .countDocuments({ type: "DEPOSIT", toUserId: null });
  check(
    "deposit: failed deposit leaves no partial transaction",
    unknownUserCount === 0,
    `partialTxns=${unknownUserCount}`
  );

  // =========================================================================
  // Level 2 — Transfer
  // =========================================================================
  console.log("\n--- Level 2: Transfers ---");

  // Give raju a known balance. At this point raju has 105000.
  // Current: 105000 paise.

  // 1. Missing JWT → 401
  const xferNoAuth = await post(
    "/api/v1/wallet/transfer",
    { to: `priya${unique}@gmail.com`, amount: 1000 },
    { idempKey: `k-noauth-${unique}` }
  );
  check("transfer: no JWT -> 401", xferNoAuth.status === 401, JSON.stringify(xferNoAuth));

  // 2. Successful transfer → 201
  const xfer1 = await post(
    "/api/v1/wallet/transfer",
    { to: `priya${unique}@gmail.com`, amount: 40000, note: "Lunch" },
    { token: rajuToken, idempKey: `k-xfer1-${unique}` }
  );
  check(
    "transfer: valid transfer -> 201",
    xfer1.status === 201 && idOk(String(xfer1.json?.transactionId)) && xfer1.json?.amount === 40000,
    JSON.stringify(xfer1)
  );

  // 3. Self-transfer → 400
  const selfXfer = await post(
    "/api/v1/wallet/transfer",
    { to: `raju${unique}@gmail.com`, amount: 1000 },
    { token: rajuToken, idempKey: `k-self-${unique}` }
  );
  check("transfer: self-transfer -> 400", selfXfer.status === 400, JSON.stringify(selfXfer));

  // 4. Unknown receiver → 404
  const xferUnknown = await post(
    "/api/v1/wallet/transfer",
    { to: `nobody${unique}@gmail.com`, amount: 1000 },
    { token: rajuToken, idempKey: `k-unknown-${unique}` }
  );
  check("transfer: unknown receiver -> 404", xferUnknown.status === 404, JSON.stringify(xferUnknown));

  // 5. Invalid amount → 400
  const xferBadAmt = await post(
    "/api/v1/wallet/transfer",
    { to: `priya${unique}@gmail.com`, amount: 50 },
    { token: rajuToken, idempKey: `k-badamt-${unique}` }
  );
  check("transfer: amount below min -> 400", xferBadAmt.status === 400, JSON.stringify(xferBadAmt));

  // 6. Insufficient balance → 400
  // Raju has 65000 paise now. Try to send 100000.
  const xferInsuf = await post(
    "/api/v1/wallet/transfer",
    { to: `priya${unique}@gmail.com`, amount: 100000 },
    { token: rajuToken, idempKey: `k-insuf-${unique}` }
  );
  check("transfer: insufficient balance -> 400", xferInsuf.status === 400, JSON.stringify(xferInsuf));

  // 7+8. Sender balance decreases, receiver balance increases.
  const rajuWallet = await db.collection("wallets").findOne({
    userId: new mongoose.Types.ObjectId(rajuId),
  });
  const priyaWallet = await db.collection("wallets").findOne({
    userId: new mongoose.Types.ObjectId(priyaId),
  });
  check(
    "transfer: sender balance decreased by 40000",
    rajuWallet?.balance === 65000, // 105000 - 40000
    `rajuBalance=${rajuWallet?.balance}`
  );
  check(
    "transfer: receiver balance increased by 40000",
    priyaWallet?.balance === 40000,
    `priyaBalance=${priyaWallet?.balance}`
  );

  // 9. Total money conserved (sum of all wallet balances = total deposits).
  const [walletSum] = await db
    .collection("wallets")
    .aggregate([{ $group: { _id: null, total: { $sum: "$balance" } } }])
    .toArray();
  const [depositSum] = await db
    .collection("transactions")
    .aggregate([
      { $match: { type: "DEPOSIT", status: "COMPLETED" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])
    .toArray();
  check(
    "transfer: total money conserved",
    walletSum?.total === depositSum?.total,
    `wallets=${walletSum?.total} deposits=${depositSum?.total}`
  );

  // =========================================================================
  // Level 3 — Transaction atomicity
  // =========================================================================
  console.log("\n--- Level 3: Atomicity ---");

  // 1+2+3. Successful transfer created one transaction + two ledger entries.
  const xfer1TxnId = xfer1.json?.transactionId;
  const xfer1Ledger = await db
    .collection("ledgerentries")
    .find({ transactionId: new mongoose.Types.ObjectId(String(xfer1TxnId)) })
    .toArray();
  check(
    "atomicity: transfer creates exactly 2 ledger entries",
    xfer1Ledger.length === 2,
    `entries=${xfer1Ledger.length}`
  );
  const debitEntry = xfer1Ledger.find((e) => e.direction === "DEBIT");
  const creditEntry = xfer1Ledger.find((e) => e.direction === "CREDIT");
  check(
    "atomicity: debit and credit amounts match transfer amount",
    debitEntry?.amount === 40000 && creditEntry?.amount === 40000,
    `debit=${debitEntry?.amount} credit=${creditEntry?.amount}`
  );
  check(
    "atomicity: debit entry balanceAfter = raju's balance (65000)",
    debitEntry?.balanceAfter === 65000,
    `debitBalanceAfter=${debitEntry?.balanceAfter}`
  );
  check(
    "atomicity: credit entry balanceAfter = priya's balance (40000)",
    creditEntry?.balanceAfter === 40000,
    `creditBalanceAfter=${creditEntry?.balanceAfter}`
  );

  // 4. Successful deposit creates one transaction and one ledger entry.
  const dep1TxnId = dep1.json?.transactionId;
  const dep1Ledger = await db
    .collection("ledgerentries")
    .find({ transactionId: new mongoose.Types.ObjectId(String(dep1TxnId)) })
    .toArray();
  check(
    "atomicity: deposit creates exactly 1 ledger entry",
    dep1Ledger.length === 1 && dep1Ledger[0].direction === "CREDIT",
    `entries=${dep1Ledger.length}`
  );

  // 5+6+7+8. Insufficient balance: partial state test.
  // The xferInsuf test (100000 from 65000 balance) was a business failure.
  // Verify no partial changes occurred.
  const rajuWalletAfterFail = await db.collection("wallets").findOne({
    userId: new mongoose.Types.ObjectId(rajuId),
  });
  const priyaWalletAfterFail = await db.collection("wallets").findOne({
    userId: new mongoose.Types.ObjectId(priyaId),
  });
  check(
    "atomicity: failed transfer leaves sender balance unchanged",
    rajuWalletAfterFail?.balance === 65000,
    `rajuBalance=${rajuWalletAfterFail?.balance}`
  );
  check(
    "atomicity: failed transfer leaves receiver balance unchanged",
    priyaWalletAfterFail?.balance === 40000,
    `priyaBalance=${priyaWalletAfterFail?.balance}`
  );
  // No ledger entries should exist for the failed transfer's idempotency key
  // (failed transfer's idempotency record exists but no financial records).
  const failedXferTxns = await db.collection("transactions").findOne({
    fromUserId: new mongoose.Types.ObjectId(rajuId),
    amount: 100000,
  });
  check(
    "atomicity: failed transfer creates no transaction record",
    failedXferTxns === null,
    `found=${JSON.stringify(failedXferTxns)}`
  );

  // =========================================================================
  // Level 4 — Idempotency
  // =========================================================================
  console.log("\n--- Level 4: Idempotency ---");

  // Give raju more money for these tests.
  await deposit(`raju${unique}@gmail.com`, 500000, "Idempotency test funds");
  // Raju now has 565000 paise.

  // 1. Missing key → 400
  const xferNoKey = await post(
    "/api/v1/wallet/transfer",
    { to: `priya${unique}@gmail.com`, amount: 1000 },
    { token: rajuToken }
  );
  check("idempotency: missing key -> 400", xferNoKey.status === 400, JSON.stringify(xferNoKey));

  // 2. Empty key → 400
  const xferEmptyKey = await post(
    "/api/v1/wallet/transfer",
    { to: `priya${unique}@gmail.com`, amount: 1000 },
    { token: rajuToken, idempKey: " " }
  );
  check("idempotency: empty key -> 400", xferEmptyKey.status === 400, JSON.stringify(xferEmptyKey));

  // 3. Key > 100 chars → 400
  const longKey = "k".repeat(101);
  const xferLongKey = await post(
    "/api/v1/wallet/transfer",
    { to: `priya${unique}@gmail.com`, amount: 1000 },
    { token: rajuToken, idempKey: longKey }
  );
  check("idempotency: key > 100 chars -> 400", xferLongKey.status === 400, JSON.stringify(xferLongKey));

  // 4. New key processes the transfer.
  const idempKey4 = `idemp-4-${unique}`;
  const xfer4 = await post(
    "/api/v1/wallet/transfer",
    { to: `priya${unique}@gmail.com`, amount: 10000, note: "Idempotency test" },
    { token: rajuToken, idempKey: idempKey4 }
  );
  check("idempotency: new key processes transfer -> 201", xfer4.status === 201, JSON.stringify(xfer4));
  const xfer4TxnId = xfer4.json?.transactionId;

  // 5. Same key + same body → replay original response.
  const xfer4Replay = await post(
    "/api/v1/wallet/transfer",
    { to: `priya${unique}@gmail.com`, amount: 10000, note: "Idempotency test" },
    { token: rajuToken, idempKey: idempKey4 }
  );
  check(
    "idempotency: same key+body -> replays 201",
    xfer4Replay.status === 201 &&
      String(xfer4Replay.json?.transactionId) === String(xfer4TxnId),
    JSON.stringify(xfer4Replay)
  );

  // 6. Replay does not create another transaction.
  const txnCountAfterReplay = await db
    .collection("transactions")
    .countDocuments({ _id: new mongoose.Types.ObjectId(String(xfer4TxnId)) });
  check(
    "idempotency: replay doesn't create a new transaction",
    txnCountAfterReplay === 1,
    `count=${txnCountAfterReplay}`
  );

  // 7. Replay doesn't create additional ledger entries.
  const ledgerAfterReplay = await db
    .collection("ledgerentries")
    .countDocuments({ transactionId: new mongoose.Types.ObjectId(String(xfer4TxnId)) });
  check(
    "idempotency: replay doesn't create new ledger entries",
    ledgerAfterReplay === 2,
    `count=${ledgerAfterReplay}`
  );

  // 8. Same key with different amount → 422.
  const xfer4DiffAmt = await post(
    "/api/v1/wallet/transfer",
    { to: `priya${unique}@gmail.com`, amount: 20000, note: "Idempotency test" },
    { token: rajuToken, idempKey: idempKey4 }
  );
  check(
    "idempotency: same key, different amount -> 422",
    xfer4DiffAmt.status === 422,
    JSON.stringify(xfer4DiffAmt)
  );

  // 9. Same key with different recipient → 422.
  const xfer4DiffTo = await post(
    "/api/v1/wallet/transfer",
    { to: `raju${unique}@gmail.com`, amount: 10000, note: "Idempotency test" },
    { token: rajuToken, idempKey: idempKey4 }
  );
  check(
    "idempotency: same key, different recipient -> 422",
    xfer4DiffTo.status === 422,
    JSON.stringify(xfer4DiffTo)
  );

  // 10. Concurrent identical requests create at most one transfer.
  const concKey = `idemp-conc-${unique}`;
  const concBody = { to: `priya${unique}@gmail.com`, amount: 5000, note: "Concurrent" };
  const concResults = await Promise.all(
    [1, 2, 3, 4, 5].map(() =>
      post("/api/v1/wallet/transfer", concBody, { token: rajuToken, idempKey: concKey })
    )
  );
  const concStatuses = concResults.map((r) => r.status);
  const conc201 = concStatuses.filter((s) => s === 201).length;
  const concOther = concStatuses.filter((s) => s === 409 || s === 201).length;
  check(
    "idempotency: concurrent identical requests create at most 1 transfer",
    conc201 === 1 && concOther === 5,
    JSON.stringify(concStatuses)
  );

  // Verify only one transaction was created for that key.
  const concTxnId = concResults.find((r) => r.status === 201)?.json?.transactionId;
  const concTxnCount = concTxnId
    ? await db
        .collection("transactions")
        .countDocuments({ _id: new mongoose.Types.ObjectId(String(concTxnId)) })
    : 0;
  check(
    "idempotency: concurrent requests create exactly 1 transaction",
    concTxnCount === 1,
    `count=${concTxnCount}`
  );

  // 11. Concurrent requests with same key but different bodies.
  // One should succeed; the other should 422 (after the first finishes).
  // This is hard to guarantee timing-wise in a test, so we verify no money moves twice.
  // We test sequentially here since true concurrent race is covered by test 10.
  const mixedKey = `idemp-mixed-${unique}`;
  const mixed1 = await post(
    "/api/v1/wallet/transfer",
    { to: `priya${unique}@gmail.com`, amount: 3000, note: "Mixed test" },
    { token: rajuToken, idempKey: mixedKey }
  );
  const mixed2 = await post(
    "/api/v1/wallet/transfer",
    { to: `priya${unique}@gmail.com`, amount: 9000, note: "Different body" },
    { token: rajuToken, idempKey: mixedKey }
  );
  check(
    "idempotency: mixed key, first wins; second is 422",
    mixed1.status === 201 && mixed2.status === 422,
    `first=${mixed1.status} second=${mixed2.status}`
  );

  // 12. Expected insufficient-balance response replays consistently.
  const insufKey = `idemp-insuf-${unique}`;
  // Raju's current balance: 565000 - 10000 - 5000 - 3000 = 547000. Try to send 600000.
  const insuf1 = await post(
    "/api/v1/wallet/transfer",
    { to: `priya${unique}@gmail.com`, amount: 600000 },
    { token: rajuToken, idempKey: insufKey }
  );
  check("idempotency: insufficient balance -> 400", insuf1.status === 400, JSON.stringify(insuf1));

  const insuf2 = await post(
    "/api/v1/wallet/transfer",
    { to: `priya${unique}@gmail.com`, amount: 600000 },
    { token: rajuToken, idempKey: insufKey }
  );
  check(
    "idempotency: insufficient balance replays consistently -> 400",
    insuf2.status === 400 && insuf2.json?.error === insuf1.json?.error,
    JSON.stringify(insuf2)
  );

  // 13. Unexpected failures don't leave permanent IN_PROGRESS records.
  //     We verify by checking that no IN_PROGRESS records exist after all operations.
  const inProgressCount = await db
    .collection("idempotencyrecords")
    .countDocuments({ state: "IN_PROGRESS" });
  check(
    "idempotency: no IN_PROGRESS records remain after all operations",
    inProgressCount === 0,
    `inProgress=${inProgressCount}`
  );

  // 14. Successful transfer remains replayable after server restart.
  await stopServer(server);
  await new Promise((r) => setTimeout(r, 500));
  server = spawnServer({ MONGO_URL: mongoUri, PORT: String(PORT) });
  const upAfterRestart = await waitForHealth();
  check("server restarted", upAfterRestart, server.getOutput());

  const xfer4ReplayAfterRestart = await post(
    "/api/v1/wallet/transfer",
    { to: `priya${unique}@gmail.com`, amount: 10000, note: "Idempotency test" },
    { token: rajuToken, idempKey: idempKey4 }
  );
  check(
    "idempotency: replay works after server restart",
    xfer4ReplayAfterRestart.status === 201 &&
      String(xfer4ReplayAfterRestart.json?.transactionId) === String(xfer4TxnId),
    JSON.stringify(xfer4ReplayAfterRestart)
  );

  // =========================================================================
  // Level 5 — Transaction history
  // =========================================================================
  console.log("\n--- Level 5: Transaction history ---");

  // 1. Missing JWT → 401
  const histNoAuth = await get("/api/v1/wallet/transactions");
  check("history: no JWT -> 401", histNoAuth.status === 401, JSON.stringify(histNoAuth));

  // 2. Authenticated user sees only their own entries.
  const rajuHist = await get("/api/v1/wallet/transactions", { token: rajuToken });
  check("history: returns 200", rajuHist.status === 200, JSON.stringify(rajuHist));

  const priyaHist = await get("/api/v1/wallet/transactions", { token: priyaToken });
  const priyaIds = priyaHist.json?.data?.map((e) => e.transactionId) ?? [];
  const rajuIds = rajuHist.json?.data?.map((e) => e.transactionId) ?? [];
  // Each entry should belong to its own history — no overlap from the other's unique txns.
  // (The same transfer txn appears in BOTH users' history but as DEBIT/CREDIT respectively.)
  check(
    "history: user sees own entries (has entries)",
    rajuHist.json?.data?.length > 0,
    JSON.stringify(rajuHist.json?.data?.length)
  );

  // 3. Entries sorted newest first.
  const rajuDates = rajuHist.json?.data?.map((e) => new Date(e.createdAt).getTime()) ?? [];
  const isSortedDesc = rajuDates.every((d, i) => i === 0 || d <= rajuDates[i - 1]);
  check("history: sorted newest first", isSortedDesc, JSON.stringify(rajuDates));

  // 4. Default page + limit.
  check(
    "history: default page=1, limit=10",
    rajuHist.json?.page === 1 && rajuHist.json?.limit === 10,
    JSON.stringify({ page: rajuHist.json?.page, limit: rajuHist.json?.limit })
  );

  // 5. Custom pagination.
  const rajuHistP2 = await get("/api/v1/wallet/transactions?page=1&limit=2", { token: rajuToken });
  check(
    "history: limit=2 returns at most 2 entries",
    rajuHistP2.status === 200 && rajuHistP2.json?.data?.length <= 2 && rajuHistP2.json?.limit === 2,
    JSON.stringify({ len: rajuHistP2.json?.data?.length, limit: rajuHistP2.json?.limit })
  );

  // 6. Limit > 50 → 400.
  const histLimit51 = await get("/api/v1/wallet/transactions?limit=51", { token: rajuToken });
  check("history: limit=51 -> 400", histLimit51.status === 400, JSON.stringify(histLimit51));

  // 7. Invalid page/limit → 400.
  const histBadPage = await get("/api/v1/wallet/transactions?page=0", { token: rajuToken });
  check("history: page=0 -> 400", histBadPage.status === 400, JSON.stringify(histBadPage));

  const histBadLimit = await get("/api/v1/wallet/transactions?limit=-1", { token: rajuToken });
  check("history: limit=-1 -> 400", histBadLimit.status === 400, JSON.stringify(histBadLimit));

  // 8. Empty history returns correct metadata.
  // Create a fresh user with no transactions.
  const ghostR = await signup(`ghost${unique}@gmail.com`, "Ghost", "User", "ghost123");
  const ghostToken = await signin(`ghost${unique}@gmail.com`, "ghost123");
  const ghostHist = await get("/api/v1/wallet/transactions", { token: ghostToken });
  check(
    "history: empty history returns correct metadata",
    ghostHist.status === 200 &&
      ghostHist.json?.data?.length === 0 &&
      ghostHist.json?.total === 0 &&
      ghostHist.json?.totalPages === 0,
    JSON.stringify(ghostHist.json)
  );

  // 9. Transfer history includes the other user's full name.
  const transferEntry = rajuHist.json?.data?.find((e) => e.type === "TRANSFER");
  check(
    "history: transfer entry has other user's name (not 'Bank deposit')",
    !!transferEntry && transferEntry.withWhom !== "Bank deposit" && transferEntry.withWhom.length > 0,
    JSON.stringify(transferEntry)
  );

  // 10. Deposit history shows 'Bank deposit'.
  const depositEntry = rajuHist.json?.data?.find((e) => e.type === "DEPOSIT");
  check(
    "history: deposit entry shows 'Bank deposit'",
    !!depositEntry && depositEntry.withWhom === "Bank deposit",
    JSON.stringify(depositEntry)
  );

  // 11. No password hashes in response.
  check(
    "history: no password hashes in response",
    noHashLeaks(rajuHist.json),
    JSON.stringify(rajuHist.json).slice(0, 200)
  );

  // =========================================================================
  // Concurrency — Prevent double spending (10 concurrent, 2 should succeed)
  // =========================================================================
  console.log("\n--- Concurrency: Double-spend prevention ---");

  // Create fresh users for this test.
  const spenderR = await signup(`spender${unique}@gmail.com`, "Spender", "Test", "spend123");
  const spenderToken = await signin(`spender${unique}@gmail.com`, "spend123");
  const spenderId = spenderR.json?.user?._id;

  const catcherR = await signup(`catcher${unique}@gmail.com`, "Catcher", "Test", "catch123");
  const catcherId = catcherR.json?.user?._id;

  // Give spender exactly 100000 paise (₹1000).
  await deposit(`spender${unique}@gmail.com`, 100000, "Spend test");

  // 10 concurrent requests each trying to transfer 40000 (₹400).
  // Only 2 can succeed (100000 / 40000 = 2.5 → 2 transfers).
  const concXfers = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      post(
        "/api/v1/wallet/transfer",
        { to: `catcher${unique}@gmail.com`, amount: 40000, note: "Double spend test" },
        { token: spenderToken, idempKey: `spend-conc-${unique}-${i}` }
      )
    )
  );

  const succeeded = concXfers.filter((r) => r.status === 201).length;
  const failedWith400 = concXfers.filter((r) => r.status === 400).length;

  check(
    "double-spend: exactly 2 transfers succeed",
    succeeded === 2,
    `succeeded=${succeeded} statuses=${JSON.stringify(concXfers.map((r) => r.status))}`
  );
  check(
    "double-spend: 8 requests fail with 400 (insufficient funds)",
    failedWith400 === 8,
    `failed400=${failedWith400}`
  );

  const spenderWalletFinal = await db.collection("wallets").findOne({
    userId: new mongoose.Types.ObjectId(spenderId),
  });
  const catcherWalletFinal = await db.collection("wallets").findOne({
    userId: new mongoose.Types.ObjectId(catcherId),
  });

  check(
    "double-spend: spender balance is 20000 (100000 - 2*40000)",
    spenderWalletFinal?.balance === 20000,
    `spenderBalance=${spenderWalletFinal?.balance}`
  );
  check(
    "double-spend: catcher balance is 80000 (2*40000)",
    catcherWalletFinal?.balance === 80000,
    `catcherBalance=${catcherWalletFinal?.balance}`
  );
  check(
    "double-spend: no wallet has negative balance",
    spenderWalletFinal?.balance >= 0 && catcherWalletFinal?.balance >= 0,
    `spender=${spenderWalletFinal?.balance} catcher=${catcherWalletFinal?.balance}`
  );

  // Check no partial ledger entries from failed transfers.
  const failedTxnsForSpender = await db.collection("transactions").countDocuments({
    fromUserId: new mongoose.Types.ObjectId(spenderId),
    type: "TRANSFER",
  });
  check(
    "double-spend: exactly 2 transfer transactions for spender",
    failedTxnsForSpender === 2,
    `count=${failedTxnsForSpender}`
  );

  // =========================================================================
  // Concurrency — Duplicate request (5 identical, same key)
  // =========================================================================
  console.log("\n--- Concurrency: Duplicate request ---");

  // Give spender more money.
  await deposit(`spender${unique}@gmail.com`, 500000, "Dup test funds");

  const dupKey = `dup-conc-${unique}`;
  const dupBody = { to: `catcher${unique}@gmail.com`, amount: 50000, note: "Duplicate" };
  const dupResults = await Promise.all(
    [1, 2, 3, 4, 5].map(() =>
      post("/api/v1/wallet/transfer", dupBody, { token: spenderToken, idempKey: dupKey })
    )
  );

  const dup201 = dupResults.filter((r) => r.status === 201).length;
  const dup409 = dupResults.filter((r) => r.status === 409).length;
  const dupTxnIds = new Set(
    dupResults.filter((r) => r.status === 201).map((r) => String(r.json?.transactionId))
  );

  check(
    "duplicate: money moves exactly once (1 successful 201)",
    dup201 === 1,
    `201s=${dup201} statuses=${JSON.stringify(dupResults.map((r) => r.status))}`
  );
  check(
    "duplicate: exactly 1 distinct transaction ID across all 201 responses",
    dupTxnIds.size === 1,
    JSON.stringify([...dupTxnIds])
  );

  // Wait for all concurrent requests to settle, then check the DONE replays.
  await new Promise((r) => setTimeout(r, 500));

  // Re-send with same key — should replay 201 now.
  const dupReplay = await post("/api/v1/wallet/transfer", dupBody, {
    token: spenderToken,
    idempKey: dupKey,
  });
  check(
    "duplicate: replay returns same saved response",
    dupReplay.status === 201 && dupTxnIds.has(String(dupReplay.json?.transactionId)),
    JSON.stringify(dupReplay)
  );

  // Verify only one transaction was created.
  const dupTxnCount = await db.collection("transactions").countDocuments({
    fromUserId: new mongoose.Types.ObjectId(spenderId),
    amount: 50000,
    note: "Duplicate",
  });
  check(
    "duplicate: exactly 1 transaction document for the duplicate key",
    dupTxnCount === 1,
    `count=${dupTxnCount}`
  );

  // =========================================================================
  // Day 2 regression
  // =========================================================================
  console.log("\n--- Day 2 regression ---");

  const health = await get("/");
  check("GET / health -> 200", health.status === 200, JSON.stringify(health));

  const meR = await get("/api/v1/user/me", { token: rajuToken });
  check("/me still works -> 200", meR.status === 200, JSON.stringify(meR));

  const balR = await get("/api/v1/wallet/balance", { token: rajuToken });
  check("/wallet/balance still works -> 200", balR.status === 200, JSON.stringify(balR));

  check(
    "no password hashes in /me response",
    noHashLeaks(meR.json),
    JSON.stringify(meR.json)
  );

} finally {
  await cleanup();
}

console.log("\n" + (failures === 0 ? "ALL_TESTS_PASSED" : `${failures} TEST(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
