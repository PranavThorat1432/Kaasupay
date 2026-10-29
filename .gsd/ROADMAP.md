---
milestone: Day 7 Request Money
version: 1.0.0
updated: 2026-10-29T12:52:00.000Z
---

# Roadmap: Day 7 Request Money

> **Current Phase:** Phase 4 - Atomic Payment Execution & Financial Settlement
> **Status:** Phase 3 Completed. Ready for Phase 4.
> **Specification:** [.gsd/SPEC.md](file:///c:/Users/hp/Desktop/Sure%20Trust/KaasuPay%20Application/.gsd/SPEC.md)

---

## Must-Haves (from SPEC)

- [x] `MoneyRequest` Mongoose schema with status state machine (`PENDING`, `PAID`, `DECLINED`, `CANCELLED`, `EXPIRED`) and compound indexes.
- [x] Protected endpoints under `/api/v1/requests`: create, incoming, outgoing, getById, decline, cancel, and pay.
- [ ] Double-lock pay execution: `Idempotency-Key` replay protection + atomic `status: "PENDING"` state condition.
- [ ] Atomic money transfer inside a single session transaction: daily limit check, wallet debit, wallet credit, `TRANSFER` transaction, and double-entry ledger rows.
- [ ] Lazy expiry: expired requests reject actions with HTTP `410` and auto-transition to `EXPIRED` in list queries without cron jobs.
- [ ] Anti-spam protection: maximum 5 pending requests to the same payer (409) and 20/hr request creation rate limit.
- [ ] Automated test suite `test/day7.test.js` covering test matrix D1–D6 and concurrency race conditions.
- [ ] Full interview answers documented in `DAY7_ANSWERS.md`.
- [ ] Frontend user interface for creating, viewing, paying (with PIN modal), and declining/cancelling requests.

---

## Phases

### Phase 1: Data Model, Configuration & Validation Foundation
**Status:** ✅ Complete  
**Objective:** Define the `MoneyRequest` schema, compound indexes, configuration constants, and Zod input validation schemas.  
**Requirements:** Data Model, Compound Indexes, `REQUEST_EXPIRY_DAYS = 7`.

**Deliverables:**
- `kaasupay-backend/models/moneyRequestModel.js` — Mongoose schema with `requesterId`, `payerId`, `amount`, `note`, `status`, `expiresAt`, `transactionId`, `decidedAt`, and indexes for incoming, outgoing, and spam checks.
- `kaasupay-backend/validations/requestValidation.js` — Zod schemas for create request, pay request, and ObjectId URL parameters.
- `kaasupay-backend/config.js` — Add `REQUEST_EXPIRY_DAYS` configuration constant (default 7).

**Verification:**
- Model instantiation, index definition check, and validation unit tests.

---

### Phase 2: Request Creation & Inbox Listing (Level 1 / D1)
**Status:** ✅ Complete  
**Objective:** Implement request creation (`POST /requests`), incoming/outgoing listing (`GET /requests/incoming`, `GET /requests/outgoing`), and single request retrieval (`GET /requests/:id`).  
**Depends on:** Phase 1

**Deliverables:**
- `kaasupay-backend/controllers/requestController.js` — handlers for `createRequest`, `getIncomingRequests`, `getOutgoingRequests`, `getRequestById`.
- `kaasupay-backend/routes/requestRoutes.js` — route definitions with `requireAuth`.
- Mount `/api/v1/requests` in `kaasupay-backend/routes/index.js`.
- Self-request prevention (`400`), non-existent payer prevention (`404`), stranger 404 isolation.

**Verification:**
- Automated test runner verifying Level 1 / D1 assertions (creation, incoming with sender names, outgoing with recipient names, stranger 404).

---

### Phase 3: Decline and Cancel State Transitions (Level 2 / D2)
**Status:** ✅ Complete  
**Objective:** Implement atomic, single-step status transitions for declining requests (`POST /requests/:id/decline`) and cancelling requests (`POST /requests/:id/cancel`).  
**Depends on:** Phase 2

**Deliverables:**
- In `requestController.js`:
  - `declineRequest`: Payer-only atomic update (`status: "PENDING"` -> `"DECLINED"`, `decidedAt: new Date()`).
  - `cancelRequest`: Requester-only atomic update (`status: "PENDING"` -> `"CANCELLED"`, `decidedAt: new Date()`).
- Atomic condition `{ _id: id, [role]: req.userId, status: "PENDING" }` preventing "check-then-act" races.
- Secondary inspection on failure: return `404` for strangers, `403` for wrong role, `409` if already decided.

**Verification:**
- Automated test runner verifying Level 2 / D2 assertions (payer declines, duplicate decline 409, requester declines 403, requester cancels, payer tries to pay cancelled request 409, stranger cancel 404).

---

### Phase 4: Atomic Payment Execution & Financial Settlement (Level 3 / D3 & D4)
**Status:** ⬜ Not Started  
**Objective:** Implement `POST /requests/:id/pay` with PIN verification, idempotency replay, and single-transaction money movement.  
**Depends on:** Phase 3

**Deliverables:**
- In `requestController.js` and `services/money.js`:
  - `payRequest`: Payer only; enforces Day 6 `moneyRateLimiter`.
  - Step-up auth: `verifyPin(req.userId, pin)` evaluated **before** creating idempotency records.
  - Idempotency: SHA-256 hash of `route + requestId` (never plaintext PIN); cached 200 replay on identical key; 409 on new key for already paid request.
  - Multi-document MongoDB session transaction:
    1. Atomically move request `PENDING` -> `PAID` (abort if already decided or expired).
    2. Atomically reserve daily spend via `checkAndConsumeDailyLimit` (abort if limit exceeded -> stays PENDING).
    3. Atomically debit payer wallet (`balance >= amount`) (abort if insufficient funds -> stays PENDING).
    4. Atomically credit requester wallet.
    5. Create `TRANSFER` transaction with note `"Request: <note>"`.
    6. Insert 2 double-entry `LedgerEntry` records (`DEBIT` for payer, `CREDIT` for requester).
    7. Update `MoneyRequest.transactionId = transaction._id`.
- Reconcile verification: `GET /api/v1/admin/reconcile` continues reporting `moneyIsConserved: true`.

**Verification:**
- Automated test runner verifying Level 3 & 4 (D3 & D4) assertions (valid payment, balance updates, ledger rows, same-key replay, wrong-key 409, wrong PIN 403, insufficient funds 400 with PENDING preservation, daily limit 400 with PENDING preservation, reconciliation conservation).

---

### Phase 5: Lazy Expiration & Anti-Spam Limits (Level 4 & 5 / D5 & D6)
**Status:** ⬜ Not Started  
**Objective:** Implement lazy expiration mechanics without background jobs, 5-pending-request spam limit, and 20/hr request creation rate limit.  
**Depends on:** Phase 4

**Deliverables:**
- Lazy expiry:
  - Add `expiresAt: { $gt: new Date() }` to atomic filters for `pay`, `decline`, and `cancel`. Return `410 { message: "This request has expired" }` if expired.
  - Batch lazy update in `getIncomingRequests` and `getOutgoingRequests`: run `updateMany({ [role]: req.userId, status: "PENDING", expiresAt: { $lte: new Date() } }, { $set: { status: "EXPIRED" } })` prior to reading.
- Anti-spam limits:
  - Enforce `RateLimitCounter` (20 requests per hour per user) on `POST /requests`.
  - Query existing pending requests: `countDocuments({ requesterId: req.userId, payerId: to, status: "PENDING" })`. If >= 5, return `409 { message: "You already have 5 pending requests to this person" }`.
- Concurrency race tests:
  - Concurrency test verifying racing `Promise.all([pay, cancel])` on the same request results in exactly one winner and zero double-moves.

**Verification:**
- Automated test runner verifying D5 (expiry returns 410, list shows EXPIRED) and D6 (5-pending spam limit returns 409, declines allow new request, 20/hr rate limit).

---

### Phase 6: Frontend Integration, Comprehensive Regression & Deliverables
**Status:** ⬜ Not Started  
**Objective:** Build frontend Request Money flows, answer all 12 interview questions in `DAY7_ANSWERS.md`, and execute full regression test pass.  
**Depends on:** Phase 5

**Deliverables:**
- Frontend Web App (`kaasupay-frontend`):
  - Request Money modal/page (recipient selector, amount in rupees -> paise, note).
  - Incoming requests card on Dashboard / Transfer page with "Pay" (opens `PinModal`) and "Decline" buttons.
  - Outgoing requests card with status badges (`PENDING`, `PAID`, `DECLINED`, `CANCELLED`, `EXPIRED`) and "Cancel" action.
  - Axios service methods in `walletService.js` and Redux integration in `walletSlice.js`.
- Documentation:
  - `DAY7_ANSWERS.md` with complete, detailed answers to all 12 questions from Part E.
- Verification:
  - Unified test suite execution (`node test/day7.test.js` + full regression `day2.test.js`, `day3.test.js`, `day4.test.js`, `day5.test.js`, `day6.test.js`).
  - Frontend `npm run lint` and `npm run build` passing with 0 errors.

---

## Phase Execution Waves

```
Wave 1: Phase 1 (Data Model & Validations)
   │
   ▼
Wave 2: Phase 2 (Request Creation & Inboxes)
   │
   ▼
Wave 3: Phase 3 (Decline & Cancel Transitions)
   │
   ▼
Wave 4: Phase 4 (Atomic Payment & Settlement)
   │
   ▼
Wave 5: Phase 5 (Lazy Expiry & Spam Limits)
   │
   ▼
Wave 6: Phase 6 (Frontend UI, DAY7_ANSWERS.md & Full Regression)
```
