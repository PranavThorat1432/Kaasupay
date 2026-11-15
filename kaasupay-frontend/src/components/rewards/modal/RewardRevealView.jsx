import { motion } from 'framer-motion';
import { Sparkles, Trophy, Frown, CheckCircle2, ShieldCheck, Clock, AlertCircle, RefreshCw } from 'lucide-react';
import AmountDisplay from '../../ui/AmountDisplay';

/**
 * Underlying prize display beneath the scratch foil.
 * Renders verified prize outcome with dynamic ambient lighting,
 * smooth spring entrance, and state-specific banners.
 */
export default function RewardRevealView({
  card,
  claimResult,
  isLoadingClaim = false,
  isFullyRevealed,
  width = 320,
  height = 360,
  onRetry,
}) {
  const isExhausted = claimResult?.status === 'EXHAUSTED' || card?.status === 'EXHAUSTED';
  const isExpired = claimResult?.status === 'EXPIRED' || card?.status === 'EXPIRED';
  const isError = claimResult?.status === 'ERROR';
  const wonAmount = claimResult?.amount ?? (card?.status === 'CLAIMED' ? card.amount : null);

  return (
    <div
      style={{ width: `${width}px`, height: `${height}px` }}
      className="rounded-2xl p-6 flex flex-col items-center justify-center text-center relative overflow-hidden bg-gradient-to-b from-navy-900 via-navy-950 to-slate-950 text-white shadow-inner select-none"
    >
      {/* Background Ambient Radial Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(245,158,11,0.18)_0%,rgba(15,23,42,0)_75%)] pointer-events-none" />

      {/* Decorative Gold Filigree Border */}
      <div className="absolute inset-2.5 rounded-xl border border-amber-400/20 pointer-events-none" />

      {/* State 1: Scratching in progress or claim in-flight */}
      {!isFullyRevealed || isLoadingClaim ? (
        <div className="flex flex-col items-center justify-center space-y-4 animate-pulse z-10 px-4">
          <div className="relative">
            <div className="absolute -inset-2 rounded-full bg-amber-400/20 blur-md animate-pulse" />
            <div className="relative w-20 h-20 rounded-full bg-amber-500/15 border border-amber-400/40 flex items-center justify-center text-amber-300 shadow-inner">
              <Sparkles className="w-10 h-10 animate-spin" style={{ animationDuration: '6s' }} />
            </div>
          </div>
          <div>
            <h4 className="text-base sm:text-lg font-black tracking-wide text-amber-300">
              {isLoadingClaim ? 'Confirming with Server...' : 'Unlocking Prize...'}
            </h4>
            <p className="text-xs text-slate-400 mt-1 max-w-[220px] mx-auto leading-relaxed">
              {isLoadingClaim ? 'Verifying promotional eligibility' : 'Scratch the foil to reveal your festival reward!'}
            </p>
          </div>
        </div>
      ) : isExhausted ? (
        /* State 2: Budget Exhausted */
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 15 }}
          className="flex flex-col items-center space-y-3 z-10 px-4"
        >
          <div className="w-18 h-18 rounded-full bg-slate-800/90 border border-slate-700 flex items-center justify-center text-slate-400 shadow-lg">
            <Frown className="w-9 h-9" />
          </div>

          <div className="space-y-1">
            <h3 className="text-lg sm:text-xl font-black text-slate-200">Better Luck Next Time!</h3>
            <p className="text-xs text-slate-400 max-w-[230px] mx-auto leading-relaxed">
              The promotional budget for this festival campaign has been completely claimed.
            </p>
          </div>

          <div className="pt-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-slate-800/80 text-slate-300 border border-slate-700 shadow-xs">
              <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
              Budget Limit Enforced
            </span>
          </div>
        </motion.div>
      ) : isExpired ? (
        /* State 3: Card Expired */
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 15 }}
          className="flex flex-col items-center space-y-3 z-10 px-4"
        >
          <div className="w-18 h-18 rounded-full bg-slate-800/90 border border-slate-700 flex items-center justify-center text-amber-400/80 shadow-lg">
            <Clock className="w-9 h-9" />
          </div>

          <div className="space-y-1">
            <h3 className="text-lg sm:text-xl font-black text-slate-200">Card Expired</h3>
            <p className="text-xs text-slate-400 max-w-[230px] mx-auto leading-relaxed">
              This promotional scratch card was not claimed within its 7-day validity window.
            </p>
          </div>

          <div className="pt-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-slate-800/80 text-amber-400/80 border border-slate-700 shadow-xs">
              <Clock className="w-3.5 h-3.5" />
              Claim Window Ended
            </span>
          </div>
        </motion.div>
      ) : isError ? (
        /* State 4: Server or Network Error (Card preserved as UNCLAIMED) */
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 15 }}
          className="flex flex-col items-center space-y-3 z-10 px-4"
        >
          <div className="w-18 h-18 rounded-full bg-rose-950/40 border border-rose-500/30 flex items-center justify-center text-rose-400 shadow-lg">
            <AlertCircle className="w-9 h-9" />
          </div>

          <div className="space-y-1">
            <h3 className="text-lg sm:text-xl font-black text-slate-200">Connection Interrupted</h3>
            <p className="text-xs text-slate-400 max-w-[230px] mx-auto leading-relaxed">
              {claimResult?.message || 'Unable to complete claim right now. Your card remains safe and unclaimed.'}
            </p>
          </div>

          {onRetry && (
            <div className="pt-2">
              <button
                type="button"
                onClick={onRetry}
                className="cursor-pointer inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold bg-amber-500 hover:bg-amber-400 text-navy-950 transition-colors shadow-md"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry Claim
              </button>
            </div>
          )}
        </motion.div>
      ) : (
        /* State 5: Prize Won */
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 12, stiffness: 180 }}
          className="flex flex-col items-center space-y-3 z-10 px-4"
        >
          {/* Glowing Trophy Badge */}
          <div className="relative">
            <div className="absolute -inset-3 rounded-full bg-amber-400/25 blur-lg animate-pulse" />
            <div className="relative w-18 h-18 rounded-full bg-gradient-to-tr from-amber-500 via-amber-400 to-amber-200 text-navy-950 flex items-center justify-center shadow-xl shadow-amber-500/30 border-2 border-amber-200">
              <Trophy className="w-9 h-9" />
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-amber-300 drop-shadow-xs">
              Cashback Won
            </span>
            <div className="text-3xl sm:text-4xl font-black text-white font-mono flex items-center justify-center tracking-tight">
              {wonAmount !== null ? (
                <AmountDisplay paise={wonAmount} size="2xl" className="text-white font-extrabold" />
              ) : (
                '₹0.00'
              )}
            </div>
          </div>

          <p className="text-xs text-emerald-400 flex items-center gap-1.5 font-semibold bg-emerald-950/40 px-3 py-1 rounded-full border border-emerald-500/20">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            Credited directly to wallet!
          </p>

          <div className="pt-1">
            <span className="text-[10px] text-slate-400 font-mono">
              Campaign: {card?.offer || card?.offerCode || 'DIWALI'}
            </span>
          </div>
        </motion.div>
      )}
    </div>
  );
}

