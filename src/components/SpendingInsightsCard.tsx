import { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Plus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { formatINR } from '../constants';
import type { Expense, Tag } from '../types';
import { analyzeSpendingInsights, type SpendingInsight } from '../utils/insightsUtils';

interface SpendingInsightsCardProps {
  expenses: Expense[];
  tags: Tag[];
  activeTagFilters: string[];
  onFilterByTag: (tagId: string) => void;
  onInspectExpense: (expense: Expense) => void;
  onAddExpense: () => void;
}

function getSeverityVisuals(insight: SpendingInsight) {
  switch (insight.severity) {
    case 'alert':
      return {
        icon: AlertTriangle,
        iconColor: 'text-red-600 dark:text-red-400',
        metricColor: 'text-red-700 dark:text-red-400',
        label: 'High Anomaly',
        labelColor: 'text-red-700 dark:text-red-400',
      };
    case 'warning':
      return {
        icon: insight.kind === 'outlier-tx' ? ArrowUpRight : TrendingUp,
        iconColor: 'text-amber-600 dark:text-amber-400',
        metricColor: 'text-amber-700 dark:text-amber-400',
        label: 'Notable Shift',
        labelColor: 'text-amber-700 dark:text-amber-400',
      };
    case 'positive':
      return {
        icon: insight.kind === 'category-drop' ? TrendingDown : CheckCircle2,
        iconColor: 'text-emerald-600 dark:text-emerald-400',
        metricColor: 'text-emerald-700 dark:text-emerald-400',
        label: insight.kind === 'category-drop' ? 'Lower Spend' : 'On Track',
        labelColor: 'text-emerald-700 dark:text-emerald-400',
      };
    default:
      return {
        icon: Activity,
        iconColor: 'text-slate-500 dark:text-slate-400',
        metricColor: 'text-slate-900 dark:text-slate-100',
        label: 'Observation',
        labelColor: 'text-slate-600 dark:text-slate-400',
      };
  }
}

export function SpendingInsightsCard({
  expenses,
  tags,
  activeTagFilters,
  onFilterByTag,
  onInspectExpense,
  onAddExpense,
}: SpendingInsightsCardProps) {
  const report = useMemo(() => analyzeSpendingInsights(expenses, tags), [expenses, tags]);

  return (
    <section
      aria-label="Spending Insights"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Spending Insights
            </h2>
            {expenses.length > 0 && (
              <span
                className={`text-xs font-semibold ${
                  report.anomalyCount > 0
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-teal-700 dark:text-teal-400'
                }`}
              >
                {report.anomalyCount > 0
                  ? `${report.anomalyCount} ${report.anomalyCount === 1 ? 'anomaly' : 'anomalies'} flagged`
                  : 'Within normal range'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {report.hasPreviousMonthData ? (
              <>
                Comparing {report.currentMonthLabel} against {report.previousMonthLabel}
                <span aria-hidden="true"> · </span>
                Category spikes, outliers, and month-over-month shifts
              </>
            ) : (
              <>
                Analyzing {report.currentMonthLabel} activity
                <span aria-hidden="true"> · </span>
                Month-over-month comparisons appear once {report.previousMonthLabel} data exists
              </>
            )}
          </p>
        </div>

        {expenses.length > 0 && (
          <div className="text-left sm:text-right font-mono-tabular shrink-0">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {report.hasPreviousMonthData
                ? `${report.currentMonthLabel} vs ${report.previousMonthLabel}`
                : `${report.currentMonthLabel} Spend`}
            </div>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
              {formatINR(report.currentMonthTotal)}
              {report.hasPreviousMonthData && (
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  {' '}
                  / {formatINR(report.previousMonthTotal)}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {expenses.length === 0 ? (
        <div className="pt-5 flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
            Log expenses across categories and months to surface category spikes, unusual transaction
            outliers, and month-over-month trends.
          </p>
          <button
            type="button"
            onClick={onAddExpense}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Expense</span>
          </button>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {report.insights.map((insight) => {
            const visuals = getSeverityVisuals(insight);
            const IconComponent = visuals.icon;
            const isFiltered = Boolean(
              insight.tagId && activeTagFilters.includes(insight.tagId)
            );

            return (
              <div
                key={insight.id}
                className="py-3.5 first:pt-4 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <IconComponent className={`w-4 h-4 mt-0.5 shrink-0 ${visuals.iconColor}`} />
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className={`text-xs font-semibold ${visuals.labelColor}`}>
                        {visuals.label}
                      </span>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-600 text-xs">
                        ·
                      </span>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {insight.title}
                      </h3>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {insight.detail}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4 pl-7 sm:pl-0 shrink-0">
                  <div className="text-left sm:text-right font-mono-tabular">
                    <div className={`text-sm font-bold ${visuals.metricColor}`}>
                      {insight.metricLabel}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {insight.comparisonLabel}
                    </div>
                  </div>

                  {insight.tagId && (
                    <button
                      type="button"
                      onClick={() => onFilterByTag(insight.tagId!)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        isFiltered
                          ? 'bg-slate-900 dark:bg-teal-600 text-white border-slate-900 dark:border-teal-600'
                          : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {isFiltered ? 'Filtered' : 'Filter Tag'}
                    </button>
                  )}

                  {!insight.tagId && insight.expense && (
                    <button
                      type="button"
                      onClick={() => onInspectExpense(insight.expense!)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Inspect
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
