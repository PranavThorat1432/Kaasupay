import { Sparkles, Trophy, Frown, Clock, ArrowRight } from 'lucide-react';
import Card, { CardContent } from '../ui/Card';
import AmountDisplay from '../ui/AmountDisplay';
import { formatDateTime } from '../../utils/currency';

export default function ScratchCardItem({ card, onSelect }) {
  const isUnclaimed = card.status === 'UNCLAIMED';
  const isClaimed = card.status === 'CLAIMED';
  const isExhausted = card.status === 'EXHAUSTED';
  const isExpired = card.status === 'EXPIRED';

  return (
    <Card
      onClick={() => onSelect(card)}
      className={`group cursor-pointer transition-all duration-300 relative overflow-hidden rounded-2xl border ${
        isUnclaimed
          ? 'bg-linear-to-br from-amber-400 via-amber-500 to-amber-600 border-amber-300 shadow-md hover:shadow-xl hover:-translate-y-1'
          : isClaimed
          ? 'bg-linear-to-br from-navy-900 to-navy-950 border-emerald-500/30 text-white shadow-xs hover:shadow-md'
          : 'bg-slate-100 border-slate-200 text-slate-500 shadow-xs'
      }`}
    >
      <CardContent className="p-5 flex flex-col justify-between h-44">
        {/* Card Header */}
        <div className="flex items-start justify-between">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
              isUnclaimed
                ? 'bg-navy-950 text-amber-300'
                : isClaimed
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-slate-200 text-slate-600'
            }`}
          >
            {card.offer || card.offerCode || 'REWARD'}
          </span>

          <span
            className={`text-[10px] font-mono flex items-center gap-1 ${
              isUnclaimed
                ? 'text-navy-950 font-bold'
                : 'text-slate-400'
            }`}
          >
            <Clock className="w-3 h-3" />
            {formatDateTime(card.createdAt).slice(0, 11)}
          </span>
        </div>

        {/* Card Center Content */}
        <div className="my-auto text-center">
          {isUnclaimed ? (
            <div className="space-y-1">
              <div className="w-10 h-10 mx-auto rounded-full bg-navy-950 text-amber-400 flex items-center justify-center shadow-sm">
                <Sparkles className="w-5 h-5 group-hover:rotate-12 transition-transform" />
              </div>
              <h4 className="font-black text-navy-950 text-sm mt-2">Scratch Card</h4>
              <p className="text-[11px] text-navy-900 font-medium">Tap to unlock cashback</p>
            </div>
          ) : isClaimed ? (
            <div className="space-y-1">
              <div className="w-9 h-9 mx-auto rounded-full bg-amber-500 text-navy-950 flex items-center justify-center shadow-xs">
                <Trophy className="w-4 h-4" />
              </div>
              <div className="text-xl font-black text-white font-mono mt-1">
                <AmountDisplay paise={card.amount} size="lg" className="text-white font-bold" />
              </div>
              <p className="text-[10px] text-emerald-400 font-semibold">Cashback Won</p>
            </div>
          ) : isExhausted ? (
            <div className="space-y-1">
              <div className="w-8 h-8 mx-auto rounded-full bg-slate-200 text-slate-400 flex items-center justify-center">
                <Frown className="w-4 h-4" />
              </div>
              <h4 className="font-bold text-slate-700 text-xs mt-1">Better luck next time</h4>
              <p className="text-[10px] text-slate-400">Budget pool was exhausted</p>
            </div>
          ) : (
            <div className="space-y-1">
              <h4 className="font-bold text-slate-600 text-xs">Card Expired</h4>
              <p className="text-[10px] text-slate-400">Not scratched within 7 days</p>
            </div>
          )}
        </div>

        {/* Card Footer */}
        <div className="pt-2 border-t border-black/5 flex items-center justify-between text-[11px]">
          {isUnclaimed ? (
            <span className="font-extrabold text-navy-950 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
              Scratch Now <ArrowRight className="w-3.5 h-3.5" />
            </span>
          ) : (
            <span className="text-[10px] text-slate-400 font-mono">
              Status: {card.status}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

