import { motion } from 'framer-motion';
import { Sparkles, Trophy, Frown, CheckCircle2, ShieldCheck } from 'lucide-react';
import AmountDisplay from '../../ui/AmountDisplay';

/**
 * Underlying prize display beneath the scratch foil.
 */
export default function RewardRevealView({
  card,
  claimResult,
  isLoadingClaim,
  isFullyRevealed,
  width = 320,
  height = 360,
}) {
  const isExhausted = claimResult?.status === 'EXHAUSTED' || card?.status === 'EXHAUSTED';
  const wonAmount = claimResult?.amount ?? (card?.status === 'CLAIMED' ? card.amount : null);

  return (
    <div
      style={{ width: `${width}px`, height: `${height}px` }}
      className="rounded-2xl p-6 flex flex-col items-center justify-center text-center relative overflow-hidden bg-linear-to-b from-navy-900 via-navy-950 to-slate-950 text-white shadow-inner"
    >
      {/* Background Decorative Rings */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(245,158,11,0.18)_0%,transparent_70%)] pointer-events-none" />

      {/* State 1: Scratching in progress (not fully revealed yet) */}
      {!isFullyRevealed ? (
        <div className="flex flex-col items-center justify-center space-y-4 animate-pulse">
          <div className="w-20 h-20 rounded-full bg-amber-500/10 border border-amber-400/30 flex items-center justify-center text-amber-400">
            <Sparkles className="w-10 h-10 animate-spin" style={{ animationDuration: '6s' }} />
          </div>
          <div>
            <h4 className="text-lg font-bold text-amber-300">Unlocking Prize...</h4>
            <p className="text-xs text-slate-400 mt-1">Scratch the card to reveal your reward!</p>
          </div>
        </div>
      ) : isExhausted ? (
        /* State 2: Budget Exhausted */
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 15 }}
          className="flex flex-col items-center space-y-3 z-10"
        >
          <div className="w-18 h-18 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 shadow-md">
            <Frown className="w-9 h-9" />
          </div>

          <div className="space-y-1">
            <h3 className="text-xl font-black text-slate-200">Better Luck Next Time!</h3>
            <p className="text-xs text-slate-400 max-w-[240px] mx-auto leading-relaxed">
              The promotional budget for this festival pool has been completely claimed.
            </p>
          </div>

          <div className="pt-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-slate-800/80 text-slate-300 border border-slate-700">
              <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
              Budget Limit Enforced
            </span>
          </div>
        </motion.div>
      ) : (
        /* State 3: Prize Won */
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 12, stiffness: 180 }}
          className="flex flex-col items-center space-y-3 z-10"
        >
          <div className="w-18 h-18 rounded-full bg-linear-to-tr from-amber-500 to-amber-300 text-navy-950 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Trophy className="w-9 h-9" />
          </div>

          <div className="space-y-1">
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-amber-400">
              Cashback Won
            </span>
            <div className="text-3xl font-black text-white font-mono flex items-center justify-center">
              {wonAmount !== null ? (
                <AmountDisplay paise={wonAmount} size="2xl" className="text-white font-bold" />
              ) : (
                '₹0.00'
              )}
            </div>
          </div>

          <p className="text-xs text-emerald-400 flex items-center gap-1.5 font-semibold">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Credited directly to wallet!
          </p>

          <div className="pt-2">
            <span className="text-[10px] text-slate-400 font-mono">
              Campaign: {card?.offer || card?.offerCode || 'DIWALI'}
            </span>
          </div>
        </motion.div>
      )}
    </div>
  );
}
