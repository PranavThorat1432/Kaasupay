import { configureStore } from '@reduxjs/toolkit';
import authReducer, { logout } from './slices/authSlice';
import walletReducer from './slices/walletSlice';
import transactionReducer from './slices/transactionSlice';
import bankReducer from './slices/bankSlice';
import uiReducer, { addToast } from './slices/uiSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    wallet: walletReducer,
    transactions: transactionReducer,
    bank: bankReducer,
    ui: uiReducer,
  },
  devTools: import.meta.env.MODE !== 'production',
});

// Centralized listener for auth expiration/401 unauthorized
if (typeof window !== 'undefined') {
  window.addEventListener('kaasupay:auth_unauthorized', () => {
    const state = store.getState();
    if (state.auth.isAuthenticated) {
      store.dispatch(logout());
      store.dispatch(
        addToast({
          type: 'error',
          title: 'Session Expired',
          message: 'Your session has expired. Please sign in again.',
        })
      );
    }
  });
}

export default store;
