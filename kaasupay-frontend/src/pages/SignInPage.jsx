import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Mail, Lock, LogIn, Eye, EyeOff, ShieldCheck, Zap, ArrowRight, Wallet } from 'lucide-react';
import { useAppDispatch } from '../store/hooks';
import { loginUser, fetchCurrentUser } from '../store/slices/authSlice';
import { fetchWalletBalance } from '../store/slices/walletSlice';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';

export function SignInPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Retrieve safe internal redirect target from URL query param if present
  const searchParams = new URLSearchParams(location.search);
  const rawRedirect = searchParams.get('redirect');
  const redirectTarget =
    rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//')
      ? rawRedirect
      : '/dashboard';

  const validate = () => {
    const errors = {};
    const trimmed = username.trim();

    if (!trimmed) {
      errors.username = 'Email address is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      errors.username = 'Please enter a valid email address';
    }

    if (!password) {
      errors.password = 'Password is required';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError(null);

    if (!validate()) return;

    setIsLoading(true);

    try {
      const resultAction = await dispatch(
        loginUser({
          username: username.trim().toLowerCase(),
          password,
        })
      );

      if (loginUser.fulfilled.match(resultAction)) {
        dispatch(fetchCurrentUser());
        dispatch(fetchWalletBalance());
        navigate(redirectTarget, { replace: true });
      } else {
        setServerError(resultAction.payload || 'Invalid credentials or sign-in rejected');
      }
    } catch (err) {
      setServerError(err.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12">
      {/* Form Column (Left) */}
      <div className="lg:col-span-7 p-6 sm:p-10 lg:p-12 flex flex-col justify-between">
        <div>
          {/* Header */}
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-xl bg-cobalt-600 text-white flex items-center justify-center shadow-xs">
              <Wallet className="w-4 h-4" />
            </div>
            <span className="font-extrabold text-xl text-navy-950 tracking-tight">
              Kaasu<span className="text-cobalt-600">Pay</span>
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-black text-navy-950 tracking-tight">
            Welcome back
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 mb-6">
            Sign in to access your wallet, transfer funds, and review ledger entries
          </p>

          {/* Server Error Alert */}
          {serverError && (
            <Alert variant="danger" onClose={() => setServerError(null)} className="mb-5">
              {serverError}
            </Alert>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Input
              label="Email Address"
              type="email"
              id="signin-username"
              placeholder="name@example.com"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (fieldErrors.username) setFieldErrors((prev) => ({ ...prev, username: null }));
              }}
              error={fieldErrors.username}
              leftIcon={<Mail className="w-4 h-4" />}
              required
              autoComplete="email"
              autoFocus
            />

            <div className="space-y-1">
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                id="signin-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: null }));
                }}
                error={fieldErrors.password}
                leftIcon={<Lock className="w-4 h-4" />}
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="cursor-pointer text-slate-400 hover:text-navy-900 transition-colors p-1"
                    title={showPassword ? 'Hide password' : 'Show password'}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
                required
                autoComplete="current-password"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full mt-2"
              isLoading={isLoading}
              leftIcon={<LogIn className="w-4 h-4" />}
            >
              Sign In to Wallet
            </Button>
          </form>
        </div>

        {/* Footer Link */}
        <div className="pt-8 mt-8 border-t border-slate-100 flex items-center justify-between text-xs">
          <span className="text-slate-500">Don't have an account?</span>
          <Link
            to={`/signup${location.search}`}
            className="font-bold text-cobalt-600 hover:text-cobalt-700 flex items-center gap-1 transition-colors"
          >
            <span>Open Free Wallet</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Visual Brand Column (Right - Desktop) */}
      <div className="hidden lg:flex lg:col-span-5 bg-linear-to-br from-navy-950 via-navy-900 to-cobalt-950 text-white p-10 flex-col justify-between relative overflow-hidden">
        {/* Radiant glow orb */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-cobalt-500/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-cobalt-200 text-xs font-semibold border border-white/10 backdrop-blur-xs">
            <ShieldCheck className="w-3.5 h-3.5 text-cobalt-400" />
            <span>Safe & Protected</span>
          </div>

          <h2 className="text-2xl font-black text-white leading-snug">
            Your digital wallet, always secure and ready.
          </h2>

          <p className="text-xs text-slate-300 leading-relaxed font-normal">
            Send money instantly to friends, withdraw to your bank account anytime, and manage your finances with complete confidence.
          </p>
        </div>

        {/* Feature List */}
        <div className="relative z-10 space-y-3 pt-6 border-t border-white/10 text-xs">
          <div className="flex items-center gap-2.5 text-slate-200">
            <Zap className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Instant P2P Transfers</span>
          </div>
          <div className="flex items-center gap-2.5 text-slate-200">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Protected by Your 4-Digit PIN</span>
          </div>
          <div className="flex items-center gap-2.5 text-slate-200">
            <Lock className="w-4 h-4 text-cobalt-400 shrink-0" />
            <span>Direct & Encrypted Bank Withdrawals</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SignInPage;
