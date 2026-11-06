import { Trophy, Gift, CheckCircle2, Flame } from 'lucide-react';
import Card, { CardContent } from '../ui/Card';
import AmountDisplay from '../ui/AmountDisplay';

export default function RewardsMetricBar({
  totalWonPaise = 0,
  unclaimedCount = 0,
  scratchedCount = 0,
  activeOffersCount = 0,
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* Metric 1: Total Won */}
      <Card className="bg-linear-to-br from-amber-50 to-amber-100/60 border-amber-200/80 shadow-xs">
        <CardContent className="p-4 sm:p-5 flex items-center gap-3.5">
          <div className="p-3 rounded-2xl bg-amber-500 text-navy-950 shrink-0 shadow-sm shadow-amber-500/20">
            <Trophy className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">
              Total Won
            </p>
            <div className="mt-0.5">
              <AmountDisplay paise={totalWonPaise} size="lg" className="text-navy-950 font-black font-mono" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Metric 2: Available Cards */}
      <Card className="bg-white border-slate-200/80 shadow-xs">
        <CardContent className="p-4 sm:p-5 flex items-center gap-3.5">
          <div className="p-3 rounded-2xl bg-cobalt-50 text-cobalt-600 shrink-0">
            <Gift className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Ready to Scratch
            </p>
            <p className="text-xl sm:text-2xl font-black text-navy-950 mt-0.5 font-mono">
              {unclaimedCount}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Metric 3: Scratched */}
      <Card className="bg-white border-slate-200/80 shadow-xs">
        <CardContent className="p-4 sm:p-5 flex items-center gap-3.5">
          <div className="p-3 rounded-2xl bg-emerald-50 text-emerald-600 shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Scratched
            </p>
            <p className="text-xl sm:text-2xl font-black text-navy-950 mt-0.5 font-mono">
              {scratchedCount}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Metric 4: Active Offers */}
      <Card className="bg-white border-slate-200/80 shadow-xs">
        <CardContent className="p-4 sm:p-5 flex items-center gap-3.5">
          <div className="p-3 rounded-2xl bg-rose-50 text-rose-600 shrink-0">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Festival Offers
            </p>
            <p className="text-xl sm:text-2xl font-black text-navy-950 mt-0.5 font-mono">
              {activeOffersCount}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
