---
phase: 2
plan: 1
wave: 1
gap_closure: false
---

# Plan 2.1: Request Creation & Inbox Listing (Level 1 / D1)

## Objective
Implement request money creation (`POST /api/v1/requests`), inbox listing for incoming requests (`GET /api/v1/requests/incoming`), outgoing requests (`GET /api/v1/requests/outgoing`), and single request retrieval (`GET /api/v1/requests/:id`), with user name resolution, validation, self-request prevention, and stranger 404 isolation.

## Context
Load these files for context:
- .gsd/SPEC.md
- kaasupay-backend/models/moneyRequestModel.js
- kaasupay-backend/validations/requestValidation.js
- kaasupay-backend/routes/index.js
- kaasupay-backend/middleware/authMiddleware.js
- kaasupay-backend/models/userModel.js

## Tasks

<task type="auto">
  <name>Implement requestController with creation and listing handlers</name>
  <files>
    kaasupay-backend/controllers/requestController.js
  </files>
  <action>
    Create `kaasupay-backend/controllers/requestController.js`:
    1. Helper `formatUserName(user)` returns `${user.firstName || ""} ${user.lastName || ""}`.trim().
    2. `createRequest`:
       - Parse body using `createRequestSchema`. If invalid -> 400 `{ message: "Invalid inputs", error: "Invalid inputs" }`.
       - Check `req.body.to === req.userId`: if true -> 400 `{ message: "You can't request money from yourself" }`.
       - Query payer `User.findById(to)`. If missing -> 404 `{ message: "User not found" }`.
       - Anti-spam guard: `MoneyRequest.countDocuments({ requesterId: req.userId, payerId: to, status: "PENDING" }) >= 5` -> 409 `{ message: "You already have 5 pending requests to this person" }`.
       - Calculate `expiresAt` = `new Date(Date.now() + REQUEST_EXPIRY_DAYS * 24 * 60 * 60 * 1000)`.
       - Save `MoneyRequest.create({ requesterId: req.userId, payerId: to, amount, note, expiresAt, status: "PENDING" })`.
       - Return 201:
         `{ message: "Request sent", request: { id: doc._id, to: formatUserName(payer), amount: doc.amount, note: doc.note, status: doc.status, expiresAt: doc.expiresAt } }`.
    3. `getIncomingRequests`:
       - Lazy-expire overdue: `await MoneyRequest.updateMany({ payerId: req.userId, status: "PENDING", expiresAt: { $lte: new Date() } }, { $set: { status: "EXPIRED" } })`.
       - Build filter: `{ payerId: req.userId }`. If `req.query.status`, add `status: req.query.status`.
       - Query `find(filter).sort({ createdAt: -1 }).limit(20).populate("requesterId", "firstName lastName")`.
       - Map to `{ id: doc._id, from: formatUserName(doc.requesterId), amount: doc.amount, note: doc.note, status: doc.status, createdAt: doc.createdAt, expiresAt: doc.expiresAt }`.
       - Return 200 `{ requests: [...] }`.
    4. `getOutgoingRequests`:
       - Lazy-expire overdue: `await MoneyRequest.updateMany({ requesterId: req.userId, status: "PENDING", expiresAt: { $lte: new Date() } }, { $set: { status: "EXPIRED" } })`.
       - Build filter: `{ requesterId: req.userId }`. If `req.query.status`, add `status: req.query.status`.
       - Query `find(filter).sort({ createdAt: -1 }).limit(20).populate("payerId", "firstName lastName")`.
       - Map to `{ id: doc._id, to: formatUserName(doc.payerId), amount: doc.amount, note: doc.note, status: doc.status, createdAt: doc.createdAt, expiresAt: doc.expiresAt }`.
       - Return 200 `{ requests: [...] }`.
    5. `getRequestById`:
       - Validate `mongoose.isValidObjectId(req.params.id)`. If invalid -> 404 `{ message: "Request not found" }`.
       - Query `findById(req.params.id).populate("requesterId", "firstName lastName").populate("payerId", "firstName lastName")`.
       - If not found or if user is neither requester nor payer -> 404 `{ message: "Request not found" }`.
       - Check if status is PENDING and expired: if `doc.expiresAt <= new Date()`, lazy update status to EXPIRED.
       - Return 200 with formatted request details.
    AVOID: Returning 403 when a stranger accesses a request by ID (use 404 to avoid leaking existence).
    USE: Exact response message keys matching Day 7 PDF Part D1.
  </action>
  <verify>
    node -e "import('./kaasupay-backend/controllers/requestController.js').then(c => console.log('requestController exports:', Object.keys(c)));"
  </verify>
  <done>
    `requestController.js` exports `createRequest`, `getIncomingRequests`, `getOutgoingRequests`, and `getRequestById`.
  </done>
</task>

<task type="auto">
  <name>Create requestRoutes and mount at /api/v1/requests</name>
  <files>
    kaasupay-backend/routes/requestRoutes.js
    kaasupay-backend/routes/index.js
  </files>
  <action>
    1. Create `kaasupay-backend/routes/requestRoutes.js`:
       - Define rate limiter for request creation (20/hr per user) using `rateLimit` middleware.
       - Mount:
         - `POST /` -> `requireAuth`, `requestCreateLimiter`, `createRequest`
         - `GET /incoming` -> `requireAuth`, `getIncomingRequests`
         - `GET /outgoing` -> `requireAuth`, `getOutgoingRequests`
         - `GET /:id` -> `requireAuth`, `getRequestById`
    2. In `kaasupay-backend/routes/index.js`:
       - Import `requestRoutes` and mount `router.use("/requests", requestRoutes)`.
    AVOID: Omitting `requireAuth` on any request route.
    USE: Existing `rateLimit` middleware from `middleware/rateLimiter.js`.
  </action>
  <verify>
    node -e "import('./kaasupay-backend/routes/index.js').then(() => console.log('Routes index mounted /requests successfully'));"
  </verify>
  <done>
    `/api/v1/requests` router is cleanly mounted in Express route tree.
  </done>
</task>

<task type="auto">
  <name>Create and run Level 1 / D1 test suite</name>
  <files>
    kaasupay-backend/test/phase2_request_creation.test.js
  </files>
  <action>
    Create standalone acceptance test `kaasupay-backend/test/phase2_request_creation.test.js` testing:
    1. Priya creates request to Raju for ₹500 (50000 paise) with note "Dinner at Murugan Idli" -> 201 with `to: "Raju K"`, status PENDING, expiresAt 7 days out.
    2. Raju queries `GET /api/v1/requests/incoming` -> 200 with request having `from: "Priya S"`.
    3. Priya queries `GET /api/v1/requests/outgoing` -> 200 with request having `to: "Raju K"`.
    4. Kavi (stranger) queries `GET /api/v1/requests/:id` -> 404 `{"message":"Request not found"}`.
    5. Querying invalid ObjectId -> 404 (no server crash).
    6. Self-request (`to === req.userId`) -> 400 `{"message":"You can't request money from yourself"}`.
    7. Invalid amount (<100 paise) -> 400.
    8. Request to non-existent user -> 404.
  </action>
  <verify>
    node kaasupay-backend/test/phase2_request_creation.test.js
  </verify>
  <done>
    All D1 assertions pass with 0 failures and 0 regressions.
  </done>
</task>

## Success Criteria
- [ ] `createRequest`, `getIncomingRequests`, `getOutgoingRequests`, and `getRequestById` implemented.
- [ ] Routes mounted at `/api/v1/requests`.
- [ ] D1 test suite passes completely.
