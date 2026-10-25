import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck,
  CreditCard,
  CheckCircle2,
  RotateCcw,
  ArrowRight,
  Lock,
} from 'lucide-react';
import { useAuth, useWallet, useAppDispatch, useToast } from '../store/hooks';
import { fetchWalletBalance } from '../store/slices/walletSlice';
import { fetchTransactionHistory } from '../store/slices/transactionSlice';
import walletService from '../services/walletService';
import Card, { CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import AmountDisplay from '../components/ui/AmountDisplay';
import Spinner from '../components/ui/Spinner';
import { rupeesToPaise } from '../utils/currency';
import { loadRazorpayScript } from '../utils/razorpay';

const PRESET_AMOUNTS = [100, 500, 1000, 2000, 5000];

export function AddMoneyPage() {
  const dispatch = useAppDispatch();
  const { user } = useAuth();
  const { balance } = useWallet();
  const toast = useToast();

  const [rupees, setRupees] = useState('500');
  const [status, setStatus] = useState('idle'); // 'idle' | 'creating_order' | 'checkout_open' | 'verifying' | 'reconciling' | 'success' | 'error'
  const [errorMessage, setErrorMessage] = useState(null);
  const [infoMessage, setInfoMessage] = useState(null);
  const [activeOrder, setActiveOrder] = useState(null);
  const [completedPayment, setCompletedPayment] = useState(null);

  const handlePresetClick = (amount) => {
    setRupees(String(amount));
    setErrorMessage(null);
    setInfoMessage(null);
  };

  // Reconcile pending order via GET /api/v1/wallet/add-money/orders/:orderId
  const handleReconcileStatus = useCallback(async (orderId) => {
    if (!orderId) return;
    setStatus('reconciling');
    setErrorMessage(null);
    try {
      const orderStatus = await walletService.getAddMoneyOrderStatus(orderId);
      if (orderStatus.status === 'PAID') {
        // Backend confirmed payment was credited
        setCompletedPayment({
          orderId: orderStatus.orderId,
          amount: orderStatus.amount,
          paidVia: orderStatus.paidVia || 'GATEWAY',
        });
        setStatus('success');
        toast.success('Payment verified and wallet credited!');
        dispatch(fetchWalletBalance());
        dispatch(fetchTransactionHistory({ page: 1, limit: 5 }));
      } else {
        // Order remains CREATED / pending
        setStatus('idle');
        setInfoMessage(
          `Order ${orderId} is currently ${orderStatus.status}. No funds have been debited from your card or credited to your wallet.`
        );
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage(err.message || 'Failed to check order status');
    }
  }, [dispatch, toast]);

  // Main payment initiation flow
  const handleInitiateAddMoney = async (e) => {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);

    let amountInPaise;
    try {
      amountInPaise = rupeesToPaise(rupees);
    } catch (err) {
      setErrorMessage(err.message);
      return;
    }

    if (amountInPaise < 1000 || amountInPaise > 1000000) {
      setErrorMessage('Top-up amount must be between ₹10.00 and ₹10,000.00 (1,000 to 1,000,000 paise)');
      return;
    }

    setStatus('creating_order');

    try {
      // Step 1: Preload Razorpay Checkout script
      const scriptReady = await loadRazorpayScript();

      // Step 2: Request order creation from authenticated backend
      const order = await walletService.createAddMoneyOrder(amountInPaise);
      setActiveOrder(order);

      const publicRazorpayKey = order.keyId || import.meta.env.VITE_RAZORPAY_KEY_ID;

      // Step 3: Open Razorpay checkout modal
      if (scriptReady && typeof window.Razorpay !== 'undefined') {
        setStatus('checkout_open');

        const options = {
          key: publicRazorpayKey,
          amount: order.amount,
          currency: order.currency || 'INR',
          name: 'KaasuPay Wallet',
          description: `Wallet Top-Up (${order.orderId})`,
          order_id: order.orderId,
          prefill: {
            name: user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : '',
            email: user?.username || '',
          },
          handler: async function (response) {
            // Step 4: Verify payment on backend with cryptographic signature
            setStatus('verifying');
            try {
              const verifyRes = await walletService.verifyAddMoneyPayment({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              });

              setCompletedPayment({
                orderId: response.razorpay_order_id,
                paymentId: response.razorpay_payment_id,
                amount: order.amount,
                balance: verifyRes.balance,
                message: verifyRes.message,
              });
              setStatus('success');
              toast.success(`Successfully added ₹${rupees} to your wallet!`);
              dispatch(fetchWalletBalance());
              dispatch(fetchTransactionHistory({ page: 1, limit: 5 }));
            } catch (vErr) {
              setStatus('error');
              setErrorMessage(
                vErr.message ||
                  'Payment was received by the gateway but verification timed out. Click "Recheck Payment Status" below to reconcile.'
              );
            }
          },
          modal: {
            ondismiss: function () {
              // User dismissed or closed the checkout modal
              // Safely verify whether a webhook already credited the order
              handleReconcileStatus(order.orderId);
            },
            escape: true,
          },
          theme: {
            color: '#2563EB',
          },
        };

        const rzp = new window.Razorpay(options);

        rzp.on('payment.failed', function (failResp) {
          setStatus('error');
          const description = failResp?.error?.description || 'Payment rejected by bank or issuer.';
          setErrorMessage(`Payment failed: ${description}`);
        });

        rzp.open();
      } else {
        // Fallback when Razorpay CDN is unavailable
        setStatus('idle');
        setInfoMessage(
          `Gateway Order ${order.orderId} was initialized for ₹${rupees}. Razorpay Checkout script could not be loaded from CDN (check network connection or adblocker).`
        );
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage(err.message || 'Failed to create payment order on backend');
    }
  };

  const resetFlow = () => {
    setStatus('idle');
    setErrorMessage(null);
    setInfoMessage(null);
    setActiveOrder(null);
    setCompletedPayment(null);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-navy-950 tracking-tight">Add Money</h1>
        <p className="text-xs text-slate-500 mt-1">
          Instant wallet top-up via verified Razorpay checkout
        </p>
      </div>

      {/* Available Balance Banner */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Current Balance
        </span>
        <AmountDisplay paise={balance} size="lg" />
      </div>

      {/* SUCCESS STATE */}
      {status === 'success' && completedPayment && (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-xs">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <h2 className="text-xl font-black text-navy-950">Funds Successfully Added!</h2>
              <p className="text-xs text-slate-600 mt-1">
                Your wallet balance has been credited atomically.
              </p>
            </div>

            <div className="p-4 bg-white rounded-xl border border-emerald-100 max-w-sm mx-auto text-left space-y-2 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Amount Credited:</span>
                <span className="font-bold text-navy-900">
                  <AmountDisplay paise={completedPayment.amount} size="sm" direction="CREDIT" showSign />
                </span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Order ID:</span>
                <span className="font-mono text-slate-700">{completedPayment.orderId}</span>
              </div>
              {completedPayment.paymentId && (
                <div className="flex justify-between text-slate-500">
                  <span>Payment ID:</span>
                  <span className="font-mono text-slate-700">{completedPayment.paymentId}</span>
                </div>
              )}
            </div>

            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/dashboard" className="w-full sm:w-auto">
                <Button variant="primary" size="md" className="w-full" rightIcon={<ArrowRight className="w-4 h-4" />}>
                  Go to Dashboard
                </Button>
              </Link>
              <Button variant="secondary" size="md" className="w-full sm:w-auto" onClick={resetFlow}>
                Add More Funds
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* VERIFYING / RECONCILING LOADING OVERLAY */}
      {(status === 'verifying' || status === 'reconciling') && (
        <Card className="border-cobalt-200 bg-cobalt-50/30">
          <CardContent className="p-8 text-center space-y-3">
            <Spinner size="lg" className="mx-auto text-cobalt-600" />
            <h2 className="text-base font-bold text-navy-900">
              {status === 'verifying' ? 'Verifying Gateway Signature...' : 'Reconciling Payment Status...'}
            </h2>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Confirming cryptographic HMAC signature with backend ledger. Please do not close this window.
            </p>
          </CardContent>
        </Card>
      )}

      {/* MAIN TOP-UP FORM */}
      {status !== 'success' && status !== 'verifying' && status !== 'reconciling' && (
        <Card>
          <CardHeader>
            <CardTitle>Top-Up Amount</CardTitle>
            <CardDescription>Select a quick amount or enter a custom Rupee value</CardDescription>
          </CardHeader>

          <CardContent className="p-6">
            {/* Error banner with reconcile action */}
            {errorMessage && (
              <Alert variant="error" className="mb-5" onClose={() => setErrorMessage(null)}>
                <div className="space-y-2">
                  <p>{errorMessage}</p>
                  {activeOrder && (
                    <div className="pt-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                        onClick={() => handleReconcileStatus(activeOrder.orderId)}
                      >
                        Recheck Payment Status
                      </Button>
                    </div>
                  )}
                </div>
              </Alert>
            )}

            {/* Info banner */}
            {infoMessage && (
              <Alert variant="info" className="mb-5" onClose={() => setInfoMessage(null)}>
                {infoMessage}
              </Alert>
            )}

            {/* Quick Preset Buttons */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5 mb-5">
              {PRESET_AMOUNTS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handlePresetClick(preset)}
                  disabled={status === 'creating_order'}
                  className={`py-2 px-3 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                    rupees === String(preset)
                      ? 'bg-cobalt-600 text-white border-cobalt-600 shadow-sm'
                      : 'bg-white text-navy-900 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  ₹{preset}
                </button>
              ))}
            </div>

            <form onSubmit={handleInitiateAddMoney} className="space-y-4">
              <Input
                label="Amount in Rupees (₹)"
                type="number"
                id="add-amount"
                required
                step="0.01"
                min="10"
                max="10000"
                placeholder="500.00"
                value={rupees}
                onChange={(e) => {
                  setRupees(e.target.value);
                  setErrorMessage(null);
                }}
                leftIcon={<span className="text-sm font-bold text-slate-500">₹</span>}
                disabled={status === 'creating_order'}
                helperText="Minimum ₹10.00 (1,000 paise) • Maximum ₹10,000.00 (1,000,000 paise)"
              />

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/60 flex items-start gap-3 text-xs text-slate-500">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  Payments are processed via Razorpay Test Mode. Verification uses strict timing-safe HMAC signatures before crediting your ledger balance.
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full mt-4"
                isLoading={status === 'creating_order'}
                disabled={status === 'creating_order'}
                leftIcon={<CreditCard className="w-4 h-4" />}
              >
                {status === 'creating_order' ? 'Initializing Order...' : 'Proceed to Checkout'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Security note card */}
      <div className="flex items-center justify-between text-xs text-slate-400 px-2">
        <span className="flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-slate-400" />
          Zero client-side secrets • Authenticated gateway orders only
        </span>
        <span className="font-mono text-[11px]">INR Currency</span>
      </div>
    </div>
  );
}

export default AddMoneyPage;
