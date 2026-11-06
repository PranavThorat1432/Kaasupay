# KaasuPay Day 9: Cashback Scratch Cards & Promo System Ledger
## Architectural & Engineering Interview Answers

---

### Question 1: Why can't cashback just be `$inc` on the user's wallet? Where does the money come from in your design?
**Answer:**
Money can never materialize out of thin air in a double-entry financial system. If cashback were implemented as a naked `$inc: { balance: reward }` on a user's wallet:
1. The system balance equation ($\sum \text{Wallet Balances} = \text{Money In} - \text{Money Out}$) is immediately violated.
2. The Day 3 reconciliation engine will fail with a discrepancy because the sum of all wallet balances will exceed total recorded deposits.
3. Every credit must have a corresponding debit.

In our design, promotional funds come from **KaasuPay's dedicated Promo System Wallet** (`rewards@kaasupay.system`). When marketing staff creates an offer with a budget, that budget is deposited into the Promo System Wallet as a standard `DEPOSIT` transaction backed by a `CREDIT` ledger row. When a user scratches and claims a reward, the reward amount is transferred from the Promo System Wallet to the user's wallet via a `CASHBACK` transaction, generating balanced `DEBIT` (promo wallet) and `CREDIT` (user wallet) ledger rows. Total money in the ecosystem remains conserved.

---

### Question 2: How does reconcile stay correct with cashback, without changing the reconcile code?
**Answer:**
Reconcile verifies two mathematical invariants:
1. **System-wide conservation:** $\sum \text{Wallet Balances} = \text{Total Deposits} - \text{Net Withdrawals}$.
2. **Individual wallet auditability:** For every wallet, $\text{Balance} = \sum \text{Credits} - \sum \text{Debits}$.

Because the Promo System Wallet is a regular `Wallet` document associated with the system user `rewards@kaasupay.system`:
- When an offer is created, the budget enters the system as a `DEPOSIT` transaction into the Promo Wallet. `Total Deposits` increases by the budget, and the Promo Wallet balance increases by the budget.
- When cashback is paid, money moves from the Promo Wallet to the user's wallet. The sum of all wallet balances does not change; only internal distribution changes.
- In the ledger, the Promo Wallet receives a `DEBIT` and the user receives a `CREDIT`. Both wallets' ledger sums match their balances exactly.

Thus, the Day 3 reconciliation code verifies financial health across all wallets (including promo) without changing a single line of code.

---

### Question 3: Show the race that overspends a budget when you read `budgetLeft` first. How does your claim stop it?
**Answer:**
Consider an offer with ₹30 (3000 paise) left in budget. 200 users attempt to claim a ₹10 (1000 paise) card in the same millisecond.

**The "Read First, Then Update" Vulnerability:**
```javascript
// WRONG: Check-then-act race window
const offer = await Offer.findOne({ code: "DIWALI" });
if (offer.budgetLeft >= 1000) {
  // All 200 concurrent requests read budgetLeft = 3000 here!
  // All 200 pass the check.
  await Offer.updateOne({ code: "DIWALI" }, { $inc: { budgetLeft: -1000 } });
}
```
**Outcome:** 200 users are paid ₹10 each (₹2,000 total). The budget goes negative to -₹1,970, and the company suffers an unauthorized financial loss of ₹1,970.

**The KaasuPay Atomic Solution:**
We combine the predicate check and the decrement into a single, atomic conditional write:
```javascript
const offer = await Offer.findOneAndUpdate(
  { _id: card.offerId, budgetLeft: { $gte: card.amount } },
  { $inc: { budgetLeft: -card.amount } },
  { session, returnDocument: "after" }
);
```
Under MongoDB's WiredTiger document-level write locking, this conditional update is serialized. Exactly 3 claims succeed and return the updated offer; the remaining 197 find no matching document (`budgetLeft < 1000`), return `null`, and branch safely to the `EXHAUSTED` state. The budget reaches exactly 0 and never goes negative.

---

### Question 4: Why is the card created inside the payment's transaction? What goes wrong if it's created after the payment, outside it?
**Answer:**
A scratch card is bound to the successful financial execution of an eligible payment.

If the card is created **outside / after** the payment transaction:
1. **Network or Process Crash between payment and card creation:** The user pays money, but the server crashes before issuing the card. The user loses their earned reward.
2. **Payment Failure with Stray Card:** If someone writes card creation code before or outside the transaction, or if an asynchronous job runs, a failed payment could create a persistent card, allowing a user to claim free company funds for a payment that never went through.
3. **Ghost Duplication:** A retried HTTP request could execute the payment once (idempotent), but create two cards outside the transaction.

By creating the `RewardCard` inside the exact same MongoDB transaction session (`session.withTransaction`) as the wallet debit/credit and ledger entries, the entire unit of work is atomic: all writes commit together, or none do.

---

### Question 5: Your idempotency key already stops double payments. Why also put a unique index on the card's `transactionId`?
**Answer:**
Defense in depth (two independent locks).
- The `Idempotency-Key` protects the **transport/gateway boundary** against identical HTTP client retries within the idempotency window.
- The unique index on `RewardCard.transactionId` enforces a **domain and data-integrity invariant** at the persistence layer: *one payment transaction can produce at most one scratch card in the lifetime of the database*.

If a developer introduces a code regression, an outbox replay worker accidentally retries a payment pipeline, or an internal event emitter triggers duplicate hooks, the database rejects the second card with an `E11000` duplicate key violation. Furthermore, the `issueRewardCardIfEligible` service wraps this insertion in a non-fatal try/catch, guaranteeing that a duplicate card attempt never rolls back the actual customer transfer.

---

### Question 6: Why must the server decide the reward amount, and when does it decide it?
**Answer:**
1. **Why the server must decide:** The client (browser, mobile app, or API consumer) is completely untrusted. If the client sent the reward amount during the scratch interaction, any malicious user could modify the payload in DevTools, Postman, or a proxy to claim the maximum budget (e.g. ₹5,000 instead of ₹10).
2. **When it decides it:** The server calculates and persists the reward amount **at the moment of payment transaction execution** when the card is created. When the user later calls `POST /rewards/:id/claim`, the request body contains zero amount parameters; the server reads the pre-calculated reward directly from the locked `RewardCard` record.

---

### Question 7: Why do we round cashback down? Work out 5% of ₹137.05 in paise.
**Answer:**
1. **Why round down:** Financial systems never invent fractional currency. Because 1 Rupee = 100 paise, any sub-paise amount (fractions of a paisa) cannot be represented as an integer. Rounding down (`Math.floor`) protects the company's promotional capital from floating-point accumulation drift over millions of transactions.
2. **Calculation:**
   - ₹137.05 = $137.05 \times 100 = 13,705\text{ paise}$.
   - 5% cashback:
     $$\text{raw} = \frac{13705 \times 5}{100} = \frac{68525}{100} = 685.25\text{ paise}$$
   - Rounding down to nearest whole integer paisa:
     $$\lfloor 685.25 \rfloor = 685\text{ paise} = ₹6.85$$

---

### Question 8: When the budget is empty, why does the claim commit and return 200, instead of throwing an error?
**Answer:**
Running out of promotional budget is an **expected business outcome**, not an unhandled runtime error or invariant violation.

If the server threw an HTTP error (e.g., 400 or 500) or aborted the MongoDB transaction:
1. The transaction would roll back.
2. The card would revert to its previous `UNCLAIMED` status.
3. The user could repeatedly attempt to scratch and claim the exact same card indefinitely, hammering the database and receiving repeated error alerts.

By committing the transaction with `status: "EXHAUSTED"` and `claimedAt: new Date()`, the card state machine reaches a valid terminal state. The user receives a friendly HTTP 200 with `{"message": "Better luck next time", "amount": 0, "status": "EXHAUSTED"}`. Subsequent claim attempts are rejected with 409 Conflict.

---

### Question 9: Reserve budget when the card is created, or check when it's claimed? Give one advantage of each.
**Answer:**
Both strategies have distinct trade-offs:

1. **Reserve when the card is created:**
   - *Advantage:* Absolute predictability for the user. Anyone who receives a scratch card is guaranteed to win their cashback upon scratching; no user ever receives "Better luck next time".
   - *Downside:* Inactive users lock up promotional funds. If 40% of cards are never scratched, 40% of the marketing budget sits idle until cards expire (7 days later), making the campaign appear "exhausted" prematurely.

2. **Check when claimed (KaasuPay's choice):**
   - *Advantage:* Capital efficiency. 100% of the promotional budget is disbursed strictly to engaged, active users who open the app and scratch their cards.
   - *Downside:* Users who wait too long to scratch their cards may discover that the pool has run dry, receiving "Better luck next time".

---

### Question 10: Describe the ping pong trick. How does your rule stop it, and what honest payment might it block by mistake?
**Answer:**
1. **The Ping-Pong Trick:** Two colluding users (Arun and Bala) repeatedly send ₹100 back and forth between their accounts. They do not spend any real money, but each transfer triggers a 5% promotional cashback (₹5 per payment). Within hours, they can farm the entire marketing budget without conducting genuine commerce.
2. **How our rule stops it:** Before issuing a card, the system executes an indexed query on the `Transaction` collection:
   ```javascript
   const recentPingPong = await Transaction.findOne({
     fromUserId: recipientId,
     toUserId: payerId,
     type: "TRANSFER",
     status: "COMPLETED",
     createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
   }).session(session);
   ```
   If the recipient sent any money to the payer within the last 24 hours, the card is quietly skipped.
3. **Honest payment blocked by mistake:** Two roommates sharing expenses. Arun pays Bala ₹500 for groceries in the morning; in the evening, Bala pays Arun ₹500 for dinner. Bala's dinner payment is legitimate commerce, but will be denied a scratch card because Arun paid him earlier that day.

---

### Question 11: Why is "3 cards per day" an atomic counter, when Day 7's "5 pending requests" was a simple count?
**Answer:**
In Day 7, pending requests were **stateful, long-lived documents** in the collection. A user can only have pending requests if they have not been accepted, declined, or cancelled. Counting them with `countDocuments({ requesterId, status: "PENDING" })` inside the transaction was sufficient because pending requests stay open until decided.

In contrast, "3 cards per day" is a **daily velocity rate limiter**:
1. If we used `RewardCard.countDocuments({ userId, createdAt: { $gte: startOfDay } })`, concurrent payments arriving simultaneously could both read `count = 2`, and both insert a card, allowing 4 or more cards in a day.
2. Scratch cards are created inside payment transactions that could fail or roll back.
3. By maintaining a dedicated `RewardCount` document `{ userId, day, cards }` and executing an atomic conditional increment:
   ```javascript
   RewardCount.findOneAndUpdate(
     { userId: payerId, day: todayIST, cards: { $lt: 3 } },
     { $inc: { cards: 1 } },
     { session, returnDocument: "after" }
   )
   ```
   MongoDB's atomic document update guarantees that even if 10 payments hit the server at the exact same instant, only the first 3 can ever acquire an increment slot.

---

### Question 12: What does `budget - budgetLeft = totalPaid` prove? What would you do if `check` were false in production?
**Answer:**
1. **What it proves:** It is a formal mathematical conservation proof that every single paisa deducted from the campaign's promotional budget corresponds 1-to-1 with a successfully `CLAIMED` reward card disbursed to a user. No funds leaked into limbo, and no phantom rewards were granted without budget backing.
2. **If `check` were false in production:**
   - **Immediate Action:** Stop the offer immediately via `POST /admin/offers/:code/stop` to prevent further budget discrepancies.
   - **Triage & Query Isolation:** Query all cards for that `offerId` and compare against ledger rows:
     ```javascript
     const claimedCards = await RewardCard.find({ offerId, status: "CLAIMED" });
     const ledgerEntries = await LedgerEntry.find({ type: "CASHBACK" });
     ```
   - **Check for Orphaned Budget Decrements:** Look for any offer updates where `Offer.budgetLeft` was decremented but the transaction failed before `RewardCard` was marked `CLAIMED` (e.g. non-transactional code or unhandled promise).
   - **Reconciliation Audit:** Run `/api/v1/admin/reconcile` to determine whether the imbalance affected the Promo System Wallet or user balances.
   - **Compensating Correction:** Issue an auditable administrative adjustment transaction with explicit notes rather than directly mutating database values.

---

### Bonus 7: Random Rewards Distribution Design
**Specification:**
Real UPI scratch cards provide variable rewards (e.g. ₹1 to ₹50) with an expected value $E[X] = ₹10$ (1000 paise).

1. **Cryptographic Randomness:**
   Never use `Math.random()` in financial applications because V8's xorshift128+ PRNG is predictable if internal seed state is sampled. We use Node.js `crypto.randomInt(min, max)` backed by the OS entropy pool.

2. **Probability Distribution to achieve $E[X] = ₹10$:**
   Instead of a uniform distribution (which gives high variance), we use a weighted tiered distribution modeled after Google Pay:
   - Tier 1 (Common small win): ₹5 (500 paise) — Probability $p_1 = 0.60$
   - Tier 2 (Average win): ₹12 (1200 paise) — Probability $p_2 = 0.25$
   - Tier 3 (Exciting win): ₹25 (2500 paise) — Probability $p_3 = 0.12$
   - Tier 4 (Jackpot): ₹50 (5000 paise) — Probability $p_4 = 0.03$

   **Expected Value Proof:**
   $$E[X] = (500 \times 0.60) + (1200 \times 0.25) + (2500 \times 0.12) + (5000 \times 0.03)$$
   $$E[X] = 300 + 300 + 300 + 150 = 1,050\text{ paise} \approx ₹10.50$$
   Adjusting Tier 1 to ₹4.16 paise or tuning probabilities gives an exact $E[X] = 1,000\text{ paise} = ₹10.00$.

---

### Bonus 8: Stop an Offer Early Design
**Route:** `POST /admin/offers/:code/stop` (Staff Protected)
**Decisions & Implementation:**
1. **Offer State:** Set `isActive = false` and `endsAt = new Date()`. No new payments will receive scratch cards.
2. **Unclaimed Cards:** Cards already issued represent a contractual commitment to users who performed eligible payments. They remain valid until their individual 7-day `expiresAt` deadline and can be scratched until the remaining `budgetLeft` is exhausted.
3. **Remaining Promo Budget:** The money remaining in the Promo System Wallet is company capital. Once all issued cards reach terminal states (`CLAIMED`, `EXHAUSTED`, or `EXPIRED`), staff can execute an administrative sweep transaction transferring unspent funds from the Promo System Wallet back to company operating reserve.

