import { useEffect } from 'react';
import { ShieldCheck, RefreshCw, AlertTriangle, Clock } from 'lucide-react';
import { useWallet, useAppDispatch } from '../../store/hooks';
import { fetchDailyLimits } from '../../store/slices/walletSlice';
import AmountDisplay from '../ui/AmountDisplay';
import Badge from '../ui/Badge';

export function DailyLimitCard({ className = '' }) {
  const dispatch = useAppDispatch();
  const { dailyLimits, dailyLimitsLoading } = useWallet();

  const dailyLimit = dailyLimits?.dailyLimit || 1000000; // ₹10,000 in paise
  const usedToday = dailyLimits?.usedToday || 0;
  const leftToday = dailyLimits?.leftToday !== undefined ? dailyLimits.leftToday : dailyLimit - usedToday;

  const usagePercent = Math.min(100, Math.round((usedToday / dailyLimit) * 100));

  useEffect(() => {
    dispatch(fetchDailyLimits());
  }, [dispatch]);

  const handleRefresh = () => {
    dispatch(fetchDailyLimits());
  };

  const getBarColor = () => {
    if (usagePercent >= 100) return 'bg-rose-500';
    if (usagePercent >= 75) return 'bg-amber-500';
    return 'bg-cobalt-600';
  };

  return (
    <div className={`p-4 sm:p-5 bg-white border border-slate-200/90 rounded-2xl shadow-sm ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cobalt-50 text-cobalt-600">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-navy-950 uppercase tracking-wider">
              Daily Outgoing Limit
            </h3>
            <p className="text-[11px] text-slate-500">Shared limit for Transfers & Bank Withdrawals</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={dailyLimitsLoading}
          className="cursor-pointer p-1.5 text-slate-400 hover:text-navy-900 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-40"
          title="Refresh limits"
          aria-label="Refresh daily limit"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${dailyLimitsLoading ? 'animate-spin text-cobalt-600' : ''}`} />
        </button>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5 my-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-600">
            Spent Today: <AmountDisplay paise={usedToday} size="sm" className="font-bold text-navy-900 inline" />
          </span>
          <span className="font-bold text-navy-900">{usagePercent}%</span>
        </div>
        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200/60">
          <div
            className={`h-full transition-all duration-500 rounded-full ${getBarColor()}`}
            style={{ width: `${usagePercent}%` }}
          />
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
            Remaining Today
          </span>
          <AmountDisplay
            paise={leftToday}
            size="sm"
            className={`font-black ${leftToday === 0 ? 'text-rose-600' : 'text-emerald-600'}`}
          />
        </div>
        <div className="text-right">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
            Daily Maximum
          </span>
          <AmountDisplay paise={dailyLimit} size="sm" className="font-bold text-slate-700" />
        </div>
      </div>

      {/* Limit Reached Warning */}
      {leftToday === 0 && (
        <div className="mt-3 p-2 bg-rose-50 border border-rose-200/80 rounded-xl flex items-center gap-2 text-[11px] text-rose-700 font-semibold">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>Daily limit reached. Further outgoing transactions will resume tonight at 12:00 AM IST.</span>
        </div>
      )}

      {/* Footer info */}
      <div className="mt-2.5 flex items-center justify-between text-[10px] text-slate-400">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" /> Resets every day at 12:00 AM IST
        </span>
        <Badge variant={leftToday === 0 ? 'danger' : 'neutral'} size="sm">
          {leftToday === 0 ? 'Limit Exhausted' : 'Protected'}
        </Badge>
      </div>
    </div>
  );
}

export default DailyLimitCard;
