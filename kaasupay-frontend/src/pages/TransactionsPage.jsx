import { useEffect, useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  FileText,
  Copy,
  Check,
  ShieldCheck,
  Calendar,
  Building2,
  RotateCcw,
  PlusCircle,
  Download,
  Filter,
  X,
  ChevronDown,
  Info,
  AlertCircle,
} from 'lucide-react';
import Card, { CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import AmountDisplay from '../components/ui/AmountDisplay';
import Alert from '../components/ui/Alert';
import Dialog from '../components/ui/Dialog';
import { Skeleton } from '../components/ui/Spinner';
import { formatDateTime } from '../utils/currency';
import walletService from '../services/walletService';

const TRANSACTION_TYPES = [
  { value: 'ALL', label: 'All Types' },
  { value: 'TRANSFER', label: 'Transfers' },
  { value: 'TOPUP', label: 'Add Money' },
  { value: 'WITHDRAWAL', label: 'Withdrawals' },
  { value: 'REVERSAL', label: 'Refunds' },
  { value: 'DEPOSIT', label: 'Bank Deposits' },
];

const DIRECTION_OPTIONS = [
  { value: 'ALL', label: 'All Directions' },
  { value: 'CREDIT', label: 'Money In (Credits)' },
  { value: 'DEBIT', label: 'Money Out (Debits)' },
];

export function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') === 'statements' ? 'statements' : 'history';

  // ==========================================
  // Tab Switching
  // ==========================================
  const handleTabChange = (tab) => {
    setSearchParams({ tab });
  };

  // ==========================================
  // Summary Stats State (Current Month Overview)
  // ==========================================
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [overviewMonth] = useState(currentMonthStr);
  const [monthlyOverview, setMonthlyOverview] = useState(null);
  const [isLoadingOverview, setIsLoadingOverview] = useState(true);

  useEffect(() => {
    let ignore = false;
    walletService.getMonthlyStatement(overviewMonth)
      .then((data) => {
        if (!ignore) {
          setMonthlyOverview(data);
          setIsLoadingOverview(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.error('Failed to fetch monthly overview:', err);
          setIsLoadingOverview(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [overviewMonth]);

  // ==========================================
  // HISTORY TAB STATE (Cursor Pagination & Filters)
  // ==========================================
  const [historyItems, setHistoryItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  // Filters
  const [selectedDirection, setSelectedDirection] = useState('ALL');
  const [selectedType, setSelectedType] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);

  // Detail Drawer & Copy state
  const [selectedTx, setSelectedTx] = useState(null);
  const [copiedField, setCopiedField] = useState(null);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedDirection !== 'ALL') count++;
    if (selectedType !== 'ALL') count++;
    if (fromDate) count++;
    if (toDate) count++;
    return count;
  }, [selectedDirection, selectedType, fromDate, toDate]);

  const loadHistory = useCallback(
    async (isInitial = true, cursor = null) => {
      if (isInitial) {
        setIsLoadingHistory(true);
        setHistoryError(null);
      } else {
        setIsLoadingMore(true);
      }

      try {
        const params = { limit: 20 };
        if (cursor) params.cursor = cursor;
        if (selectedDirection !== 'ALL') params.direction = selectedDirection;
        if (selectedType !== 'ALL') params.type = selectedType;
        if (fromDate) params.from = fromDate;
        if (toDate) params.to = toDate;

        const res = await walletService.getHistory(params);
        if (isInitial) {
          setHistoryItems(res.items || []);
        } else {
          setHistoryItems((prev) => [...prev, ...(res.items || [])]);
        }
        setNextCursor(res.nextCursor || null);
      } catch (err) {
        console.error('Error fetching history:', err);
        setHistoryError(err?.response?.data?.error || 'Failed to load transaction history');
      } finally {
        setIsLoadingHistory(false);
        setIsLoadingMore(false);
      }
    },
    [selectedDirection, selectedType, fromDate, toDate]
  );

  useEffect(() => {
    if (currentTab === 'history') {
      let ignore = false;
      const params = { limit: 20 };
      if (selectedDirection !== 'ALL') params.direction = selectedDirection;
      if (selectedType !== 'ALL') params.type = selectedType;
      if (fromDate) params.from = fromDate;
      if (toDate) params.to = toDate;

      // Wrap in Promise.resolve() to prevent synchronous effect warning
      Promise.resolve().then(() => {
        if (!ignore) {
          setIsLoadingHistory(true);
          setHistoryError(null);
        }
      });

      walletService.getHistory(params)
        .then((res) => {
          if (!ignore) {
            setHistoryItems(res.items || []);
            setNextCursor(res.nextCursor || null);
            setIsLoadingHistory(false);
          }
        })
        .catch((err) => {
          if (!ignore) {
            console.error('Error fetching history:', err);
            setHistoryError(err?.response?.data?.error || 'Failed to load transaction history');
            setIsLoadingHistory(false);
          }
        });
      return () => {
        ignore = true;
      };
    }
  }, [currentTab, selectedDirection, selectedType, fromDate, toDate]);

  const handleLoadMore = () => {
    if (nextCursor && !isLoadingMore) {
      loadHistory(false, nextCursor);
    }
  };

  const handleClearFilters = () => {
    setSelectedDirection('ALL');
    setSelectedType('ALL');
    setFromDate('');
    setToDate('');
  };

  // Group transactions by date for clean sectioning
  const groupedTransactions = useMemo(() => {
    const groups = {};
    const todayStr = new Date().toDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    historyItems.forEach((item) => {
      const d = new Date(item.at || item.createdAt);
      const dStr = d.toDateString();
      let label = d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
      if (dStr === todayStr) label = 'Today';
      else if (dStr === yesterdayStr) label = 'Yesterday';

      if (!groups[label]) groups[label] = [];
      groups[label].push(item);
    });

    return groups;
  }, [historyItems]);

  // ==========================================
  // STATEMENTS TAB STATE
  // ==========================================
  const [statementMonth, setStatementMonth] = useState(currentMonthStr);
  const [statementData, setStatementData] = useState(null);
  const [isLoadingStatement, setIsLoadingStatement] = useState(false);
  const [statementError, setStatementError] = useState(null);
  const [isDownloadingCsv, setIsDownloadingCsv] = useState(false);

  useEffect(() => {
    if (currentTab === 'statements') {
      let ignore = false;
      Promise.resolve().then(() => {
        if (!ignore) {
          setIsLoadingStatement(true);
          setStatementError(null);
        }
      });

      walletService.getMonthlyStatement(statementMonth)
        .then((data) => {
          if (!ignore) {
            setStatementData(data);
            setIsLoadingStatement(false);
          }
        })
        .catch((err) => {
          if (!ignore) {
            console.error('Failed to load statement:', err);
            setStatementError(err?.response?.data?.error || 'Failed to load monthly statement');
            setIsLoadingStatement(false);
          }
        });

      return () => {
        ignore = true;
      };
    }
  }, [currentTab, statementMonth]);

  const handleDownloadCsv = async () => {
    if (isDownloadingCsv) return;
    setIsDownloadingCsv(true);
    try {
      await walletService.downloadMonthlyStatementCsv(statementMonth);
    } catch (err) {
      console.error('Failed to download statement CSV:', err);
      alert('Failed to download CSV statement. Please try again.');
    } finally {
      setIsDownloadingCsv(false);
    }
  };

  const handleCopy = (text, fieldName) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Helper visuals for transaction row
  const getTxVisuals = (tx) => {
    const isCredit = tx.direction === 'CREDIT';
    if (tx.type === 'WITHDRAWAL') {
      return {
        icon: <Building2 className="w-4 h-4 text-rose-600" />,
        badge: <Badge variant="debit" size="sm">Withdrawal</Badge>,
        boxClass: 'bg-rose-50 text-rose-600 border border-rose-100',
        label: tx.label || 'Withdrawal to bank',
      };
    }
    if (tx.type === 'REVERSAL') {
      return {
        icon: <RotateCcw className="w-4 h-4 text-emerald-600" />,
        badge: <Badge variant="credit" size="sm">Refund</Badge>,
        boxClass: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
        label: tx.label || 'Refund of failed withdrawal',
      };
    }
    if (tx.type === 'TOPUP') {
      return {
        icon: <PlusCircle className="w-4 h-4 text-emerald-600" />,
        badge: <Badge variant="credit" size="sm">Add Money</Badge>,
        boxClass: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
        label: tx.label || 'Added via Razorpay',
      };
    }
    if (tx.type === 'DEPOSIT') {
      return {
        icon: <LandmarkIcon className="w-4 h-4 text-emerald-600" />,
        badge: <Badge variant="credit" size="sm">Deposit</Badge>,
        boxClass: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
        label: tx.label || 'Bank deposit',
      };
    }
    // Default: TRANSFER
    if (isCredit) {
      return {
        icon: <ArrowDownLeft className="w-4 h-4 text-emerald-600" />,
        badge: <Badge variant="credit" size="sm">Received</Badge>,
        boxClass: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
        label: tx.label || 'Transfer Received',
      };
    }
    return {
      icon: <ArrowUpRight className="w-4 h-4 text-rose-600" />,
      badge: <Badge variant="debit" size="sm">Sent</Badge>,
      boxClass: 'bg-rose-50 text-rose-600 border border-rose-100',
      label: tx.label || 'Transfer Sent',
    };
  };

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------- */}
      {/* Top Header & Monthly Overview Summary Cards          */}
      {/* ---------------------------------------------------- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-navy-900 font-display">
            Transactions & Statements
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Real-time ledger audit log, cursor pagination, and monthly reconciliation statements.
          </p>
        </div>

        {/* Tab Selector */}
        <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => handleTabChange('history')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
              currentTab === 'history'
                ? 'bg-white text-navy-900 shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-navy-900'
            }`}
          >
            History
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('statements')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
              currentTab === 'statements'
                ? 'bg-white text-navy-900 shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-navy-900'
            }`}
          >
            Statements
          </button>
        </div>
      </div>

      {/* Overview Cards (Current Month) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Money In */}
        <Card className="border-slate-200 shadow-sm bg-linear-to-br from-white to-emerald-50/20">
          <CardContent className="p-4 sm:p-5 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Money In (This Month)
              </span>
              <div className="text-2xl font-bold text-emerald-600 font-mono">
                {isLoadingOverview ? (
                  <Skeleton className="h-8 w-28" />
                ) : (
                  <AmountDisplay paise={monthlyOverview?.totalIn || 0} size="lg" />
                )}
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-100/70 text-emerald-600 flex items-center justify-center border border-emerald-200/60">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        {/* Money Out */}
        <Card className="border-slate-200 shadow-sm bg-linear-to-br from-white to-rose-50/20">
          <CardContent className="p-4 sm:p-5 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Money Out (This Month)
              </span>
              <div className="text-2xl font-bold text-rose-600 font-mono">
                {isLoadingOverview ? (
                  <Skeleton className="h-8 w-28" />
                ) : (
                  <AmountDisplay paise={monthlyOverview?.totalOut || 0} size="lg" />
                )}
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-rose-100/70 text-rose-600 flex items-center justify-center border border-rose-200/60">
              <ArrowUpRight className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        {/* Activity Volume */}
        <Card className="border-slate-200 shadow-sm bg-linear-to-br from-white to-cobalt-50/20">
          <CardContent className="p-4 sm:p-5 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Monthly Activity
              </span>
              <div className="text-2xl font-bold text-navy-900 font-mono">
                {isLoadingOverview ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <span>{monthlyOverview?.entries || 0} <span className="text-sm font-normal text-slate-500">records</span></span>
                )}
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-cobalt-100/70 text-cobalt-600 flex items-center justify-center border border-cobalt-200/60">
              <FileText className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ==================================================== */}
      {/* TAB 1: TRANSACTION HISTORY                            */}
      {/* ==================================================== */}
      {currentTab === 'history' && (
        <div className="space-y-4">
          {/* Filter Bar & Action Controls */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                {/* Search / Filter Selectors (Desktop) */}
                <div className="flex flex-wrap items-center gap-2.5">
                  {/* Direction Filter */}
                  <select
                    value={selectedDirection}
                    onChange={(e) => setSelectedDirection(e.target.value)}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-cobalt-500"
                  >
                    {DIRECTION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {/* Type Filter */}
                  <select
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-cobalt-500"
                  >
                    {TRANSACTION_TYPES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {/* Date Range Inputs */}
                  <div className="hidden sm:flex items-center gap-1.5 text-xs">
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      placeholder="From"
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-xs focus:outline-none focus:ring-2 focus:ring-cobalt-500"
                    />
                    <span className="text-slate-400">to</span>
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      placeholder="To"
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-xs focus:outline-none focus:ring-2 focus:ring-cobalt-500"
                    />
                  </div>

                  {/* Active Filter Clear */}
                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={handleClearFilters}
                      className="px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50 rounded-lg transition-colors flex items-center gap-1 font-semibold cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      Clear ({activeFilterCount})
                    </button>
                  )}
                </div>

                {/* Mobile Filter Sheet Trigger & Refresh */}
                <div className="flex items-center gap-2 self-end lg:self-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    className="sm:hidden flex items-center gap-1.5 text-xs"
                    onClick={() => setIsFilterSheetOpen(true)}
                  >
                    <Filter className="w-3.5 h-3.5" />
                    Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadHistory(true)}
                    disabled={isLoadingHistory}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingHistory ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Active Filter Chips Banner */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-1">
              <span className="text-xs text-slate-500">Active Filters:</span>
              {selectedDirection !== 'ALL' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-cobalt-50 text-cobalt-700 border border-cobalt-200">
                  Direction: {selectedDirection}
                  <button type="button" onClick={() => setSelectedDirection('ALL')} className="hover:text-cobalt-900">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {selectedType !== 'ALL' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-cobalt-50 text-cobalt-700 border border-cobalt-200">
                  Type: {selectedType}
                  <button type="button" onClick={() => setSelectedType('ALL')} className="hover:text-cobalt-900">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {fromDate && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-cobalt-50 text-cobalt-700 border border-cobalt-200">
                  From: {fromDate}
                  <button type="button" onClick={() => setFromDate('')} className="hover:text-cobalt-900">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {toDate && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-cobalt-50 text-cobalt-700 border border-cobalt-200">
                  To: {toDate}
                  <button type="button" onClick={() => setToDate('')} className="hover:text-cobalt-900">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
            </div>
          )}

          {/* Error Message */}
          {historyError && (
            <Alert variant="danger">
              <span>{historyError}</span>
            </Alert>
          )}

          {/* Transaction List Card */}
          <Card className="border-slate-200 shadow-sm overflow-hidden">
            <CardHeader className="p-4 sm:p-5 border-b border-slate-100 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold text-navy-900">
                  Transaction Audit Trail
                </CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Immutable double-entry ledger records ordered newest first.
                </CardDescription>
              </div>
              <span className="text-xs font-mono font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
                {historyItems.length} loaded
              </span>
            </CardHeader>

            <CardContent className="p-0">
              {isLoadingHistory && historyItems.length === 0 ? (
                <div className="p-6 space-y-4">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                      <div className="flex items-center gap-3">
                        <Skeleton className="w-10 h-10 rounded-xl" />
                        <div className="space-y-1.5">
                          <Skeleton className="h-4 w-36" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </div>
                      <Skeleton className="h-5 w-24" />
                    </div>
                  ))}
                </div>
              ) : historyItems.length === 0 ? (
                <div className="py-16 text-center">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400 mb-3">
                    <FileText className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-semibold text-navy-900">No transactions found</h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    {activeFilterCount > 0
                      ? 'No transactions matched the active filter criteria. Try adjusting or clearing your filters.'
                      : 'Your wallet has not performed any transactions yet.'}
                  </p>
                  {activeFilterCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleClearFilters}
                      className="mt-4"
                    >
                      Clear All Filters
                    </Button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {Object.entries(groupedTransactions).map(([dateLabel, items]) => (
                    <div key={dateLabel}>
                      {/* Date Section Header */}
                      <div className="bg-slate-50/70 px-4 py-1.5 border-y border-slate-100 text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        {dateLabel}
                      </div>

                      {/* Items for Date */}
                      <div className="divide-y divide-slate-100">
                        {items.map((tx) => {
                          const visuals = getTxVisuals(tx);
                          const isCredit = tx.direction === 'CREDIT';

                          return (
                            <div
                              key={tx.id || tx._id}
                              onClick={() => setSelectedTx(tx)}
                              className="p-4 hover:bg-slate-50/80 transition-colors cursor-pointer flex items-center justify-between gap-3 group"
                            >
                              {/* Left icon & details */}
                              <div className="flex items-center gap-3.5 min-w-0">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${visuals.boxClass}`}>
                                  {visuals.icon}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-sm text-navy-900 truncate group-hover:text-cobalt-600 transition-colors">
                                      {visuals.label}
                                    </span>
                                    {visuals.badge}
                                  </div>
                                  <div className="text-xs text-slate-500 mt-0.5 truncate flex items-center gap-2">
                                    <span>{formatDateTime(tx.at || tx.createdAt)}</span>
                                    {tx.note && (
                                      <>
                                        <span className="text-slate-300">•</span>
                                        <span className="italic truncate">"{tx.note}"</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Right amounts */}
                              <div className="text-right shrink-0">
                                <div className={`font-mono font-bold text-sm ${isCredit ? 'text-emerald-600' : 'text-rose-600'}`}>
                                  {isCredit ? '+' : '-'}&nbsp;<AmountDisplay paise={tx.amount} size="sm" />
                                </div>
                                {tx.balanceAfter !== undefined && (
                                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                                    Bal: <AmountDisplay paise={tx.balanceAfter} size="xs" />
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>

            {/* Pagination Load More Footer */}
            {nextCursor && (
              <div className="p-4 bg-slate-50/50 border-t border-slate-100 text-center">
                <Button
                  variant="outline"
                  size="md"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="w-full sm:w-auto min-w-44 font-semibold text-xs"
                >
                  {isLoadingMore ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin mr-2" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 mr-1" />
                  )}
                  {isLoadingMore ? 'Loading older records...' : 'Load Older Transactions'}
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ==================================================== */}
      {/* TAB 2: MONTHLY FINANCIAL STATEMENTS                  */}
      {/* ==================================================== */}
      {currentTab === 'statements' && (
        <div className="space-y-6">
          {/* Controls Bar: Month Picker & CSV Download Button */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <label htmlFor="statement-month" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Select Statement Month:
                </label>
                <input
                  id="statement-month"
                  type="month"
                  value={statementMonth}
                  onChange={(e) => setStatementMonth(e.target.value)}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-cobalt-500 cursor-pointer"
                />
              </div>

              <Button
                variant="primary"
                size="md"
                onClick={handleDownloadCsv}
                disabled={isDownloadingCsv || isLoadingStatement}
                isLoading={isDownloadingCsv}
                leftIcon={<Download className="w-4 h-4 shrink-0" />}
                className="self-start sm:self-auto font-semibold text-xs whitespace-nowrap"
              >
                {isDownloadingCsv ? 'Generating CSV...' : 'Download Statement (CSV)'}
              </Button>
            </CardContent>
          </Card>

          {/* Statement Verification Error */}
          {statementError && (
            <Alert variant="danger">
              <span>{statementError}</span>
            </Alert>
          )}

          {/* Statement Balance Breakdown Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Opening Balance */}
            <Card className="border-slate-200 shadow-sm bg-white">
              <CardContent className="p-4 space-y-1">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  1. Opening Balance
                </span>
                <div className="text-xl sm:text-2xl font-bold font-mono text-navy-900">
                  {isLoadingStatement ? (
                    <Skeleton className="h-7 w-24" />
                  ) : (
                    <AmountDisplay paise={statementData?.openingBalance || 0} size="md" />
                  )}
                </div>
                <p className="text-[11px] text-slate-400">Balance at 1st 00:00 IST</p>
              </CardContent>
            </Card>

            {/* Money In */}
            <Card className="border-slate-200 shadow-sm bg-emerald-50/20">
              <CardContent className="p-4 space-y-1">
                <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                  <ArrowDownLeft className="w-3.5 h-3.5" />
                  2. Money In (Credits)
                </span>
                <div className="text-xl sm:text-2xl font-bold font-mono text-emerald-600">
                  {isLoadingStatement ? (
                    <Skeleton className="h-7 w-24" />
                  ) : (
                    <AmountDisplay paise={statementData?.totalIn || 0} size="md" />
                  )}
                </div>
                <p className="text-[11px] text-emerald-600/80">Total deposits & topups</p>
              </CardContent>
            </Card>

            {/* Money Out */}
            <Card className="border-slate-200 shadow-sm bg-rose-50/20">
              <CardContent className="p-4 space-y-1">
                <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  3. Money Out (Debits)
                </span>
                <div className="text-xl sm:text-2xl font-bold font-mono text-rose-600">
                  {isLoadingStatement ? (
                    <Skeleton className="h-7 w-24" />
                  ) : (
                    <AmountDisplay paise={statementData?.totalOut || 0} size="md" />
                  )}
                </div>
                <p className="text-[11px] text-rose-600/80">Total sends & withdrawals</p>
              </CardContent>
            </Card>

            {/* Closing Balance */}
            <Card className="border-slate-200 shadow-sm bg-cobalt-50/30">
              <CardContent className="p-4 space-y-1">
                <span className="text-[11px] font-bold text-cobalt-800 uppercase tracking-wider">
                  4. Closing Balance
                </span>
                <div className="text-xl sm:text-2xl font-bold font-mono text-navy-900">
                  {isLoadingStatement ? (
                    <Skeleton className="h-7 w-24" />
                  ) : (
                    <AmountDisplay paise={statementData?.closingBalance || 0} size="md" />
                  )}
                </div>
                <p className="text-[11px] text-cobalt-600">Ending wallet balance</p>
              </CardContent>
            </Card>
          </div>

          {/* Financial Reconciliation Verification Shield */}
          {statementData && (
            <Card className={`border shadow-sm ${statementData.check ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40'}`}>
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${statementData.check ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                      {statementData.check ? (
                        <ShieldCheck className="w-6 h-6" />
                      ) : (
                        <AlertCircle className="w-6 h-6" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-navy-900">
                          {statementData.check
                            ? 'Double-Entry Reconciliation Verified'
                            : 'Reconciliation Discrepancy Detected'}
                        </h4>
                        <Badge variant={statementData.check ? 'credit' : 'debit'} size="sm">
                          {statementData.check ? 'Verified' : 'Review Needed'}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">
                        {statementData.check
                          ? 'All ledger entries for this month are mathematically balanced and accounted for.'
                          : 'A discrepancy was detected in this month’s balance calculations. Please contact support.'}
                      </p>
                    </div>
                  </div>

                  <div className="text-xs text-slate-500 bg-white/80 p-2.5 rounded-lg border border-slate-200/60 font-medium">
                    <span>Total Transactions: </span>
                    <strong className="text-navy-900 font-mono">{statementData.entries}</strong>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Statement Information Note */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-start gap-3 text-xs text-slate-600">
            <Info className="w-4 h-4 text-cobalt-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-navy-900">Need official audit documentation?</p>
              <p>
                Click <strong>Download Statement (CSV)</strong> to export the full ledger records for this month with RFC-4180 compliance, spreadsheet formula immunization, and exact paise-to-rupees conversions.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* MOBILE BOTTOM SHEET FOR FILTERS                       */}
      {/* ==================================================== */}
      <Dialog
        isOpen={isFilterSheetOpen}
        onClose={() => setIsFilterSheetOpen(false)}
        title="Filter Transactions"
      >
        <div className="space-y-4 pt-2">
          {/* Direction */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-600">Direction</label>
            <div className="grid grid-cols-3 gap-2">
              {DIRECTION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSelectedDirection(opt.value)}
                  className={`py-2 px-2 text-xs font-semibold rounded-lg border text-center transition-colors ${
                    selectedDirection === opt.value
                      ? 'bg-cobalt-600 text-white border-cobalt-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {opt.label.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-600">Transaction Type</label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-cobalt-500"
            >
              {TRANSACTION_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-600">Date Range (IST)</label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[11px] text-slate-500 block mb-1">From</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                />
              </div>
              <div>
                <span className="text-[11px] text-slate-500 block mb-1">To</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                />
              </div>
            </div>
          </div>

          {/* Sheet Actions */}
          <div className="pt-4 flex items-center gap-2">
            <Button
              variant="outline"
              size="md"
              className="w-1/2"
              onClick={handleClearFilters}
            >
              Reset
            </Button>
            <Button
              variant="primary"
              size="md"
              className="w-1/2"
              onClick={() => setIsFilterSheetOpen(false)}
            >
              Apply Filters
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ==================================================== */}
      {/* TRANSACTION DETAILS DRAWER / DIALOG                   */}
      {/* ==================================================== */}
      <Dialog
        isOpen={Boolean(selectedTx)}
        onClose={() => setSelectedTx(null)}
        title="Transaction Details"
      >
        {selectedTx && (
          <div className="space-y-5 pt-2">
            {/* Header with amount */}
            <div className="text-center pb-4 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {selectedTx.type || 'Transaction'}
              </span>
              <div
                className={`text-3xl font-extrabold font-mono mt-1 ${
                  selectedTx.direction === 'CREDIT' ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {selectedTx.direction === 'CREDIT' ? '+' : '-'}&nbsp;
                <AmountDisplay paise={selectedTx.amount} size="xl" />
              </div>
              <div className="text-xs text-slate-500 mt-1 flex items-center justify-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                <span>{formatDateTime(selectedTx.at || selectedTx.createdAt)}</span>
              </div>
            </div>

            {/* Field breakdown */}
            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl flex items-center justify-between">
                <span className="text-slate-500">Direction</span>
                <Badge variant={selectedTx.direction === 'CREDIT' ? 'credit' : 'debit'} size="sm">
                  {selectedTx.direction === 'CREDIT' ? 'CREDIT (Money In)' : 'DEBIT (Money Out)'}
                </Badge>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl flex items-center justify-between">
                <span className="text-slate-500">Counterparty</span>
                <span className="font-semibold text-navy-900">
                  {selectedTx.label || selectedTx.withWhom || 'Wallet Balance'}
                </span>
              </div>

              {selectedTx.balanceAfter !== undefined && (
                <div className="p-3 bg-slate-50 rounded-xl flex items-center justify-between">
                  <span className="text-slate-500">Balance After Transaction</span>
                  <span className="font-mono font-bold text-navy-900">
                    <AmountDisplay paise={selectedTx.balanceAfter} size="sm" />
                  </span>
                </div>
              )}

              {selectedTx.note && (
                <div className="p-3 bg-slate-50 rounded-xl flex items-center justify-between">
                  <span className="text-slate-500">Payment Note</span>
                  <span className="font-medium text-navy-900 italic">
                    "{selectedTx.note}"
                  </span>
                </div>
              )}

              <div className="p-3 bg-slate-50 rounded-xl flex items-center justify-between">
                <span className="text-slate-500">Transaction ID</span>
                <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-700">
                  <span className="truncate max-w-47.5">
                    {selectedTx.transactionId || selectedTx.id || selectedTx._id}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(selectedTx.transactionId || selectedTx.id || selectedTx._id, 'txId')}
                    className="p-1 hover:bg-slate-200/60 rounded text-slate-400 hover:text-slate-600 cursor-pointer"
                    title="Copy Transaction ID"
                  >
                    {copiedField === 'txId' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="p-3 bg-cobalt-50/50 rounded-xl border border-cobalt-100 flex items-center gap-2.5 text-xs text-cobalt-800">
              <ShieldCheck className="w-4 h-4 text-cobalt-600 shrink-0" />
              <span>
                Immutable double-entry line item. Integer paise precision guarantees zero floating-point loss.
              </span>
            </div>

            <Button
              variant="secondary"
              size="md"
              className="w-full"
              onClick={() => setSelectedTx(null)}
            >
              Close Details
            </Button>
          </div>
        )}
      </Dialog>
    </div>
  );
}

// Icon helper
function LandmarkIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="3" y1="22" x2="21" y2="22" />
      <line x1="6" y1="18" x2="6" y2="11" />
      <line x1="10" y1="18" x2="10" y2="11" />
      <line x1="14" y1="18" x2="14" y2="11" />
      <line x1="18" y1="18" x2="18" y2="11" />
      <polygon points="12 2 20 7 4 7" />
    </svg>
  );
}

export default TransactionsPage;
