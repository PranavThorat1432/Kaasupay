import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ErrorBoundary from './components/common/ErrorBoundary';
import ProtectedRoute, { PublicRoute } from './components/common/ProtectedRoute';
import ToastContainer from './components/ui/Toast';
import { useAppDispatch, useAuth } from './store/hooks';
import { fetchCurrentUser } from './store/slices/authSlice';

// Layouts
import PublicLayout from './components/layout/PublicLayout';
import AuthLayout from './components/layout/AuthLayout';
import DashboardLayout from './components/layout/DashboardLayout';

// Route-level Code Splitting for optimal bundle performance
const LandingPage = lazy(() => import('./pages/LandingPage'));
const SignInPage = lazy(() => import('./pages/SignInPage'));
const SignUpPage = lazy(() => import('./pages/SignUpPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const TransferPage = lazy(() => import('./pages/TransferPage'));
const AddMoneyPage = lazy(() => import('./pages/AddMoneyPage'));
const WithdrawPage = lazy(() => import('./pages/WithdrawPage'));
const BankAccountsPage = lazy(() => import('./pages/BankAccountsPage'));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

// Lightweight page loading indicator
function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[40vh] p-8">
      <div className="w-8 h-8 rounded-full border-2 border-cobalt-200 border-t-cobalt-600 animate-spin" />
    </div>
  );
}

export function App() {
  const dispatch = useAppDispatch();
  const { token } = useAuth();

  // Safely restore and verify active session on initial page mount or reload
  useEffect(() => {
    if (token) {
      dispatch(fetchCurrentUser());
    }
  }, [dispatch, token]);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastContainer />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public Routes with Navbar and Footer */}
            <Route element={<PublicLayout />}>
              <Route index element={<LandingPage />} />
            </Route>

            {/* Authentication Routes with Centered Card Layout */}
            <Route element={<AuthLayout />}>
              <Route
                path="/signin"
                element={
                  <PublicRoute>
                    <SignInPage />
                  </PublicRoute>
                }
              />
              <Route
                path="/signup"
                element={
                  <PublicRoute>
                    <SignUpPage />
                  </PublicRoute>
                }
              />
            </Route>

            {/* Protected Authenticated Routes with Dashboard Sidebar Layout */}
            <Route
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/transfer" element={<TransferPage />} />
              <Route path="/add-money" element={<AddMoneyPage />} />
              <Route path="/withdraw" element={<WithdrawPage />} />
              <Route path="/bank-accounts" element={<BankAccountsPage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
            </Route>

            {/* Fallback 404 Route */}
            <Route element={<PublicLayout />}>
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
