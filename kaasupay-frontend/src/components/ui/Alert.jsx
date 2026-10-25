import { AlertCircle, CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';

const errorStyle = {
  container: 'bg-rose-50 border-rose-200 text-rose-900',
  icon: <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />,
};

const alertStyles = {
  danger: errorStyle,
  error: errorStyle,

  success: {
    container: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    icon: <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />,
  },
  warning: {
    container: 'bg-amber-50 border-amber-200 text-amber-900',
    icon: <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />,
  },
  info: {
    container: 'bg-cobalt-50 border-cobalt-200 text-cobalt-900',
    icon: <Info className="w-5 h-5 text-cobalt-600 shrink-0" />,
  },
  lavender: {
    container: 'bg-lavender-50 border-lavender-200 text-lavender-900',
    icon: <Info className="w-5 h-5 text-lavender-600 shrink-0" />,
  },
};

export function Alert({
  variant = 'info',
  title,
  children,
  onClose,
  className = '',
  ...props
}) {
  const current = alertStyles[variant] || alertStyles.info;

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 p-4 rounded-xl border text-sm transition-all duration-150 ${current.container} ${className}`}
      {...props}
    >
      <div className="mt-0.5">{current.icon}</div>
      <div className="flex-1 min-w-0">
        {title && <h5 className="font-semibold text-sm leading-snug mb-0.5">{title}</h5>}
        <div className="text-xs leading-relaxed opacity-90">{children}</div>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer text-slate-400 hover:text-slate-600 transition-colors p-1 -mr-1 -mt-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-600"
          aria-label="Dismiss alert"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export default Alert;
