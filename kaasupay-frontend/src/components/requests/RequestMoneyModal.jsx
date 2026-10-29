import { useState, useEffect, useRef } from 'react';
import { User, Search, HandCoins, AlertCircle, CheckCircle2 } from 'lucide-react';
import Dialog, { DialogFooter } from '../ui/Dialog';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Alert from '../ui/Alert';
import { useAuth, useToast } from '../../store/hooks';
import authService from '../../services/authService';
import walletService from '../../services/walletService';
import { rupeesToPaise } from '../../utils/currency';

export function RequestMoneyModal({ isOpen, onClose, onRequestCreated }) {
  const { user: currentUser } = useAuth();
  const toast = useToast();

  const [toQuery, setToQuery] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const [rupees, setRupees] = useState('');
  const [note, setNote] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const searchDebounceRef = useRef(null);
  const dropdownRef = useRef(null);

  const resetForm = () => {
    setToQuery('');
    setSelectedRecipient(null);
    setSearchResults([]);
    setShowDropdown(false);
    setRupees('');
    setNote('');
    setErrorMsg(null);
    setIsLoading(false);
  };

  const handleClose = () => {
    if (isLoading) return;
    resetForm();
    onClose();
  };

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

  const handleSelectRecipient = (u) => {
    setSelectedRecipient(u);
    setToQuery(`${u.firstName} ${u.lastName} (${u.username})`);
    setShowDropdown(false);
    setErrorMsg(null);
  };

  const handleClearRecipient = () => {
    setSelectedRecipient(null);
    setToQuery('');
    setSearchResults([]);
    setShowDropdown(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!selectedRecipient) {
      setErrorMsg('Please select a recipient to request money from.');
      return;
    }

    const numRupees = parseFloat(rupees);
    if (!rupees || isNaN(numRupees) || numRupees <= 0) {
      setErrorMsg('Please enter a valid amount.');
      return;
    }

    if (numRupees < 1) {
      setErrorMsg('Minimum request amount is ₹1.00');
      return;
    }

    if (numRupees > 10000) {
      setErrorMsg('Maximum request amount is ₹10,000.00');
      return;
    }

    const amountPaise = rupeesToPaise(rupees);

    setIsLoading(true);
    try {
      const result = await walletService.createMoneyRequest({
        to: selectedRecipient._id,
        amount: amountPaise,
        note: note.trim() || undefined,
      });

      toast.success(result.message || 'Request sent successfully!');
      if (onRequestCreated) {
        onRequestCreated(result.request);
      }
      onClose();
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message || 'Failed to send request';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={handleClose} title="Request Money" maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-slate-500 font-medium">
          Ask a friend or contact for money. They will receive an actionable incoming request with 7-day lazy expiry.
        </p>

        {errorMsg && (
          <Alert variant="danger" onClose={() => setErrorMsg(null)}>
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          </Alert>
        )}

        {/* Recipient Search Autocomplete */}
        <div className="relative" ref={dropdownRef}>
          <label htmlFor="recipient-search" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
            Who are you asking?
          </label>
          <div className="relative">
            <Input
              id="recipient-search"
              placeholder="Search by name or email..."
              value={toQuery}
              onChange={(e) => {
                setToQuery(e.target.value);
                if (selectedRecipient) setSelectedRecipient(null);
              }}
              leftIcon={<Search className="w-4 h-4 text-slate-400" />}
              autoComplete="off"
            />
            {selectedRecipient && (
              <button
                type="button"
                onClick={handleClearRecipient}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 hover:text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md"
              >
                Change
              </button>
            )}
          </div>

          {/* Autocomplete Dropdown */}
          {showDropdown && searchResults.length > 0 && !selectedRecipient && (
            <div className="absolute z-50 left-0 right-0 mt-1.5 bg-white rounded-xl border border-slate-200 shadow-lg max-h-52 overflow-y-auto divide-y divide-slate-100">
              {searchResults.map((u) => (
                <button
                  key={u._id}
                  type="button"
                  onClick={() => handleSelectRecipient(u)}
                  className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-cobalt-50 text-cobalt-600 font-bold flex items-center justify-center text-xs shrink-0">
                      {u.firstName?.[0] || 'U'}
                    </div>
                    <div className="truncate">
                      <p className="text-xs font-bold text-navy-950 truncate">
                        {u.firstName} {u.lastName}
                      </p>
                      <p className="text-[11px] text-slate-400 font-mono truncate">{u.username}</p>
                    </div>
                  </div>
                  <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {isSearching && (
            <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-cobalt-500 animate-ping" />
              Searching member directory...
            </p>
          )}
        </div>

        {/* Amount Input */}
        <div>
          <label htmlFor="request-amount" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
            Amount (₹)
          </label>
          <Input
            id="request-amount"
            type="number"
            step="0.01"
            min="1"
            max="10000"
            placeholder="0.00"
            value={rupees}
            onChange={(e) => setRupees(e.target.value)}
            leftIcon={<span className="text-sm font-bold text-slate-500">₹</span>}
          />
          <p className="text-[11px] text-slate-400 mt-1">Min ₹1.00 • Max ₹10,000.00</p>
        </div>

        {/* Note Input */}
        <div>
          <label htmlFor="request-note" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
            Note (Optional)
          </label>
          <Input
            id="request-note"
            placeholder="e.g., Dinner at Murugan Idli, Rent share"
            value={note}
            maxLength={100}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1 font-mono">
            <span>Added to transaction note</span>
            <span>{note.length}/100</span>
          </div>
        </div>

        {/* Live Summary Preview */}
        {selectedRecipient && rupees && !isNaN(parseFloat(rupees)) && parseFloat(rupees) >= 1 && (
          <div className="p-3 bg-cobalt-50/70 border border-cobalt-100 rounded-xl flex items-center gap-3">
            <HandCoins className="w-5 h-5 text-cobalt-600 shrink-0" />
            <p className="text-xs text-navy-950 font-medium">
              Asking <span className="font-bold text-cobalt-700">{selectedRecipient.firstName} {selectedRecipient.lastName}</span> for{' '}
              <span className="font-bold text-navy-950">₹{parseFloat(rupees).toFixed(2)}</span>
              {note.trim() ? ` for "${note.trim()}"` : ''}.
            </p>
          </div>
        )}

        <DialogFooter className="pt-2">
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={isLoading}
            disabled={!selectedRecipient || !rupees || isLoading}
            leftIcon={<CheckCircle2 className="w-4 h-4" />}
          >
            Send Request
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

export default RequestMoneyModal;
