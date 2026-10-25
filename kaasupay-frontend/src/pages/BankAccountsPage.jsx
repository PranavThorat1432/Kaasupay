import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Landmark,
  Plus,
  ShieldCheck,
  Building2,
  Copy,
  Check,
  ArrowUpRight,
  Clock,
  Sparkles,
} from 'lucide-react';
import { useBank, useAppDispatch, useToast } from '../store/hooks';
import { fetchBankAccounts, addBankAccount, clearBankErrors } from '../store/slices/bankSlice';
import Card, { CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Dialog, { DialogFooter } from '../components/ui/Dialog';
import Alert from '../components/ui/Alert';
import Badge from '../components/ui/Badge';
import BankCardCanvas from '../components/3d/BankCardCanvas';

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function BankAccountsPage() {
  const dispatch = useAppDispatch();
  const { accounts, accountsLoading, accountsError, addAccountLoading, addAccountError } = useBank();
  const toast = useToast();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [holderName, setHolderName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmAccountNumber, setConfirmAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [formErrors, setFormErrors] = useState({});
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    dispatch(fetchBankAccounts());
  }, [dispatch]);

  const handleCopyIfsc = (ifscCode, id) => {
    navigator.clipboard.writeText(ifscCode);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success(`IFSC ${ifscCode} copied to clipboard`);
  };

  const validateForm = () => {
    const errors = {};
    const trimmedName = holderName.trim();
    if (!trimmedName || trimmedName.length < 2 || trimmedName.length > 60) {
      errors.holderName = 'Account holder name must be between 2 and 60 characters';
    }

    const trimmedAccount = accountNumber.trim();
    if (!trimmedAccount || !/^\d{9,18}$/.test(trimmedAccount)) {
      errors.accountNumber = 'Account number must be 9 to 18 digits';
    }

    if (trimmedAccount !== confirmAccountNumber.trim()) {
      errors.confirmAccountNumber = 'Account numbers do not match';
    }

    const upperIfsc = ifsc.trim().toUpperCase();
    if (!IFSC_REGEX.test(upperIfsc)) {
      errors.ifsc = 'Invalid IFSC code (e.g. SBIN0001234)';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAddAccount = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      const res = await dispatch(
        addBankAccount({
          holderName: holderName.trim(),
          accountNumber: accountNumber.trim(),
          ifsc: ifsc.trim().toUpperCase(),
        })
      ).unwrap();

      toast.success(`Bank account ${res.account} added successfully`);
      setIsAddModalOpen(false);
      setHolderName('');
      setAccountNumber('');
      setConfirmAccountNumber('');
      setIfsc('');
      setFormErrors({});
      dispatch(clearBankErrors());
    } catch (err) {
      toast.error(err || 'Failed to add bank account');
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy-900 tracking-tight flex items-center gap-2.5">
            <Landmark className="w-7 h-7 text-cobalt-600" />
            Bank Accounts
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage your verified destination bank accounts for secure wallet withdrawals.
          </p>
        </div>

        <Button
          variant="primary"
          size="md"
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={() => {
            dispatch(clearBankErrors());
            setIsAddModalOpen(true);
          }}
          className="bg-cobalt-600 hover:bg-cobalt-700 shadow-sm font-semibold shrink-0"
        >
          Add Bank Account
        </Button>
      </div>

      {/* Security Callout */}
      <div className="p-4 bg-cobalt-50/70 border border-cobalt-200/80 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cobalt-100 border border-cobalt-200 flex items-center justify-center shrink-0 text-cobalt-700">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-cobalt-950">
              Bank-Grade Security & Encryption
            </h4>
            <p className="text-xs text-slate-600 mt-0.5">
              Your bank details are encrypted. Only the last 4 digits are displayed for your security and privacy.
            </p>
          </div>
        </div>
        <Link to="/withdraw">
          <Button variant="primary" size="sm" rightIcon={<ArrowUpRight className="w-4 h-4" />} className="shrink-0 font-semibold text-xs">
            Withdraw Funds
          </Button>
        </Link>
      </div>

      {/* Accounts Error Notice */}
      {accountsError && (
        <Alert variant="error" title="Account Sync Error">
          {accountsError}
        </Alert>
      )}

      {/* Loading Skeletons */}
      {accountsLoading && accounts.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="h-48 bg-slate-100 rounded-2xl animate-pulse" />
          <div className="h-48 bg-slate-100 rounded-2xl animate-pulse" />
        </div>
      ) : accounts.length === 0 ? (
        /* Empty State */
        <div className="bg-white border border-slate-200/80 rounded-3xl p-8 sm:p-12 text-center max-w-xl mx-auto shadow-xs">
          <BankCardCanvas className="mb-6" maskedAccount="•••• •••• •••• ••••" holderName="ADD YOUR ACCOUNT" />
          <h3 className="text-base font-bold text-navy-900">No bank accounts linked yet</h3>
          <p className="text-xs text-slate-500 mt-1.5 max-w-sm mx-auto leading-relaxed">
            Link your savings or current bank account to withdraw funds from your KaasuPay balance with atomic double-entry verification.
          </p>
          <div className="mt-6">
            <Button
              variant="primary"
              size="md"
              leftIcon={<Plus className="w-4 h-4" />}
              onClick={() => setIsAddModalOpen(true)}
              className="bg-cobalt-600 hover:bg-cobalt-700 shadow-sm font-semibold"
            >
              Add Your First Bank Account
            </Button>
          </div>
        </div>
      ) : (
        /* Accounts Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {accounts.map((acc) => (
            <Card
              key={acc.id}
              className="relative overflow-hidden border-slate-200 hover:border-cobalt-300 transition-all hover:shadow-md"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-cobalt-500/5 rounded-full blur-xl pointer-events-none" />

              <CardHeader className="pb-3 flex flex-row items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 font-bold">
                    <Building2 className="w-5 h-5 text-cobalt-600" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold text-navy-900">
                      {acc.holderName}
                    </CardTitle>
                    <CardDescription className="text-xs font-mono">
                      {acc.account}
                    </CardDescription>
                  </div>
                </div>

                <Badge variant="credit" size="sm" className="font-mono text-[10px]">
                  VERIFIED
                </Badge>
              </CardHeader>

              <CardContent className="space-y-4 pt-0">
                <div className="p-3 bg-slate-50 rounded-xl flex items-center justify-between text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-slate-400 font-sans block uppercase font-semibold">
                      IFSC Code
                    </span>
                    <span className="font-bold text-navy-900 tracking-wider">{acc.ifsc}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopyIfsc(acc.ifsc, acc.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
                    title="Copy IFSC"
                    aria-label="Copy IFSC Code"
                  >
                    {copiedId === acc.id ? (
                      <Check className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
                    <Clock className="w-3 h-3" />
                    Linked on {new Date(acc.createdAt).toLocaleDateString()}
                  </span>

                  <Link to="/withdraw" state={{ selectedAccountId: acc.id }}>
                    <Button variant="ghost" size="sm" rightIcon={<ArrowUpRight className="w-3.5 h-3.5" />} className="text-cobalt-600 hover:text-cobalt-700 font-semibold text-xs">
                      Withdraw Here
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ADD BANK ACCOUNT MODAL */}
      <Dialog
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add Verified Bank Account"
        description="Beneficiary account for withdrawing your wallet funds"
        maxWidth="max-w-md"
      >
        <form onSubmit={handleAddAccount} className="space-y-4">
          {addAccountError && (
            <Alert variant="error" title="Could not add account">
              {addAccountError}
            </Alert>
          )}

          <div>
            <Input
              label="Account Holder Name"
              type="text"
              placeholder="e.g. Raju Kumar"
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              error={formErrors.holderName}
              required
            />
            <p className="text-[11px] text-slate-400 mt-1">Must match legal bank account holder credentials.</p>
          </div>

          <div>
            <Input
              label="Account Number"
              type="password"
              placeholder="9 to 18 numeric digits"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
              error={formErrors.accountNumber}
              required
            />
          </div>

          <div>
            <Input
              label="Confirm Account Number"
              type="text"
              placeholder="Re-enter account number"
              value={confirmAccountNumber}
              onChange={(e) => setConfirmAccountNumber(e.target.value.replace(/\D/g, ''))}
              error={formErrors.confirmAccountNumber}
              required
            />
          </div>

          <div>
            <Input
              label="Bank IFSC Code"
              type="text"
              placeholder="e.g. SBIN0001234"
              value={ifsc}
              onChange={(e) => setIfsc(e.target.value.toUpperCase())}
              error={formErrors.ifsc}
              required
            />
            <p className="text-[11px] text-slate-400 mt-1">11-character Indian Financial System Code.</p>
          </div>

          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 flex items-center gap-2 text-[11px] text-emerald-800">
            <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Encrypted using AES-256-GCM. Plaintext is never stored or returned.</span>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsAddModalOpen(false)}
              disabled={addAccountLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={addAccountLoading}
              className="bg-cobalt-600 hover:bg-cobalt-700"
            >
              Save Bank Account
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}

export default BankAccountsPage;
