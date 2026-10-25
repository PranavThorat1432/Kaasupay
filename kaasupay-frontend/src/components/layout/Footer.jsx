import { ShieldCheck, Lock, CheckCircle2, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="w-full bg-white border-t border-slate-200/80 py-12 px-4 sm:px-6 lg:px-8 mt-auto text-slate-500">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8">
        {/* Brand & Mission */}
        <div className="md:col-span-2 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-cobalt-600 text-white flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
            <span className="font-extrabold text-base text-navy-900 tracking-tight">
              Kaasu<span className="text-cobalt-600">Pay</span>
            </span>
          </div>
          <p className="text-xs leading-relaxed max-w-sm text-slate-500">
            High-integrity digital wallet built on strict integer paise accounting, atomic MongoDB transactions, and cryptographic idempotency protection.
          </p>
          <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] font-medium text-slate-600">
            <span className="flex items-center gap-1.5 text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200/50">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              Atomic MongoDB Ledger
            </span>
            <span className="flex items-center gap-1.5 text-cobalt-700 bg-cobalt-50 px-2.5 py-1 rounded-md border border-cobalt-200/50">
              <Lock className="w-3.5 h-3.5 text-cobalt-600" />
              Idempotent Transfers
            </span>
          </div>
        </div>

        {/* Quick Links */}
        <div>
          <h4 className="text-xs font-bold text-navy-900 uppercase tracking-wider mb-3">Platform</h4>
          <ul className="space-y-2 text-xs">
            <li>
              <Link to="/dashboard" className="hover:text-cobalt-600 transition-colors">
                Dashboard Overview
              </Link>
            </li>
            <li>
              <Link to="/transfer" className="hover:text-cobalt-600 transition-colors">
                P2P Money Transfer
              </Link>
            </li>
            <li>
              <Link to="/add-money" className="hover:text-cobalt-600 transition-colors">
                Razorpay Top-Up
              </Link>
            </li>
            <li>
              <Link to="/transactions" className="hover:text-cobalt-600 transition-colors">
                Audit Ledger
              </Link>
            </li>
          </ul>
        </div>

        {/* Security & Integrity */}
        <div>
          <h4 className="text-xs font-bold text-navy-900 uppercase tracking-wider mb-3">Integrity</h4>
          <ul className="space-y-2 text-xs">
            <li className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Zero Floating-Point Error</span>
            </li>
            <li className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Verified Webhook HMAC</span>
            </li>
            <li className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Reconciled Balances</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="max-w-7xl mx-auto mt-8 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-400 gap-2">
        <p>© {new Date().getFullYear()} KaasuPay Technologies. All rights reserved.</p>
        <p className="font-mono">Precision: 100 paise = ₹1.00</p>
      </div>
    </footer>
  );
}

export default Footer;
