import { useEffect, useState, useMemo } from 'react';
import {
  ArrowDownLeft,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  FileText,
  Copy,
  Check,
  ShieldCheck,
  Calendar,
  Building2,
  RotateCcw,
  PlusCircle,
  Send,
  Landmark,
} from 'lucide-react';
import { useTransactions, useAppDispatch } from '../store/hooks';
import { fetchTransactionHistory, clearTransactionError } from '../store/slices/transactionSlice';
import Card, { CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import AmountDisplay from '../components/ui/AmountDisplay';
import Alert from '../components/ui/Alert';
import Dialog from '../components/ui/Dialog';
import { Skeleton } from '../components/ui/Spinner';
import { formatDateTime } from '../utils/currency';

const PAGE_SIZE_OPTIONS = [10, 25, 50];

export function TransactionsPage() {
  const dispatch = useAppDispatch();
  const { items: transactions, totalPages, total, isLoading, error } = useTransactions();

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filterType, setFilterType] = useState('ALL'); // 'ALL' | 'TRANSFER' | 'TOPUP' | 'WITHDRAWAL' | 'REVERSAL'
  const [selectedTx, setSelectedTx] = useState(null);
  const [copiedField, setCopiedField] = useState(null);

  useEffect(() => {
    dispatch(fetchTransactionHistory({ page: currentPage, limit: pageSize }));
  }, [dispatch, currentPage, pageSize]);

  const handlePrev = () => {
    if (currentPage > 1) setCurrentPage((p) => p - 1);
  };

  const handleNext = () => {
    if (currentPage < totalPages) setCurrentPage((p) => p + 1);
  };

  const handleRefresh = () => {
    dispatch(fetchTransactionHistory({ page: currentPage, limit: pageSize }));
  };

  const handlePageSizeChange = (newSize) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  const filteredTransactions = useMemo(() => {
    if (filterType === 'ALL') return transactions;
    if (filterType === 'CREDIT') return transactions.filter((t) => t.direction === 'CREDIT');
    if (filterType === 'DEBIT') return transactions.filter((t) => t.direction === 'DEBIT');
    return transactions.filter((tx) => tx.type === filterType);
  }, [transactions, filterType]);

  const handleCopy = (text, fieldName) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const getTxVisuals = (tx) => {
    const isCredit = tx.direction === 'CREDIT';
    if (tx.type === 'WITHDRAWAL') {
      return {
        icon: <Building2 className="w-4 h-4 text-rose-600" />,
        badge: <Badge variant="debit" size="sm">Withdrawal</Badge>,
        boxClass: 'bg-rose-50 text-rose-600 border border-rose-100',
        label: 'Withdrawal to bank',
      };
    }
    if (tx.type === 'REVERSAL') {
      return {
        icon: <RotateCcw className="w-4 h-4 text-emerald-600" />,
        badge: <Badge variant="credit" size="sm">Refund</Badge>,
        boxClass: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
        label: 'Refund of failed withdrawal',
      };
    }
    if (tx.type === 'TOPUP') {
      return {
        icon: <PlusCircle className="w-4 h-4 text-emerald-600" />,
        badge: <Badge variant="credit" size="sm">Add Money</Badge>,
        boxClass: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
        label: 'Added via Razorpay',
      };
    }
    if (tx.type === 'DEPOSIT') {
      return {
        icon: <Landmark className="w-4 h-4 text-emerald-600" />,
        badge: <Badge variant="credit" size="sm">Deposit</Badge>,
        boxClass: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
        label: 'Bank deposit',
      };
    }
    return {
      icon: isCredit ? (
        <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
      ) : (
        <Send className="w-4 h-4 text-rose-600" />
      ),
      badge: <Badge variant={isCredit ? 'credit' : 'debit'} size="sm">{isCredit ? 'Received' : 'Sent'}</Badge>,
      boxClass: isCredit
        ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
        : 'bg-rose-50 text-rose-600 border border-rose-100',
      label: tx.withWhom || (isCredit ? 'Received Transfer' : 'Peer Transfer'),
    };
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy-900 tracking-tight flex items-center gap-2.5">
            <FileText className="w-7 h-7 text-cobalt-600" />
            Transaction History
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Complete, immutable audit trail of your wallet debits, credits, transfers, and bank withdrawals.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
            isLoading={isLoading}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh
          </Button>

          {/* Page size selector */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5">
            <span>Show:</span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="bg-transparent font-semibold text-navy-900 focus:outline-none cursor-pointer"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <Alert
          variant="error"
          title="Could not load transactions"
          onClose={() => dispatch(clearTransactionError())}
        >
          {error}
        </Alert>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { label: 'All Activity', value: 'ALL' },
          { label: 'Funds In (+)', value: 'CREDIT' },
          { label: 'Funds Out (-)', value: 'DEBIT' },
          { label: 'Withdrawals', value: 'WITHDRAWAL' },
          { label: 'Refunds', value: 'REVERSAL' },
        ].map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setFilterType(tab.value)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              filterType === tab.value
                ? 'bg-navy-900 text-white shadow-xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Table Card */}
      <Card>
        <CardHeader className="py-4 px-6 border-b border-slate-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold text-navy-900">
              Transaction History
            </CardTitle>
            <CardDescription className="text-xs">
              Showing {filteredTransactions.length} of {total} total records
            </CardDescription>
          </div>

          <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            Verified Records
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading && transactions.length === 0 ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-navy-900">No records found</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                No transactions match your current filter.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/70 border-b border-slate-100 text-slate-400 uppercase font-semibold text-[10px] tracking-wider">
                  <tr>
                    <th className="py-3 px-6">Description / Counterparty</th>
                    <th className="py-3 px-6">Type</th>
                    <th className="py-3 px-6">Timestamp</th>
                    <th className="py-3 px-6 text-right">Amount</th>
                    <th className="py-3 px-6 text-right">Balance After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredTransactions.map((tx) => {
                    const visuals = getTxVisuals(tx);
                    return (
                      <tr
                        key={tx.transactionId || tx._id}
                        onClick={() => setSelectedTx(tx)}
                        className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                      >
                        <td className="py-4 px-6 flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${visuals.boxClass}`}>
                            {visuals.icon}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-navy-900 group-hover:text-cobalt-600 transition-colors truncate">
                              {tx.withWhom || visuals.label}
                            </p>
                            {tx.note && (
                              <p className="text-[11px] text-slate-400 truncate max-w-xs mt-0.5">
                                "{tx.note}"
                              </p>
                            )}
                          </div>
                        </td>

                        <td className="py-4 px-6">
                          {visuals.badge}
                        </td>

                        <td className="py-4 px-6 text-slate-500 font-mono text-[11px]">
                          {formatDateTime(tx.createdAt)}
                        </td>

                        <td className="py-4 px-6 text-right">
                          <AmountDisplay
                            paise={tx.amount}
                            direction={tx.direction}
                            showSign
                            size="sm"
                          />
                        </td>

                        <td className="py-4 px-6 text-right text-slate-500 font-mono">
                          {tx.balanceAfter !== undefined ? (
                            <AmountDisplay paise={tx.balanceAfter} size="sm" className="text-slate-600" />
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <span className="text-slate-500">
              Page {currentPage} of {totalPages || 1} ({total} total transactions)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handlePrev}
                disabled={currentPage <= 1 || isLoading}
                leftIcon={<ChevronLeft className="w-4 h-4" />}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleNext}
                disabled={currentPage >= totalPages || isLoading}
                rightIcon={<ChevronRight className="w-4 h-4" />}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* TRANSACTION DETAILS MODAL */}
      <Dialog
        isOpen={Boolean(selectedTx)}
        onClose={() => setSelectedTx(null)}
        title="Transaction Details"
        description="Immutable record from the double-entry audit ledger"
        maxWidth="max-w-lg"
      >
        {selectedTx && (
          <div className="space-y-5">
            <div
              className={`p-5 rounded-2xl border text-center ${
                selectedTx.direction === 'CREDIT'
                  ? 'bg-emerald-50/60 border-emerald-100'
                  : 'bg-rose-50/60 border-rose-100'
              }`}
            >
              <div className="flex items-center justify-center gap-2 mb-1.5">
                <Badge variant={selectedTx.direction === 'CREDIT' ? 'credit' : 'debit'} size="sm">
                  {selectedTx.type || selectedTx.direction}
                </Badge>
                <span className="text-xs text-slate-500">
                  {selectedTx.direction === 'CREDIT' ? 'Funds In' : 'Funds Out'}
                </span>
              </div>
              <AmountDisplay
                paise={selectedTx.amount}
                direction={selectedTx.direction}
                showSign
                size="2xl"
                className="font-mono font-black"
              />
              <p className="text-xs text-slate-500 mt-1 font-medium">
                {selectedTx.withWhom || (selectedTx.direction === 'CREDIT' ? 'Credit Top-up' : 'Peer Transfer')}
              </p>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl flex items-center justify-between">
                <span className="text-slate-500 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  Timestamp
                </span>
                <span className="font-mono font-medium text-navy-900">
                  {formatDateTime(selectedTx.createdAt)}
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
                    {selectedTx.transactionId || selectedTx._id}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(selectedTx.transactionId || selectedTx._id, 'txId')}
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

export default TransactionsPage;
