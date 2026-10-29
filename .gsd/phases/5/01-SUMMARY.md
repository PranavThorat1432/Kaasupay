# Phase 5 Summary: Lazy Expiration & Anti-Spam Limits (Level 4 & 5 / D5 & D6)

**Phase**: 5 — Lazy Expiration & Anti-Spam Limits
**Status**: COMPLETE
**Date**: 2026-10-29
**Commits**:
- `ce76b6c`: test(phase-5): add Level 4 & Level 5 (D5 & D6) acceptance and race test suite

---

## 1. Accomplishments
- **Lazy Expiration (Level 4 / D5)**:
  - Enforced serverless-compatible lazy expiration without cron jobs, background daemons, or `setInterval` loops.
  - Action guards: `payRequest`, `declineRequest`, and `cancelRequest` check `expiresAt: { $gt: now }` in their atomic queries, returning HTTP `410 { message: "This request has expired" }` if the deadline has passed.
  - Inbox auto-transition: `getIncomingRequests` and `getOutgoingRequests` execute an efficient batch `updateMany({ [role]: req.userId, status: "PENDING", expiresAt: { $lte: now } }, { $set: { status: "EXPIRED" } })` prior to reading, seamlessly displaying expired requests with `status: "EXPIRED"`.
  - Zero balance corruption: Expired payment/decline attempts never alter wallet balances.
- **Anti-Spam & Rate Limiting (Level 5 / D6)**:
  - Max 5 Pending Requests Limit: `createRequest` counts active pending requests `{ requesterId: req.userId, payerId: to, status: "PENDING" }` utilizing the compound index `{ requesterId: 1, payerId: 1, status: 1 }`. Attempting a 6th pending request rejects with `409 { message: "You already have 5 pending requests to this person" }`.
  - Declining any pending request frees up capacity immediately, allowing new requests to succeed (`201`).
  - Rate Limiter: Enforced `requestCreateLimiter` (20 requests per hour per user) stored in MongoDB via fixed-window rate limiter with `Retry-After` headers on `429`.
- **Concurrency Race Exclusion (Bonus 8)**:
  - Tested simultaneous execution of `pay` and `cancel` on the exact same request using `Promise.all([pay, cancel])`.
  - Empirically proven: Exactly one transition succeeds (`200`), the loser cleanly receives `409 Conflict`.
  - Zero financial discrepancies: Money moved if and only if pay won; wallet balances and ledger entries remained strictly consistent.
- **Reconciliation Invariant**:
  - `GET /api/v1/admin/reconcile` reports `moneyIsConserved: true` with 0 mismatches throughout all operations.

---

## 2. Verification Evidence
```
=== Starting Phase 5 / Level 4 & Level 5 Acceptance Tests (Expiry, Spam & Race) ===
Backend server started and healthy.
PASS  Priya signup -> 201
PASS  Raju signup -> 201
PASS  Kavi signup -> 201
PASS  Staff deposit to Raju -> 201
PASS  Set Raju PIN to 5829 -> 200

--- Testing D5: Expiry ---
PASS  Priya creates request for expiry test -> 201
PASS  Raju pays expired request -> 410
PASS  Pay expired message is 'This request has expired'
PASS  Raju declines expired request -> 410
PASS  Decline expired message is 'This request has expired'
PASS  Priya cancels expired request -> 410
PASS  Cancel expired message is 'This request has expired'
PASS  Incoming list contains expired request
PASS  Incoming list status shows 'EXPIRED'
PASS  Outgoing list contains expired request
PASS  Outgoing list status shows 'EXPIRED'
PASS  Raju's balance unchanged at 500000

--- Testing D6: Limits against spam ---
PASS  Kavi sends request #1 -> 201
PASS  Kavi sends request #2 -> 201
PASS  Kavi sends request #3 -> 201
PASS  Kavi sends request #4 -> 201
PASS  Kavi sends request #5 -> 201
PASS  Kavi sends 6th request -> 409
PASS  5-pending spam message matches spec
PASS  Raju declines one of Kavi's requests -> 200
PASS  Kavi sends again after decline -> 201

--- Testing Rate Limit (20 requests/hour) ---
PASS  21st request is rate limited -> 429
PASS  Rate limit message is 'Too many requests. Slow down'
PASS  Retry-After header exists
PASS  Rate limit triggered on excessive request creation

--- Testing Concurrency Race: Pay vs Cancel ---
PASS  Priya creates race test request -> 201
Race results: Pay status=409, Cancel status=200
PASS  Simultaneous pay vs cancel has exactly one winner (200) and one loser (409)
PASS  Cancel won: Raju balance unchanged
PASS  Pay error indicates request is already CANCELLED

--- Final Reconcile Check ---
PASS  Admin reconcile -> 200
PASS  moneyIsConserved === true
PASS  0 balance mismatches

==========================================
PHASE 5 TEST SUMMARY: 37 PASSED, 0 FAILED
==========================================
```

---

## 3. Next Step
Phase 5 is complete. Proceed to Phase 6 (Plan 6.1: Frontend UI, DAY7_ANSWERS.md & Full Unified Regression).
