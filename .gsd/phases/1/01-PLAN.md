---
phase: 1
plan: 1
wave: 1
gap_closure: false
---

# Plan 1.1: Data Model, Configuration & Input Validation Foundation

## Objective
Establish the foundational data structures, compound indexes, configuration settings, and Zod input validation schemas for Day 7 Request Money according to the official specification.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/ARCHITECTURE.md
- kaasupay-backend/config.js
- kaasupay-backend/models/transactionModel.js
- kaasupay-backend/validations/paymentValidation.js

## Tasks

<task type="auto">
  <name>Create MoneyRequest Mongoose model and update config</name>
  <files>
    kaasupay-backend/models/moneyRequestModel.js
    kaasupay-backend/config.js
  </files>
  <action>
    1. In `kaasupay-backend/config.js`:
       - Export `REQUEST_EXPIRY_DAYS = 7`.
    2. In `kaasupay-backend/models/moneyRequestModel.js`:
       - Define `moneyRequestSchema` with:
         - `requesterId`: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
         - `payerId`: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
         - `amount`: { type: Number, required: true, min: 100, max: 1000000 }
         - `note`: { type: String, maxlength: 100, default: null }
         - `status`: { type: String, enum: ["PENDING", "PAID", "DECLINED", "CANCELLED", "EXPIRED"], default: "PENDING" }
         - `expiresAt`: { type: Date, required: true }
         - `transactionId`: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", default: null }
         - `decidedAt`: { type: Date, default: null }
         - `timestamps: true`
       - Define compound indexes matching Part B & A9 of Day 7 PDF:
         - `{ payerId: 1, status: 1, createdAt: -1 }` (incoming inbox)
         - `{ requesterId: 1, status: 1, createdAt: -1 }` (outgoing inbox)
         - `{ requesterId: 1, payerId: 1, status: 1 }` (anti-spam 5-pending limit)
       - Export default `mongoose.model("MoneyRequest", moneyRequestSchema)`.
    AVOID: Using `{ new: true }` or adding custom hooks that mutate status outside transactions.
    USE: Explicit enum values and compound indexes.
  </action>
  <verify>
    node -e "import('./kaasupay-backend/models/moneyRequestModel.js').then(() => console.log('MoneyRequest model loaded successfully')); import('./kaasupay-backend/config.js').then(c => console.log('REQUEST_EXPIRY_DAYS:', c.REQUEST_EXPIRY_DAYS));"
  </verify>
  <done>
    `moneyRequestModel.js` and `REQUEST_EXPIRY_DAYS` import cleanly with schema definitions and indexes intact.
  </done>
</task>

<task type="auto">
  <name>Create Zod request validation schemas</name>
  <files>
    kaasupay-backend/validations/requestValidation.js
  </files>
  <action>
    1. In `kaasupay-backend/validations/requestValidation.js`:
       - Define helper validating MongoDB ObjectId format (24 hex characters).
       - Define `createRequestSchema`:
         - `to`: valid ObjectId string (required)
         - `amount`: integer number, min 100 (₹1), max 1,000,000 (₹10,000)
         - `note`: optional string, max 100 characters (trimmed, nullable)
       - Define `payRequestSchema`:
         - `pin`: string matching `/^\d{4}$|^\d{6}$/` ("PIN must be 4 or 6 digits")
       - Define `requestParamsSchema`:
         - `id`: valid ObjectId string
    AVOID: Permitting non-integer paise or amounts outside 100-1,000,000.
    USE: Strict schemas that reject unrecognized fields where applicable.
  </action>
  <verify>
    node -e "import('./kaasupay-backend/validations/requestValidation.js').then(v => { const res = v.createRequestSchema.safeParse({ to: '507f1f77bcf86cd799439011', amount: 50000, note: 'Dinner' }); if (!res.success) throw new Error(); console.log('Validation schema verified'); });"
  </verify>
  <done>
    Zod schemas correctly accept valid request inputs and reject out-of-bound amounts, invalid ObjectIds, or weak PIN formats.
  </done>
</task>

<task type="auto">
  <name>Create Phase 1 unit test and verify foundation</name>
  <files>
    kaasupay-backend/test/phase1_model_validation.test.js
  </files>
  <action>
    Create a standalone test script `test/phase1_model_validation.test.js` that tests:
    1. Schema validation: default status is PENDING, amount bounds (100 to 1M paise), note truncation/nullability.
    2. Compound indexes registered on schema.
    3. `createRequestSchema` accepts valid inputs and rejects invalid `to` ObjectId, fractional amounts, negative amounts, <100 paise, >1M paise, note > 100 chars.
    4. `payRequestSchema` validates 4-digit and 6-digit PINs, and rejects 3-digit, 5-digit, or non-numeric PINs.
    5. Configuration export `REQUEST_EXPIRY_DAYS === 7`.
  </action>
  <verify>
    node kaasupay-backend/test/phase1_model_validation.test.js
  </verify>
  <done>
    All assertions in `phase1_model_validation.test.js` pass with 0 failures.
  </done>
</task>

## Success Criteria
- [ ] `MoneyRequest` model created with exact schema and compound indexes.
- [ ] `REQUEST_EXPIRY_DAYS = 7` exported in `config.js`.
- [ ] Zod schemas created and enforcing business boundaries.
- [ ] Automated test suite verifies Phase 1 foundation.
