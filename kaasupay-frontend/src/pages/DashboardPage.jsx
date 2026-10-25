import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Send,
  PlusCircle,
  History,
  ArrowUpRight,
  ArrowDownLeft,
  ShieldCheck,
  RefreshCw,
  User,
  Mail,
  ArrowRight,
  KeyRound,
  Lock,
  LogOut,
  } from 'lucide-react';
import { useAuth, useWallet, useTransactions, useAppDispatch, useToast } from '../store/hooks';
import { fetchWalletBalance, clearWalletError, fetchDailyLimits } from '../store/slices/walletSlice';
import { fetchTransactionHistory, clearTransactionError } from '../store/slices/transactionSlice';
import { logoutAllDevices } from '../store/slices/authSlice';
import Card, { CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import Button from '../components/ui/Button';
import AmountDisplay from '../components/ui/AmountDisplay';
import Badge from '../components/ui/Badge';
import Alert from '../components/ui/Alert';
import { Skeleton } from '../components/ui/Spinner';
import { formatDateTime } from '../utils/currency';
import DailyLimitCard from '../components/security/DailyLimitCard';
import SetPinModal from '../components/security/SetPinModal';

export function DashboardPage() {
  const dispatch = useAppDispatch();
  const { user } = useAuth();
  const { balance, isLoading: balanceLoading, error: balanceError } = useWallet();
  const { items: transactions, isLoading: txLoading, error: txError } = useTransactions();
  const toast = useToast();

  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);

  const handleRefresh = useCallback(() => {
    dispatch(fetchWalletBalance());
    dispatch(fetchDailyLimits());
    dispatch(fetchTransactionHistory({ page: 1, limit: 5 }));
  }, [dispatch]);

  useEffect(() => {
    handleRefresh();
  }, [handleRefresh]);

  const handleLogoutAll = async () => {
    if (window.confirm('Are you sure you want to log out of all active sessions across all devices?')) {
      setIsLoggingOutAll(true);
      try {
        await dispatch(logoutAllDevices()).unwrap();
        toast.info('Signed out of all devices');
      } catch (err) {
        toast.error(err || 'Failed to sign out all devices');
      } finally {
        setIsLoggingOutAll(false);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Welcome Header & Sync Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy-950 tracking-tight">
            Welcome, {user?.firstName || 'KaasuPay Member'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">
            Real-time wallet balance, daily limits, and verified double-entry ledger audit trail
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
            isLoading={balanceLoading || txLoading}
            leftIcon={<RefreshCw className="w-3.5 h-3.5 text-cobalt-600" />}
          >
            Sync Ledger
          </Button>
        </div>
      </div>

      {/* Security Banner if user has no payment PIN */}
      {!user?.hasPin && (
        <div className="p-4 sm:p-5 bg-amber-50/80 border border-amber-200/90 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 rounded-xl bg-amber-100 text-amber-800 shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-navy-950">Payment PIN Required for Outgoing Funds</h2>
              <p className="text-xs text-amber-900 mt-0.5">
                Set up a 4 or 6-digit payment PIN to authorize P2P transfers and bank withdrawals with 3-attempt lockout defense.
              </p>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsPinModalOpen(true)}
            leftIcon={<Lock className="w-3.5 h-3.5" />}
            className="shrink-0"
          >
            Set Up PIN
          </Button>
        </div>
      )}

      {/* Global Error Banners */}
      {balanceError && (
        <Alert variant="danger" onClose={() => dispatch(clearWalletError())}>
          {balanceError}
        </Alert>
      )}
      {txError && (
        <Alert variant="warning" onClose={() => dispatch(clearTransactionError())}>
          {txError}
        </Alert>
      )}

      {/* Primary Wallet Balance Card (Light-First Design with High-Contrast Controls) */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-xs relative overflow-hidden">
        {/* Subtle accent glow in top-right */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-cobalt-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          {/* Balance Amount & Integrity Indicator */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <span>Available Wallet Balance</span>
              <span className="flex items-center gap-1 text-[11px] text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Verified & Available
              </span>
            </div>

            {balanceLoading ? (
              <div className="h-12 w-56 bg-slate-100 rounded-xl animate-pulse my-2" />
            ) : (
              <AmountDisplay
                paise={balance}
                size="2xl"
                className="text-navy-950 font-black font-mono text-3xl sm:text-4xl tabular-nums tracking-tight block"
              />
            )}

            <p className="text-xs text-slate-400 font-mono flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Real-time balance • Ready for instant transfers & withdrawals
            </p>
          </div>

          {/* High-Contrast Action Buttons (NO white-on-white text!) */}
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/transfer">
              <Button
                variant="primary"
                size="md"
                leftIcon={<Send className="w-4 h-4" />}
                className="shadow-sm font-bold"
              >
                Send Money
              </Button>
            </Link>
            <Link to="/add-money">
              <Button
                variant="secondary"
                size="md"
                leftIcon={<PlusCircle className="w-4 h-4 text-cobalt-600" />}
                className="font-bold"
              >
                Add Money
              </Button>
            </Link>
            <Link to="/withdraw">
              <Button
                variant="secondary"
                size="md"
                leftIcon={<ArrowUpRight className="w-4 h-4 text-slate-600" />}
                className="font-bold"
              >
                Withdraw
              </Button>
            </Link>
          </div>
        </div>
      </motion.div>

      {/* Daily Outgoing Limit Tracker Card */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
        <DailyLimitCard />
      </motion.div>

      {/* Profile & Recent Transactions Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Account Credentials & Security Status (Left 4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          <Card className="border-slate-200/90 shadow-xs bg-white">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2 text-navy-950 font-bold">
                <User className="w-4 h-4 text-cobalt-600" />
                Account & Security
              </CardTitle>
              <CardDescription>Verified member credentials and session controls</CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 pt-0">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold font-mono">
                  Legal Member Name
                </p>
                <p className="text-sm font-bold text-navy-950 mt-0.5">
                  {user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : '—'}
                </p>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold font-mono flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  Email / Login Identifier
                </p>
                <p className="text-xs font-mono font-medium text-slate-700 mt-0.5 break-all">
                  {user?.username || '—'}
                </p>
              </div>

              {/* Payment PIN Status */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block">
                    Payment PIN
                  </span>
                  <span className="text-xs font-semibold text-navy-900">
                    {user?.hasPin ? 'Active & Protected' : 'Not Configured'}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsPinModalOpen(true)}
                  className="text-xs font-bold text-cobalt-600 hover:text-cobalt-700 p-0 h-auto"
                >
                  {user?.hasPin ? 'Change PIN' : 'Set Up PIN'}
                </Button>
              </div>

              {/* Security Standard Badge */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">Security Standard</span>
                <Badge variant="credit" size="sm">
                  Bcrypt + JWT
                </Badge>
              </div>

              {/* Logout from all devices */}
              <div className="pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="soft"
                  size="sm"
                  onClick={handleLogoutAll}
                  isLoading={isLoggingOutAll}
                  leftIcon={<LogOut className="w-3.5 h-3.5 text-rose-600" />}
                  className="w-full text-xs text-rose-700 hover:bg-rose-50 hover:text-rose-800 justify-center font-bold"
                >
                  Log Out of All Devices
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Ledger Activity Table / List (Right 8 cols) */}
        <div className="lg:col-span-8">
          <Card className="border-slate-200/90 shadow-xs bg-white">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="text-base text-navy-950 font-bold">
                  Recent Ledger Activity
                </CardTitle>
                <CardDescription>
                  Latest verified entries from your immutable double-entry journal
                </CardDescription>
              </div>
              <Link to="/transactions">
                <Button variant="ghost" size="sm" rightIcon={<History className="w-3.5 h-3.5" />}>
                  View All
                </Button>
              </Link>
            </CardHeader>

            <CardContent className="p-0">
              {txLoading && transactions.length === 0 ? (
                <div className="p-6 space-y-3">
                  <Skeleton className="h-12 w-full rounded-xl" />
                  <Skeleton className="h-12 w-full rounded-xl" />
                  <Skeleton className="h-12 w-full rounded-xl" />
                </div>
              ) : transactions.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <History className="w-6 h-6" />
                  </div>
                  <h2 className="text-sm font-bold text-navy-950">No ledger entries recorded yet</h2>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 leading-relaxed">
                    Your wallet is provisioned and ready. Add funds via Razorpay or receive a peer transfer to start your ledger history.
                  </p>
                  <div className="mt-4">
                    <Link to="/add-money">
                      <Button variant="primary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                        Add Your First Funds
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {transactions.slice(0, 5).map((tx) => {
                    const isCredit = tx.direction === 'CREDIT';
                    return (
                      <div
                        key={tx.transactionId || tx._id}
                        className="p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50/80 transition-colors"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div
                            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                              isCredit
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}
                          >
                            {isCredit ? (
                              <ArrowDownLeft className="w-5 h-5 text-emerald-600" />
                            ) : (
                              <ArrowUpRight className="w-5 h-5 text-rose-600" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs sm:text-sm font-bold text-navy-950 truncate">
                              {tx.withWhom || (isCredit ? 'Credit Top-up' : 'Peer Transfer')}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5 font-medium">
                              {formatDateTime(tx.createdAt)} {tx.note ? `• "${tx.note}"` : ''}
                            </p>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <AmountDisplay
                            paise={tx.amount}
                            direction={tx.direction}
                            showSign
                            size="md"
                            className="font-bold tabular-nums font-mono"
                          />
                          <div className="mt-1">
                            <Badge variant={isCredit ? 'credit' : 'debit'} size="sm">
                              {tx.type || tx.direction}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Set/Change PIN Modal */}
      <SetPinModal
        isOpen={isPinModalOpen}
        onClose={() => setIsPinModalOpen(false)}
        hasExistingPin={Boolean(user?.hasPin)}
      />
    </div>
  );
}

export default DashboardPage;
