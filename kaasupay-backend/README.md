# KaasuPay — Full-Stack Financial Backend

A high-integrity digital-wallet backend with atomic ledger accounting, idempotency protection, payment gateway integration, and outbox-pattern bank payouts.

## Project Overview

KaasuPay is a digital-wallet backend API. A user can register, immediately
receive a wallet, sign in to receive a JWT, add money via Razorpay, transfer money
peer-to-peer, and withdraw funds to saved bank accounts. All financial writes are atomic
MongoDB transactions — no partial state can persist through a crash or concurrent request.

## Day-2 Scope

- **MongoDB persistence** — Mongoose models; users and wallets live in MongoDB.
- **Environment variables** — `JWT_SECRET` and `MONGO_URL` read from `.env`.
- **Signup / Signin** — Zod validation, bcrypt hashing, JWT issuance.
- **`requireAuth` middleware** — verifies `Authorization: Bearer <JWT>`.
- **Protected routes** — `GET /api/v1/user/me`, `GET /api/v1/wallet/balance`.
- **Bonus endpoints** — `PUT /api/v1/user`, `GET /api/v1/user/bulk?filter=`.

## Day-3 Scope

- **`ADMIN_KEY`** — required env variable protecting staff endpoints.
- **Staff deposit** (`POST /api/v1/admin/deposit`) — atomically credits a wallet and records deposit + ledger entry.
- **Atomic transfer** (`POST /api/v1/wallet/transfer`) — debit sender and credit receiver in one MongoDB transaction with conditional debit.
- **Transaction & ledger** — double-entry ledger entries written atomically with transaction records.
- **Idempotency** (`Idempotency-Key` header) — prevents duplicate transfers across retries and restarts.
- **Transaction history** (`GET /api/v1/wallet/transactions`) — paginated, newest-first, authenticated.
- **Reconciliation** (`GET /api/v1/admin/reconcile`) — checks financial conservation across all wallets.

## Day-4 Scope

- **Razorpay Add Money Order** (`POST /api/v1/wallet/add-money/order`) — validates limits (₹1 to ₹1,00,000) and creates a gateway checkout order.
- **Checkout Signature Verification** (`POST /api/v1/wallet/add-money/verify`) — timing-safe HMAC-SHA256 verification and atomic credit.
- **Webhook Listener** (`POST /api/v1/webhooks/razorpay`) — raw-body cryptographic signature verification with persistent deduplication.
- **Payment Lifecycle & Concurrency** — prevents double-crediting if user checkout verify and webhook fire simultaneously.

## Day-5 Scope

- **Bank Account Management** (`POST /api/v1/wallet/bank-accounts`, `GET /api/v1/wallet/bank-accounts`) — saves validated IFSC and 9–18 digit account numbers with AES-256-GCM encryption at rest; returns only masked account strings (`XXXXXX1234`).
- **Idempotent Withdrawal Request** (`POST /api/v1/wallet/withdraw`) — atomic wallet hold, `WITHDRAWAL` transaction + `DEBIT` ledger, and `OutboxEvent` creation in a single MongoDB transaction. Responds immediately with `202 Accepted`.
- **Durable Outbox Worker** (`worker.js`) — independent background process that atomically claims due jobs, calls bank payout API, handles retries with exponential backoff & jitter, and recovers stale locks after 60s.
- **Compensating Reversal** — on definitive bank refusal, atomically marks withdrawal `REVERSED` and executes a compensating `REVERSAL` transaction + `CREDIT` ledger entry exactly once.
- **Timeout Safety & Manual Review** — timeouts treat status as ambiguous (never a blind refund); after 5 failed attempts, transitions to `NEEDS_REVIEW` and marks outbox job `STUCK` for staff investigation.
- **Reconciliation Extension** — `Money In = DEPOSIT + TOPUP`, `Money Out = WITHDRAWAL - REVERSAL`, `Total Balance = Money In - Net Money Out`.
- **Fake Bank Simulator** (`tools/fake-bank.js`) — supports `normal`, `flaky`, `slow`, and `down` simulation modes with idempotency tracking.

## Technology Stack

- Node.js (ES Modules)
- Express
- MongoDB + Mongoose
- dotenv (environment variables)
- Zod (request validation)
- bcryptjs (password hashing)
- jsonwebtoken (JWT)
- crypto (AES-256-GCM encryption & timing-safe comparisons)
- Nodemon (dev server)
- `mongodb-memory-server` (dev/test only)

## Installation

```bash
npm install
```

## Environment Setup

Copy the example file and fill it in:

```bash
cp .env.example .env
```

`.env`:

```env
MONGO_URL=your_mongodb_atlas_connection_string
JWT_SECRET=some_long_random_secret
PORT=3000
ADMIN_KEY=your_private_staff_key
CLIENT_URL=http://localhost:5173
RAZORPAY_KEY_ID=rzp_test_yourKeyId
RAZORPAY_KEY_SECRET=yourRazorpaySecret
RAZORPAY_WEBHOOK_SECRET=yourWebhookSecret
BANK_URL=http://localhost:4000
BANK_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGO_URL` | yes | MongoDB connection string (Atlas or local replica set) |
| `JWT_SECRET` | yes | Secret used to sign/verify JWTs |
| `PORT` | no | Defaults to `3000` |
| `ADMIN_KEY` | yes | Staff-only key for `x-admin-key` header on admin endpoints |
| `CLIENT_URL` | no | Frontend origin for CORS (defaults to `http://localhost:5173`) |
| `RAZORPAY_KEY_ID` | for Day 4 | Razorpay Key ID for Test Mode checkout orders |
| `RAZORPAY_KEY_SECRET` | for Day 4 | Razorpay Key Secret for HMAC-SHA256 signature verification |
| `RAZORPAY_WEBHOOK_SECRET` | for Day 4 | Secret for verifying incoming webhook raw-body signatures |
| `BANK_URL` | for Day 5 | Bank payout gateway URL (e.g. `http://localhost:4000` for fake bank) |
| `BANK_ENCRYPTION_KEY` | for Day 5 | 64-character hex key (256-bit) for AES-256-GCM bank account encryption |

> `.env` is gitignored and must never be committed. The server exits with a
> clear error if required variables are missing — there is no hard-coded
> fallback.

> **Payment Configuration Note**: In production (`NODE_ENV=production`), missing
> Razorpay credentials produce a fail-fast startup exit. In local dev/test mode,
> Day 2 & Day 3 wallet transfers and deposits remain fully testable without payment
> credentials, while Day 4 top-up routes cleanly enforce that credentials are configured.

> **Note on `ADMIN_KEY`**: this is a simplified educational mechanism. It is
> NOT a complete production-grade staff authorization system (no RBAC, no key
> rotation, no audit log). Real production systems use proper IAM.

For MongoDB Atlas: create a free cluster, add a database user, allow your IP
in Network Access, and copy the connection string. The app uses the database
name `kaasupay`.

## Development

```bash
npm run dev
```

## Production-style start

```bash
npm start
```

Startup order: load `.env` → validate config → connect MongoDB → listen.

## Amount Convention — Paise

All money amounts in the API and database are **integer paise**:

| Rupee amount | API/database value |
| --- | ---: |
| ₹1.00 | `100` |
| ₹10.00 | `1,000` |
| ₹400.00 | `40,000` |
| ₹1,000.00 | `100,000` |
| ₹10,000.00 | `1,000,000` |

Never send floating-point amounts. Non-integer values are rejected with `400`.

## API Documentation

All examples use `http://localhost:3000`.

---

### `GET /` — Health check

```json
{ "status": "KaasuPay backend is running" }
```

---

### `POST /api/v1/user/signup`

Registers a user and creates their wallet.

**Request**

```json
{
  "username": "raju@gmail.com",
  "firstName": "Raju",
  "lastName": "Kumar",
  "password": "secret123"
}
```

**Success — `201 Created`**

```json
{
  "message": "User created successfully",
  "user": { "_id": "...", "username": "raju@gmail.com", "firstName": "Raju", "lastName": "Kumar" },
  "wallet": { "_id": "...", "balance": 0 }
}
```

**Errors**: `400` invalid input · `409` duplicate email

---

### `POST /api/v1/user/signin`

**Request** `{ "username": "raju@gmail.com", "password": "secret123" }`

**Success — `200 OK`** `{ "message": "Signed in", "token": "eyJ..." }`

**Errors**: `400` invalid input · `401` wrong email or password

---

### Protected routes

Send the JWT as:

```text
Authorization: Bearer <token>
```

Any missing/malformed/invalid/expired token returns `401 { "error": "Unauthorized" }`.

#### `GET /api/v1/user/me`

Returns the authenticated user's profile (no password hash).

#### `GET /api/v1/wallet/balance`

```json
{ "balance": 1250, "display": "₹12.50" }
```

#### `PUT /api/v1/user` — profile update

Updates `firstName`, `lastName`, and/or `password`. Rejects `username` changes.

#### `GET /api/v1/user/bulk?filter=raj`

Case-insensitive name search, up to 50 results, no password hashes.

---

### `POST /api/v1/admin/deposit` — Staff deposit

Protected by `x-admin-key` header. **Not** a user JWT.

**Request header**

```
x-admin-key: your_admin_key
```

**Request body**

```json
{
  "to": "raju@gmail.com",
  "amount": 100000,
  "note": "Initial deposit"
}
```

- `to` — valid email of an existing user (normalized to lowercase).
- `amount` — integer paise, 100–10,000,000 inclusive.
- `note` — optional string (max 200 chars); defaults to `"Bank deposit"`.

**Success — `201 Created`**

```json
{
  "message": "Deposit successful",
  "transactionId": "...",
  "to": "raju@gmail.com",
  "amount": 100000,
  "newBalance": 100000,
  "note": "Initial deposit"
}
```

**Errors**: `400` invalid input · `401` missing/wrong staff key · `404` user or wallet not found · `500` server error

---

### `POST /api/v1/wallet/transfer` — Atomic transfer

Protected by JWT (`requireAuth`). The sender identity comes **only** from the JWT.

**Request headers**

```
Authorization: Bearer <token>
Idempotency-Key: t-001
Content-Type: application/json
```

**Request body**

```json
{
  "to": "priya@gmail.com",
  "amount": 40000,
  "note": "Lunch"
}
```

- `to` — valid email of the recipient (must not be the sender).
- `amount` — integer paise, 100–1,000,000 inclusive.
- `note` — optional string (max 200 chars).
- `Idempotency-Key` — required, non-empty, max 100 characters. Reuse the same key to retry the same intended transfer. Use a new key for each new intended transfer.

**Success — `201 Created`**

```json
{
  "message": "Transfer successful",
  "transactionId": "...",
  "to": "priya@gmail.com",
  "amount": 40000,
  "senderBalance": 60000,
  "note": "Lunch"
}
```

**Idempotency behaviour**

| Situation | Response |
| --- | --- |
| New key | Process the transfer normally |
| Same key + same body (DONE) | Replay original response (no money moved again) |
| Same key + same body (IN_PROGRESS) | `409 Conflict` |
| Same key + different body | `422 Unprocessable Entity` |

**Errors**: `400` invalid/missing key, invalid amount, self-transfer, insufficient balance · `401` missing/invalid JWT · `404` recipient not found · `409` key in progress · `422` key reused with different body · `500` server error

---

### `GET /api/v1/wallet/transactions` — Transaction history

Protected by JWT. Returns the authenticated user's own ledger history — never another user's.

**Query parameters**

| Param | Default | Max | Notes |
| --- | --- | --- | --- |
| `page` | `1` | — | Integer ≥ 1 |
| `limit` | `10` | `50` | Integer 1–50 |

**Success — `200 OK`**

```json
{
  "data": [
    {
      "transactionId": "...",
      "type": "TRANSFER",
      "direction": "DEBIT",
      "amount": 40000,
      "withWhom": "Priya Sharma",
      "note": "Lunch",
      "balanceAfter": 60000,
      "createdAt": "2026-10-11T10:00:00.000Z"
    },
    {
      "transactionId": "...",
      "type": "DEPOSIT",
      "direction": "CREDIT",
      "amount": 100000,
      "withWhom": "Bank deposit",
      "note": "Initial deposit",
      "balanceAfter": 100000,
      "createdAt": "2026-10-11T09:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 10,
  "total": 2,
  "totalPages": 1
}
```

- `amount` and `balanceAfter` are always integer paise.
- `withWhom` is the other party's full name for transfers; `"Bank deposit"` for deposits.
- Sorted newest first by `createdAt`.
- Empty history returns `data: []` with correct metadata.

**Errors**: `400` invalid page/limit · `401` missing/invalid JWT

---

### `GET /api/v1/admin/reconcile` — Reconciliation (bonus)

Protected by `x-admin-key`. Reports financial health using MongoDB aggregation.

**Success — `200 OK`**

```json
{
  "walletCount": 5,
  "totalBalance": 500000,
  "totalDeposited": 500000,
  "moneyConserved": true,
  "mismatches": []
}
```

`mismatches` lists any wallets whose balance doesn't match their ledger net.

---

### `POST /api/v1/wallet/add-money/order` — Create Razorpay top-up order

Protected by JWT (`requireAuth`). Creates an order on Razorpay and persists a corresponding local `PaymentOrder` in `CREATED` status.

**Request headers**

```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request body**

```json
{
  "amount": 50000
}
```

- `amount` — integer paise, 1,000–1,000,000 inclusive (₹10 to ₹10,000).
- Strict schema: extra fields are rejected with `400`.
- User ID is derived exclusively from the authenticated JWT.

**Success — `201 Created`**

```json
{
  "orderId": "order_mock_123456",
  "amount": 50000,
  "currency": "INR",
  "keyId": "rzp_test_..."
}
```

Never exposes `RAZORPAY_KEY_SECRET` or `RAZORPAY_WEBHOOK_SECRET`.

**Errors**: `400` invalid amount/input · `401` missing/invalid JWT · `502` gateway error · `500` server/persistence error

---

### `GET /api/v1/wallet/add-money/orders/:orderId` — Inspect payment order status

Protected by JWT (`requireAuth`). Retrieves current status for the authenticated user's own order only.

**Request headers**

```
Authorization: Bearer <token>
```

**Success — `200 OK`**

```json
{
  "orderId": "order_mock_123456",
  "amount": 50000,
  "status": "CREATED",
  "paidVia": null
}
```

**Errors**: `401` missing/invalid JWT · `404` order not found (or belongs to another user) · `500` server error

---

### `POST /api/v1/wallet/add-money/verify` — Verify Checkout signature & credit wallet

Protected by JWT (`requireAuth`). Verifies the Razorpay Checkout signature using timing-safe HMAC-SHA256 comparison, confirms payment capture status with the gateway, and atomically credits the wallet via `creditTopUp`.

**Request headers**

```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request body**

```json
{
  "razorpay_order_id": "order_mock_123456",
  "razorpay_payment_id": "pay_mock_78910",
  "razorpay_signature": "5f2d..."
}
```

- Strict validation: missing, empty, or unexpected fields are rejected with `400`.
- Server uses stored `PaymentOrder.amount`, never client-supplied amounts.

**Success (first credit) — `200 OK`**

```json
{
  "message": "Money added",
  "orderId": "order_mock_123456",
  "amount": 50000,
  "balance": 50000
}
```

**Idempotent replay (already added) — `200 OK`**

```json
{
  "message": "Already added",
  "orderId": "order_mock_123456",
  "amount": 50000,
  "balance": 50000
}
```

**Errors**: `400` invalid signature, payment unpaid/failed, mismatched order/amount/currency · `401` missing/invalid JWT · `404` order missing or owned by another user · `502` gateway verification failure · `500` server error

---

### `POST /api/v1/webhooks/razorpay`

Webhook listener invoked directly by Razorpay (no JWT authentication). Verified strictly against the raw request body bytes using `RAZORPAY_WEBHOOK_SECRET` and timing-safe HMAC-SHA256 comparison. Handles duplicate event delivery via the `WebhookEvent` model.

**Headers**:
- `X-Razorpay-Signature`: HMAC-SHA256 signature generated over the raw payload bytes.
- `X-Razorpay-Event-Id` (optional): Unique event ID for persistent deduplication.

**Payload**: Standard Razorpay event JSON (e.g., `payment.captured`).

**Success (`payment.captured`, first processing) — `200 OK`**:
```json
{
  "status": "credited"
}
```

**Success (already credited by checkout verify or prior webhook) — `200 OK`**:
```json
{
  "status": "already credited"
}
```

**Ignored non-capture event or unknown order — `200 OK`**:
```json
{
  "status": "ignored",
  "event": "payment.failed"
}
```

**Errors**: `400` missing/invalid signature or malformed JSON · `500` server error

---

### `POST /api/v1/wallet/bank-accounts` — Save a Bank Account

Protected by JWT (`requireAuth`). Validates account number (9 to 18 digits) and Indian IFSC code (`/^[A-Z]{4}0[A-Z0-9]{6}$/`). Enforces per-user duplicate protection. Encrypts the raw account number using AES-256-GCM at rest, storing `last4` for display. **Never returns raw account number.**

**Request**

```json
{
  "holderName": "Raju Kumar",
  "accountNumber": "123456781234",
  "ifsc": "sbin0001234"
}
```

**Success — `201 Created`**

```json
{
  "id": "673f...",
  "holderName": "Raju Kumar",
  "account": "XXXXXX1234",
  "ifsc": "SBIN0001234"
}
```

**Errors**: `400` invalid account or IFSC · `401` missing/invalid JWT · `409` account already added

---

### `GET /api/v1/wallet/bank-accounts` — List User's Saved Bank Accounts

Protected by JWT (`requireAuth`). Returns all bank accounts belonging to the authenticated user. All account numbers are masked.

**Success — `200 OK`**

```json
{
  "accounts": [
    {
      "id": "673f...",
      "holderName": "Raju Kumar",
      "account": "XXXXXX1234",
      "ifsc": "SBIN0001234"
    }
  ]
}
```

---

### `POST /api/v1/wallet/withdraw` — Request Bank Withdrawal

Protected by JWT (`requireAuth`). Requires `Idempotency-Key` header. Validates amount (10,000 paise / ₹100 to 25,00,000 paise / ₹25,000), checks available balance, verifies bank account ownership.

In a **single atomic MongoDB transaction**:
1. Atomically holds wallet funds via conditional debit (`$inc: { balance: -amount }` where `balance >= amount`).
2. Creates `Withdrawal` document with status `PENDING` and stable `reference` (`wd_<id>`).
3. Creates `Transaction` document (`type: WITHDRAWAL`) with double-entry `DEBIT` ledger entry.
4. Creates `OutboxEvent` (`status: NEW`, `attempts: 0`).
5. Persists the idempotency record.

Responds immediately with `202 Accepted`. **Does NOT call the bank synchronously.**

**Request Headers**

```text
Authorization: Bearer <token>
Idempotency-Key: w-unique-ref-001
Content-Type: application/json
```

**Request Body**

```json
{
  "bankAccountId": "673f...",
  "amount": 30000
}
```

**Success — `202 Accepted`**

```json
{
  "message": "Withdrawal requested",
  "withdrawal": {
    "id": "673f...",
    "amount": 30000,
    "status": "PENDING",
    "account": "XXXXXX1234"
  },
  "balance": 70000
}
```

**Idempotent Replay — `202 Accepted`**: Re-sending identical request returns the original withdrawal record without debiting again.

**Errors**: `400` missing `Idempotency-Key` header, amount outside limits, or insufficient balance · `401` missing/invalid JWT · `404` bank account not found or owned by another user · `409` request currently processing · `422` idempotency key reused with different payload

---

### `GET /api/v1/wallet/withdrawals` — List User's Withdrawals

Protected by JWT (`requireAuth`). Returns the authenticated user's last 20 withdrawals, sorted newest first.

**Success — `200 OK`**

```json
[
  {
    "id": "673f...",
    "amount": 30000,
    "status": "SUCCESS",
    "bankRef": "UTR1730000000000",
    "failureReason": null,
    "createdAt": "2026-10-24T18:00:00.000Z",
    "updatedAt": "2026-10-24T18:00:01.000Z"
  }
]
```

---

### `GET /api/v1/wallet/withdrawals/:id` — Get Single Withdrawal Details

Protected by JWT (`requireAuth`). Returns a single withdrawal record owned by the user. Returns `404` if the ID does not exist or belongs to another user.

---

### `GET /api/v1/admin/withdrawals?status=NEEDS_REVIEW` — Staff Manual Review Queue

Protected by `x-admin-key: <ADMIN_KEY>`. Lists ambiguous withdrawals that exhausted maximum retries without definitive bank resolution.

**Success — `200 OK`**

```json
[
  {
    "id": "673f...",
    "userId": "673f...",
    "amount": 10000,
    "status": "NEEDS_REVIEW",
    "reference": "wd_673f...",
    "failureReason": "Bank is down. Try later."
  }
]
```

---

## Outbox Worker & Bank Simulation Architecture

### Transactional Outbox Pattern
```text
User Request ──► [ POST /wallet/withdraw ]
                     │ (Single MongoDB Transaction)
                     ├── 1. Atomic Wallet Hold (balance -= amount)
                     ├── 2. Withdrawal Document (status: PENDING, ref: wd_<id>)
                     ├── 3. Transaction WITHDRAWAL + DEBIT Ledger Entry
                     └── 4. OutboxEvent Document (status: NEW)
                     │
              202 Accepted returned immediately

Background Loop:
[ worker.js ] ──► Atomically claims NEW or stale PROCESSING job
                     │
                     ├── Decrypts Bank Account Number (AES-256-GCM)
                     ├── Transitions Withdrawal to PROCESSING
                     └── POST http://localhost:4000/payouts (Timeout: 3000ms)
                             │
                             ├─► 200 SUCCESS ──► Withdrawal SUCCESS (UTR), Outbox DONE
                             ├─► 200 FAILED  ──► reverseWithdrawal() [Reversal + CREDIT], Outbox DONE
                             └─► 5xx / Timeout / 202 PROCESSING:
                                     ├─ attempts < 5 ──► status NEW, nextAttemptAt with backoff + jitter
                                     └─ attempts = 5 ──► Withdrawal NEEDS_REVIEW, Outbox STUCK (no blind refund)
```

### Running the Worker
Run in a separate terminal:
```bash
node worker.js
```
The worker:
- Atomically claims due jobs using `{ status: "NEW", nextAttemptAt: { $lte: now } }` or reclaims stale jobs `{ status: "PROCESSING", lockedAt: { $lte: 60s ago } }`.
- Guarantees exactly-once payout by reusing the immutable withdrawal reference (`wd_<withdrawalId>`).
- Retries with exponential backoff (`1000 * 2^attempts + jitter`) up to 5 attempts before marking `NEEDS_REVIEW`.

### Fake Bank Simulator (`tools/fake-bank.js`)
Run in a separate terminal:
```bash
node tools/fake-bank.js
```
Listens on port `4000`. Supports dynamic mode switching:
- `normal`: Responds in ~300ms with success (or refusal if account ends in `0000`).
- `flaky`: 50% chance of returning HTTP 503 error.
- `slow`: Takes 10s to respond; repeat calls return HTTP 202 `PROCESSING`.
- `down`: Returns HTTP 503 for all requests.
- Account numbers ending in `0000` trigger permanent refusal (`Account closed`).

Change mode via:
```bash
curl -X POST http://localhost:4000/mode -H "Content-Type: application/json" -d '{"mode":"flaky"}'
```
Inspect call counts and deduplication stats via:
```bash
curl http://localhost:4000/stats
```

### `POST /api/v1/user/pin` — Set or Update Payment PIN

Protected by JWT (`requireAuth`). Allows a user to set or update their secret 4 or 6-digit payment PIN. Requires confirming their current account password. Rejects repetitive and trivial PINs. Rate-limited to 5 requests per hour.

**Request**
```json
{
  "password": "Password@123",
  "pin": "5829"
}
```

**Success — `200 OK`**
```json
{
  "message": "Payment PIN set successfully",
  "hasPin": true
}
```

**Errors**: `400` invalid input, non-digits, trivial/repeated PIN · `401` incorrect password · `429` rate limit exceeded

---

### `POST /api/v1/user/logout-all` — Logout Across All Devices

Protected by JWT (`requireAuth`). Atomically increments the user's `tokenVersion`, instantly invalidating all outstanding JWT sessions on every device.

**Success — `200 OK`**
```json
{
  "message": "Signed out of all devices"
}
```

---

### `GET /api/v1/wallet/limits` — Query Daily Outgoing Limit Status

Protected by JWT (`requireAuth`). Queries the user's shared daily spending against the ₹10,000 (1,000,000 paise) daily cap for the current Asia/Kolkata calendar day (`UTC + 5:30`).

**Success — `200 OK`**
```json
{
  "dailyLimit": 1000000,
  "usedToday": 400000,
  "leftToday": 600000,
  "resetsAt": "2026-10-25T18:30:00.000Z"
}
```

---

### `POST /api/v1/admin/users/:id/unlock-pin` — Staff PIN Unlock

Protected by `x-admin-key`. Unlocks a locked PIN and resets the user's failed attempts counter without clearing the PIN itself.

**Success — `200 OK`**
```json
{
  "message": "User PIN unlocked successfully",
  "userId": "673f...",
  "pinFailedCount": 0,
  "pinLockedUntil": null
}
```


---

## Error Responses

| Status | Use |
| --- | --- |
| `400` | Invalid request, bad amount, self-transfer, insufficient balance, missing/invalid idempotency key, invalid payment signature |
| `401` | Missing/invalid JWT or missing/invalid staff key |
| `404` | User, wallet, or resource not found |
| `409` | Same idempotency key still being processed |
| `422` | Same idempotency key reused with a different request body |
| `423` | Security lockout: PIN locked for 15 minutes after 3 consecutive wrong attempts (includes `Retry-After`) |
| `429` | Too Many Requests: Rate limit exceeded (includes `Retry-After`, `X-RateLimit-*`) |
| `500` | Unexpected server error (details logged server-side only) |
| `502` | Upstream payment gateway error |

MongoDB internals, JWT secrets, stack traces, and password hashes are never sent to clients.

---

## Running the Tests

### Day 2

```bash
node test/day2.test.js
```

Self-contained: starts a throwaway `MongoMemoryServer`, spawns the server, runs 63 assertions, then cleans up.

### Day 3

```bash
node test/day3.test.js
```

Self-contained: starts a `MongoMemoryReplSet` (required for MongoDB transactions), spawns the server, runs 75 assertions covering all five levels plus concurrency and duplicate-request tests, then cleans up.

### Day 4

```bash
node test/day4.test.js
```

Self-contained: starts a `MongoMemoryReplSet`, uses deterministic Razorpay gateway mocking, tests order creation limits, secret protection, PaymentOrder database persistence, cross-user authorization isolation, timing-safe checkout signature verification, idempotent replay, concurrent top-up race conditions, atomic ledger/transaction invariants, raw-body webhook signature verification, duplicate webhook delivery deduplication, callback-first & webhook-first interleaving, retry on failure, transaction history mapping (`withWhom: "Added via Razorpay"`), and admin reconciliation financial conservation (128 assertions).

### Day 5

```bash
node test/day5.test.js
```

Self-contained: starts a `MongoMemoryReplSet`, spawns the fake bank server on port 4000, starts the API server and worker process, runs all 75 Day 5 test assertions:
- **D1**: Bank account validation, duplicate prevention, and masking.
- **D2**: Withdrawal parameter validation, balance checks, and ownership enforcement.
- **D3**: Happy path payout with UTR generation and account-closed refusal with single compensating reversal.
- **D4**: Bank-down 503 recovery and backoff retry.
- **D5**: Slow bank timeout handling and payout deduplication via stable reference.
- **D6**: Outbox crash recovery after worker restart.
- **D7**: Max retries exhaustion leading to `NEEDS_REVIEW` and `STUCK` outbox without unsafe refunds.
- **D8**: Transaction history mapping, privacy isolation, and multi-wallet balance reconciliation.
- **Bonus 6 & 7**: Dual-worker concurrency deduplication and AES-256-GCM encrypted account number storage.

### Day 6

```bash
node test/day6.test.js
```

Self-contained: starts a `MongoMemoryReplSet`, spawns the fake bank server, runs all 47 Day 6 security test assertions:
- **D1**: Payment PIN validation, rejection of repeated/common sequences, password confirmation, and profile masking.
- **D2**: 3 wrong attempts triggers 15-minute lockout (`423 Locked` with `Retry-After: 900`), correct PIN during lock blocked, staff unlock endpoint (`POST /api/v1/admin/users/:id/unlock-pin`), retry with preserved idempotency key.
- **D3**: Successful verification resets failed attempts counter to 0.
- **D4**: Shared ₹10,000 (1,000,000 paise) daily limit across P2P transfers and bank withdrawals in Asia/Kolkata day (`UTC + 5:30`, reset at 18:30 UTC), rejected operations do not consume limit.
- **D5**: Signin rate limiting: 5 requests / min per email, 20 requests / min per IP, returning `X-RateLimit-Remaining` headers and `429 Too Many Requests`.
- **D6**: Shared money rate limiting (10 requests / min per authenticated user).
- **D7**: Multi-device session revocation via `POST /api/v1/user/logout-all` (invalidates all outstanding tokens with `401 Session ended`).
- **D8**: Password change session rotation (old tokens revoked, fresh token issued for current session).
- **D9**: Reconcile confirms exact money conservation after mixed operations.
- **Bonus 8**: Concurrency race safety: 10 parallel wrong guesses yield exactly 2x `403` and 8x `423`; 2 parallel ₹6,000 transfers allow exactly one to succeed and block the other at daily limit.

### Running the complete regression suite

```bash
node test/day2.test.js && node test/day3.test.js && node test/day4.test.js && node test/day5.test.js && node test/day6.test.js
```

All five suites must end with `ALL_TESTS_PASSED` (391 total passing assertions across the codebase: Day 2=63, Day 3=78, Day 4=128, Day 5=75, Day 6=47).

---

## Current Limitations

- `ADMIN_KEY` is a simplified educational mechanism — not a production RBAC system.
- No refresh tokens, OTP, forgot-password, or HTTPS termination (demo/educational scope).
- One Mongoose connection; no connection pooling tuning beyond driver defaults.
- Symmetric JWT secret: rotating `JWT_SECRET` invalidates all outstanding tokens.
- Daily outgoing limit (₹10,000/day) and API rate limiting are now fully implemented and verified.
- Stale `IN_PROGRESS` idempotency records from server crashes are cleaned up by a TTL index (30 days), not actively by a monitoring job.
