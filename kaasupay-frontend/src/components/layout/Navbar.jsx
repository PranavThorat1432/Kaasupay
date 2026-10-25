import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Wallet,
  ArrowRight,
  Menu,
  X,
  LogOut,
  LayoutDashboard,
  Send,
  History,
  PlusCircle,
  ArrowUpRight,
  Landmark,
  ShieldCheck,
} from 'lucide-react';
import { useAuth, useWallet, useAppDispatch, useToast } from '../../store/hooks';
import { logoutAllDevices } from '../../store/slices/authSlice';
import Button from '../ui/Button';
import AmountDisplay from '../ui/AmountDisplay';

export function Navbar() {
  const { isAuthenticated, user, logout } = useAuth();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const { balance } = useWallet();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  const handleLogoutAll = async () => {
    if (window.confirm('Are you sure you want to log out of all active sessions across all devices?')) {
      try {
        await dispatch(logoutAllDevices()).unwrap();
        toast.info('Signed out of all devices');
      } catch {
        toast.info('Signed out of all devices');
      }
    }
  };

  const toggleMenu = () => setMobileMenuOpen((prev) => !prev);
  const closeMenu = () => setMobileMenuOpen(false);

  // Logo destination: authenticated users go to /dashboard, public goes to /
  const logoHref = isAuthenticated ? '/dashboard' : '/';

  return (
    <header className="sticky top-0 z-40 w-full bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand Logo */}
        <Link
          to={logoHref}
          onClick={closeMenu}
          className="flex items-center gap-2.5 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-600 rounded-lg p-1"
          aria-label={isAuthenticated ? 'KaasuPay Dashboard' : 'KaasuPay Home'}
        >
          <div className="w-8 h-8 rounded-xl bg-cobalt-600 text-white flex items-center justify-center shadow-xs group-hover:bg-cobalt-700 transition-colors">
            <Wallet className="w-4 h-4" />
          </div>
          <span className="font-extrabold text-xl text-navy-950 tracking-tight">
            Kaasu<span className="text-cobalt-600">Pay</span>
          </span>
        </Link>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-6" aria-label="Main Navigation">
          {isAuthenticated ? (
            // Authenticated Navigation Links
            <>
              <Link
                to="/dashboard"
                className={`text-xs font-bold tracking-wide transition-colors flex items-center gap-1.5 ${
                  location.pathname === '/dashboard'
                    ? 'text-cobalt-600'
                    : 'text-slate-600 hover:text-navy-950'
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                Dashboard
              </Link>
              <Link
                to="/transfer"
                className={`text-xs font-bold tracking-wide transition-colors flex items-center gap-1.5 ${
                  location.pathname === '/transfer'
                    ? 'text-cobalt-600'
                    : 'text-slate-600 hover:text-navy-950'
                }`}
              >
                <Send className="w-3.5 h-3.5" />
                Send
              </Link>
              <Link
                to="/add-money"
                className={`text-xs font-bold tracking-wide transition-colors flex items-center gap-1.5 ${
                  location.pathname === '/add-money'
                    ? 'text-cobalt-600'
                    : 'text-slate-600 hover:text-navy-950'
                }`}
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Add Money
              </Link>
              <Link
                to="/withdraw"
                className={`text-xs font-bold tracking-wide transition-colors flex items-center gap-1.5 ${
                  location.pathname === '/withdraw'
                    ? 'text-cobalt-600'
                    : 'text-slate-600 hover:text-navy-950'
                }`}
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                Withdraw
              </Link>
              <Link
                to="/bank-accounts"
                className={`text-xs font-bold tracking-wide transition-colors flex items-center gap-1.5 ${
                  location.pathname === '/bank-accounts'
                    ? 'text-cobalt-600'
                    : 'text-slate-600 hover:text-navy-950'
                }`}
              >
                <Landmark className="w-3.5 h-3.5" />
                Banks
              </Link>
              <Link
                to="/transactions"
                className={`text-xs font-bold tracking-wide transition-colors flex items-center gap-1.5 ${
                  location.pathname === '/transactions'
                    ? 'text-cobalt-600'
                    : 'text-slate-600 hover:text-navy-950'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                Ledger
              </Link>
            </>
          ) : (
            // Public Marketing Navigation Links
            <>
              <a
                href="/#top"
                className="text-xs font-semibold text-slate-600 hover:text-navy-950 tracking-wide transition-colors"
              >
                Overview
              </a>
              <a
                href="/#features"
                className="text-xs font-semibold text-slate-600 hover:text-navy-950 tracking-wide transition-colors"
              >
                Features
              </a>
              <a
                href="/#how-it-works"
                className="text-xs font-semibold text-slate-600 hover:text-navy-950 tracking-wide transition-colors"
              >
                How It Works
              </a>
              <a
                href="/#guarantees"
                className="text-xs font-semibold text-slate-600 hover:text-navy-950 tracking-wide transition-colors flex items-center gap-1"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Integrity
              </a>
            </>
          )}
        </nav>

        {/* Action Controls */}
        <div className="hidden md:flex items-center gap-3">
          {isAuthenticated ? (
            <div className="flex items-center gap-3">
              {/* Wallet Balance Pill */}
              <Link
                to="/dashboard"
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors border border-slate-200"
                title="Wallet balance"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Wallet</span>
                <AmountDisplay paise={balance} size="sm" className="font-bold text-navy-950 tabular-nums" />
              </Link>

              {/* Add Money Quick Button */}
              <Link to="/add-money">
                <Button variant="primary" size="sm" leftIcon={<PlusCircle className="w-3.5 h-3.5" />}>
                  Top-up
                </Button>
              </Link>

              {/* User Session / Sign Out */}
              <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
                <span className="text-xs font-bold text-navy-900 max-w-30 truncate">
                  {user?.firstName || user?.username?.split('@')[0] || 'Member'}
                </span>
                <button
                  type="button"
                  onClick={handleLogoutAll}
                  className="cursor-pointer p-1.5 text-slate-500 hover:text-amber-700 rounded-lg hover:bg-amber-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 text-[11px] font-semibold flex items-center gap-1"
                  title="Sign out of all devices"
                  aria-label="Sign out of all devices"
                >
                  <LogOut className="w-3.5 h-3.5 text-amber-600" />
                  <span className="hidden xl:inline">All Devices</span>
                </button>
                <button
                  type="button"
                  onClick={logout}
                  className="cursor-pointer p-1.5 text-slate-500 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                  title="Sign out (this device)"
                  aria-label="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <Link to="/signin">
                <Button variant="secondary" size="sm">
                  Sign In
                </Button>
              </Link>
              <Link to="/signup">
                <Button variant="primary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                  Open Free Wallet
                </Button>
              </Link>
            </div>
          )}
        </div>

        {/* Mobile Menu Button */}
        <div className="flex md:hidden items-center gap-2">
          <button
            type="button"
            onClick={toggleMenu}
            className="cursor-pointer p-2 rounded-xl text-slate-700 hover:text-navy-950 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-600"
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 pt-3 pb-6 flex flex-col gap-3 shadow-lg">
          {isAuthenticated ? (
            <>
              <div className="px-3 py-2.5 bg-slate-100 rounded-xl border border-slate-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600">Wallet Balance</span>
                <AmountDisplay paise={balance} size="md" className="font-bold text-navy-950 tabular-nums" />
              </div>

              <Link
                to="/dashboard"
                onClick={closeMenu}
                className="flex items-center gap-2.5 px-3 py-2 text-sm font-bold text-navy-950 rounded-xl hover:bg-slate-100"
              >
                <LayoutDashboard className="w-4 h-4 text-cobalt-600" />
                Dashboard
              </Link>
              <Link
                to="/transfer"
                onClick={closeMenu}
                className="flex items-center gap-2.5 px-3 py-2 text-sm font-bold text-navy-950 rounded-xl hover:bg-slate-100"
              >
                <Send className="w-4 h-4 text-cobalt-600" />
                Send Money
              </Link>
              <Link
                to="/add-money"
                onClick={closeMenu}
                className="flex items-center gap-2.5 px-3 py-2 text-sm font-bold text-navy-950 rounded-xl hover:bg-slate-100"
              >
                <PlusCircle className="w-4 h-4 text-cobalt-600" />
                Add Money
              </Link>
              <Link
                to="/withdraw"
                onClick={closeMenu}
                className="flex items-center gap-2.5 px-3 py-2 text-sm font-bold text-navy-950 rounded-xl hover:bg-slate-100"
              >
                <ArrowUpRight className="w-4 h-4 text-cobalt-600" />
                Withdraw
              </Link>
              <Link
                to="/bank-accounts"
                onClick={closeMenu}
                className="flex items-center gap-2.5 px-3 py-2 text-sm font-bold text-navy-950 rounded-xl hover:bg-slate-100"
              >
                <Landmark className="w-4 h-4 text-cobalt-600" />
                Bank Accounts
              </Link>
              <Link
                to="/transactions"
                onClick={closeMenu}
                className="flex items-center gap-2.5 px-3 py-2 text-sm font-bold text-navy-950 rounded-xl hover:bg-slate-100"
              >
                <History className="w-4 h-4 text-cobalt-600" />
                Transaction History
              </Link>

              <div className="pt-2 border-t border-slate-100 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    handleLogoutAll();
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm font-semibold text-amber-700 rounded-xl hover:bg-amber-50 text-left cursor-pointer"
                >
                  <LogOut className="w-4 h-4 text-amber-600" />
                  Sign Out of All Devices
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    logout();
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm font-semibold text-rose-600 rounded-xl hover:bg-rose-50 text-left cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out (This Device)
                </button>
              </div>
            </>
          ) : (
            <>
              <a
                href="/#top"
                onClick={closeMenu}
                className="px-3 py-2 text-sm font-semibold text-slate-700 hover:text-navy-950 rounded-xl hover:bg-slate-50"
              >
                Overview
              </a>
              <a
                href="/#features"
                onClick={closeMenu}
                className="px-3 py-2 text-sm font-semibold text-slate-700 hover:text-navy-950 rounded-xl hover:bg-slate-50"
              >
                Features
              </a>
              <a
                href="/#how-it-works"
                onClick={closeMenu}
                className="px-3 py-2 text-sm font-semibold text-slate-700 hover:text-navy-950 rounded-xl hover:bg-slate-50"
              >
                How It Works
              </a>
              <a
                href="/#guarantees"
                onClick={closeMenu}
                className="px-3 py-2 text-sm font-semibold text-slate-700 hover:text-navy-950 rounded-xl hover:bg-slate-50"
              >
                Integrity
              </a>

              <div className="flex flex-col gap-2 pt-3 border-t border-slate-100">
                <Link to="/signin" onClick={closeMenu}>
                  <Button variant="secondary" size="md" className="w-full">
                    Sign In
                  </Button>
                </Link>
                <Link to="/signup" onClick={closeMenu}>
                  <Button variant="primary" size="md" className="w-full">
                    Create Account
                  </Button>
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </header>
  );
}

export default Navbar;
