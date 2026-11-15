import { AlertTriangle, PauseCircle, PlayCircle, XCircle } from 'lucide-react';
import Dialog, { DialogFooter } from '../ui/Dialog';
import Button from '../ui/Button';
import Alert from '../ui/Alert';

export function ConfirmActionDialog({
  isOpen,
  onClose,
  onConfirm,
  actionType = 'pause', // 'pause' | 'resume' | 'cancel'
  mandate = null,
  isLoading = false,
}) {
  if (!mandate) return null;

  const recipientName = mandate.to || mandate.payee?.name || 'recipient';

  const config = {
    pause: {
      title: 'Pause AutoPay',
      description: `Temporarily suspend recurring payments to ${recipientName}.`,
      icon: <PauseCircle className="w-5 h-5 text-amber-600" />,
      confirmVariant: 'primary',
      confirmText: 'Pause AutoPay',
      warning: 'No payments will be processed while this AutoPay is paused. You can resume it at any time.',
      warningVariant: 'warning',
    },
    resume: {
      title: 'Resume AutoPay',
      description: `Reactivate recurring monthly payments to ${recipientName}.`,
      icon: <PlayCircle className="w-5 h-5 text-emerald-600" />,
      confirmVariant: 'primary',
      confirmText: 'Resume AutoPay',
      warning: 'Payments will resume on your scheduled monthly day. Skipped months during the pause window will not be charged.',
      warningVariant: 'info',
    },
    cancel: {
      title: 'Permanently Cancel AutoPay',
      description: `Stop all future automated payments to ${recipientName}.`,
      icon: <XCircle className="w-5 h-5 text-rose-600" />,
      confirmVariant: 'danger',
      confirmText: 'Yes, Cancel Permanently',
      warning: 'This action is permanent and cannot be undone. Once cancelled, this mandate cannot be resumed.',
      warningVariant: 'danger',
    },
  }[actionType] || {};

  return (
    <Dialog
      isOpen={isOpen}
      onClose={isLoading ? () => {} : onClose}
      title={config.title}
      description={config.description}
      maxWidth="max-w-md"
    >
      <div className="space-y-4 pt-2">
        <Alert
          variant={config.warningVariant}
          icon={<AlertTriangle className="w-4 h-4 shrink-0" />}
        >
          <span className="text-xs leading-relaxed">{config.warning}</span>
        </Alert>

        <DialogFooter className="pt-2">
          <Button
            variant="outline"
            size="md"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant={config.confirmVariant}
            size="md"
            onClick={onConfirm}
            isLoading={isLoading}
          >
            {config.confirmText}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

export default ConfirmActionDialog;
