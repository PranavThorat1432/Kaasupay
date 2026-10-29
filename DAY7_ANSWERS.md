# DAY7_ANSWERS.md — KaasuPay Day 7 Conceptual & Architecture Answers

Answers are based on the actual Day 7 (Request Money) implementation in this repository.

---

## Q1. Draw the state machine for a money request. Which states are final, and why must final states never change?

```
                      +-------------------+
                      |      PENDING      |
                      +-------------------+
                       /        |        \
    Payer pays        /   Payer |         \  Requester
   (atomic txn)      /  declines|          \ cancels
                    v           v           v
           +--------+     +----------+    +-----------+
           |  PAID  |     | DECLINED |    | CANCELLED |
           +--------+     +----------+    +-----------+
                    \           |           /
                     \          | 7 days   /
                      \         | pass    /
                       v        v        v
                      +-------------------+
                      |      EXPIRED      |
                      +-------------------+
```

### States and Allowed Transitions:
- **`PENDING`**: The initial state upon creation. Open to actions.
- **`PAID`**: Transitioned exclusively by the payer via `POST /api/v1/requests/:id/pay` in an atomic MongoDB transaction.
- **`DECLINED`**: Transitioned exclusively by the payer via `POST /api/v1/requests/:id/decline`.
- **`CANCELLED`**: Transitioned exclusively by the requester via `POST /api/v1/requests/:id/cancel`.
- **`EXPIRED`**: Transitioned when `now >= expiresAt` (7 days after creation).

### Final States:
The states **`PAID`**, **`DECLINED`**, **`CANCELLED`**, and **`EXPIRED`** are **terminal (final) states**.

### Why Final States Must Never Change:
1. **Financial Integrity**: Once a request is `PAID`, money has transferred from the payer to the requester with corresponding immutable double-entry ledger rows. If it could transition back to `PENDING` or `CANCELLED`, funds could be double-debited or orphaned.
2. **Deterministic Contract**: A rejected (`DECLINED`) or rescinded (`CANCELLED`) request represents a closed social contract. If a cancelled request could subsequently be paid, the payer might transfer funds for an agreement the requester had already abandoned.
3. **State Invariant**: In financial state machines, final states are immutable sinks. Once reached, outgoing edges do not exist.

---

## Q2. The requester cancels and the payer pays at the same moment. Walk through what your code does, step by step. Why can only one of them win?

Suppose Priya (requester) clicks **Cancel** and Raju (payer) clicks **Pay** at the exact same millisecond.

### Step-by-Step Execution:
1. **Parallel Invocations**:
   - Raju's request enters `payRequest` handler.
   - Priya's request enters `cancelRequest` handler.
2. **Raju's Pay Pipeline**:
   - Raju's PIN is verified successfully (`verifyPin`).
   - Idempotency slot `pay-<key>` is claimed with status `IN_PROGRESS`.
   - Starts a MongoDB session transaction and issues the atomic conditional write:
     ```js
     MoneyRequest.findOneAndUpdate(
       { _id: id, payerId: rajuId, status: "PENDING", expiresAt: { $gt: now } },
       { $set: { status: "PAID", decidedAt: now } },
       { session, returnDocument: "after" }
     );
     ```
3. **Priya's Cancel Pipeline**:
   - Priya issues the atomic conditional write:
     ```js
     MoneyRequest.findOneAndUpdate(
       { _id: id, requesterId: priyaId, status: "PENDING", expiresAt: { $gt: now } },
       { $set: { status: "CANCELLED", decidedAt: now } },
       { returnDocument: "after" }
     );
     ```
4. **WiredTiger Document-Level Concurrency Control**:
   - MongoDB evaluates writes on the same `_id` document serially using write-locks.
   - **Case A: Pay acquires document lock first:**
     - The document's status changes from `PENDING` to `PAID`.
     - Transaction completes: Raju is debited ₹500, Priya is credited ₹500, ledger rows and transaction are created, transaction commits.
     - Raju receives `200 {"message":"Request paid", ...}`.
     - Priya's `findOneAndUpdate` then executes against the document. Since `status` is now `PAID` (not `PENDING`), the filter does **not match** and returns `null`.
     - Priya's handler performs a secondary inspection, finds status is `PAID`, and returns `409 {"message":"This request is already PAID"}`.
   - **Case B: Cancel acquires document lock first:**
     - The document's status changes from `PENDING` to `CANCELLED`.
     - Priya receives `200 {"message":"Request cancelled"}`.
     - Raju's `findOneAndUpdate` executes. Since `status` is now `CANCELLED`, the filter does **not match** and returns `null`.
     - Raju's transaction throws `MoneyError(409, "This request is already CANCELLED")`, which immediately aborts the transaction.
     - Raju's wallet is **never debited**, Priya is **never credited**, and Raju receives `409 {"message":"This request is already CANCELLED"}`.

### Why Only One Can Win:
Neither operation checks first and updates later. Both operations issue an atomic conditional mutation where `{ status: "PENDING" }` is part of the query predicate. Because a document can only transition out of `PENDING` exactly once, only one atomic write can ever find `status: "PENDING"`. The other write gets `null`.

---

## Q3. Why is reading the request, checking its status, and then updating it wrong, even if your tests pass?

The "check, then act" pattern is fundamentally vulnerable to **Time-of-Check to Time-of-Use (TOCTOU)** race conditions:

```js
// WRONG PATTERN:
const reqDoc = await MoneyRequest.findById(id);
if (reqDoc.status !== "PENDING") {
  return res.status(409).json({ message: "Already decided" });
}
// <-- RACE WINDOW: Another process can alter reqDoc right here! -->
await MoneyRequest.updateOne({ _id: id }, { $set: { status: "PAID" } });
```

### Why tests might pass:
In sequential unit tests, actions run one after another with no concurrency. `findById` sees `PENDING`, and `updateOne` succeeds.

### Why it breaks in production:
When two network requests arrive simultaneously (e.g. concurrent clicks or distributed clients):
1. Thread 1 reads `status: "PENDING"` at $t_0$.
2. Thread 2 reads `status: "PENDING"` at $t_1$.
3. Thread 1 updates `status = "PAID"` and debits money at $t_2$.
4. Thread 2 updates `status = "CANCELLED"` at $t_3$.
Both threads observed `PENDING`, so both proceeded. Raju's money moved, but the request was marked `CANCELLED`.

The fix is atomic conditional execution (`findOneAndUpdate` matching `{ status: "PENDING" }`), collapsing check and write into a single indivisible engine step.

---

## Q4. Why must "mark as PAID" and "move the money" be in one transaction? What goes wrong in each order if they are not?

A payment operation combines two distinct state changes:
1. Business entity transition: `MoneyRequest` `PENDING` $\rightarrow$ `PAID`.
2. Financial ledger movement: Debit payer wallet, credit receiver wallet, create `Transaction`, create `LedgerEntry` records, update daily spend.

### If they are NOT in one transaction:

#### Order 1: Mark as PAID first, then Move Money:
```
1. MoneyRequest marked PAID
   [SERVER CRASHES / DB CONNECTION DROPS / INSUFFICIENT BALANCE]
2. Money never moves
```
- **Disaster**: The request is marked `PAID`. Priya assumes Raju has settled the debt. But Raju was never debited, and Priya's wallet was never credited. Because the request is now `PAID`, Raju cannot re-pay it.

#### Order 2: Move Money first, then Mark as PAID:
```
1. Payer debited ₹500, Requester credited ₹500
   [SERVER CRASHES / REQUEST UPDATE FAILS]
2. MoneyRequest remains PENDING
```
- **Disaster**: Real money has transferred. But the request remains `PENDING`. Raju's app still prompts him to "Pay ₹500". If Raju taps "Pay" again, another ₹500 leaves his account.

### The Solution:
By enclosing both inside `session.withTransaction()`:
```js
await session.withTransaction(async () => {
  // 1. Conditional state change to PAID
  // 2. Consume daily limit
  // 3. Conditional debit payer balance
  // 4. Credit requester balance
  // 5. Create Transaction & LedgerEntry rows
});
```
If any error occurs or the server crashes, MongoDB rolls back all writes. Either both the state change and the money movement happen, or neither happens.

---

## Q5. The Idempotency-Key already stops double payments. Why do we also need the PENDING to PAID check?

The two checks serve fundamentally different threat models: **Two Locks on One Door**.

| Defense Layer | Mechanism | What It Protects Against |
|---|---|---|
| **Lock 1: `Idempotency-Key`** | Key lookup in `IdempotencyRecord` | Network retry of the **exact same tap** (e.g. mobile app loses 4G connection and retransmits identical payload and key). Returns cached 200 without second execution. |
| **Lock 2: `status: "PENDING"` condition** | Atomic predicate in `findOneAndUpdate` | A **different tap entirely**: user tapping Pay twice with new keys generated by client UUIDs, paying from two different devices simultaneously, malicious API scripts, or Pay racing against Cancel. |

If you only relied on `Idempotency-Key`:
- A user double-clicking "Pay" where the frontend generates a fresh UUID per click would bypass idempotency because the second request has a different key.
- The second request would execute a second payment for the same bill!

If you only relied on `status: "PENDING"`:
- A network dropped connection on a legitimate payment would fail when retried with the same key because the request is already `PAID`. The client would see an error (409) rather than confirming success.

Together, Lock 1 safely replays retries, and Lock 2 blocks independent parallel mutations.

---

## Q6. How does lazy expiry work? Why does it fit Vercel better than a job that runs every minute?

### How Lazy Expiry Works:
Instead of running an active background job that scans the collection every 60 seconds:
1. **Timestamp on Write**: When created, `expiresAt` is set to `Date.now() + 7 days`.
2. **Passive Mutation Guard**: Every action (`pay`, `decline`, `cancel`) adds `expiresAt: { $gt: new Date() }` to its atomic query. If the request is older than 7 days, the query matches nothing and returns `410 {"message":"This request has expired"}`.
3. **Read-Time Inbox Sweep**: When either party fetches their inbox (`/requests/incoming` or `/requests/outgoing`), the server executes a single batch update before querying:
   ```js
   await MoneyRequest.updateMany(
     { [roleId]: req.userId, status: "PENDING", expiresAt: { $lte: new Date() } },
     { $set: { status: "EXPIRED" } }
   );
   ```

### Why it fits Vercel / Serverless Environments:
- **Serverless Architecture**: Vercel functions are stateless and ephemeral; they spin up to handle an HTTP request and freeze or terminate immediately afterwards. There is no long-running Node.js process to run `setInterval` or cron timers.
- **Cost & Quota Efficiency**: Scheduled cron jobs on serverless platforms invoke full functions on fixed intervals regardless of whether any requests are due to expire, burning monthly function invocations.
- **On-Demand Reality**: An expired request that no one is viewing or paying harms nothing by remaining in the database. It is like an expiration date on a milk carton: you only need to evaluate the date when someone picks it up or attempts to consume it.

---

## Q7. A request's database row says PENDING, but its expiresAt was yesterday. Can anyone pay it? Explain why not.

**No, nobody can pay it.**

Even if the database document has not yet been swept by `updateMany` and still contains `status: "PENDING"`, payment is impossible because:

1. **Pre-Check**: `payRequest` checks `if (doc.expiresAt <= now) return res.status(410).json({ message: "This request has expired" });`.
2. **Atomic Transaction Condition**: Inside the MongoDB transaction, the state update query is:
   ```js
   MoneyRequest.findOneAndUpdate(
     {
       _id: id,
       payerId: req.userId,
       status: "PENDING",
       expiresAt: { $gt: txNow } // <-- Strictly requires future expiry
     },
     { $set: { status: "PAID", decidedAt: txNow } },
     { session }
   );
   ```
Because `expiresAt` was yesterday, `expiresAt: { $gt: txNow }` evaluates to `false`. The query finds 0 documents and returns `null`. The transaction immediately aborts with HTTP `410 Gone`, and no money moves.

---

## Q8. Why do we return 404, not 403, when a stranger asks for someone else's request? When is 403 fine?

### Stranger Access $\rightarrow$ `404 Not Found`:
If user Kavi queries `GET /api/v1/requests/:id` for a request between Priya and Raju:
- Returning `403 Forbidden` would tell Kavi: *"This request exists, but you are not permitted to see it."*
- This creates an **information disclosure vulnerability** (ID harvesting / enumeration). An attacker could probe IDs to discover which transaction IDs exist and infer transaction activity.
- Returning `404 Not Found` reveals nothing: Kavi cannot tell whether the ID is valid or entirely fictitious.

### Legitimate Party with Wrong Action $\rightarrow$ `403 Forbidden`:
When the user is an **authorized party** to the request but attempts an illegal role-based action:
- Example: Priya (requester) attempts to decline or pay her own request.
- Priya already created the request and knows its ID, amount, and existence. There is no privacy leakage.
- Returning `403 {"message":"Only the person asked can pay this request"}` provides clear, actionable feedback explaining why the business operation was rejected.

---

## Q9. Why is the PIN checked before the idempotency record is created, and why is the PIN never part of the request hash?

### 1. Why PIN is checked before creating the Idempotency Record:
- If we created an idempotency record *before* verifying the PIN, entering a typo in the PIN would save the idempotency record.
- When the user realizes their typo and immediately tries again with the correct PIN and the same `Idempotency-Key` (standard mobile retry), the system would either:
  - Return the cached wrong PIN error, or
  - Reject the retry with `422 Mismatched Payload` (if PIN was hashed).
- In both cases, the client's `Idempotency-Key` is permanently poisoned by a typo.
- By verifying `verifyPin(req.userId, pin)` **before** inserting `IdempotencyRecord`, a wrong PIN simply returns `403 {"message":"Wrong PIN. 2 tries left","triesLeft":2}` without claiming the key slot. When the user enters the correct PIN, the key remains valid and clean.

### 2. Why PIN is NEVER part of the Request Hash:
- The idempotency request hash must identify the *business action* (`POST /api/v1/requests/:id/pay`), not authentication credentials.
- **Security Vulnerability**: Storing a hash that incorporates plaintext PIN data inside the database logs or idempotency records leaks sensitive authorization material and violates PCI-DSS / security compliance standards.
- A PIN is an authorization credential for step-up verification, not a parameter of the financial resource.

---

## Q10. Explain the compound index for the incoming list, and why its fields are in that order.

In `models/moneyRequestModel.js`:
```js
moneyRequestSchema.index({ payerId: 1, status: 1, createdAt: -1 });
```

This follows the **ESR (Equality, Sort, Range)** rule for optimal index performance:

1. **`payerId: 1` (Equality)**:
   Every incoming query filters specifically for the logged-in user: `{ payerId: req.userId }`. This immediately narrows down the search space from millions of documents to only those belonging to this user.
2. **`status: 1` (Equality)**:
   Users frequently filter their inboxes by status (e.g. `?status=PENDING`). Placing `status` second allows MongoDB to narrow the filtered index keys directly.
3. **`createdAt: -1` (Sort)**:
   Inboxes are sorted newest first (`.sort({ createdAt: -1 })`). Because `createdAt: -1` is in the index in the required direction, MongoDB reads the matched index keys in pre-sorted order, performing an **index scan with zero memory sort** (`SORT_KEY_GENERATOR` overhead is eliminated).

If the fields were reversed (e.g. `{ createdAt: -1, payerId: 1 }`), MongoDB would have to scan the entire collection's date order before filtering by user, causing severe table scan bottlenecks.

---

## Q11. "At most 5 pending requests to one person" is a check, then act. Why is that acceptable here, but never for a balance?

### Why it is acceptable for the Spam Limit:
- The 5-pending limit is a **heuristic defense against spam and annoyance**.
- If two requests are submitted at the exact same millisecond and race, the count might briefly reach 6 instead of 5 before stabilizing.
- A recipient receiving 6 requests instead of 5 is a harmless cosmetic edge-case that creates zero financial discrepancy, zero loss of funds, and zero ledger corruption. Requiring distributed database locking or multi-document serializable isolation for anti-spam counters would impose massive database latency for negligible benefit.

### Why it is NEVER acceptable for Wallet Balance:
- A wallet balance represents **real money**.
- If two transfer requests of ₹500 race against a ₹500 balance using "check-then-act":
  1. Thread 1 reads `balance = ₹500` (check passes).
  2. Thread 2 reads `balance = ₹500` (check passes).
  3. Thread 1 debits ₹500 $\rightarrow$ balance ₹0.
  4. Thread 2 debits ₹500 $\rightarrow$ balance -₹500.
- An attacker with ₹500 could extract ₹50,000 by firing 100 concurrent requests! Money would be created out of thin air, violating the core mathematical invariant of double-entry bookkeeping ($\sum \text{Credits} = \sum \text{Debits}$).
- Balance checks must **always** be atomic and conditional (`{ balance: { $gte: amount } }`).

---

## Q12. Split ₹1,000 between 3 people in paise. How do you make sure the parts add up exactly?

### The Problem:
- Total = ₹1,000 = `100000` paise.
- 3 people split equally: $100000 / 3 = 33333.333...$ paise.
- Since money amounts in KaasuPay must be integer paise, fractional paise cannot exist.
- $33333 \times 3 = 99999$ paise. A naive round-down loses 1 paisa (₹0.01 disappears).
- $33334 \times 3 = 100002$ paise. A naive round-up invents 2 paise out of thin air.

### The Algorithm:
To guarantee **strict conservation of money** ($\sum \text{parts} = \text{total}$):
1. Compute integer base quotient:
   $$\text{base} = \lfloor \text{total} / N \rfloor = \lfloor 100000 / 3 \rfloor = 33333 \text{ paise}$$
2. Compute remainder:
   $$\text{remainder} = \text{total} \pmod N = 100000 \pmod 3 = 1 \text{ paisa}$$
3. Distribute the remainder 1 paisa at a time across the first $R$ participants:
   - Participant 1 (e.g. requester or first friend): $33333 + 1 = 33334 \text{ paise}$ (₹333.34)
   - Participant 2: $33333 \text{ paise}$ (₹333.33)
   - Participant 3: $33333 \text{ paise}$ (₹333.33)

### Verification:
$$33334 + 33333 + 33333 = 100000 \text{ paise} = ₹1,000.00$$

Every paisa is accounted for, integer arithmetic is preserved, and administrative reconciliation continues to report `moneyIsConserved: true`.
