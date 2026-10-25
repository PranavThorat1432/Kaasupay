import { Outlet, Link } from 'react-router-dom';
import { ShieldCheck, ArrowLeft } from 'lucide-react';

export function AuthLayout() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between py-6 sm:py-10 px-4 sm:px-6 lg:px-8 relative selection:bg-cobalt-100 selection:text-cobalt-900">
      {/* Background ambient lighting */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-6xl h-80 bg-radial from-cobalt-500/10 via-lavender-400/5 to-transparent blur-3xl pointer-events-none" />

      {/* Top Bar with Return Home */}
      <div className="max-w-5xl w-full mx-auto flex items-center justify-between mb-6 relative z-10">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-navy-950 transition-colors rounded-lg p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-600"
        >
          <ArrowLeft className="w-4 h-4 text-cobalt-600" />
          <span>Back to Home</span>
        </Link>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Encrypted Session</span>
        </div>
      </div>

      {/* Main Two-Column Auth Container */}
      <main className="max-w-5xl w-full mx-auto my-auto relative z-10">
        <Outlet />
      </main>

      {/* Footer Info */}
      <footer className="max-w-5xl w-full mx-auto text-center mt-8 text-xs text-slate-400 font-mono">
        Strict Atomic Ledger • Integer Paise Integrity • Zero Floating Point Drift
      </footer>
    </div>
  );
}

export default AuthLayout;
