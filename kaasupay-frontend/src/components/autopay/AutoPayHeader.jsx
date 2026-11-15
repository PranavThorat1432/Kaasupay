import { PlusCircle, ShieldAlert } from 'lucide-react';
import Button from '../ui/Button';

export function AutoPayHeader({
  nonCancelledCount = 0,
  maxMandates = 5,
  onOpenCreate,
}) {
  const isAtLimit = nonCancelledCount >= maxMandates;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200/80">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-black text-navy-900 tracking-tight">AutoPay</h1>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${
              isAtLimit
                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                : 'bg-cobalt-50 text-cobalt-700 border border-cobalt-200'
            }`}
          >
            {isAtLimit && <ShieldAlert className="w-3.5 h-3.5" />}
            {nonCancelledCount}/{maxMandates} Mandates
          </span>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          Schedule automated recurring monthly wallet payments to friends and family.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          leftIcon={<PlusCircle className="w-4 h-4" />}
          onClick={onOpenCreate}
          disabled={isAtLimit}
          className="shadow-sm font-semibold"
          title={isAtLimit ? 'You have reached the maximum limit of 5 AutoPays' : 'Set up a new AutoPay'}
        >
          Set up AutoPay
        </Button>
      </div>
    </div>
  );
}

export default AutoPayHeader;
