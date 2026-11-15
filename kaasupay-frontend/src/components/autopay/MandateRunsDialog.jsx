import { History, CheckCircle2, XCircle, AlertCircle, Clock } from 'lucide-react';
import Dialog from '../ui/Dialog';
import Badge from '../ui/Badge';
import AmountDisplay from '../ui/AmountDisplay';
import Spinner from '../ui/Spinner';
import Alert from '../ui/Alert';

export function MandateRunsDialog({
  isOpen,
  onClose,
  mandate,
  runs = [],
  isLoading = false,
  error = null,
}) {
  if (!mandate) return null;

  const recipientName = mandate.to || mandate.payee?.name || 'recipient';

  const renderStatusBadge = (status) => {
    switch (status) {
      case 'SUCCESS':
        return (
          <Badge variant="success" className="gap-1 font-bold">
            <CheckCircle2 className="w-3 h-3" />
            SUCCESS
          </Badge>
        );
      case 'FAILED':
        return (
          <Badge variant="danger" className="gap-1 font-bold">
            <XCircle className="w-3 h-3" />
            FAILED
          </Badge>
        );
      case 'MISSED':
        return (
          <Badge variant="warning" className="gap-1 font-bold">
            <Clock className="w-3 h-3" />
            MISSED
          </Badge>
        );
      default:
        return <Badge variant="neutral">{status}</Badge>;
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Execution History"
      description={`Monthly payment records for ${recipientName}`}
      maxWidth="max-w-xl"
    >
      <div className="space-y-4 pt-2">
        {/* Mandate Summary Header */}
        <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500">Monthly Mandate</p>
            <p className="text-sm font-bold text-navy-900">{recipientName}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold text-slate-500">Day {mandate.dayOfMonth} each month</p>
            <AmountDisplay paise={mandate.amount} size="md" className="font-black text-navy-900" />
          </div>
        </div>

        {/* Loading Spinner */}
        {isLoading && (
          <div className="py-12 flex flex-col items-center justify-center gap-2">
            <Spinner size="md" />
            <p className="text-xs text-slate-500">Loading payment run records...</p>
          </div>
        )}

        {/* Error Alert */}
        {!isLoading && error && (
          <Alert variant="danger" icon={<AlertCircle className="w-4 h-4 shrink-0" />}>
            <span className="text-xs font-medium">{error}</span>
          </Alert>
        )}

        {/* Empty Runs State */}
        {!isLoading && !error && runs.length === 0 && (
          <div className="py-10 text-center border-2 border-dashed border-slate-200 rounded-2xl p-6">
            <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-2">
              <History className="w-5 h-5" />
            </div>
            <p className="text-sm font-bold text-navy-900">No Payment Runs Yet</p>
            <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
              This mandate has not reached its scheduled run date. Executions will appear here automatically.
            </p>
          </div>
        )}

        {/* Runs List */}
        {!isLoading && !error && runs.length > 0 && (
          <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
            {runs.map((run) => (
              <div
                key={run.id || run._id}
                className="p-3 bg-white border border-slate-200/90 rounded-xl flex items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-800 text-xs">
                      {run.dueDay}
                    </span>
                    {renderStatusBadge(run.status)}
                  </div>
                  {run.reason && (
                    <p className="text-[11px] text-rose-600 font-medium truncate">
                      {run.reason}
                    </p>
                  )}
                  {run.transactionId && (
                    <p className="text-[10px] text-slate-400 font-mono truncate">
                      Txn: {run.transactionId}
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <AmountDisplay paise={run.amount} size="sm" className="font-bold text-navy-900" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

export default MandateRunsDialog;
