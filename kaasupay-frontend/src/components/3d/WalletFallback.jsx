import { ShieldCheck, Sparkles, CreditCard } from 'lucide-react';

export function WalletFallback({ className = '' }) {
  return (
    <div
      className={`relative w-full aspect-square max-w-sm mx-auto flex items-center justify-center ${className}`}
      aria-label="KaasuPay Digital Card visual"
    >
      {/* Ambient gradient glow */}
      <div className="absolute inset-0 bg-linear-to-tr from-cobalt-500/15 via-lavender-400/20 to-transparent rounded-full blur-2xl" />

      {/* Decorative Stylized Card Element */}
      <div className="relative w-64 h-40 bg-linear-to-br from-navy-900 via-navy-800 to-cobalt-900 rounded-2xl shadow-xl shadow-navy-950/20 p-5 flex flex-col justify-between border border-white/10 text-white transform rotate-3 hover:rotate-0 transition-transform duration-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-cobalt-600/60 backdrop-blur-xs flex items-center justify-center text-white border border-white/20">
              <CreditCard className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold tracking-wider uppercase text-slate-300">KaasuPay</span>
          </div>
          <Sparkles className="w-4 h-4 text-lavender-300" />
        </div>

        <div className="my-auto pt-2">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono">Atomic Ledger Balance</div>
          <div className="text-lg font-black tracking-tight font-mono text-white">₹ •••• ••••</div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-300">
          <span className="font-mono">VERIFIED WALLET</span>
          <div className="flex items-center gap-1 text-emerald-400 font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>256-bit</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WalletFallback;
