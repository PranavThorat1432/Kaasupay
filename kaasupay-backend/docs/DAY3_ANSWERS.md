# DAY3_ANSWERS.md — KaasuPay Day 3 Conceptual Questions

Answers are based on the actual Day 3 implementation in this repository.

---

## Q1. Why must money amounts be stored as integer paise rather than floating-point rupees?

Floating-point arithmetic (IEEE 754) cannot represent all decimal fractions exactly. For example, `0.1 + 0.2` in JavaScript yields `0.30000000000000004`, not `0.3`. In financial software, rounding and accumulation errors can cause real money to appear or disappear — for example, calculating fees across thousands of transactions can silently produce incorrect totals.

By storing amounts as **integer paise** (₹1 = 100 paise), all arithmetic is exact integer arithmetic. There is no floating-point rounding at any point in the pipeline — from HTTP validation (Zod rejects non-integer values) to MongoDB storage (integers stored exactly) to balance computation (`$inc` with an integer). The human-readable rupee display is computed on the fly using `(paise / 100).toFixed(2)` only when formatting a response — it is never stored.

---

## Q2. What does "atomic" mean in the context of a wallet transfer, and why is it required?

**Atomic** means the transfer either fully completes — sender's balance debited AND receiver's balance credited AND the transaction record AND both ledger entries written — or none of these changes happen at all.

Without atomicity, a server crash or network failure between the debit and credit steps would leave the system in an inconsistent state: money could disappear from the sender's wallet without reaching the receiver. With a MongoDB multi-document transaction (opened via `mongoose.startSession()` and `session.withTransaction()`), all five writes in a transfer commit together or roll back together. MongoDB guarantees that no other reader can observe a half-committed state.

---

## Q3. How does the conditional debit (`findOneAndUpdate` with a `$gte` filter) prevent negative balances?

The conditional debit is a single atomic database operation:

```js
Wallet.findOneAndUpdate(
  { userId: senderId, balance: { $gte: amount } },  // only match if balance is sufficient
  { $inc: { balance: -amount } },                   // subtract atomically
  { session, new: true }
)
```

Because the balance check and the subtraction happen in **one database operation**, there is no window between "read the balance" and "write the new balance" where another concurrent request can sneak in and also pass the check. If 10 concurrent requests all try to spend ₹400 from a ₹1,000 wallet, the MongoDB engine serialises the write lock: at most 2 will find `balance >= 40000` at the moment they execute; the remaining 8 will find the wallet already at 20000 and return null, causing the application to return 400 without touching any other data.

---

## Q4. What is a MongoDB session and why must every participating operation be passed `{ session }`?

A **MongoDB session** is a server-side context that tracks a sequence of operations. When a transaction is started on a session, every read and write that should be part of that transaction must be associated with that session by passing `{ session }` as an option.

If an operation is executed without `{ session }`, MongoDB treats it as an ordinary independent operation outside the transaction. Such an operation:
- Reads committed data, not the in-flight transaction's uncommitted writes.
- Is not rolled back if the transaction aborts.

In the money service (`services/money.js`), every `findOneAndUpdate`, `create`, and `findOne` call inside `session.withTransaction()` receives `{ session }` or `[..., { session }]` to ensure they all participate in the same transaction boundary.

---

## Q5. What is `session.withTransaction()` and what does it automatically handle?

`session.withTransaction(callback)` is the Mongoose/MongoDB driver's high-level transaction wrapper. It automatically:

1. **Starts** the transaction.
2. **Commits** the transaction when the callback resolves without throwing.
3. **Aborts** the transaction when the callback throws any error.
4. **Retries** the entire callback when the driver receives a `TransientTransactionError` (e.g., write conflicts from concurrent transactions on the same documents).

The retry behaviour is why the PRD warns not to send HTTP responses from inside the callback — the callback may run multiple times. The implementation follows this rule: all HTTP responses are sent only **after** `withTransaction()` returns, using the `result` variable captured from inside the callback.

---

## Q6. What is idempotency and why is it critical for financial APIs?

**Idempotency** means that sending the same request multiple times has the same effect as sending it once. Without idempotency:

- A client whose network request times out doesn't know whether the transfer happened. If it retries, it may transfer money twice.
- A mobile app that retries after a crash could duplicate payments.

In KaasuPay, idempotency is enforced by the `Idempotency-Key` header. The client generates a unique key per *intended* transfer. The server stores the key (associated with the authenticated user) and the hash of the request. On the first request, it processes the transfer; on subsequent requests with the same key and same body, it returns the stored response without touching any money. Importantly, this is stored in **MongoDB** (not in-process memory), so it survives server restarts.

---

## Q7. How does the unique compound index on `(userId, key)` prevent duplicate processing?

The `IdempotencyRecord` model has:

```js
idempotencyRecordSchema.index({ userId: 1, key: 1 }, { unique: true });
```

When a request arrives, the server tries to `create()` a new record with state `IN_PROGRESS`. MongoDB's unique index guarantees that only **one** insert for a given `(userId, key)` pair can succeed. If two concurrent requests with the same key arrive simultaneously:

- One succeeds and owns the record.
- The other gets a duplicate-key error (`code 11000`).

The losing request then reads the existing record and responds appropriately (409 if IN_PROGRESS, replay if DONE, 422 if a different body). Crucially, this check happens *before* the financial transaction — the index is the exclusive gate, not a preliminary `findOne()` which would have a race window.

---

## Q8. Why is the idempotency claim inserted *outside* the financial MongoDB transaction?

If the idempotency record were inserted *inside* the financial transaction, a concurrent request could also read "no record exists" before either transaction commits, and both would proceed to insert and transfer. The unique index would catch the duplicate at commit time, but by then, both financial transactions might be in-flight.

By inserting the `IN_PROGRESS` record *outside* (and before) the financial transaction, the unique index acts as an exclusive gate **before** any money moves. Only one request can ever hold the `(userId, key)` slot. The financial transaction then runs under that protection. This is the design used in `controllers/walletController.js`.

---

## Q9. What happens to the idempotency record if the server crashes between inserting IN_PROGRESS and finishing the transfer?

A crash leaves the record in `IN_PROGRESS`. The implementation's recovery strategy is:

- **For expected business errors** (insufficient balance, unknown recipient): these are caught and stored as `DONE` before returning the response. A retry with the same key gets the same stored error.
- **For unexpected infrastructure errors** (DB down, driver crash): the `IN_PROGRESS` record is **deleted** in the `deleteRecord()` helper, allowing the client to retry with the same key as if it were new.
- **For a server crash** (no code runs at all): the `IN_PROGRESS` record remains. The TTL index (`expireAfterSeconds: 30 * 24 * 60 * 60`) will eventually clean it up. Operationally, a monitoring job could sweep stale `IN_PROGRESS` records. For a new retry with the same key, the client receives 409 until the record is gone.

This strategy is documented in `WORKFLOW.md`.

---

## Q10. How does the transaction history endpoint ensure a user can only see their own history?

The history query always uses:

```js
LedgerEntry.find({ userId: req.userId })
```

where `req.userId` is set exclusively by the `requireAuth` middleware from the verified JWT — never from query strings, headers, or the request body. There is no way for a client to supply a different `userId` and receive another user's history. The authorization filter is hardcoded to the authenticated identity.

---

## Q11. Why use MongoDB aggregation for reconciliation rather than fetching all documents to JavaScript?

If the system has millions of wallets, fetching every document to compute a sum in JavaScript would require transferring gigabytes of data over the network and holding it in memory — far slower and more expensive than necessary.

MongoDB's aggregation pipeline runs the computation on the database server, close to the data, and returns only the result. For example:

```js
Wallet.aggregate([{ $group: { _id: null, totalBalance: { $sum: "$balance" } } }])
```

This computes the total of all wallet balances on the server and returns one document. The reconciliation endpoint uses aggregation for wallet totals, deposit totals, and ledger net-by-user — all on the server side.

---

## Q12. What invariant must hold for the system to be financially sound, and how is it verified?

The fundamental invariant is:

> **Total wallet balances = Total deposits**

In this system, money can only enter via `POST /api/v1/admin/deposit`. Transfers redistribute money between wallets but don't create or destroy it. Therefore, if we sum all wallet balances and compare to the sum of all completed deposit amounts, they must be equal.

A secondary per-wallet invariant is:

> **wallet.balance = sum of CREDIT ledger entries for that userId − sum of DEBIT ledger entries for that userId**

Both invariants are checked by `GET /api/v1/admin/reconcile`. The endpoint uses MongoDB aggregation to compute wallet sums and ledger net-by-user, then compares them without loading every document into JavaScript. Any wallet whose balance doesn't match its ledger net is reported in the `mismatches` array.

The Day 3 test suite also verifies money conservation after every transfer: the sum of all wallet balances is checked to equal the total deposited amount.
