import { Flame, Sparkles, Clock, Percent, ShieldCheck } from 'lucide-react';
import Card, { CardContent } from '../ui/Card';
import AmountDisplay from '../ui/AmountDisplay';

export default function ActiveOfferBanner({ offers = [] }) {
  if (!offers || offers.length === 0) {
    return (
      <div className="p-4 rounded-2xl bg-slate-100 border border-slate-200/80 text-center text-xs text-slate-500 font-medium">
        No active festival offers currently running. Check back soon!
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Flame className="w-4 h-4 text-amber-500" />
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-navy-950">
          Live Festival Offers
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {offers.map((offer) => {
          const budgetPct = offer.budget > 0 ? Math.round((offer.budgetLeft / offer.budget) * 100) : 0;
          const minRupees = offer.minPayment / 100;
          const maxRupees = offer.maxCashback / 100;

          return (
            <Card
              key={offer.id || offer.code}
              className="bg-linear-to-br from-navy-950 via-navy-900 to-slate-900 text-white border-amber-500/30 shadow-md relative overflow-hidden"
            >
              {/* Background ambient glow */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-400 flex items-center justify-center font-black">
                      <Percent className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-400 text-navy-950 uppercase tracking-wider">
                        {offer.code}
                      </span>
                      <h3 className="text-base font-black text-white mt-0.5">
                        {offer.percent}% Instant Cashback
                      </h3>
                    </div>
                  </div>

                  <span className="text-[11px] font-mono text-amber-300 font-semibold flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    Active
                  </span>
                </div>

                <p className="text-xs text-slate-300">
                  Earn up to <strong className="text-amber-300">₹{maxRupees.toFixed(2)}</strong> on all payments of{' '}
                  <strong className="text-amber-300">₹{minRupees.toFixed(2)}</strong> or more.
                </p>

                {/* Budget Progress Bar */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                    <span>Campaign Budget Pool</span>
                    <span className="text-amber-300 font-bold">{budgetPct}% Left</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-linear-to-r from-amber-500 to-amber-300 transition-all duration-500"
                      style={{ width: `${budgetPct}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
