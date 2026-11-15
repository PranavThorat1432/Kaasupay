import {
  Calendar,
  History,
  PauseCircle,
  PlayCircle,
  Trash2,
  AlertTriangle,
  User,
  ShieldAlert,
} from 'lucide-react';
import Card, { CardContent } from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import AmountDisplay from '../ui/AmountDisplay';

export function MandateCard({
  mandate,
  onViewHistory,
  onPause,
  onResume,
  onCancel,
}) {
  const recipientName = mandate.to || mandate.payee?.name || 'Unknown Recipient';
  const recipientUsername = mandate.payee?.username;
  const isCancelled = mandate.status === 'CANCELLED';
  const isPaused = mandate.status === 'PAUSED';
  const isActive = mandate.status === 'ACTIVE';

  const renderStatusBadge = () => {
    switch (mandate.status) {
      case 'ACTIVE':
        return <Badge variant="success" className="font-bold">ACTIVE</Badge>;
      case 'PAUSED':
        return <Badge variant="warning" className="font-bold">PAUSED</Badge>;
      case 'CANCELLED':
        return <Badge variant="neutral" className="font-bold">CANCELLED</Badge>;
      default:
        return <Badge variant="neutral">{mandate.status}</Badge>;
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow border-slate-200/90 overflow-hidden">
      <CardContent className="p-5 space-y-4">
        {/* Top Header Row: Recipient & Status */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 text-slate-600 flex items-center justify-center shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-navy-900 truncate text-sm">{recipientName}</p>
              {recipientUsername && (
                <p className="text-xs text-slate-400 font-mono truncate">{recipientUsername}</p>
              )}
            </div>
          </div>
          <div className="shrink-0">{renderStatusBadge()}</div>
        </div>

        {/* Amount & Schedule Details */}
        <div className="p-3.5 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Monthly Amount</p>
            <AmountDisplay paise={mandate.amount} size="lg" className="font-black text-navy-900" />
          </div>
          <div className="text-right">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Frequency</p>
            <p className="text-xs font-bold text-slate-700 flex items-center gap-1 justify-end mt-0.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              Day {mandate.dayOfMonth}
            </p>
          </div>
        </div>

        {/* Next Execution or Failure Notice */}
        <div className="space-y-1.5 text-xs">
          {!isCancelled && (
            <div className="flex items-center justify-between text-slate-600">
              <span className="text-slate-400">Next Scheduled Date:</span>
              <span className="font-mono font-bold text-navy-900">{mandate.nextRunDay}</span>
            </div>
          )}

          {mandate.failedCount > 0 && !isCancelled && (
            <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-rose-700 text-[11px] font-semibold">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              <span>
                {mandate.failedCount} consecutive failed {mandate.failedCount === 1 ? 'attempt' : 'attempts'}
                {isPaused && ' — Mandate automatically paused'}
              </span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<History className="w-3.5 h-3.5" />}
            onClick={() => onViewHistory(mandate)}
            className="text-xs font-semibold"
          >
            History
          </Button>

          <div className="flex items-center gap-2">
            {isActive && (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<PauseCircle className="w-3.5 h-3.5 text-amber-600" />}
                onClick={() => onPause(mandate)}
                className="text-xs font-semibold text-slate-700 hover:text-amber-700 hover:bg-amber-50"
              >
                Pause
              </Button>
            )}

            {isPaused && (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<PlayCircle className="w-3.5 h-3.5" />}
                onClick={() => onResume(mandate)}
                className="text-xs font-semibold"
              >
                Resume
              </Button>
            )}

            {!isCancelled && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Trash2 className="w-3.5 h-3.5 text-rose-500" />}
                onClick={() => onCancel(mandate)}
                className="text-xs font-semibold text-rose-600 hover:bg-rose-50"
              >
                Cancel
              </Button>
            )}

            {isCancelled && (
              <span className="text-[11px] text-slate-400 font-semibold italic">
                Cancelled permanently
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default MandateCard;
