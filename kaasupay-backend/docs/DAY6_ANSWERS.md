# KaasuPay Day 6 — Lock the Wallet: Interview Corner Answers

## 1. The user is already signed in with a JWT. Why ask for a PIN again before each payment?
Signing in with a password and receiving a JWT establishes **session identity** ("Who are you?"). That token lives in local storage or memory for an extended period (typically hours or days) to allow users to view their wallet balance, inspect transaction history, and navigate without entering credentials on every screen.

However, moving money out of the wallet (P2P transfers or bank withdrawals) represents a high-risk financial write. If an authenticated user lends their unlocked phone to a colleague, leaves it unattended on a desk, or has their device stolen while the session is open, a valid JWT would allow an attacker to drain the entire balance immediately. 

Requiring a Payment PIN introduces **step-up authentication** ("Is it truly you authorizing this specific transfer right now?"). By separating passive view authorization from active transactional authorization, we prevent session hijacking from translating into financial theft.

---

## 2. A 4-digit PIN has only 10,000 possible values. Why doesn't bcrypt alone keep it safe, and what actually protects it?
A 4-digit PIN has an extremely small keyspace (from `0000` to `9999` = 10,000 combinations). Even with a high bcrypt work factor (10–12 rounds) requiring ~100ms per hash verification, an attacker with an offline copy of the database could iterate through every possible combination in under 17 minutes. Therefore, **hashing alone cannot secure a short PIN against brute-force attacks**.

What genuinely protects a short PIN in production is **server-enforced rate limiting and attempt lockout**:
1. The API strictly limits guesses to 3 consecutive wrong attempts.
2. Once 3 incorrect attempts occur, the server locks the PIN for 15 minutes (`pinLockedUntil`), refusing all guesses—even the correct one.
3. An attacker without direct database access can only test PINs through the public API. At 3 guesses per 15 minutes, exhausting 10,000 combinations would take over **34 days of continuous attempts**, rendering remote online brute-force attacks completely unviable.

---

## 3. Why must the PIN never be part of the idempotency requestHash, a log line, or an error message?
1. **Logs (`console.log(req.body)`)**: Application logs are ingested into log aggregators (Datadog, CloudWatch, ELK), indexed, replicated across environments, and viewed by engineers, support staff, and automated monitors. Logging a raw PIN creates an immediate data leak violating PCI-DSS and financial privacy regulations.
2. **Error messages**: If an error occurs, echoing the attempted PIN in the response body or stack trace exposes sensitive authentication secrets over HTTP.
3. **Idempotency `requestHash`**: The `requestHash` is computed from the business intent (`to`, `amount`, `note`) and stored permanently in the MongoDB `idempotencyrecords` collection. If the PIN were hashed into `requestHash` or stored alongside it:
   - A stolen database would contain pre-image candidates of PINs.
   - More critically, if a user mistypes their PIN on an idempotent request and then retries with the correct PIN using the *same* `Idempotency-Key`, altering the hash would cause the server to treat it as an illegitimate key reuse (`422 Idempotency-Key reused with different request parameters`), breaking retry ergonomics.

---

## 4. Explain the "check, then act" bug in counting wrong PINs, using two requests that arrive at the same moment. How does reserving a try first fix it?
### The "Check, Then Act" Race Condition
Consider a naive implementation:
1. `const user = await User.findById(userId);`
2. `if (user.pinFailedCount >= 3) return res.status(423).json({ message: "Locked" });`
3. `const ok = await bcrypt.compare(inputPin, user.pinHash);`
4. `if (!ok) await User.updateOne({ _id: userId }, { $inc: { pinFailedCount: 1 } });`

If an attacker sends 50 wrong guesses simultaneously at `t=0ms`:
- All 50 requests read `pinFailedCount = 0` from MongoDB at the same time.
- All 50 requests evaluate `0 < 3` as `true` and proceed to `bcrypt.compare`.
- All 50 guesses are evaluated against the hash before any write occurs.
- The 3-guess security boundary is completely bypassed.

### The Fix: Atomic Attempt Reservation
Instead of reading first, the server atomically reserves an attempt in MongoDB:
```javascript
const reserved = await User.findOneAndUpdate(
  { _id: userId, pinFailedCount: { $lt: 3 }, $or: [{ pinLockedUntil: null }, { pinLockedUntil: { $lte: now } }] },
  { $inc: { pinFailedCount: 1 } },
  { returnDocument: "after" }
);
```
MongoDB executes the conditional filter and `$inc` as a single atomic operation on the document. When 50 concurrent requests arrive, exactly 3 will acquire a modified document; the other 47 receive `null` and are immediately rejected without touching bcrypt. Once the reserved document is returned, the code checks the PIN. If correct, `pinFailedCount` resets to 0.

---

## 5. Why reply 403 for a wrong PIN and not 401? Why 423 for a locked PIN, and what does Retry-After tell the app?
- **HTTP 403 Forbidden vs 401 Unauthorized**:
  - `401 Unauthorized` specifically indicates that the client lacks valid session credentials (missing, invalid, or expired JWT). When client applications (e.g., Axios interceptors or mobile SDKs) intercept a `401`, standard behavior is to wipe stored tokens and force redirect the user to the Sign In screen.
  - A wrong PIN is not an invalid JWT session; the user is authenticated, but their step-up permission for this specific operation is denied. Returning `403 Forbidden` informs the UI that the user remains signed in and should simply prompt for PIN re-entry with remaining tries.
- **HTTP 423 Locked**:
  - `423 Locked` (WebDAV / RFC 4918) explicitly communicates that the resource/action is temporarily locked due to policy enforcement.
- **`Retry-After` Header**:
  - Contains the exact cooldown duration in seconds (e.g., `Retry-After: 900`). This allows frontend clients to render a live countdown timer ("Try again in 14 minutes 50 seconds") and disable submission buttons until the lock window expires, preventing useless traffic.

---

## 6. Why do we keep a daily counter document instead of adding up today's transactions on each request? Give both reasons.
1. **Performance at Scale (O(1) vs O(N) reads)**:
   - Calculating daily spend by aggregating the `transactions` collection requires querying and summing all debit records for a user on that day. For active merchant accounts or high-frequency transactors with hundreds of transfers, computing an aggregation on every single payment creates heavy CPU and disk I/O overhead.
   - A dedicated `DailySpend` document (`{ userId, day: "2026-10-24", spent: 45000 }`) allows an instant indexed lookup in O(1) constant time.
2. **Concurrency Protection ("Check, Then Act" Prevention)**:
   - Aggregating historical rows cannot be done conditionally in an atomic update. If a user with ₹0 spent sends two ₹6,000 transfers concurrently, both aggregation queries would see ₹0 spent and permit both requests to execute, allowing ₹12,000 to leave on a ₹10,000 limit.
   - With a single counter document, MongoDB executes an atomic conditional write:
     `findOneAndUpdate({ userId, day, spent: { $lte: 1000000 - amount } }, { $inc: { spent: amount } })`
     One request wins the lock and increments `spent`; the concurrent request immediately sees that `spent` exceeds the limit and fails.

---

## 7. The server runs in UTC. Raju sends money at 2 AM India time. Which day should it count for? What goes wrong if you use the server's date?
- **Correct Calendar Day**: It must count for the **India calendar day (Asia/Kolkata, UTC + 5:30)**.
- **What Goes Wrong with Server UTC**:
  - Standard cloud servers (AWS, Railway, Render) run in UTC (`Date.now()`).
  - At 2:00 AM on October 22 in India, the UTC timestamp is 8:30 PM on October 21 (`2026-10-21T20:30:00Z`).
  - If the server relies on `toISOString().slice(0, 10)`, the date is recorded as October 21. At 5:30 AM India time (midnight UTC), the date flips to October 22.
  - Consequently, a user who sends ₹10,000 at 2:00 AM India time would see their daily limit arbitrarily reset 3.5 hours later at 5:30 AM, effectively granting them a double limit (₹20,000) within the same local morning.
  - Applying `indiaDay()` (`UTC + 5:30`) ensures the limit resets exactly at 12:00 AM Indian Standard Time.

---

## 8. Why must the daily limit update sit inside the same transaction as the money hold?
A financial transfer consists of multiple interdependent state mutations:
1. Reserving daily limit headroom on `DailySpend`.
2. Deducting balance from `Wallet`.
3. Creating the `Transaction` record.
4. Writing double-entry `LedgerEntry` audit logs.

If the daily limit counter were incremented outside the database transaction:
- Suppose `DailySpend.spent` is incremented by ₹6,000.
- The subsequent wallet update fails because the user only has ₹2,000 in available balance.
- Because the counter update was non-transactional, it cannot automatically roll back.
- The user's wallet is not debited, but they have permanently lost ₹6,000 of their daily limit for the day without sending any money.

Placing `checkAndConsumeDailyLimit` inside `session.withTransaction()` guarantees atomicity: if the balance check or receiver lookup fails, MongoDB rolls back both the wallet mutation and the daily limit counter increment together.

---

## 9. Show how a bot can get double the limit through a fixed window. How do a sliding window and a token bucket stop that?
### The Fixed Window Boundary Attack
Assume a limit of 5 requests per 60-second window:
- Window 1: 10:00:00 to 10:00:59
- Window 2: 10:01:00 to 10:01:59
- An attacker sends 5 requests at `10:00:59` (end of Window 1). All 5 pass.
- At `10:01:00` (start of Window 2), the counter resets to 0. The attacker immediately sends 5 more requests.
- All 10 requests succeed across a span of **2 seconds**, doubling the intended throughput limit.

### Fix 1: Sliding Window Counter
Rather than wiping the counter on fixed window boundaries, the algorithm weights the count of the previous window relative to the current timestamp:
$$\text{Estimated Count} = \text{Current Window Count} + \text{Previous Window Count} \times \left(1 - \frac{\text{Time elapsed in current window}}{\text{Window duration}}\right)$$
At `10:01:01` (1 second into Window 2), 59/60ths of Window 1's count is still counted. The calculated rate is $5 + 5 \times (59/60) \approx 9.9$, and any further requests are rejected with HTTP 429.

### Fix 2: Token Bucket
Each user possesses a virtual bucket holding at most $N$ tokens (e.g. 5). Every request consumes 1 token. Tokens refill at a steady, deterministic rate (e.g., 1 token every 12 seconds).
- A user can burst up to 5 requests instantaneously if the bucket is full.
- Once depleted, requests can only be executed as new tokens drip into the bucket (1 every 12s), smoothing bursts and strictly capping sustained throughput.

---

## 10. Why can't production keep rate limit counts in a JavaScript object? Where do big companies keep them?
### Why In-Memory JS Objects Fail in Production
1. **Multi-Instance Deployments**: Production architectures run multiple stateless instances (containers or serverless workers) behind a load balancer. If an in-memory `Map` or object is used, an attacker hitting 10 backend instances receives 10 times the rate limit before getting blocked.
2. **Server Restarts & Deploys**: Deploying code or restarting a container clears in-memory memory heaps, immediately wiping all active penalty timers and counters.
3. **Memory Leaks**: Without explicit cleanup, storing IPs or user IDs in a Node.js process table causes unbounded heap memory growth.

### Production Solution: Redis
Large-scale payment platforms (Stripe, Razorpay, Paytm) store rate limits in **Redis**:
- **Atomic Operations**: Commands like `INCR` and `EXPIRE` execute atomically in a single network round-trip.
- **Shared State**: All application server instances connect to the same central Redis cluster.
- **Native TTL**: Keys expire automatically via Redis engine eviction without requiring manual garbage collection.

---

## 11. A JWT is valid until it expires. How does `tokenVersion` log a user out everywhere? What does it cost on every request, and what would you do about that cost at scale?
### How `tokenVersion` Revokes Stateless Tokens
Because JWTs are cryptographically signed and stateless, the server cannot unilaterally "destroy" an issued token stored on a remote client device.
1. The `User` database model stores an integer `tokenVersion` (default `0`).
2. Every issued JWT payload embeds `tv: user.tokenVersion`.
3. To revoke all active sessions ("Log out of all devices" or password change), the server executes:
   `User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } })`
4. On every authenticated request, `authMiddleware` decodes the token and verifies that `decoded.tv === user.tokenVersion`. Old tokens with `tv: 0` immediately fail the check and receive `401 Unauthorized ("Session ended. Please sign in again")`.

### Cost and Scaling Optimization
- **The Cost**: Every incoming API request incurs a database read to fetch `user.tokenVersion`, re-introducing stateful overhead to a stateless protocol.
- **Optimization at Scale**:
  - **Redis Caching**: Cache `tokenVersion` by `userId` in Redis (`MGET user:tv:<userId>`). Since Redis reads take sub-millisecond in-memory time, the database is never queried on standard requests.
  - **Short-Lived Access Tokens**: Use 15-minute access tokens with long-lived rotating refresh tokens. The version check is only performed when exchanging the refresh token.

---

## 12. List the checks in your send money route in order. Why does the PIN check come before the idempotency record?
### Gate Order
```text
POST /api/v1/wallet/transfer
 1. Authentication (JWT signature & expiry verification, tokenVersion check)       [401]
 2. Rate Limiting (Under 10 money operations per minute per user)                 [429]
 3. Input Validation (Idempotency-Key present & format; Zod schema validation)    [400]
 4. Recipient Verification (Recipient exists in DB; receiver !== sender)          [404/400]
 5. Payment PIN Verification (Atomic attempt reservation; lockout enforcement)    [403/423]
 6. Idempotency Claim (Atomically claim IN_PROGRESS slot; replay if DONE)         [Replay / 409 / 422]
 ────────────────────────────────── ONE TRANSACTION ──────────────────────────────────
 7. Daily Limit Check (Atomic check and increment on DailySpend counter)          [400]
 8. Sender Wallet Hold (Atomic conditional debit: balance >= amount)              [400]
 9. Ledger & Transaction (Credit receiver, write Transaction & 2 Ledger entries)  [Success 200/201]
```

### Why PIN Check Must Precede Idempotency Reservation
If the idempotency record were claimed before verifying the PIN:
1. Raju initiates a transfer of ₹1,000 with `Idempotency-Key: "tx-abc-123"` and enters an incorrect PIN.
2. If the idempotency slot were already marked `DONE` with a 403 error, Raju would be permanently blocked from retrying with the same key. When he immediately re-enters the correct PIN using the same client payment intent, the server would either replay the cached 403 error or reject the key with 422.
3. If the record remained `IN_PROGRESS`, concurrent requests or crashes would leave orphaned locks.
4. By checking the PIN at **Gate 5**, wrong guesses fail fast before any idempotency claim is written. The client can safely retry with the correct PIN using the exact same `Idempotency-Key`.
