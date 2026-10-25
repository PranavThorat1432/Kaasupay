# KaasuPay Day 5 — Interview Corner Answers

Written in own words covering the transactional outbox pattern, sagas, compensating transactions, bank idempotency, and distributed systems failure recovery.

---

### 1. Why can't a withdrawal use one database transaction the way a transfer does?
A database transaction (ACID) operates strictly within a single database engine across its internal storage boundary. In a P2P transfer, both the sender's wallet and receiver's wallet reside inside our MongoDB replica set, so one atomic transaction can coordinate both balance updates, the transaction record, and ledger entries simultaneously (all-or-nothing).

A bank withdrawal spans two fundamentally separate systems operated by different organizations: our internal database (debiting Raju's wallet) and the external bank's core banking system (paying out funds into Raju's account). No distributed transaction (2-phase commit) exists between our database and an external third-party HTTP API. This is known as the **dual-write problem**. Because one system can succeed while the other fails, times out, or becomes unreachable, we cannot coordinate them with a single database transaction. Instead, we must manage the workflow asynchronously through intermediate states (`PENDING`, `PROCESSING`, `SUCCESS`, `REVERSED`, `NEEDS_REVIEW`) and safe retry semantics.

---

### 2. Why do we take the money from the wallet before calling the bank, and not after?
If we called the bank first and only reduced the wallet balance afterward upon hearing success, a race condition occurs:
1. A user with ₹2,000 balance could fire three withdrawal requests of ₹2,000 simultaneously.
2. If all three check the balance before calling the bank, all three see ₹2,000 available.
3. The bank receives and pays all three payouts (totaling ₹6,000 disbursed).
4. When the API attempts to debit the wallet afterward, only the first debit succeeds, leaving the company with a ₹4,000 loss (negative wallet balance or uncollected funds).

By debiting (or holding) the money in our database *first* before making any external network call, the funds are immediately locked and cannot be double-spent across transfers, further withdrawals, or purchases. If the bank subsequently rejects the payout, we safely restore the funds via a compensating credit transaction.

---

### 3. What does 202 mean, and why is it the right reply here instead of 201?
- **HTTP 201 Created** signifies that the requested action is completely finished and the resulting resource is created and final.
- **HTTP 202 Accepted** signifies that the request has been validated and accepted for processing, but the processing has not yet been completed. It explicitly informs the client: *"We have received your request and held your money; we are working on it asynchronously, but it is not paid yet."*

Using 201 would mislead the client and user into believing the bank has already deposited money into their account. Because bank payouts can take seconds, minutes, or hours depending on banking rails (IMPS/NEFT/RTGS) and partner downtime, 202 Accepted allows the API to respond in milliseconds without keeping HTTP connections open while the worker coordinates with the bank in the background.

---

### 4. What is the outbox, and what exact problem does it solve that "call the bank after saving" does not?
The **Transactional Outbox Pattern** writes a "to-do" event (`OutboxEvent`) into the *same database transaction* that debits the wallet and records the withdrawal.

If we instead adopted the naive approach: *"save withdrawal to database, then call the bank or push to an in-memory queue"*, a server crash, process kill, network disruption, or deployment restart in the microscopic window between saving and calling the bank causes catastrophic silent failure:
- The wallet was debited.
- The withdrawal document was saved as `PENDING`.
- But the call to the bank was never made, and the in-memory task was wiped out.
- The user's money vanished with no worker ever picking it up.

With the transactional outbox pattern, the outbox record commits atomically with the wallet debit. If the transaction rolls back, neither exists. If it commits, the persisted event is guaranteed to reside in the database, where any worker instance can discover and execute it even after a total crash and restart.

---

### 5. Two workers run at once. How does your code make sure only one of them handles each withdrawal?
We use an atomic `findOneAndUpdate` operation with conditional criteria directly in MongoDB:

```javascript
const job = await OutboxEvent.findOneAndUpdate(
  {
    $or: [
      { status: "NEW", nextAttemptAt: { $lte: now } },
      { status: "PROCESSING", lockedAt: { $lte: staleThreshold } }
    ]
  },
  {
    $set: { status: "PROCESSING", lockedAt: now },
    $inc: { attempts: 1 }
  },
  { returnDocument: "after", sort: { nextAttemptAt: 1 } }
);
```

Because MongoDB document-level write locks are atomic, only one worker can match the document while its status is `NEW`. The winning worker atomically transitions the status to `PROCESSING` and acquires the lease (`lockedAt: now`). Any other concurrent worker evaluating the query will see that the status is already `PROCESSING` and will skip it, claiming the next due job instead.

---

### 6. The bank call timed out. Why must you not refund the user straight away?
When an HTTP request times out (e.g. after 3 seconds with an `AbortController`), you only know that **you stopped waiting**. You do **NOT** know what occurred on the bank's servers.

In distributed systems:
1. The request may have reached the bank.
2. The bank may have debited the bank account and credited the beneficiary.
3. The bank sent an HTTP 200 response, but a network packet dropped or was delayed on the return route.

If KaasuPay automatically refunded Raju's wallet on timeout, and the bank actually disbursed ₹2,000 into Raju's bank account, Raju now has ₹2,000 in his bank account AND ₹2,000 back in his KaasuPay wallet. KaasuPay loses ₹2,000.
Therefore, a timeout means **"outcome unknown"**, never "failed". The only safe response is to retry using the exact same reference key, allowing the bank's idempotency layer to return the definitive status.

---

### 7. How does the reference stop the bank from paying twice? What would happen if you made a new reference on each retry?
The `reference` (e.g., `wd_<withdrawalId>`) acts as a client-generated **Idempotency Key** for the bank.

When the bank payout API receives a request:
1. It records the reference in its payment database.
2. If it receives a second request with that identical reference, it recognizes that it has already executed or is currently processing that exact transaction.
3. Rather than dispatching a second payout, the bank returns the cached result of the original payout (or status `202 PROCESSING`).

If our worker generated a *new* reference on every retry (e.g., `wd_<timestamp>`), the bank would treat each attempt as a brand new payout request. If attempt 1 actually succeeded but timed out on the wire, attempt 2 with a new reference would pay the user a second time, resulting in a duplicate payout. The reference must be created once upon withdrawal creation, persisted, and strictly reused across all retries.

---

### 8. Which bank answers should be retried, and which should not? Why?
- **Should NOT be retried (Definitive Final Outcomes):**
  - **HTTP 200 with `status: "SUCCESS"`**: Money was successfully paid out. Mark withdrawal as `SUCCESS` with the UTR (`bankRef`), mark outbox job `DONE`.
  - **HTTP 200 with `status: "FAILED"` (e.g. Account closed, invalid account number)**: The bank has definitively refused the transfer. Retrying will never succeed. Execute the compensating transaction (`reverseWithdrawal`) to credit the wallet back, and mark the outbox job `DONE`.
  - **HTTP 400 Bad Request**: Our payload was rejected (e.g., malformed account number or invalid IFSC). Retrying the exact same payload will continually yield 400. Refund the user and mark the job `DONE`.

- **SHOULD be retried (Transient or Ambiguous Outcomes):**
  - **HTTP 202 with `status: "PROCESSING"`**: The bank is actively communicating with clearing networks (e.g., NPCI/IMPS) and has not finalized the settlement. Try again later with the same reference.
  - **HTTP 500, 502, 503, 504**: Internal server errors, gateway timeouts, or bank maintenance. The bank is temporarily experiencing issues; retry with exponential backoff.
  - **AbortError (Timeout) & Network Failures (`ECONNRESET`, `ECONNREFUSED`)**: The connection dropped before confirmation. Re-query with the same reference to let the bank provide the true status.

---

### 9. Explain backoff and jitter with a real-life example.
- **Exponential Backoff**: When a system fails, rather than retrying immediately every second, you progressively double the wait interval between successive attempts (e.g., 2s, 4s, 8s, 16s).
  - *Real-life analogy*: If you knock on a doctor's consultation door and they say "please wait a moment", knocking again every single second irritates the doctor and delays them further. Waiting 2 minutes, then 4 minutes, then 8 minutes allows the doctor time to resolve the situation.

- **Jitter**: Adding a randomized offset (e.g., `+ Math.random() * 500ms`) to each backoff interval.
  - *Real-life analogy (The Thundering Herd)*: Imagine 500 cars stuck at a red traffic light on a freeway during a blackout. If every single driver's GPS simultaneously alerts them: *"Detour opens in exactly 60 seconds"*, all 500 cars will surge onto the small side-street in the exact same millisecond, instantly causing a total traffic jam. If instead each GPS introduces a random jitter of 0 to 15 seconds, cars merge smoothly in small intervals without crashing the road network.

---

### 10. Why do we add a REVERSAL entry instead of deleting the withdrawal?
In double-entry financial accounting, **financial ledgers are strictly append-only and immutable**. You never delete, alter, or rewrite historical entries:
1. **Auditability**: If a withdrawal is deleted, Raju's statement would show a mystery debit that disappeared, making it impossible for auditors, tax regulators, or customers to reconstruct why their balance was ₹700 at 10:00 AM and ₹900 at 10:05 AM.
2. **Ledger Integrity**: A debit occurred when the withdrawal was initiated. When the bank rejects the payout, a new compensating **`REVERSAL` transaction** with a **`CREDIT` ledger entry** documents the refund explicitly.
3. **Reconciliation**: Reconciling `Total Balance = Money In - (Withdrawals - Reversals)` depends on every historical event having an exact mathematical counterpart. Deleting records destroys the mathematical audit trail.

---

### 11. After 5 failed tries, why is NEEDS_REVIEW safer than an automatic refund?
If the bank has been unreachable, timing out, or returning 503 for 5 consecutive attempts over ~40 seconds, the status of the payout remains completely **ambiguous**:
- Did the bank actually pay out ₹25,000 into the customer's account during attempt 2 or 3?
- Or did the bank never process it at all?

If we automatically refunded ₹25,000 back to Raju's wallet, and the bank had actually transferred the ₹25,000, Raju would receive ₹50,000 and could withdraw or spend both.
By parking the withdrawal in **`NEEDS_REVIEW`** and halting the outbox job in **`STUCK`**:
1. We **never guess with money**.
2. Raju's wallet is not prematurely refunded.
3. Operations/staff investigate with the bank portal or support hotline using the unique `reference`.
4. If the bank confirms the UTR was issued and paid, staff settle the withdrawal as `SUCCESS`.
5. If the bank confirms the payment never executed, staff trigger `reverseWithdrawal` to safely refund Raju.

---

### 12. Your worker crashed while a job was PROCESSING. What happens to that withdrawal, step by step?
1. **The Crash**:
   - The worker claimed job `OutboxEvent #42`, set its status to `PROCESSING` with `lockedAt = 10:00:00 AM`, and incremented `attempts = 1`.
   - Before completing the bank call or saving the result, the server suffered a power outage or kernel panic and halted.
   - In MongoDB, the withdrawal remains `PENDING` (or `PROCESSING`), and `OutboxEvent #42` remains `status: "PROCESSING"` with `lockedAt = 10:00:00 AM`.
2. **The Stale Lock Window**:
   - For 60 seconds, no other worker touches job #42 because its lease is currently held.
3. **Lease Expiration and Reclamation**:
   - At `10:01:05 AM`, another worker (or the restarted worker) runs `claimNextJob`.
   - The query matches jobs where `status === "PROCESSING"` AND `lockedAt <= now - 60000ms` (older than 60 seconds).
   - The revived worker reclaims the abandoned job, updates `lockedAt` to `10:01:05 AM`, and increments `attempts = 2`.
4. **Idempotent Bank Query**:
   - The worker loads withdrawal #42, finds its stored `reference: "wd_42"`, and submits `POST /payouts` with reference `"wd_42"`.
   - The bank receives the request:
     - If the bank already paid during attempt 1 before the crash, it recognizes `"wd_42"` and returns the cached `SUCCESS` status with the existing UTR.
     - If the bank never processed attempt 1, it executes the payout now and returns `SUCCESS`.
5. **Resolution**:
   - The worker updates withdrawal #42 to `SUCCESS` with the bankRef and marks outbox job #42 as `DONE`.
   - No human intervention was needed, no money was lost, and the payout was executed exactly once.
