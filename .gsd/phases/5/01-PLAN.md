---
phase: 5
plan: 1
wave: 1
gap_closure: false
---

# Plan 5.1: Lazy Expiration & Anti-Spam Limits (Level 4 & 5 / D5 & D6)

## Objective
Validate lazy expiration mechanics across actions and inbox reads without cron jobs/workers, enforce the 5-pending-request spam limit and 20/hr rate limit, and prove race safety with a concurrent Pay vs Cancel test.

## Context
Load these files for context:
- .gsd/SPEC.md
- kaasupay-backend/controllers/requestController.js
- kaasupay-backend/routes/requestRoutes.js
- kaasupay-backend/middleware/rateLimiter.js
- kaasupay-backend/models/moneyRequestModel.js

## Tasks

<task type="auto">
  <name>Verify and ensure lazy expiration and anti-spam handling in requestController</name>
  <files>
    kaasupay-backend/controllers/requestController.js
    kaasupay-backend/routes/requestRoutes.js
  </files>
  <action>
    Review `kaasupay-backend/controllers/requestController.js` and `kaasupay-backend/routes/requestRoutes.js`:
    - Confirm `expiresAt: { $gt: now }` is present in conditional queries for `pay`, `decline`, and `cancel`.
    - Confirm `updateMany` lazy expiry sweep runs in `getIncomingRequests` and `getOutgoingRequests`.
    - Confirm `countDocuments({ requesterId: req.userId, payerId: to, status: "PENDING" }) >= 5` returns 409.
    - Confirm `requestCreateLimiter` is mounted on `POST /` with 20 req/hr window.
  </action>
  <verify>
    node -r dotenv/config -e "import('./kaasupay-backend/controllers/requestController.js').then(() => console.log('requestController verified for Phase 5'));"
  </verify>
  <done>
    All lazy expiration and anti-spam constraints are verified in place.
  </done>
</task>

<task type="auto">
  <name>Create and run Level 4 & Level 5 (D5 & D6) acceptance and race test suite</name>
  <files>
    kaasupay-backend/test/phase5_expiry_spam.test.js
  </files>
  <action>
    Create acceptance test `kaasupay-backend/test/phase5_expiry_spam.test.js` validating:
    1. D5: Expiry testing:
       - Create request R_exp from Priya to Raju.
       - Manually update its `expiresAt` in database to yesterday (`new Date(Date.now() - 24 * 3600 * 1000)`).
       - Raju tries to pay R_exp -> 410 `{"message":"This request has expired"}`.
       - Raju tries to decline R_exp -> 410 `{"message":"This request has expired"}`.
       - Priya tries to cancel R_exp -> 410 `{"message":"This request has expired"}`.
       - Raju queries incoming requests (`GET /requests/incoming`) -> status shows "EXPIRED".
       - Priya queries outgoing requests (`GET /requests/outgoing`) -> status shows "EXPIRED".
       - Verify Raju's and Priya's balances remain completely unchanged.
    2. D6: Limits testing:
       - Kavi sends 5 consecutive requests to Raju -> 201 each time.
       - Kavi sends 6th request to Raju -> 409 `{"message":"You already have 5 pending requests to this person"}`.
       - Raju declines 1 of Kavi's 5 requests -> 200 `{"message":"Request declined"}`.
       - Kavi sends again -> 201 (now count is 4, so it fits again).
       - Rate limit verification: rapid creation requests beyond 20 within 1 hour return 429.
    3. Concurrency Race Test (Bonus 8 / PDF Page 10):
       - Create request R_race from Priya to Raju.
       - Execute `Promise.all([pay(R_race), cancel(R_race)])` simultaneously.
       - Exactly one promise resolves with 200, the other resolves with 409.
       - Verify money moved if and only if pay won.
    4. Admin Reconcile check:
       - `GET /api/v1/admin/reconcile` reports `moneyIsConserved: true` with 0 mismatches.
  </action>
  <verify>
    node test/phase5_expiry_spam.test.js
  </verify>
  <done>
    All D5, D6, and concurrency race tests pass cleanly with 0 failures.
  </done>
</task>

## Success Criteria
- [ ] D5 lazy expiration verified without cron jobs or background workers.
- [ ] D6 5-pending requests spam limit and 20/hr rate limit verified.
- [ ] Concurrent Pay vs Cancel race test proves mutual exclusion and zero financial corruption.
- [ ] Complete test suite passes.
