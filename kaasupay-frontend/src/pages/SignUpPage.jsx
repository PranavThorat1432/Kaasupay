import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Mail, Lock, User, UserPlus, Eye, EyeOff, ShieldCheck, Zap, ArrowRight, Wallet, CheckCircle2 } from 'lucide-react';
import { useAppDispatch } from '../store/hooks';
import { registerUser, loginUser, fetchCurrentUser } from '../store/slices/authSlice';
import { fetchWalletBalance } from '../store/slices/walletSlice';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';

export function SignUpPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
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

    if (!firstName.trim()) {
      errors.firstName = 'First name is required';
    } else if (firstName.trim().length > 50) {
      errors.firstName = 'First name cannot exceed 50 characters';
    }

    if (lastName.trim().length > 50) {
      errors.lastName = 'Last name cannot exceed 50 characters';
    }

    const trimmedEmail = username.trim();
    if (!trimmedEmail) {
      errors.username = 'Email address is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.username = 'Please enter a valid email address';
    }

    if (!password) {
      errors.password = 'Password is required';
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters long';
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
      const normalizedEmail = username.trim().toLowerCase();
      const registrationData = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: normalizedEmail,
        password,
      };

      const registerResult = await dispatch(registerUser(registrationData));

      if (registerUser.fulfilled.match(registerResult)) {
        const loginResult = await dispatch(
          loginUser({
            username: normalizedEmail,
            password,
          })
        );

        if (loginUser.fulfilled.match(loginResult)) {
          dispatch(fetchCurrentUser());
          dispatch(fetchWalletBalance());
          navigate(redirectTarget, { replace: true });
        } else {
          navigate('/signin', {
            state: { message: 'Account created! Please sign in with your credentials.' },
          });
        }
      } else {
        setServerError(registerResult.payload || 'Account creation rejected by server');
      }
    } catch (err) {
      setServerError(err.message || 'An unexpected error occurred during account creation.');
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
            Create your account
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 mb-6">
            Set up your integer-paise wallet with cryptographic audit guarantees
          </p>

          {/* Server Error Alert */}
          {serverError && (
            <Alert variant="danger" onClose={() => setServerError(null)} className="mb-5">
              {serverError}
            </Alert>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="First Name"
                type="text"
                id="signup-firstname"
                placeholder="Raju"
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  if (fieldErrors.firstName) setFieldErrors((prev) => ({ ...prev, firstName: null }));
                }}
                error={fieldErrors.firstName}
                leftIcon={<User className="w-4 h-4" />}
                required
                autoComplete="given-name"
                autoFocus
              />

              <Input
                label="Last Name"
                type="text"
                id="signup-lastname"
                placeholder="Kumar"
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  if (fieldErrors.lastName) setFieldErrors((prev) => ({ ...prev, lastName: null }));
                }}
                error={fieldErrors.lastName}
                leftIcon={<User className="w-4 h-4" />}
                autoComplete="family-name"
              />
            </div>

            <Input
              label="Email Address"
              type="email"
              id="signup-username"
              placeholder="raju@example.com"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (fieldErrors.username) setFieldErrors((prev) => ({ ...prev, username: null }));
              }}
              error={fieldErrors.username}
              leftIcon={<Mail className="w-4 h-4" />}
              required
              autoComplete="email"
            />

            <Input
              label="Password (min 6 characters)"
              type={showPassword ? 'text' : 'password'}
              id="signup-password"
              placeholder="Create a strong password"
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
              autoComplete="new-password"
            />

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full mt-2"
              isLoading={isLoading}
              leftIcon={<UserPlus className="w-4 h-4" />}
            >
              Open Free Account
            </Button>
          </form>
        </div>

        {/* Footer Link */}
        <div className="pt-8 mt-8 border-t border-slate-100 flex items-center justify-between text-xs">
          <span className="text-slate-500">Already have an account?</span>
          <Link
            to={`/signin${location.search}`}
            className="font-bold text-cobalt-600 hover:text-cobalt-700 flex items-center gap-1 transition-colors"
          >
            <span>Sign In</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Visual Brand Column (Right - Desktop) */}
      <div className="hidden lg:flex lg:col-span-5 bg-linear-to-br from-navy-950 via-navy-900 to-cobalt-950 text-white p-10 flex-col justify-between relative overflow-hidden">
        {/* Radiant glow orb */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-cobalt-500/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-emerald-300 text-xs font-semibold border border-white/10 backdrop-blur-xs">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Free Personal Wallet</span>
          </div>

          <h2 className="text-2xl font-black text-white leading-snug">
            Create your account in under a minute.
          </h2>

          <p className="text-xs text-slate-300 leading-relaxed font-normal">
            Enjoy zero account maintenance fees, instant zero-fee peer transfers, and seamless direct bank withdrawals.
          </p>
        </div>

        {/* Feature List */}
        <div className="relative z-10 space-y-3 pt-6 border-t border-white/10 text-xs">
          <div className="flex items-center gap-2.5 text-slate-200">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Instant & Accurate Balance Tracking</span>
          </div>
          <div className="flex items-center gap-2.5 text-slate-200">
            <Zap className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Double-Charge Protection on Transfers</span>
          </div>
          <div className="flex items-center gap-2.5 text-slate-200">
            <Lock className="w-4 h-4 text-cobalt-400 shrink-0" />
            <span>Bank-Grade Encryption for Your Security</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SignUpPage;
