import { useEffect } from 'react';
import { AlertCircle, AlertTriangle, TrendingUp, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCurrency } from '../hooks/useCurrency';
import type { BudgetToastItem, BudgetToastSeverity } from '../utils/budgetUtils';

interface BudgetToastContainerProps {
  toasts: BudgetToastItem[];
  onDismiss: (id: string) => void;
  onInspectBudget?: () => void;
}

const SEVERITY_STYLES: Record<
  BudgetToastSeverity,
  {
    surface: string;
    title: string;
    bar: string;
    icon: string;
  }
> = {
  info: {
    surface: 'bg-white dark:bg-slate-900 border-teal-200 dark:border-teal-800',
    title: 'text-teal-900 dark:text-teal-200',
    bar: 'bg-teal-600 dark:bg-teal-500',
    icon: 'text-teal-700 dark:text-teal-400',
  },
  warning: {
    surface: 'bg-amber-50 dark:bg-slate-900 border-amber-200 dark:border-amber-800',
    title: 'text-amber-950 dark:text-amber-200',
    bar: 'bg-amber-500',
    icon: 'text-amber-700 dark:text-amber-400',
  },
  high: {
    surface: 'bg-orange-50 dark:bg-slate-900 border-orange-200 dark:border-orange-800',
    title: 'text-orange-950 dark:text-orange-200',
    bar: 'bg-orange-500',
    icon: 'text-orange-700 dark:text-orange-400',
  },
  critical: {
    surface: 'bg-rose-50 dark:bg-slate-900 border-rose-200 dark:border-rose-800',
    title: 'text-rose-950 dark:text-rose-200',
    bar: 'bg-rose-600 dark:bg-rose-500',
    icon: 'text-rose-700 dark:text-rose-400',
  },
  exceeded: {
    surface: 'bg-red-50 dark:bg-slate-900 border-red-300 dark:border-red-800',
    title: 'text-red-950 dark:text-red-200',
    bar: 'bg-red-600 dark:bg-red-500',
    icon: 'text-red-700 dark:text-red-400',
  },
};

function ToastIcon({ severity, className }: { severity: BudgetToastSeverity; className: string }) {
  if (severity === 'exceeded' || severity === 'critical') {
    return <AlertCircle className={className} />;
  }
  if (severity === 'warning' || severity === 'high') {
    return <AlertTriangle className={className} />;
  }
  return <TrendingUp className={className} />;
}

function SingleBudgetToast({
  toast,
  onDismiss,
  onInspectBudget,
}: {
  toast: BudgetToastItem;
  onDismiss: (id: string) => void;
  onInspectBudget?: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onDismiss(toast.id);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const { formatAmount } = useCurrency();
  const styles = SEVERITY_STYLES[toast.severity];
  const fillPct = Math.min(100, Math.max(0, toast.percentUsed));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.97 }}
      transition={{ duration: 0.18 }}
      role={toast.severity === 'exceeded' || toast.severity === 'critical' ? 'alert' : 'status'}
      aria-live={toast.severity === 'exceeded' || toast.severity === 'critical' ? 'assertive' : 'polite'}
      className={`w-full max-w-sm border rounded-xl shadow-lg p-4 space-y-2.5 pointer-events-auto ${styles.surface}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <ToastIcon severity={toast.severity} className={`w-4 h-4 mt-0.5 shrink-0 ${styles.icon}`} />
          <div className="min-w-0 space-y-0.5">
            <h3 className={`font-display text-xs font-bold leading-snug ${styles.title}`}>
              {toast.title}
            </h3>
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{toast.message}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss budget notification"
          className="p-1 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="w-full h-1.5 bg-slate-200/80 dark:bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${styles.bar}`}
            style={{ width: `${fillPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] font-mono-tabular text-slate-600 dark:text-slate-400">
          <span>
            {formatAmount(toast.newSpend)} / {formatAmount(toast.budget)}
          </span>
          <div className="flex items-center gap-2.5">
            <span className="font-semibold text-slate-800 dark:text-slate-200">{toast.percentUsed}%</span>
            {onInspectBudget && (
              <button
                type="button"
                onClick={() => {
                  onInspectBudget();
                  onDismiss(toast.id);
                }}
                className="font-sans font-semibold text-teal-800 dark:text-teal-400 hover:underline cursor-pointer"
              >
                View
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function BudgetToastContainer({
  toasts,
  onDismiss,
  onInspectBudget,
}: BudgetToastContainerProps) {
  return (
    <div
      aria-label="Budget Threshold Notifications"
      className="fixed top-20 right-4 sm:right-6 z-50 flex flex-col items-end gap-2.5 w-[calc(100vw-2rem)] max-w-sm pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <SingleBudgetToast
            key={toast.id}
            toast={toast}
            onDismiss={onDismiss}
            onInspectBudget={onInspectBudget}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
