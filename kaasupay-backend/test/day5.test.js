// test/day5.test.js — KaasuPay Day 5 Acceptance Tests
// Covers:
//   - Bank account creation, validation, duplicates, and masking (D1)
//   - Withdrawal validation, balances, limits, and idempotency (D2)
//   - Happy path payout & definitive refusal with compensating reversal (D3)
//   - Bank down recovery with exponential backoff & jitter (D4)
//   - Slow bank timeout and deduplication (D5)
//   - Worker crash and outbox recovery (D6)
//   - 5 attempts threshold & safe parking in NEEDS_REVIEW (D7)
//   - Transaction history labels, financial reconciliation, and privacy isolation (D8)
//   - Concurrent workers deduplication (Bonus 6)
//   - AES-256-GCM database encryption at rest (Bonus 7)
//
// Run: node test/day5.test.js

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import mongoose from "mongoose";
import http from "node:http";
import { createFakeBankApp } from "../tools/fake-bank.js";
import BankAccount from "../models/bankAccountModel.js";
import Withdrawal from "../models/withdrawalModel.js";
import OutboxEvent from "../models/outboxEventModel.js";
import Wallet from "../models/walletModel.js";
import { claimNextJob, processJob } from "../worker.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3117;
const BASE = `http://localhost:${PORT}`;
const FAKE_BANK_PORT = 4117;
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
  console.log("=== Starting Day 5 Test Suite ===");

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

  // 3. Connect direct mongoose connection for test verification
  await mongoose.connect(mongoUri, { dbName: "kaasupay" });

  process.env.BANK_ENCRYPTION_KEY = "test_bank_key_32bytes_shared_ok";

  // 4. Spawn backend server
  const serverEnv = {
    PORT: String(PORT),
    MONGO_URL: mongoUri,
    ADMIN_KEY,
    JWT_SECRET: "test_secret_for_day5_testing_purposes_only_32bytes",
    BANK_URL,
    BANK_ENCRYPTION_KEY: "test_bank_key_32bytes_shared_ok",
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
    // -------------------------------------------------------------------------
    // Helper: Signup & Signin
    // -------------------------------------------------------------------------
    async function createUser(firstName, lastName, email, password) {
      const res = await fetch(`${BASE}/api/v1/user/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, username: email, password }),
      });
      return await res.json();
    }

    async function loginUser(email, password) {
      const res = await fetch(`${BASE}/api/v1/user/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email, password }),
      });
      const data = await res.json();
      return data.token;
    }

    async function staffDeposit(to, amount) {
      const res = await fetch(`${BASE}/api/v1/admin/deposit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": ADMIN_KEY,
        },
        body: JSON.stringify({ to, amount }),
      });
      return await res.json();
    }

    // Create Raju and Priya
    await createUser("Raju", "Kumar", "raju@day5.test", "password123");
    await createUser("Priya", "Sharma", "priya@day5.test", "password123");

    const rajuToken = await loginUser("raju@day5.test", "password123");
    const priyaToken = await loginUser("priya@day5.test", "password123");

    // Deposit ₹1,000 (100,000 paise) to Raju
    const depRes = await staffDeposit("raju@day5.test", 100000);
    check("Raju receives ₹1,000 initial staff deposit", depRes.amount === 100000, JSON.stringify(depRes));

    // -------------------------------------------------------------------------
    // D1: Bank Accounts (Level 1)
    // -------------------------------------------------------------------------
    console.log("\n--- Testing D1: Bank Accounts (Level 1) ---");

    // D1.1 Raju adds valid account
    const d1_1 = await fetch(`${BASE}/api/v1/wallet/bank-accounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
      },
      body: JSON.stringify({
        holderName: "Raju Kumar",
        accountNumber: "123456781234",
        ifsc: "sbin0001234",
      }),
    });
    const d1_1_data = await d1_1.json();
    check("D1.1: Add bank account returns 201", d1_1.status === 201, `Status: ${d1_1.status}`);
    check("D1.1: Masked account returned (XXXXXX1234)", d1_1_data.account === "XXXXXX1234", d1_1_data.account);
    check("D1.1: IFSC normalized to uppercase SBIN0001234", d1_1_data.ifsc === "SBIN0001234", d1_1_data.ifsc);
    const rajuAcc1Id = d1_1_data.id;

    // D1.2 Add same account again -> 409
    const d1_2 = await fetch(`${BASE}/api/v1/wallet/bank-accounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
      },
      body: JSON.stringify({
        holderName: "Raju Kumar",
        accountNumber: "123456781234",
        ifsc: "sbin0001234",
      }),
    });
    const d1_2_data = await d1_2.json();
    check("D1.2: Duplicate bank account returns 409", d1_2.status === 409, `Status: ${d1_2.status}`);
    check("D1.2: Clear duplicate error message", d1_2_data.error === "This bank account is already added", d1_2_data.error);

    // D1.3 Short account number -> 400
    const d1_3 = await fetch(`${BASE}/api/v1/wallet/bank-accounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
      },
      body: JSON.stringify({
        holderName: "Raju Kumar",
        accountNumber: "1234",
        ifsc: "SBIN0001234",
      }),
    });
    const d1_3_data = await d1_3.json();
    check("D1.3: Short account number returns 400", d1_3.status === 400, `Status: ${d1_3.status}`);
    check("D1.3: Account number length validation message", d1_3_data.error?.includes("accountNumber: must be 9 to 18 digits"), d1_3_data.error);

    // D1.4 Invalid IFSC -> 400
    const d1_4 = await fetch(`${BASE}/api/v1/wallet/bank-accounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
      },
      body: JSON.stringify({
        holderName: "Raju Kumar",
        accountNumber: "123456781234",
        ifsc: "SBIN1234",
      }),
    });
    const d1_4_data = await d1_4.json();
    check("D1.4: Invalid IFSC returns 400", d1_4.status === 400, `Status: ${d1_4.status}`);
    check("D1.4: IFSC validation error message", d1_4_data.error?.includes("ifsc: is not a valid IFSC"), d1_4_data.error);

    // D1.5 Raju adds closed account ending in 0000
    const d1_5 = await fetch(`${BASE}/api/v1/wallet/bank-accounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
      },
      body: JSON.stringify({
        holderName: "Raju Kumar",
        accountNumber: "999988880000",
        ifsc: "HDFC0000123",
      }),
    });
    const d1_5_data = await d1_5.json();
    check("D1.5: Closed account (ending in 0000) added successfully -> 201", d1_5.status === 201, `Status: ${d1_5.status}`);
    check("D1.5: Masked account XXXXXX0000", d1_5_data.account === "XXXXXX0000", d1_5_data.account);
    const rajuAccClosedId = d1_5_data.id;

    // D1.6 Priya adds account
    const d1_6 = await fetch(`${BASE}/api/v1/wallet/bank-accounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${priyaToken}`,
      },
      body: JSON.stringify({
        holderName: "Priya Sharma",
        accountNumber: "555566667777",
        ifsc: "ICIC0004321",
      }),
    });
    const d1_6_data = await d1_6.json();
    check("D1.6: Priya adds account -> 201", d1_6.status === 201, `Status: ${d1_6.status}`);
    check("D1.6: Masked account XXXXXX7777", d1_6_data.account === "XXXXXX7777", d1_6_data.account);
    const priyaAccId = d1_6_data.id;

    // List Raju's accounts
    const listRes = await fetch(`${BASE}/api/v1/wallet/bank-accounts`, {
      headers: { Authorization: `Bearer ${rajuToken}` },
    });
    const listData = await listRes.json();
    check("D1 List: Returns 200 with accounts array", listRes.status === 200 && Array.isArray(listData.accounts), `Status: ${listRes.status}`);
    check("D1 List: Raju has 2 saved accounts", listData.accounts.length === 2, `Count: ${listData.accounts?.length}`);
    check("D1 List: Accounts never leak full account number", listData.accounts.every((a) => !a.accountNumber && a.account.startsWith("XXXXXX")), JSON.stringify(listData));

    // Bonus 7 Check: Direct MongoDB check for AES-256-GCM encryption
    const directDoc = await BankAccount.findById(rajuAcc1Id);
    check("Bonus 7: Account number is encrypted with AES-256-GCM in database", directDoc.accountNumber.includes(":") && directDoc.accountNumber.split(":").length === 3, directDoc.accountNumber);

    // -------------------------------------------------------------------------
    // D2: Withdraw Rules (Level 2)
    // -------------------------------------------------------------------------
    console.log("\n--- Testing D2: Withdraw Rules (Level 2) ---");

    // D2.1 Missing Idempotency-Key
    const d2_1 = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
      },
      body: JSON.stringify({ bankAccountId: rajuAcc1Id, amount: 30000 }),
    });
    const d2_1_data = await d2_1.json();
    check("D2.1: Missing Idempotency-Key returns 400", d2_1.status === 400, `Status: ${d2_1.status}`);
    check("D2.1: Header required error message", d2_1_data.error?.includes("Idempotency-Key"), d2_1_data.error);

    // D2.2 Amount < 10000 paise (₹100)
    const d2_2 = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
        "Idempotency-Key": "w-001",
      },
      body: JSON.stringify({ bankAccountId: rajuAcc1Id, amount: 5000 }),
    });
    const d2_2_data = await d2_2.json();
    check("D2.2: Amount < 10000 paise returns 400", d2_2.status === 400, `Status: ${d2_2.status}`);
    check("D2.2: Minimum limit error message", d2_2_data.error?.includes("amount: must be at least 10000 paise"), d2_2_data.error);

    // D2.3 Amount > 2500000 paise (₹25,000)
    const d2_3 = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
        "Idempotency-Key": "w-002",
      },
      body: JSON.stringify({ bankAccountId: rajuAcc1Id, amount: 3000000 }),
    });
    const d2_3_data = await d2_3.json();
    check("D2.3: Amount > 2500000 paise returns 400", d2_3.status === 400, `Status: ${d2_3.status}`);
    check("D2.3: Maximum limit error message", d2_3_data.error?.includes("amount: must be at most 2500000 paise"), d2_3_data.error);

    // D2.4 Account does not belong to Raju (Priya's account)
    const d2_4 = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
        "Idempotency-Key": "w-003",
      },
      body: JSON.stringify({ bankAccountId: priyaAccId, amount: 30000 }),
    });
    const d2_4_data = await d2_4.json();
    check("D2.4: Other user's bank account returns 404", d2_4.status === 404, `Status: ${d2_4.status}`);
    check("D2.4: Bank account not found message", d2_4_data.error === "Bank account not found", d2_4_data.error);

    // D2.5 Insufficient balance (Raju has 100000, tries to withdraw 200000)
    const d2_5 = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
        "Idempotency-Key": "w-004",
      },
      body: JSON.stringify({ bankAccountId: rajuAcc1Id, amount: 200000 }),
    });
    const d2_5_data = await d2_5.json();
    check("D2.5: Insufficient balance returns 400", d2_5.status === 400, `Status: ${d2_5.status}`);
    check("D2.5: Insufficient balance error message", d2_5_data.error === "Insufficient balance", d2_5_data.error);

    // -------------------------------------------------------------------------
    // D3: Happy Path & Refusal (Levels 2 & 3)
    // -------------------------------------------------------------------------
    console.log("\n--- Testing D3: The Happy Path & Refusal (Levels 2 & 3) ---");

    // D3.1 Valid withdrawal request: 30000 paise (₹300) with key w-005
    const d3_1 = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
        "Idempotency-Key": "w-005",
      },
      body: JSON.stringify({ bankAccountId: rajuAcc1Id, amount: 30000 }),
    });
    const d3_1_data = await d3_1.json();
    check("D3.1: Valid withdrawal returns 202 Accepted", d3_1.status === 202, `Status: ${d3_1.status}`);
    check("D3.1: Status is PENDING", d3_1_data.withdrawal?.status === "PENDING", d3_1_data.withdrawal?.status);
    check("D3.1: Balance atomically debited to 70000", d3_1_data.balance === 70000, `Balance: ${d3_1_data.balance}`);
    const wd1Id = d3_1_data.withdrawal?.id;

    // D3.2 Retry exact same request with same key w-005
    const d3_2 = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
        "Idempotency-Key": "w-005",
      },
      body: JSON.stringify({ bankAccountId: rajuAcc1Id, amount: 30000 }),
    });
    const d3_2_data = await d3_2.json();
    check("D3.2: Replay returns 202 with same withdrawal ID", d3_2.status === 202 && d3_2_data.withdrawal?.id === wd1Id, `Returned ID: ${d3_2_data.withdrawal?.id}`);
    check("D3.2: Balance remains 70000 without double-debit", d3_2_data.balance === 70000, `Balance: ${d3_2_data.balance}`);

    // D3.3 Process job via worker
    const job1 = await claimNextJob();
    check("D3.3: Worker claims outbox job", Boolean(job1 && job1.withdrawalId.toString() === wd1Id), `Job: ${job1?._id}`);
    const job1Res = await processJob(job1, { bankUrl: BANK_URL });
    check("D3.3: Worker reports bank payout SUCCESS", job1Res.status === "SUCCESS", JSON.stringify(job1Res));

    // Verify withdrawal updated in DB
    const wd1Doc = await Withdrawal.findById(wd1Id);
    check("D3.3: Withdrawal status transitioned to SUCCESS", wd1Doc.status === "SUCCESS", wd1Doc.status);
    check("D3.3: bankRef (UTR) recorded on withdrawal", Boolean(wd1Doc.bankRef?.startsWith("UTR")), wd1Doc.bankRef);

    // D3.4 Withdraw 20000 to closed account ending in 0000 (key w-006)
    const d3_4 = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
        "Idempotency-Key": "w-006",
      },
      body: JSON.stringify({ bankAccountId: rajuAccClosedId, amount: 20000 }),
    });
    const d3_4_data = await d3_4.json();
    check("D3.4: Closed account withdrawal returns 202", d3_4.status === 202, `Status: ${d3_4.status}`);
    check("D3.4: Balance immediately held to 50000", d3_4_data.balance === 50000, `Balance: ${d3_4_data.balance}`);
    const wd2Id = d3_4_data.withdrawal?.id;

    // D3.5 Worker processes refusal and executes compensating reversal
    const job2 = await claimNextJob();
    const job2Res = await processJob(job2, { bankUrl: BANK_URL });
    check("D3.5: Worker reports REVERSED outcome", job2Res.status === "REVERSED", JSON.stringify(job2Res));

    const wd2Doc = await Withdrawal.findById(wd2Id);
    check("D3.5: Withdrawal status is REVERSED", wd2Doc.status === "REVERSED", wd2Doc.status);
    check("D3.5: failureReason recorded as 'Account closed'", wd2Doc.failureReason === "Account closed", wd2Doc.failureReason);

    // Check balance restored to 70000
    const rajuWalletAfterReversal = await Wallet.findOne({ userId: wd1Doc.userId });
    check("D3.5: Raju's balance refunded back to 70000", rajuWalletAfterReversal.balance === 70000, `Balance: ${rajuWalletAfterReversal.balance}`);

    // Verify exactly-once reversal idempotency
    const repeatClaim = await claimNextJob();
    check("D3.5: No duplicate outbox jobs remaining", repeatClaim === null, `Found: ${repeatClaim?._id}`);

    // -------------------------------------------------------------------------
    // D4: Bank down, then back (Level 4)
    // -------------------------------------------------------------------------
    console.log("\n--- Testing D4: Bank down, then back (Level 4) ---");
    fakeBank.setMode("down");

    const d4_req = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
        "Idempotency-Key": "w-101",
      },
      body: JSON.stringify({ bankAccountId: rajuAcc1Id, amount: 10000 }),
    });
    const d4_data = await d4_req.json();
    check("D4: Withdrawal returns 202 with bank down", d4_req.status === 202, `Status: ${d4_req.status}`);
    check("D4: Balance held to 60000", d4_data.balance === 60000, `Balance: ${d4_data.balance}`);
    const wd3Id = d4_data.withdrawal?.id;

    // Claim job 3 while bank is down
    const job3 = await claimNextJob();
    const job3Res1 = await processJob(job3, { bankUrl: BANK_URL, backoffBaseMs: 50 });
    check("D4: Job 3 results in RETRY when bank returns 503", job3Res1.status === "RETRY", JSON.stringify(job3Res1));

    // Restore bank to normal
    fakeBank.setMode("normal");

    // Fast-forward nextAttemptAt
    await OutboxEvent.updateOne({ withdrawalId: wd3Id }, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });
    const job3Reclaimed = await claimNextJob();
    const job3Res2 = await processJob(job3Reclaimed, { bankUrl: BANK_URL });
    check("D4: After restoring bank, withdrawal succeeds", job3Res2.status === "SUCCESS", JSON.stringify(job3Res2));

    const wd3Doc = await Withdrawal.findById(wd3Id);
    check("D4: Withdrawal record is marked SUCCESS", wd3Doc.status === "SUCCESS", wd3Doc.status);

    // -------------------------------------------------------------------------
    // D5: The slow bank (timeout is not failure) (Level 4)
    // -------------------------------------------------------------------------
    console.log("\n--- Testing D5: Slow bank timeout & deduplication (Level 4) ---");
    process.env.SLOW_BANK_DELAY_MS = "1200";
    fakeBank.setMode("slow");

    const d5_req = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
        "Idempotency-Key": "w-102",
      },
      body: JSON.stringify({ bankAccountId: rajuAcc1Id, amount: 10000 }),
    });
    const d5_data = await d5_req.json();
    const wd4Id = d5_data.withdrawal?.id;

    // Worker attempts with 400ms timeout (< 1200ms)
    const job4 = await claimNextJob();
    const job4Res1 = await processJob(job4, { bankUrl: BANK_URL, timeoutMs: 400, backoffBaseMs: 50 });
    check("D5: Slow bank call times out and yields RETRY (not refund)", job4Res1.status === "RETRY" && job4Res1.detail?.includes("timed out"), JSON.stringify(job4Res1));

    // Fast forward retry while bank is still processing
    await OutboxEvent.updateOne({ withdrawalId: wd4Id }, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });
    const job4Reclaimed = await claimNextJob();
    const job4Res2 = await processJob(job4Reclaimed, { bankUrl: BANK_URL, timeoutMs: 400, backoffBaseMs: 50 });
    check("D5: Second call handles ambiguous status safely", ["RETRY", "SUCCESS"].includes(job4Res2.status), JSON.stringify(job4Res2));

    // Wait for the 1200ms slow bank call to complete and record its result
    await new Promise((r) => setTimeout(r, 900));

    // Third call claims and finishes as SUCCESS
    await OutboxEvent.updateOne({ withdrawalId: wd4Id }, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });
    const job4Final = await claimNextJob();
    if (job4Final) {
      const job4Res3 = await processJob(job4Final, { bankUrl: BANK_URL });
      check("D5: Third call yields SUCCESS", job4Res3.status === "SUCCESS", JSON.stringify(job4Res3));
    }

    const wd4Doc = await Withdrawal.findById(wd4Id);
    check("D5: Slow bank withdrawal ultimately succeeds", wd4Doc.status === "SUCCESS", wd4Doc.status);
    check("D5: Bank remembers reference and paid once", fakeBank.payouts.get(wd4Doc.reference)?.status === "SUCCESS", "Reference remembered");
    check("D5: Fake bank recorded 3 calls for the same reference", fakeBank.calls[wd4Doc.reference] === 3, `Calls: ${fakeBank.calls[wd4Doc.reference]}`);

    fakeBank.setMode("normal");

    // -------------------------------------------------------------------------
    // D6: Outbox Persistence Across Crash
    // -------------------------------------------------------------------------
    console.log("\n--- Testing D6: Outbox persistence (Crash recovery) ---");
    const d6_req = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
        "Idempotency-Key": "w-103",
      },
      body: JSON.stringify({ bankAccountId: rajuAcc1Id, amount: 10000 }),
    });
    const d6_data = await d6_req.json();
    const wd5Id = d6_data.withdrawal?.id;

    // Simulate worker stopped: verify event exists in DB while status is PENDING
    const savedEvent = await OutboxEvent.findOne({ withdrawalId: wd5Id });
    check("D6: Outbox event persisted in DB before worker runs", savedEvent && savedEvent.status === "NEW", `Event status: ${savedEvent?.status}`);

    // Worker restarts and processes persisted event
    const job5 = await claimNextJob();
    const job5Res = await processJob(job5, { bankUrl: BANK_URL });
    check("D6: Restarted worker executes persisted job successfully", job5Res.status === "SUCCESS", JSON.stringify(job5Res));

    // -------------------------------------------------------------------------
    // D7: Giving Up Safely (NEEDS_REVIEW after 5 attempts)
    // -------------------------------------------------------------------------
    console.log("\n--- Testing D7: Giving up safely (NEEDS_REVIEW) ---");
    fakeBank.setMode("down");

    const d7_req = await fetch(`${BASE}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rajuToken}`,
        "Idempotency-Key": "w-201",
      },
      body: JSON.stringify({ bankAccountId: rajuAcc1Id, amount: 10000 }),
    });
    const d7_data = await d7_req.json();
    const wd6Id = d7_data.withdrawal?.id;

    // Simulate 5 attempts
    for (let attempt = 1; attempt <= 5; attempt++) {
      await OutboxEvent.updateOne({ withdrawalId: wd6Id }, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });
      const job = await claimNextJob();
      if (job) {
        await processJob(job, { bankUrl: BANK_URL, backoffBaseMs: 10 });
      }
    }

    const wd6Doc = await Withdrawal.findById(wd6Id);
    check("D7: After 5 attempts, withdrawal enters NEEDS_REVIEW", wd6Doc.status === "NEEDS_REVIEW", wd6Doc.status);

    const outbox6Doc = await OutboxEvent.findOne({ withdrawalId: wd6Id });
    check("D7: Outbox event enters terminal STUCK state", outbox6Doc.status === "STUCK", outbox6Doc.status);

    // Balance must NOT be refunded
    const rajuWalletAfterStuck = await Wallet.findOne({ userId: wd6Doc.userId });
    check("D7: Raju balance is NOT refunded while in NEEDS_REVIEW", rajuWalletAfterStuck.balance === 30000, `Balance: ${rajuWalletAfterStuck.balance}`);

    // Staff admin endpoint lists it
    const staffRes = await fetch(`${BASE}/api/v1/admin/withdrawals?status=NEEDS_REVIEW`, {
      headers: { "x-admin-key": ADMIN_KEY },
    });
    const staffData = await staffRes.json();
    check("D7: Staff endpoint lists NEEDS_REVIEW withdrawal", staffRes.status === 200 && staffData.withdrawals.some((w) => w.id === wd6Id), JSON.stringify(staffData));

    fakeBank.setMode("normal");

    // -------------------------------------------------------------------------
    // D8: History, Reconcile, and Privacy
    // -------------------------------------------------------------------------
    console.log("\n--- Testing D8: History, Reconcile, and Privacy ---");

    // Check transaction history
    const histRes = await fetch(`${BASE}/api/v1/wallet/transactions?limit=20`, {
      headers: { Authorization: `Bearer ${rajuToken}` },
    });
    const histData = await histRes.json();
    check("D8: History returns 200", histRes.status === 200, `Status: ${histRes.status}`);

    const withdrawalEntry = histData.transactions?.find((t) => t.type === "WITHDRAWAL");
    check("D8: WITHDRAWAL history shows 'Withdrawal to bank'", withdrawalEntry?.withWhom === "Withdrawal to bank", withdrawalEntry?.withWhom);

    const reversalEntry = histData.transactions?.find((t) => t.type === "REVERSAL");
    check("D8: REVERSAL history shows 'Refund of failed withdrawal'", reversalEntry?.withWhom === "Refund of failed withdrawal", reversalEntry?.withWhom);

    // Check reconciliation
    const recRes = await fetch(`${BASE}/api/v1/admin/reconcile`, {
      headers: { "x-admin-key": ADMIN_KEY },
    });
    const recData = await recRes.json();
    check("D8: Reconcile endpoint returns 200", recRes.status === 200, `Status: ${recRes.status}`);
    check("D8: Reconcile moneyIsConserved is true", recData.moneyIsConserved === true, JSON.stringify(recData));
    check("D8: Reconcile has 0 mismatches", recData.mismatches?.length === 0, JSON.stringify(recData.mismatches));
    check("D8: Reconcile moneyIn matches total deposits (100000)", recData.moneyIn === 100000, `MoneyIn: ${recData.moneyIn}`);
    check("D8: Reconcile totalBalance matches (30000)", recData.totalBalance === 30000, `TotalBalance: ${recData.totalBalance}`);
    check("D8: Reconcile net moneyOut matches (70000)", recData.moneyOut === 70000, `MoneyOut: ${recData.moneyOut}`);

    // Privacy isolation check: Priya attempts to fetch Raju's withdrawal -> 404
    const privRes = await fetch(`${BASE}/api/v1/wallet/withdrawals/${wd1Id}`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    check("D8 Privacy: Priya cannot view Raju's withdrawal by id -> 404", privRes.status === 404, `Status: ${privRes.status}`);

    const privDirectRes = await fetch(`${BASE}/api/v1/withdrawals/${wd1Id}`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    check("D8 Privacy: /withdrawals/:id alias also returns 404", privDirectRes.status === 404, `Status: ${privDirectRes.status}`);

    // Raju fetches own withdrawal -> 200
    const rajuOwnWd = await fetch(`${BASE}/api/v1/wallet/withdrawals/${wd1Id}`, {
      headers: { Authorization: `Bearer ${rajuToken}` },
    });
    const rajuOwnData = await rajuOwnWd.json();
    check("D8: Raju fetches own withdrawal -> 200", rajuOwnWd.status === 200 && rajuOwnData.withdrawal?.id === wd1Id, JSON.stringify(rajuOwnData));

    // -------------------------------------------------------------------------
    // Bonus 6: Concurrent Workers Deduplication
    // -------------------------------------------------------------------------
    console.log("\n--- Testing Bonus 6: Concurrent Workers Deduplication ---");

    // Insert a new outbox event
    const concurrentWd = await Withdrawal.create({
      userId: wd1Doc.userId,
      bankAccountId: rajuAcc1Id,
      amount: 10000,
      reference: `wd_concurrent_${Date.now()}`,
      status: "PENDING",
    });
    const concurrentEvent = await OutboxEvent.create({
      withdrawalId: concurrentWd._id,
      status: "NEW",
      attempts: 0,
      nextAttemptAt: new Date(),
    });

    // Two workers attempt to claim the exact same job concurrently
    const [workerAClaim, workerBClaim] = await Promise.all([
      claimNextJob(),
      claimNextJob(),
    ]);

    const claimsCount = [workerAClaim, workerBClaim].filter(Boolean).length;
    check("Bonus 6: Exactly one worker wins the atomic lease", claimsCount === 1, `Claims count: ${claimsCount}`);

    // Winner processes it
    const winnerJob = workerAClaim || workerBClaim;
    await processJob(winnerJob, { bankUrl: BANK_URL });
    const finalWd = await Withdrawal.findById(concurrentWd._id);
    check("Bonus 6: Payout processed exactly once", finalWd.status === "SUCCESS", finalWd.status);

    console.log("\n==========================================");
    console.log(`DAY 5 TEST SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED`);
    console.log("==========================================");

    if (failures > 0) {
      process.exit(1);
    }
  } finally {
    server.kill("SIGTERM");
    bankServer.close();
    await mongoose.disconnect();
    await replSet.stop();
  }
}

main().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
