import { useState, useEffect, useRef } from 'react';
import { Lock, ShieldAlert, Clock, AlertTriangle } from 'lucide-react';
import { Dialog, DialogFooter } from '../ui/Dialog';
import Button from '../ui/Button';
import AmountDisplay from '../ui/AmountDisplay';
import Alert from '../ui/Alert';

export function PinModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Enter Payment PIN',
  description = 'Authorize this financial transaction with your secret PIN',
  isLoading = false,
  errorDetails = null,
  amountPaise = null,
}) {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const inputRef = useRef(null);

  // Manage lockout countdown via timer subscription (no synchronous setState in effect)
  useEffect(() => {
    const totalSecs = errorDetails?.retryAfterSeconds;
    if (!totalSecs || totalSecs <= 0) {
      return;
    }

    const expiryTime = Date.now() + totalSecs * 1000;
    const interval = setInterval(() => {
      const left = Math.max(0, Math.ceil((expiryTime - Date.now()) / 1000));
      setRemainingSeconds(left);
      if (left <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [errorDetails?.retryAfterSeconds]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const isLocked = remainingSeconds > 0 || errorDetails?.status === 423;

  const formatCountdown = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleClose = () => {
    if (isLocked || isLoading) return;
    setPin('');
    setShowPin(false);
    onClose();
  };

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (isLocked || isLoading || pin.length < 4) return;
    onConfirm(pin);
  };

  const handlePinChange = (e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
    setPin(val);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      description={description}
      maxWidth="max-w-sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
        {/* Amount Pill if provided */}
        {amountPaise !== null && amountPaise !== undefined && (
          <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Authorizing Amount</span>
            <AmountDisplay paise={amountPaise} size="md" className="font-black text-navy-900" />
          </div>
        )}

        {/* Lockout Warning */}
        {isLocked && (
          <Alert variant="danger" icon={<Clock className="w-4 h-4 text-rose-600 animate-pulse" />}>
            <div className="space-y-1">
              <p className="font-bold">Security Lockout Active</p>
              <p className="text-xs">
                Too many incorrect attempts. Please wait{' '}
                <span className="font-mono font-bold">{formatCountdown(remainingSeconds || 900)}</span> before retrying.
              </p>
            </div>
          </Alert>
        )}

        {/* Incorrect PIN with tries remaining */}
        {!isLocked && errorDetails?.triesLeft !== undefined && (
          <Alert variant="warning" icon={<AlertTriangle className="w-4 h-4 text-amber-600" />}>
            <p className="font-semibold text-xs">
              Incorrect PIN. {errorDetails.triesLeft} {errorDetails.triesLeft === 1 ? 'attempt' : 'attempts'} remaining before temporary 15-minute lockout.
            </p>
          </Alert>
        )}

        {/* General Error (if not locked and no triesLeft) */}
        {!isLocked && errorDetails?.message && errorDetails.triesLeft === undefined && (
          <Alert variant="danger" icon={<ShieldAlert className="w-4 h-4 text-rose-600" />}>
            <p className="font-semibold text-xs">{errorDetails.message}</p>
          </Alert>
        )}

        {/* PIN Input Section */}
        <div className="space-y-2">
          <label htmlFor="pin-input" className="block text-xs font-bold text-navy-900 tracking-wide">
            Payment PIN (4 or 6 Digits)
          </label>
          <div className="relative">
            <input
              id="pin-input"
              ref={inputRef}
              type={showPin ? 'text' : 'password'}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              value={pin}
              onChange={handlePinChange}
              disabled={isLocked || isLoading}
              maxLength={6}
              placeholder="••••"
              className="w-full text-center tracking-[0.5em] text-2xl font-mono py-2.5 px-4 bg-white border border-slate-300 rounded-xl text-navy-950 focus:outline-none focus:ring-2 focus:ring-cobalt-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
            <button
              type="button"
              onClick={() => setShowPin(!showPin)}
              disabled={isLocked || isLoading}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-500 hover:text-navy-900 cursor-pointer disabled:opacity-40"
            >
              {showPin ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="text-[11px] text-slate-400 text-center">
            Never share your payment PIN with anyone
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClose}
            disabled={isLoading || isLocked}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            isLoading={isLoading}
            disabled={isLocked || pin.length < 4}
            leftIcon={<Lock className="w-3.5 h-3.5" />}
          >
            Confirm & Pay
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

export default PinModal;
