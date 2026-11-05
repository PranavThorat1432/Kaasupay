// test/day8.test.js — Canonical Day 8 Acceptance Test Suite
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import mongoose from "mongoose";
import LedgerEntry from "../models/ledgerEntryModel.js";
import Transaction from "../models/transactionModel.js";
import Wallet from "../models/walletModel.js";
import { runBackfill } from "../tools/backfill-ledger-type.js";
import { rupees, csvCell, buildCsv } from "../services/csv.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3124;
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

// HTTP request helpers
async function post(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, headers: res.headers, json };
}

async function get(path, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "GET",
    headers: { ...headers },
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, headers: res.headers, json };
}

async function getRaw(path, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "GET",
    headers: { ...headers },
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

async function main() {
  console.log("===============================================================================");
  console.log("=== KAASUPAY DAY 8: HISTORY & CURSOR PAGINATION ACCEPTANCE SUITE ===");
  console.log("===============================================================================");

  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const mongoUri = replSet.getUri();

  const server = spawnServer({
    MONGO_URL: mongoUri,
    PORT: String(PORT),
    ADMIN_KEY,
    JWT_SECRET: process.env.JWT_SECRET || "day8_test_secret_32_characters_long",
  });

  const healthy = await waitForHealth();
  if (!healthy) {
    console.error("Server failed to start within timeout.\n", server.getOutput());
    await replSet.stop();
    process.exit(1);
  }
  console.log("Backend server started and healthy on port", PORT);

  await mongoose.connect(mongoUri, { dbName: "kaasupay" });

  try {
    // -------------------------------------------------------------------------
    // Setup Test Users
    // -------------------------------------------------------------------------
    console.log("\n--- Setup: Seed Users ---");
    const meenaSignup = await post("/api/v1/user/signup", {
      username: "meena@kaasupay.com",
      password: "Password123!",
      firstName: "Meena",
      lastName: "Rao",
    });
    check("Meena signup -> 201", meenaSignup.status === 201, JSON.stringify(meenaSignup));
    const meenaSignin = await post("/api/v1/user/signin", {
      username: "meena@kaasupay.com",
      password: "Password123!",
    });
    check("Meena signin -> 200", meenaSignin.status === 200, JSON.stringify(meenaSignin));
    const meenaToken = meenaSignin.json.token;

    const strangerSignup = await post("/api/v1/user/signup", {
      username: "stranger@kaasupay.com",
      password: "Password123!",
      firstName: "Stranger",
      lastName: "Danger",
    });
    check("Stranger signup -> 201", strangerSignup.status === 201, JSON.stringify(strangerSignup));
    const strangerSignin = await post("/api/v1/user/signin", {
      username: "stranger@kaasupay.com",
      password: "Password123!",
    });
    check("Stranger signin -> 200", strangerSignin.status === 200, JSON.stringify(strangerSignin));
    const strangerToken = strangerSignin.json.token;

    // -------------------------------------------------------------------------
    // D2: Invalid Input Tests
    // -------------------------------------------------------------------------
    console.log("\n--- D2: Invalid input tests ---");

    // Missing token
    const noAuth = await get("/api/v1/wallet/history");
    check("GET /wallet/history missing JWT -> 401", noAuth.status === 401, JSON.stringify(noAuth));

    // Limit validation
    const limit0 = await get("/api/v1/wallet/history?limit=0", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("limit=0 -> 400", limit0.status === 400, JSON.stringify(limit0));

    const limit51 = await get("/api/v1/wallet/history?limit=51", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("limit=51 -> 400", limit51.status === 400, JSON.stringify(limit51));

    const limitNegative = await get("/api/v1/wallet/history?limit=-1", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("limit=-1 -> 400", limitNegative.status === 400, JSON.stringify(limitNegative));

    const limitNaN = await get("/api/v1/wallet/history?limit=abc", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("limit=abc -> 400", limitNaN.status === 400, JSON.stringify(limitNaN));

    const limitFloat = await get("/api/v1/wallet/history?limit=10.5", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("limit=10.5 -> 400", limitFloat.status === 400, JSON.stringify(limitFloat));

    // Cursor validation
    const badCursorStr = await get("/api/v1/wallet/history?cursor=hello", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("cursor=hello -> 400", badCursorStr.status === 400, JSON.stringify(badCursorStr));
    check(
      "bad cursor error message matches 'Bad cursor'",
      badCursorStr.json?.message === "Bad cursor",
      JSON.stringify(badCursorStr.json)
    );

    const emptyObjCursor = Buffer.from(JSON.stringify({})).toString("base64url");
    const badCursorEmpty = await get(`/api/v1/wallet/history?cursor=${emptyObjCursor}`, {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("cursor={} -> 400 Bad cursor", badCursorEmpty.status === 400, JSON.stringify(badCursorEmpty));

    const badDateCursor = Buffer.from(
      JSON.stringify({ t: "not-a-date", id: "507f1f77bcf86cd799439011" })
    ).toString("base64url");
    const badCursorDate = await get(`/api/v1/wallet/history?cursor=${badDateCursor}`, {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("cursor with invalid date -> 400", badCursorDate.status === 400, JSON.stringify(badCursorDate));

    const badIdCursor = Buffer.from(
      JSON.stringify({ t: new Date().toISOString(), id: "invalid-id" })
    ).toString("base64url");
    const badCursorId = await get(`/api/v1/wallet/history?cursor=${badIdCursor}`, {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("cursor with invalid ObjectId -> 400", badCursorId.status === 400, JSON.stringify(badCursorId));

    // Empty history
    const emptyHistory = await get("/api/v1/wallet/history", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("empty history -> 200", emptyHistory.status === 200, JSON.stringify(emptyHistory));
    check("empty history items is empty array", Array.isArray(emptyHistory.json?.items) && emptyHistory.json.items.length === 0);
    check("empty history nextCursor is null", emptyHistory.json?.nextCursor === null);

    // -------------------------------------------------------------------------
    // D1: Three pages, no duplicates
    // -------------------------------------------------------------------------
    console.log("\n--- D1: Three pages, no duplicates ---");

    // Seed 45 deposits for Meena
    console.log("Seeding 45 deposits for Meena...");
    for (let i = 1; i <= 45; i++) {
      const dep = await post(
        "/api/v1/admin/deposit",
        {
          to: "meena@kaasupay.com",
          amount: 1000 + i, // distinct amounts
          note: `Deposit #${i}`,
        },
        { "x-admin-key": ADMIN_KEY }
      );
      if (dep.status !== 201) {
        throw new Error(`Deposit #${i} failed: ${JSON.stringify(dep)}`);
      }
    }

    // Page 1
    const page1Res = await get("/api/v1/wallet/history?limit=20", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Page 1 returns 200", page1Res.status === 200, JSON.stringify(page1Res));
    check("Page 1 returns exactly 20 items", page1Res.json?.items?.length === 20);
    check("Page 1 has non-null nextCursor", Boolean(page1Res.json?.nextCursor));

    const page1Items = page1Res.json.items;
    const page1Cursor = page1Res.json.nextCursor;

    // Verify cursor points to 20th item (last item of page 1)
    const decodedP1 = JSON.parse(Buffer.from(page1Cursor, "base64url").toString("utf8"));
    check(
      "Page 1 cursor corresponds to 20th item id",
      decodedP1.id === page1Items[19].id,
      `cursorId=${decodedP1.id} item19Id=${page1Items[19].id}`
    );

    // Verify item fields contract
    const firstItem = page1Items[0];
    check("Item has 'id'", typeof firstItem.id === "string");
    check("Item has 'type'", typeof firstItem.type === "string");
    check("Item has 'label'", typeof firstItem.label === "string");
    check("Item has 'direction'", firstItem.direction === "CREDIT" || firstItem.direction === "DEBIT");
    check("Item has integer 'amount'", Number.isInteger(firstItem.amount));
    check("Item has 'balanceAfter'", Number.isInteger(firstItem.balanceAfter));
    check("Item has 'note'", firstItem.note !== undefined);
    check("Item has 'at'", typeof firstItem.at === "string");

    // NOW INSERT DEPOSIT #46 between page 1 and page 2 fetches!
    console.log("Inserting new deposit #46 between page fetches...");
    const dep46 = await post(
      "/api/v1/admin/deposit",
      {
        to: "meena@kaasupay.com",
        amount: 99999,
        note: "Deposit #46 newly arrived",
      },
      { "x-admin-key": ADMIN_KEY }
    );
    check("Deposit #46 created -> 201", dep46.status === 201, JSON.stringify(dep46));
    const dep46TxnId = dep46.json.transactionId;

    // Page 2 using cursor from Page 1
    const page2Res = await get(`/api/v1/wallet/history?limit=20&cursor=${page1Cursor}`, {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Page 2 returns 200", page2Res.status === 200, JSON.stringify(page2Res));
    check("Page 2 returns exactly 20 items", page2Res.json?.items?.length === 20);
    check("Page 2 has non-null nextCursor", Boolean(page2Res.json?.nextCursor));

    const page2Items = page2Res.json.items;
    const page2Cursor = page2Res.json.nextCursor;

    // Page 3 using cursor from Page 2
    const page3Res = await get(`/api/v1/wallet/history?limit=20&cursor=${page2Cursor}`, {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Page 3 returns 200", page3Res.status === 200, JSON.stringify(page3Res));
    check("Page 3 returns remaining 5 items", page3Res.json?.items?.length === 5);
    check("Page 3 has nextCursor === null (last page)", page3Res.json?.nextCursor === null);

    const page3Items = page3Res.json.items;

    // Combine items from pages 1, 2, 3 (should be the original 45)
    const all45Items = [...page1Items, ...page2Items, ...page3Items];
    check("Total items across 3 pages is 45", all45Items.length === 45);

    const distinctIds = new Set(all45Items.map((it) => it.id));
    check("No duplicate records across pages (45 distinct IDs)", distinctIds.size === 45);

    // Verify deposit #46 is NOT in page 2 or page 3
    const contains46 = all45Items.some((it) => it.transactionId === dep46TxnId);
    check(
      "New deposit #46 did not shift or pollute cursor-paginated pages",
      !contains46,
      "Found deposit #46 in cursor-paginated pages"
    );

    // Verify ordering is strictly descending (newest first)
    let isSorted = true;
    for (let i = 1; i < all45Items.length; i++) {
      const prevDate = new Date(all45Items[i - 1].at).getTime();
      const currDate = new Date(all45Items[i].at).getTime();
      if (prevDate < currDate) {
        isSorted = false;
        break;
      }
    }
    check("Records across all pages are sorted newest first", isSorted);

    // Fresh Page 1 should now include deposit #46 at the top
    const freshP1 = await get("/api/v1/wallet/history?limit=20", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Fresh Page 1 returns 200", freshP1.status === 200);
    check(
      "Fresh Page 1 has deposit #46 as its first item",
      freshP1.json?.items?.[0]?.transactionId === dep46TxnId,
      `Expected ${dep46TxnId}, got ${freshP1.json?.items?.[0]?.transactionId}`
    );

    // -------------------------------------------------------------------------
    // Same-Timestamp Tie Breaker Test
    // -------------------------------------------------------------------------
    console.log("\n--- Same-Timestamp Tie Breaker Test ---");
    const testUserSignup = await post("/api/v1/user/signup", {
      username: "tieuser@kaasupay.com",
      password: "Password123!",
      firstName: "Tie",
      lastName: "Breaker",
    });
    const tieSignin = await post("/api/v1/user/signin", {
      username: "tieuser@kaasupay.com",
      password: "Password123!",
    });
    const tieToken = tieSignin.json.token;
    const tieUserId = testUserSignup.json?.user?._id;

    // Insert 2 entries with identical timestamp in LedgerEntry collection directly
    const fixedTimestamp = new Date("2026-11-04T12:00:00.000Z");
    const fakeTxnId = new mongoose.Types.ObjectId();

    const entry1 = await LedgerEntry.create({
      userId: tieUserId,
      transactionId: fakeTxnId,
      direction: "CREDIT",
      amount: 1000,
      balanceAfter: 1000,
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    });

    const entry2 = await LedgerEntry.create({
      userId: tieUserId,
      transactionId: fakeTxnId,
      direction: "CREDIT",
      amount: 2000,
      balanceAfter: 3000,
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    });

    // Page with limit 1
    const tiePage1 = await get("/api/v1/wallet/history?limit=1", {
      Authorization: `Bearer ${tieToken}`,
    });
    check("Tie breaker page 1 returns 200", tiePage1.status === 200);
    check("Tie breaker page 1 returns 1 item", tiePage1.json?.items?.length === 1);
    check("Tie breaker page 1 has nextCursor", Boolean(tiePage1.json?.nextCursor));

    const tiePage2 = await get(`/api/v1/wallet/history?limit=1&cursor=${tiePage1.json.nextCursor}`, {
      Authorization: `Bearer ${tieToken}`,
    });
    check("Tie breaker page 2 returns 200", tiePage2.status === 200);
    check("Tie breaker page 2 returns 1 item", tiePage2.json?.items?.length === 1);
    check("Tie breaker page 2 has nextCursor === null", tiePage2.json?.nextCursor === null);

    check(
      "Both same-timestamp entries retrieved across pages",
      tiePage1.json.items[0].id !== tiePage2.json.items[0].id
    );

    // -------------------------------------------------------------------------
    // User Isolation Test
    // -------------------------------------------------------------------------
    console.log("\n--- User Isolation Test ---");
    const strangerHistory = await get("/api/v1/wallet/history", {
      Authorization: `Bearer ${strangerToken}`,
    });
    check("Stranger history returns 200", strangerHistory.status === 200);
    check(
      "Stranger sees 0 items (Meena's records isolated)",
      strangerHistory.json?.items?.length === 0
    );

    // -------------------------------------------------------------------------
    // Backward Compatibility Verification
    // -------------------------------------------------------------------------
    console.log("\n--- Backward Compatibility: Existing /wallet/transactions ---");
    const legacyHistory = await get("/api/v1/wallet/transactions?page=1&limit=10", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("GET /wallet/transactions returns 200", legacyHistory.status === 200);
    check("Legacy response has 'page'", legacyHistory.json?.page === 1);
    check("Legacy response has 'limit'", legacyHistory.json?.limit === 10);
    check("Legacy response has 'total'", legacyHistory.json?.total === 46);
    check("Legacy response has 'totalPages'", legacyHistory.json?.totalPages === 5);
    check("Legacy response has 'data' array", Array.isArray(legacyHistory.json?.data));
    check("Legacy response has 'transactions' array", Array.isArray(legacyHistory.json?.transactions));

    // =========================================================================
    // LEVEL 2 — Denormalization, Backfill & History Filters
    // =========================================================================
    console.log("\n--- Level 2: Denormalization on New Records ---");

    // Verify deposits created in Phase 1 already have type: "DEPOSIT"
    const sampleEntry = await LedgerEntry.findOne({ userId: meenaSignup.json.user._id, direction: "CREDIT" });
    check("Deposit LedgerEntry contains type: 'DEPOSIT'", sampleEntry?.type === "DEPOSIT", `got: ${sampleEntry?.type}`);

    // Set PIN for Meena to perform a transfer
    const pinRes = await post(
      "/api/v1/user/pin",
      { pin: "5829", password: "Password123!" },
      { Authorization: `Bearer ${meenaToken}` }
    );
    check("Meena sets payment PIN -> 200", pinRes.status === 200, JSON.stringify(pinRes));

    // Perform transfer from Meena to Stranger
    const transferRes = await post(
      "/api/v1/wallet/transfer",
      {
        to: "stranger@kaasupay.com",
        amount: 2500,
        note: "Testing transfer type denormalization",
        pin: "5829",
      },
      {
        Authorization: `Bearer ${meenaToken}`,
        "Idempotency-Key": "xfer-day8-phase2-001",
      }
    );
    check("Meena transfers ₹25 to Stranger -> 200", transferRes.status === 200, JSON.stringify(transferRes));

    // Check DEBIT and CREDIT ledger entries for the transfer
    const xferDebit = await LedgerEntry.findOne({
      userId: meenaSignup.json.user._id,
      direction: "DEBIT",
    });
    check("Transfer DEBIT LedgerEntry contains type: 'TRANSFER'", xferDebit?.type === "TRANSFER", `got: ${xferDebit?.type}`);

    const xferCredit = await LedgerEntry.findOne({
      userId: strangerSignup.json.user._id,
      direction: "CREDIT",
    });
    check("Transfer CREDIT LedgerEntry contains type: 'TRANSFER'", xferCredit?.type === "TRANSFER", `got: ${xferCredit?.type}`);

    // -------------------------------------------------------------------------
    // Backfill Script Idempotency Verification
    // -------------------------------------------------------------------------
    console.log("\n--- Level 2: Backfill Script Verification ---");

    // Insert a dummy Transaction and a LedgerEntry lacking 'type'
    // Fetch Meena's current wallet to get exact current balance
    const meenaWalletBeforeDummy = await Wallet.findOne({ userId: meenaSignup.json.user._id });
    const dummyAmount = 5000;
    const newBalAfterDummy = (meenaWalletBeforeDummy?.balance || 0) + dummyAmount;

    const dummyTxn = await Transaction.create({
      type: "TOPUP",
      fromUserId: null,
      toUserId: meenaSignup.json.user._id,
      amount: dummyAmount,
      note: "Old legacy topup",
      status: "COMPLETED",
    });

    const dummyEntry = await LedgerEntry.create({
      userId: meenaSignup.json.user._id,
      transactionId: dummyTxn._id,
      direction: "CREDIT",
      amount: dummyAmount,
      balanceAfter: newBalAfterDummy,
      // No type field provided!
    });
    // Update wallet balance to match
    await Wallet.updateOne({ userId: meenaSignup.json.user._id }, { $inc: { balance: dummyAmount } });
    check("Created dummy entry without type", dummyEntry.type === undefined);

    // Run backfill pass 1
    const backfill1 = await runBackfill({ verbose: false });
    check("Backfill pass 1 fixed at least 1 record", backfill1.fixed >= 1, `fixed: ${backfill1.fixed}`);

    // Verify dummy entry was updated with original transaction's type
    const updatedDummy = await LedgerEntry.findById(dummyEntry._id);
    check("Dummy entry now has type 'TOPUP' after backfill", updatedDummy?.type === "TOPUP", `type: ${updatedDummy?.type}`);

    // Run backfill pass 2 (Idempotency)
    const backfill2 = await runBackfill({ verbose: false });
    check("Backfill pass 2 fixed 0 rows (idempotent)", backfill2.fixed === 0, `fixed: ${backfill2.fixed}`);

    // -------------------------------------------------------------------------
    // Direction & Type Filter Tests
    // -------------------------------------------------------------------------
    console.log("\n--- Level 2: Direction & Type Filters ---");

    // Invalid direction -> 400
    const invDir = await get("/api/v1/wallet/history?direction=INVALID", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Invalid direction returns 400", invDir.status === 400);

    // Filter direction=DEBIT -> should only return the 1 transfer
    const debitOnly = await get("/api/v1/wallet/history?direction=DEBIT", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("direction=DEBIT returns 200", debitOnly.status === 200);
    check("direction=DEBIT returns only DEBIT items", debitOnly.json.items.every((it) => it.direction === "DEBIT"));
    check("direction=DEBIT returns 1 item", debitOnly.json.items.length === 1);

    // Filter direction=CREDIT -> should only return credits (deposits + backfilled topup)
    const creditOnly = await get("/api/v1/wallet/history?direction=CREDIT&limit=50", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("direction=CREDIT returns 200", creditOnly.status === 200);
    check("direction=CREDIT returns only CREDIT items", creditOnly.json.items.every((it) => it.direction === "CREDIT"));

    // Invalid type -> 400
    const invType = await get("/api/v1/wallet/history?type=INVALID", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Invalid type returns 400", invType.status === 400);

    // Filter type=TRANSFER -> returns only the transfer
    const xferFilter = await get("/api/v1/wallet/history?type=TRANSFER", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("type=TRANSFER returns 200", xferFilter.status === 200);
    check("type=TRANSFER returns 1 item", xferFilter.json.items.length === 1);
    check("type=TRANSFER item type is 'TRANSFER'", xferFilter.json.items[0].type === "TRANSFER");

    // Filter type=WITHDRAWAL -> 0 items
    const wdrFilter = await get("/api/v1/wallet/history?type=WITHDRAWAL", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("type=WITHDRAWAL returns 200", wdrFilter.status === 200);
    check("type=WITHDRAWAL returns 0 items for Meena", wdrFilter.json.items.length === 0);

    // -------------------------------------------------------------------------
    // India Standard Time (IST) Date Filtering Tests
    // -------------------------------------------------------------------------
    console.log("\n--- Level 2: India Standard Time Date Filtering ---");

    // Today in IST
    const nowIst = new Date(Date.now() + 5.5 * 3600000);
    const todayIstStr = nowIst.toISOString().slice(0, 10);

    // Invalid date formats -> 400
    const badFrom = await get("/api/v1/wallet/history?from=not-a-date", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Invalid from date returns 400", badFrom.status === 400);

    const badTo = await get("/api/v1/wallet/history?to=2026-13-40", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Invalid to date returns 400", badTo.status === 400);

    // from after to -> 400
    const invRange = await get("/api/v1/wallet/history?from=2026-11-20&to=2026-11-10", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("from after to returns 400", invRange.status === 400);
    check("from after to error message matches", invRange.json.message === "from must not be after to");

    // Filter with today IST range: should include today's activity
    const todayFilter = await get(`/api/v1/wallet/history?from=${todayIstStr}&to=${todayIstStr}`, {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Filtering by today IST returns 200", todayFilter.status === 200);
    check("Today's records found in IST range", todayFilter.json.items.length > 0);

    // Seed a transaction specifically at 23:59:00 IST on 2026-10-15 (18:29 UTC on 2026-10-15)
    // 2026-10-15 23:59:00 IST = 2026-10-15T18:29:00.000Z
    const lateEveningIst = new Date("2026-10-15T18:29:00.000Z");
    const lateEntry = await LedgerEntry.create({
      userId: meenaSignup.json.user._id,
      transactionId: dummyTxn._id,
      direction: "CREDIT",
      type: "DEPOSIT",
      amount: 7777,
      balanceAfter: 107777,
      createdAt: lateEveningIst,
      updatedAt: lateEveningIst,
    });
    await LedgerEntry.updateOne({ _id: lateEntry._id }, { $set: { createdAt: lateEveningIst } });

    // Filter strictly on 2026-10-15
    const lateFilter = await get("/api/v1/wallet/history?from=2026-10-15&to=2026-10-15", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Query 2026-10-15 includes transaction made at 23:59 IST", lateFilter.json.items.some((it) => it.id === lateEntry._id.toString()));

    // Clean up lateEntry so it does not corrupt the financial balance chain
    await LedgerEntry.deleteOne({ _id: lateEntry._id });

    // Verify 2026-10-14 excludes this transaction
    const beforeFilter = await get("/api/v1/wallet/history?from=2026-10-14&to=2026-10-14", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Query 2026-10-14 excludes transaction made on 2026-10-15", !beforeFilter.json.items.some((it) => it.id === lateEntry._id.toString()));

    // -------------------------------------------------------------------------
    // Combined Filters & Pagination
    // -------------------------------------------------------------------------
    console.log("\n--- Level 2: Combined Filters & Cursor Pagination ---");

    const combPage1 = await get("/api/v1/wallet/history?direction=CREDIT&type=DEPOSIT&limit=15", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Combined filters page 1 returns 200", combPage1.status === 200);
    check("Combined page 1 returns 15 items", combPage1.json.items.length === 15);
    check("All page 1 items are CREDIT & DEPOSIT", combPage1.json.items.every((it) => it.direction === "CREDIT" && it.type === "DEPOSIT"));
    check("Combined page 1 has nextCursor", Boolean(combPage1.json.nextCursor));

    const combPage2 = await get(
      `/api/v1/wallet/history?direction=CREDIT&type=DEPOSIT&limit=15&cursor=${combPage1.json.nextCursor}`,
      { Authorization: `Bearer ${meenaToken}` }
    );
    check("Combined page 2 returns 200", combPage2.status === 200);
    check("Combined page 2 returns 15 items", combPage2.json.items.length === 15);
    check("All page 2 items are CREDIT & DEPOSIT", combPage2.json.items.every((it) => it.direction === "CREDIT" && it.type === "DEPOSIT"));
    check("Combined page 2 has nextCursor", Boolean(combPage2.json.nextCursor));

    // =========================================================================
    // LEVEL 3 — Compound Indexes and Query Optimization
    // =========================================================================
    console.log("\n--- Level 3: Compound Indexes Verification ---");

    // Check schema indexes
    const schemaIndexes = LedgerEntry.schema.indexes();
    const hasMainCompound = schemaIndexes.some(([idx]) => idx.userId === 1 && idx.createdAt === -1 && idx._id === -1);
    const hasTypeCompound = schemaIndexes.some(([idx]) => idx.userId === 1 && idx.type === 1 && idx.createdAt === -1 && idx._id === -1);
    const hasTxnIndex = schemaIndexes.some(([idx]) => idx.transactionId === 1);

    check("Compound index { userId: 1, createdAt: -1, _id: -1 } registered", hasMainCompound);
    check("Compound index { userId: 1, type: 1, createdAt: -1, _id: -1 } registered", hasTypeCompound);
    check("TransactionId index { transactionId: 1 } preserved", hasTxnIndex);

    // Verify index usage with explain()
    const explainPlan = await LedgerEntry.find({ userId: meenaSignup.json.user._id })
      .sort({ createdAt: -1, _id: -1 })
      .limit(20)
      .explain("executionStats");

    const winningStage = explainPlan.queryPlanner.winningPlan.stage;
    const totalExamined = explainPlan.executionStats.totalDocsExamined;

    check("Explain plan does not use in-memory SORT stage", winningStage !== "SORT", `winningStage: ${winningStage}`);
    check("Explain plan examined at most 20 documents for limit 20", totalExamined <= 20, `totalExamined: ${totalExamined}`);

    // =========================================================================
    // LEVEL 4 — Monthly Financial Statements
    // =========================================================================
    console.log("\n--- Level 4: Monthly Financial Statements ---");

    // 1. Missing month parameter -> 400
    const missingMonth = await get("/api/v1/wallet/statement", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Missing month returns 400", missingMonth.status === 400);

    // 2. Invalid month formats -> 400
    const badMonth1 = await get("/api/v1/wallet/statement?month=2026-13", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Month 2026-13 returns 400", badMonth1.status === 400);

    const badMonth2 = await get("/api/v1/wallet/statement?month=Nov-2026", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Month Nov-2026 returns 400", badMonth2.status === 400);

    const badMonth3 = await get("/api/v1/wallet/statement?month=2026-00", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Month 2026-00 returns 400", badMonth3.status === 400);

    // 3. Statement for current month (November 2026)
    // Meena has 46 deposits + 1 transfer debit in November 2026.
    // Opening balance before Nov was 0.
    // Total in = 46 * 1000 = 46000 + 5000 (dummy topup) = 51000.
    // Total out = 2500 (transfer to stranger).
    // Closing balance = 51000 - 2500 = 48500.
    const currentMonthStr = "2026-11";
    const novStatement = await get(`/api/v1/wallet/statement?month=${currentMonthStr}`, {
      Authorization: `Bearer ${meenaToken}`,
    });
    console.log("novStatement response:", JSON.stringify(novStatement.json));
    check(`GET /wallet/statement?month=${currentMonthStr} returns 200`, novStatement.status === 200);
    check(`Statement has month '${currentMonthStr}'`, novStatement.json?.month === currentMonthStr);
    check("Statement openingBalance is number", typeof novStatement.json?.openingBalance === "number");
    check("Statement totalIn > 0", novStatement.json?.totalIn > 0);
    check("Statement totalOut > 0", novStatement.json?.totalOut > 0);
    check("Statement entries >= 47", novStatement.json?.entries >= 47);
    check(
      "Statement check formula holds: openingBalance + totalIn - totalOut === closingBalance",
      novStatement.json?.openingBalance + novStatement.json?.totalIn - novStatement.json?.totalOut === novStatement.json?.closingBalance
    );
    check("Statement check flag is true", novStatement.json?.check === true);

    // 4. Statement for an empty month in the distant past (e.g. 2025-01)
    const emptyPastStatement = await get("/api/v1/wallet/statement?month=2025-01", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Empty past month returns 200", emptyPastStatement.status === 200);
    check("Empty past month openingBalance is 0", emptyPastStatement.json?.openingBalance === 0);
    check("Empty past month totalIn is 0", emptyPastStatement.json?.totalIn === 0);
    check("Empty past month totalOut is 0", emptyPastStatement.json?.totalOut === 0);
    check("Empty past month closingBalance is 0", emptyPastStatement.json?.closingBalance === 0);
    check("Empty past month entries is 0", emptyPastStatement.json?.entries === 0);
    check("Empty past month check is true", emptyPastStatement.json?.check === true);

    // 5. Statement for an empty month in the future (e.g. 2030-01) - opening should equal current closing balance
    const futureStatement = await get("/api/v1/wallet/statement?month=2030-01", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Future empty month returns 200", futureStatement.status === 200);
    check("Future empty month openingBalance > 0", futureStatement.json?.openingBalance > 0);
    check("Future empty month totalIn is 0", futureStatement.json?.totalIn === 0);
    check("Future empty month totalOut is 0", futureStatement.json?.totalOut === 0);
    check(
      "Future empty month closingBalance equals openingBalance",
      futureStatement.json?.closingBalance === futureStatement.json?.openingBalance
    );
    check("Future empty month entries is 0", futureStatement.json?.entries === 0);
    check("Future empty month check is true", futureStatement.json?.check === true);

    // 6. User Isolation for Statements
    const strangerStatement = await get("/api/v1/wallet/statement?month=2026-10", {
      Authorization: `Bearer ${strangerToken}`,
    });
    check("Stranger statement returns 200", strangerStatement.status === 200);
    check("Stranger statement entries is 0", strangerStatement.json?.entries === 0);
    check("Stranger statement totalIn is 0", strangerStatement.json?.totalIn === 0);
    check("Stranger statement check is true", strangerStatement.json?.check === true);
    // =========================================================================
    // LEVEL 5 — Secure CSV Statement Export
    // =========================================================================
    console.log("\n--- Level 5: Secure CSV Statement Export ---");

    // D5: CSV Unit Tests (RFC-4180 escaping, Formula Injection, Integer Rupee conversion)
    check("Rupees 2500 paise -> '25.00'", rupees(2500) === "25.00");
    check("Rupees 50 paise -> '0.50'", rupees(50) === "0.50");
    check("Rupees 5 paise -> '0.05'", rupees(5) === "0.05");
    check("Rupees 0 paise -> '0.00'", rupees(0) === "0.00");
    check("Rupees 100000 paise -> '1000.00'", rupees(100000) === "1000.00");
    check("Rupees null -> ''", rupees(null) === "");

    // Formula injection tests
    check("csvCell formula =SUM(A1) escaped with leading single quote", csvCell("=SUM(A1:B10)") === "'=SUM(A1:B10)");
    check("csvCell formula +cmd escaped", csvCell("+1234") === "'+1234");
    check("csvCell formula -2+3 escaped", csvCell("-cmd|' /C calc'!A0") === "'-cmd|' /C calc'!A0");
    check("csvCell formula @import escaped", csvCell("@import") === "'@import");

    // RFC-4180 escaping
    check("csvCell with comma wrapped in quotes", csvCell("Transfer to Raju, via UPI") === '"Transfer to Raju, via UPI"');
    check('csvCell with quote doubled and wrapped', csvCell('Payment for "Groceries"') === '"Payment for ""Groceries"""');
    check("csvCell normal string unquoted", csvCell("Transfer") === "Transfer");

    // D6: CSV Integration Endpoint Tests
    // 1. Missing month parameter -> 400
    const csvMissingMonth = await get("/api/v1/wallet/statement/csv", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("CSV missing month returns 400", csvMissingMonth.status === 400);

    // 2. Bad month parameter -> 400
    const csvBadMonth = await get("/api/v1/wallet/statement/csv?month=2026-13", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("CSV bad month returns 400", csvBadMonth.status === 400);

    // 3. Unauthorized request -> 401
    const csvUnauth = await get("/api/v1/wallet/statement/csv?month=2026-11");
    check("CSV unauthenticated returns 401", csvUnauth.status === 401);

    // 4. Successful November CSV export
    const csvResponse = await getRaw("/api/v1/wallet/statement/csv?month=2026-11", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("GET /wallet/statement/csv returns 200", csvResponse.status === 200);
    check(
      "Content-Type is text/csv; charset=utf-8",
      csvResponse.headers.get("content-type")?.includes("text/csv")
    );
    check(
      "Content-Disposition specifies attachment with filename",
      csvResponse.headers.get("content-disposition") === 'attachment; filename="kaasupay-2026-11.csv"'
    );

    // Parse CSV lines
    const csvText = csvResponse.text;
    const lines = csvText.trim().split("\r\n");
    console.log("CSV line 1:", lines[1]);
    console.log("CSV line 2:", lines[2]);
    check("CSV has header row and entry rows", lines.length >= 48); // 1 header + >= 47 entries

    const expectedHeader = "Date,Type,Description,Debit (Rs),Credit (Rs),Balance (Rs)";
    check("CSV header row matches standard specification", lines[0] === expectedHeader);

    // Verify oldest first ordering (first entry should be Deposit #1, not #46)
    check("First data line is oldest transaction (Deposit #1)", lines[1].includes("Deposit #1"));
    check("Last data line contains recent transaction", lines[lines.length - 1].length > 0);

    // Verify Empty Month CSV Export
    const emptyCsvResponse = await getRaw("/api/v1/wallet/statement/csv?month=2025-01", {
      Authorization: `Bearer ${meenaToken}`,
    });
    check("Empty month CSV returns 200", emptyCsvResponse.status === 200);
    const emptyLines = emptyCsvResponse.text.trim().split("\r\n");
    check("Empty month CSV has only header row", emptyLines.length === 1 && emptyLines[0] === expectedHeader);
  } finally {
    await mongoose.disconnect();
    server.kill("SIGTERM");
    await replSet.stop();
  }

  console.log("\n===============================================================================");
  console.log(`=== DAY 8 PHASE 1-5 ACCEPTANCE SUITE: ${passedAssertions} PASSED, ${failures} FAILED ===`);
  console.log("===============================================================================");

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error running Day 8 tests:", err);
  process.exit(1);
});
