---
phase: 6
plan: 1
wave: 1
gap_closure: false
---

# Plan 6.1: Frontend Integration, Comprehensive Regression & Deliverables

## Objective
Build and integrate frontend Request Money user flows, create the canonical unified backend test suite (`test/day7.test.js`), author `DAY7_ANSWERS.md` addressing all 12 interview questions from Part E, and verify complete backend and frontend regression passes.

## Context
Load these files for context:
- .gsd/SPEC.md
- kaasupay-backend/routes/requestRoutes.js
- kaasupay-frontend/src/services/walletService.js
- kaasupay-frontend/src/pages/DashboardPage.jsx
- kaasupay-frontend/src/components/PinModal.jsx

## Tasks

<task type="auto">
  <name>Author comprehensive DAY7_ANSWERS.md</name>
  <files>
    DAY7_ANSWERS.md
  </files>
  <action>
    Create `DAY7_ANSWERS.md` at root addressing all 12 interview questions from Part E of Day 7 PDF in deep technical detail:
    1. Draw state machine for money request. Which states are final, and why must final states never change?
    2. Requester cancels and payer pays at the exact same moment. Walk through code step-by-step; why can only one win?
    3. Why is reading request, checking status, then updating wrong, even if tests pass?
    4. Why must "mark as PAID" and "move money" be in one transaction? What goes wrong in each order if not?
    5. Idempotency-Key already stops double payments; why do we also need PENDING to PAID check?
    6. How does lazy expiry work? Why does it fit Vercel better than a job running every minute?
    7. Database row says PENDING, but expiresAt was yesterday. Can anyone pay it? Explain why not.
    8. Why return 404, not 403, when stranger asks for someone else's request? When is 403 fine?
    9. Why is PIN checked before idempotency record is created, and why is PIN never part of request hash?
    10. Explain compound index for incoming list and why its fields are in that order.
    11. "At most 5 pending requests to one person" is check-then-act. Why acceptable here, but never for balance?
    12. Split ₹1,000 between 3 people in paise. How to make sure parts add up exactly?
  </action>
  <verify>
    Test that DAY7_ANSWERS.md exists and covers all 12 questions.
  </verify>
  <done>
    `DAY7_ANSWERS.md` authored.
  </done>
</task>

<task type="auto">
  <name>Create canonical unified test/day7.test.js</name>
  <files>
    kaasupay-backend/test/day7.test.js
  </files>
  <action>
    Create unified `kaasupay-backend/test/day7.test.js` aggregating tests across all levels:
    - Level 1 / D1: Request creation, incoming and outgoing inboxes, stranger 404, self-request 400.
    - Level 2 / D2: Decline (payer), cancel (requester), duplicate decline/cancel 409, stranger 404, wrong party 403.
    - Level 3 / D3: Payment with PIN, idempotency replay (same key), duplicate payment lockout (new key 409), balance updates, ledger records, wrong PIN 403.
    - Level 4 / D4: Insufficient balance 400 with PENDING preservation, daily limit 400 with PENDING preservation, successful payment after top-up.
    - Level 4 / D5: Lazy expiry returns 410 on pay/decline/cancel, list queries show EXPIRED.
    - Level 5 / D6: 5-pending requests spam limit (6th gets 409), decline frees capacity, 20/hr rate limit.
    - Bonus 8 Concurrency Race: Simultaneous Pay vs Cancel race test.
    - Day 3 Reconcile check: moneyIsConserved === true, 0 mismatches.
  </action>
  <verify>
    node test/day7.test.js
  </verify>
  <done>
    All assertions in unified `test/day7.test.js` pass with 0 failures.
  </done>
</task>

<task type="auto">
  <name>Integrate Request Money into frontend</name>
  <files>
    kaasupay-frontend/src/services/walletService.js
    kaasupay-frontend/src/pages/DashboardPage.jsx
  </files>
  <action>
    1. In `kaasupay-frontend/src/services/walletService.js`:
       - Export `createMoneyRequest({ to, amount, note })`
       - Export `getIncomingRequests(status)`
       - Export `getOutgoingRequests(status)`
       - Export `declineMoneyRequest(id)`
       - Export `cancelMoneyRequest(id)`
       - Export `payMoneyRequest(id, { pin, idempotencyKey })`
    2. In `kaasupay-frontend/src/pages/DashboardPage.jsx`:
       - Add state and UI for incoming money requests (with Pay button opening PIN modal, and Decline button).
       - Add state and UI for outgoing money requests (with status badge and Cancel button for pending requests).
       - Add "Request Money" action/modal allowing users to search recipients, enter amount, note, and submit.
    3. Run frontend lint and build to ensure 0 errors.
  </action>
  <verify>
    cmd.exe /c "npm run lint"
    cmd.exe /c "npm run build"
  </verify>
  <done>
    Frontend builds and lints with 0 errors.
  </done>
</task>

<task type="auto">
  <name>Run full regression test battery</name>
  <files>
    kaasupay-backend/test/day2.test.js
    kaasupay-backend/test/day3.test.js
    kaasupay-backend/test/day4.test.js
    kaasupay-backend/test/day5.test.js
    kaasupay-backend/test/day6.test.js
    kaasupay-backend/test/day7.test.js
    kaasupay-backend/test/withdrawal_root_cause_and_recovery.test.js
    kaasupay-backend/test/integrated_worker.test.js
  </files>
  <action>
    Run all backend test suites sequentially and verify 100% pass rate.
  </action>
  <verify>
    All test suites exit code 0.
  </verify>
  <done>
    Zero regression across all days.
  </done>
</task>

## Success Criteria
- [ ] `DAY7_ANSWERS.md` authored.
- [ ] Unified `test/day7.test.js` passes.
- [ ] Frontend Request Money UI integrated, lints, and builds cleanly.
- [ ] Full backend regression test battery passes.
