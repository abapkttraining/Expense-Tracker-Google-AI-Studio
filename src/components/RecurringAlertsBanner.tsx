import { useState } from 'react';
import { Bell, CalendarClock, Check, ChevronDown, ChevronUp, Loader2, SkipForward } from 'lucide-react';
import { useCurrency } from '../hooks/useCurrency';
import { formatFrequencyLabel, type RecurringBillAlert } from '../utils/recurringUtils';
import type { Expense } from '../types';

interface RecurringAlertsBannerProps {
  alerts: RecurringBillAlert[];
  lastCheckedLabel: string;
  onLogPayment: (alert: RecurringBillAlert) => Promise<void>;
  onSkipCycle: (alert: RecurringBillAlert) => Promise<void>;
  onEditExpense: (expense: Expense) => void;
}

function getStatusText(alert: RecurringBillAlert): string {
  if (alert.status === 'overdue') {
    const days = Math.abs(alert.daysDiff);
    return `Overdue by ${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (alert.status === 'due_today') {
    return 'Due today';
  }
  return `Due in ${alert.daysDiff} ${alert.daysDiff === 1 ? 'day' : 'days'}`;
}

export function RecurringAlertsBanner({
  alerts,
  lastCheckedLabel,
  onLogPayment,
  onSkipCycle,
  onEditExpense,
}: RecurringAlertsBannerProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { formatAmount } = useCurrency();

  if (alerts.length === 0) return null;

  const overdueCount = alerts.filter((a) => a.status === 'overdue').length;
  const dueTodayCount = alerts.filter((a) => a.status === 'due_today').length;
  const upcomingCount = alerts.filter((a) => a.status === 'upcoming').length;

  const summaryParts: string[] = [];
  if (overdueCount > 0) summaryParts.push(`${overdueCount} overdue`);
  if (dueTodayCount > 0) summaryParts.push(`${dueTodayCount} due today`);
  if (upcomingCount > 0) summaryParts.push(`${upcomingCount} upcoming`);

  return (
    <section
      aria-label="Recurring Bill Notifications"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
    >
      <div className="px-5 py-3.5 bg-amber-50/60 dark:bg-amber-950/30 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Bell className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Recurring Bills Due ({alerts.length})
              </h2>
              <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
                {summaryParts.join(' · ')}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Scheduled check updated {lastCheckedLabel} · 7-day lookahead window
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
        >
          <span>{collapsed ? 'Show Alerts' : 'Minimize'}</span>
          {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      </div>

      {!collapsed && (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {alerts.map((alert) => {
            const isBusy = busyId === alert.expense.id;
            const statusText = getStatusText(alert);
            const statusColorClass =
              alert.status === 'overdue'
                ? 'text-red-700 dark:text-red-400'
                : alert.status === 'due_today'
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-teal-700 dark:text-teal-400';

            return (
              <div
                key={alert.expense.id}
                className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {alert.expense.description || 'Recurring expense'}
                    </span>
                    <span className={`text-xs font-semibold ${statusColorClass}`}>
                      {statusText}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1 font-mono-tabular">
                      <CalendarClock className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                      Due {alert.dueDate}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatFrequencyLabel(alert.expense.frequency)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{alert.expense.paymentMethod}</span>
                    <span aria-hidden="true">·</span>
                    <span>Paid by {alert.expense.paidByName}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 flex-wrap">
                  <span className="font-mono-tabular text-sm font-bold text-slate-900 dark:text-slate-100 mr-1">
                    {formatAmount(alert.expense.amount)}
                  </span>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={async () => {
                      setBusyId(alert.expense.id);
                      try {
                        await onLogPayment(alert);
                      } finally {
                        setBusyId(null);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {isBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>Log Payment</span>
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={async () => {
                      setBusyId(alert.expense.id);
                      try {
                        await onSkipCycle(alert);
                      } finally {
                        setBusyId(null);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    <span>Skip Cycle</span>
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onEditExpense(alert.expense)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
