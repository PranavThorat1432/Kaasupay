import { ShieldCheck, Wifi } from 'lucide-react';

export function BankCardFallback({ className = '', maskedAccount = '•••• •••• •••• 1234', holderName = 'ACCOUNT HOLDER' }) {
  return (
    <div
      className={`w-full max-w-85 aspect-[1.586/1] rounded-2xl p-6 bg-linear-to-br from-navy-950 via-slate-900 to-navy-900 border border-slate-700/60 shadow-xl shadow-navy-950/20 text-white flex flex-col justify-between select-none relative overflow-hidden ${className}`}
      aria-label="Bank Card Graphic"
    >
      {/* Decorative background glow */}
      <div className="absolute top-0 right-0 w-44 h-44 bg-cobalt-500/15 rounded-full blur-2xl pointer-events-none" />

      {/* Card Header: Chip and Contactless Icon */}
      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center gap-3">
          {/* Smart EMV Chip */}
          <div className="w-10 h-7 rounded-md bg-linear-to-br from-amber-200 via-amber-400 to-amber-600 border border-amber-300 shadow-xs flex items-center justify-center p-1">
            <div className="w-full h-full border border-amber-800/40 rounded-xs grid grid-cols-2 gap-0.5" />
          </div>
          <Wifi className="w-5 h-5 text-slate-400 rotate-90" />
        </div>

        <div className="flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-200">
          <span className="text-white">Kaasu</span>
          <span className="text-cobalt-400">Pay</span>
        </div>
      </div>

      {/* Account Number */}
      <div className="relative z-10 my-2">
        <div className="font-mono text-base sm:text-lg tracking-[0.2em] font-medium text-slate-200 drop-shadow-xs">
          {maskedAccount}
        </div>
      </div>

      {/* Footer: Cardholder and Security Badge */}
      <div className="flex items-center justify-between relative z-10 text-[11px] font-mono">
        <div>
          <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-sans">
            Beneficiary
          </span>
          <span className="text-xs font-semibold text-slate-200 tracking-wide truncate max-w-42.5 block">
            {holderName}
          </span>
        </div>

        <div className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-500/30 font-sans">
          <ShieldCheck className="w-3 h-3" />
          AES-256 Verified
        </div>
      </div>
    </div>
  );
}

export default BankCardFallback;
