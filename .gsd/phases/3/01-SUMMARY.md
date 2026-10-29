# Phase 3 Summary: Decline and Cancel State Transitions (Level 2 / D2)

**Phase**: 3 — Decline and Cancel State Transitions
**Status**: COMPLETE
**Date**: 2026-10-29
**Commits**:
- `125d999`: feat(phase-3): implement atomic declineRequest and cancelRequest handlers
- `994e47c`: feat(phase-3): mount decline and cancel routes
- `1fc56a2`: test(phase-3): add Level 2 / D2 acceptance test suite

---

## 1. Accomplishments
- **Atomic State Transitions**:
  - Implemented `declineRequest` in `kaasupay-backend/controllers/requestController.js`:
    - Atomic conditional match on `{ _id: id, payerId: req.userId, status: "PENDING", expiresAt: { $gt: now } }`.
    - Updates `status: "DECLINED"` and records `decidedAt: now` in a single query with `{ returnDocument: "after" }`.
  - Implemented `cancelRequest` in `kaasupay-backend/controllers/requestController.js`:
    - Atomic conditional match on `{ _id: id, requesterId: req.userId, status: "PENDING", expiresAt: { $gt: now } }`.
    - Updates `status: "CANCELLED"` and records `decidedAt: now` in a single query with `{ returnDocument: "after" }`.
- **Zero Race Condition Design**:
  - Eliminated check-then-act vulnerabilities by executing atomic conditional writes first.
  - Secondary fallback read executes only when `findOneAndUpdate` returns `null`, delivering exact HTTP status codes:
    - `404 { message: "Request not found" }` for invalid IDs, non-existent documents, and strangers (preventing ID enumeration and privacy leakage).
    - `403 { message: "Only the person asked can decline this request" }` when requester attempts to decline.
    - `403 { message: "Only the requester can cancel this request" }` when payer attempts to cancel.
    - `410 { message: "This request has expired" }` when request is overdue.
    - `409 { message: "This request is already <STATUS>" }` when already decided.
- **Route Mounting**:
  - Mounted `POST /api/v1/requests/:id/decline` and `POST /api/v1/requests/:id/cancel` in `kaasupay-backend/routes/requestRoutes.js` protected by `requireAuth`.
- **Empirical Validation**:
  - Created test suite `kaasupay-backend/test/phase3_decline_cancel.test.js` validating all D2 requirements with 35/35 passing assertions.
  - Re-ran regression tests for Phase 1 (34/34 passing) and Phase 2 (37/37 passing).

---

## 2. Verification Evidence
```
=== Starting Phase 3 / Level 2 Acceptance Tests (Decline & Cancel) ===
Backend server started and healthy.
PASS  Priya signup -> 201
PASS  Raju signup -> 201
PASS  Kavi signup -> 201

--- Scenario 1: Priya sends R2 to Raju -> Raju declines R2 ---
PASS  Priya sends R2 -> 201
PASS  Kavi (stranger) decline R2 -> 404
PASS  Stranger decline message is 'Request not found'
PASS  Raju declines R2 -> 200
PASS  Decline message is 'Request declined'
PASS  Raju declines R2 again -> 409
PASS  Already declined message contains 'already DECLINED'
PASS  Priya tries to decline R2 -> 403
PASS  Requester decline error message matches
PASS  R2 DB status is DECLINED
PASS  R2 decidedAt is recorded Date

--- Scenario 2: Priya sends R3 to Raju -> Priya cancels R3 ---
PASS  Priya sends R3 -> 201
PASS  Priya tries to decline R3 -> 403
PASS  Priya decline error matches spec
PASS  Raju tries to cancel R3 -> 403
PASS  Payer cancel error matches spec
PASS  Kavi (stranger) cancel R3 -> 404
PASS  Stranger cancel message is 'Request not found'
PASS  Priya cancels R3 -> 200
PASS  Cancel message is 'Request cancelled'
PASS  Priya cancels R3 again -> 409
PASS  Already cancelled message contains 'already CANCELLED'
PASS  Raju tries to decline CANCELLED R3 -> 409
PASS  Decline on cancelled request returns 409 with 'already CANCELLED'
PASS  R3 DB status is CANCELLED
PASS  R3 decidedAt is recorded Date

--- Scenario 3: Bad ID parameter tests ---
PASS  Bad id decline -> 404
PASS  Bad id cancel -> 404
PASS  Non-existent id decline -> 404
PASS  Non-existent id cancel -> 404
PASS  GET R2 reflects status DECLINED
PASS  GET R3 reflects status CANCELLED

==========================================
PHASE 3 / LEVEL 2 TEST SUMMARY: 35 PASSED, 0 FAILED
==========================================
```

---

## 3. Next Step
Phase 3 is complete. Proceed to Phase 4 (Plan 4.1: Atomic Payment & Financial Settlement — Level 3 / D3 & D4).
