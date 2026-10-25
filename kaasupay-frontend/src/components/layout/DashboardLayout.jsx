import { useEffect } from 'react';
import { Outlet, NavLink, Link, useLocation } from 'react-router-dom';
import {
  Wallet,
  LayoutDashboard,
  Send,
  PlusCircle,
  History,
  LogOut,
  User,
  ShieldCheck,
  Menu,
  X,
  ArrowUpRight,
  Landmark,
} from 'lucide-react';
import { useAuth, useWallet, useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchWalletBalance } from '../../store/slices/walletSlice';
import { toggleMobileNav, setMobileNavOpen } from '../../store/slices/uiSlice';
import AmountDisplay from '../ui/AmountDisplay';
import Button from '../ui/Button';

const navItems = [
  { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { name: 'Send Money', path: '/transfer', icon: Send },
  { name: 'Add Money', path: '/add-money', icon: PlusCircle },
  { name: 'Withdraw', path: '/withdraw', icon: ArrowUpRight },
  { name: 'Bank Accounts', path: '/bank-accounts', icon: Landmark },
  { name: 'Transactions', path: '/transactions', icon: History },
];

export function DashboardLayout() {
  const dispatch = useAppDispatch();
  const { user, logout } = useAuth();
  const { balance } = useWallet();
  const isMobileNavOpen = useAppSelector((state) => state.ui.isMobileNavOpen);
  const location = useLocation();

  // Fetch fresh wallet balance on mount and route changes
  useEffect(() => {
    dispatch(fetchWalletBalance());
  }, [dispatch, location.pathname]);

  const closeDrawer = () => dispatch(setMobileNavOpen(false));

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Skip to Content */}
      <a
        href="#dashboard-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 z-50 px-4 py-2 bg-cobalt-600 text-white rounded-lg shadow-md font-semibold text-xs"
      >
        Skip to main content
      </a>

      {/* Desktop Sidebar */}
      <aside
        className="hidden md:flex w-64 flex-col bg-white border-r border-slate-200/80 sticky top-0 h-screen select-none z-30"
        aria-label="Dashboard Sidebar"
      >
        {/* Brand */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-xl bg-cobalt-600 text-white flex items-center justify-center shadow-xs">
              <Wallet className="w-4 h-4" />
            </div>
            <span className="font-extrabold text-lg text-navy-900 tracking-tight">
              Kaasu<span className="text-cobalt-600">Pay</span>
            </span>
          </Link>
        </div>

        {/* Balance Card Widget in Sidebar */}
        <div className="p-4 mx-4 my-4 bg-linear-to-br from-navy-900 to-navy-800 rounded-2xl text-white shadow-md shadow-navy-950/10">
          <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1">
            <span className="uppercase tracking-wider font-semibold">Wallet Balance</span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-1">
            <AmountDisplay paise={balance} size="xl" className="text-white font-mono" />
          </div>
          <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
            <Link to="/add-money" className="w-full">
              <Button
                variant="primary"
                size="sm"
                leftIcon={<PlusCircle className="w-3.5 h-3.5" />}
                className="w-full text-xs font-semibold py-1.5 shadow-sm"
              >
                Top-Up Wallet
              </Button>
            </Link>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-4 py-2 space-y-1.5" aria-label="Dashboard Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-cobalt-50 text-cobalt-700 shadow-xs'
                      : 'text-slate-600 hover:text-navy-900 hover:bg-slate-100'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.name}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* User Profile & Sign Out Footer */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center shrink-0">
              <User className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-navy-900 truncate">
                {user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user?.username}
              </p>
              <p className="text-[10px] text-slate-400 truncate font-mono">
                {user?.username}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="cursor-pointer text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Top Header */}
        <header className="md:hidden sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200 px-4 h-14 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-cobalt-600 text-white flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
            <span className="font-extrabold text-base text-navy-900">
              Kaasu<span className="text-cobalt-600">Pay</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <AmountDisplay paise={balance} size="sm" className="font-mono text-xs" />
            <button
              type="button"
              onClick={() => dispatch(toggleMobileNav())}
              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Toggle mobile drawer"
            >
              {isMobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </header>

        {/* Mobile Slide-out Drawer */}
        {isMobileNavOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <div
              className="fixed inset-0 bg-navy-950/40 backdrop-blur-xs"
              onClick={closeDrawer}
              aria-hidden="true"
            />
            <div className="relative w-72 bg-white h-full flex flex-col p-4 shadow-xl z-10">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <span className="font-extrabold text-base text-navy-900">
                  Kaasu<span className="text-cobalt-600">Pay</span>
                </span>
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 bg-navy-900 rounded-xl text-white mb-4">
                <span className="text-[10px] text-slate-300 uppercase tracking-wider">Balance</span>
                <AmountDisplay paise={balance} size="lg" className="text-white block mt-1" />
              </div>

              <nav className="flex-1 space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={closeDrawer}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold ${
                          isActive
                            ? 'bg-cobalt-50 text-cobalt-700'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`
                      }
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.name}</span>
                    </NavLink>
                  );
                })}
              </nav>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-600 font-semibold truncate">{user?.username}</span>
                <button
                  type="button"
                  onClick={() => {
                    closeDrawer();
                    logout();
                  }}
                  className="text-xs text-rose-600 font-semibold p-1"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Dashboard Content Container */}
        <main id="dashboard-main" className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default DashboardLayout;
