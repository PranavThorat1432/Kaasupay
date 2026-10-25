// Day 4 acceptance tests (Checkpoint 2).
// Covers:
//   - Razorpay order creation (POST /api/v1/wallet/add-money/order)
//   - Input validation (integer paise, ₹10-₹10,000 bounds, strict schema)
//   - Secret protection (no secrets in responses)
//   - Database persistence in PaymentOrder model
//   - Gateway error handling
//   - Order status lookup (GET /api/v1/wallet/add-money/orders/:orderId)
//   - User isolation (cannot view another user's order)
//   - Day 2 & Day 3 regression checks
//
// Run: node test/day4.test.js

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import mongoose from "mongoose";
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3116;
const BASE = `http://localhost:${PORT}`;

const TEST_KEY_ID = "rzp_test_mock_day4_key";
const TEST_KEY_SECRET = "mock_secret_do_not_leak";
const TEST_WEBHOOK_SECRET = "mock_webhook_secret_do_not_leak";

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
      // server not ready yet
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

const ADMIN_KEY = process.env.ADMIN_KEY;

async function httpRequest(method, pathname, body, { token, adminKey } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (adminKey) headers["x-admin-key"] = adminKey;

  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(BASE + pathname, opts);
  let json = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON response
  }
  return { status: res.status, headers: res.headers, json };
}

const post = (p, b, opts) => httpRequest("POST", p, b, opts);
const get = (p, opts) => httpRequest("GET", p, undefined, opts);

async function postWebhookRaw(rawBody, headers = {}) {
  const res = await fetch(`${BASE}/api/v1/webhooks/razorpay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: rawBody,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON response
  }
  return { status: res.status, headers: res.headers, json };
}

function computeWebhookSignature(rawBody, secret = TEST_WEBHOOK_SECRET) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

async function signup(username, firstName, lastName, password = "password123") {
  return post("/api/v1/user/signup", { username, firstName, lastName, password });
}

async function signin(username, password = "password123") {
  const r = await post("/api/v1/user/signin", { username, password });
  return r.json?.token;
}

const unique = Date.now();

// ---------------------------------------------------------------------------
// Main test flow
// ---------------------------------------------------------------------------

console.log("Starting replica-set in-memory MongoDB for Day 4 test suite...");
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

  server = spawnServer({
    MONGO_URL: mongoUri,
    PORT: String(PORT),
    MOCK_RAZORPAY: "true",
    RAZORPAY_KEY_ID: TEST_KEY_ID,
    RAZORPAY_KEY_SECRET: TEST_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
  });

  const up = await waitForHealth();
  check(
    "server starts with replica-set MongoDB and mock Razorpay",
    up,
    server ? server.getOutput() : "server never started"
  );
  if (!up) {
    console.error(server?.getOutput());
    throw new Error("server never became healthy");
  }

  // Connect directly for DB inspection
  await mongoose.connect(mongoUri, { dbName: "kaasupay" });
  const db = mongoose.connection.db;

  // Create two users for ownership testing
  const userA = `alice_${unique}@test.com`;
  const userB = `bob_${unique}@test.com`;

  const sA = await signup(userA, "Alice", "Wallet");
  check("signup Alice -> 201", sA.status === 201, JSON.stringify(sA.json));
  const tokenA = await signin(userA);
  check("signin Alice -> token", typeof tokenA === "string" && tokenA.length > 20, tokenA);

  const sB = await signup(userB, "Bob", "Wallet");
  check("signup Bob -> 201", sB.status === 201, JSON.stringify(sB.json));
  const tokenB = await signin(userB);
  check("signin Bob -> token", typeof tokenB === "string" && tokenB.length > 20, tokenB);

  console.log("\n--- Checkpoint 2: Order Creation (POST /api/v1/wallet/add-money/order) ---");

  // 1. Missing authentication
  const noAuth = await post("/api/v1/wallet/add-money/order", { amount: 50000 });
  check("order: missing JWT -> 401", noAuth.status === 401, JSON.stringify(noAuth));

  // 2. Invalid/malformed JWT
  const badAuth = await post("/api/v1/wallet/add-money/order", { amount: 50000 }, { token: "bad.token.here" });
  check("order: bad JWT -> 401", badAuth.status === 401, JSON.stringify(badAuth));

  // 3. Missing amount
  const noAmt = await post("/api/v1/wallet/add-money/order", {}, { token: tokenA });
  check("order: missing amount -> 400", noAmt.status === 400, JSON.stringify(noAmt.json));

  // 4. String amount
  const strAmt = await post("/api/v1/wallet/add-money/order", { amount: "50000" }, { token: tokenA });
  check("order: string amount -> 400", strAmt.status === 400, JSON.stringify(strAmt.json));

  // 5. Fractional amount
  const fracAmt = await post("/api/v1/wallet/add-money/order", { amount: 5000.5 }, { token: tokenA });
  check("order: fractional amount -> 400", fracAmt.status === 400, JSON.stringify(fracAmt.json));

  // 6. Below minimum amount (< 1000 paise)
  const lowAmt = await post("/api/v1/wallet/add-money/order", { amount: 999 }, { token: tokenA });
  check("order: below min (999 paise) -> 400", lowAmt.status === 400, JSON.stringify(lowAmt.json));

  // 7. Above maximum amount (> 1,000,000 paise)
  const highAmt = await post("/api/v1/wallet/add-money/order", { amount: 1000001 }, { token: tokenA });
  check("order: above max (1000001 paise) -> 400", highAmt.status === 400, JSON.stringify(highAmt.json));

  // 8. Unexpected request body fields (strict schema)
  const extraFields = await post(
    "/api/v1/wallet/add-money/order",
    { amount: 50000, extraNote: "hack" },
    { token: tokenA }
  );
  check("order: unexpected body fields -> 400", extraFields.status === 400, JSON.stringify(extraFields.json));

  // 9. Client attempts to specify userId in body (strict schema rejection)
  const spoofUser = await post(
    "/api/v1/wallet/add-money/order",
    { amount: 50000, userId: "650000000000000000000000" },
    { token: tokenA }
  );
  check("order: body with userId rejected -> 400", spoofUser.status === 400, JSON.stringify(spoofUser.json));

  // 10. Valid minimum order (1000 paise = ₹10)
  const minOrder = await post("/api/v1/wallet/add-money/order", { amount: 1000 }, { token: tokenA });
  check("order: min boundary (1000 paise) -> 201", minOrder.status === 201, JSON.stringify(minOrder.json));
  check("order: min boundary response has orderId", typeof minOrder.json?.orderId === "string", minOrder.json?.orderId);

  // 11. Valid maximum order (1000000 paise = ₹10,000)
  const maxOrder = await post("/api/v1/wallet/add-money/order", { amount: 1000000 }, { token: tokenA });
  check("order: max boundary (1000000 paise) -> 201", maxOrder.status === 201, JSON.stringify(maxOrder.json));

  // 12. Valid standard order (50000 paise = ₹500)
  const validOrder = await post("/api/v1/wallet/add-money/order", { amount: 50000 }, { token: tokenA });
  check("order: valid standard (50000 paise) -> 201", validOrder.status === 201, JSON.stringify(validOrder.json));
  check("order: returns correct amount", validOrder.json?.amount === 50000, validOrder.json?.amount);
  check("order: returns currency INR", validOrder.json?.currency === "INR", validOrder.json?.currency);
  check("order: returns public keyId", validOrder.json?.keyId === TEST_KEY_ID, validOrder.json?.keyId);

  // 13. Secrets protection check
  const jsonStr = JSON.stringify(validOrder.json);
  check(
    "order: secrets are NEVER returned in response",
    !jsonStr.includes(TEST_KEY_SECRET) &&
      !jsonStr.includes(TEST_WEBHOOK_SECRET) &&
      !jsonStr.includes("ADMIN_KEY") &&
      !jsonStr.includes("JWT_SECRET"),
    jsonStr
  );

  const orderIdA = validOrder.json?.orderId;

  // 14. Database persistence check
  const dbOrder = await db.collection("paymentorders").findOne({ gatewayOrderId: orderIdA });
  check("persistence: PaymentOrder document exists in MongoDB", !!dbOrder, JSON.stringify(dbOrder));
  check("persistence: status is CREATED", dbOrder?.status === "CREATED", dbOrder?.status);
  check("persistence: amount is 50000", dbOrder?.amount === 50000, dbOrder?.amount);
  check("persistence: currency is INR", dbOrder?.currency === "INR", dbOrder?.currency);
  check(
    "persistence: userId belongs to Alice",
    String(dbOrder?.userId) === String(sA.json?.user?._id),
    `orderUser=${dbOrder?.userId} aliceId=${sA.json?.user?._id}`
  );
  check("persistence: gatewayPaymentId is null", dbOrder?.gatewayPaymentId === null, dbOrder?.gatewayPaymentId);
  check("persistence: paidVia is null", dbOrder?.paidVia === null, dbOrder?.paidVia);
  check("persistence: transactionId is null", dbOrder?.transactionId === null, dbOrder?.transactionId);

  // 15. Gateway failure handling (amount 999999 simulates gateway error)
  const gwFail = await post("/api/v1/wallet/add-money/order", { amount: 999999 }, { token: tokenA });
  check("gateway failure: returns 502 Bad Gateway", gwFail.status === 502, JSON.stringify(gwFail.json));
  const orphanCheck = await db.collection("paymentorders").findOne({ amount: 999999 });
  check("gateway failure: no PaymentOrder saved for failed order", orphanCheck === null, JSON.stringify(orphanCheck));

  console.log("\n--- Checkpoint 2: Order Status (GET /api/v1/wallet/add-money/orders/:orderId) ---");

  // 16. Missing authentication on status check
  const noAuthStatus = await get(`/api/v1/wallet/add-money/orders/${orderIdA}`);
  check("status: missing JWT -> 401", noAuthStatus.status === 401, JSON.stringify(noAuthStatus));

  // 17. Valid order status by owner (Alice)
  const statusA = await get(`/api/v1/wallet/add-money/orders/${orderIdA}`, { token: tokenA });
  check("status: owner sees 200", statusA.status === 200, JSON.stringify(statusA.json));
  check("status: orderId matches", statusA.json?.orderId === orderIdA, statusA.json?.orderId);
  check("status: amount matches", statusA.json?.amount === 50000, statusA.json?.amount);
  check("status: status is CREATED", statusA.json?.status === "CREATED", statusA.json?.status);
  check("status: paidVia is null", statusA.json?.paidVia === null, statusA.json?.paidVia);

  // 18. Unknown order ID -> 404
  const unknownStatus = await get("/api/v1/wallet/add-money/orders/order_non_existent_999", { token: tokenA });
  check("status: unknown order -> 404", unknownStatus.status === 404, JSON.stringify(unknownStatus.json));

  // 19. Cross-user isolation: Bob attempts to view Alice's order -> 404
  const bobHacksAlice = await get(`/api/v1/wallet/add-money/orders/${orderIdA}`, { token: tokenB });
  check("status: other user querying order -> 404", bobHacksAlice.status === 404, JSON.stringify(bobHacksAlice.json));
  check(
    "status: other user gets identical generic 404 without leaking metadata",
    bobHacksAlice.json?.error === "Order not found",
    JSON.stringify(bobHacksAlice.json)
  );

  console.log("\n--- Checkpoint 3: Checkout Verification (POST /api/v1/wallet/add-money/verify) ---");

  // Helper to compute valid test checkout signature
  function computeSignature(orderId, paymentId, secret = TEST_KEY_SECRET) {
    return crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  }

  const payIdA = `pay_${Date.now()}_${orderIdA}`;
  const validSigA = computeSignature(orderIdA, payIdA);

  // 20. Missing JWT authentication
  const noAuthVerify = await post("/api/v1/wallet/add-money/verify", {
    razorpay_order_id: orderIdA,
    razorpay_payment_id: payIdA,
    razorpay_signature: validSigA,
  });
  check("verify: missing JWT -> 401", noAuthVerify.status === 401, JSON.stringify(noAuthVerify));

  // 21. Missing required fields
  const missingOrder = await post(
    "/api/v1/wallet/add-money/verify",
    { razorpay_payment_id: payIdA, razorpay_signature: validSigA },
    { token: tokenA }
  );
  check("verify: missing razorpay_order_id -> 400", missingOrder.status === 400, JSON.stringify(missingOrder.json));

  const missingPay = await post(
    "/api/v1/wallet/add-money/verify",
    { razorpay_order_id: orderIdA, razorpay_signature: validSigA },
    { token: tokenA }
  );
  check("verify: missing razorpay_payment_id -> 400", missingPay.status === 400, JSON.stringify(missingPay.json));

  const missingSig = await post(
    "/api/v1/wallet/add-money/verify",
    { razorpay_order_id: orderIdA, razorpay_payment_id: payIdA },
    { token: tokenA }
  );
  check("verify: missing razorpay_signature -> 400", missingSig.status === 400, JSON.stringify(missingSig.json));

  // 22. Unexpected extra field (strict validation)
  const extraVerify = await post(
    "/api/v1/wallet/add-money/verify",
    {
      razorpay_order_id: orderIdA,
      razorpay_payment_id: payIdA,
      razorpay_signature: validSigA,
      clientSuppliedAmount: 9999999,
    },
    { token: tokenA }
  );
  check("verify: extra body fields rejected -> 400", extraVerify.status === 400, JSON.stringify(extraVerify.json));

  // 23. Invalid signatures (bad string, wrong secret, length mismatch)
  const badSig = await post(
    "/api/v1/wallet/add-money/verify",
    {
      razorpay_order_id: orderIdA,
      razorpay_payment_id: payIdA,
      razorpay_signature: "bad_signature_string",
    },
    { token: tokenA }
  );
  check("verify: bad signature -> 400", badSig.status === 400, JSON.stringify(badSig.json));

  const wrongSecretSig = computeSignature(orderIdA, payIdA, "wrong_secret");
  const wrongSec = await post(
    "/api/v1/wallet/add-money/verify",
    {
      razorpay_order_id: orderIdA,
      razorpay_payment_id: payIdA,
      razorpay_signature: wrongSecretSig,
    },
    { token: tokenA }
  );
  check("verify: signature signed with wrong secret -> 400", wrongSec.status === 400, JSON.stringify(wrongSec.json));

  // 24. Cross-user verification attempt: Bob tries to verify Alice's order
  const bobVerifyAlice = await post(
    "/api/v1/wallet/add-money/verify",
    {
      razorpay_order_id: orderIdA,
      razorpay_payment_id: payIdA,
      razorpay_signature: validSigA,
    },
    { token: tokenB }
  );
  check("verify: other user verifying order -> 404", bobVerifyAlice.status === 404, JSON.stringify(bobVerifyAlice.json));

  // 25. Order mismatch: Gateway returns payment linked to a different order
  const mismatchOrderId = `pay_mismatch_order_${Date.now()}_${orderIdA}`;
  const mismatchOrderSig = computeSignature(orderIdA, mismatchOrderId);
  const mismatchOrderRes = await post(
    "/api/v1/wallet/add-money/verify",
    {
      razorpay_order_id: orderIdA,
      razorpay_payment_id: mismatchOrderId,
      razorpay_signature: mismatchOrderSig,
    },
    { token: tokenA }
  );
  check("verify: gateway order mismatch -> 400", mismatchOrderRes.status === 400, JSON.stringify(mismatchOrderRes.json));

  // 26. Payment status unpaid/failed
  const unpaidId = `pay_unpaid_${Date.now()}_${orderIdA}`;
  const unpaidSig = computeSignature(orderIdA, unpaidId);
  const unpaidRes = await post(
    "/api/v1/wallet/add-money/verify",
    {
      razorpay_order_id: orderIdA,
      razorpay_payment_id: unpaidId,
      razorpay_signature: unpaidSig,
    },
    { token: tokenA }
  );
  check("verify: gateway payment unpaid/failed -> 400", unpaidRes.status === 400, JSON.stringify(unpaidRes.json));

  // 27. Amount mismatch
  const mismatchAmtId = `pay_mismatch_amount_${Date.now()}_${orderIdA}`;
  const mismatchAmtSig = computeSignature(orderIdA, mismatchAmtId);
  const mismatchAmtRes = await post(
    "/api/v1/wallet/add-money/verify",
    {
      razorpay_order_id: orderIdA,
      razorpay_payment_id: mismatchAmtId,
      razorpay_signature: mismatchAmtSig,
    },
    { token: tokenA }
  );
  check("verify: gateway amount mismatch -> 400", mismatchAmtRes.status === 400, JSON.stringify(mismatchAmtRes.json));

  // 28. Currency mismatch
  const mismatchCurrId = `pay_mismatch_curr_${Date.now()}_${orderIdA}`;
  const mismatchCurrSig = computeSignature(orderIdA, mismatchCurrId);
  const mismatchCurrRes = await post(
    "/api/v1/wallet/add-money/verify",
    {
      razorpay_order_id: orderIdA,
      razorpay_payment_id: mismatchCurrId,
      razorpay_signature: mismatchCurrSig,
    },
    { token: tokenA }
  );
  check("verify: gateway currency mismatch -> 400", mismatchCurrRes.status === 400, JSON.stringify(mismatchCurrRes.json));

  // 29. Valid Checkout Verification (First Credit)
  const initialBal = await get("/api/v1/wallet/balance", { token: tokenA });
  const balBefore = initialBal.json?.balance || 0;

  const validVerify = await post(
    "/api/v1/wallet/add-money/verify",
    {
      razorpay_order_id: orderIdA,
      razorpay_payment_id: payIdA,
      razorpay_signature: validSigA,
    },
    { token: tokenA }
  );
  check("verify: first successful credit -> 200", validVerify.status === 200, JSON.stringify(validVerify.json));
  check("verify: message is 'Money added'", validVerify.json?.message === "Money added", validVerify.json?.message);
  check("verify: orderId matches", validVerify.json?.orderId === orderIdA, validVerify.json?.orderId);
  check("verify: credited amount is 50000", validVerify.json?.amount === 50000, validVerify.json?.amount);
  check(
    "verify: balance is updated by 50000 paise",
    validVerify.json?.balance === balBefore + 50000,
    validVerify.json?.balance
  );

  // 30. Database persistence & invariants check after top-up
  const paidOrder = await db.collection("paymentorders").findOne({ gatewayOrderId: orderIdA });
  check("invariants: PaymentOrder status transitioned to PAID", paidOrder?.status === "PAID", paidOrder?.status);
  check("invariants: PaymentOrder paidVia is CALLBACK", paidOrder?.paidVia === "CALLBACK", paidOrder?.paidVia);
  check("invariants: PaymentOrder records gatewayPaymentId", paidOrder?.gatewayPaymentId === payIdA, paidOrder?.gatewayPaymentId);
  check("invariants: PaymentOrder records transactionId", !!paidOrder?.transactionId, paidOrder?.transactionId);

  const txn = await db.collection("transactions").findOne({ _id: paidOrder?.transactionId });
  check("invariants: TOPUP Transaction exists", txn?.type === "TOPUP", txn?.type);
  check("invariants: TOPUP Transaction amount is 50000", txn?.amount === 50000, txn?.amount);
  check("invariants: TOPUP Transaction fromUserId is null", txn?.fromUserId === null, txn?.fromUserId);
  check(
    "invariants: TOPUP Transaction toUserId is Alice",
    String(txn?.toUserId) === String(sA.json?.user?._id),
    txn?.toUserId
  );

  const ledger = await db.collection("ledgerentries").findOne({ transactionId: txn?._id });
  check("invariants: CREDIT LedgerEntry exists", ledger?.direction === "CREDIT", ledger?.direction);
  check("invariants: LedgerEntry amount is 50000", ledger?.amount === 50000, ledger?.amount);
  check(
    "invariants: LedgerEntry balanceAfter matches updated balance",
    ledger?.balanceAfter === balBefore + 50000,
    ledger?.balanceAfter
  );

  // 31. Order Status reflects PAID
  const statusAfterPaid = await get(`/api/v1/wallet/add-money/orders/${orderIdA}`, { token: tokenA });
  check("status: inspect paid order -> 200", statusAfterPaid.status === 200, JSON.stringify(statusAfterPaid.json));
  check("status: status is PAID", statusAfterPaid.json?.status === "PAID", statusAfterPaid.json?.status);
  check("status: paidVia is CALLBACK", statusAfterPaid.json?.paidVia === "CALLBACK", statusAfterPaid.json?.paidVia);

  // 32. Replay / Duplicate Verification (Idempotency)
  const replayVerify = await post(
    "/api/v1/wallet/add-money/verify",
    {
      razorpay_order_id: orderIdA,
      razorpay_payment_id: payIdA,
      razorpay_signature: validSigA,
    },
    { token: tokenA }
  );
  check("replay: duplicate verification returns 200", replayVerify.status === 200, JSON.stringify(replayVerify.json));
  check("replay: message is 'Already added'", replayVerify.json?.message === "Already added", replayVerify.json?.message);
  check("replay: balance did not increase again", replayVerify.json?.balance === balBefore + 50000, replayVerify.json?.balance);

  const topupTxnCount = await db.collection("transactions").countDocuments({ toUserId: new mongoose.Types.ObjectId(sA.json?.user?._id), type: "TOPUP" });
  check("replay: exactly 1 TOPUP transaction in DB", topupTxnCount === 1, `count=${topupTxnCount}`);

  // 33. Concurrent Verification Safety (Race condition test)
  // Alice creates a second order for 25000 paise
  const order2 = await post("/api/v1/wallet/add-money/order", { amount: 25000 }, { token: tokenA });
  const orderId2 = order2.json?.orderId;
  const payId2 = `pay_${Date.now()}_${orderId2}`;
  const sig2 = computeSignature(orderId2, payId2);

  // Fire 4 concurrent verification requests simultaneously
  const concurrentResponses = await Promise.all([
    post("/api/v1/wallet/add-money/verify", { razorpay_order_id: orderId2, razorpay_payment_id: payId2, razorpay_signature: sig2 }, { token: tokenA }),
    post("/api/v1/wallet/add-money/verify", { razorpay_order_id: orderId2, razorpay_payment_id: payId2, razorpay_signature: sig2 }, { token: tokenA }),
    post("/api/v1/wallet/add-money/verify", { razorpay_order_id: orderId2, razorpay_payment_id: payId2, razorpay_signature: sig2 }, { token: tokenA }),
    post("/api/v1/wallet/add-money/verify", { razorpay_order_id: orderId2, razorpay_payment_id: payId2, razorpay_signature: sig2 }, { token: tokenA }),
  ]);

  const all200 = concurrentResponses.every((r) => r.status === 200);
  check("concurrency: all concurrent verify requests returned 200", all200, concurrentResponses.map((r) => r.status).join(","));

  const newlyAddedCount = concurrentResponses.filter((r) => r.json?.message === "Money added").length;
  const alreadyAddedCount = concurrentResponses.filter((r) => r.json?.message === "Already added").length;
  check("concurrency: exactly one 'Money added' response", newlyAddedCount === 1, `newlyAddedCount=${newlyAddedCount}`);
  check("concurrency: 3 'Already added' responses", alreadyAddedCount === 3, `alreadyAddedCount=${alreadyAddedCount}`);

  // Confirm final balance: 50000 + 25000 = 75000
  const finalBalAlice = await get("/api/v1/wallet/balance", { token: tokenA });
  check(
    "concurrency: final balance reflects exactly one credit of 25000 (75000 paise)",
    finalBalAlice.json?.balance === 75000,
    finalBalAlice.json?.balance
  );

  const topupTxnCount2 = await db.collection("transactions").countDocuments({ toUserId: new mongoose.Types.ObjectId(sA.json?.user?._id), type: "TOPUP" });
  check("concurrency: exactly 2 total TOPUP transactions in DB", topupTxnCount2 === 2, `count=${topupTxnCount2}`);

  console.log("\n--- Checkpoint 4: Razorpay Webhooks and Financial Reconciliation ---");

  // Create Charlie for clean webhook testing
  const userC = `charlie_${unique}@test.com`;
  const sC = await signup(userC, "Charlie", "Wallet");
  check("signup Charlie -> 201", sC.status === 201, JSON.stringify(sC.json));
  const tokenC = await signin(userC);
  check("signin Charlie -> token", typeof tokenC === "string" && tokenC.length > 20, tokenC);
  const charlieId = sC.json?.user?._id;

  // 34. Security: Missing and Invalid Signatures
  const ordWh1 = await post("/api/v1/wallet/add-money/order", { amount: 5000 }, { token: tokenC });
  const ordWh1Id = ordWh1.json?.orderId;
  const payWh1Id = `pay_wh1_${Date.now()}`;

  // Missing signature header
  const whMissingSig = await postWebhookRaw(
    JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: payWh1Id, order_id: ordWh1Id, amount: 5000, currency: "INR", status: "captured" } } },
    })
  );
  check("webhook: missing signature returns 400", whMissingSig.status === 400, JSON.stringify(whMissingSig.json));
  check("webhook: error mentions signature", whMissingSig.json?.error?.includes("signature"), whMissingSig.json?.error);

  // Invalid signature header
  const whInvalidSig = await postWebhookRaw(
    JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: payWh1Id, order_id: ordWh1Id, amount: 5000, currency: "INR", status: "captured" } } },
    }),
    { "x-razorpay-signature": "bad_signature_hex_1234567890abcdef" }
  );
  check("webhook: invalid signature returns 400", whInvalidSig.status === 400, JSON.stringify(whInvalidSig.json));

  // Signature against mismatched raw body
  const bodyA = JSON.stringify({ event: "payment.captured", tag: "payload_a" });
  const sigA = computeWebhookSignature(bodyA);
  const bodyB = JSON.stringify({ event: "payment.captured", tag: "payload_b" });
  const whMismatchedBody = await postWebhookRaw(bodyB, { "x-razorpay-signature": sigA });
  check("webhook: signature against mismatched raw body returns 400", whMismatchedBody.status === 400, JSON.stringify(whMismatchedBody.json));

  // Confirm Charlie's balance is untouched
  const balCharlie0 = await get("/api/v1/wallet/balance", { token: tokenC });
  check("webhook: no credit on invalid/missing signatures", balCharlie0.json?.balance === 0, balCharlie0.json?.balance);

  // 35. Unsupported / Non-captured Events
  const payloadFailed = JSON.stringify({
    event: "payment.failed",
    event_id: `evt_failed_${Date.now()}`,
    payload: { payment: { entity: { id: "pay_failed_1", order_id: ordWh1Id, amount: 5000, currency: "INR", status: "failed" } } },
  });
  const sigFailed = computeWebhookSignature(payloadFailed);
  const whFailed = await postWebhookRaw(payloadFailed, { "x-razorpay-signature": sigFailed });
  check("webhook: unsupported payment.failed returns 200 ignored", whFailed.status === 200 && whFailed.json?.status === "ignored", JSON.stringify(whFailed.json));
  const balCharlieStill0 = await get("/api/v1/wallet/balance", { token: tokenC });
  check("webhook: balance unchanged after unsupported event", balCharlieStill0.json?.balance === 0, balCharlieStill0.json?.balance);

  // 36. Unknown Order ID
  const payloadUnknown = JSON.stringify({
    event: "payment.captured",
    event_id: `evt_unknown_${Date.now()}`,
    payload: { payment: { entity: { id: "pay_unk_1", order_id: "order_unknown_not_in_db", amount: 5000, currency: "INR", status: "captured" } } },
  });
  const sigUnknown = computeWebhookSignature(payloadUnknown);
  const whUnknown = await postWebhookRaw(payloadUnknown, { "x-razorpay-signature": sigUnknown });
  check("webhook: unknown order returns 200 ignored", whUnknown.status === 200 && whUnknown.json?.status?.includes("unknown"), JSON.stringify(whUnknown.json));

  // 37. Amount and Currency Mismatches
  const ordWh2 = await post("/api/v1/wallet/add-money/order", { amount: 7000 }, { token: tokenC });
  const ordWh2Id = ordWh2.json?.orderId;

  // Amount mismatch
  const payloadAmtMismatch = JSON.stringify({
    event: "payment.captured",
    event_id: `evt_mismatch_amt_${Date.now()}`,
    payload: { payment: { entity: { id: `pay_amt_mismatch_${Date.now()}`, order_id: ordWh2Id, amount: 9000, currency: "INR", status: "captured" } } },
  });
  const sigAmtMismatch = computeWebhookSignature(payloadAmtMismatch);
  const whAmtMismatch = await postWebhookRaw(payloadAmtMismatch, { "x-razorpay-signature": sigAmtMismatch });
  check("webhook: amount mismatch returns 200 flagged", whAmtMismatch.status === 200 && whAmtMismatch.json?.status?.includes("flagged"), JSON.stringify(whAmtMismatch.json));

  // Currency mismatch
  const payloadCurrMismatch = JSON.stringify({
    event: "payment.captured",
    event_id: `evt_mismatch_curr_${Date.now()}`,
    payload: { payment: { entity: { id: `pay_curr_mismatch_${Date.now()}`, order_id: ordWh2Id, amount: 7000, currency: "USD", status: "captured" } } },
  });
  const sigCurrMismatch = computeWebhookSignature(payloadCurrMismatch);
  const whCurrMismatch = await postWebhookRaw(payloadCurrMismatch, { "x-razorpay-signature": sigCurrMismatch });
  check("webhook: currency mismatch returns 200 flagged", whCurrMismatch.status === 200 && whCurrMismatch.json?.status?.includes("flagged"), JSON.stringify(whCurrMismatch.json));

  const balCharlieStill0_2 = await get("/api/v1/wallet/balance", { token: tokenC });
  check("webhook: balance unchanged after amount/currency mismatches", balCharlieStill0_2.json?.balance === 0, balCharlieStill0_2.json?.balance);

  // 38. Valid payment.captured Top-Up via Webhook
  const evtId1 = `evt_valid_${Date.now()}_1`;
  const payloadValidWh1 = JSON.stringify({
    event: "payment.captured",
    event_id: evtId1,
    payload: { payment: { entity: { id: payWh1Id, order_id: ordWh1Id, amount: 5000, currency: "INR", status: "captured" } } },
  });
  const sigValidWh1 = computeWebhookSignature(payloadValidWh1);
  const whValid1 = await postWebhookRaw(payloadValidWh1, {
    "x-razorpay-signature": sigValidWh1,
    "x-razorpay-event-id": evtId1,
  });
  check("webhook: valid payment.captured returns 200 credited", whValid1.status === 200 && whValid1.json?.status === "credited", JSON.stringify(whValid1.json));

  const balCharlieAfterWh1 = await get("/api/v1/wallet/balance", { token: tokenC });
  check("webhook: wallet balance credited with 5000 paise", balCharlieAfterWh1.json?.balance === 5000, balCharlieAfterWh1.json?.balance);

  const statusWh1 = await get(`/api/v1/wallet/add-money/orders/${ordWh1Id}`, { token: tokenC });
  check("webhook: order status is PAID", statusWh1.json?.status === "PAID", statusWh1.json?.status);
  check("webhook: order paidVia is WEBHOOK", statusWh1.json?.paidVia === "WEBHOOK", statusWh1.json?.paidVia);

  // 39. Duplicate Webhook Event Delivery
  const whDuplicate = await postWebhookRaw(payloadValidWh1, {
    "x-razorpay-signature": sigValidWh1,
    "x-razorpay-event-id": evtId1,
  });
  check("webhook: duplicate event returns 200 already credited", whDuplicate.status === 200 && whDuplicate.json?.status === "already credited", JSON.stringify(whDuplicate.json));
  check("webhook: duplicateEvent flag is true", whDuplicate.json?.duplicateEvent === true, JSON.stringify(whDuplicate.json));

  const balCharlieAfterDup = await get("/api/v1/wallet/balance", { token: tokenC });
  check("webhook: duplicate delivery did not credit wallet twice", balCharlieAfterDup.json?.balance === 5000, balCharlieAfterDup.json?.balance);

  // 40. Callback-First, Then Webhook
  const ordWh3 = await post("/api/v1/wallet/add-money/order", { amount: 10000 }, { token: tokenC });
  const ordWh3Id = ordWh3.json?.orderId;
  const payWh3Id = `pay_wh3_${Date.now()}_${ordWh3Id}`;
  const sigWh3Callback = computeSignature(ordWh3Id, payWh3Id);

  const cb1 = await post(
    "/api/v1/wallet/add-money/verify",
    { razorpay_order_id: ordWh3Id, razorpay_payment_id: payWh3Id, razorpay_signature: sigWh3Callback },
    { token: tokenC }
  );
  check("callback-first: verify endpoint returns 200 Money added", cb1.status === 200 && cb1.json?.message === "Money added", JSON.stringify(cb1.json));

  const balCharlieAfterCb = await get("/api/v1/wallet/balance", { token: tokenC });
  check("callback-first: balance is 15000 paise (5000 + 10000)", balCharlieAfterCb.json?.balance === 15000, balCharlieAfterCb.json?.balance);

  const evtId3 = `evt_wh3_${Date.now()}`;
  const payloadWh3 = JSON.stringify({
    event: "payment.captured",
    event_id: evtId3,
    payload: { payment: { entity: { id: payWh3Id, order_id: ordWh3Id, amount: 10000, currency: "INR", status: "captured" } } },
  });
  const sigWh3 = computeWebhookSignature(payloadWh3);
  const whAfterCb = await postWebhookRaw(payloadWh3, {
    "x-razorpay-signature": sigWh3,
    "x-razorpay-event-id": evtId3,
  });
  check("callback-first: webhook returns 200 already credited", whAfterCb.status === 200 && whAfterCb.json?.status === "already credited", JSON.stringify(whAfterCb.json));

  const balCharlieAfterBoth1 = await get("/api/v1/wallet/balance", { token: tokenC });
  check("callback-first: wallet balance remained 15000 (no double credit)", balCharlieAfterBoth1.json?.balance === 15000, balCharlieAfterBoth1.json?.balance);

  // 41. Webhook-First, Then Callback
  const ordWh4 = await post("/api/v1/wallet/add-money/order", { amount: 6000 }, { token: tokenC });
  const ordWh4Id = ordWh4.json?.orderId;
  const payWh4Id = `pay_wh4_${Date.now()}_${ordWh4Id}`;

  const evtId4 = `evt_wh4_${Date.now()}`;
  const payloadWh4 = JSON.stringify({
    event: "payment.captured",
    event_id: evtId4,
    payload: { payment: { entity: { id: payWh4Id, order_id: ordWh4Id, amount: 6000, currency: "INR", status: "captured" } } },
  });
  const sigWh4 = computeWebhookSignature(payloadWh4);
  const whBeforeCb = await postWebhookRaw(payloadWh4, {
    "x-razorpay-signature": sigWh4,
    "x-razorpay-event-id": evtId4,
  });
  check("webhook-first: webhook returns 200 credited", whBeforeCb.status === 200 && whBeforeCb.json?.status === "credited", JSON.stringify(whBeforeCb.json));

  const balCharlieAfterWh4 = await get("/api/v1/wallet/balance", { token: tokenC });
  check("webhook-first: balance is 21000 paise (15000 + 6000)", balCharlieAfterWh4.json?.balance === 21000, balCharlieAfterWh4.json?.balance);

  const sigWh4Callback = computeSignature(ordWh4Id, payWh4Id);
  const cbAfterWh = await post(
    "/api/v1/wallet/add-money/verify",
    { razorpay_order_id: ordWh4Id, razorpay_payment_id: payWh4Id, razorpay_signature: sigWh4Callback },
    { token: tokenC }
  );
  check("webhook-first: callback returns 200 Already added", cbAfterWh.status === 200 && cbAfterWh.json?.message === "Already added", JSON.stringify(cbAfterWh.json));

  const balCharlieAfterBoth2 = await get("/api/v1/wallet/balance", { token: tokenC });
  check("webhook-first: wallet balance remained 21000 (no double credit)", balCharlieAfterBoth2.json?.balance === 21000, balCharlieAfterBoth2.json?.balance);

  // 42. Concurrent Callback and Webhook Attempt
  const ordWh5 = await post("/api/v1/wallet/add-money/order", { amount: 4000 }, { token: tokenC });
  const ordWh5Id = ordWh5.json?.orderId;
  const payWh5Id = `pay_wh5_${Date.now()}_${ordWh5Id}`;
  const sigWh5Callback = computeSignature(ordWh5Id, payWh5Id);

  const evtId5 = `evt_wh5_${Date.now()}`;
  const payloadWh5 = JSON.stringify({
    event: "payment.captured",
    event_id: evtId5,
    payload: { payment: { entity: { id: payWh5Id, order_id: ordWh5Id, amount: 4000, currency: "INR", status: "captured" } } },
  });
  const sigWh5Webhook = computeWebhookSignature(payloadWh5);

  const [raceCb, raceWh] = await Promise.all([
    post(
      "/api/v1/wallet/add-money/verify",
      { razorpay_order_id: ordWh5Id, razorpay_payment_id: payWh5Id, razorpay_signature: sigWh5Callback },
      { token: tokenC }
    ),
    postWebhookRaw(payloadWh5, {
      "x-razorpay-signature": sigWh5Webhook,
      "x-razorpay-event-id": evtId5,
    }),
  ]);

  check("concurrent race: callback returned 200", raceCb.status === 200, JSON.stringify(raceCb.json));
  check("concurrent race: webhook returned 200", raceWh.status === 200, JSON.stringify(raceWh.json));

  const balCharlieAfterRace = await get("/api/v1/wallet/balance", { token: tokenC });
  check("concurrent race: balance credited exactly once (+4000 = 25000 paise)", balCharlieAfterRace.json?.balance === 25000, balCharlieAfterRace.json?.balance);

  // 43. Retry Behavior after Failure
  const retryOrderId = ordWh2Id; // 7000 paise order still in CREATED state
  const payRetryId = `pay_retry_${Date.now()}`;
  const retryEventId = `evt_retry_${Date.now()}`;

  await db.collection("webhookevents").insertOne({
    eventId: retryEventId,
    eventType: "payment.captured",
    status: "FAILED",
    gatewayOrderId: retryOrderId,
    gatewayPaymentId: payRetryId,
    notes: "Simulated prior infrastructure error",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const payloadRetry = JSON.stringify({
    event: "payment.captured",
    event_id: retryEventId,
    payload: { payment: { entity: { id: payRetryId, order_id: retryOrderId, amount: 7000, currency: "INR", status: "captured" } } },
  });
  const sigRetry = computeWebhookSignature(payloadRetry);
  const whRetry = await postWebhookRaw(payloadRetry, {
    "x-razorpay-signature": sigRetry,
    "x-razorpay-event-id": retryEventId,
  });

  check("retry: webhook retried after failure returns 200 credited", whRetry.status === 200 && whRetry.json?.status === "credited", JSON.stringify(whRetry.json));
  const eventInDb = await db.collection("webhookevents").findOne({ eventId: retryEventId });
  check("retry: webhook event status updated to PROCESSED", eventInDb?.status === "PROCESSED", eventInDb?.status);

  const balCharlieAfterRetry = await get("/api/v1/wallet/balance", { token: tokenC });
  check("retry: balance increased by 7000 (25000 + 7000 = 32000 paise)", balCharlieAfterRetry.json?.balance === 32000, balCharlieAfterRetry.json?.balance);

  // 44. Transaction History Mapping (TOPUP shows 'Added via Razorpay')
  const charlieTxns = await get("/api/v1/wallet/transactions?page=1&limit=10", { token: tokenC });
  check("history: GET /api/v1/wallet/transactions -> 200", charlieTxns.status === 200, JSON.stringify(charlieTxns.json));
  check("history: returns transaction list", Array.isArray(charlieTxns.json?.data) && charlieTxns.json.data.length > 0, charlieTxns.json?.data?.length);

  const topupEntry = charlieTxns.json?.data?.find((t) => t.type === "TOPUP");
  check("history: found a TOPUP transaction", Boolean(topupEntry), JSON.stringify(topupEntry));
  check("history: TOPUP has withWhom 'Added via Razorpay'", topupEntry?.withWhom === "Added via Razorpay", topupEntry?.withWhom);
  check("history: direction is CREDIT", topupEntry?.direction === "CREDIT", topupEntry?.direction);

  // 45. Admin Reconciliation Conservation Calculation
  const admDep = await post(
    "/api/v1/admin/deposit",
    { to: userB, amount: 50000, note: "Initial bank deposit" },
    { adminKey: ADMIN_KEY }
  );
  check("admin: POST /api/v1/admin/deposit -> 201", admDep.status === 201, JSON.stringify(admDep.json));

  const reconcile = await get("/api/v1/admin/reconcile", { adminKey: ADMIN_KEY });
  check("reconcile: GET /api/v1/admin/reconcile -> 200", reconcile.status === 200, JSON.stringify(reconcile.json));
  check("reconcile: moneyConserved is true", reconcile.json?.moneyConserved === true, JSON.stringify(reconcile.json));
  check(
    "reconcile: totalBalance equals totalDeposited",
    reconcile.json?.totalBalance === reconcile.json?.totalDeposited,
    `balance=${reconcile.json?.totalBalance}, deposited=${reconcile.json?.totalDeposited}`
  );
  check("reconcile: no mismatches", Array.isArray(reconcile.json?.mismatches) && reconcile.json.mismatches.length === 0, JSON.stringify(reconcile.json?.mismatches));

  console.log("\n--- Regression verification on existing endpoints ---");

  // Health check
  const health = await get("/");
  check("regression: GET / health -> 200", health.status === 200, JSON.stringify(health.json));

  // Profile check
  const me = await get("/api/v1/user/me", { token: tokenA });
  check("regression: GET /api/v1/user/me -> 200", me.status === 200, JSON.stringify(me.json));

  // Balance check
  const bal = await get("/api/v1/wallet/balance", { token: tokenA });
  check("regression: GET /api/v1/wallet/balance -> 200", bal.status === 200, JSON.stringify(bal.json));

  console.log(`\nALL_TESTS_PASSED (passed: ${passedAssertions}, failures: ${failures})\n`);
} finally {
  await cleanup();
}

if (failures > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

