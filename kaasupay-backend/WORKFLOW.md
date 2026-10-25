# WORKFLOW — KaasuPay Day 3

Living technical memory for AI-assisted development.
**Read this file before making any change. Update it after every meaningful
implementation change.**

## 1. Project Purpose

KaasuPay is a simplified digital-wallet backend. Day 3 builds on the Day 2
MongoDB + JWT foundation to add:
- Safe atomic money deposits and transfers.
- A persistent ledger of every balance change.
- Idempotency so retried requests never double-charge.
- Paginated transaction history.

## 2. Current Status

- **Day 2 (63 assertions): ALL PASS.**
- **Day 3 (78 assertions: 74 core + 4 regression): ALL PASS.**
- **Day 4 Checkpoint 4 (Razorpay Webhooks & Financial Reconciliation): COMPLETE AND VERIFIED (128 assertions).**
- **Day 5 (Bank Accounts, Withdrawals, Outbox Worker & Reversals): COMPLETE AND VERIFIED (75 assertions).**
- All 4 backend test suites passing: `node test/day2.test.js` (63), `node test/day3.test.js` (78), `node test/day4.test.js` (128), `node test/day5.test.js` (75) — **344 total passing assertions (0 skipped, 0 failed)**.
- **Frontend Day 5 (Bank Account Management, Multi-Step Withdrawal Flow & 3D Visual): COMPLETE AND VERIFIED.**
  - Verified bank accounts management with masked display (`XXXXXX1234`), add account validation, duplicate handling (409), and AES-256-GCM encryption notice.
  - Multi-step withdrawal wizard with live balance checks, presets, explicit confirmation dialog, 202 Accepted handling, and auto-polling until terminal state (`SUCCESS`, `REVERSED`, `NEEDS_REVIEW`).
  - Integrated into Transaction History (`WITHDRAWAL` debits and `REVERSAL` credits) and Dashboard quick actions.
  - ESLint (`npm run lint`) and production build (`npm run build`) pass cleanly with 0 errors.

## 3. Architecture

```text
Client / Postman
       ↓
     Routes            (say WHICH controller handles a request)
       ↓
  requireAuth /        (protected routes: JWT → req.userId)
  adminKey check       (admin routes: x-admin-key header in controller)
       ↓
    Controllers        (validate → coordinate → respond)
       ↓
  services/money.js    (shared atomic deposit + transfer logic)
       ↓
  Mongoose Models      (User, Wallet, Transaction, LedgerEntry, IdempotencyRecord)
       ↓
     MongoDB           (database: kaasupay — replica set for transactions)
```

Routes stay thin. Controllers validate, resolve identities, and handle HTTP.
The money service owns the financial transaction logic that both deposit and
transfer share.

## 4. Folder Structure

```text
kaasupay-backend/
│
├── index.js                   entry point: dotenv → config → connectDB → listen
├── config.js                  env validation (JWT_SECRET, MONGO_URL, PORT, ADMIN_KEY)
├── db.js                      mongoose.connect(MONGO_URL, { dbName: "kaasupay" })
│
├── routes/
│   ├── index.js               mounts /user, /wallet, /admin, /webhooks
│   ├── userRoutes.js          signup, signin, me, PUT /, bulk
│   ├── walletRoutes.js        balance, transfer, transactions, add-money
│   ├── adminRoutes.js         deposit, reconcile
│   └── webhookRoutes.js       razorpay webhook (raw body signature verified)
│
├── controllers/
│   ├── userController.js      signup, signin, getMe, updateProfile, bulkSearch
│   ├── walletController.js    getBalance, transferFunds, getTransactions
│   ├── adminController.js     adminDeposit, adminReconcile
│   ├── paymentController.js   createAddMoneyOrder, getAddMoneyOrderStatus, verifyAddMoneyPayment
│   └── webhookController.js   handleRazorpayWebhook (deduplicated, atomic top-up)
│
├── middleware/
│   └── authMiddleware.js      requireAuth (Bearer JWT → req.userId)
│
├── models/
│   ├── userModel.js           User schema (users collection)
│   ├── walletModel.js         Wallet schema (wallets collection)
│   ├── transactionModel.js    Transaction schema (DEPOSIT, TRANSFER, TOPUP)
│   ├── ledgerEntryModel.js    LedgerEntry schema (ledgerentries collection)
│   ├── idempotencyRecordModel.js  IdempotencyRecord (idempotencyrecords collection)
│   ├── paymentOrderModel.js   PaymentOrder schema (paymentorders collection)
│   └── webhookEventModel.js   WebhookEvent schema (webhookevents collection, deduplication)
│
├── services/
│   ├── money.js               deposit(), transfer(), creditTopUp(), MoneyError, hashRequest()
│   └── razorpayService.js     getRazorpayClient(), createGatewayOrder(), verifyCheckoutSignature(), verifyWebhookSignature(), fetchPayment()
│
├── validations/
│   └── paymentValidation.js   createOrderSchema, verifyPaymentSchema (Zod validation)
│
├── test/
│   ├── day2.test.js           Day 2 acceptance suite (63 assertions)
│   ├── day3.test.js           Day 3 acceptance suite (75 assertions)
│   └── day4.test.js           Day 4 acceptance suite (128 assertions, Checkpoint 4)
│
├── .env                       real secrets (gitignored)
├── .env.example               template: MONGO_URL, JWT_SECRET, PORT, ADMIN_KEY
├── .gitignore                 node_modules/, .env, *.log
├── package.json               "type": "module"
├── README.md
├── WORKFLOW.md
└── DAY3_ANSWERS.md
```

## 5. Implemented Features

### Day 2 (preserved)
- Fail-fast config: missing vars → clear error + exit.
- MongoDB-first startup; connection failure → exit.
- Signup/signin with Zod, bcrypt, JWT (1h, `{ userId }` payload).
- `requireAuth` middleware (any bad token → 401).
- `GET /me`, `GET /wallet/balance`, `PUT /user`, `GET /user/bulk`.

### Day 3 (new)
- `ADMIN_KEY` required env variable (fail-fast, same pattern as others).
- **Transaction model** — DEPOSIT or TRANSFER, fromUserId/toUserId, integer paise amount.
- **LedgerEntry model** — per-user DEBIT/CREDIT line with balanceAfter; indexed `{ userId, createdAt -1 }`.
- **IdempotencyRecord model** — unique `{ userId, key }` index; IN_PROGRESS → DONE state machine.
- **`services/money.js`** — shared `deposit()` and `transfer()` using `session.withTransaction()`.
- **`POST /api/v1/admin/deposit`** — staff-key protected; atomic wallet + Transaction + LedgerEntry.
- **`POST /api/v1/wallet/transfer`** — JWT protected; conditional atomic debit, idempotent.
- **`GET /api/v1/wallet/transactions`** — paginated history; filters by `{ userId: req.userId }`.
- **`GET /api/v1/admin/reconcile`** — bonus; MongoDB aggregation, money-conservation check.

## 6. API Endpoints

| Method | Path | Auth | Success |
| --- | --- | --- | --- |
| `GET` | `/` | — | `200` |
| `POST` | `/api/v1/user/signup` | — | `201` |
| `POST` | `/api/v1/user/signin` | — | `200` |
| `GET` | `/api/v1/user/me` | Bearer JWT | `200` |
| `PUT` | `/api/v1/user` | Bearer JWT | `200` |
| `GET` | `/api/v1/user/bulk?filter=` | Bearer JWT | `200` |
| `GET` | `/api/v1/wallet/balance` | Bearer JWT | `200` |
| `POST` | `/api/v1/wallet/transfer` | Bearer JWT + Idempotency-Key | `201` |
| `GET` | `/api/v1/wallet/transactions` | Bearer JWT | `200` |
| `POST` | `/api/v1/admin/deposit` | x-admin-key | `201` |
| `GET` | `/api/v1/admin/reconcile` | x-admin-key | `200` |

## 7. Data Models

Database **`kaasupay`** (all collections created by Mongoose).

### User (`users`)
Unchanged from Day 2: username (email, unique), firstName, lastName, passwordHash. Timestamps.

### Wallet (`wallets`)
Unchanged from Day 2: userId (unique ref → User), balance (integer paise, ≥ 0). Timestamps.

### Transaction (`transactions`)

```js
{
  _id: ObjectId,
  type: "DEPOSIT" | "TRANSFER",
  fromUserId: ObjectId | null,   // null for deposits
  toUserId: ObjectId,            // always present
  amount: Number,                // positive integer paise
  note: String | null,           // max 200 chars
  status: "COMPLETED",           // only valid terminal state in Day 3
  createdAt, updatedAt
}
```

Indexes: `{ toUserId: 1, createdAt: -1 }`, `{ fromUserId: 1, createdAt: -1 }`.

### LedgerEntry (`ledgerentries`)

```js
{
  _id: ObjectId,
  userId: ObjectId,            // wallet owner
  transactionId: ObjectId,     // parent transaction
  direction: "DEBIT" | "CREDIT",
  amount: Number,              // positive integer paise
  balanceAfter: Number,        // non-negative integer paise
  createdAt, updatedAt
}
```

Primary index: `{ userId: 1, createdAt: -1 }` (history queries).
Secondary index: `{ transactionId: 1 }` (reconciliation queries).

### IdempotencyRecord (`idempotencyrecords`)

```js
{
  _id: ObjectId,
  userId: ObjectId,          // authenticated sender
  key: String,               // Idempotency-Key header value, max 100 chars
  requestHash: String,       // SHA-256 of canonical { to, amount, note }
  state: "IN_PROGRESS" | "DONE",
  responseStatus: Number | null,
  responseBody: Mixed | null,
  createdAt, updatedAt
}
```

Unique index: `{ userId: 1, key: 1 }`.
TTL index: `{ createdAt: 1 }` with `expireAfterSeconds: 2592000` (30 days).

## 8. Deposit Flow

```text
POST /api/v1/admin/deposit
  ↓
Check x-admin-key header === ADMIN_KEY           → fail: 401 "Staff only"
  ↓
Zod validate { to, amount, note }                → fail: 400 "Invalid input"
  ↓
User.findOne({ username: normalizedEmail })       → fail: 404 "User not found"
  ↓
services/money.deposit({ toUserId, amount, note })
  └─ session.withTransaction()
       ├─ Wallet.findOneAndUpdate($inc balance)   → fail: 404 "Wallet not found"
       ├─ Transaction.create([...], { session })
       └─ LedgerEntry.create([...], { session })  (CREDIT entry)
  ↓
201 { message, transactionId, to, amount, newBalance, note }
```

## 9. Transfer Flow

```text
POST /api/v1/wallet/transfer
  ↓
requireAuth middleware (JWT → req.userId)         → fail: 401
  ↓
Validate Idempotency-Key header                   → fail: 400
  ↓
Zod validate { to, amount, note }                 → fail: 400
  ↓
Compute requestHash = SHA-256({ to, amount, note })
  ↓
IdempotencyRecord.create({ userId, key, requestHash, IN_PROGRESS })
  ├─ Success → own the key, proceed
  └─ E11000 → key exists:
       ├─ IN_PROGRESS → 409
       ├─ DONE + same hash → replay stored response
       └─ DONE + different hash → 422
  ↓
User.findOne({ username: to })                    → fail: 404, finalise DONE
  ↓
Self-transfer check                               → fail: 400, finalise DONE
  ↓
services/money.transfer({ fromUserId, toUserId, amount, note })
  └─ session.withTransaction()
       ├─ Wallet.findOneAndUpdate($gte + $inc sender)  → fail: 400 insufficient
       ├─ Wallet.findOneAndUpdate($inc receiver)
       ├─ Transaction.create([...], { session })
       ├─ LedgerEntry.create(DEBIT, { session })
       └─ LedgerEntry.create(CREDIT, { session })
  ↓
Finalise idempotency record: state → DONE, store responseStatus + responseBody
  ↓
201 { message, transactionId, to, amount, senderBalance, note }
```

## 10. Atomic Conditional Debit

The sender's balance check and debit are one single atomic database operation:

```js
Wallet.findOneAndUpdate(
  { userId: senderId, balance: { $gte: amount } },
  { $inc: { balance: -amount } },
  { session, new: true }
)
```

If `balance < amount`, no document matches and the operation returns `null`.
This is checked and results in a `MoneyError(400, "Insufficient balance")`.
There is **no separate read/write** that could race. This prevents negative
balances even under 10 simultaneous concurrent requests (verified by the
double-spend concurrency test).

## 11. MongoDB Transaction Boundaries

### Deposit transaction
1. `Wallet.findOneAndUpdate` — credit recipient.
2. `Transaction.create` — deposit record.
3. `LedgerEntry.create` — one CREDIT entry.

All three commit or roll back together.

### Transfer transaction
1. `Wallet.findOneAndUpdate` — conditional debit sender.
2. `Wallet.findOneAndUpdate` — credit receiver.
3. `Transaction.create` — transfer record.
4. `LedgerEntry.create` — DEBIT entry for sender.
5. `LedgerEntry.create` — CREDIT entry for receiver.

All five commit or roll back together.

`session.withTransaction()` is used in both cases. The driver automatically
retries on `TransientTransactionError`. No HTTP responses are sent from inside
the callback (the callback can be retried).

## 12. Ledger Invariants

- Every completed transfer creates **exactly 2** ledger entries (1 DEBIT + 1 CREDIT).
- Every completed deposit creates **exactly 1** ledger entry (1 CREDIT).
- `balanceAfter` on each entry equals the wallet's balance immediately after the write.
- Ledger entries are **never edited or deleted**. Corrections would be new compensating transactions (not implemented in Day 3 scope).
- Invariant: `wallet.balance = total CREDITs − total DEBITs` for that userId.
- System-wide invariant: `sum(wallet.balance) = sum(DEPOSIT transaction amounts)`.

## 13. Idempotency Key Uniqueness and State Transitions

```
No record
    │ INSERT (unique index is the gate)
    ▼
IN_PROGRESS
    │  transfer completes (success or business error)
    ▼
DONE (responseStatus + responseBody stored)
```

Concurrent requests with the same key:
- One insert wins; the other gets `E11000`.
- The loser reads the existing record and returns 409 (IN_PROGRESS) or replays (DONE).

The unique `{ userId, key }` compound index is the **only** correct gate.
A preliminary `findOne()` check is not used as the gate because it has a race window.

## 14. Failure Recovery and Replay Behavior

| Scenario | Recovery |
| --- | --- |
| Expected business error (400/404) | Stored as DONE with that status/body; retries replay the error. |
| Unexpected infrastructure error (500) | IN_PROGRESS record is **deleted** so the client can retry with the same key as new. |
| Server crash mid-transfer | IN_PROGRESS record remains; TTL index removes it after 30 days. Client receives 409 until the record expires. |
| Successful transfer after restart | Stored as DONE; replays the original 201 response indefinitely (until TTL). |

## 15. Transaction History

The history endpoint filters **always** by `{ userId: req.userId }` — never
by a client-supplied ID. Populated via:

```js
LedgerEntry.find({ userId: req.userId })
  .sort({ createdAt: -1 })
  .skip((page - 1) * limit)
  .limit(limit)
  .populate({ path: "transactionId", populate: ["fromUserId", "toUserId"] })
```

`withWhom` is determined by:
- DEPOSIT → `"Bank deposit"`.
- TRANSFER where sender = me → receiver's full name.
- TRANSFER where receiver = me → sender's full name.

## 16. Business Rules

### Deposit limits
| Rule | Value |
| --- | --- |
| Minimum | 100 paise (₹1.00) |
| Maximum | 10,000,000 paise (₹100,000.00) |
| Type | Integer only |

### Transfer limits
| Rule | Value |
| --- | --- |
| Minimum | 100 paise (₹1.00) |
| Maximum | 1,000,000 paise (₹10,000.00) |
| Type | Integer only |

### Idempotency key rules
- Required on every transfer request.
- Non-empty string, max 100 characters.
- Must be unique per intended transfer.
- Reuse = replay (same body) or 422 (different body).

## 17. Test Results

### Day 2 (2026-10-11)
```
node test/day2.test.js
ALL_TESTS_PASSED (63/63)
```

### Day 3 (2026-10-11)
```
node test/day3.test.js
ALL_TESTS_PASSED (75/75)
```

Tests cover:
- Level 1: 13 deposit assertions.
- Level 2: 9 transfer assertions.
- Level 3: 8 atomicity assertions.
- Level 4: 14 idempotency assertions.
- Level 5: 11 history assertions.
- Concurrency: 6 double-spend assertions + 4 duplicate-request assertions.
- Day 2 regression: 4 assertions.

## 18. Known Limitations

- **Daily transfer limit** (₹25,000/day) — documented in PRD as bonus; not implemented. Would require an atomic daily-usage record updated within the transfer transaction, scoped to a UTC calendar day.
- **`ADMIN_KEY` mechanism** is educational — not production RBAC (no key rotation, no audit trail, no IP allowlisting).
- **IN_PROGRESS crash recovery** relies on a TTL index (30 days). A production system would also run a monitoring job to alert on stale records.
- **MongoDB transactions require a replica set.** Local development against a standalone `mongod` will fail on transaction operations. Use Atlas (always replica-set) or `MongoMemoryReplSet` (as done in the Day 3 test suite).
- Single Mongoose connection; no retry/pool tuning beyond driver defaults.
- Symmetric JWT: rotating `JWT_SECRET` invalidates all tokens.

## 19. Completed Work

### Day 1
ESM project, thin routes, controller-based signup/signin with Zod/bcrypt/JWT,
in-memory store, README + WORKFLOW, acceptance tests.

### Day 2
Phase 1–11: `dotenv`, `.env`, `config.js`, `db.js`, Mongoose models, auth
middleware, protected routes, acceptance tests, bonus endpoints.

### Day 3 (2026-10-11)
- Phase 0: Read docs, ran baseline, fixed `dbName: "Kaasupay"` → `"kaasupay"` (63/63 pass).
- Phase 1: Added `ADMIN_KEY` to config + `.env` + `.env.example`; created Transaction, LedgerEntry, IdempotencyRecord models.
- Phase 2: Created `services/money.js` with `deposit()`, `transfer()`, `MoneyError`, `hashRequest()`.
- Phase 3: Created `controllers/adminController.js` with `adminDeposit` and `adminReconcile`; added `routes/adminRoutes.js`; mounted at `/api/v1/admin`.
- Phase 4: Rewrote `controllers/walletController.js` to add `transferFunds` (idempotent, atomic) and `getTransactions` (paginated history); updated `routes/walletRoutes.js`.
- Phase 5: Created `test/day3.test.js` (75 assertions including concurrency tests).
- Phase 6: Rewrote `README.md` and `WORKFLOW.md` for Day 3; created `DAY3_ANSWERS.md`.

### Day 4 Checkpoint 1
- Fixed `db.js` database name casing (`Kaasupay` → `kaasupay`) to align with test runner and documentation; verified 63 Day 2 and 75 Day 3 passing assertions.
- Installed `razorpay` and `cors` in `kaasupay-backend`.
- Configured CORS middleware in `index.js` using `CLIENT_URL` (default `http://localhost:5173`).
- Updated `config.js` with test-safe and fail-fast environment handling for `CLIENT_URL`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`.
- Updated `.env.example` with Razorpay placeholders and `CLIENT_URL`.
- Created `models/paymentOrderModel.js` supporting `userId`, `gatewayOrderId`, `amount`, `currency`, `status` (`CREATED`, `PAID`, `EXPIRED`), `gatewayPaymentId`, `paidVia`, and `transactionId`.
- Extended `models/transactionModel.js` type enum to include `"TOPUP"`.
- Created `services/razorpayService.js` with singleton client initialization, receipt generator, order creator, and timing-safe signature verifiers for checkout and webhook payloads.
- Created `validations/paymentValidation.js` with Zod `createOrderSchema` enforcing ₹10–₹10,000 integer paise bounds.
- Re-verified Day 2 (63 assertions) and Day 3 (75 assertions) test suites.

### Day 4 Checkpoint 2
- Implemented `POST /api/v1/wallet/add-money/order` in `controllers/paymentController.js` and mounted in `routes/walletRoutes.js`.
- Implemented `GET /api/v1/wallet/add-money/orders/:orderId` for authenticated order status inspection.
- Enforced input bounds (1,000 to 1,000,000 integer paise) with strict schema rejecting unexpected fields.
- Protected secrets: public `keyId` returned, secrets never sent to clients.
- Scoped order status lookup strictly to authenticated `req.userId` (returns generic 404 for missing orders and other users' orders).
- Added `test/day4.test.js` with 44 assertions covering input matrix, gateway errors, database persistence, and authorization isolation.
- Verified all three suites pass: Day 2 (63), Day 3 (75), Day 4 (44) = 182 total assertions.

### Day 4 Checkpoint 3
- Implemented shared atomic `creditTopUp` in `services/money.js` (uses single MongoDB transaction to atomically claim order from `CREATED`/`EXPIRED` to `PAID`, credits wallet with trusted stored amount, creates `TOPUP` transaction, creates `CREDIT` ledger entry, and links transaction ID).
- Implemented `POST /api/v1/wallet/add-money/verify` in `controllers/paymentController.js` and mounted in `routes/walletRoutes.js`.
- Enforced timing-safe HMAC-SHA256 checkout signature verification (`crypto.timingSafeEqual`).
- Enforced authoritative gateway verification via `fetchPayment` checking captured status, linked order ID, amount, and currency.
- Enforced idempotent replay: duplicate verification of already credited orders returns `"Already added"` without moving money again.
- Handled concurrent verification race conditions: exactly one credit succeeds, remaining concurrent requests return `"Already added"`.
- Extended `test/day4.test.js` to 84 assertions covering valid credit, invalid signatures, mismatched details, duplicate replays, concurrent race conditions, and database ledger/transaction invariants.
- All three test suites verified: Day 2 (63), Day 3 (75), Day 4 (84) = 222 total assertions passing.

### Day 4 Checkpoint 4
- Mounted `express.raw({ type: "application/json" })` for `/api/v1/webhooks/razorpay` in `index.js` before `express.json()` to preserve raw body bytes for HMAC-SHA256 signature verification.
- Implemented `POST /api/v1/webhooks/razorpay` in `controllers/webhookController.js` and mounted at `/api/v1/webhooks` without JWT auth.
- Verified `X-Razorpay-Signature` against exact raw body bytes using `crypto.timingSafeEqual` and `RAZORPAY_WEBHOOK_SECRET`.
- Created `models/webhookEventModel.js` with unique `eventId` index to provide persistent deduplication against duplicate webhook deliveries.
- Enforced safe status transitions and retry handling: events are marked `PROCESSED` only after financial transaction commits; failed deliveries are marked `FAILED` and safely retried.
- Enforced trusted order checks: unknown orders are ignored without credit; amount/currency mismatches are safely flagged and rejected without touching balances.
- Supported both callback-first and webhook-first order completion flows safely without double crediting.
- Updated `controllers/walletController.js` (`getTransactions`) so `TOPUP` ledger entries display `withWhom: "Added via Razorpay"`.
- Updated `controllers/adminController.js` (`adminReconcile`) to include `TOPUP` transactions alongside `DEPOSIT` transactions in the conservation calculation (`{ type: { $in: ["DEPOSIT", "TOPUP"] }, status: "COMPLETED" }`).
- Extended `test/day4.test.js` to 128 assertions covering missing/invalid/mismatched raw signatures, unsupported events, unknown orders, amount/currency mismatches, duplicate event delivery, callback-first, webhook-first, concurrent callback/webhook race conditions, failure retry behavior, transaction history mapping, and admin reconciliation conservation.
- All three test suites verified: Day 2 (63), Day 3 (75), Day 4 (128) = 266 total assertions passing.

### Frontend Checkpoint 5 (Foundation and Design System)
- Established clean, modular directory architecture in `kaasupay-frontend/src`: `components/3d`, `components/common`, `components/layout`, `components/ui`, `pages`, `services`, `store`, `utils`.
- Implemented Tailwind CSS v4 design system in `src/index.css` featuring light theme with white surfaces (`#FFFFFF`, `#F8FAFC`), deep navy typography (`#0A192F`), cobalt-blue primary actions (`#1D4ED8`, `#2563EB`), and restrained lavender accents (`#818CF8`, `#EEF2FF`).
- Added responsive typography preconnect and modern fonts (`Plus Jakarta Sans`, `JetBrains Mono`) in `index.html`.
- Implemented keyboard navigation focus rings (`:focus-visible`) and `@media (prefers-reduced-motion: reduce)` support.
- Configured centralized Axios API client in `src/services/api.js`:
  - Automatically attaches `Authorization: Bearer <token>` from local storage.
  - Intercepts `401 Unauthorized` responses to clear invalid sessions safely and dispatches custom event `kaasupay:auth_unauthorized` without recursive loops.
  - Standardizes error messages for UI consumption.
- Implemented core API services: `authService.js` (signup, signin, me, updateProfile, searchUsers) and `walletService.js` (balance, transfer, transactions, add-money orders, order status, verify).
- Implemented Redux Toolkit store (`src/store/index.js` and `src/store/slices/`):
  - `authSlice.js`: token, user profile, async thunks (`loginUser`, `registerUser`, `fetchCurrentUser`, `updateUserProfile`), and listener for unauthorized session events.
  - `walletSlice.js`: integer paise balance, formatted display, transfer execution thunks.
  - `transactionSlice.js`: paginated ledger history, prepend actions for real-time reactivity.
  - `uiSlice.js`: toast notification queue and mobile drawer toggle.
  - `hooks.js`: `useAuth`, `useWallet`, `useTransactions`, `useToast`, `useAppDispatch`, `useAppSelector`.
- Implemented UI primitives in `src/components/ui/`: `Button`, `Input`, `Card`, `Badge`, `Spinner`, `Skeleton`, `Alert`, `Dialog`, `AmountDisplay`, and `ToastContainer`.
- Implemented 3D wallet visual in `src/components/3d/`:
  - `WalletScene.jsx`: Three.js / React Three Fiber / Drei floating metallic card with subtle rotation and lighting.
  - `WalletFallback.jsx`: Pure CSS/SVG fallback card for environments without WebGL.
  - `WalletCanvas.jsx`: WebGL detection, React `Suspense`, and error boundary wrapper for lazy-loading.
- Implemented layouts in `src/components/layout/`:
  - `PublicLayout.jsx`: Responsive Navbar with balance pill, `<main>` skip links, and semantic Footer.
  - `AuthLayout.jsx`: Distraction-free card layout with back navigation and security badges.
  - `DashboardLayout.jsx`: Desktop sticky sidebar with balance widget, user profile menu, and mobile slide-out drawer.
- Implemented route guards and error boundaries in `src/components/common/`: `ProtectedRoute`, `PublicRoute`, and `ErrorBoundary`.
- Composed routes in `App.jsx` and mounted Redux Provider in `main.jsx`.
- Verified production build (`npm run build`) and ESLint (`npm run lint`): 0 errors, 0 warnings.
- Conducted Checkpoint 5 Verification Pass:
  - Contract alignment: Enforced required `lastName` in `SignUpPage.jsx` matching backend Zod schema; unwrapped `{ user: { ... } }` in `authSlice.js` from `GET /api/v1/user/me`; added dynamic `loadRazorpayScript` utility in `src/utils/razorpay.js` with fallback.
  - Session behavior: Added active session verification on mount in `App.jsx` (`fetchCurrentUser`); validated 401 interceptor session teardown.
  - Bundle optimization: Configured route-level code splitting (`React.lazy` + `Suspense`) and vendor chunk isolation in `vite.config.js`. Isolated Three.js/Drei into `three-vendor` (~918 kB uncompressed, 244 kB gzip), reducing the main entry bundle from **1.47 MB** to **334 kB** (105 kB gzip). Dashboard routes never load the Three.js bundle.
  - Verified backend: all 266 backend test assertions (Day 2: 63, Day 3: 75, Day 4: 128) verified passing.

### Frontend Checkpoint 6 (Landing Page, Authentication Screens, and Live Integration)
- **Original Fintech Landing Page (`src/pages/LandingPage.jsx`)**:
  - Implemented high-contrast hero section with value proposition *"Digital Money Engineered with Ledger Precision"*, primary and secondary CTAs, and trust guarantees pill.
  - Integrated 3D wallet visual (`WalletCanvas.jsx`) with dynamic metallic lighting, canvas lazy-loading, and static SVG fallback (`WalletFallback.jsx`).
  - Implemented four architectural pillars in `#features`: Atomic Balance Mutations, Cryptographic Idempotency Keys, Real-Time Audit Ledger, and Multi-Tier Security.
  - Implemented 3-step workflow in `#how-it-works`: Create Wallet -> Load or Deposit -> Transfer & Reconcile.
  - Implemented mathematical conservation section in `#guarantees`: Zero Floating-Point Math, Conservation of Money, and Uncompromised Privacy.
  - Added conversion-focused closing CTA and semantic footer with quick navigation links.
  - Updated `Navbar.jsx` with responsive smooth-scroll anchor links and dynamic auth state.
- **Sign In Screen (`src/pages/SignInPage.jsx`)**:
  - Field-level validation for email username and password.
  - Interactive password show/hide visibility toggle with accessible icons and ARIA attributes.
  - Loading spinner state with submission lockout preventing duplicate clicks while pending.
  - Server error banners (`Alert` component) displaying backend rejection message.
  - Open redirect protection: checks and sanitizes `redirect` query parameter (`startsWith('/') && !startsWith('//')`), defaulting safely to `/dashboard`.
  - Automatic redirect away from signin if already authenticated.
- **Sign Up Screen (`src/pages/SignUpPage.jsx`)**:
  - Validates required `firstName`, `lastName`, valid email `username`, and `password` (minimum 6 characters).
  - Password visibility toggle.
  - Loading state lockout preventing duplicate signups.
  - Displays backend conflict errors (409 Conflict) directly in error alert.
  - Automatically logs user in and transitions to `/dashboard` upon successful wallet creation.
- **Backend Atlas Fix (`kaasupay-backend/db.js`)**:
  - Resolved MongoServerError 13297 where remote Atlas cluster had database `Kaasupay` (uppercase K) while Mongoose specified lowercase `kaasupay`.
  - Updated connection options to dynamically detect Atlas and preserve lowercase for local in-memory test suites.
- **Live Integration Testing**:
  - Live HTTP verification on `http://localhost:3000`:
    - `POST /api/v1/user/signup` (creates user and wallet with 0 balance).
    - Duplicate `POST /api/v1/user/signup` (returns 409 Conflict).
    - `POST /api/v1/user/signin` with invalid credentials (returns 401).
    - `POST /api/v1/user/signin` with valid credentials (returns 200 + JWT).
    - `GET /api/v1/user/me` with JWT (returns user profile, no password hashes).
    - `GET /api/v1/wallet/balance` with JWT (returns 0 paise and `₹0.00`).
- **Test Suite Verification**:
  - Frontend ESLint (`npm run lint`): 0 errors, 0 warnings.
  - Frontend Vite build (`npm run build`): 0 errors, generated production bundle in 1.25s.
  - Backend acceptance suites: all 269 assertions passing (`day2.test.js`: 63, `day3.test.js`: 78, `day4.test.js`: 128).

### Frontend Checkpoint 7 (Core Wallet Dashboard & Add-Money Flow)
- **Database Name Resolution (`db.js`)**:
  - Implemented `resolveDbName(mongoUrl, envDbName)` using standard URL path parsing (`new URL(sanitized).pathname`) rather than substring or fragile environment detection.
  - If `MONGO_URL` specifies a database in its path (e.g. `mongodb+srv://.../Kaasupay`), it connects to `Kaasupay` deliberately.
  - In-memory test runners (`mongodb-memory-server`) generate empty URL paths (`mongodb://127.0.0.1:<port>/`), safely defaulting to `kaasupay` and preserving Day 2 line 332 assertion (`db.databaseName === "kaasupay"`).
  - Explicit `process.env.DB_NAME` remains supported for infrastructure overrides.
- **Test Assertion Count Clarification**:
  - Clarified regression test count discrepancy:
    - `test/day2.test.js`: Exactly 63 active `check()` calls (a raw grep previously counted 64 by including `function check(...)` definition on line 21).
    - `test/day3.test.js`: Exactly 78 active `check()` calls (74 core levels + 4 regression checks at lines 889, 892, 895, 897).
    - `test/day4.test.js`: Exactly 128 active `check()` calls.
    - Total: 63 + 78 + 128 = 269 assertions. Zero tests were skipped, modified, or weakened.
- **Core Wallet Dashboard (`src/pages/DashboardPage.jsx`)**:
  - Displays authenticated user's real wallet balance with integer paise precision and atomic ledger guarantee badges.
  - Profile section showing real member's legal name (`firstName`, `lastName`), registered email login ID, and security pill.
  - Recent transactions list fetched from `GET /api/v1/wallet/transactions?page=1&limit=5` with directional styling (green for credit, rose for debit).
  - Meaningful empty state for fresh accounts with an action to add funds.
  - Distinct dismissible error alert banners with retry buttons for balance or transaction sync errors.
  - Manual "Sync Ledger" button triggering background refresh with animated spinner.
- **Complete Add-Money Flow (`src/pages/AddMoneyPage.jsx`)**:
  - Enforces amount boundary between ₹10.00 (1,000 paise) and ₹10,000.00 (1,000,000 paise).
  - Converts Rupee amounts into integer paise via `rupeesToPaise` without floating-point errors.
  - Initiates order via authenticated `POST /api/v1/wallet/add-money/order`.
  - Opens Razorpay Checkout using dynamically loaded script and public key ID.
  - Performs backend verification with timing-safe HMAC-SHA256 signature check via `POST /api/v1/wallet/add-money/verify`.
  - Reconciles order status via `GET /api/v1/wallet/add-money/orders/:orderId` on modal dismissal or verification network failure, strictly refusing to treat `CREATED` as a success.
  - Updates Redux wallet balance and transaction history on confirmed payment.
- **Verification**:
  - Frontend ESLint (`npm run lint`): 0 errors, 0 warnings.
  - Frontend production build (`npm run build`): 0 errors, built in 771ms.
  - Three.js bundle (`three-vendor`, 918 kB) remains strictly isolated and is not downloaded by dashboard routes.
  - Backend acceptance tests: 269/269 passing (`day2.test.js`: 63, `day3.test.js`: 78, `day4.test.js`: 128).
  - Live API integration test (`test_dashboard_live.js`): All live dashboard and add-money endpoints verified against running backend.



### Frontend Checkpoint 8 (Peer-to-Peer Transfers & Transaction Ledger History)
- **Live Recipient Search & Autocomplete (`src/pages/TransferPage.jsx`)**:
  - Debounced autocomplete lookup via `GET /api/v1/user/bulk?filter=...` returning verified users.
  - Excludes the current authenticated user from search results to prevent self-transfers.
  - Recipient confirmation card displaying full name, verified status badge, username, and "Change Recipient" button.
  - Client-side validation: self-transfer prevention, ₹1.00 (100 paise) to ₹10,000.00 (1,000,000 paise) bounds, balance sufficiency check.
  - Quick amount presets: ₹50, ₹100, ₹500, ₹1,000, ₹2,000.
  - Cryptographic client idempotency key generation (`crypto.randomUUID()`) with manual renewal trigger.
  - Dedicated transfer confirmation receipt displaying sent amount, recipient info, copyable Transaction ID, updated balance, and note.
- **Transaction Ledger History (`src/pages/TransactionsPage.jsx`)**:
  - Interactive direction filter tabs: `All`, `Credits (+)`, `Debits (-)`.
  - Dynamic page-size selector: 10, 25, 50 records per page.
  - Full audit ledger table: Direction badge, Counterparty / Source (`withWhom`), Note, Timestamp, Amount, Balance After Transaction.
  - Accessible transaction details modal (`Dialog.jsx`): Large amount display, counterparty, formatted timestamp, resulting balance, Transaction ID and Ledger Entry ID with 1-click clipboard copy buttons.
  - Loading skeleton, informative empty states, and dismissible error alerts with retry triggers.
- **Verification Results**:
  - Frontend ESLint (`npm run lint`): 0 errors, 0 warnings.
  - Frontend Vite build (`npm run build`): 0 errors, generated production bundle in 548ms.
  - Backend acceptance suites: all 269 assertions passing (`day2.test.js`: 63, `day3.test.js`: 78, `day4.test.js`: 128).

## 21. Day 5: Bank Withdrawals, Outbox Worker & Reversals

### Architectural Pattern: Transactional Outbox & Compensating Sagas
When withdrawing funds, we cannot use a single database transaction across our internal database and the bank partner's core banking API (the Dual Write problem).
1. **Hold Funds First**: User requests withdrawal -> money is debited immediately from wallet, generating a `DEBIT` ledger entry, `Withdrawal` record (`PENDING`), and `OutboxEvent` (`NEW`).
2. **Immediate 202 Response**: Returns HTTP 202 Accepted. The API never waits for the bank.
3. **Durable Worker Execution**: A separate background worker (`node worker.js`) claims due jobs atomically (`status: "NEW"`, `nextAttemptAt <= now`), sets `status: "PROCESSING"`, and calls the bank with timeout (`AbortController` 3000ms).
4. **Stale Lock Reclamation**: If a worker crashes while processing, other workers reclaim jobs locked longer than 60 seconds.
5. **Bank Idempotency Reference**: Stable reference `wd_<withdrawalId>` generated once and reused across all retries.
6. **Definitive Refusal & Compensating Reversal**:
   - Closed account or definitive failure -> `reverseWithdrawal` executes atomically.
   - Claims status `REVERSED` conditionally (only if `PENDING`, `PROCESSING`, or `NEEDS_REVIEW`).
   - Credits money back to user's wallet with compensating `REVERSAL` transaction and `CREDIT` ledger entry.
7. **Timeout & Failure Policy (Backoff + Jitter)**:
   - Timeout or 5xx is treated as "outcome unknown".
   - Attempts < 5: retried with exponential backoff (`waitMs = 1000 * 2^attempts + random * 500ms`).
   - Attempts >= 5: safely parked in `NEEDS_REVIEW`, outbox job `STUCK`, balance NOT refunded.
8. **Reconciliation Formula**:
   - `Money In = DEPOSIT + TOPUP`
   - `Money Out = WITHDRAWAL - REVERSAL`
   - `Total Wallet Balance = Total Money In - Net Money Out`
   - `moneyIsConserved: totalBalance === (moneyIn - moneyOut)`
9. **Bonus Features Implemented**:
   - **Bonus 6 (Concurrent Workers)**: Tested multiple concurrent worker processes claiming jobs simultaneously; exactly one worker wins the atomic lease, 0 duplicate payouts.
   - **Bonus 7 (AES-256-GCM Encryption)**: Bank account numbers encrypted at rest in MongoDB using AES-256-GCM with keys from `.env`, decrypted strictly in memory inside the worker.
10. **Interview Questions Documented**:
   - All 12 interview questions thoroughly answered in own words in `DAY5_ANSWERS.md`.

  - Live API integration verification (`test/test_checkpoint8_live.js`):
    - Live P2P transfer between two disposable test users: ₹150.00 (15,000 paise).
    - Exact money conservation: Sender Debit (15,000 paise) === Recipient Credit (15,000 paise). Balances: ₹350.00 and ₹150.00.
    - Idempotency replay: Same transfer payload and `Idempotency-Key` returned cached 201 response with matching Transaction ID, 0 double debits.
    - Ledger history: Verified debit ledger entry for sender and credit ledger entry for recipient with respective counterparties and resulting balances.

## 20. Bonus Features

### Reconciliation (implemented)
`GET /api/v1/admin/reconcile` — uses MongoDB aggregation to report wallet
count, total balance, total deposited, conservation flag, and ledger
mismatches. Protected by `x-admin-key`.

### Daily transfer limit (NOT implemented)
₹25,000/day per user = 2,500,000 paise. Would need:
- A `DailyUsage` model with `{ userId, date, amount }` and unique `{ userId, date }` index.
- An atomic update within the transfer transaction: `DailyUsage.findOneAndUpdate(upsert)` with a `$lte 2,500,000` condition.
- UTC as the calendar-day timezone, clearly documented.

Not implemented because all five core levels were prioritised first per PRD instructions.


# Day 6: Lock the Wallet — Security Architecture, Payment PIN, Daily Limits & Session Controls

## 22. Day 6: Lock the Wallet — Security Architecture, Payment PIN, Daily Limits & Session Controls

### 22.1 Architectural Security Foundation
Day 6 transforms KaasuPay from a functional wallet into a hardened fintech banking system. The architecture implements defense-in-depth where frontend validation is strictly an ergonomic layer and never a security boundary.

```text
Client Request (HTTPS / Bearer JWT)
       ↓
Gate 1: Authentication & Session Verification (tokenVersion in JWT === user.tokenVersion)
       ↓
Gate 2: API Rate Limiting (Fixed-window MongoDB counter with TTL: 5/min signin, 10/min money)
       ↓
Gate 3: Request Input Validation (Zod schema: sanitized, trimmed, non-negative, integer paise)
       ↓
Gate 4: Receiver Resolution & Self-Transfer Prevention (404 Not Found, 400 Self-transfer)
       ↓
Gate 5: Payment PIN Verification (Atomic attempt reservation: 403 with triesLeft, 423 Locked)
       ↓
Gate 6: Idempotency Claim (IdempotencyRecord.create: 422 param mismatch, 409 in-progress, 200 replay)
       ↓
Gate 7: Database Transaction (MongoDB Replica Set Multi-Document Session)
       ├── Atomic Daily Limit Reservation (DailySpend.findOneAndUpdate $inc <= 1,000,000 paise)
       ├── Sender Wallet Balance Check & Atomic Debit (Wallet.findOneAndUpdate balance >= amount)
       ├── Recipient Wallet Credit (Transfer) OR Outbox Event Creation (Withdrawal)
       └── Immutable Double-Entry Ledger Invariants (LedgerEntry.insertMany)
       ↓
Client Response (200 / 201 / 202 with security headers: X-RateLimit-*, Retry-After)
```

### 22.2 Payment PIN (B1 & F1)
- **PIN Requirements**: Strictly 4 or 6 numeric digits. Enforced server-side.
- **Trivial Guess Prevention**: Rejects all identical digits (`0000`, `1111`) and common predictable sequences (`1234`, `4321`, `123456`, `654321`).
- **Cryptographic Storage**: Hashed with bcrypt (salt rounds 10). Plaintext PIN is never stored, never logged, and never included in idempotency request hashes (`hashRequest`).
- **Step-Up Verification**: Separate from login password. Required for all outgoing transfers and withdrawals. Re-authenticating password required to set/update PIN via `POST /api/v1/user/pin`.

### 22.3 Failed-Attempt Lockout & Anti-Race Reservation (B2 & Bonus 8)
- **Lockout Policy**: After 3 consecutive incorrect PIN guesses, wallet PIN is locked for exactly 15 minutes (900 seconds). Returns `423 Locked` with `Retry-After: <seconds>`.
- **Atomic Reservation against Concurrency Attacks**:
  To prevent the classic *"check-then-act"* race where concurrent requests check `pinFailedCount < 3` simultaneously and bypass lockout:
  1. Increment `pinFailedCount: 1` atomically on user document where `pinLockedUntil <= now` or `null`.
  2. Compare candidate PIN with `pinHash`.
  3. If match: reset `pinFailedCount: 0`. If mismatch and count >= 3, set `pinLockedUntil: now + 15m`.
- **Staff Override**: `POST /api/v1/admin/users/:id/unlock-pin` protected by `x-admin-key`.

### 22.4 Shared Daily Outgoing Limit (B3 & F4)
- **Limit Matrix**: ₹10,000 (1,000,000 paise) shared across P2P transfers and bank withdrawals combined.
- **Asia/Kolkata Calendar Day**: Calculated as `UTC + 5:30`. Daily limit resets at midnight IST (`18:30:00.000Z` UTC).
- **Transactional Accounting**:
  Managed via `DailySpend` collection with compound unique index `{ userId: 1, day: 1 }`.
  Incremented atomically inside the database transaction:
  `DailySpend.findOneAndUpdate({ userId, day, spent: { $lte: 1000000 - amount } }, { $inc: { spent: amount } }, { upsert: true, session, returnDocument: 'after' })`.
- **Refund Invariance**: Per Day 6 specification, refunds/reversals of failed withdrawals do NOT restore the daily limit. Add money top-ups do not count toward outgoing spend.

### 22.5 API Rate Limiting (B4)
- **Fixed-Window MongoDB Counters**: Implemented via `RateLimitCounter` collection with TTL index (`expireAfterSeconds: 0`).
- **Enforced Thresholds**:
  - `POST /user/signin`: 5 requests / min per normalized email; 20 requests / min per IP address.
  - `POST /user/signup`: 10 requests / hour per IP address.
  - `POST /user/pin`: 5 requests / hour per authenticated user.
  - `POST /wallet/transfer` & `POST /wallet/withdraw`: 10 requests / min shared per authenticated user.
- **Headers & Response**: Includes standard `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `Retry-After`. Returns HTTP `429 Too Many Requests`.

### 22.6 Session Security & Multi-Device Revocation (B5 & F5)
- **Token Versioning**: User model maintains `tokenVersion` (integer). Every issued JWT embeds `tv: user.tokenVersion`.
- **Protected Route Enforcement**: `requireAuth` verifies that `payload.tv === user.tokenVersion`. If mismatch, returns `401 { message: "Session ended. Please sign in again" }`.
- **Multi-Device Logout**: `POST /api/v1/user/logout-all` atomically increments `tokenVersion`, invalidating all active sessions across all devices.
- **Password Rotation**: When password changes via `PUT /api/v1/user`, old sessions are revoked by incrementing `tokenVersion` and a fresh token is issued for the current session.

### 22.7 Verified Test Matrix
All test suites executed against real MongoDB replica sets and fake banking services:
1. **Day 2 Matrix** (`test/day2.test.js`): **63 / 63 passed** (persistence, auth, error cases).
2. **Day 3 Matrix** (`test/day3.test.js`): **78 / 78 passed** (transfers, double-entry ledger, idempotency, double-spend prevention).
3. **Day 4 Matrix** (`test/day4.test.js`): **128 / 128 passed** (Razorpay top-up, webhooks, signature verification, reconciliation).
4. **Day 5 Matrix** (`test/day5.test.js`): **75 / 75 passed** (bank withdrawals, transactional outbox worker, exponential backoff, reversals).
5. **Day 6 Matrix** (`test/day6.test.js`): **47 / 47 passed** (PIN setup, 3-try lockout, daily limits, signin & money rate limits, logout-all, concurrency races).
**Total Passing Backend Assertions: 391 passed, 0 failed.**
