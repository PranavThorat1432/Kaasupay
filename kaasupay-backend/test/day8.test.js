// test/day8.test.js — Canonical Day 8 Acceptance Test Suite
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import mongoose from "mongoose";
import LedgerEntry from "../models/ledgerEntryModel.js";

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

  } finally {
    await mongoose.disconnect();
    server.kill("SIGTERM");
    await replSet.stop();
  }

  console.log("\n===============================================================================");
  console.log(`=== DAY 8 PHASE 1 ACCEPTANCE SUITE: ${passedAssertions} PASSED, ${failures} FAILED ===`);
  console.log("===============================================================================");

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error running Day 8 tests:", err);
  process.exit(1);
});
