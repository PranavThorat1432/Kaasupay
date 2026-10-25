import { useDispatch, useSelector } from 'react-redux';
import { useCallback } from 'react';
import { addToast, removeToast } from './slices/uiSlice';
import { logout } from './slices/authSlice';

// Base redux hooks
export const useAppDispatch = () => useDispatch();
export const useAppSelector = useSelector;

/**
 * Convenient hook for authentication state & actions
 */
export function useAuth() {
  const dispatch = useAppDispatch();
  const auth = useAppSelector((state) => state.auth);

  const handleLogout = useCallback(() => {
    dispatch(logout());
  }, [dispatch]);

  return {
    ...auth,
    logout: handleLogout,
  };
}

/**
 * Convenient hook for wallet state & balance
 */
export function useWallet() {
  return useAppSelector((state) => state.wallet);
}

/**
 * Convenient hook for transaction history state
 */
export function useTransactions() {
  return useAppSelector((state) => state.transactions);
}

/**
 * Convenient hook for bank accounts and withdrawal state
 */
export function useBank() {
  return useAppSelector((state) => state.bank);
}

/**
 * Convenient hook for dispatching toast notifications
 */
export function useToast() {
  const dispatch = useAppDispatch();

  const toast = useCallback(
    ({ type = 'info', title, message, duration = 4500 }) => {
      dispatch(addToast({ type, title, message, duration }));
    },
    [dispatch]
  );

  const success = useCallback(
    (message, title = 'Success') => {
      dispatch(addToast({ type: 'success', title, message }));
    },
    [dispatch]
  );

  const error = useCallback(
    (message, title = 'Error') => {
      dispatch(addToast({ type: 'error', title, message }));
    },
    [dispatch]
  );

  const info = useCallback(
    (message, title = 'Information') => {
      dispatch(addToast({ type: 'info', title, message }));
    },
    [dispatch]
  );

  const dismiss = useCallback(
    (id) => {
      dispatch(removeToast(id));
    },
    [dispatch]
  );

  return {
    toast,
    success,
    error,
    info,
    dismiss,
  };
}
