import { useState, useEffect, useCallback } from 'react';
import {
  Inbox,
  Send,
  CheckCircle,
  XCircle,
  Clock,
  Ban,
  ArrowDownLeft,
  ArrowUpRight,
  HandCoins,
  RefreshCw,
  AlertCircle,
  Lock,
} from 'lucide-react';
import Card, { CardContent, CardHeader, CardTitle, CardDescription } from '../ui/Card';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import AmountDisplay from '../ui/AmountDisplay';
import { PinModal } from '../security/PinModal';
import RequestMoneyModal from './RequestMoneyModal';
import walletService from '../../services/walletService';
import { useToast, useAppDispatch } from '../../store/hooks';
import { fetchWalletBalance, fetchDailyLimits } from '../../store/slices/walletSlice';
import { fetchTransactionHistory } from '../../store/slices/transactionSlice';
import { generateIdempotencyKey } from '../../utils/idempotency';
import { formatDateTime } from '../../utils/currency';

export function MoneyRequestsSection() {
  const toast = useToast();
  const dispatch = useAppDispatch();

  const [activeTab, setActiveTab] = useState('incoming'); // 'incoming' | 'outgoing'
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Modals state
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [selectedPayRequest, setSelectedPayRequest] = useState(null);
  const [isPaying, setIsPaying] = useState(false);
  const [pinErrorDetails, setPinErrorDetails] = useState(null);

  const [actionLoadingId, setActionLoadingId] = useState(null);

  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    try {
      const [incRes, outRes] = await Promise.all([
        walletService.getIncomingRequests(),
        walletService.getOutgoingRequests(),
      ]);
      setIncoming(incRes.requests || []);
      setOutgoing(outRes.requests || []);
    } catch (err) {
      console.error('Failed to load money requests:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    Promise.all([
      walletService.getIncomingRequests(),
      walletService.getOutgoingRequests(),
    ])
      .then(([incRes, outRes]) => {
        if (isMounted) {
          setIncoming(incRes.requests || []);
          setOutgoing(outRes.requests || []);
        }
      })
      .catch((err) => {
        console.error('Failed to load money requests:', err);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleOpenPay = (req) => {
    setSelectedPayRequest(req);
    setPinErrorDetails(null);
    setIsPinModalOpen(true);
  };

  const handleConfirmPay = async (pin) => {
    if (!selectedPayRequest) return;
    setIsPaying(true);
    setPinErrorDetails(null);

    const idempotencyKey = generateIdempotencyKey(`pay-req-${selectedPayRequest.id}`);

    try {
      const result = await walletService.payMoneyRequest(selectedPayRequest.id, {
        pin,
        idempotencyKey,
      });

      toast.success(result.message || 'Request paid successfully!');
      setIsPinModalOpen(false);
      setSelectedPayRequest(null);

      // Refresh balance, daily limit, transactions, and requests
      dispatch(fetchWalletBalance());
      dispatch(fetchDailyLimits());
      dispatch(fetchTransactionHistory({ page: 1, limit: 5 }));
      fetchRequests();
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      const msg = data?.message || data?.error || err.message || 'Payment failed';

      if (status === 403 || status === 423) {
        setPinErrorDetails({
          status,
          message: msg,
          triesLeft: data?.triesLeft,
          retryAfterSeconds: data?.retryAfterSeconds,
        });
      } else {
        toast.error(msg);
        setIsPinModalOpen(false);
      }
    } finally {
      setIsPaying(false);
    }
  };

  const handleDecline = async (reqId) => {
    if (!window.confirm('Are you sure you want to decline this money request?')) return;
    setActionLoadingId(reqId);
    try {
      const res = await walletService.declineMoneyRequest(reqId);
      toast.info(res.message || 'Request declined');
      fetchRequests();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to decline request');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancel = async (reqId) => {
    if (!window.confirm('Cancel this pending request?')) return;
    setActionLoadingId(reqId);
    try {
      const res = await walletService.cancelMoneyRequest(reqId);
      toast.info(res.message || 'Request cancelled');
      fetchRequests();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel request');
    } finally {
      setActionLoadingId(null);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'PENDING':
        return <Badge variant="warning" icon={<Clock className="w-3 h-3" />}>PENDING</Badge>;
      case 'PAID':
        return <Badge variant="success" icon={<CheckCircle className="w-3 h-3" />}>PAID</Badge>;
      case 'DECLINED':
        return <Badge variant="danger" icon={<XCircle className="w-3 h-3" />}>DECLINED</Badge>;
      case 'CANCELLED':
        return <Badge variant="neutral" icon={<Ban className="w-3 h-3" />}>CANCELLED</Badge>;
      case 'EXPIRED':
        return <Badge variant="neutral" icon={<AlertCircle className="w-3 h-3" />}>EXPIRED</Badge>;
      default:
        return <Badge variant="neutral">{status}</Badge>;
    }
  };

  const pendingIncomingCount = incoming.filter((r) => r.status === 'PENDING').length;
  const pendingOutgoingCount = outgoing.filter((r) => r.status === 'PENDING').length;

  return (
    <Card className="border-slate-200/90 shadow-xs bg-white">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2 text-navy-950 font-bold">
              <HandCoins className="w-4 h-4 text-cobalt-600" />
              Request Money
            </CardTitle>
            <CardDescription>
              Ask friends for money, pay incoming requests with your PIN, or decline/cancel
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={fetchRequests}
              isLoading={isLoading}
              leftIcon={<RefreshCw className="w-3.5 h-3.5 text-slate-500" />}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsRequestModalOpen(true)}
              leftIcon={<HandCoins className="w-3.5 h-3.5" />}
            >
              Request Money
            </Button>
          </div>
        </div>

        {/* Tab Controls */}
        <div className="flex items-center gap-2 border-b border-slate-100 mt-4 -mb-2">
          <button
            type="button"
            onClick={() => setActiveTab('incoming')}
            className={`pb-2.5 px-3 text-xs font-bold transition-colors relative flex items-center gap-1.5 ${
              activeTab === 'incoming'
                ? 'text-cobalt-600 border-b-2 border-cobalt-600'
                : 'text-slate-500 hover:text-navy-950'
            }`}
          >
            <Inbox className="w-3.5 h-3.5" />
            <span>Incoming to Pay</span>
            {pendingIncomingCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-mono font-bold flex items-center justify-center">
                {pendingIncomingCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('outgoing')}
            className={`pb-2.5 px-3 text-xs font-bold transition-colors relative flex items-center gap-1.5 ${
              activeTab === 'outgoing'
                ? 'text-cobalt-600 border-b-2 border-cobalt-600'
                : 'text-slate-500 hover:text-navy-950'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>Sent Requests</span>
            {pendingOutgoingCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-mono font-bold flex items-center justify-center">
                {pendingOutgoingCount}
              </span>
            )}
          </button>
        </div>
      </CardHeader>

      <CardContent className="pt-2">
        {/* Incoming Requests Tab */}
        {activeTab === 'incoming' && (
          <div>
            {incoming.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <Inbox className="w-8 h-8 mx-auto mb-2 opacity-40 text-slate-400" />
                <p className="text-xs font-medium">No incoming money requests</p>
                <p className="text-[11px] text-slate-400 mt-0.5">When friends request money from you, they will appear here.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {incoming.map((req) => (
                  <div key={req.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="p-2 rounded-xl bg-amber-50 text-amber-700 shrink-0 mt-0.5">
                        <ArrowDownLeft className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-bold text-navy-950">
                            {req.from} asks for <AmountDisplay paise={req.amount} size="sm" className="font-bold inline font-mono" />
                          </p>
                          {getStatusBadge(req.status)}
                        </div>
                        {req.note && (
                          <p className="text-xs text-slate-600 mt-0.5 italic">"{req.note}"</p>
                        )}
                        <p className="text-[11px] text-slate-400 font-mono mt-1">
                          Received {formatDateTime(req.createdAt)} • Expires {formatDateTime(req.expiresAt)}
                        </p>
                      </div>
                    </div>

                    {req.status === 'PENDING' && (
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleDecline(req.id)}
                          isLoading={actionLoadingId === req.id}
                        >
                          Decline
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleOpenPay(req)}
                          leftIcon={<Lock className="w-3.5 h-3.5" />}
                        >
                          Pay
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Outgoing Requests Tab */}
        {activeTab === 'outgoing' && (
          <div>
            {outgoing.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <Send className="w-8 h-8 mx-auto mb-2 opacity-40 text-slate-400" />
                <p className="text-xs font-medium">No outgoing requests sent yet</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Tap "Request Money" to ask a friend to split a bill or pay you back.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {outgoing.map((req) => (
                  <div key={req.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="p-2 rounded-xl bg-cobalt-50 text-cobalt-600 shrink-0 mt-0.5">
                        <ArrowUpRight className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-bold text-navy-950">
                            Requested <AmountDisplay paise={req.amount} size="sm" className="font-bold inline font-mono" /> from {req.to}
                          </p>
                          {getStatusBadge(req.status)}
                        </div>
                        {req.note && (
                          <p className="text-xs text-slate-600 mt-0.5 italic">"{req.note}"</p>
                        )}
                        <p className="text-[11px] text-slate-400 font-mono mt-1">
                          Sent {formatDateTime(req.createdAt)} • Expires {formatDateTime(req.expiresAt)}
                        </p>
                      </div>
                    </div>

                    {req.status === 'PENDING' && (
                      <div className="shrink-0 self-end sm:self-center">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleCancel(req.id)}
                          isLoading={actionLoadingId === req.id}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Request Money Modal */}
      <RequestMoneyModal
        isOpen={isRequestModalOpen}
        onClose={() => setIsRequestModalOpen(false)}
        onRequestCreated={() => fetchRequests()}
      />

      {/* Pay Request PIN Modal */}
      {selectedPayRequest && (
        <PinModal
          isOpen={isPinModalOpen}
          onClose={() => {
            setIsPinModalOpen(false);
            setSelectedPayRequest(null);
          }}
          onConfirm={handleConfirmPay}
          title="Confirm Request Payment"
          description={`Authorize payment of ₹${(selectedPayRequest.amount / 100).toFixed(2)} to ${selectedPayRequest.from}`}
          amountPaise={selectedPayRequest.amount}
          isLoading={isPaying}
          errorDetails={pinErrorDetails}
        />
      )}
    </Card>
  );
}

export default MoneyRequestsSection;
