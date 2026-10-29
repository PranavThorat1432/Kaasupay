# SPEC.md — Project Specification: Day 7 Request Money

> **Status**: `FINALIZED`
>
> 🔒 **Planning Lock**: Requirements are finalized and approved. Implementation may proceed in accordance with ROADMAP.md.

---

## 1. Vision

KaasuPay Day 7 introduces **Request Money** (P2P pull payments). Users can request money from other registered users (e.g., splitting dinner bills or settling shared expenses). The payer receives the request in their incoming inbox, reviews details, and authorizes payment in a single step using their payment PIN, or chooses to decline it. Requesters can track request status in real time and cancel open requests.

Financial safety is absolute: requests are non-custodial notes until the exact instant of payment. Paying moves funds atomically inside a multi-document database transaction using the established Day 3 double-entry ledger, cryptographic idempotency, and Day 6 security gates (payment PIN verification, ₹10,000/day spending limit, and API rate limiting). Expired requests terminate cleanly via lazy evaluation without background polling or cron infrastructure.

---

## 2. Core Personas & Terminology

| Persona / Term | Description | Role in Flow |
|---|---|---|
| **Requester** | The user asking for money | Creates the request, can cancel while PENDING, receives funds upon payment |
| **Payer** | The user being asked for money | Receives incoming request, can decline, pays using payment PIN |
| **Request Note** | Narrative description (max 100 chars) | Explains what the request was for; transfers over to ledger history |

---

## 3. Goals

1. **Request Lifecycle State Machine**:
   - States: `PENDING`, `PAID`, `DECLINED`, `CANCELLED`, `EXPIRED`.
   - Single atomic transitions: only legal transitions are permitted (`PENDING` -> `PAID | DECLINED | CANCELLED | EXPIRED`). Terminal states are permanently immutable.
2. **Double-Lock Payment Safety**:
   - Double-tap and replay protection via `Idempotency-Key` header and canonical hashing (`route + requestId`, never containing plaintext PIN).
   - Atomic state condition (`status: "PENDING"`) guarantees a request is paid at most once, even under concurrent racing requests.
3. **Atomic Financial Settlement**:
   - State transition (`PENDING` -> `PAID`), daily limit reservation, wallet debit, wallet credit, transaction creation, and ledger logging commit together in one MongoDB replica-set transaction.
4. **Lazy Expiration (Zero Background Infrastructure)**:
   - Configurable expiry (7 days from creation: `REQUEST_EXPIRY_DAYS = 7`).
   - Expiration enforced lazily: queries to incoming/outgoing lists batch-expire pending requests older than `new Date()`, while action routes (`pay`, `decline`, `cancel`) require `expiresAt: { $gt: new Date() }` directly in atomic query filters.
5. **Anti-Spam & Rate Limiting**:
   - Maximum 5 pending requests from user A to user B; 6th request rejected with HTTP `409`.
   - Request creation rate limited to 20 requests per hour per user via MongoDB fixed-window counter.
6. **Information Privacy**:
   - Strangers attempting to read, pay, decline, or cancel requests receive HTTP `404 Not Found` (never 403) to prevent enumerating user activity.
   - Requesters attempting to pay their own request receive HTTP `403 Forbidden` with `"Only the person asked can pay this request"`.
7. **Empirical Automated Test Suite**:
   - Fully automated test suite (`test/day7.test.js`) verifying test scenarios D1 through D6, concurrency races, and financial conservation.
8. **Interview Architecture Documentation**:
   - `DAY7_ANSWERS.md` providing comprehensive answers to all 12 architectural questions.

---

## 4. Non-Goals (Out of Scope for Day 7)

- **Partial Payments**: Requests must be paid in full (no partial payments or installment plans).
- **Background Cron / Daemon for Expiry**: No `cron`, `setInterval`, or worker loops for expiring requests. Lazy evaluation is strictly mandated to preserve Vercel serverless compatibility.
- **External Notifications / SMS / Push**: Real-time push notifications are out of scope; users view requests inside the inbox UI.
- **Automatic Payment Subscriptions / Auto-Debit**: All payments require explicit manual user PIN authorization.

---

## 5. Technical Requirements & API Specification

### Data Model: `MoneyRequest` (`moneyrequests` collection)

```js
{
  _id: ObjectId,
  requesterId: { type: ObjectId, ref: "User", required: true },
  payerId: { type: ObjectId, ref: "User", required: true },
  amount: { type: Number, required: true }, // Integer paise (100 to 1,000,000)
  note: { type: String, maxlength: 100, default: null },
  status: {
    type: String,
    enum: ["PENDING", "PAID", "DECLINED", "CANCELLED", "EXPIRED"],
    default: "PENDING"
  },
  expiresAt: { type: Date, required: true }, // Default: +7 days
  transactionId: { type: ObjectId, ref: "Transaction", default: null },
  decidedAt: { type: Date, default: null },
  createdAt: Date,
  updatedAt: Date
}
```

**Compound Indexes:**
1. Incoming inbox query: `{ payerId: 1, status: 1, createdAt: -1 }`
2. Outgoing inbox query: `{ requesterId: 1, status: 1, createdAt: -1 }`
3. Spam guard query: `{ requesterId: 1, payerId: 1, status: 1 }`

---

### API Endpoints (Mounted at `/api/v1/requests`)

All endpoints require `requireAuth` (Bearer JWT with matching `tokenVersion`).

| Method | Endpoint | Authorization | Key Logic & HTTP Response |
|---|---|---|---|
| `POST` | `/api/v1/requests` | Requester | Rate limit (20/hr). Validates `to` (ObjectId), `amount` (100-1M paise), `note` (<=100). Self-request -> `400`. Payer missing -> `404`. Max 5 pending requests to same payer -> `409`. Creates request -> `201 { message: "Request sent", request: { id, to, amount, note, status: "PENDING", expiresAt } }`. |
| `GET` | `/api/v1/requests/incoming` | Payer | Lazy-expires overdue requests via `updateMany`. Optional `?status=PENDING`. Returns newest 20 -> `200 { requests: [{ id, from, amount, note, status, createdAt, expiresAt }] }`. |
| `GET` | `/api/v1/requests/outgoing` | Requester | Lazy-expires overdue requests via `updateMany`. Optional `?status=PENDING`. Returns newest 20 -> `200 { requests: [{ id, to, amount, note, status, createdAt, expiresAt }] }`. |
| `GET` | `/api/v1/requests/:id` | Requester or Payer | Validates ObjectId. If not found or user not party -> `404`. If pending and expired -> lazy mark `EXPIRED`. Returns `200` with other person's name. |
| `POST` | `/api/v1/requests/:id/decline` | Payer Only | Atomic update: `{ _id, payerId, status: "PENDING", expiresAt: { $gt: now } }` -> `{ status: "DECLINED", decidedAt: now }`. If not modified: stranger -> `404`, requester -> `403`, decided -> `409`, expired -> `410`. Returns `200 { message: "Request declined" }`. |
| `POST` | `/api/v1/requests/:id/cancel` | Requester Only | Atomic update: `{ _id, requesterId, status: "PENDING", expiresAt: { $gt: now } }` -> `{ status: "CANCELLED", decidedAt: now }`. If not modified: stranger -> `404`, wrong user -> `403`, decided -> `409`, expired -> `410`. Returns `200 { message: "Request cancelled" }`. |
| `POST` | `/api/v1/requests/:id/pay` | Payer Only | Rate limited (10 money ops/min). Requires `Idempotency-Key` header and body `{ pin }`. Validates PIN **before** idempotency record (wrong PIN returns `403`/`423` without consuming key). Hash = `sha256("POST /api/v1/requests/:id/pay")` (no PIN). Single session transaction: (1) atomic state transition `PENDING` -> `PAID`, (2) daily limit consume, (3) conditional debit payer, (4) credit requester, (5) create `TRANSFER` transaction with note `"Request: <note>"`, (6) create double-entry `LedgerEntry` records, (7) link `transactionId`. On success -> `200 { message: "Request paid", transactionId, balance }`. Same key replay -> cached `200`. New key on paid -> `409`. Expired -> `410`. Insufficient balance / limit reached -> `400` and request stays `PENDING`. |

---

## 6. Financial & Concurrency Invariants

1. **Zero Money Movement on Creation/Decline/Cancellation**:
   Creating, declining, or cancelling a request modifies only `MoneyRequest` metadata; wallets and ledger entries are untouched.
2. **Exactly-Once Settlement**:
   Payment moves money exactly once. Idempotent retries with the same `Idempotency-Key` replay the exact cached 200 response without moving funds again.
3. **Simultaneous Race Elimination**:
   Under concurrent pay and cancel requests (`Promise.all`), exactly one atomic transition succeeds (`PENDING` -> `PAID` or `PENDING` -> `CANCELLED`). The loser receives HTTP `409 Conflict`. Money moves if and only if pay wins.
4. **Conservation of Money**:
   `GET /api/v1/admin/reconcile` must continue to report `moneyIsConserved: true` and 0 ledger mismatches across all operations.

---

## 7. Success Criteria

- [ ] All 6 test levels from the Day 7 PDF pass cleanly:
  - **D1**: Send request, verify incoming/outgoing lists, stranger isolation (404), self-request prevention (400), invalid amounts (400).
  - **D2**: Decline request (payer), cancel request (requester), duplicate decline/cancel (409), unauthorized actions (403/404).
  - **D3**: Pay request with PIN, idempotency replay (same key), duplicate payment lockout (new key -> 409), balance updates, ledger records, wrong PIN (403).
  - **D4**: Insufficient balance refusal (400) leaves request `PENDING`, daily limit breach leaves request `PENDING`.
  - **D5**: Lazy expiry: requests past `expiresAt` return 410 on pay/decline and auto-transition to `EXPIRED` in list queries without background jobs.
  - **D6**: Anti-spam: 5 pending requests per recipient limit enforced (6th receives 409), 20/hr rate limit enforced.
- [ ] Concurrency race test passes: concurrent Pay vs Cancel resolves deterministically with zero double-spends or orphan payments.
- [ ] Admin reconciliation check passes: `moneyIsConserved === true`.
- [ ] All previous test suites (Days 2–6 + Worker) continue to pass without regression.
- [ ] `DAY7_ANSWERS.md` answers all 12 interview questions in thorough detail.
- [ ] Frontend Request Money UI and interactive flows are built and integrated cleanly with 0 lint and build errors.

---

*Last updated: 2026-10-29*
