import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import walletService from '../../services/walletService';

export const fetchWalletBalance = createAsyncThunk(
  'wallet/fetchBalance',
  async (_, { rejectWithValue }) => {
    try {
      const data = await walletService.getBalance();
      return data;
    } catch (err) {
      return rejectWithValue(err.message || 'Failed to fetch balance');
    }
  }
);

export const fetchDailyLimits = createAsyncThunk(
  'wallet/fetchDailyLimits',
  async (_, { rejectWithValue }) => {
    try {
      const data = await walletService.getLimits();
      return data;
    } catch (err) {
      return rejectWithValue(err.message || 'Failed to fetch daily limits');
    }
  }
);

export const executeTransfer = createAsyncThunk(
  'wallet/executeTransfer',
  async ({ to, amount, note, idempotencyKey, pin }, { rejectWithValue }) => {
    try {
      const data = await walletService.transferFunds({ to, amount, note, idempotencyKey, pin });
      return data;
    } catch (err) {
      return rejectWithValue({
        message: err.message || 'Transfer failed',
        status: err.status,
        triesLeft: err.data?.triesLeft,
        retryAfterSeconds: err.data?.retryAfterSeconds,
        leftToday: err.data?.leftToday,
        data: err.data,
      });
    }
  }
);

const walletSlice = createSlice({
  name: 'wallet',
  initialState: {
    balance: 0,
    display: '₹0.00',
    isLoading: false,
    error: null,
    transferLoading: false,
    transferError: null,
    transferSuccess: null,

    // Day 6: Shared daily limits (10,000 INR / 1,000,000 paise)
    dailyLimits: {
      dailyLimit: 1000000,
      usedToday: 0,
      leftToday: 1000000,
      resetsAt: null,
    },
    dailyLimitsLoading: false,
    dailyLimitsError: null,
  },
  reducers: {
    setBalance(state, action) {
      state.balance = action.payload.balance;
      if (action.payload.display) {
        state.display = action.payload.display;
      }
    },
    setDailyLimits(state, action) {
      state.dailyLimits = action.payload;
    },
    clearWalletError(state) {
      state.error = null;
    },
    resetTransferState(state) {
      state.transferLoading = false;
      state.transferError = null;
      state.transferSuccess = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch balance
      .addCase(fetchWalletBalance.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchWalletBalance.fulfilled, (state, action) => {
        state.isLoading = false;
        state.balance = action.payload.balance;
        state.display = action.payload.display || `₹${(action.payload.balance / 100).toFixed(2)}`;
        state.error = null;
      })
      .addCase(fetchWalletBalance.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload;
      })

      // Fetch daily limits
      .addCase(fetchDailyLimits.pending, (state) => {
        state.dailyLimitsLoading = true;
      })
      .addCase(fetchDailyLimits.fulfilled, (state, action) => {
        state.dailyLimitsLoading = false;
        state.dailyLimits = action.payload;
        state.dailyLimitsError = null;
      })
      .addCase(fetchDailyLimits.rejected, (state, action) => {
        state.dailyLimitsLoading = false;
        state.dailyLimitsError = action.payload;
      })

      // Transfer money
      .addCase(executeTransfer.pending, (state) => {
        state.transferLoading = true;
        state.transferError = null;
        state.transferSuccess = null;
      })
      .addCase(executeTransfer.fulfilled, (state, action) => {
        state.transferLoading = false;
        state.transferSuccess = action.payload;
        // Update balance immediately from backend response
        if (action.payload.senderBalance !== undefined) {
          state.balance = action.payload.senderBalance;
          state.display = `₹${(action.payload.senderBalance / 100).toFixed(2)}`;
        }
      })
      .addCase(executeTransfer.rejected, (state, action) => {
        state.transferLoading = false;
        state.transferError = action.payload?.message || action.payload || 'Transfer failed';
      });
  },
});

export const { setBalance, setDailyLimits, clearWalletError, resetTransferState } = walletSlice.actions;
export default walletSlice.reducer;
