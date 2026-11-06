// test/day9.test.js — Canonical Day 9 Cashback Scratch Cards & Promo Ledger Suite (D1 through D7 + Bonus 6 Concurrency Race)
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import mongoose from "mongoose";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3125;
const BASE = `http://localhost:${PORT}`;
const API = `${BASE}/api/v1`;
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

async function post(path, body, token = null, extraHeaders = {}) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function get(path, token = null, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method: "GET",
    headers,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log("===============================================================================");
  console.log("=== KAASUPAY DAY 9: CASHBACK SCRATCH CARDS ACCEPTANCE SUITE (D1 to D7) ===");
  console.log("===============================================================================");

  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const mongoUri = replSet.getUri();

  const server = spawnServer({
    PORT: String(PORT),
    MONGO_URL: mongoUri,
    MONGO_URI: mongoUri,
    ADMIN_KEY,
    JWT_SECRET: "test_jwt_secret_cashback_day9",
    DISABLE_BANK: "true",
  });

  const healthy = await waitForHealth();
  if (!healthy) {
    console.error("Server failed to start. Logs:\n", server.getOutput());
    process.exit(1);
  }
  console.log(`Backend server started and healthy on port ${PORT}\n`);

  try {
    // --- Setup: Users Arun, Bala, Chitra ---
    console.log("--- Setup: Seed Users & Payment PINs ---");
    const arunSignup = await post("/user/signup", {
      username: "arun@test.local",
      firstName: "Arun",
      lastName: "Kumar",
      password: "password123",
    });
    check("Arun signup -> 201", arunSignup.status === 201);

    const arunSignin = await post("/user/signin", {
      username: "arun@test.local",
      password: "password123",
    });
    const arunToken = arunSignin.data.token;
    const arunId = arunSignup.data.user._id;

    const balaSignup = await post("/user/signup", {
      username: "bala@test.local",
      firstName: "Bala",
      lastName: "Murugan",
      password: "password123",
    });
    check("Bala signup -> 201", balaSignup.status === 201);

    const balaSignin = await post("/user/signin", {
      username: "bala@test.local",
      password: "password123",
    });
    const balaToken = balaSignin.data.token;
    const balaId = balaSignup.data.user._id;

    const chitraSignup = await post("/user/signup", {
      username: "chitra@test.local",
      firstName: "Chitra",
      lastName: "Raman",
      password: "password123",
    });
    check("Chitra signup -> 201", chitraSignup.status === 201);

    const chitraSignin = await post("/user/signin", {
      username: "chitra@test.local",
      password: "password123",
    });
    const chitraToken = chitraSignin.data.token;
    const chitraId = chitraSignup.data.user._id;

    // Set PINs: Arun 2468, Bala 1357, Chitra 9024
    const pin1 = await post("/user/pin", { password: "password123", pin: "2468" }, arunToken);
    check("Set Arun PIN -> 200", pin1.status === 200);
    const pin2 = await post("/user/pin", { password: "password123", pin: "1357" }, balaToken);
    check("Set Bala PIN -> 200", pin2.status === 200);
    const pin3 = await post("/user/pin", { password: "password123", pin: "9024" }, chitraToken);
    check("Set Chitra PIN -> 200", pin3.status === 200);

    // Initial Deposit for Arun: ₹10,000 (1,000,000 paise) via staff deposit
    const arunDeposit = await post(
      "/admin/deposit",
      { to: "arun@test.local", amount: 1000000, note: "Initial seed deposit" },
      null,
      { "x-admin-key": ADMIN_KEY }
    );
    check("Deposit ₹10,000 for Arun -> 201", arunDeposit.status === 201);

    // --- D1: Create the offer ---
    console.log("\n--- D1: Create the offer ---");
    const d1Offer = await post(
      "/admin/offers",
      {
        code: "DIWALI",
        percent: 5,
        maxCashback: 5000,
        minPayment: 10000,
        budget: 10000,
        days: 7,
      },
      null,
      { "x-admin-key": ADMIN_KEY }
    );
    check("POST /admin/offers returns 201", d1Offer.status === 201);
    check("Offer code is DIWALI", d1Offer.data.offer?.code === "DIWALI");
    check("Offer budget is 10000 paise", d1Offer.data.offer?.budget === 10000);
    check("Offer budgetLeft starts at 10000", d1Offer.data.offer?.budgetLeft === 10000);

    // Duplicate offer code
    const d1Dup = await post(
      "/admin/offers",
      {
        code: "DIWALI",
        percent: 5,
        maxCashback: 5000,
        minPayment: 10000,
        budget: 10000,
        days: 7,
      },
      null,
      { "x-admin-key": ADMIN_KEY }
    );
    check("Duplicate code returns 409", d1Dup.status === 409);
    check("Duplicate message is Offer code already exists", d1Dup.data.message === "Offer code already exists");

    // Invalid percent: 80
    const d1Invalid = await post(
      "/admin/offers",
      {
        code: "PONGAL",
        percent: 80,
        maxCashback: 5000,
        minPayment: 10000,
        budget: 10000,
        days: 7,
      },
      null,
      { "x-admin-key": ADMIN_KEY }
    );
    check("percent: 80 returns 400", d1Invalid.status === 400);
    check("Invalid inputs message returned", d1Invalid.data.message === "Invalid inputs");

    // Reconcile check after offer creation
    const rec1 = await get("/admin/reconcile", null, { "x-admin-key": ADMIN_KEY });
    check("Reconcile returns 200", rec1.status === 200);
    check("moneyIsConserved is true after promo deposit", rec1.data.moneyIsConserved === true);

    // --- D2: Which payments get a card ---
    console.log("\n--- D2: Which payments get a card ---");
    // Arun sends Bala ₹50 (5000 paise) -> under ₹100 minPayment -> no card
    const pay50 = await post(
      "/wallet/transfer",
      { to: "bala@test.local", amount: 5000, note: "Under min ₹50", pin: "2468" },
      arunToken,
      { "Idempotency-Key": "pay_50_idemp_key_1" }
    );
    check("Arun sends Bala ₹50 -> 200", pay50.status === 200);

    let arunRewards = await get("/rewards", arunToken);
    check("GET /rewards returns 200", arunRewards.status === 200);
    check("No card for payment under ₹100", arunRewards.data.cards.length === 0);

    // Arun sends Bala ₹200 (20000 paise) -> eligible for card (5% of 20000 = 1000 paise = ₹10)
    const pay200 = await post(
      "/wallet/transfer",
      { to: "bala@test.local", amount: 20000, note: "Eligible ₹200", pin: "2468" },
      arunToken,
      { "Idempotency-Key": "pay_200_idemp_key_2" }
    );
    check("Arun sends Bala ₹200 -> 200", pay200.status === 200);

    arunRewards = await get("/rewards", arunToken);
    check("Arun now has 1 reward card", arunRewards.data.cards.length === 1);
    const card1 = arunRewards.data.cards[0];
    check("Card 1 status is UNCLAIMED", card1.status === "UNCLAIMED");
    check("Card 1 amount is obfuscated (null)", card1.amount === null);
    check("Card 1 offer is DIWALI", card1.offer === "DIWALI");
    check("Card 1 has expiresAt", Boolean(card1.expiresAt));

    // --- D3: Caps and the daily rule ---
    console.log("\n--- D3: Caps and the daily rule ---");
    // Arun sends Bala ₹1,000 (100000 paise) -> card (5% = ₹50 = 5000 paise)
    const pay1000 = await post(
      "/wallet/transfer",
      { to: "bala@test.local", amount: 100000, note: "Card 2: ₹1,000", pin: "2468" },
      arunToken,
      { "Idempotency-Key": "pay_1000_idemp_key_3" }
    );
    check("Arun sends Bala ₹1,000 -> 200", pay1000.status === 200);

    // Arun sends Bala ₹2,000 (200000 paise) -> card (5% = ₹100, capped at maxCashback ₹50 = 5000 paise)
    const pay2000 = await post(
      "/wallet/transfer",
      { to: "bala@test.local", amount: 200000, note: "Card 3: ₹2,000", pin: "2468" },
      arunToken,
      { "Idempotency-Key": "pay_2000_idemp_key_4" }
    );
    check("Arun sends Bala ₹2,000 -> 200", pay2000.status === 200);

    // Arun sends Bala ₹300 (30000 paise) -> 4th payment today -> quietly gets NO card
    const pay300 = await post(
      "/wallet/transfer",
      { to: "bala@test.local", amount: 30000, note: "4th payment: ₹300", pin: "2468" },
      arunToken,
      { "Idempotency-Key": "pay_300_idemp_key_5" }
    );
    check("Arun sends Bala ₹300 -> 200", pay300.status === 200);

    arunRewards = await get("/rewards", arunToken);
    check("Arun still has exactly 3 cards (capped at 3 per day)", arunRewards.data.cards.length === 3);
    check("All 3 cards have status UNCLAIMED", arunRewards.data.cards.every((c) => c.status === "UNCLAIMED"));
    check("All 3 cards have amount: null", arunRewards.data.cards.every((c) => c.amount === null));

    // Sort cards chronologically (oldest to newest)
    const sortedCards = [...arunRewards.data.cards].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    // --- D4: Scratch ---
    console.log("\n--- D4: Scratch cards from oldest to newest ---");
    // Card 1 (₹200 payment) -> wins ₹10.00 (1000 paise)
    const claim1 = await post(`/rewards/${sortedCards[0].id}/claim`, {}, arunToken);
    check("Claim card 1 returns 200", claim1.status === 200);
    check("Claim card 1 message is 'You won ₹10.00'", claim1.data.message === "You won ₹10.00");
    check("Claim card 1 amount is 1000 paise", claim1.data.amount === 1000);
    check("Claim card 1 status is CLAIMED", claim1.data.status === "CLAIMED");
    check("Arun balance is updated to 646000", claim1.data.balance === 646000);

    // Card 1 again -> 409
    const claim1Again = await post(`/rewards/${sortedCards[0].id}/claim`, {}, arunToken);
    check("Claim card 1 again returns 409", claim1Again.status === 409);
    check("Message is 'This card is already CLAIMED'", claim1Again.data.message === "This card is already CLAIMED");

    // Bala tries to claim Card 2 -> 404 (stranger cannot claim another user's card)
    const balaClaimCard2 = await post(`/rewards/${sortedCards[1].id}/claim`, {}, balaToken);
    check("Bala claims Card 2 returns 404", balaClaimCard2.status === 404);
    check("Stranger claim message is 'Card not found'", balaClaimCard2.data.message === "Card not found");

    // Card 2 (₹1,000 payment) -> wins ₹50.00 (5000 paise)
    const claim2 = await post(`/rewards/${sortedCards[1].id}/claim`, {}, arunToken);
    check("Claim card 2 returns 200", claim2.status === 200);
    check("Claim card 2 message is 'You won ₹50.00'", claim2.data.message === "You won ₹50.00");
    check("Claim card 2 amount is 5000 paise", claim2.data.amount === 5000);
    check("Claim card 2 status is CLAIMED", claim2.data.status === "CLAIMED");
    check("Arun balance is updated to 651000", claim2.data.balance === 651000);

    // Total budget spent = 1000 + 5000 = 6000 paise. Remaining budget = 10000 - 6000 = 4000 paise.
    // Card 3 needs ₹50 (5000 paise), but remaining budget is 4000 paise -> EXHAUSTED!
    const claim3 = await post(`/rewards/${sortedCards[2].id}/claim`, {}, arunToken);
    check("Claim card 3 with insufficient budget returns 200", claim3.status === 200);
    check("Message is 'Better luck next time'", claim3.data.message === "Better luck next time");
    check("Amount is 0 paise", claim3.data.amount === 0);
    check("Status is EXHAUSTED", claim3.data.status === "EXHAUSTED");

    // Card 3 again -> 409
    const claim3Again = await post(`/rewards/${sortedCards[2].id}/claim`, {}, arunToken);
    check("Claim card 3 again returns 409", claim3Again.status === 409);
    check("Message is 'This card is already EXHAUSTED'", claim3Again.data.message === "This card is already EXHAUSTED");

    // Verify Arun's history shows Cashback rows
    const historyRes = await get("/wallet/history", arunToken);
    check("GET /wallet/history returns 200", historyRes.status === 200);
    const cashbackRows = historyRes.data.items.filter((item) => item.type === "CASHBACK");
    check("History has exactly 2 Cashback rows", cashbackRows.length === 2);
    check("Cashback row label is 'Cashback'", cashbackRows.every((r) => r.label === "Cashback"));

    // --- D5: Ping pong anti-abuse detection ---
    console.log("\n--- D5: Anti-Ping-Pong Detection ---");
    // Bala sends Arun ₹500 (50000 paise). Since Arun paid Bala earlier today, Bala's payment gets NO card!
    const balaPingPong = await post(
      "/wallet/transfer",
      { to: "arun@test.local", amount: 50000, note: "Ping pong attempt", pin: "1357" },
      balaToken,
      { "Idempotency-Key": "bala_ping_pong_1" }
    );
    check("Bala sends Arun ₹500 -> 200 Transfer successful", balaPingPong.status === 200);

    const balaRewards = await get("/rewards", balaToken);
    check("Bala gets NO scratch card due to ping-pong block", balaRewards.data.cards.length === 0);

    // Chitra gets ₹1,000 by staff deposit, then sends Bala ₹500
    const chitraDeposit = await post(
      "/admin/deposit",
      { to: "chitra@test.local", amount: 100000, note: "Chitra seed" },
      null,
      { "x-admin-key": ADMIN_KEY }
    );
    check("Staff deposits ₹1,000 to Chitra -> 201", chitraDeposit.status === 201);

    const chitraPay = await post(
      "/wallet/transfer",
      { to: "bala@test.local", amount: 50000, note: "Chitra pays Bala", pin: "9024" },
      chitraToken,
      { "Idempotency-Key": "chitra_pay_bala_1" }
    );
    check("Chitra sends Bala ₹500 -> 200", chitraPay.status === 200);

    const chitraRewards = await get("/rewards", chitraToken);
    check("Chitra gets a scratch card (5% of ₹500 = ₹25)", chitraRewards.data.cards.length === 1);
    const chitraCard = chitraRewards.data.cards[0];
    check("Chitra card is UNCLAIMED", chitraCard.status === "UNCLAIMED");

    // --- D6: Lazy Expiration Handling ---
    console.log("\n--- D6: Lazy Expiration Handling ---");
    // Direct DB update to set Chitra's card expiresAt to yesterday
    const directConn = await mongoose.connect(mongoUri, { dbName: "kaasupay" });
    const RewardCardCol = directConn.connection.collection("rewardcards");
    const updateRes = await RewardCardCol.updateOne(
      { _id: new mongoose.Types.ObjectId(chitraCard.id) },
      { $set: { expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
    );
    check("Direct DB update modified 1 record", updateRes.modifiedCount === 1);

    // Chitra tries to claim expired card -> 410
    const chitraClaimExpired = await post(`/rewards/${chitraCard.id}/claim`, {}, chitraToken);
    check("Claim expired card returns 410", chitraClaimExpired.status === 410);
    check("Message is 'This card has expired'", chitraClaimExpired.data.message === "This card has expired");

    // Chitra: GET /rewards -> status is now EXPIRED
    const chitraRewardsAfter = await get("/rewards", chitraToken);
    const expiredCard = chitraRewardsAfter.data.cards.find((c) => c.id === chitraCard.id);
    check("GET /rewards updates status to EXPIRED", expiredCard?.status === "EXPIRED");

    // --- D7: Offer Audit Aggregation Report ---
    console.log("\n--- D7: Campaign Audit Report ---");
    const d7Report = await get("/admin/offers/DIWALI", null, { "x-admin-key": ADMIN_KEY });
    check("GET /admin/offers/DIWALI returns 200", d7Report.status === 200);
    check("Offer code is DIWALI", d7Report.data.code === "DIWALI");
    check("Total budget is 10000", d7Report.data.budget === 10000);
    check("Budget left is 4000", d7Report.data.budgetLeft === 4000);
    check("Cards issued is 4", d7Report.data.cardsIssued === 4);
    check("Claimed count is 2", d7Report.data.claimed === 2);
    check("Exhausted count is 1", d7Report.data.exhausted === 1);
    check("Expired count is 1", d7Report.data.expired === 1);
    check("Unclaimed count is 0", d7Report.data.unclaimed === 0);
    check("Total paid is 6000", d7Report.data.totalPaid === 6000);
    check("Audit check is true (budget - budgetLeft === totalPaid)", d7Report.data.check === true);

    // Final Reconcile check
    const finalRec = await get("/admin/reconcile", null, { "x-admin-key": ADMIN_KEY });
    check("Final reconcile returns 200", finalRec.status === 200);
    check("moneyIsConserved is true across all wallets including promo", finalRec.data.moneyIsConserved === true);
    check("Zero wallet balance mismatches in ledger", finalRec.data.mismatches?.length === 0);

    // --- Bonus 6: Concurrency Race on Budget Depletion ---
    console.log("\n--- Bonus 6: Concurrency Race on Budget Depletion ---");
    // Create an offer with budget ₹30 (3000 paise)
    const raceOffer = await post(
      "/admin/offers",
      {
        code: "RACE30",
        percent: 5,
        maxCashback: 1000, // ₹10 max
        minPayment: 10000, // ₹100 min
        budget: 3000,      // exactly ₹30 (3 cards can win)
        days: 7,
      },
      null,
      { "x-admin-key": ADMIN_KEY }
    );
    check("Create RACE30 offer with ₹30 budget -> 201", raceOffer.status === 201);

    // Create 10 users, each receives ₹200 from staff, sets PIN, and pays Bala ₹200 -> gets a ₹10 card
    const raceTokens = [];
    const raceCardIds = [];

    for (let i = 0; i < 10; i++) {
      const ipHeader = { "x-forwarded-for": `10.0.1.${i + 10}` };
      const uEmail = `raceuser${i}_${Date.now()}@test.local`;
      const uSignup = await post(
        "/user/signup",
        {
          username: uEmail,
          firstName: `Race${i}`,
          lastName: "User",
          password: "password123",
        },
        null,
        ipHeader
      );
      const uSignin = await post("/user/signin", { username: uEmail, password: "password123" }, null, ipHeader);
      const uToken = uSignin.data.token;
      await post("/user/pin", { password: "password123", pin: "7419" }, uToken, ipHeader);
      await post("/admin/deposit", { to: uEmail, amount: 20000, note: "Race seed" }, null, { "x-admin-key": ADMIN_KEY });

      // Send Bala ₹200 -> eligible for 5% of 20000 = 1000 paise (₹10)
      const payRes = await post(
        "/wallet/transfer",
        { to: "bala@test.local", amount: 20000, note: `Race payment ${i}`, pin: "7419" },
        uToken,
        { "Idempotency-Key": `race_pay_${i}_${Date.now()}`, ...ipHeader }
      );
      check(`Race user ${i} pays Bala ₹200 -> 200`, payRes.status === 200);

      const uRewards = await get("/rewards", uToken, ipHeader);
      const card = uRewards.data.cards.find((c) => c.offer === "RACE30");
      check(`Race user ${i} got a RACE30 card`, Boolean(card));
      raceTokens.push(uToken);
      raceCardIds.push(card.id);
    }

    // Fire all 10 claims simultaneously with Promise.all
    console.log("Blasting 10 concurrent claims for RACE30 cards with Promise.all...");
    const raceClaimPromises = raceCardIds.map((cardId, idx) =>
      post(`/rewards/${cardId}/claim`, {}, raceTokens[idx])
    );
    const raceClaimResults = await Promise.all(raceClaimPromises);

    const winners = raceClaimResults.filter((r) => r.status === 200 && r.data.status === "CLAIMED");
    const exhausted = raceClaimResults.filter((r) => r.status === 200 && r.data.status === "EXHAUSTED");

    check("Exactly 3 users win cashback", winners.length === 3, `Got ${winners.length} winners`);
    check("Exactly 7 users get 'Better luck next time' (EXHAUSTED)", exhausted.length === 7, `Got ${exhausted.length} exhausted`);

    const raceReport = await get("/admin/offers/RACE30", null, { "x-admin-key": ADMIN_KEY });
    check("RACE30 budgetLeft is exactly 0", raceReport.data.budgetLeft === 0);
    check("RACE30 audit check is true", raceReport.data.check === true);
    check("RACE30 totalPaid is exactly 3000 paise", raceReport.data.totalPaid === 3000);

    // --- Bonus 8: Stop Offer Early ---
    console.log("\n--- Bonus 8: Stop Offer Early ---");
    const stopRes = await post("/admin/offers/DIWALI/stop", {}, null, { "x-admin-key": ADMIN_KEY });
    check("POST /admin/offers/DIWALI/stop returns 200", stopRes.status === 200);
    check("Offer isActive is false", stopRes.data.isActive === false);

    // Subsequent payment should get NO card because offer is stopped
    const payAfterStop = await post(
      "/wallet/transfer",
      { to: "bala@test.local", amount: 20000, note: "After stop offer", pin: "2468" },
      arunToken,
      { "Idempotency-Key": "after_stop_idemp_key_1" }
    );
    check("Payment after stop succeeds -> 200", payAfterStop.status === 200);

    const rewardsAfterStop = await get("/rewards", arunToken);
    check("Arun gets no new card after offer stopped", rewardsAfterStop.data.cards.length === 3);

    await directConn.disconnect();
  } finally {
    server.kill("SIGTERM");
    await replSet.stop();
  }

  console.log("\n===============================================================================");
  console.log(`=== DAY 9 ACCEPTANCE SUITE SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED ===`);
  console.log("===============================================================================\n");

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled rejection in test runner:", err);
  process.exit(1);
});
