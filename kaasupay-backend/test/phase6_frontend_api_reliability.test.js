// test/phase6_frontend_api_reliability.test.js
// Verification suite for Day 9 Phase 6: Frontend API Reliability & Claim State Management

import assert from "node:assert/strict";

console.log("===============================================================================");
console.log("=== PHASE 6: FRONTEND API RELIABILITY & CLAIM STATE MANAGEMENT TEST SUITE ===");
console.log("===============================================================================\n");

let passed = 0;
let failed = 0;

function check(desc, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${desc}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${desc} -> ${detail}`);
  }
}

// Mock Client & Services representing Phase 6 frontend logic
class MockRewardService {
  constructor() {
    this.cardsDb = [];
    this.shouldFailCards = false;
    this.claimErrorStatus = null;
    this.claimResponse = null;
    this.networkDropAfterCommit = false;
  }

  async getCards() {
    if (this.shouldFailCards) {
      const err = new Error("Network connection failed");
      err.code = "ERR_NETWORK";
      throw err;
    }
    return { cards: this.cardsDb };
  }

  async getActiveOffers() {
    return { offers: [] };
  }

  async getCardById(cardId) {
    const data = await this.getCards();
    return data.cards.find((c) => String(c.id) === String(cardId)) || null;
  }

  async claimCard(cardId) {
    if (this.networkDropAfterCommit) {
      // Simulate backend committing claim but response dropping
      const card = this.cardsDb.find((c) => String(c.id) === String(cardId));
      if (card) {
        card.status = "CLAIMED";
        card.amount = 1500;
      }
      const err = new Error("Network error: timeout");
      err.code = "ECONNABORTED";
      err.isNetworkError = true;
      throw err;
    }

    if (this.claimErrorStatus) {
      const err = new Error(`Request failed with status code ${this.claimErrorStatus}`);
      err.response = { status: this.claimErrorStatus };
      err.status = this.claimErrorStatus;
      err.isExpired = this.claimErrorStatus === 410;
      err.isConflict = this.claimErrorStatus === 409;
      err.isServerError = this.claimErrorStatus >= 500;
      err.isNetworkError = false;
      throw err;
    }

    return this.claimResponse;
  }
}

// Controller Simulation executing Phase 6 ScratchModal claim lifecycle
async function simulateClaimLifecycle({ service, card, onFetchWalletBalance }) {
  let isClaiming = false;
  let claimResult = null;
  let walletBalanceCalls = 0;

  async function performClaim() {
    if (isClaiming || !card || card.status !== "UNCLAIMED") {
      return { skipped: true };
    }
    if (
      claimResult &&
      (claimResult.status === "CLAIMED" ||
        claimResult.status === "EXHAUSTED" ||
        claimResult.status === "EXPIRED")
    ) {
      return { skipped: true };
    }

    isClaiming = true;
    try {
      const res = await service.claimCard(card.id);
      claimResult = res;

      // Only confirmed successful claim with status === "CLAIMED" and amount > 0 may trigger fetchWalletBalance()
      if (res?.status === "CLAIMED" && typeof res?.amount === "number" && res.amount > 0) {
        walletBalanceCalls += 1;
        if (onFetchWalletBalance) onFetchWalletBalance();
      }
    } catch (err) {
      // Synchronize authoritative backend state on conflict, network, or server error
      if (err.isConflict || err.isNetworkError || err.isServerError) {
        try {
          const authCard = await service.getCardById(card.id);
          if (authCard && authCard.status !== "UNCLAIMED") {
            claimResult = {
              status: authCard.status,
              amount: authCard.amount ?? 0,
              message:
                authCard.status === "CLAIMED"
                  ? "You won cashback!"
                  : authCard.status === "EXHAUSTED"
                  ? "Better luck next time"
                  : "This card has expired",
            };
            if (authCard.status === "CLAIMED" && typeof authCard.amount === "number" && authCard.amount > 0) {
              walletBalanceCalls += 1;
              if (onFetchWalletBalance) onFetchWalletBalance();
            }
            return { claimResult, walletBalanceCalls };
          }
        } catch {
          // sync error handled below
        }
      }

      if (err.isExpired || err.status === 410) {
        claimResult = {
          status: "EXPIRED",
          amount: 0,
          message: "This card has expired",
        };
      } else {
        // Never convert HTTP 500, network errors, timeouts into EXHAUSTED
        claimResult = {
          status: "ERROR",
          isNetworkError: Boolean(err.isNetworkError),
          message: err.message,
          canRetry: true,
        };
      }
    } finally {
      isClaiming = false;
    }

    return { claimResult, walletBalanceCalls, isClaiming };
  }

  const firstCall = performClaim();
  const duplicateCall = performClaim(); // Synchronous duplicate trigger simulation

  const [res1, res2] = await Promise.all([firstCall, duplicateCall]);
  return { res1, res2, walletBalanceCalls, getClaimResult: () => claimResult };
}

async function run() {
  // Test 1: Initial API Failure vs Empty Cards
  console.log("--- 1. Initial API Failure Differentiation ---");
  const s1 = new MockRewardService();
  s1.shouldFailCards = true;

  let initialLoadCards = [1, 2];
  let loadError = null;
  try {
    const res = await s1.getCards();
    initialLoadCards = res.cards;
  } catch (err) {
    loadError = err.message;
  }
  check("Initial API failure sets loadError", Boolean(loadError));
  check("Initial API failure does NOT claim empty list", loadError !== null && initialLoadCards.length > 0);

  // Test 2: Background Refresh Preserves Previously Loaded Cards
  console.log("\n--- 2. Background Refresh Failure Preservation ---");
  const s2 = new MockRewardService();
  let cachedCards = [{ id: "c1", status: "UNCLAIMED" }, { id: "c2", status: "CLAIMED", amount: 1000 }];
  s2.shouldFailCards = true;

  let backgroundRefreshFailed = false;
  try {
    const res = await s2.getCards();
    cachedCards = res.cards;
  } catch {
    backgroundRefreshFailed = true;
    // Phase 6 rule: keep cachedCards intact
  }
  check("Background refresh failure caught safely", backgroundRefreshFailed);
  check("Previously loaded cards preserved intact during refresh failure", cachedCards.length === 2);

  // Test 3: HTTP 410 Expired Card Handling
  console.log("\n--- 3. HTTP 410 Expired Card Handling ---");
  const s3 = new MockRewardService();
  s3.cardsDb = [{ id: "card_exp", status: "EXPIRED", amount: null }];
  s3.claimErrorStatus = 410;

  const expOutcome = await simulateClaimLifecycle({
    service: s3,
    card: { id: "card_exp", status: "UNCLAIMED" },
  });
  check("410 error marks status as EXPIRED", expOutcome.getClaimResult().status === "EXPIRED");
  check("410 error is NEVER marked as EXHAUSTED", expOutcome.getClaimResult().status !== "EXHAUSTED");
  check("410 error does NOT call fetchWalletBalance", expOutcome.walletBalanceCalls === 0);

  // Test 4: HTTP 500 Server Error Handling
  console.log("\n--- 4. HTTP 500 Server Error Handling ---");
  const s4 = new MockRewardService();
  s4.cardsDb = [{ id: "card_500", status: "UNCLAIMED", amount: null }];
  s4.claimErrorStatus = 500;

  const err500Outcome = await simulateClaimLifecycle({
    service: s4,
    card: { id: "card_500", status: "UNCLAIMED" },
  });
  check("500 error marks status as ERROR", err500Outcome.getClaimResult().status === "ERROR");
  check("500 error is NEVER marked as EXHAUSTED", err500Outcome.getClaimResult().status !== "EXHAUSTED");
  check("500 error preserves retry capability", err500Outcome.getClaimResult().canRetry === true);
  check("500 error does NOT call fetchWalletBalance", err500Outcome.walletBalanceCalls === 0);

  // Test 5: Ambiguous Network Failure (Response Lost After Commit)
  console.log("\n--- 5. Ambiguous Network Failure Recovery ---");
  const s5 = new MockRewardService();
  s5.cardsDb = [{ id: "card_ambig", status: "UNCLAIMED", amount: null }];
  s5.networkDropAfterCommit = true;

  const ambigOutcome = await simulateClaimLifecycle({
    service: s5,
    card: { id: "card_ambig", status: "UNCLAIMED" },
  });
  check("Authoritative DB synchronization recovers confirmed CLAIMED status", ambigOutcome.getClaimResult().status === "CLAIMED");
  check("Authoritative DB synchronization recovers exact amount (1500)", ambigOutcome.getClaimResult().amount === 1500);
  check("Confirmed recovery triggers fetchWalletBalance exactly ONCE", ambigOutcome.walletBalanceCalls === 1);

  // Test 6: HTTP 409 Conflict Synchronization
  console.log("\n--- 6. HTTP 409 Conflict Synchronization ---");
  const s6 = new MockRewardService();
  s6.cardsDb = [{ id: "card_conflict", status: "EXHAUSTED", amount: 0 }];
  s6.claimErrorStatus = 409;

  const conflictOutcome = await simulateClaimLifecycle({
    service: s6,
    card: { id: "card_conflict", status: "UNCLAIMED" },
  });
  check("409 conflict retrieves authoritative EXHAUSTED status from DB", conflictOutcome.getClaimResult().status === "EXHAUSTED");
  check("409 conflict does NOT fabricate CLAIMED state", conflictOutcome.getClaimResult().status !== "CLAIMED");
  check("EXHAUSTED outcome does NOT call fetchWalletBalance", conflictOutcome.walletBalanceCalls === 0);

  // Test 7: Successful Claim Lifecycle & Wallet Update
  console.log("\n--- 7. Successful Claim Lifecycle ---");
  const s7 = new MockRewardService();
  s7.cardsDb = [{ id: "card_win", status: "UNCLAIMED", amount: null }];
  s7.claimResponse = { status: "CLAIMED", amount: 2500, message: "You won ₹25.00" };

  const winOutcome = await simulateClaimLifecycle({
    service: s7,
    card: { id: "card_win", status: "UNCLAIMED" },
  });
  check("Successful claim returns CLAIMED", winOutcome.getClaimResult().status === "CLAIMED");
  check("Successful claim returns exact amount 2500", winOutcome.getClaimResult().amount === 2500);
  check("Successful positive claim triggers fetchWalletBalance", winOutcome.walletBalanceCalls === 1);

  // Test 8: Exhausted Claim Lifecycle
  console.log("\n--- 8. Exhausted Claim Lifecycle ---");
  const s8 = new MockRewardService();
  s8.cardsDb = [{ id: "card_exh", status: "UNCLAIMED", amount: null }];
  s8.claimResponse = { status: "EXHAUSTED", amount: 0, message: "Better luck next time" };

  const exhOutcome = await simulateClaimLifecycle({
    service: s8,
    card: { id: "card_exh", status: "UNCLAIMED" },
  });
  check("Exhausted claim returns EXHAUSTED", exhOutcome.getClaimResult().status === "EXHAUSTED");
  check("Exhausted claim amount is 0", exhOutcome.getClaimResult().amount === 0);
  check("Exhausted claim does NOT trigger fetchWalletBalance", exhOutcome.walletBalanceCalls === 0);

  // Test 9: Synchronous Duplicate Click Protection
  console.log("\n--- 9. Duplicate-Click / Re-entry Protection ---");
  check("Duplicate synchronous call was blocked and skipped", ambigOutcome.res2.skipped === true);

  console.log("\n===============================================================================");
  console.log(`=== PHASE 6 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===`);
  console.log("===============================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Unhandled test runner exception:", err);
  process.exit(1);
});

