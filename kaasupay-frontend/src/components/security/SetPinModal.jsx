import { useState } from 'react';
import { KeyRound, ShieldCheck, AlertCircle } from 'lucide-react';
import { Dialog, DialogFooter } from '../ui/Dialog';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Alert from '../ui/Alert';
import authService from '../../services/authService';
import { useAppDispatch, useToast } from '../../store/hooks';
import { setUserHasPin } from '../../store/slices/authSlice';

export function SetPinModal({ isOpen, onClose, hasExistingPin = false }) {
  const dispatch = useAppDispatch();
  const toast = useToast();

  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const resetForm = () => {
    setPassword('');
    setPin('');
    setConfirmPin('');
    setErrorMsg(null);
  };

  const handleClose = () => {
    if (isLoading) return;
    resetForm();
    onClose();
  };

  const validateInput = () => {
    if (!password) {
      setErrorMsg('Please enter your current account password');
      return false;
    }
    if (!pin || (pin.length !== 4 && pin.length !== 6)) {
      setErrorMsg('PIN must be exactly 4 or 6 digits');
      return false;
    }
    if (!/^\d+$/.test(pin)) {
      setErrorMsg('PIN must contain only numeric digits');
      return false;
    }
    if (/^(\d)\1+$/.test(pin)) {
      setErrorMsg('PIN cannot consist of all repeated digits (e.g. 0000, 1111)');
      return false;
    }
    const trivialPins = ['1234', '4321', '123456', '654321', '0123', '9876'];
    if (trivialPins.includes(pin)) {
      setErrorMsg('This PIN is too common and easily guessed. Please choose a safer combination.');
      return false;
    }
    if (pin !== confirmPin) {
      setErrorMsg('PIN confirmation does not match');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    setErrorMsg(null);

    if (!validateInput()) return;

    setIsLoading(true);
    try {
      const res = await authService.setPin({ pin, password });
      dispatch(setUserHasPin(true));
      toast.success(res.message || (hasExistingPin ? 'Payment PIN updated successfully' : 'Payment PIN created successfully'));
      handleClose();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to set payment PIN');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={hasExistingPin ? 'Change Payment PIN' : 'Set Up Payment PIN'}
      description="Create a 4 or 6-digit payment PIN to secure outgoing transfers and withdrawals"
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
        {errorMsg && (
          <Alert variant="danger" icon={<AlertCircle className="w-4 h-4 text-rose-600" />}>
            <p className="text-xs font-semibold">{errorMsg}</p>
          </Alert>
        )}

        <div className="space-y-3">
          <Input
            label="Current Account Password"
            type="password"
            placeholder="Confirm your account password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setErrorMsg(null);
            }}
            required
            autoComplete="current-password"
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="New PIN (4 or 6 digits)"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="••••"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                setErrorMsg(null);
              }}
              required
              autoComplete="off"
            />

            <Input
              label="Confirm PIN"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="••••"
              value={confirmPin}
              onChange={(e) => {
                setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                setErrorMsg(null);
              }}
              required
              autoComplete="off"
            />
          </div>
        </div>

        <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-[11px] text-slate-500 space-y-1">
          <p className="font-semibold text-navy-900 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            Security Rules:
          </p>
          <ul className="list-disc list-inside space-y-0.5 pl-1">
            <li>4 or 6 digits only</li>
            <li>No repetitive digits (e.g. 1111) or sequential numbers (e.g. 1234)</li>
            <li>Locked for 15 minutes after 3 consecutive wrong guesses</li>
          </ul>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            isLoading={isLoading}
            leftIcon={<KeyRound className="w-3.5 h-3.5" />}
          >
            {hasExistingPin ? 'Update PIN' : 'Save PIN'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

export default SetPinModal;
