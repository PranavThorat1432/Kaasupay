import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import walletService from '../../services/walletService';

export const fetchTransactionHistory = createAsyncThunk(
  'transactions/fetchHistory',
  async ({ page = 1, limit = 10 } = {}, { rejectWithValue }) => {
    try {
      const data = await walletService.getTransactions({ page, limit });
      return data;
    } catch (err) {
      return rejectWithValue(err.message || 'Failed to fetch transaction history');
    }
  }
);

const transactionSlice = createSlice({
  name: 'transactions',
  initialState: {
    items: [],
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
    isLoading: false,
    error: null,
  },
  reducers: {
    prependTransaction(state, action) {
      state.items.unshift(action.payload);
      state.total += 1;
    },
    clearTransactionError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTransactionHistory.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchTransactionHistory.fulfilled, (state, action) => {
        state.isLoading = false;
        state.items = action.payload.data || [];
        state.page = action.payload.page || 1;
        state.limit = action.payload.limit || 10;
        state.total = action.payload.total || 0;
        state.totalPages = action.payload.totalPages || 0;
        state.error = null;
      })
      .addCase(fetchTransactionHistory.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload;
      });
  },
});

export const { prependTransaction, clearTransactionError } = transactionSlice.actions;
export default transactionSlice.reducer;
