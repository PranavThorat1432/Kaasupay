import apiClient from './api';

export const walletService = {
  /**
   * Fetch current authenticated user's wallet balance
   * @returns {Promise<{ balance: number, display: string }>}
   */
  async getBalance() {
    const response = await apiClient.get('/api/v1/wallet/balance');
    return response.data;
  },

  /**
   * Execute atomic peer-to-peer transfer with idempotency protection
   * @param {{ to: string, amount: number, note?: string, idempotencyKey: string }} params
   * @returns {Promise<{ message: string, transactionId: string, to: string, amount: number, senderBalance: number, note: string }>}
   */
  async transferFunds({ to, amount, note, idempotencyKey, pin }) {
    if (!idempotencyKey) {
      throw new Error('Idempotency key is required for money transfers');
    }

    const payload = { to, amount };
    if (note && note.trim().length > 0) {
      payload.note = note.trim();
    }
    if (pin !== undefined && pin !== null) {
      payload.pin = pin;
    }

    const response = await apiClient.post('/api/v1/wallet/transfer', payload, {
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
    });
    return response.data;
  },

  /**
   * Fetch paginated transaction history
   * @param {{ page?: number, limit?: number }} params
   * @returns {Promise<{ data: Array<any>, transactions: Array<any>, page: number, limit: number, total: number, totalPages: number }>}
   */
  async getTransactions({ page = 1, limit = 10 } = {}) {
    const response = await apiClient.get('/api/v1/wallet/transactions', {
      params: { page, limit },
    });
    return response.data;
  },

  /**
   * Create Razorpay top-up order
   * @param {number} amountInPaise - Integer paise between 1,000 and 1,000,000
   * @returns {Promise<{ orderId: string, amount: number, currency: string, keyId: string }>}
   */
  async createAddMoneyOrder(amountInPaise) {
    const response = await apiClient.post('/api/v1/wallet/add-money/order', {
      amount: amountInPaise,
    });
    return response.data;
  },

  /**
   * Check status of a payment order
   * @param {string} orderId
   * @returns {Promise<{ orderId: string, amount: number, status: string, paidVia: string|null }>}
   */
  async getAddMoneyOrderStatus(orderId) {
    const response = await apiClient.get(`/api/v1/wallet/add-money/orders/${orderId}`);
    return response.data;
  },

  /**
   * Verify Razorpay checkout signature and credit the wallet
   * @param {{ razorpay_order_id: string, razorpay_payment_id: string, razorpay_signature: string }} paymentData
   * @returns {Promise<{ message: string, orderId: string, amount: number, balance: number }>}
   */
  async verifyAddMoneyPayment(paymentData) {
    const response = await apiClient.post('/api/v1/wallet/add-money/verify', paymentData);
    return response.data;
  },

  // ---------------------------------------------------------------------------
  // Day 5: Bank Accounts & Bank Withdrawal Operations
  // ---------------------------------------------------------------------------

  /**
   * Fetch saved masked bank accounts for authenticated user
   * @returns {Promise<{ accounts: Array<{ id: string, holderName: string, account: string, ifsc: string, createdAt: string }> }>}
   */
  async getBankAccounts() {
    const response = await apiClient.get('/api/v1/wallet/bank-accounts');
    return response.data;
  },

  /**
   * Save a new bank account
   * @param {{ holderName: string, accountNumber: string, ifsc: string }} accountData
   * @returns {Promise<{ id: string, holderName: string, account: string, ifsc: string }>}
   */
  async addBankAccount({ holderName, accountNumber, ifsc }) {
    const response = await apiClient.post('/api/v1/wallet/bank-accounts', {
      holderName,
      accountNumber,
      ifsc,
    });
    return response.data;
  },

  /**
   * Request a withdrawal to a saved bank account (202 Accepted)
   * @param {{ bankAccountId: string, amount: number, idempotencyKey: string }} params
   * @returns {Promise<{ message: string, withdrawal: { id: string, amount: number, status: string, account: string }, balance: number }>}
   */
  async withdrawFunds({ bankAccountId, amount, idempotencyKey, pin }) {
    if (!idempotencyKey) {
      throw new Error('Idempotency key is required for withdrawals');
    }

    const body = { bankAccountId, amount };
    if (pin !== undefined && pin !== null) {
      body.pin = pin;
    }

    const response = await apiClient.post(
      '/api/v1/wallet/withdraw',
      body,
      {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      }
    );
    return response.data;
  },

  /**
   * List recent 20 withdrawals
   * @returns {Promise<{ withdrawals: Array<{ id: string, amount: number, status: string, bankRef?: string, failureReason?: string, account: string, createdAt: string, updatedAt: string }> }>}
   */
  async getWithdrawals() {
    const response = await apiClient.get('/api/v1/wallet/withdrawals');
    return response.data;
  },

  /**
   * Fetch single withdrawal details by ID
   * @param {string} withdrawalId
   * @returns {Promise<{ withdrawal: { id: string, amount: number, status: string, reference: string, bankRef?: string, failureReason?: string, account: string, holderName?: string, ifsc?: string, createdAt: string, updatedAt: string } }>}
   */
  async getWithdrawalById(withdrawalId) {
    const response = await apiClient.get(`/api/v1/wallet/withdrawals/${withdrawalId}`);
    return response.data;
  },

  /**
   * Fetch today's outgoing limit usage and reset timestamp (Day 6)
   * @returns {Promise<{ dailyLimit: number, usedToday: number, leftToday: number, resetsAt: string }>}
   */
  async getLimits() {
    const response = await apiClient.get('/api/v1/wallet/limits');
    return response.data;
  },
};

export default walletService;
