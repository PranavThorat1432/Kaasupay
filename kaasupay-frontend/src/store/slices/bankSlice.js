import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import walletService from '../../services/walletService';

export const fetchBankAccounts = createAsyncThunk(
  'bank/fetchAccounts',
  async (_, { rejectWithValue }) => {
    try {
      const data = await walletService.getBankAccounts();
      return data.accounts || [];
    } catch (err) {
      return rejectWithValue(err.message || 'Failed to fetch bank accounts');
    }
  }
);

export const addBankAccount = createAsyncThunk(
  'bank/addAccount',
  async ({ holderName, accountNumber, ifsc }, { rejectWithValue }) => {
    try {
      const data = await walletService.addBankAccount({ holderName, accountNumber, ifsc });
      return data;
    } catch (err) {
      return rejectWithValue(err.message || 'Failed to add bank account');
    }
  }
);

export const fetchWithdrawals = createAsyncThunk(
  'bank/fetchWithdrawals',
  async (_, { rejectWithValue }) => {
    try {
      const data = await walletService.getWithdrawals();
      return data.withdrawals || [];
    } catch (err) {
      return rejectWithValue(err.message || 'Failed to fetch withdrawals');
    }
  }
);

export const executeWithdrawal = createAsyncThunk(
  'bank/executeWithdrawal',
  async ({ bankAccountId, amount, idempotencyKey, pin }, { rejectWithValue }) => {
    try {
      const data = await walletService.withdrawFunds({ bankAccountId, amount, idempotencyKey, pin });
      return data;
    } catch (err) {
      return rejectWithValue({
        message: err.message || 'Withdrawal request failed',
        status: err.status,
        triesLeft: err.data?.triesLeft,
        retryAfterSeconds: err.data?.retryAfterSeconds,
        leftToday: err.data?.leftToday,
        data: err.data,
      });
    }
  }
);

export const pollWithdrawalStatus = createAsyncThunk(
  'bank/pollWithdrawalStatus',
  async (withdrawalId, { rejectWithValue }) => {
    try {
      const data = await walletService.getWithdrawalById(withdrawalId);
      return data.withdrawal;
    } catch (err) {
      return rejectWithValue(err.message || 'Failed to check withdrawal status');
    }
  }
);

const bankSlice = createSlice({
  name: 'bank',
  initialState: {
    accounts: [],
    accountsLoading: false,
    accountsError: null,
    addAccountLoading: false,
    addAccountError: null,
    addAccountSuccess: null,

    withdrawals: [],
    withdrawalsLoading: false,
    withdrawalsError: null,

    activeWithdrawal: null,
    withdrawLoading: false,
    withdrawError: null,
  },
  reducers: {
    clearBankErrors(state) {
      state.accountsError = null;
      state.addAccountError = null;
      state.withdrawError = null;
    },
    resetWithdrawalState(state) {
      state.activeWithdrawal = null;
      state.withdrawLoading = false;
      state.withdrawError = null;
    },
    setActiveWithdrawal(state, action) {
      state.activeWithdrawal = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch accounts
      .addCase(fetchBankAccounts.pending, (state) => {
        state.accountsLoading = true;
        state.accountsError = null;
      })
      .addCase(fetchBankAccounts.fulfilled, (state, action) => {
        state.accountsLoading = false;
        state.accounts = action.payload;
      })
      .addCase(fetchBankAccounts.rejected, (state, action) => {
        state.accountsLoading = false;
        state.accountsError = action.payload;
      })

      // Add account
      .addCase(addBankAccount.pending, (state) => {
        state.addAccountLoading = true;
        state.addAccountError = null;
        state.addAccountSuccess = null;
      })
      .addCase(addBankAccount.fulfilled, (state, action) => {
        state.addAccountLoading = false;
        state.addAccountSuccess = action.payload;
        state.accounts.unshift(action.payload);
      })
      .addCase(addBankAccount.rejected, (state, action) => {
        state.addAccountLoading = false;
        state.addAccountError = action.payload;
      })

      // Fetch withdrawals
      .addCase(fetchWithdrawals.pending, (state) => {
        state.withdrawalsLoading = true;
      })
      .addCase(fetchWithdrawals.fulfilled, (state, action) => {
        state.withdrawalsLoading = false;
        state.withdrawals = action.payload;
      })
      .addCase(fetchWithdrawals.rejected, (state, action) => {
        state.withdrawalsLoading = false;
        state.withdrawalsError = action.payload;
      })

      // Execute withdrawal (202 Accepted)
      .addCase(executeWithdrawal.pending, (state) => {
        state.withdrawLoading = true;
        state.withdrawError = null;
      })
      .addCase(executeWithdrawal.fulfilled, (state, action) => {
        state.withdrawLoading = false;
        state.activeWithdrawal = action.payload.withdrawal;
      })
      .addCase(executeWithdrawal.rejected, (state, action) => {
        state.withdrawLoading = false;
        state.withdrawError = action.payload?.message || action.payload || 'Withdrawal request failed';
      })

      // Poll status
      .addCase(pollWithdrawalStatus.fulfilled, (state, action) => {
        if (action.payload) {
          state.activeWithdrawal = action.payload;
          const idx = state.withdrawals.findIndex((w) => w.id === action.payload.id);
          if (idx !== -1) {
            state.withdrawals[idx] = action.payload;
          }
        }
      });
  },
});

export const { clearBankErrors, resetWithdrawalState, setActiveWithdrawal } = bankSlice.actions;
export default bankSlice.reducer;
