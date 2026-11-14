// test/day9.test.js — Canonical Day 9 Cashback Scratch Cards & Promo Ledger Suite (D1 through D7 + Bonus 6 Concurrency Race)
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import mongoose from "mongoose";
import { issueRewardCardIfEligible, claimRewardCard } from "../services/promoService.js";
import RewardCard from "../models/RewardCard.js";
import RewardCount from "../models/RewardCount.js";
import Offer from "../models/Offer.js";
import Wallet from "../models/walletModel.js";
import Transaction from "../models/transactionModel.js";
import LedgerEntry from "../models/ledgerEntryModel.js";
import User from "../models/userModel.js";
import { indiaDay } from "../services/dailyLimitService.js";

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

    // --- Phase 1: Reward Issuance Transaction Safety & Idempotency ---
    console.log("\n--- Phase 1: Reward Issuance Transaction Safety & Idempotency ---");

    // 1. Existing card retrieved for repeated transactionId (idempotency optimization)
    const existingCardDoc = await RewardCard.findOne({}).session(null);
    check("Existing card exists in DB for idempotency test", Boolean(existingCardDoc));
    if (existingCardDoc) {
      const retrievedCard = await issueRewardCardIfEligible({
        payerId: existingCardDoc.userId,
        recipientId: new mongoose.Types.ObjectId(),
        paymentAmount: 50000,
        transactionId: existingCardDoc.transactionId,
        session: null,
      });
      check(
        "Existing card is retrieved for repeated transactionId (idempotency optimization)",
        retrievedCard && retrievedCard._id.toString() === existingCardDoc._id.toString()
      );
    }

    // 2. Expected business ineligibility returns null
    const ineligPaymentRes = await issueRewardCardIfEligible({
      payerId: new mongoose.Types.ObjectId(),
      recipientId: new mongoose.Types.ObjectId(),
      paymentAmount: 10, // Far below minPayment
      transactionId: new mongoose.Types.ObjectId(),
      session: null,
    });
    check("Payment below minimum returns null (expected ineligibility)", ineligPaymentRes === null);

    // 3. Unexpected database errors propagate instead of being swallowed
    let dbErrorPropagated = false;
    const testSession = await mongoose.startSession();
    await testSession.endSession(); // Explicitly end session to trigger MongoExpiredSessionError on use
    try {
      await issueRewardCardIfEligible({
        payerId: new mongoose.Types.ObjectId(),
        recipientId: new mongoose.Types.ObjectId(),
        paymentAmount: 50000,
        transactionId: new mongoose.Types.ObjectId(),
        session: testSession, // Closed session must propagate error, NOT swallow it!
      });
    } catch (err) {
      dbErrorPropagated = true;
    }
    check(
      "Unexpected database error propagates instead of being swallowed as ineligibility",
      dbErrorPropagated === true
    );

    // 4. Failed issuance in transaction rolls back cleanly without partial reward state
    const abortTxnSession = await mongoose.startSession();
    const abortTxnId = new mongoose.Types.ObjectId();
    try {
      await abortTxnSession.withTransaction(async () => {
        // Create an uncommitted card inside the transaction
        await RewardCard.create(
          [
            {
              userId: new mongoose.Types.ObjectId(),
              offerId: new mongoose.Types.ObjectId(),
              transactionId: abortTxnId,
              amount: 500,
              status: "UNCLAIMED",
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          ],
          { session: abortTxnSession }
        );
        // Abort the transaction intentionally
        throw new Error("Simulated payment transaction abort");
      });
    } catch (expectedErr) {
      // expected
    } finally {
      await abortTxnSession.endSession();
    }
    const rolledBackCard = await RewardCard.findOne({ transactionId: abortTxnId });
    check("Aborted transaction leaves no partial reward card in DB", rolledBackCard === null);

    // --- Phase 2: Daily Counter Concurrency & Abuse Prevention ---
    console.log("\n--- Phase 2: Daily Counter Concurrency & Abuse Prevention ---");

    // 0. Verify RewardCount unique index exists in MongoDB
    await RewardCount.init();
    const countIndexes = await RewardCount.collection.indexes();
    const hasUniqueIndex = countIndexes.some(
      (idx) => idx.unique && idx.key.userId === 1 && idx.key.day === 1
    );
    check("RewardCount unique compound index { userId: 1, day: 1 } exists in database", hasUniqueIndex);

    // Create an active offer for Phase 2 testing
    const p2Offer = await Offer.create({
      code: "PHASE2_CAP",
      percent: 10,
      maxCashback: 5000,
      minPayment: 1000,
      budget: 1000000,
      budgetLeft: 1000000,
      startsAt: new Date(Date.now() - 60000),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isActive: true,
    });
    check("Phase 2 test offer created", Boolean(p2Offer));

    const todayIST = indiaDay();
    const testUserA = new mongoose.Types.ObjectId();
    const testRecipient = new mongoose.Types.ObjectId();

    // 1. First counter creation
    const p2Card1 = await issueRewardCardIfEligible({
      payerId: testUserA,
      recipientId: testRecipient,
      paymentAmount: 5000,
      transactionId: new mongoose.Types.ObjectId(),
      session: null,
    });
    check("First reward issuance succeeds for fresh user", Boolean(p2Card1));
    const countDoc1 = await RewardCount.findOne({ userId: testUserA, day: todayIST });
    check("First counter document created with cards: 1", countDoc1 && countDoc1.cards === 1);

    // 2. Multiple repeated rounds of concurrent first-creation attempts
    console.log("Running 5 repeated rounds of 6 concurrent transaction reward issuance attempts...");
    async function attemptIssuanceInTxn(uId, amt) {
      const sess = await mongoose.startSession();
      try {
        let cardResult = null;
        await sess.withTransaction(async () => {
          cardResult = await issueRewardCardIfEligible({
            payerId: uId,
            recipientId: new mongoose.Types.ObjectId(),
            paymentAmount: amt,
            transactionId: new mongoose.Types.ObjectId(),
            session: sess,
          });
        });
        return cardResult;
      } finally {
        await sess.endSession();
      }
    }

    let allRoundsPassed = true;
    for (let round = 0; round < 5; round++) {
      const roundUser = new mongoose.Types.ObjectId();
      const roundAttempts = await Promise.all([
        attemptIssuanceInTxn(roundUser, 5000),
        attemptIssuanceInTxn(roundUser, 5000),
        attemptIssuanceInTxn(roundUser, 5000),
        attemptIssuanceInTxn(roundUser, 5000),
        attemptIssuanceInTxn(roundUser, 5000),
        attemptIssuanceInTxn(roundUser, 5000),
      ]);
      const roundWins = roundAttempts.filter(Boolean).length;
      const roundCountDoc = await RewardCount.findOne({ userId: roundUser, day: todayIST });
      if (roundWins !== 3 || !roundCountDoc || roundCountDoc.cards !== 3) {
        allRoundsPassed = false;
      }
    }
    check("All 5 repeated rounds granted exactly 3 cards and capped at 3 under concurrent transactions", allRoundsPassed);

    // Single-batch verification on testUserB
    const testUserB = new mongoose.Types.ObjectId();
    const concurrentResults = await Promise.all([
      attemptIssuanceInTxn(testUserB, 5000),
      attemptIssuanceInTxn(testUserB, 5000),
      attemptIssuanceInTxn(testUserB, 5000),
      attemptIssuanceInTxn(testUserB, 5000),
      attemptIssuanceInTxn(testUserB, 5000),
    ]);

    const successfulCards = concurrentResults.filter(Boolean);
    const cappedCards = concurrentResults.filter((c) => c === null);

    check("Exactly 3 cards granted under concurrent transactions", successfulCards.length === 3);
    check("Exactly 2 requests denied due to daily cap (null)", cappedCards.length === 2);

    const userBCountDoc = await RewardCount.findOne({ userId: testUserB, day: todayIST });
    check("User B RewardCount is exactly 3", userBCountDoc && userBCountDoc.cards === 3);

    // 3. Repeated request with same transactionId does not increment counter
    const repeatTxnId = successfulCards[0].transactionId;
    const repeatedCard = await issueRewardCardIfEligible({
      payerId: testUserB,
      recipientId: new mongoose.Types.ObjectId(),
      paymentAmount: 5000,
      transactionId: repeatTxnId,
      session: null,
    });
    check(
      "Repeated transactionId returns existing card without overcounting",
      repeatedCard && repeatedCard._id.toString() === successfulCards[0]._id.toString()
    );
    const userBCountAfterRepeat = await RewardCount.findOne({ userId: testUserB, day: todayIST });
    check("User B RewardCount remains 3 after repeated request", userBCountAfterRepeat.cards === 3);

    // 4. Failed card creation does not permanently consume slot (transaction rollback)
    const testUserC = new mongoose.Types.ObjectId();
    const rollbackSession = await mongoose.startSession();
    try {
      await rollbackSession.withTransaction(async () => {
        await issueRewardCardIfEligible({
          payerId: testUserC,
          recipientId: new mongoose.Types.ObjectId(),
          paymentAmount: 5000,
          transactionId: new mongoose.Types.ObjectId(),
          session: rollbackSession,
        });
        throw new Error("Simulated payment failure inside transaction");
      });
    } catch {
      // expected transaction rollback
    } finally {
      await rollbackSession.endSession();
    }
    const userCCount = await RewardCount.findOne({ userId: testUserC, day: todayIST });
    check("Failed issuance inside transaction leaves no counter doc or consumption", userCCount === null);

    // 5. Non-session compensation coverage (Issue 2)
    console.log("Testing non-session compensation scenarios...");
    const testUserD = new mongoose.Types.ObjectId();
    const freshTxnId = new mongoose.Types.ObjectId();

    let nonSessionCreateError = null;
    const origCreateMethod = RewardCard.create;
    try {
      // Mock RewardCard.create to fail with E11000 or write error
      RewardCard.create = async () => {
        const err = new Error("Simulated duplicate key on concurrent insert race");
        err.code = 11000;
        throw err;
      };

      await issueRewardCardIfEligible({
        payerId: testUserD,
        recipientId: new mongoose.Types.ObjectId(),
        paymentAmount: 5000,
        transactionId: freshTxnId,
        session: null,
      });
    } catch (err) {
      nonSessionCreateError = err;
    } finally {
      RewardCard.create = origCreateMethod;
    }

    check(
      "RewardCard.create failure outside session throws error",
      nonSessionCreateError !== null && nonSessionCreateError.code === 11000
    );
    const userDCountAfterComp = await RewardCount.findOne({ userId: testUserD, day: todayIST });
    check(
      "Non-session compensation released reserved slot back to 0",
      userDCountAfterComp && userDCountAfterComp.cards === 0
    );

    // 6. Non-session compensation cannot decrement below zero
    await RewardCount.updateOne(
      { userId: testUserD, day: todayIST, cards: { $gt: 0 } },
      { $inc: { cards: -1 } }
    );
    const userDCountStillZero = await RewardCount.findOne({ userId: testUserD, day: todayIST });
    check("Compensation operation cannot decrement counter below zero", userDCountStillZero.cards === 0);

    // 7. Non-session compensation does not remove concurrent successful reservation
    const testUserE = new mongoose.Types.ObjectId();
    // Pre-seed 1 card for User E
    await RewardCount.create({ userId: testUserE, day: todayIST, cards: 1 });
    // Fail an issuance for User E outside session
    try {
      RewardCard.create = async () => {
        throw new Error("Simulated card create error");
      };
      await issueRewardCardIfEligible({
        payerId: testUserE,
        recipientId: new mongoose.Types.ObjectId(),
        paymentAmount: 5000,
        transactionId: new mongoose.Types.ObjectId(),
        session: null,
      });
    } catch {
      // expected
    } finally {
      RewardCard.create = origCreateMethod;
    }
    const userECount = await RewardCount.findOne({ userId: testUserE, day: todayIST });
    check(
      "Compensation only removes its own reserved slot (reverts from 2 to 1, preserving existing slot)",
      userECount && userECount.cards === 1
    );

    // 8. Compensation failure handling: original creation error remains identifiable
    const origRewardCardCreate = RewardCard.create;
    const origRewardCountUpdateOne = RewardCount.updateOne;
    let thrownErrorWithCompFailure = null;

    try {
      // Mock RewardCard.create to fail
      RewardCard.create = async () => {
        throw new Error("Simulated card creation network timeout");
      };
      // Mock RewardCount.updateOne to also fail during compensation
      RewardCount.updateOne = async () => {
        throw new Error("Simulated DB connection failure during compensation");
      };

      await issueRewardCardIfEligible({
        payerId: new mongoose.Types.ObjectId(),
        recipientId: new mongoose.Types.ObjectId(),
        paymentAmount: 5000,
        transactionId: new mongoose.Types.ObjectId(),
        session: null,
      });
    } catch (err) {
      thrownErrorWithCompFailure = err;
    } finally {
      RewardCard.create = origRewardCardCreate;
      RewardCount.updateOne = origRewardCountUpdateOne;
    }

    check(
      "Original creation error remains thrown when compensation fails",
      thrownErrorWithCompFailure && thrownErrorWithCompFailure.message === "Simulated card creation network timeout"
    );
    check(
      "Compensation failure details attached without losing original error",
      thrownErrorWithCompFailure &&
        thrownErrorWithCompFailure.compensationError &&
        thrownErrorWithCompFailure.compensationError.message === "Simulated DB connection failure during compensation"
    );

    // 9. India calendar-day calculation check
    const nowUTC = new Date("2026-11-13T19:00:00.000Z"); // 7:00 PM UTC = 00:30 AM next day IST (2026-11-14)
    const istDay = indiaDay(nowUTC);
    check("India calendar-day calculation rolls over at 18:30 UTC", istDay === "2026-11-14");

    // --- Phase 3: Offer Security, Validation & Cashback Calculation ---
    console.log("\n--- Phase 3: Offer Security, Validation & Cashback Calculation ---");

    // 1. Public active-offers endpoint information filtering
    const publicOffersRes = await get("/rewards/active-offers", arunToken);
    check("GET /rewards/active-offers returns 200", publicOffersRes.status === 200);
    check("Public active-offers returns array", Array.isArray(publicOffersRes.data.offers));
    const samplePublicOffer = publicOffersRes.data.offers[0];
    if (samplePublicOffer) {
      check("Public offer contains code", typeof samplePublicOffer.code === "string");
      check("Public offer contains percent", typeof samplePublicOffer.percent === "number");
      check("Public offer contains minPayment", typeof samplePublicOffer.minPayment === "number");
      check("Public offer contains maxCashback", typeof samplePublicOffer.maxCashback === "number");
      check("Public offer DOES NOT contain internal budget", samplePublicOffer.budget === undefined);
      check("Public offer DOES NOT contain internal budgetLeft", samplePublicOffer.budgetLeft === undefined);
    }

    // 2. Staff report preserves full financial details
    const staffReportRes = await get("/admin/offers/DIWALI", null, { "x-admin-key": ADMIN_KEY });
    check("Staff report returns 200", staffReportRes.status === 200);
    check("Staff report contains budget", typeof staffReportRes.data.budget === "number");
    check("Staff report contains budgetLeft", typeof staffReportRes.data.budgetLeft === "number");
    check("Staff report contains totalPaid", typeof staffReportRes.data.totalPaid === "number");
    check("Staff report contains check flag", typeof staffReportRes.data.check === "boolean");

    // 3. Offer input validation: reject invalid configurations
    const testCases = [
      { name: "percent: 0 (below min)", payload: { code: "BADPCT0", percent: 0, maxCashback: 5000, minPayment: 1000, budget: 10000, days: 7 } },
      { name: "percent: 51 (above max)", payload: { code: "BADPCT51", percent: 51, maxCashback: 5000, minPayment: 1000, budget: 10000, days: 7 } },
      { name: "percent: 5.5 (non-integer)", payload: { code: "BADPCTDEC", percent: 5.5, maxCashback: 5000, minPayment: 1000, budget: 10000, days: 7 } },
      { name: "budget: 0", payload: { code: "BADBDG0", percent: 5, maxCashback: 5000, minPayment: 1000, budget: 0, days: 7 } },
      { name: "budget: -5000 (negative)", payload: { code: "BADBDGNEG", percent: 5, maxCashback: 5000, minPayment: 1000, budget: -5000, days: 7 } },
      { name: "budget: 100.5 (non-integer)", payload: { code: "BADBDGDEC", percent: 5, maxCashback: 5000, minPayment: 1000, budget: 100.5, days: 7 } },
      { name: "minPayment: 0", payload: { code: "BADMIN0", percent: 5, maxCashback: 5000, minPayment: 0, budget: 10000, days: 7 } },
      { name: "maxCashback: 0", payload: { code: "BADMAX0", percent: 5, maxCashback: 0, minPayment: 1000, budget: 10000, days: 7 } },
      { name: "days: 0", payload: { code: "BADDAY0", percent: 5, maxCashback: 5000, minPayment: 1000, budget: 10000, days: 0 } },
      { name: "days: 35 (above max 30)", payload: { code: "BADDAY35", percent: 5, maxCashback: 5000, minPayment: 1000, budget: 10000, days: 35 } },
    ];

    for (const tc of testCases) {
      const res = await post("/admin/offers", tc.payload, null, { "x-admin-key": ADMIN_KEY });
      check(`POST /admin/offers rejects ${tc.name} -> 400`, res.status === 400);
    }

    // 4. Cashback formula verification without artificial 1-paise floor:
    // Offer: 5% up to ₹50 (5000 paise).
    // Test: ₹137.05 (13705 paise) -> Math.floor(13705 * 5 / 100) = Math.floor(685.25) = 685 paise (₹6.85)
    const testCalcOffer = await Offer.create({
      code: "CALCTEST",
      percent: 5,
      maxCashback: 5000,
      minPayment: 100,
      budget: 1000000,
      budgetLeft: 1000000,
      startsAt: new Date(Date.now() - 60000),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isActive: true,
    });
    check("Calculation test offer created", Boolean(testCalcOffer));

    const calcCard1 = await issueRewardCardIfEligible({
      payerId: new mongoose.Types.ObjectId(),
      recipientId: new mongoose.Types.ObjectId(),
      paymentAmount: 13705, // ₹137.05
      transactionId: new mongoose.Types.ObjectId(),
      session: null,
    });
    check("5% of 13705 paise rounds down to exactly 685 paise", calcCard1 && calcCard1.amount === 685);

    // Test cap enforcement: 5% of ₹2,000 (200000 paise) = 10000 paise -> capped at 5000 paise (₹50)
    const calcCard2 = await issueRewardCardIfEligible({
      payerId: new mongoose.Types.ObjectId(),
      recipientId: new mongoose.Types.ObjectId(),
      paymentAmount: 200000, // ₹2,000
      transactionId: new mongoose.Types.ObjectId(),
      session: null,
    });
    check("Cashback capped at maxCashback (5000 paise)", calcCard2 && calcCard2.amount === 5000);

    // 5. Explicit boundary tests requested in review
    // Test: ₹100 payment (10000 paise) at 5% -> 500 paise
    const calcCard100 = await issueRewardCardIfEligible({
      payerId: new mongoose.Types.ObjectId(),
      recipientId: new mongoose.Types.ObjectId(),
      paymentAmount: 10000,
      transactionId: new mongoose.Types.ObjectId(),
      session: null,
    });
    check("₹100 payment at 5% yields exactly 500 paise (₹5.00)", calcCard100 && calcCard100.amount === 500);

    // Test: ₹100.01 payment (10001 paise) at 5% -> Math.floor(500.05) = 500 paise
    const calcCard10001 = await issueRewardCardIfEligible({
      payerId: new mongoose.Types.ObjectId(),
      recipientId: new mongoose.Types.ObjectId(),
      paymentAmount: 10001,
      transactionId: new mongoose.Types.ObjectId(),
      session: null,
    });
    check("₹100.01 payment at 5% rounds down to exactly 500 paise", calcCard10001 && calcCard10001.amount === 500);

    // Test: Valid payment whose proportional cashback rounds down to 0 paise -> ineligible (returns null)
    const zeroOffer = await Offer.create({
      code: "ZEROPAY",
      percent: 5,
      maxCashback: 5000,
      minPayment: 10, // 10 paise minimum payment
      budget: 100000,
      budgetLeft: 100000,
      startsAt: new Date(Date.now() - 60000),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isActive: true,
    });
    check("Zero reward test offer created", Boolean(zeroOffer));

    const zeroRewardCard = await issueRewardCardIfEligible({
      payerId: new mongoose.Types.ObjectId(),
      recipientId: new mongoose.Types.ObjectId(),
      paymentAmount: 10, // 10 paise * 5 / 100 = 0.5 paise -> Math.floor = 0
      transactionId: new mongoose.Types.ObjectId(),
      session: null,
    });
    check("Payment yielding 0 paise cashback returns null (no artificial floor)", zeroRewardCard === null);

    // Deactivate zeroOffer so testCalcOffer (minPayment: 100) becomes active
    await Offer.updateOne({ _id: zeroOffer._id }, { $set: { isActive: false } });

    // Test: minPayment boundary (100 paise on testCalcOffer)
    // Exactly at minPayment (100 paise):
    const atMinCard = await issueRewardCardIfEligible({
      payerId: new mongoose.Types.ObjectId(),
      recipientId: new mongoose.Types.ObjectId(),
      paymentAmount: 100, // 100 * 5 / 100 = 5 paise
      transactionId: new mongoose.Types.ObjectId(),
      session: null,
    });
    check("Payment exactly at minPayment receives reward card", atMinCard && atMinCard.amount === 5);

    // Exactly 1 paise below minPayment (99 paise):
    const belowMinCard = await issueRewardCardIfEligible({
      payerId: new mongoose.Types.ObjectId(),
      recipientId: new mongoose.Types.ObjectId(),
      paymentAmount: 99,
      transactionId: new mongoose.Types.ObjectId(),
      session: null,
    });
    check("Payment 1 paise below minPayment returns null", belowMinCard === null);

    // Test: Invalid paymentAmount values: NaN, Infinity, strings, decimals, zero, negative
    const invalidAmounts = [NaN, Infinity, -Infinity, "10000", 100.5, 0, -500, null, undefined];
    let allInvalidRejected = true;
    for (const invAmt of invalidAmounts) {
      const res = await issueRewardCardIfEligible({
        payerId: new mongoose.Types.ObjectId(),
        recipientId: new mongoose.Types.ObjectId(),
        paymentAmount: invAmt,
        transactionId: new mongoose.Types.ObjectId(),
        session: null,
      });
      if (res !== null) allInvalidRejected = false;
    }
    check("Invalid paymentAmount (NaN, Infinity, string, decimal, <= 0) returns null", allInvalidRejected);

    // --- Phase 4: Claim Transaction and Expiry Reliability ---
    console.log("\n--- Phase 4: Claim Transaction and Expiry Reliability ---");

    // 1. Expired card state persistence outside transaction
    const p4ExpiredCard = await RewardCard.create({
      userId: arunId,
      offerId: testCalcOffer._id,
      transactionId: new mongoose.Types.ObjectId(),
      amount: 1000,
      status: "UNCLAIMED",
      expiresAt: new Date(Date.now() - 10000), // expired 10 seconds ago
    });
    check("Expired card seeded for test", Boolean(p4ExpiredCard));

    const claimExpiredRes = await post(`/rewards/${p4ExpiredCard._id}/claim`, {}, arunToken);
    check("Claiming expired card returns 410", claimExpiredRes.status === 410);

    const expiredDbCard = await RewardCard.findById(p4ExpiredCard._id);
    check("Expired card status is persisted as EXPIRED in DB", expiredDbCard && expiredDbCard.status === "EXPIRED");

    // Subsequent claim on already-marked EXPIRED card also returns 410
    const claimExpiredRes2 = await post(`/rewards/${p4ExpiredCard._id}/claim`, {}, arunToken);
    check("Subsequent claim on EXPIRED card returns 410", claimExpiredRes2.status === 410);

    // 2. Conditional update guard: cannot overwrite CLAIMED card
    const claimedSampleCard = await RewardCard.findOne({ userId: arunId, status: "CLAIMED" });
    check("Found a previously claimed card to verify conditional update guard", Boolean(claimedSampleCard));
    if (claimedSampleCard) {
      const overwriteAttempt = await RewardCard.updateOne(
        { _id: claimedSampleCard._id, status: "UNCLAIMED", expiresAt: { $lte: new Date() } },
        { $set: { status: "EXPIRED" } }
      );
      check("Conditional expiry update matched 0 documents on CLAIMED card", overwriteAttempt.matchedCount === 0);
      const refetchedClaimed = await RewardCard.findById(claimedSampleCard._id);
      check("CLAIMED card was not overwritten by expiry update", refetchedClaimed.status === "CLAIMED");
    }

    // 3. Ownership and status revalidation inside claim flow
    // A. Wrong user claiming card
    const wrongUserCard = await RewardCard.create({
      userId: arunId,
      offerId: testCalcOffer._id,
      transactionId: new mongoose.Types.ObjectId(),
      amount: 500,
      status: "UNCLAIMED",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    const wrongUserClaimRes = await post(`/rewards/${wrongUserCard._id}/claim`, {}, balaToken);
    check("Claiming card owned by another user returns 404", wrongUserClaimRes.status === 404);

    // B. Non-existent card ID
    const fakeCardId = new mongoose.Types.ObjectId();
    const fakeCardClaimRes = await post(`/rewards/${fakeCardId}/claim`, {}, arunToken);
    check("Claiming non-existent card returns 404", fakeCardClaimRes.status === 404);

    // C. Invalid ObjectId format
    const invalidIdRes = await post("/rewards/invalid-id-format/claim", {}, arunToken);
    check("Claiming invalid cardId format returns 404", invalidIdRes.status === 404);

    // 4. Budget exhaustion behavior: commits EXHAUSTED without moving money
    const exhaustedOffer = await Offer.create({
      code: "EXHAUSTOFFER",
      percent: 10,
      maxCashback: 5000,
      minPayment: 100,
      budget: 1000,
      budgetLeft: 100, // Only 100 paise left in budget
      startsAt: new Date(Date.now() - 60000),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isActive: true,
    });

    const cardExceedingBudget = await RewardCard.create({
      userId: balaId,
      offerId: exhaustedOffer._id,
      transactionId: new mongoose.Types.ObjectId(),
      amount: 300, // 300 paise > 100 paise budgetLeft
      status: "UNCLAIMED",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const preExhaustBalaWallet = await Wallet.findOne({ userId: balaId });
    const preExhaustTxnCount = await Transaction.countDocuments({ type: "CASHBACK" });
    const preExhaustLedgerCount = await LedgerEntry.countDocuments({ type: "CASHBACK" });

    const exhaustClaimRes = await post(`/rewards/${cardExceedingBudget._id}/claim`, {}, balaToken);
    check("Exhausted budget claim returns 200", exhaustClaimRes.status === 200);
    check("Exhausted budget returns exhausted: true", exhaustClaimRes.data.exhausted === true);
    check("Exhausted budget returns amount: 0", exhaustClaimRes.data.amount === 0);
    check("Exhausted budget returns status: 'EXHAUSTED'", exhaustClaimRes.data.status === "EXHAUSTED");
    check("Exhausted budget message: 'Better luck next time'", exhaustClaimRes.data.message === "Better luck next time");

    const exhaustDbCard = await RewardCard.findById(cardExceedingBudget._id);
    check("Exhausted card persisted in DB with status: EXHAUSTED", exhaustDbCard.status === "EXHAUSTED");
    check("Exhausted card has claimedAt timestamp", Boolean(exhaustDbCard.claimedAt));

    const postExhaustBalaWallet = await Wallet.findOne({ userId: balaId });
    check("User wallet balance unchanged on budget exhaustion", postExhaustBalaWallet.balance === preExhaustBalaWallet.balance);

    const postExhaustTxnCount = await Transaction.countDocuments({ type: "CASHBACK" });
    check("No CASHBACK transaction created on budget exhaustion", postExhaustTxnCount === preExhaustTxnCount);

    const postExhaustLedgerCount = await LedgerEntry.countDocuments({ type: "CASHBACK" });
    check("No LedgerEntry created on budget exhaustion", postExhaustLedgerCount === preExhaustLedgerCount);

    // Subsequent claim on EXHAUSTED card returns 409
    const subExhaustClaimRes = await post(`/rewards/${cardExceedingBudget._id}/claim`, {}, balaToken);
    check("Subsequent claim on EXHAUSTED card returns 409", subExhaustClaimRes.status === 409);

    // 5. Concurrency & Invariants: Simultaneous claims on the same card
    const simOffer = await Offer.create({
      code: "SIMCLAIM",
      percent: 10,
      maxCashback: 5000,
      minPayment: 100,
      budget: 500000,
      budgetLeft: 500000,
      startsAt: new Date(Date.now() - 60000),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isActive: true,
    });

    const simCard = await RewardCard.create({
      userId: balaId,
      offerId: simOffer._id,
      transactionId: new mongoose.Types.ObjectId(),
      amount: 1500, // ₹15.00
      status: "UNCLAIMED",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const promoUserRecord = await User.findOne({ username: "rewards@kaasupay.system" });
    const preSimPromoWallet = await Wallet.findOne({ userId: promoUserRecord._id });
    const preSimBalaWallet = await Wallet.findOne({ userId: balaId });
    const preSimTxnCount = await Transaction.countDocuments({ type: "CASHBACK" });
    const preSimLedgerCount = await LedgerEntry.countDocuments({ type: "CASHBACK" });

    // Fire 6 parallel claim attempts on the exact same card
    const simClaims = await Promise.all(
      Array.from({ length: 6 }, () => post(`/rewards/${simCard._id}/claim`, {}, balaToken))
    );

    const successfulClaims = simClaims.filter((r) => r.status === 200 && r.data.status === "CLAIMED");
    const conflictClaims = simClaims.filter((r) => r.status === 409);

    check("Simultaneous claims: exactly ONE claim succeeds (200 CLAIMED)", successfulClaims.length === 1);
    check("Simultaneous claims: all other claims rejected with 409", conflictClaims.length === 5);
    check("Successful claim won ₹15.00", successfulClaims[0].data.amount === 1500);

    // Verify financial balances and ledger entries
    const postSimBalaWallet = await Wallet.findOne({ userId: balaId });
    check(
      "User wallet credited by exactly card amount (₹15.00)",
      postSimBalaWallet.balance === preSimBalaWallet.balance + 1500
    );

    const postSimPromoWallet = await Wallet.findOne({ userId: promoUserRecord._id });
    check(
      "Promo wallet debited by exactly card amount (₹15.00)",
      postSimPromoWallet.balance === preSimPromoWallet.balance - 1500
    );

    const postSimSimOffer = await Offer.findById(simOffer._id);
    check(
      "Offer budgetLeft decremented by exactly card amount (₹15.00)",
      postSimSimOffer.budgetLeft === 500000 - 1500
    );

    const postSimTxnCount = await Transaction.countDocuments({ type: "CASHBACK" });
    check("Exactly ONE CASHBACK transaction created across 6 simultaneous claims", postSimTxnCount === preSimTxnCount + 1);

    const postSimLedgerCount = await LedgerEntry.countDocuments({ type: "CASHBACK" });
    check("Exactly TWO LedgerEntry records created across 6 simultaneous claims", postSimLedgerCount === preSimLedgerCount + 2);

    const simDbCard = await RewardCard.findById(simCard._id);
    check("Card marked CLAIMED with cashbackTransactionId set", simDbCard.status === "CLAIMED" && Boolean(simDbCard.cashbackTransactionId));
    check(
      "Card marked CLAIMED with valid claimedAt timestamp and cashbackTransactionId",
      simDbCard.status === "CLAIMED" &&
        Boolean(simDbCard.cashbackTransactionId) &&
        Boolean(simDbCard.claimedAt) &&
        simDbCard.claimedAt instanceof Date
    );

    const simCashbackTx = await Transaction.findById(simDbCard.cashbackTransactionId);
    check("Cashback transaction links from promoUser to balaId", simCashbackTx.fromUserId.equals(promoUserRecord._id) && simCashbackTx.toUserId.equals(balaId));

    const simLedgers = await LedgerEntry.find({ transactionId: simCashbackTx._id });
    check("Exactly 2 ledger entries for the cashback transaction", simLedgers.length === 2);
    const debitLedger = simLedgers.find((l) => l.direction === "DEBIT");
    const creditLedger = simLedgers.find((l) => l.direction === "CREDIT");
    check("Debit ledger entry exists for promo wallet with matching amount", debitLedger && debitLedger.userId.equals(promoUserRecord._id) && debitLedger.amount === 1500);
    check("Credit ledger entry exists for user wallet with matching amount", creditLedger && creditLedger.userId.equals(balaId) && creditLedger.amount === 1500);
    check("Ledger entries are perfectly balanced (debit === credit)", debitLedger.amount === creditLedger.amount);

    // 6. Insufficient promo wallet funds rolls back transaction cleanly
    const insufficientOffer = await Offer.create({
      code: "INSUFFOFFER",
      percent: 10,
      maxCashback: 5000,
      minPayment: 100,
      budget: 100000,
      budgetLeft: 100000,
      startsAt: new Date(Date.now() - 60000),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isActive: true,
    });

    const rollbackCard = await RewardCard.create({
      userId: balaId,
      offerId: insufficientOffer._id,
      transactionId: new mongoose.Types.ObjectId(),
      amount: 2000,
      status: "UNCLAIMED",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // Temporarily drain promo wallet to 0
    const originalPromoBalance = postSimPromoWallet.balance;
    await Wallet.updateOne({ _id: postSimPromoWallet._id }, { $set: { balance: 0 } });

    const preRollbackBalaBal = (await Wallet.findOne({ userId: balaId })).balance;
    const preRollbackTxnCount = await Transaction.countDocuments({ type: "CASHBACK" });

    const failClaimRes = await post(`/rewards/${rollbackCard._id}/claim`, {}, balaToken);
    check("Claim with insufficient promo wallet funds returns 500", failClaimRes.status === 500);

    const rollbackDbCard = await RewardCard.findById(rollbackCard._id);
    check("Card remains UNCLAIMED after transaction rollback", rollbackDbCard.status === "UNCLAIMED");

    const rolledBackOffer = await Offer.findById(insufficientOffer._id);
    check("Offer budgetLeft was rolled back and not decremented", rolledBackOffer.budgetLeft === 100000);

    const postRollbackBalaBal = (await Wallet.findOne({ userId: balaId })).balance;
    check("User wallet balance unchanged after rollback", postRollbackBalaBal === preRollbackBalaBal);

    const postRollbackTxnCount = await Transaction.countDocuments({ type: "CASHBACK" });
    check("No CASHBACK transaction created after rollback", postRollbackTxnCount === preRollbackTxnCount);

    // Restore promo wallet balance
    await Wallet.updateOne({ _id: postSimPromoWallet._id }, { $set: { balance: originalPromoBalance } });

    // 7. Item 5 Refinement: Race where concurrent claim occurs between initial read and expiry update
    const raceExpiryCard = await RewardCard.create({
      userId: balaId,
      offerId: simOffer._id,
      transactionId: new mongoose.Types.ObjectId(),
      amount: 500,
      status: "UNCLAIMED",
      expiresAt: new Date(Date.now() - 5000), // Card expired
    });

    const origUpdateOne = RewardCard.updateOne;
    let raceClaimExecuted = false;

    // Intercept updateOne so right before the conditional update to EXPIRED runs,
    // another transaction claims the card
    RewardCard.updateOne = async function (filter, update, options) {
      if (filter && filter._id && filter._id.equals(raceExpiryCard._id) && filter.status === "UNCLAIMED") {
        if (!raceClaimExecuted) {
          raceClaimExecuted = true;
          // Concurrent transaction commits CLAIMED state first!
          await origUpdateOne.call(RewardCard, { _id: raceExpiryCard._id }, { $set: { status: "CLAIMED" } });
        }
      }
      return origUpdateOne.call(this, filter, update, options);
    };

    let raceClaimErr = null;
    try {
      await claimRewardCard({ cardId: raceExpiryCard._id, userId: balaId });
    } catch (err) {
      raceClaimErr = err;
    } finally {
      RewardCard.updateOne = origUpdateOne;
    }

    check(
      "MatchedCount === 0 re-reads latest card: concurrent claim returns 409 instead of 410",
      raceClaimErr && raceClaimErr.status === 409 && raceClaimErr.message === "This card is already CLAIMED"
    );

    // Also test when concurrent request marks it EXHAUSTED
    const raceExhaustCard = await RewardCard.create({
      userId: balaId,
      offerId: simOffer._id,
      transactionId: new mongoose.Types.ObjectId(),
      amount: 500,
      status: "UNCLAIMED",
      expiresAt: new Date(Date.now() - 5000),
    });

    let raceExhaustExecuted = false;
    RewardCard.updateOne = async function (filter, update, options) {
      if (filter && filter._id && filter._id.equals(raceExhaustCard._id) && filter.status === "UNCLAIMED") {
        if (!raceExhaustExecuted) {
          raceExhaustExecuted = true;
          await origUpdateOne.call(RewardCard, { _id: raceExhaustCard._id }, { $set: { status: "EXHAUSTED" } });
        }
      }
      return origUpdateOne.call(this, filter, update, options);
    };

    let raceExhaustErr = null;
    try {
      await claimRewardCard({ cardId: raceExhaustCard._id, userId: balaId });
    } catch (err) {
      raceExhaustErr = err;
    } finally {
      RewardCard.updateOne = origUpdateOne;
    }

    check(
      "MatchedCount === 0 re-reads latest card: concurrent exhaustion returns 409",
      raceExhaustErr && raceExhaustErr.status === 409 && raceExhaustErr.message === "This card is already EXHAUSTED"
    );

    // 8. Item 5 Refinement: Expiry persistence database failure preserves original claim error and makes failure observable
    const dbFailCard = await RewardCard.create({
      userId: balaId,
      offerId: simOffer._id,
      transactionId: new mongoose.Types.ObjectId(),
      amount: 500,
      status: "UNCLAIMED",
      expiresAt: new Date(Date.now() - 5000),
    });

    RewardCard.updateOne = async function (filter) {
      if (filter && filter._id && filter._id.equals(dbFailCard._id)) {
        throw new Error("Simulated database connection crash during expiry update");
      }
      return origUpdateOne.apply(this, arguments);
    };

    let persistenceFailErr = null;
    try {
      await claimRewardCard({ cardId: dbFailCard._id, userId: balaId });
    } catch (err) {
      persistenceFailErr = err;
    } finally {
      RewardCard.updateOne = origUpdateOne;
    }

    check(
      "Original 410 claim error is preserved when expiry persistence encounters DB failure",
      persistenceFailErr && persistenceFailErr.status === 410 && persistenceFailErr.message === "This card has expired"
    );
    check(
      "Expiry persistence DB failure is observable on error object (expiryPersistenceError)",
      persistenceFailErr &&
        persistenceFailErr.expiryPersistenceError &&
        persistenceFailErr.expiryPersistenceError.message === "Simulated database connection crash during expiry update"
    );

    // 9. Item 5 Bounded Retry: Claim occurs between second read and retry update
    const retryRaceCard = await RewardCard.create({
      userId: balaId,
      offerId: simOffer._id,
      transactionId: new mongoose.Types.ObjectId(),
      amount: 500,
      status: "UNCLAIMED",
      expiresAt: new Date(Date.now() - 5000),
    });

    let updateOneCallCount = 0;
    RewardCard.updateOne = async function (filter, update, options) {
      if (filter && filter._id && filter._id.equals(retryRaceCard._id) && filter.status === "UNCLAIMED") {
        updateOneCallCount += 1;
        if (updateOneCallCount === 1) {
          // Attempt 0: simulate 0 matched without changing DB so latestCard reads as UNCLAIMED
          return { matchedCount: 0, modifiedCount: 0 };
        }
        if (updateOneCallCount === 2) {
          // Attempt 1: simulate concurrent claim occurring right before retry update runs
          await origUpdateOne.call(RewardCard, { _id: retryRaceCard._id }, { $set: { status: "CLAIMED" } });
        }
      }
      return origUpdateOne.call(this, filter, update, options);
    };

    let retryRaceErr = null;
    try {
      await claimRewardCard({ cardId: retryRaceCard._id, userId: balaId });
    } catch (err) {
      retryRaceErr = err;
    } finally {
      RewardCard.updateOne = origUpdateOne;
    }

    check(
      "Retry update matchedCount === 0 re-reads card: claim between read and retry returns 409",
      retryRaceErr && retryRaceErr.status === 409 && retryRaceErr.message === "This card is already CLAIMED"
    );

    // 10. Repeated expiry transition conflicts do not falsely report successful persistence
    const conflictExpiryCard = await RewardCard.create({
      userId: balaId,
      offerId: simOffer._id,
      transactionId: new mongoose.Types.ObjectId(),
      amount: 500,
      status: "UNCLAIMED",
      expiresAt: new Date(Date.now() - 5000),
    });

    RewardCard.updateOne = async function (filter, update, options) {
      if (filter && filter._id && filter._id.equals(conflictExpiryCard._id) && filter.status === "UNCLAIMED") {
        // Repeatedly simulate conflict (matchedCount 0) while card remains UNCLAIMED in DB
        return { matchedCount: 0, modifiedCount: 0 };
      }
      return origUpdateOne.call(this, filter, update, options);
    };

    let repeatedConflictErr = null;
    try {
      await claimRewardCard({ cardId: conflictExpiryCard._id, userId: balaId });
    } catch (err) {
      repeatedConflictErr = err;
    } finally {
      RewardCard.updateOne = origUpdateOne;
    }

    check(
      "Repeated conflicts do not falsely report successful persistence: observable conflict attached",
      repeatedConflictErr &&
        repeatedConflictErr.status === 410 &&
        repeatedConflictErr.expiryPersistenceError &&
        repeatedConflictErr.expiryPersistenceError.code === "EXPIRY_PERSISTENCE_CONFLICT"
    );

    const conflictDbCard = await RewardCard.findById(conflictExpiryCard._id);
    check(
      "Card in DB correctly remains UNCLAIMED when persistence conflict could not commit",
      conflictDbCard && conflictDbCard.status === "UNCLAIMED"
    );

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
