import { createSlice } from '@reduxjs/toolkit';

const uiSlice = createSlice({
  name: 'ui',
  initialState: {
    toasts: [],
    isMobileNavOpen: false,
  },
  reducers: {
    addToast(state, action) {
      const id = action.payload.id || `toast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      state.toasts.push({
        id,
        type: action.payload.type || 'info', // 'success' | 'error' | 'info' | 'warning'
        title: action.payload.title || null,
        message: action.payload.message,
        duration: action.payload.duration ?? 4500,
      });
    },
    removeToast(state, action) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
    clearToasts(state) {
      state.toasts = [];
    },
    setMobileNavOpen(state, action) {
      state.isMobileNavOpen = Boolean(action.payload);
    },
    toggleMobileNav(state) {
      state.isMobileNavOpen = !state.isMobileNavOpen;
    },
  },
});

export const {
  addToast,
  removeToast,
  clearToasts,
  setMobileNavOpen,
  toggleMobileNav,
} = uiSlice.actions;

export default uiSlice.reducer;
