import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { removeToast } from '../../store/slices/uiSlice';

const icons = {
  success: <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />,
  error: <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />,
  warning: <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />,
  info: <Info className="w-5 h-5 text-cobalt-600 shrink-0" />,
};

const borderColors = {
  success: 'border-emerald-200',
  error: 'border-rose-200',
  warning: 'border-amber-200',
  info: 'border-cobalt-200',
};

export function ToastItem({ toast }) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!toast.duration) return;
    const timer = setTimeout(() => {
      dispatch(removeToast(toast.id));
    }, toast.duration);
    return () => clearTimeout(timer);
  }, [dispatch, toast.id, toast.duration]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -16, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.95 }}
      transition={{ duration: 0.18 }}
      className={`pointer-events-auto flex items-start gap-3 w-84 sm:w-96 p-4 rounded-xl bg-white shadow-lg shadow-slate-900/10 border ${
        borderColors[toast.type] || 'border-slate-200'
      }`}
      role="status"
    >
      <div className="mt-0.5">{icons[toast.type] || icons.info}</div>
      <div className="flex-1 min-w-0">
        {toast.title && (
          <h5 className="font-semibold text-xs text-navy-900 leading-snug">
            {toast.title}
          </h5>
        )}
        <p className="text-xs text-slate-600 mt-0.5 leading-relaxed wrap-break-word">
          {toast.message}
        </p>
      </div>
      <button
        type="button"
        onClick={() => dispatch(removeToast(toast.id))}
        className="cursor-pointer text-slate-400 hover:text-slate-600 p-1 -mr-1 -mt-1 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-600"
        aria-label="Dismiss toast"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

export function ToastContainer() {
  const toasts = useAppSelector((state) => state.ui.toasts);

  return (
    <div
      aria-live="polite"
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-full px-4 sm:px-0"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>
  );
}

export default ToastContainer;
