import { useState, useEffect, useRef } from 'react';
import { Search, UserCheck, X, Calendar, AlertCircle } from 'lucide-react';
import Dialog, { DialogFooter } from '../ui/Dialog';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import PinModal from '../security/PinModal';
import authService from '../../services/authService';
import autopayService from '../../services/autopayService';
import { useAuth, useToast } from '../../store/hooks';
import { rupeesToPaise } from '../../utils/currency';

const QUICK_AMOUNTS = [100, 250, 500, 1000, 2000];

export function CreateMandateModal({
  isOpen,
  onClose,
  onSuccess,
}) {
  const { user: currentUser } = useAuth();
  const toast = useToast();

  const [toQuery, setToQuery] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const [rupees, setRupees] = useState('');
  const [dayOfMonth, setDayOfMonth] = useState(5);
  const [errorMsg, setErrorMsg] = useState(null);

  // PIN Step-up modal state
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pinErrorDetails, setPinErrorDetails] = useState(null);

  const searchDebounceRef = useRef(null);
  const dropdownRef = useRef(null);

  // Debounced search for recipient autocomplete
  useEffect(() => {
    const query = toQuery.trim();
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
        // Exclude current authenticated user
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
  }, [toQuery, selectedRecipient, currentUser]);

  // Close dropdown on click outside
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
    setToQuery(user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user.username);
    setShowDropdown(false);
    setErrorMsg(null);
  };

  const handleClearRecipient = () => {
    setSelectedRecipient(null);
    setToQuery('');
    setShowDropdown(false);
  };

  const handleReset = () => {
    setToQuery('');
    setSelectedRecipient(null);
    setRupees('');
    setDayOfMonth(5);
    setErrorMsg(null);
    setIsPinModalOpen(false);
    setIsSubmitting(false);
    setPinErrorDetails(null);
    onClose();
  };

  // Step 1: Validate form inputs and proceed to PIN authorization
  const handleProceedToPin = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setErrorMsg(null);

    if (!selectedRecipient) {
      setErrorMsg('Please select a recipient from the search results');
      return;
    }

    let paiseAmount = 0;
    try {
      paiseAmount = rupeesToPaise(rupees);
    } catch (err) {
      setErrorMsg(err.message || 'Please enter a valid amount');
      return;
    }

    if (paiseAmount < 100 || paiseAmount > 500000) {
      setErrorMsg('Monthly AutoPay amount must be between ₹1 and ₹5,000');
      return;
    }

    const dayNum = parseInt(dayOfMonth, 10);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 28) {
      setErrorMsg('Payment day must be between 1 and 28');
      return;
    }

    setPinErrorDetails(null);
    setIsPinModalOpen(true);
  };

  // Step 2: Final Submission with PIN to backend
  const handleConfirmPin = async (pin) => {
    if (!selectedRecipient || isSubmitting) return;

    let paiseAmount = 0;
    try {
      paiseAmount = rupeesToPaise(rupees);
    } catch {
      return;
    }

    setIsSubmitting(true);
    setPinErrorDetails(null);

    try {
      const res = await autopayService.createMandate({
        to: selectedRecipient._id || selectedRecipient.id,
        amount: paiseAmount,
        dayOfMonth: parseInt(dayOfMonth, 10),
        pin,
      });

      toast.success(res.message || 'AutoPay mandate set up successfully');
      handleReset();
      if (onSuccess) {
        onSuccess(res.mandate);
      }
    } catch (err) {
      const status = err.status || err.response?.status;
      const data = err.data || err.response?.data || {};

      if (status === 403) {
        setPinErrorDetails({
          status: 403,
          message: data.message || 'Wrong PIN',
          triesLeft: data.triesLeft,
        });
      } else if (status === 423) {
        setPinErrorDetails({
          status: 423,
          message: data.message || 'Account locked',
          retryAfterSeconds: data.retryAfterSeconds || 300,
        });
      } else {
        setIsPinModalOpen(false);
        setErrorMsg(data.message || data.error || err.message || 'Failed to set up AutoPay');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  let parsedPaise = 0;
  try {
    if (rupees) parsedPaise = rupeesToPaise(rupees);
  } catch {
    parsedPaise = 0;
  }

  return (
    <>
      <Dialog
        isOpen={isOpen && !isPinModalOpen}
        onClose={handleReset}
        title="Set up AutoPay"
        description="Schedule automated monthly payments from your KaasuPay wallet"
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleProceedToPin} className="space-y-4 pt-2">
          {errorMsg && (
            <Alert variant="danger" icon={<AlertCircle className="w-4 h-4 shrink-0" />}>
              <span className="text-xs font-semibold">{errorMsg}</span>
            </Alert>
          )}

          {/* Recipient Search Autocomplete */}
          <div className="relative" ref={dropdownRef}>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Recipient <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Input
                type="text"
                placeholder="Search by name, email or username..."
                value={toQuery}
                onChange={(e) => {
                  setToQuery(e.target.value);
                  if (selectedRecipient) setSelectedRecipient(null);
                }}
                leftIcon={<Search className="w-4 h-4 text-slate-400" />}
                rightIcon={
                  selectedRecipient ? (
                    <button
                      type="button"
                      onClick={handleClearRecipient}
                      className="text-slate-400 hover:text-slate-600 p-0.5"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  ) : null
                }
              />
            </div>

            {/* Recipient Autocomplete Dropdown */}
            {showDropdown && searchResults.length > 0 && !selectedRecipient && (
              <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-52 overflow-y-auto divide-y divide-slate-100">
                {searchResults.map((user) => (
                  <button
                    key={user._id || user.id}
                    type="button"
                    onClick={() => handleSelectRecipient(user)}
                    className="w-full text-left p-3 hover:bg-slate-50 flex items-center justify-between text-xs transition-colors"
                  >
                    <div>
                      <p className="font-bold text-navy-900">
                        {user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user.username}
                      </p>
                      <p className="text-[11px] text-slate-400 font-mono">{user.username}</p>
                    </div>
                    <UserCheck className="w-4 h-4 text-emerald-500" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Amount in Rupees */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Monthly Amount (₹) <span className="text-rose-500">*</span>
            </label>
            <Input
              type="number"
              placeholder="0.00"
              step="any"
              min="1"
              max="5000"
              value={rupees}
              onChange={(e) => setRupees(e.target.value)}
              prefix="₹"
            />
            {/* Quick Presets */}
            <div className="flex flex-wrap gap-2 mt-2">
              {QUICK_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setRupees(String(amt))}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-cobalt-50 hover:text-cobalt-700 transition-colors"
                >
                  ₹{amt}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Allowed range: ₹1.00 to ₹5,000.00</p>
          </div>

          {/* Day of Month Selector (1 - 28) */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              Day of Every Month <span className="text-rose-500">*</span>
            </label>
            <select
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(parseInt(e.target.value, 10))}
              className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-navy-900 focus:outline-none focus:ring-2 focus:ring-cobalt-500"
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>
                  Day {day} of every month
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              Days 1–28 ensure safe monthly recurring executions across all calendar months including February.
            </p>
          </div>

          {/* Non-negotiable Timing Note */}
          <div className="p-3 bg-cobalt-50 border border-cobalt-100 rounded-xl text-xs text-cobalt-800 leading-relaxed">
            <span className="font-bold">Execution Policy:</span> AutoPay is never charged on the day of setup. Your first payment will occur on the upcoming scheduled payment date.
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" size="md" onClick={handleReset}>
              Cancel
            </Button>
            <Button variant="primary" size="md" type="submit">
              Continue to PIN
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Step 2: Payment PIN Step-Up Verification */}
      <PinModal
        isOpen={isPinModalOpen}
        onClose={() => setIsPinModalOpen(false)}
        onConfirm={handleConfirmPin}
        title="Authorize AutoPay Setup"
        description={`Enter your payment PIN to activate recurring monthly payments to ${
          selectedRecipient?.firstName
            ? `${selectedRecipient.firstName} ${selectedRecipient.lastName || ''}`.trim()
            : selectedRecipient?.username || 'recipient'
        }`}
        amountPaise={parsedPaise}
        isLoading={isSubmitting}
        errorDetails={pinErrorDetails}
      />
    </>
  );
}

export default CreateMandateModal;
