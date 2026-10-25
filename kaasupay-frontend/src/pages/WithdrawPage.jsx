import { useState, useEffect, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Landmark,
  ShieldCheck,
  CheckCircle2,
  Clock,
  RotateCcw,
  Building2,
  Copy,
  Check,
  ChevronRight,
  Plus,
  Info,
} from 'lucide-react';
import { useAuth, useWallet, useBank, useAppDispatch, useToast } from '../store/hooks';
import { fetchWalletBalance, fetchDailyLimits } from '../store/slices/walletSlice';
import {
  fetchBankAccounts,
  executeWithdrawal,
  pollWithdrawalStatus,
  resetWithdrawalState,
} from '../store/slices/bankSlice';
import Card, { CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Dialog, { DialogFooter } from '../components/ui/Dialog';
import Alert from '../components/ui/Alert';
import Badge from '../components/ui/Badge';
import AmountDisplay from '../components/ui/AmountDisplay';
import PinModal from '../components/security/PinModal';
import { rupeesToPaise } from '../utils/currency';
import { generateIdempotencyKey } from '../utils/idempotency';

const PRESET_AMOUNTS = [100, 500, 1000, 2000, 5000, 10000];
const MIN_WITHDRAW_PAISE = 10000; // ₹100
const MAX_WITHDRAW_PAISE = 2500000; // ₹25,000

export function WithdrawPage() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const { user } = useAuth();
  const { balance } = useWallet();
  const { accounts, accountsLoading, activeWithdrawal, withdrawLoading } = useBank();
  const toast = useToast();

  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [pinErrorDetails, setPinErrorDetails] = useState(null);

  const [selectedAccountId, setSelectedAccountId] = useState(
    () => location.state?.selectedAccountId || ''
  );
  const [step, setStep] = useState(
    () => (location.state?.selectedAccountId ? 2 : 1)
  );
  const [rupees, setRupees] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => generateIdempotencyKey('wd'));
  const [inputError, setInputError] = useState(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);
  const pollTimerRef = useRef(null);

  useEffect(() => {
    dispatch(fetchBankAccounts());
    dispatch(fetchWalletBalance());
  }, [dispatch]);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  useEffect(() => {
    if (step === 4 && activeWithdrawal?.id) {
      const isTerminal =
        activeWithdrawal.status === 'SUCCESS' ||
        activeWithdrawal.status === 'REVERSED' ||
        activeWithdrawal.status === 'NEEDS_REVIEW';

      if (isTerminal) {
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        dispatch(fetchWalletBalance());
        return;
      }

      pollTimerRef.current = setInterval(async () => {
        try {
          const res = await dispatch(pollWithdrawalStatus(activeWithdrawal.id)).unwrap();
          if (
            res.status === 'SUCCESS' ||
            res.status === 'REVERSED' ||
            res.status === 'NEEDS_REVIEW'
          ) {
            dispatch(fetchWalletBalance());
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        } catch {
          // ignore transient poll errors
        }
      }, 2000);
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [step, activeWithdrawal?.id, activeWithdrawal?.status, dispatch]);

  const handleSelectAccount = (id) => {
    setSelectedAccountId(id);
    setInputError(null);
  };

  const handleAmountChange = (val) => {
    setRupees(val);
    setInputError(null);
  };

  const handlePresetClick = (preset) => {
    setRupees(String(preset));
    setInputError(null);
  };

  const validateAmountStep = () => {
    const num = Number(rupees);
    if (!num || isNaN(num) || num <= 0) {
      setInputError('Please enter a valid withdrawal amount');
      return false;
    }

    const paise = rupeesToPaise(num);
    if (paise < MIN_WITHDRAW_PAISE) {
      setInputError('Withdrawal amount must be at least ₹100 (10,000 paise)');
      return false;
    }

    if (paise > MAX_WITHDRAW_PAISE) {
      setInputError('Withdrawal amount cannot exceed ₹25,000 (2,500,000 paise)');
      return false;
    }

    if (paise > balance) {
      setInputError('Insufficient wallet balance');
      return false;
    }

    return true;
  };

  const handleProceedToReview = () => {
    if (!selectedAccountId) {
      toast.error('Please select a bank account');
      return;
    }
    if (!validateAmountStep()) return;
    setIsConfirmOpen(true);
  };

  const handleConfirmWithdrawal = () => {
    setIsConfirmOpen(false);
    if (user?.hasPin) {
      setPinErrorDetails(null);
      setIsPinModalOpen(true);
    } else {
      executeWithdrawalRequest(null);
    }
  };

  const executeWithdrawalRequest = async (pinValue) => {
    const amountInPaise = rupeesToPaise(Number(rupees));

    try {
      const res = await dispatch(
        executeWithdrawal({
          bankAccountId: selectedAccountId,
          amount: amountInPaise,
          idempotencyKey,
          pin: pinValue || undefined,
        })
      );

      if (executeWithdrawal.fulfilled.match(res)) {
        setIsPinModalOpen(false);
        setPinErrorDetails(null);
        toast.info('Withdrawal submitted. Processing payout...');
        setStep(4);
        dispatch(fetchWalletBalance());
        dispatch(fetchDailyLimits());
      } else {
        const payload = res.payload || {};
        if (isPinModalOpen || pinValue) {
          setPinErrorDetails({
            status: payload.status,
            message: payload.message || 'Withdrawal verification failed',
            triesLeft: payload.triesLeft,
            retryAfterSeconds: payload.retryAfterSeconds,
          });
          if (payload.status === 400 && payload.leftToday !== undefined) {
            setIsPinModalOpen(false);
            toast.error(`Daily limit exceeded. Remaining limit today: ₹${(payload.leftToday / 100).toFixed(2)}`);
          }
        } else {
          toast.error(payload.message || 'Failed to submit withdrawal request');
        }
      }
    } catch (err) {
      if (isPinModalOpen) {
        setPinErrorDetails({ message: err.message || 'Withdrawal failed' });
      } else {
        toast.error(err.message || 'Failed to submit withdrawal request');
      }
    }
  };

  const handleReset = () => {
    dispatch(resetWithdrawalState());
    setStep(1);
    setRupees('');
    setSelectedAccountId('');
    setInputError(null);
    setIdempotencyKey(generateIdempotencyKey('wd'));
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 2000);
    toast.success('Copied to clipboard');
  };

  const amountPaise = rupees ? rupeesToPaise(Number(rupees)) : 0;
  const remainingPaise = Math.max(0, balance - amountPaise);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Wizard Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy-900 tracking-tight flex items-center gap-2.5">
            <ArrowUpRight className="w-7 h-7 text-cobalt-600" />
            Withdraw Money
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Send money from your KaasuPay balance directly to your verified bank account.
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 bg-slate-100 p-1.5 rounded-xl">
          <span className={`px-2.5 py-1 rounded-lg ${step === 1 ? 'bg-white text-cobalt-700 shadow-xs' : ''}`}>1. Account</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          <span className={`px-2.5 py-1 rounded-lg ${step === 2 ? 'bg-white text-cobalt-700 shadow-xs' : ''}`}>2. Amount</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          <span className={`px-2.5 py-1 rounded-lg ${step >= 3 ? 'bg-white text-cobalt-700 shadow-xs' : ''}`}>3. Payout</span>
        </div>
      </div>

      {/* Available Balance Header Card */}
      <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
        <div>
          <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            Available Wallet Balance
          </span>
          <div className="mt-1">
            <AmountDisplay paise={balance} size="xl" className="text-navy-900 font-mono" />
          </div>
        </div>

        <Link to="/bank-accounts">
          <Button variant="secondary" size="sm" leftIcon={<Landmark className="w-3.5 h-3.5" />} className="text-xs font-semibold">
            Manage Accounts
          </Button>
        </Link>
      </div>


      {/* STEP 1: CHOOSE BANK ACCOUNT */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Landmark className="w-5 h-5 text-cobalt-600" />
              Step 1: Select Destination Bank Account
            </CardTitle>
            <CardDescription>
              Choose where you want the payout transferred.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 pt-0">
            {accountsLoading ? (
              <div className="space-y-3">
                <div className="h-20 bg-slate-100 rounded-xl animate-pulse" />
                <div className="h-20 bg-slate-100 rounded-xl animate-pulse" />
              </div>
            ) : accounts.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                <Building2 className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-navy-900">No bank accounts linked</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  You need at least one verified bank account to withdraw money.
                </p>
                <div className="mt-4">
                  <Link to="/bank-accounts">
                    <Button variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />} className="bg-cobalt-600">
                      Link Bank Account
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {accounts.map((acc) => {
                  const isSelected = selectedAccountId === acc.id;
                  return (
                    <div
                      key={acc.id}
                      onClick={() => handleSelectAccount(acc.id)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? 'border-cobalt-600 bg-cobalt-50/50 shadow-xs ring-2 ring-cobalt-600/20'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/70'
                      }`}
                    >
                      <div className="flex items-center gap-3.5">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                            isSelected ? 'bg-cobalt-600 text-white' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          <Building2 className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-navy-900">{acc.holderName}</p>
                          <p className="text-xs font-mono text-slate-500">{acc.account} • {acc.ifsc}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isSelected && (
                          <span className="text-xs font-bold text-cobalt-600 bg-cobalt-100 px-2.5 py-1 rounded-full">
                            Selected
                          </span>
                        )}
                        <input
                          type="radio"
                          name="bankAccount"
                          checked={isSelected}
                          onChange={() => handleSelectAccount(acc.id)}
                          className="w-4 h-4 text-cobalt-600 focus:ring-cobalt-500 cursor-pointer"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-4 flex items-center justify-between">
              <Link to="/bank-accounts">
                <Button variant="ghost" size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />}>
                  Add another account
                </Button>
              </Link>

              <Button
                variant="primary"
                size="md"
                disabled={!selectedAccountId}
                onClick={() => setStep(2)}
                className="bg-cobalt-600 hover:bg-cobalt-700"
              >
                Continue to Amount
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 2: ENTER AMOUNT */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowUpRight className="w-5 h-5 text-cobalt-600" />
              Step 2: Enter Withdrawal Amount
            </CardTitle>
            <CardDescription>
              Sending to: <span className="font-semibold text-navy-900">{selectedAccount?.holderName}</span> ({selectedAccount?.account})
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5 pt-0">
            {inputError && (
              <Alert variant="error" title="Invalid Amount">
                {inputError}
              </Alert>
            )}

            <div>
              <Input
                label="Amount (in INR)"
                type="number"
                min="100"
                max="25000"
                step="1"
                placeholder="₹0.00"
                value={rupees}
                onChange={(e) => handleAmountChange(e.target.value)}
                error={inputError}
                autoFocus
              />
              <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1.5 font-mono">
                <span>Minimum: ₹100.00 (10,000 paise)</span>
                <span>Maximum: ₹25,000.00 (2,500,000 paise)</span>
              </div>
            </div>

            {/* Quick Amount Pills */}
            <div>
              <span className="text-xs text-slate-500 font-semibold block mb-2">Quick Amounts</span>
              <div className="flex flex-wrap gap-2">
                {PRESET_AMOUNTS.map((preset) => {
                  const presetPaise = preset * 100;
                  const isExceeding = presetPaise > balance;
                  return (
                    <button
                      key={preset}
                      type="button"
                      disabled={isExceeding}
                      onClick={() => handlePresetClick(preset)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                        Number(rupees) === preset
                          ? 'bg-cobalt-600 text-white border-cobalt-600 shadow-xs'
                          : isExceeding
                          ? 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      ₹{preset.toLocaleString()}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Balance Calculation Box */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Requested Withdrawal:</span>
                <span className="font-mono font-bold text-navy-900">
                  <AmountDisplay paise={amountPaise} size="sm" />
                </span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Transfer Processing Fee:</span>
                <span className="font-mono font-bold text-emerald-600">₹0.00 (Free)</span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between font-bold">
                <span className="text-navy-900">Remaining Wallet Balance:</span>
                <span className="font-mono text-navy-900">
                  <AmountDisplay paise={remainingPaise} size="sm" />
                </span>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between">
              <Button variant="secondary" size="md" onClick={() => setStep(1)}>
                Back
              </Button>

              <Button
                variant="primary"
                size="md"
                onClick={handleProceedToReview}
                className="bg-cobalt-600 hover:bg-cobalt-700"
              >
                Review & Confirm
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 4: PROCESSING & STATUS OUTCOME */}
      {step === 4 && (
        <Card className="max-w-2xl mx-auto border-slate-200">
          <CardContent className="p-8 text-center space-y-6">
            {activeWithdrawal?.status === 'SUCCESS' ? (
              /* CONFIRMED SUCCESS */
              <div className="space-y-4">
                <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
                  <CheckCircle2 className="w-9 h-9" />
                </div>
                <div>
                  <Badge variant="credit" size="md" className="font-bold">
                    PAYOUT CONFIRMED
                  </Badge>
                  <h3 className="text-xl font-extrabold text-navy-900 mt-2">
                    Money Disbursed to Bank
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    The bank has processed the transfer and credited your beneficiary account.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-2.5 max-w-md mx-auto text-left">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Amount Paid:</span>
                    <span className="font-mono font-bold text-emerald-600">
                      <AmountDisplay paise={activeWithdrawal.amount} size="sm" />
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Destination Account:</span>
                    <span className="font-mono font-semibold text-navy-900">
                      {activeWithdrawal.account || selectedAccount?.account}
                    </span>
                  </div>
                  {activeWithdrawal.bankRef && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Bank UTR Reference:</span>
                      <div className="flex items-center gap-1 font-mono font-bold text-navy-900">
                        <span>{activeWithdrawal.bankRef}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(activeWithdrawal.bankRef)}
                          className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600"
                        >
                          {copiedRef ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Link to="/transactions">
                    <Button variant="secondary" size="md">
                      View Transaction History
                    </Button>
                  </Link>
                  <Button variant="primary" size="md" onClick={handleReset} className="bg-cobalt-600">
                    Make Another Withdrawal
                  </Button>
                </div>
              </div>
            ) : activeWithdrawal?.status === 'REVERSED' ? (
              /* DEFINITIVE BANK REFUSAL & COMPENSATING REVERSAL */
              <div className="space-y-4">
                <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
                  <RotateCcw className="w-9 h-9" />
                </div>
                <div>
                  <Badge variant="debit" size="md" className="font-bold">
                    PAYOUT REVERSED & REFUNDED
                  </Badge>
                  <h3 className="text-xl font-extrabold text-navy-900 mt-2">
                    Bank Rejected the Transfer
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    Reason: <span className="font-semibold text-rose-600">{activeWithdrawal.failureReason || 'Account closed or invalid'}</span>
                  </p>
                </div>

                <Alert variant="info" title="Automatic Wallet Credit Applied">
                  The withdrawal was reversed. The entire amount has been credited back to your wallet ledger. No funds were lost.
                </Alert>

                <div className="pt-2 flex items-center justify-center gap-3">
                  <Button variant="secondary" size="md" onClick={handleReset}>
                    Try Another Account
                  </Button>
                  <Link to="/dashboard">
                    <Button variant="primary" size="md" className="bg-navy-900">
                      Go to Dashboard
                    </Button>
                  </Link>
                </div>
              </div>
            ) : activeWithdrawal?.status === 'NEEDS_REVIEW' ? (
              /* AMBIGUOUS MAXIMUM RETRIES - SAFE PARKING */
              <div className="space-y-4">
                <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
                  <Clock className="w-9 h-9" />
                </div>
                <div>
                  <Badge variant="neutral" size="md" className="font-bold text-amber-800 bg-amber-100">
                    NEEDS STAFF REVIEW
                  </Badge>
                  <h3 className="text-xl font-extrabold text-navy-900 mt-2">
                    Bank Response Pending Verification
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
                    The bank did not answer definitively after 5 retry attempts. For your safety, the funds are held securely in escrow while our staff verifies the UTR status.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-left space-y-2">
                  <p className="font-semibold text-navy-900">What happens next?</p>
                  <ul className="list-disc list-inside space-y-1 text-slate-600">
                    <li>Our operations team will contact the clearing bank with reference <span className="font-mono font-bold">{activeWithdrawal.reference || activeWithdrawal.id}</span>.</li>
                    <li>If the bank confirms the payout, the status will update to <span className="text-emerald-600 font-bold">SUCCESS</span>.</li>
                    <li>If the bank confirms no payout was made, your wallet will automatically be credited.</li>
                  </ul>
                </div>

                <div className="pt-2 flex items-center justify-center gap-3">
                  <Link to="/dashboard">
                    <Button variant="primary" size="md" className="bg-navy-900">
                      Return to Dashboard
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              /* IN-PROGRESS / PENDING STATE */
              <div className="space-y-4 py-4">
                <div className="w-14 h-14 rounded-full border-4 border-cobalt-200 border-t-cobalt-600 animate-spin mx-auto" />
                <div>
                  <Badge variant="neutral" size="sm" className="font-mono">
                    202 ACCEPTED • PROCESSING
                  </Badge>
                  <h3 className="text-lg font-bold text-navy-900 mt-2">
                    Coordinating with Banking Network
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
                    Money has been debited from your wallet. Our durable outbox worker is communicating with the bank partner.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 text-xs font-mono max-w-md mx-auto space-y-2 text-left">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Withdrawal ID:</span>
                    <span className="text-slate-700 truncate max-w-[200px]">{activeWithdrawal?.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Idempotency Key:</span>
                    <span className="text-slate-700 truncate max-w-[200px]">{idempotencyKey}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Status:</span>
                    <span className="text-amber-600 font-bold">{activeWithdrawal?.status || 'PENDING'}</span>
                  </div>
                </div>

                <p className="text-[11px] text-slate-400">
                  Checking for bank confirmation every 2 seconds...
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Payment PIN Verification Modal (Day 6) */}
      <PinModal
        isOpen={isPinModalOpen}
        onClose={() => {
          setIsPinModalOpen(false);
          setPinErrorDetails(null);
        }}
        onConfirm={(enteredPin) => executeWithdrawalRequest(enteredPin)}
        isLoading={withdrawLoading}
        errorDetails={pinErrorDetails}
        amountPaise={rupees ? rupeesToPaise(Number(rupees)) : null}
        title="Verify Payment PIN"
        description="Enter your secret payment PIN to authorize this bank withdrawal"
      />

      {/* CONFIRMATION REVIEW DIALOG (Step 3) */}
      <Dialog
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        title="Review Withdrawal Request"
        description="Please confirm details before dispatching to the bank"
        maxWidth="max-w-md"
      >
        <div className="space-y-4 text-xs">
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-500">Destination Account:</span>
              <span className="font-mono font-bold text-navy-900">
                {selectedAccount?.account}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Account Holder:</span>
              <span className="font-bold text-navy-900">{selectedAccount?.holderName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Bank IFSC:</span>
              <span className="font-mono font-bold text-navy-900">{selectedAccount?.ifsc}</span>
            </div>
            <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
              <span className="text-slate-700 font-bold">Withdrawal Amount:</span>
              <span className="font-mono text-base font-extrabold text-navy-900">
                ₹{Number(rupees).toLocaleString()}
              </span>
            </div>
          </div>

          <div className="p-3 bg-amber-50 rounded-xl border border-amber-200/80 flex items-start gap-2.5 text-[11px] text-amber-800">
            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Funds are held immediately upon submission (HTTP 202). Payout completion depends on bank clearing rails. You can track status in your ledger history.
            </span>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsConfirmOpen(false)}
              disabled={withdrawLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              isLoading={withdrawLoading}
              onClick={handleConfirmWithdrawal}
              className="bg-cobalt-600 hover:bg-cobalt-700"
            >
              Confirm & Withdraw
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </div>
  );
}

export default WithdrawPage;
