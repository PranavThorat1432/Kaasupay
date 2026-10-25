import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Send,
  CheckCircle2,
  Shield,
  RefreshCw,
  Search,
  Copy,
  Check,
  X,
  FileText,
} from 'lucide-react';
import { useAuth, useWallet, useAppDispatch, useToast } from '../store/hooks';
import { executeTransfer, fetchWalletBalance } from '../store/slices/walletSlice';
import { fetchTransactionHistory } from '../store/slices/transactionSlice';
import authService from '../services/authService';
import Card, { CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import Badge from '../components/ui/Badge';
import AmountDisplay from '../components/ui/AmountDisplay';
import Spinner from '../components/ui/Spinner';
import Dialog, { DialogFooter } from '../components/ui/Dialog';
import PinModal from '../components/security/PinModal';
import { fetchDailyLimits } from '../store/slices/walletSlice';
import { rupeesToPaise } from '../utils/currency';
import { generateIdempotencyKey } from '../utils/idempotency';

const PRESET_AMOUNTS = [50, 100, 500, 1000, 2000];

export function TransferPage() {
  const dispatch = useAppDispatch();
  const { user: currentUser } = useAuth();
  const { balance } = useWallet();
  const toast = useToast();

  const [to, setTo] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const [rupees, setRupees] = useState('');
  const [note, setNote] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => generateIdempotencyKey('transfer'));
  const [errorMsg, setErrorMsg] = useState(null);
  const [successData, setSuccessData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedTxId, setCopiedTxId] = useState(false);

  // Review confirmation modal & idempotency reconciliation states
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [pendingTransfer, setPendingTransfer] = useState(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [pinErrorDetails, setPinErrorDetails] = useState(null);

  const searchDebounceRef = useRef(null);
  const dropdownRef = useRef(null);

  // Debounced search for recipient autocomplete
  useEffect(() => {
    const query = to.trim();
    if (!query || selectedRecipient) {
      return;
    }

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await authService.searchUsers(query);
        // Exclude current user from search results
        const filtered = (res.users || []).filter(
          (u) => u.username.toLowerCase() !== currentUser?.username?.toLowerCase()
        );
        setSearchResults(filtered);
        setShowDropdown(filtered.length > 0);
      } catch {
        setSearchResults([]);
        setShowDropdown(false);
      } finally {
        setIsSearching(false);
      }
    }, 280);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [to, selectedRecipient, currentUser]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectRecipient = (user) => {
    setSelectedRecipient(user);
    setTo(user.username);
    setShowDropdown(false);
    setErrorMsg(null);
  };

  const handleClearRecipient = () => {
    setSelectedRecipient(null);
    setTo('');
    setShowDropdown(false);
  };

  const resetForm = () => {
    setSelectedRecipient(null);
    setTo('');
    setRupees('');
    setNote('');
    setIdempotencyKey(generateIdempotencyKey('transfer'));
    setErrorMsg(null);
    setSuccessData(null);
    setPendingTransfer(null);
    setIsConfirmOpen(false);
    setIsPinModalOpen(false);
    setPinErrorDetails(null);
  };

  const handleCopyTxId = (id) => {
    if (!id) return;
    navigator.clipboard.writeText(id);
    setCopiedTxId(true);
    setTimeout(() => setCopiedTxId(false), 2000);
  };

  // Step 1: Form Validation & Opening the Review Dialog (no transfer dispatched)
  const handleInitiateReview = (e) => {
    if (e && e.preventDefault) {
      e.preventDefault();
    }
    setErrorMsg(null);
    setSuccessData(null);

    const recipientEmail = to.trim().toLowerCase();

    if (!recipientEmail) {
      setErrorMsg('Please specify the recipient email address');
      return;
    }

    if (recipientEmail === currentUser?.username?.toLowerCase()) {
      setErrorMsg('Cannot transfer money to yourself');
      return;
    }

    let amountInPaise;
    try {
      amountInPaise = rupeesToPaise(rupees);
    } catch (err) {
      setErrorMsg(err.message);
      return;
    }

    if (amountInPaise < 100 || amountInPaise > 1000000) {
      setErrorMsg('Transfer amount must be between ₹1.00 and ₹10,000.00 (100 to 1,000,000 paise)');
      return;
    }

    if (amountInPaise > balance) {
      setErrorMsg('Insufficient wallet balance for this transfer');
      return;
    }

    // Set validated payload and open review dialog
    setPendingTransfer({
      recipientEmail,
      recipientName: selectedRecipient
        ? `${selectedRecipient.firstName} ${selectedRecipient.lastName}`.trim()
        : recipientEmail,
      amountInPaise,
      note: note.trim() || undefined,
    });
    setIsConfirmOpen(true);
  };

  // Cancel confirmation: closes modal, sends NO network request, preserves balances
  const handleCancelConfirmation = () => {
    if (isLoading) return; // Prevent cancelling mid-request
    setIsConfirmOpen(false);
  };

  // Step 2: Explicit Confirmation Action (triggers PIN verification if configured)
  const handleConfirmTransfer = () => {
    if (!pendingTransfer || isLoading) return;
    setIsConfirmOpen(false);
    if (currentUser?.hasPin) {
      setPinErrorDetails(null);
      setIsPinModalOpen(true);
    } else {
      executeTransferRequest(null);
    }
  };

  // Step 3: Dispatch transfer with optional PIN
  const executeTransferRequest = async (pinValue) => {
    if (!pendingTransfer || isLoading) return;

    setIsLoading(true);
    setErrorMsg(null);

    const { recipientEmail, recipientName, amountInPaise, note: transferNote } = pendingTransfer;

    try {
      const resultAction = await dispatch(
        executeTransfer({
          to: recipientEmail,
          amount: amountInPaise,
          note: transferNote,
          idempotencyKey,
          pin: pinValue || undefined,
        })
      );

      if (executeTransfer.fulfilled.match(resultAction)) {
        setIsPinModalOpen(false);
        setPinErrorDetails(null);
        setPendingTransfer(null);
        setSuccessData({
          ...resultAction.payload,
          to: recipientEmail,
          recipientName,
          amount: amountInPaise,
          note: transferNote,
          timestamp: new Date().toISOString(),
        });
        toast.success(`Successfully sent ₹${rupees} to ${recipientEmail}`);
        dispatch(fetchWalletBalance());
        dispatch(fetchDailyLimits());
        dispatch(fetchTransactionHistory({ page: 1, limit: 10 }));
      } else {
        const payload = resultAction.payload || {};
        if (isPinModalOpen || pinValue) {
          // If error was wrong PIN (403) or locked (423), show in PinModal
          setPinErrorDetails({
            status: payload.status,
            message: payload.message || 'Verification failed',
            triesLeft: payload.triesLeft,
            retryAfterSeconds: payload.retryAfterSeconds,
          });
          if (payload.status === 400 && payload.leftToday !== undefined) {
            // Daily limit exceeded
            setIsPinModalOpen(false);
            setErrorMsg(`Daily limit exceeded. Remaining limit today: ₹${(payload.leftToday / 100).toFixed(2)}`);
          }
        } else {
          setErrorMsg(payload.message || 'Transfer rejected by backend');
        }
      }
    } catch (err) {
      if (isPinModalOpen) {
        setPinErrorDetails({ message: err.message || 'Transfer failed' });
      } else {
        setErrorMsg(err.message || 'An unexpected error occurred during transfer');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Safe reconciliation for uncertain outcomes or network dropouts
  const handleReconcileBalance = async () => {
    setIsReconciling(true);
    try {
      await Promise.all([
        dispatch(fetchWalletBalance()).unwrap(),
        dispatch(fetchTransactionHistory({ page: 1, limit: 10 })).unwrap(),
      ]);
      toast.success('Wallet balance and ledger synchronized');
    } catch {
      toast.error('Failed to sync ledger from server');
    } finally {
      setIsReconciling(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-navy-950 tracking-tight">Send Money</h1>
        <p className="text-xs text-slate-500 mt-1">
          Atomic peer-to-peer transfer protected by cryptographic idempotency
        </p>
      </div>

      {/* Available Balance Banner */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Available Balance
        </span>
        <AmountDisplay paise={balance} size="lg" />
      </div>

      {/* SUCCESS CONFIRMATION RECEIPT */}
      {successData ? (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="p-6 sm:p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200 shadow-xs">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <h2 className="text-xl font-black text-navy-950">Transfer Completed</h2>
              <p className="text-xs text-slate-600 mt-1">
                {successData.message || 'Funds transferred atomically in a single MongoDB transaction.'}
              </p>
            </div>

            {/* Receipt Summary Card */}
            <div className="p-5 bg-white rounded-2xl border border-emerald-100 max-w-md mx-auto text-left space-y-3 text-xs shadow-xs">
              <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                <span className="text-slate-500">Amount Sent:</span>
                <span className="font-bold text-navy-950 text-sm">
                  <AmountDisplay paise={successData.amount} size="md" direction="DEBIT" showSign />
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">Recipient:</span>
                <div className="text-right">
                  <p className="font-bold text-navy-900">{successData.recipientName}</p>
                  <p className="font-mono text-[11px] text-slate-500">{successData.to}</p>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-500">Transaction ID:</span>
                <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-700">
                  <span className="truncate max-w-42.5">{successData.transactionId}</span>
                  <button
                    type="button"
                    onClick={() => handleCopyTxId(successData.transactionId)}
                    className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 cursor-pointer"
                    title="Copy Transaction ID"
                  >
                    {copiedTxId ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">New Available Balance:</span>
                <span className="font-bold text-emerald-600 font-mono">
                  <AmountDisplay paise={successData.senderBalance} size="sm" />
                </span>
              </div>

              {successData.note && (
                <div className="pt-2 border-t border-slate-100 flex justify-between">
                  <span className="text-slate-500">Note:</span>
                  <span className="text-navy-900 font-medium italic">"{successData.note}"</span>
                </div>
              )}
            </div>

            <div className="pt-3 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button variant="primary" size="md" className="w-full sm:w-auto" onClick={resetForm}>
                Send Another Payment
              </Button>
              <Link to="/transactions" className="w-full sm:w-auto">
                <Button
                  variant="secondary"
                  size="md"
                  className="w-full sm:w-auto"
                  rightIcon={<FileText className="w-4 h-4" />}
                >
                  View Audit Ledger
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* MAIN TRANSFER FORM */
        <Card>
          <CardHeader>
            <CardTitle>Transfer Details</CardTitle>
            <CardDescription>Search a verified member or enter recipient email address</CardDescription>
          </CardHeader>

          <CardContent className="p-6">
            {errorMsg && (
              <div className="space-y-3 mb-5">
                <Alert variant="error" onClose={() => setErrorMsg(null)}>
                  {errorMsg}
                </Alert>
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-slate-600">
                    <Shield className="w-4 h-4 text-cobalt-600 shrink-0" />
                    <span>Double-charge protection active. Safe to retry without paying twice.</span>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={isReconciling || isLoading}
                      onClick={handleReconcileBalance}
                      leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${isReconciling ? 'animate-spin' : ''}`} />}
                    >
                      {isReconciling ? 'Checking...' : 'Check Balance'}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      type="button"
                      disabled={isLoading}
                      onClick={handleInitiateReview}
                      leftIcon={<Send className="w-3.5 h-3.5" />}
                    >
                      Retry Review
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleInitiateReview} className="space-y-4">
              {/* Recipient Selection or Autocomplete Search */}
              <div ref={dropdownRef} className="relative">
                {selectedRecipient ? (
                  /* Confirmed Recipient Badge Card */
                  <div className="p-3.5 bg-cobalt-50/60 rounded-xl border border-cobalt-200 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-cobalt-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                        {selectedRecipient.firstName?.charAt(0)}
                        {selectedRecipient.lastName?.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-navy-900 truncate">
                            {selectedRecipient.firstName} {selectedRecipient.lastName}
                          </p>
                          <Badge variant="credit" size="sm">
                            Verified
                          </Badge>
                        </div>
                        <p className="text-[11px] font-mono text-slate-500 truncate">
                          {selectedRecipient.username}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearRecipient}
                      className="cursor-pointer text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-white transition-colors"
                      title="Change Recipient"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  /* Live Autocomplete Input */
                  <div>
                    <Input
                      label="Recipient (Name or Email)"
                      type="text"
                      id="transfer-to"
                      required
                      placeholder="Search member name or type email..."
                      value={to}
                      onChange={(e) => {
                        const val = e.target.value;
                        setTo(val);
                        setErrorMsg(null);
                        if (!val.trim()) {
                          setSearchResults([]);
                          setShowDropdown(false);
                        }
                      }}
                      onFocus={() => {
                        if (searchResults.length > 0) setShowDropdown(true);
                      }}
                      leftIcon={<Search className="w-4 h-4" />}
                      rightIcon={isSearching ? <Spinner size="sm" /> : null}
                      disabled={isLoading}
                      helperText="Search verified KaasuPay users by first/last name, or enter email"
                    />

                    {/* Autocomplete Dropdown */}
                    {showDropdown && searchResults.length > 0 && (
                      <div className="absolute z-20 left-0 right-0 mt-1.5 bg-white rounded-xl border border-slate-200 shadow-lg max-h-56 overflow-y-auto">
                        <div className="divide-y divide-slate-100">
                          {searchResults.map((sr) => (
                          <button
                            key={sr._id || sr.username}
                            type="button"
                            onClick={() => handleSelectRecipient(sr)}
                            className="w-full p-3 text-left hover:bg-slate-50 flex items-center justify-between transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold shrink-0">
                                {sr.firstName?.charAt(0)}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-navy-900 truncate">
                                  {sr.firstName} {sr.lastName}
                                </p>
                                <p className="text-[11px] font-mono text-slate-400 truncate">
                                  {sr.username}
                                </p>
                              </div>
                            </div>
                            <span className="text-[11px] font-semibold text-cobalt-600 shrink-0">Select</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  </div>
                )}
              </div>

              {/* Amount Quick Presets */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-navy-900">
                  Quick Amount Presets
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {PRESET_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setRupees(String(amt))}
                      className={`py-1.5 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                        rupees === String(amt)
                          ? 'bg-cobalt-600 text-white border-cobalt-600 shadow-xs'
                          : 'bg-white text-navy-900 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      ₹{amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Rupee Amount */}
              <Input
                label="Amount in Rupees (₹)"
                type="number"
                id="transfer-amount"
                required
                step="0.01"
                min="1"
                max="10000"
                placeholder="100.00"
                value={rupees}
                onChange={(e) => {
                  setRupees(e.target.value);
                  setErrorMsg(null);
                }}
                leftIcon={<span className="text-sm font-bold text-slate-500">₹</span>}
                disabled={isLoading}
                helperText="Min ₹1.00 (100 paise) • Max ₹10,000.00 (1,000,000 paise)"
              />

              {/* Transfer Note */}
              <Input
                label="Payment Note (Optional)"
                type="text"
                id="transfer-note"
                maxLength={200}
                placeholder="Lunch, groceries, freelance work..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={isLoading}
              />

              {/* Idempotency Key Indicator */}
              <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-200/70 flex items-center justify-between text-xs text-emerald-950 font-sans">
                <div className="flex items-center gap-2 min-w-0">
                  <Shield className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-medium text-emerald-950">Double-Charge Protection Active</span>
                </div>
                <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-full">
                  Protected
                </span>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full mt-4"
                disabled={isLoading}
                leftIcon={<Send className="w-4 h-4" />}
              >
                Review Transfer
              </Button>
            </form>
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
        onConfirm={(enteredPin) => executeTransferRequest(enteredPin)}
        isLoading={isLoading}
        errorDetails={pinErrorDetails}
        amountPaise={pendingTransfer?.amountInPaise}
        title="Verify Payment PIN"
        description="Enter your secret payment PIN to authorize this transfer"
      />

      {/* CONFIRMATION REVIEW DIALOG */}
      <Dialog
        isOpen={isConfirmOpen}
        onClose={handleCancelConfirmation}
        title="Review & Confirm Transfer"
        description="Verify recipient and financial details before final execution"
      >
        {pendingTransfer && (
          <div className="space-y-4">
            {/* Recipient Identity Section */}
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-cobalt-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {pendingTransfer.recipientName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-navy-900 truncate">
                      {pendingTransfer.recipientName}
                    </p>
                    {selectedRecipient && (
                      <Badge variant="credit" size="sm">
                        Verified
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-slate-500 truncate">
                    {pendingTransfer.recipientEmail}
                  </p>
                </div>
              </div>
            </div>

            {/* Financial Breakdown Card */}
            <div className="p-4 bg-white rounded-xl border border-slate-200/80 text-xs">
              <div className="divide-y divide-slate-100">
                <div className="flex justify-between items-center pb-2.5">
                  <span className="text-slate-500">Transfer Amount</span>
                  <span className="font-bold text-navy-950 font-mono text-sm">
                    <AmountDisplay paise={pendingTransfer.amountInPaise} size="md" />
                  </span>
                </div>

                <div className="flex justify-between items-center py-2.5">
                  <span className="text-slate-500">Processing Fee</span>
                  <span className="font-bold text-emerald-600 font-mono">₹0.00 (Free)</span>
                </div>

                <div className="flex justify-between items-center py-2.5">
                  <span className="text-slate-500 font-semibold">Total to Debit</span>
                  <span className="font-black text-rose-600 font-mono text-sm">
                    <AmountDisplay paise={pendingTransfer.amountInPaise} size="md" direction="DEBIT" showSign />
                  </span>
                </div>

                <div className="flex justify-between items-center pt-2.5">
                  <span className="text-slate-500">Remaining Balance</span>
                  <span className="font-medium text-slate-700 font-mono">
                    <AmountDisplay paise={balance - pendingTransfer.amountInPaise} size="xs" />
                  </span>
                </div>
              </div>
            </div>

            {/* Optional Transfer Note */}
            {pendingTransfer.note && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 text-xs">
                <span className="text-slate-500 font-semibold">Note: </span>
                <span className="text-navy-900 italic font-medium">"{pendingTransfer.note}"</span>
              </div>
            )}

            {/* Security Guarantee Pill */}
            <div className="flex items-center gap-2 p-2.5 bg-cobalt-50/50 rounded-xl border border-cobalt-100/80 text-[11px] text-cobalt-800">
              <Shield className="w-4 h-4 text-cobalt-600 shrink-0" />
              <span className="truncate">
                Protected by single-use Idempotency Key:{' '}
                <span className="font-mono text-[10px]">{idempotencyKey.substring(0, 16)}...</span>
              </span>
            </div>

            <DialogFooter>
              <Button
                variant="secondary"
                size="md"
                type="button"
                onClick={handleCancelConfirmation}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                type="button"
                onClick={handleConfirmTransfer}
                isLoading={isLoading}
                disabled={isLoading}
                leftIcon={<Send className="w-4 h-4" />}
              >
                {isLoading ? 'Processing Transfer...' : 'Confirm Transfer'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </Dialog>
    </div>
  );
}

export default TransferPage;
