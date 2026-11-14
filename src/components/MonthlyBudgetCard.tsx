import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, Pencil, Target } from 'lucide-react';
import { useCurrency } from '../hooks/useCurrency';
import type { Project } from '../types';

interface MonthlyBudgetCardProps {
  project: Project;
  thisMonthSpend: number;
  onUpdateBudget: (budget: number | null) => Promise<void>;
}

export function MonthlyBudgetCard({
  project,
  thisMonthSpend,
  onUpdateBudget,
}: MonthlyBudgetCardProps) {
  const [editing, setEditing] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { currency, inrPerUnit, formatAmount } = useCurrency();

  useEffect(() => {
    setEditing(false);
    setError(null);
    setBudgetInput(project.monthlyBudget ? String(project.monthlyBudget) : '');
  }, [project.id, project.monthlyBudget]);

  const budget = project.monthlyBudget;
  const hasBudget = typeof budget === 'number' && budget > 0;
  const monthLabel = new Date().toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = budgetInput.trim();
    if (!trimmed) {
      setSaving(true);
      setError(null);
      try {
        await onUpdateBudget(null);
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to clear budget.');
      } finally {
        setSaving(false);
      }
      return;
    }

    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError('Enter a valid monthly budget greater than ₹0.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onUpdateBudget(numeric);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save monthly budget.');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <section
        aria-label="Configure Monthly Budget"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5"
      >
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Monthly Spending Limit — {project.name}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Set a maximum monthly cap in ₹ to trigger alerts at 50%, 80%, 90%, 95%, and 100%
                usage. Leave blank to disable.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 dark:text-slate-400 font-mono-tabular">
                ₹
              </span>
              <input
                type="number"
                min="1"
                step="any"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                placeholder="e.g. 25000"
                className="w-full pl-7 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono-tabular text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Save Limit</span>
            </button>

            {hasBudget && (
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onUpdateBudget(null);
                    setEditing(false);
                  } finally {
                    setSaving(false);
                  }
                }}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
              >
                Remove Limit
              </button>
            )}

            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setError(null);
                setBudgetInput(budget ? String(budget) : '');
              }}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
          </div>

          {currency !== 'INR' && Number(budgetInput) > 0 && (
            <p className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
              ≈ {formatAmount(Number(budgetInput))} at 1 {currency} = ₹{inrPerUnit[currency].toFixed(2)}
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}
        </form>
      </section>
    );
  }

  if (!hasBudget) {
    return (
      <section
        aria-label="Monthly Budget"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-5 py-4 flex flex-wrap items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Target className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
          <div className="min-w-0">
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Monthly Budget Limit
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Spent <span className="font-mono-tabular font-semibold text-slate-700 dark:text-slate-200">{formatAmount(thisMonthSpend)}</span> in {monthLabel} · No spending cap configured yet
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Target className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
          <span>Set Monthly Budget</span>
        </button>
      </section>
    );
  }

  const ratio = thisMonthSpend / budget;
  const percent = Math.round(ratio * 1000) / 10;
  const clampedWidth = Math.min(100, Math.max(0, ratio * 100));
  const remaining = budget - thisMonthSpend;

  const isExceeded = ratio >= 1;
  const isCritical = !isExceeded && ratio >= 0.95;
  const isHigh = !isExceeded && !isCritical && ratio >= 0.9;
  const isApproaching = !isExceeded && !isCritical && !isHigh && ratio >= 0.8;
  const isHalfway = !isExceeded && !isCritical && !isHigh && !isApproaching && ratio >= 0.5;

  const barColorClass = isExceeded
    ? 'bg-red-600'
    : isCritical
      ? 'bg-rose-600'
      : isHigh
        ? 'bg-orange-500'
        : isApproaching
          ? 'bg-amber-500'
          : 'bg-teal-600';

  const statusTextColor = isExceeded
    ? 'text-red-700 dark:text-red-400'
    : isCritical
      ? 'text-rose-700 dark:text-rose-400'
      : isHigh
        ? 'text-orange-700 dark:text-orange-400'
        : isApproaching
          ? 'text-amber-700 dark:text-amber-400'
          : 'text-teal-700 dark:text-teal-400';

  const alertSurfaceClass = isExceeded
    ? 'bg-red-50/70 dark:bg-red-950/30 border-red-200 dark:border-red-900/70'
    : isCritical
      ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/70'
      : isHigh
        ? 'bg-orange-50/70 dark:bg-orange-950/30 border-orange-200 dark:border-orange-900/70'
        : isApproaching
          ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/70'
          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800';

  return (
    <section
      aria-label="Monthly Budget Tracker"
      className={`border rounded-xl p-5 space-y-3.5 ${alertSurfaceClass}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Monthly Budget ({monthLabel})
            </h2>
            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${statusTextColor}`}>
              {isExceeded ? (
                <>
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Budget Exceeded</span>
                </>
              ) : isCritical ? (
                <>
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Critical (95%+)</span>
                </>
              ) : isHigh ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>High Usage (90%+)</span>
                </>
              ) : isApproaching ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>Approaching Limit (80%+)</span>
                </>
              ) : isHalfway ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>50%+ Used</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>On Track</span>
                </>
              )}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {isExceeded ? (
              <>
                Exceeded monthly limit by{' '}
                <span className="font-mono-tabular font-semibold text-red-700 dark:text-red-400">
                  {formatAmount(Math.abs(remaining))}
                </span>
              </>
            ) : isCritical || isHigh || isApproaching ? (
              <>
                Approaching cap —{' '}
                <span className={`font-mono-tabular font-semibold ${statusTextColor}`}>
                  {formatAmount(remaining)}
                </span>{' '}
                remaining for {monthLabel}
              </>
            ) : (
              <>
                <span className="font-mono-tabular font-semibold text-slate-800 dark:text-slate-200">
                  {formatAmount(remaining)}
                </span>{' '}
                remaining of your monthly cap
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right font-mono-tabular">
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {formatAmount(thisMonthSpend)}{' '}
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                / {formatAmount(budget)}
              </span>
            </div>
            <div className={`text-xs font-semibold ${statusTextColor}`}>{percent}% used</div>
          </div>

          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit monthly budget"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Monthly budget usage ${percent}%`}
        className="w-full h-2.5 bg-slate-200/80 dark:bg-slate-800 rounded-full overflow-hidden"
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColorClass}`}
          style={{ width: `${clampedWidth}%` }}
        />
      </div>
    </section>
  );
}
