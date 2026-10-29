---
phase: 4
plan: 1
wave: 1
gap_closure: false
---

# Plan 4.1: Atomic Payment Execution & Financial Settlement (Level 3 / D3 & D4)

## Objective
Implement `POST /api/v1/requests/:id/pay` with PIN step-up authorization, double-lock protection (idempotency key replay + atomic `status: "PENDING"` conditional transition), single-transaction financial settlement (daily limit reservation, wallet debit/credit, transaction log, double-entry ledger rows, `transactionId` linkage), and reconciliation conservation.

## Context
Load these files for context:
- .gsd/SPEC.md
- kaasupay-backend/services/money.js
- kaasupay-backend/services/pinService.js
- kaasupay-backend/services/dailyLimitService.js
- kaasupay-backend/models/moneyRequestModel.js
- kaasupay-backend/models/idempotencyRecordModel.js
- kaasupay-backend/controllers/requestController.js
- kaasupay-backend/routes/requestRoutes.js

## Tasks

<task type="auto">
  <name>Implement payRequest controller handler with single-transaction settlement</name>
  <files>
    kaasupay-backend/controllers/requestController.js
  </files>
  <action>
    In `kaasupay-backend/controllers/requestController.js`:
    1. Import `IdempotencyRecord` from `../models/idempotencyRecordModel.js`.
    2. Import `Wallet` from `../models/walletModel.js`.
    3. Import `Transaction` from `../models/transactionModel.js`.
    4. Import `LedgerEntry` from `../models/ledgerEntryModel.js`.
    5. Import `verifyPin` from `../services/pinService.js`.
    6. Import `checkAndConsumeDailyLimit` from `../services/dailyLimitService.js`.
    7. Import `MoneyError` from `../services/money.js`.
    8. Implement `payRequest(req, res)`:
       - Validate `mongoose.isValidObjectId(req.params.id)`. If invalid -> 404 `{ message: "Request not found" }`.
       - Check `Idempotency-Key` header:
         - Missing, non-string, or empty -> 400 `{ message: "Idempotency-Key header is required" }`.
         - Length > 100 -> 400 `{ message: "Idempotency-Key must be at most 100 characters" }`.
       - Validate PIN presence:
         - Missing `req.body?.pin` -> 400 `{ message: "PIN is required" }`.
       - Canonical request hash:
         - `crypto.createHash("sha256").update("POST /api/v1/requests/" + id + "/pay").digest("hex")`.
       - Idempotency key pre-check:
         - Query `IdempotencyRecord.findOne({ userId: req.userId, key: trimmedKey })`.
         - If `state === "IN_PROGRESS"` -> 409 `{ message: "This request is already being processed" }`.
         - If `state === "DONE"`:
           - If `requestHash !== reqHash` -> 422 `{ message: "Idempotency-Key reused with a different request" }`.
           - Return cached `res.status(existing.responseStatus).json(existing.responseBody)`.
       - Load request from DB:
         - If not found -> 404 `{ message: "Request not found" }`.
         - Stranger check: if `req.userId` != `requesterId` && `req.userId` != `payerId` -> 404 `{ message: "Request not found" }`.
         - Requester check: if `req.userId === requesterId` -> 403 `{ message: "Only the person asked can pay this request" }`.
         - Expiry check: if `request.expiresAt <= now` -> 410 `{ message: "This request has expired" }`.
         - Decided check: if `request.status !== "PENDING"` -> 409 `{ message: "This request is already " + request.status }`.
       - Step-up auth:
         - Call `await verifyPin(req.userId, req.body.pin)` **before** inserting idempotency record.
         - On wrong PIN: returns 403 `{ message: err.message, triesLeft: err.triesLeft }` (or 423 if locked). Key is not consumed.
       - Claim idempotency slot:
         - Try `IdempotencyRecord.create({ userId: req.userId, key: trimmedKey, requestHash: reqHash, state: "IN_PROGRESS" })`.
         - Catch duplicate key 11000 and handle concurrent/replay states.
       - MongoDB session transaction:
         - `session = await mongoose.startSession()`.
         - Inside `session.withTransaction(...)`:
           1. Atomic state change:
              `MoneyRequest.findOneAndUpdate({ _id: id, payerId: req.userId, status: "PENDING", expiresAt: { $gt: now } }, { $set: { status: "PAID", decidedAt: now } }, { session, returnDocument: "after" })`.
              If null -> throw MoneyError (410 if expired, 409 if decided).
           2. Daily limit check:
              `await checkAndConsumeDailyLimit(req.userId, request.amount, session)`.
           3. Debit payer wallet:
              `Wallet.findOneAndUpdate({ userId: req.userId, balance: { $gte: request.amount } }, { $inc: { balance: -request.amount } }, { session, returnDocument: "after" })`.
              If null -> throw `MoneyError(400, "Insufficient balance")`.
           4. Credit requester wallet:
              `Wallet.findOneAndUpdate({ userId: request.requesterId }, { $inc: { balance: request.amount } }, { session, returnDocument: "after" })`.
           5. Create Transaction:
              `Transaction.create([{ type: "TRANSFER", fromUserId: req.userId, toUserId: request.requesterId, amount: request.amount, note: request.note ? ("Request: " + request.note) : "Request", status: "COMPLETED" }], { session })`.
           6. Create double-entry Ledger entries:
              `LedgerEntry.create([{ userId: req.userId, transactionId: txn._id, direction: "DEBIT", amount: request.amount, balanceAfter: payerWallet.balance }, { userId: request.requesterId, transactionId: txn._id, direction: "CREDIT", amount: request.amount, balanceAfter: requesterWallet.balance }], { session })`.
           7. Save `transactionId` on the request:
              `MoneyRequest.updateOne({ _id: id }, { $set: { transactionId: txn._id } }, { session })`.
       - On success:
         - Finalize idempotency record: `state: "DONE"`, `responseStatus: 200`, `responseBody: { message: "Request paid", transactionId: txn._id.toString(), balance: payerWallet.balance }`.
         - Return 200 `{ message: "Request paid", transactionId: txn._id.toString(), balance: payerWallet.balance }`.
       - On error:
         - Clean up `ownedRecord` via `findByIdAndDelete(ownedRecord._id)` so failed payments (e.g. 400 Insufficient balance) can be retried.
         - Return appropriate error status and JSON.
  </action>
  <verify>
    node -r dotenv/config -e "import('./kaasupay-backend/controllers/requestController.js').then(c => { if (!c.payRequest) throw new Error('Missing payRequest'); console.log('payRequest export verified'); });"
  </verify>
  <done>
    `payRequest` handler exported from `requestController.js`.
  </done>
</task>

<task type="auto">
  <name>Mount pay route in requestRoutes</name>
  <files>
    kaasupay-backend/routes/requestRoutes.js
  </files>
  <action>
    In `kaasupay-backend/routes/requestRoutes.js`:
    - Import `payRequest` from `../controllers/requestController.js`.
    - Import `moneyRateLimiter` from `../middleware/rateLimiter.js`.
    - Mount `router.post("/:id/pay", requireAuth, moneyRateLimiter, payRequest);`.
  </action>
  <verify>
    node -r dotenv/config -e "import('./kaasupay-backend/routes/requestRoutes.js').then(() => console.log('requestRoutes with pay route compiled'));"
  </verify>
  <done>
    Route `POST /api/v1/requests/:id/pay` mounted.
  </done>
</task>

<task type="auto">
  <name>Create and run Level 3 & Level 4 (D3 & D4) acceptance test suite</name>
  <files>
    kaasupay-backend/test/phase4_pay_request.test.js
  </files>
  <action>
    Create acceptance test `kaasupay-backend/test/phase4_pay_request.test.js` validating:
    1. Raju pays D1 request with valid PIN -> 200 `{"message":"Request paid","transactionId":"...","balance":450000}`.
    2. Same call, same key -> 200 cached replay (no second debit, no double payment).
    3. Same call, NEW key -> 409 `{"message":"This request is already PAID"}`.
    4. Verify balances: Raju has 450000, Priya has 50000.
    5. Priya: `GET /requests/outgoing` -> status is "PAID".
    6. Priya tries to pay her own request -> 403 `{"message":"Only the person asked can pay this request"}`.
    7. Wrong PIN -> 403 `{"message":"Wrong PIN. 2 tries left","triesLeft":2}`. Key is not consumed.
    8. Transaction note verification: shows `"Request: Dinner at Murugan Idli"`.
    9. D4 insufficient balance test: Priya requests ₹9,000 (900000 paise). Raju has ₹4,500. Raju pays -> 400 `{"message":"Insufficient balance"}`.
    10. Verify request status is still "PENDING" and Raju's balance is unchanged (450000).
    11. Deposit ₹10,000 to Raju via staff deposit. Raju pays again -> 200 `{"message":"Request paid", ...}`.
    12. Priya requests ₹1,000. Raju tries to pay -> 400 Daily limit reached (`{"message":"Daily limit reached", ...}`). Request stays "PENDING".
    13. Reconcile check: `GET /api/v1/admin/reconcile` reports `moneyIsConserved === true`.
  </action>
  <verify>
    node test/phase4_pay_request.test.js
  </verify>
  <done>
    All D3 and D4 acceptance tests pass with 0 failures.
  </done>
</task>

## Success Criteria
- [ ] `payRequest` handler implemented with transactional integrity and idempotency.
- [ ] Route mounted at `POST /api/v1/requests/:id/pay`.
- [ ] D3 and D4 test suite passes with full conservation of money.
