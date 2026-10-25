# KaasuPay — Frontend Application

Modern, high-integrity digital wallet client application built with React 19, Vite, Tailwind CSS v4, Redux Toolkit, Framer Motion, and Three.js / React Three Fiber.

---

## 1. Project Purpose & Architecture

KaasuPay Frontend is designed with strict financial guarantees:
- **Zero Floating-Point Imprecision**: All wallet amounts are represented, computed, and transferred as **integer paise** (1 Rupee = 100 paise), matching backend ledger contracts.
- **Atomic Operations**: P2P transfers and gateway top-ups provide immediate, verifiable ledger state.
- **Idempotency Protection**: Client generates unique RFC-compliant idempotency keys for money transfers to prevent accidental duplicate debits on retries or double-taps.
- **Centralized Security**:
  - JWT tokens are automatically attached to outgoing API requests via Axios interceptors.
  - 401 Unauthorized errors trigger an event-driven clean session tear-down and redirect without recursive loops.
  - Private credentials (e.g. Razorpay Key Secret, Webhook Secret, Admin Key, JWT secret) are **never** bundled or exposed to client-side code. Only the public Razorpay Key ID is exposed when checkout is initialized.

---    

## 2. Visual Direction & Design System

KaasuPay features an original modern fintech visual language:
- **Surfaces**: Crisp white surfaces (`#FFFFFF`, `#F8FAFC`, `#F1F5F9`) with subtle slate borders and soft shadows.
- **Typography**: Deep navy typography (`#0A192F`, `#0F172A`) powered by Google Fonts (`Plus Jakarta Sans` and `JetBrains Mono`).
- **Primary Actions**: High-contrast cobalt blue (`#2563EB`, `#1D4ED8`, `#1E40AF`).
- **Restrained Accents**: Soft lavender accents (`#818CF8`, `#EEF2FF`, `#E0E7FF`).
- **Financial Status Indicators**: Emerald green (`#10B981`) for credits and incoming funds; rose red (`#F43F5E`) for debits; amber (`#F59E0B`) for pending states.
- **3D Visual Experience**: A lightweight, custom React Three Fiber 3D floating digital card on the landing page, lazy-loaded with WebGL detection and an accessible static SVG/CSS fallback.
- **Accessibility & Motion**: Fully supports keyboard navigation, visible focus rings (`:focus-visible`), and respects `@media (prefers-reduced-motion: reduce)`.

---

## 3. Technology Stack

| Layer | Technology | Version |
|---|---|---|
| **Core Framework** | React + React DOM | `^19.3.1` |
| **Build & Bundler** | Vite | `^8.3.4` |
| **Styling** | Tailwind CSS v4 + `@tailwindcss/vite` | `^4.3.3` |
| **State Management**| Redux Toolkit + React-Redux | `^2.13.0` / `^9.3.0` |
| **Routing** | React Router DOM | `^7.18.4` |
| **HTTP Client** | Axios | `^1.20.0` |
| **Animations** | Framer Motion | `^14.6.0` |
| **3D Rendering** | Three.js + React Three Fiber + Drei | `^0.186.1` / `^9.8.2` / `^10.7.9` |
| **Icons** | Lucide React | `^1.61.0` |
| **Validation** | React Hook Form + Zod | `^7.90.0` / `^4.6.7` |

---

## 4. Folder Structure

```text
kaasupay-frontend/
├── public/
├── src/
│   ├── components/
│   │   ├── 3d/
│   │   │   ├── WalletCanvas.jsx       # Lazy WebGL wrapper with fallback
│   │   │   ├── WalletScene.jsx        # Lightweight Three.js floating metallic card
│   │   │   └── WalletFallback.jsx     # Non-WebGL CSS/SVG fallback card
│   │   ├── common/
│   │   │   ├── ErrorBoundary.jsx      # Safe runtime failure fallback
│   │   │   └── ProtectedRoute.jsx     # Protected and public route guards
│   │   ├── layout/
│   │   │   ├── Navbar.jsx             # Top bar with balance pill & mobile drawer
│   │   │   ├── Footer.jsx             # Semantic footer with ledger guarantees
│   │   │   ├── PublicLayout.jsx       # Public page layout
│   │   │   ├── AuthLayout.jsx         # Card-focused auth layout
│   │   │   └── DashboardLayout.jsx    # Authenticated sidebar layout
│   │   └── ui/
│   │       ├── Alert.jsx              # Status alert banners
│   │       ├── AmountDisplay.jsx      # Integer paise currency formatter
│   │       ├── Badge.jsx              # Credit/debit/status pills
│   │       ├── Button.jsx             # Primary cobalt, secondary, lavender variants
│   │       ├── Card.jsx               # Compound card component
│   │       ├── Dialog.jsx             # Accessible modal with Framer Motion
│   │       ├── Input.jsx              # Accessible form input with error states
│   │       ├── Spinner.jsx            # Loading spinner & skeleton shimmer
│   │       └── Toast.jsx              # Redux-powered toast notifications
│   ├── pages/
│   │   ├── LandingPage.jsx            # Hero, 3D card canvas, architecture pillars
│   │   ├── SignInPage.jsx             # Authenticated login
│   │   ├── SignUpPage.jsx             # Registration and wallet creation
│   │   ├── DashboardPage.jsx          # Live balance widget & recent activity
│   │   ├── TransferPage.jsx           # Idempotent P2P transfer
│   │   ├── AddMoneyPage.jsx           # Razorpay top-up order
│   │   ├── TransactionsPage.jsx       # Paginated audit ledger history table
│   │   └── NotFoundPage.jsx           # 404 handler
│   ├── services/
│   │   ├── api.js                     # Centralized Axios instance (401 interceptor)
│   │   ├── authService.js             # User & auth API methods
│   │   └── walletService.js           # Wallet, transfer, add-money API methods
│   ├── store/
│   │   ├── index.js                   # Redux Toolkit store assembly
│   │   ├── hooks.js                   # useAuth, useWallet, useTransactions, useToast
│   │   └── slices/
│   │       ├── authSlice.js           # Session token & user state
│   │       ├── walletSlice.js         # Balance & transfer execution state
│   │       ├── transactionSlice.js    # Paginated ledger history state
│   │       └── uiSlice.js             # Toast notifications & navigation state
│   ├── utils/
│   │   ├── currency.js                # Paise-to-Rupee formatting & conversion
│   │   └── idempotency.js             # Client idempotency key generator
│   ├── App.jsx                        # Clean router and layout composition
│   ├── index.css                      # Tailwind v4 theme tokens & base styles
│   └── main.jsx                       # Provider mounting and entry point
├── .env                               # Local configuration
├── .env.example                       # Template for environment variables
├── package.json
└── vite.config.js
```

---

## 5. Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

`.env`:
```env
# API Base URL for backend communication
VITE_API_BASE_URL=http://localhost:3000

# Public Razorpay Key ID for Test Mode checkout orders only
VITE_RAZORPAY_KEY_ID=rzp_test_yourKeyId
```

> **Security Note**: Never expose Razorpay Key Secret, Webhook Secret, or staff `ADMIN_KEY` in frontend environment variables.

---

## 6. Running Locally

### Development Server
```bash
npm run dev
```

### Production Build & Linting
```bash
npm run lint
npm run build
npm run preview
```

---

## 7. Performance & Bundle Optimization

To ensure blazing-fast initial load times and keep dashboard routes lightweight:
- **Route-Level Code Splitting**: All pages (`LandingPage`, `DashboardPage`, `TransferPage`, `AddMoneyPage`, `TransactionsPage`, `SignInPage`, `SignUpPage`, `NotFoundPage`) are loaded asynchronously via `React.lazy()` and `Suspense`.
- **Three.js Isolation**: `three`, `@react-three/fiber`, and `@react-three/drei` are quarantined into a dedicated `three-vendor` chunk (~918 kB uncompressed, 244 kB gzip). Dashboard routes (`/dashboard`, `/transfer`, `/transactions`, `/add-money`) never download this chunk.
- **Main Bundle Reduction**: Main client entry bundle was reduced from **1.47 MB** to **334 kB** (105 kB gzip).
- **Vendor Chunking**: Lucide icons, Framer Motion, and Redux Toolkit are segmented into cache-friendly chunks (`lucide-vendor`, `motion-vendor`, `redux-vendor`).

---

## 8. Backend Contract Verification

| API Route | Verified Payload / Schema | Frontend Service Method | Verification Status |
|---|---|---|---|
| `POST /api/v1/user/signup` | `{ username, firstName, lastName, password }` | `authService.signup(data)` | Aligned (enforces required `lastName`) |
| `POST /api/v1/user/signin` | `{ username, password }` | `authService.signin(data)` | Aligned (returns `token`, sets `localStorage`) |
| `GET /api/v1/user/me` | Bearer JWT header | `authService.getMe()` | Aligned (unwraps `{ user: { ... } }`) |
| `GET /api/v1/wallet/balance` | Bearer JWT header | `walletService.getBalance()` | Aligned (`{ balance, display }` integer paise) |
| `POST /api/v1/wallet/transfer` | `Idempotency-Key` header, `{ to, amount, note }` | `walletService.transferFunds(...)` | Aligned (100–1,000,000 paise bounds) |
| `GET /api/v1/wallet/transactions` | Query params `page`, `limit` | `walletService.getTransactions(...)` | Aligned (`{ data, page, limit, total, totalPages }`) |
| `POST /api/v1/wallet/add-money/order` | `{ amount }` (1,000–1,000,000 paise) | `walletService.createAddMoneyOrder(amt)` | Aligned (returns `{ orderId, amount, keyId }`) |
| `GET /api/v1/wallet/add-money/orders/:id` | Bearer JWT header | `walletService.getAddMoneyOrderStatus(id)` | Aligned (returns `{ orderId, status, paidVia }`) |
| `POST /api/v1/wallet/add-money/verify` | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` | `walletService.verifyAddMoneyPayment(...)` | Aligned (returns `{ message, balance }`) |
| **Razorpay SDK** | Dynamic script injection & Key ID | `loadRazorpayScript()` | Aligned (resolves CDN script with fallback) |
| `POST /api/v1/wallet/bank-accounts` | `{ holderName, accountNumber, ifsc }` | `walletService.addBankAccount(data)` | Aligned (returns masked account `XXXXXX1234`) |
| `GET /api/v1/wallet/bank-accounts` | Bearer JWT header | `walletService.getBankAccounts()` | Aligned (returns `{ accounts: [...] }`) |
| `POST /api/v1/wallet/withdraw` | `Idempotency-Key` header, `{ bankAccountId, amount }` | `walletService.withdrawFunds(data, key)` | Aligned (202 Accepted, atomic hold, outbox event) |
| `GET /api/v1/wallet/withdrawals` | Bearer JWT header | `walletService.getWithdrawals()` | Aligned (returns last 20 user withdrawals) |
| `GET /api/v1/wallet/withdrawals/:id` | Bearer JWT header | `walletService.getWithdrawalById(id)` | Aligned (status polling: PENDING, SUCCESS, REVERSED, NEEDS_REVIEW) |
| `POST /api/v1/user/pin` | `{ password, pin }` | `authService.setPin(data)` | Aligned (bcrypt-hashed 4/6-digit PIN with strength checks) |
| `POST /api/v1/user/logout-all` | Bearer JWT header | `authService.logoutAll()` | Aligned (invalidates all devices by incrementing `tokenVersion`) |
| `GET /api/v1/wallet/limits` | Bearer JWT header | `walletService.getLimits()` | Aligned (authoritative tracking of ₹10,000 daily outgoing cap) |
| `POST /api/v1/wallet/transfer` | `Idempotency-Key`, `{ to, amount, note, pin }` | `walletService.transferFunds(...)` | Aligned (requires valid PIN, preserves idempotency on retries) |
| `POST /api/v1/wallet/withdraw` | `Idempotency-Key`, `{ bankAccountId, amount, pin }` | `walletService.withdrawFunds(...)` | Aligned (requires valid PIN before creating 202 outbox hold) |

---

## 9. Checkpoint 6: Landing Page, Authentication Screens & Live Integration

### Implemented Features
1. **Original Fintech Landing Page (`LandingPage.jsx`)**:
   - **Hero Section**: Strong typography with headline *"Digital Money Engineered with Ledger Precision"*, clear value proposition, primary CTA (*"Create Free Wallet"*), secondary CTA (*"Explore Architecture"*), and security badge guarantee pill.
   - **Lazy 3D Visual (`WalletCanvas.jsx`)**: Custom floating metallic 3D card visual using React Three Fiber with dynamic light reflection, wrapped in WebGL detection and seamless static CSS/SVG fallback (`WalletFallback.jsx`).
   - **Core Architectural Pillars (`#features`)**: Explains atomic balance mutations, cryptographic idempotency keys, real-time audit ledger, and multi-tier security.
   - **How It Works (`#how-it-works`)**: 3-step workflow (Create Wallet -> Load or Deposit -> Transfer & Reconcile).
   - **Mathematical Conservation & Guarantees (`#guarantees`)**: Highlights zero floating-point math, 100% money conservation, and uncompromised privacy (no plain passwords or exposed secrets).
   - **Closing CTA & Footer**: High-conversion closing banner and professional footer with navigation and legal disclosures. No fabricated metrics, testimonials, or misleading badges.
   - **Navigation Integration**: Smooth scroll anchors (`#features`, `#how-it-works`, `#guarantees`) on the Navbar for unauthenticated visitors, with direct dashboard/balance access when authenticated.

2. **Sign In Screen (`SignInPage.jsx`)**:
   - Integrated with Redux `loginUser` async thunk and backend `POST /api/v1/user/signin`.
   - Field-level validation for username (valid email) and required password.
   - Password show/hide visibility toggle with accessible `aria-label`.
   - Button loading state with spinner and submission lockout preventing duplicate submissions.
   - Server error banner (`Alert`) displaying exact backend rejection reason.
   - Open-redirect protection: checks `redirect` query parameter to ensure it is a safe internal path (`startsWith('/') && !startsWith('//')`), defaulting to `/dashboard`.
   - Automatic redirection away from the page if already authenticated.

3. **Sign Up Screen (`SignUpPage.jsx`)**:
   - Integrated with Redux `registerUser` async thunk and backend `POST /api/v1/user/signup`.
   - Field-level validation for `firstName`, `lastName`, `username` (email), and `password` (minimum 6 characters).
   - Password show/hide toggle.
   - Prevents duplicate clicks while registration is pending.
   - On successful registration, automatically logs the user in, fetches the initial wallet state, and redirects to `/dashboard`.
   - Displays server error banner (e.g. 409 conflict when email is already registered).

4. **Live Backend Integration Verified**:
   - Live signup of a new user: creates real user document and wallet initialized to 0 paise in MongoDB.
   - Duplicate user signup: rejected by backend with 409 Conflict and displayed cleanly in UI alert.
   - Signin with invalid credentials: rejected by backend with 401 Unauthorized generic message.
   - Signin with valid credentials: sets `token` in `localStorage`, updates Redux auth state, loads user profile via `GET /api/v1/user/me`, loads wallet balance via `GET /api/v1/wallet/balance`.
   - Page refresh: `App.jsx` restores session via stored token and verifies identity against `GET /api/v1/user/me`.
   - Sign out: clears token and user profile, resets wallet state, redirects safely.

---

## 10. Checkpoint 7: Core Wallet Dashboard & Add-Money Flow

### Implemented Features
1. **Real Wallet Dashboard (`DashboardPage.jsx`)**:
   - **Real User Balance**: Directly displays the authenticated user's wallet balance using `AmountDisplay` with integer paise precision and double-entry ledger guarantees.
   - **Quick Actions**: Prominent `Send Money` (navigating to `/transfer`) and `Add Money` (navigating to `/add-money`) actions.
   - **Ledger Synchronization**: "Sync Ledger" action that triggers fresh balance and transaction fetches with live spinner animations.
   - **Error Handling**: Distinct dismissible error alert banners for balance synchronization failures and transaction history retrieval failures, with retry capability.
   - **Verified Member Profile Section**: Displays the user's legal name (`firstName` + `lastName`), registered email login ID, account verification badge, and cryptographic standard pill (`HMAC-SHA256`).
   - **Recent Ledger Activity**: Fetches actual paginated transactions from `GET /api/v1/wallet/transactions?page=1&limit=5`.
   - **Meaningful Empty State**: For accounts without prior transactions, renders an informative empty state explaining how to get started, with a direct CTA to top up funds.
   - **Strict Data Integrity**: Does not fabricate any fake metrics, user counts, or synthetic transactions.

2. **Complete Add-Money Flow (`AddMoneyPage.jsx`)**:
   - **Amount Range Enforced**: Validates inputs to remain strictly within ₹10.00 (1,000 paise) and ₹10,000.00 (1,000,000 paise).
   - **Zero Floating-Point Imprecision**: Converts Rupee inputs using `rupeesToPaise` integer math.
   - **Order Creation**: Calls authenticated `POST /api/v1/wallet/add-money/order` and stores the active order.
   - **Razorpay Checkout Integration**: Dynamically loads the official Razorpay script via `loadRazorpayScript()` with safety fallbacks and opens the modal using the returned public `keyId` and `orderId`.
   - **Cryptographic Signature Verification**: Submits `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature` to authenticated `POST /api/v1/wallet/add-money/verify`.
   - **Wallet Credit Confirmation**: Displays success state *only after* the backend confirms the credit, displaying order ID, payment ID, and credited amount, followed by an immediate wallet balance and transaction history refresh.
   - **Dismissal & Reconcile Handling**:
     - `modal.ondismiss`: When the user dismisses the checkout modal, calls `walletService.getAddMoneyOrderStatus(orderId)`. If the order is `PAID` (processed by webhook), immediately shows success. If `CREATED`, informs the user that no funds were deducted without creating false errors.
     - `rzp.on('payment.failed')`: Captures gateway-level rejections (e.g. issuer declined) and surfaces clean descriptions.
     - **Recheck Payment Status**: When a network timeout occurs during verification, users can click "Recheck Payment Status" to query order status via `GET /api/v1/wallet/add-money/orders/:orderId`. The UI strictly does not treat `CREATED` as a success.
   - **Security Guarantees**: Never credits the wallet from the client; never exposes Razorpay Key Secret, Webhook Secret, or `ADMIN_KEY`.

---

## 11. Checkpoint 8: Peer-to-Peer Transfers & Transaction Ledger History

### Implemented Features
1. **P2P Transfer Page (`TransferPage.jsx`)**:
   - **Live Recipient Search & Autocomplete**: Debounced query via `authService.searchUsers(query)` hitting `GET /api/v1/user/bulk?filter=...`. Excludes current user from search results.
   - **Recipient Identity Confirmation Card**: Once selected, locks the recipient into a verified card displaying their avatar initials, full legal name, email, and a "Change Recipient" button.
   - **Self-Transfer Guard**: Prevents selecting or entering own email, displaying an immediate inline error.
   - **Amount Range & Balance Validation**: Validates transfers between ₹1.00 (100 paise) and ₹10,000.00 (1,000,000 paise). Checks available balance locally before submission to prevent unnecessary rejected requests.
   - **Quick Amount Presets**: Instant selection buttons for ₹50, ₹100, ₹500, ₹1,000, and ₹2,000.
   - **Cryptographic Idempotency Key**: Generated on page load (`crypto.randomUUID()`) and attached to `Idempotency-Key` header. Includes an explicit "Renew" action allowing users to refresh the idempotency token when initiating a separate logical payment.
   - **Safe Submission & Loading States**: Disables inputs and replaces submit button with a spinner during in-flight network transfer.
   - **Transfer Confirmation Receipt**: Renders a dedicated receipt card upon successful execution showing amount sent, recipient name and email, copyable Transaction ID, updated sender balance, and payment note.
   - **Auto-Sync Balance**: Automatically refreshes wallet balance and recent transaction history upon transfer success.

2. **Transaction History & Ledger Audit Screen (`TransactionsPage.jsx`)**:
   - **Direction Filters**: Interactive tab switcher for `All`, `Credits (+)` and `Debits (-)` to filter ledger records dynamically.
   - **Page-Size Selection**: Selector supporting 10, 25, and 50 records per page, synchronizing with backend pagination parameters.
   - **Complete Ledger Audit Attributes**: Table displaying Direction badge (CREDIT in emerald, DEBIT in rose), Counterparty / Source (`withWhom`), Transfer Note, Timestamp, Transaction Amount, Balance After Transaction, and Quick View action.
   - **Accessible Details Modal (`Dialog.jsx`)**: Clicking any row opens an accessible detail dialog showing full transaction metadata:
     - Large directional amount badge.
     - Counterparty name and transaction type (`TRANSFER`, `TOPUP`, `DEPOSIT`).
     - Exact timestamp formatted with date and time.
     - Resulting wallet balance after ledger entry execution.
     - Full Transaction ID and Ledger Entry ID with 1-click clipboard copy buttons.
     - Payment note (if attached).
   - **Resilient UI States**: Skeleton loading state while fetching, friendly empty state with quick action buttons, and error banners with manual retry trigger.

### Verification Results
- **Frontend Code Quality**:
  - `npm run lint`: **0 errors, 0 warnings** across all frontend source files.
  - `npm run build`: **Vite production build succeeded** with all chunks cleanly generated.
- **Backend Test Suite Preserved**:
  - `test/day2.test.js`: **63/63 assertions PASS**.
  - `test/day3.test.js`: **78/78 assertions PASS** (74 Day 3 core + 4 Day 2 regression).
  - `test/day4.test.js`: **128/128 assertions PASS**.
  - **Total 269 backend assertions fully passing.**
- **Live Server Integration Verification (`test/test_checkpoint8_live.js`)**:
  - Registered two disposable test users: `live_sender_...` and `live_recipient_...`.
  - Recipient autocomplete search verified without password hash leaks.
  - Funded sender with ₹500.00 (50,000 paise) via staff deposit.
  - Executed live P2P transfer of ₹150.00 (15,000 paise) with custom `Idempotency-Key` and note.
  - **Conservation Law Confirmed**: Sender balance decreased by exactly 15,000 paise (50,000 -> 35,000). Recipient balance increased by exactly 15,000 paise (0 -> 15,000). Sender Debit === Recipient Credit. Total balance conserved at 50,000 paise.
  - **Idempotency Replay Confirmed**: Replayed exact same transfer payload and `Idempotency-Key`. Received cached 201 response with matching Transaction ID, and zero double debits occurred (balances remained unchanged).
  - **Ledger Audit Confirmed**: Queried `GET /api/v1/wallet/transactions` for both users:
    - Sender ledger shows DEBIT of ₹150.00 with counterparty name, note, and `balanceAfter` ₹350.00.
    - Recipient ledger shows CREDIT of ₹150.00 with counterparty name and `balanceAfter` ₹150.00.


---

## 12. Checkpoint 9: Day 5 — Bank Account Management & Full-Stack Bank Withdrawal Flow

### Implemented Features
1. **Bank Accounts Management (`BankAccountsPage.jsx` - `/bank-accounts`)**:
   - **Saved Accounts Grid**: Renders user's saved bank accounts with masked account numbers (`XXXXXX1234`), uppercase IFSC codes, account holder names, and instant 1-click IFSC clipboard copy.
   - **Interactive 3D Bank Card (`BankCardCanvas.jsx`)**: Elegant, interactive 3D bank card rendered with React Three Fiber, showing dynamic light reflection, metallic texture, gold security chip, embossed cardholder name, and masked number.
   - **Accessible Non-WebGL Fallback (`BankCardFallback.jsx`)**: Automatically detects WebGL support and gracefully renders a high-fidelity SVG/CSS card for low-powered devices or when reduced motion is preferred.
   - **Add Account Modal (`Dialog.jsx`)**:
     - Holder name validation: 2 to 60 characters, trimmed.
     - Account number validation: strictly 9 to 18 digits.
     - IFSC validation: strictly 4 letters, '0', then 6 alphanumeric characters (`^[A-Z]{4}0[A-Z0-9]{6}$`), automatically converted to uppercase.
     - Backend duplicate prevention (HTTP 409 handling).
     - Security badge highlighting AES-256-GCM encryption at rest.

2. **Multi-Step Withdrawal Wizard (`WithdrawPage.jsx` - `/withdraw`)**:
   - **Step 1 — Select Bank Account**:
     - Visual account selector cards displaying bank name, masked account number, holder name, and selection ring.
     - Seamless link to add a new bank account if none exists.
   - **Step 2 — Enter Amount**:
     - Live wallet balance display with real-time balance headroom verification.
     - Strict bounds validation: minimum 10,000 paise (₹100.00) up to maximum 2,500,000 paise (₹25,000.00).
     - Contextual quick-amount presets (₹500, ₹1,000, ₹2,000, ₹5,000, ₹10,000, Max Balance) disabled automatically if they exceed available funds.
   - **Step 3 — Review & Confirm**:
     - High-clarity summary card showing requested withdrawal amount, destination bank account, ₹0.00 fee guarantee, and remaining wallet balance.
     - Explicit disclosure clarifying that bank payouts process asynchronously and do not finish instantly.
     - Cryptographic idempotency key (`crypto.randomUUID()`) preserved across retries of the same withdrawal attempt.
   - **Step 4 — Live Processing & Status Machine**:
     - Responds immediately to HTTP 202 Accepted.
     - Active status polling (`GET /api/v1/wallet/withdrawals/:id`) with automatic timer teardown upon reaching a terminal state.
     - **Confirmed Success (`SUCCESS`)**: Emerald green success card showing Bank UTR reference number, timestamp, and updated wallet balance.
     - **Definitive Refusal (`REVERSED`)**: Rose red reversal card explaining the refusal reason (e.g., account closed), confirming that wallet funds were atomically refunded with a compensating credit ledger entry.
     - **Manual Review (`NEEDS_REVIEW`)**: Amber advisory card explaining that the payout timed out after 5 attempts and has been safely queued for staff verification (no unsafe blind refund).
     - **In-Flight Processing (`PENDING` / `PROCESSING`)**: Cobalt blue spinner clearly indicating that funds are held while the bank payout worker is in progress.

3. **Transaction History Integration (`TransactionsPage.jsx`)**:
   - Filter tabs updated to support **Withdrawals** (`WITHDRAWAL`) and **Refunds** (`REVERSAL`).
   - Distinct badges and icons for bank payouts (outbound debit) and reversals (compensating credit).
   - Display counterparty label as *"Withdrawal to bank"* and *"Refund of failed withdrawal"*.
   - Detail modal shows complete withdrawal metadata, UTR bank reference, and ledger entry IDs.

4. **Dashboard Integration (`DashboardPage.jsx` & Layout)**:
   - Added prominent **Withdraw** action button in the primary wallet balance card.
   - Added **Bank Accounts** and **Withdraw** links to sidebar navigation (`DashboardLayout.jsx`) and header menu (`Navbar.jsx`).
   - Automatic balance synchronization upon withdrawal request and subsequent reversal credit.

5. **State Management & Architecture**:
   - Dedicated Redux slice (`bankSlice.js`) managing bank accounts list, active withdrawal tracking, polling status, and error states.
   - Custom hook `useBank()` providing components with clean access to bank actions.
   - Full TypeScript-grade JSDoc typing across services and helpers.

### Quality & Verification Results
- **Frontend Code Quality**:
  - `npm run lint`: **0 errors, 0 warnings** across all frontend source files.
  - `npm run build`: **Production bundle compiled successfully in 712ms** with optimal chunking.
- **Backend Regression Suite**:
  - `test/day2.test.js`: **63/63 assertions PASS**.
  - `test/day3.test.js`: **78/78 assertions PASS**.
  - `test/day4.test.js`: **128/128 assertions PASS**.
  - `test/day5.test.js`: **75/75 assertions PASS** (D1-D8, Bonus 6 dual-worker concurrency, Bonus 7 AES-256-GCM encryption).
  - **Total 391 backend assertions fully passing across Days 2–6.**


---

## 13. Checkpoint 10: Day 6 — Full-Stack Security, Payment PIN, Daily Limits & Multi-Device Session Controls

### Implemented Features
1. **Payment PIN Management (`SetPinModal.jsx` & `PinModal.jsx`)**:
   - **PIN Creation & Updates**: Users configure a secret 4 or 6-digit payment PIN secured by current account password verification.
   - **Trivial Guess Prevention**: Client and server reject repeated digits (`0000`, `1111`) and common predictable sequences (`1234`, `4321`, `123456`).
   - **Zero Client Leakage**: Plaintext PINs are never stored in `localStorage`, Redux persistence, or idempotency cache. Input fields are strictly masked with optional reveal toggle.
   - **Failed Attempt & Lockout UI**:
     - Returns HTTP `403` with remaining attempts badge: *"Incorrect PIN. 2 attempts remaining before temporary 15-minute lockout"*.
     - Returns HTTP `423` upon 3 consecutive wrong guesses with a live countdown timer (`MM:SS`), disabling input until the lockout expires.
     - Preserves the original `Idempotency-Key` across wrong PIN guesses so retries are safe idempotency replays once the correct PIN is provided.

2. **Send Money PIN Integration (`TransferPage.jsx`)**:
   - Review dialog seamlessly routes to `PinModal` before dispatching transfer.
   - Full idempotency preservation: network timeouts or wrong PINs do not regenerate or discard the key.
   - Displays server-side daily limit exceeded errors (`leftToday`) and rate-limit warnings (`429 Too Many Requests`).

3. **Bank Withdrawal PIN Integration (`WithdrawPage.jsx`)**:
   - Step 3 (Review & Confirm) requires payment PIN verification prior to submitting the `POST /api/v1/wallet/withdraw` request.
   - Smoothly handles HTTP `202 Accepted` transition to status polling.
   - Preserves bank account masking and privacy at all times.

4. **Shared Daily Outgoing Spending Tracker (`DailyLimitCard.jsx`)**:
   - Displays real-time spending progress against the ₹10,000 (1,000,000 paise) daily limit across P2P transfers and bank withdrawals combined.
   - Contextual visual cues: progress bar turns cobalt (<75%), amber (75–90%), and rose (100% limit reached).
   - Shows authoritative remaining balance and Asia/Kolkata midnight reset notice (`18:30 UTC`).
   - Automatically re-synchronizes after transfers and withdrawals.

5. **Multi-Device Session Security & Password Rotation**:
   - **Log Out of All Devices**: Added controls in header navigation (`Navbar.jsx`) and Dashboard (`DashboardPage.jsx`) invoking `POST /api/v1/user/logout-all`, instantly invalidating all tokens.
   - **Password Rotation**: Updating account password revokes old device sessions and smoothly updates client state with the freshly issued JWT token.
   - **Session Expiry Interceptor**: Returns HTTP `401 {"message":"Session ended. Please sign in again"}`, clearing local state and cleanly redirecting to `/signin`.

### Quality & Verification Results
- **Frontend Code Quality**:
  - `npm run lint`: **0 errors, 0 warnings** across all frontend source files.
  - `npm run build`: **Production bundle compiled successfully in 556ms** (Three.js bundle strictly isolated from dashboard and security routes).
- **Backend Regression Suite (Real MongoDB Replica Sets)**:
  - `test/day2.test.js`: **63 / 63 assertions PASS**.
  - `test/day3.test.js`: **78 / 78 assertions PASS**.
  - `test/day4.test.js`: **128 / 128 assertions PASS**.
  - `test/day5.test.js`: **75 / 75 assertions PASS**.
  - `test/day6.test.js`: **47 / 47 assertions PASS** (PIN setup, 3-try lockout, daily limits, rate limits, logout-all, concurrency races).
  - **Total 391 backend assertions fully passing.**

---

## 14. Checkpoint 11: Complete Frontend UX, Visual Design & Motion Overhaul

### Implemented Features
- **Light-First Design System**:
  - Rebuilt typography, spacing, contrast, and surface hierarchy with a light-first aesthetic: white/slate surfaces, deep navy typography (`#0A192F`), and cobalt blue actions (`#1D4ED8`).
  - Added dedicated design tokens and utilities in `index.css` for tabular numerals, smooth scroll offsets, and accessibility focus rings.
- **Button & Text Contrast System**:
  - Overhauled `Button.jsx` with 7 strict contrast variants (`primary`, `secondary`, `dark`, `soft`, `outline`, `ghost`, `danger`).
  - Completely eliminated low-contrast white text on pale/white backgrounds across all pages, presets, dialogs, and modals.
- **Public vs. Authenticated Navigation & Route Guards**:
  - Unauthenticated users see marketing navigation (Overview, Features, How It Works, Integrity, Sign In, Open Free Wallet) and clicking the logo routes to `/`.
  - Authenticated users see application navigation (Dashboard, Send Money, Add Money, Withdraw, Bank Accounts, Transactions) and clicking the brand logo routes to `/dashboard`.
  - Active session persists cleanly without redirect loops, layout flickering, or duplicate navbars.
- **Realistic 3D Payment Card (`WalletScene.jsx` & `WalletCanvas.jsx`)**:
  - Replaced distorted black geometry with a physical ISO/IEC 7810 ID-1 standard ratio card (3.38 × 2.14 × 0.08 units) featuring rounded edges, brushed cobalt/navy metallic materials, golden EMV chip with contact divider, contactless wave markings, holographic security badge, and embossed cardholder typography.
  - Smooth pointer-tilt parallax dampening via `THREE.MathUtils.damp` and accessible non-WebGL fallback with reduced-motion support.
- **Landing Page Redesign from Ground Up**:
  - **Hero**: Atmospheric ambient glow, live ACID status badge, bold display typography, high-contrast CTAs, and interactive 3D card.
  - **Live P2P Flow Diagram (#flow)**: Interactive 3-stage lifecycle inspector illustrating Client Request, Invariant & PIN Step-Up, and Atomic Commit.
  - **Engine Architecture (#features)**: Asymmetrical bento grid highlighting ACID transactions, client idempotency, bank outbox workers, and double-entry immutable ledgers.
  - **How It Works Timeline (#how-it-works)**: Clean 3-step numbered progression with financial guarantees.
  - **Security Invariants (#guarantees)**: Real architectural callouts for integer paise, 15-min PIN lockout, ₹10,000 daily limit, and AES-256-GCM bank encryption.
  - **Closing Contrast CTA**: Dark navy environment with subtle ambient radial lighting and animated arrow transitions.
- **Two-Column Authentication Experience**:
  - Redesigned `SignInPage.jsx` and `SignUpPage.jsx` into responsive two-column layouts featuring a clean accessible form panel on the left and a rich brand visualization panel on the right.
- **Authenticated Dashboard & Financial Subpages Polish**:
  - Crisp light-first surface cards for Available Balance, Primary Action Buttons (`Send Money` in primary cobalt, `Add Money` and `Withdraw` in secondary), Daily Outgoing Limit widget, and recent ledger activity.
  - Harmonized `TransferPage`, `AddMoneyPage`, `WithdrawPage`, `BankAccountsPage`, and `TransactionsPage` under consistent contrast and light-first styling.

### Quality & Verification Results
- **ESLint**: `npm run lint` passed with **0 errors, 0 warnings**.
- **Production Bundle**: `npm run build` compiled cleanly in 713ms (**27 modular chunks**, Three.js / Motion vendor code-split, CSS bundle 65.94 kB).
- **Backend Test Suite**: `node test/day6.test.js` verified with **47 passed, 0 failed** (all security invariants, PIN lockouts, idempotency keys, and daily caps preserved).
