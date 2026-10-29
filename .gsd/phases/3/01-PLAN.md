---
phase: 3
plan: 1
wave: 1
gap_closure: false
---

# Plan 3.1: Decline and Cancel State Transitions (Level 2 / D2)

## Objective
Implement atomic, single-step status transitions for declining requests (`POST /api/v1/requests/:id/decline`) and cancelling requests (`POST /api/v1/requests/:id/cancel`), preventing check-then-act races, setting `decidedAt`, and returning precise error contracts (404 for strangers, 403 for wrong role, 409 for already decided, 410 for expired).

## Context
Load these files for context:
- .gsd/SPEC.md
- kaasupay-backend/models/moneyRequestModel.js
- kaasupay-backend/controllers/requestController.js
- kaasupay-backend/routes/requestRoutes.js

## Tasks

<task type="auto">
  <name>Implement declineRequest and cancelRequest handlers</name>
  <files>
    kaasupay-backend/controllers/requestController.js
  </files>
  <action>
    In `kaasupay-backend/controllers/requestController.js`:
    1. Implement `declineRequest`:
       - Validate `mongoose.isValidObjectId(req.params.id)`. If invalid -> 404 `{ message: "Request not found" }`.
       - Execute atomic update:
         `MoneyRequest.findOneAndUpdate({ _id: id, payerId: req.userId, status: "PENDING", expiresAt: { $gt: new Date() } }, { $set: { status: "DECLINED", decidedAt: new Date() } }, { returnDocument: "after" })`.
       - If updated -> return 200 `{ message: "Request declined" }`.
       - If null -> inspect reason:
         - Query existing document `findById(id)`.
         - If not found or if user is neither payer nor requester -> 404 `{ message: "Request not found" }`.
         - If user is requester (`requesterId === req.userId`) -> 403 `{ message: "Only the person asked can decline this request" }`.
         - If `expiresAt <= new Date()` -> 410 `{ message: "This request has expired" }`.
         - If status is not PENDING -> 409 `{ message: "This request is already " + existing.status }`.
    2. Implement `cancelRequest`:
       - Validate `mongoose.isValidObjectId(req.params.id)`. If invalid -> 404 `{ message: "Request not found" }`.
       - Execute atomic update:
         `MoneyRequest.findOneAndUpdate({ _id: id, requesterId: req.userId, status: "PENDING", expiresAt: { $gt: new Date() } }, { $set: { status: "CANCELLED", decidedAt: new Date() } }, { returnDocument: "after" })`.
       - If updated -> return 200 `{ message: "Request cancelled" }`.
       - If null -> inspect reason:
         - Query existing document `findById(id)`.
         - If not found or user not party -> 404 `{ message: "Request not found" }`.
         - If user is payer (`payerId === req.userId`) -> 403 `{ message: "Only the requester can cancel this request" }`.
         - If `expiresAt <= new Date()` -> 410 `{ message: "This request has expired" }`.
         - If status is not PENDING -> 409 `{ message: "This request is already " + existing.status }`.
    AVOID: Reading first and then updating (check-then-act race).
    USE: Atomic `findOneAndUpdate` with `{ returnDocument: "after" }` and secondary inspection only on null.
  </action>
  <verify>
    node -e "import('./kaasupay-backend/controllers/requestController.js').then(c => { if (!c.declineRequest || !c.cancelRequest) throw new Error('Missing exports'); console.log('Handlers verified'); });"
  </verify>
  <done>
    `declineRequest` and `cancelRequest` are exported from `requestController.js`.
  </done>
</task>

<task type="auto">
  <name>Mount decline and cancel routes in requestRoutes</name>
  <files>
    kaasupay-backend/routes/requestRoutes.js
  </files>
  <action>
    In `kaasupay-backend/routes/requestRoutes.js`:
    - Import `declineRequest` and `cancelRequest`.
    - Mount:
      - `POST /:id/decline` -> `requireAuth`, `declineRequest`
      - `POST /:id/cancel` -> `requireAuth`, `cancelRequest`
  </action>
  <verify>
    node -e "import('./kaasupay-backend/routes/requestRoutes.js').then(() => console.log('requestRoutes compiled successfully'));"
  </verify>
  <done>
    Decline and cancel routes mounted under `/api/v1/requests`.
  </done>
</task>

<task type="auto">
  <name>Create and run Level 2 / D2 acceptance test suite</name>
  <files>
    kaasupay-backend/test/phase3_decline_cancel.test.js
  </files>
  <action>
    Create standalone acceptance test `kaasupay-backend/test/phase3_decline_cancel.test.js` verifying D2:
    1. Priya sends request R2 to Raju. Raju declines R2 -> 200 `{"message":"Request declined"}`.
    2. Raju declines R2 again -> 409 `{"message":"This request is already DECLINED"}`.
    3. Priya sends request R3 to Raju. Priya tries to decline R3 -> 403 `{"message":"Only the person asked can decline this request"}`.
    4. Priya cancels R3 -> 200 `{"message":"Request cancelled"}`.
    5. Priya cancels R3 again -> 409 `{"message":"This request is already CANCELLED"}`.
    6. Kavi (stranger) tries to cancel R3 -> 404 `{"message":"Request not found"}`.
    7. Raju tries to decline R3 (which is already CANCELLED) -> 409 `{"message":"This request is already CANCELLED"}`.
    8. Check `decidedAt` is recorded in database for both DECLINED and CANCELLED requests.
  </action>
  <verify>
    node kaasupay-backend/test/phase3_decline_cancel.test.js
  </verify>
  <done>
    All D2 acceptance tests pass with 0 failures and 0 regressions.
  </done>
</task>

## Success Criteria
- [ ] Atomic `declineRequest` and `cancelRequest` implemented.
- [ ] Routes mounted at `POST /:id/decline` and `POST /:id/cancel`.
- [ ] D2 test suite passes completely.
