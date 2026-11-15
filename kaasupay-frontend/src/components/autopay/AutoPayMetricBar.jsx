import { CheckCircle2, PauseCircle, Calendar, ArrowUpRight } from 'lucide-react';
import AmountDisplay from '../ui/AmountDisplay';

export function AutoPayMetricBar({ mandates = [] }) {
  const activeMandates = mandates.filter((m) => m.status === 'ACTIVE');
  const pausedMandates = mandates.filter((m) => m.status === 'PAUSED');

  // Sum monthly commitment of active mandates in integer paise
  const monthlyCommitmentPaise = activeMandates.reduce((sum, m) => sum + (m.amount || 0), 0);

  // Find nearest upcoming nextRunDay among active mandates
  const upcomingRuns = activeMandates
    .map((m) => m.nextRunDay)
    .filter(Boolean)
    .sort();
  const nextUpcomingDate = upcomingRuns.length > 0 ? upcomingRuns[0] : null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {/* Active Mandates */}
      <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-5 h-5" />
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Active</p>
          <p className="text-xl font-black text-navy-900">{activeMandates.length}</p>
        </div>
      </div>

      {/* Paused Mandates */}
      <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
          <PauseCircle className="w-5 h-5" />
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Paused</p>
          <p className="text-xl font-black text-navy-900">{pausedMandates.length}</p>
        </div>
      </div>

      {/* Monthly Commitment */}
      <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-cobalt-50 text-cobalt-600 flex items-center justify-center shrink-0">
          <ArrowUpRight className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Monthly Total</p>
          <AmountDisplay paise={monthlyCommitmentPaise} size="md" className="font-black text-navy-900 truncate" />
        </div>
      </div>

      {/* Next Upcoming Run */}
      <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
          <Calendar className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Next Execution</p>
          <p className="text-sm font-black text-navy-900 truncate">
            {nextUpcomingDate || 'None Scheduled'}
          </p>
        </div>
      </div>
    </div>
  );
}

export default AutoPayMetricBar;
