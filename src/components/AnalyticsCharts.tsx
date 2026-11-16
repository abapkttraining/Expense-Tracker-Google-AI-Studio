import { useMemo, useState } from 'react';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { PAYMENT_METHODS, type Expense, type Tag, type Timeframe } from '../types';
import {
  formatConvertedAmount,
  getCurrencySymbol,
  PAYMENT_METHOD_COLORS,
} from '../constants';
import { useCurrency } from '../hooks/useCurrency';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler
);

interface AnalyticsChartsProps {
  expenses: Expense[];
  tags: Tag[];
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  isDark?: boolean;
}

function getWeekStartKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const day = dt.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  dt.setDate(dt.getDate() + diff);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatBucketLabel(key: string, timeframe: Timeframe): string {
  if (timeframe === 'yearly') return key;
  if (timeframe === 'monthly') {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-IN', {
      month: 'short',
      year: '2-digit',
    });
  }
  const [y, m, d] = key.split('-').map(Number);
  const label = new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
  return timeframe === 'weekly' ? `Wk ${label}` : label;
}

export function useExpenseAnalytics({
  expenses,
  tags,
  timeframe,
  isDark = false,
  selectedParentTagId,
  onSelectParentTagId,
}: {
  expenses: Expense[];
  tags: Tag[];
  timeframe: Timeframe;
  isDark?: boolean;
  selectedParentTagId?: string;
  onSelectParentTagId?: (id: string) => void;
}) {
  const [trendStyle, setTrendStyle] = useState<'bar' | 'line'>('bar');
  const [subTagStyle, setSubTagStyle] = useState<'doughnut' | 'bar'>('doughnut');
  const [internalParentId, setInternalParentId] = useState<string>('');
  const { currency, convertAmount, formatAmount } = useCurrency();
  const currencySymbol = getCurrencySymbol(currency);

  const userSelectedParentId = selectedParentTagId ?? internalParentId;
  const setUserSelectedParentId = onSelectParentTagId ?? setInternalParentId;

  const tagMap = useMemo(() => {
    const map = new Map<string, Tag>();
    for (const t of tags) map.set(t.id, t);
    return map;
  }, [tags]);

  const directChildrenByParentKey = useMemo(() => {
    const map = new Map<string, Tag[]>();
    for (const t of tags) {
      const parentKey = t.parentCategory.trim().toLowerCase();
      if (!parentKey) continue;
      const list = map.get(parentKey) ?? [];
      list.push(t);
      map.set(parentKey, list);
    }
    return map;
  }, [tags]);

  const trendSeries = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const exp of expenses) {
      let key = exp.date;
      if (timeframe === 'weekly') key = getWeekStartKey(exp.date);
      else if (timeframe === 'monthly') key = exp.date.slice(0, 7);
      else if (timeframe === 'yearly') key = exp.date.slice(0, 4);
      buckets.set(key, (buckets.get(key) ?? 0) + exp.amount);
    }
    const sortedKeys = Array.from(buckets.keys()).sort();
    return {
      labels: sortedKeys.map((k) => formatBucketLabel(k, timeframe)),
      values: sortedKeys.map((k) => Math.round((buckets.get(k) ?? 0) * 100) / 100),
    };
  }, [expenses, timeframe]);

  const weightedSpendByTagId = useMemo(() => {
    const totals = new Map<string, number>();
    for (const exp of expenses) {
      const expTags = exp.tagIds.length > 0 ? exp.tagIds : ['other'];
      const share = exp.amount / expTags.length;
      for (const tid of expTags) {
        totals.set(tid, (totals.get(tid) ?? 0) + share);
      }
    }
    return totals;
  }, [expenses]);

  const tagBreakdown = useMemo(() => {
    const rows = Array.from(weightedSpendByTagId.entries())
      .map(([tagId, amount]) => {
        const tag = tagMap.get(tagId);
        return {
          id: tagId,
          name: tag?.name ?? 'Other',
          color: tag?.color ?? '#64748B',
          amount: Math.round(amount * 100) / 100,
        };
      })
      .sort((a, b) => b.amount - a.amount);

    const grandTotal = rows.reduce((sum, r) => sum + r.amount, 0) || 1;
    return rows.map((r) => ({
      ...r,
      percent: Math.round((r.amount / grandTotal) * 1000) / 10,
    }));
  }, [weightedSpendByTagId, tagMap]);

  // Sort tags for parent selector: tags that have sub-tags first, then others alphabetically
  const parentSelectorOptions = useMemo(() => {
    return [...tags]
      .map((t) => {
        const children = directChildrenByParentKey.get(t.name.trim().toLowerCase()) ?? [];
        const subSpend = children.reduce(
          (sum, child) => sum + (weightedSpendByTagId.get(child.id) ?? 0),
          0
        );
        return {
          tag: t,
          childCount: children.length,
          subSpend,
        };
      })
      .sort((a, b) => {
        if ((a.childCount > 0) !== (b.childCount > 0)) {
          return a.childCount > 0 ? -1 : 1;
        }
        if (b.subSpend !== a.subSpend) return b.subSpend - a.subSpend;
        return a.tag.name.localeCompare(b.tag.name);
      });
  }, [tags, directChildrenByParentKey, weightedSpendByTagId]);

  const activeParentTag = useMemo(() => {
    if (userSelectedParentId) {
      const matched = tags.find((t) => t.id === userSelectedParentId);
      if (matched) return matched;
    }
    return parentSelectorOptions[0]?.tag ?? null;
  }, [userSelectedParentId, tags, parentSelectorOptions]);

  const subTagBreakdown = useMemo(() => {
    if (!activeParentTag) {
      return {
        childCount: 0,
        totalAmount: 0,
        rows: [] as Array<{
          id: string;
          name: string;
          color: string;
          amount: number;
          percent: number;
          isDirect?: boolean;
        }>,
      };
    }

    const directChildren =
      directChildrenByParentKey.get(activeParentTag.name.trim().toLowerCase()) ?? [];

    if (directChildren.length === 0) {
      return { childCount: 0, totalAmount: 0, rows: [] };
    }

    const rawRows: Array<{
      id: string;
      name: string;
      color: string;
      amount: number;
      isDirect?: boolean;
    }> = [];
    for (const child of directChildren) {
      let amount = 0;
      const visited = new Set<string>();
      const queue: Tag[] = [child];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        amount += weightedSpendByTagId.get(current.id) ?? 0;
        const grandchildren =
          directChildrenByParentKey.get(current.name.trim().toLowerCase()) ?? [];
        for (const gc of grandchildren) {
          if (!visited.has(gc.id)) queue.push(gc);
        }
      }
      const rounded = Math.round(amount * 100) / 100;
      if (rounded > 0) {
        rawRows.push({
          id: child.id,
          name: child.name,
          color: child.color,
          amount: rounded,
        });
      }
    }

    const directParentSpend =
      Math.round((weightedSpendByTagId.get(activeParentTag.id) ?? 0) * 100) / 100;
    if (directParentSpend > 0) {
      rawRows.push({
        id: `${activeParentTag.id}-direct`,
        name: `${activeParentTag.name} (Direct)`,
        color: activeParentTag.color,
        amount: directParentSpend,
        isDirect: true,
      });
    }

    rawRows.sort((a, b) => b.amount - a.amount);
    const totalAmount = rawRows.reduce((sum, r) => sum + r.amount, 0);
    const divisor = totalAmount || 1;

    return {
      childCount: directChildren.length,
      totalAmount: Math.round(totalAmount * 100) / 100,
      rows: rawRows.map((r) => ({
        ...r,
        percent: Math.round((r.amount / divisor) * 1000) / 10,
      })),
    };
  }, [activeParentTag, directChildrenByParentKey, weightedSpendByTagId]);

  const paymentBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    for (const m of PAYMENT_METHODS) totals.set(m, 0);
    for (const exp of expenses) {
      totals.set(exp.paymentMethod, (totals.get(exp.paymentMethod) ?? 0) + exp.amount);
    }
    return PAYMENT_METHODS.map((method) => ({
      method,
      amount: Math.round((totals.get(method) ?? 0) * 100) / 100,
      color: PAYMENT_METHOD_COLORS[method] ?? '#0F766E',
    })).sort((a, b) => b.amount - a.amount);
  }, [expenses]);

  const trendChartData = useMemo(
    () => ({
      labels: trendSeries.labels,
      datasets: [
        {
          label: `Spend (${currencySymbol})`,
          data: trendSeries.values.map((v) => convertAmount(v)),
          backgroundColor: trendStyle === 'bar' ? '#0D9488' : 'rgba(13, 148, 136, 0.12)',
          borderColor: '#0F766E',
          borderWidth: trendStyle === 'line' ? 2 : 0,
          borderRadius: 6,
          fill: trendStyle === 'line',
          tension: 0.3,
          pointRadius: 3.5,
          pointBackgroundColor: '#0F766E',
        },
      ],
    }),
    [trendSeries, trendStyle, convertAmount, currencySymbol]
  );

  const gridColor = isDark ? '#1E293B' : '#F1F5F9';
  const tickColor = isDark ? '#94A3B8' : '#64748B';
  const labelColor = isDark ? '#CBD5E1' : '#334155';

  const trendOptions: ChartOptions<'bar'> & ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${formatConvertedAmount(Number(ctx.parsed.y ?? 0), currency)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: tickColor, font: { size: 11 } },
      },
      y: {
        beginAtZero: true,
        grid: { color: gridColor },
        ticks: {
          color: tickColor,
          font: { size: 11 },
          callback: (val) =>
            formatConvertedAmount(Number(val), currency, { compactAxis: true }),
        },
      },
    },
  };

  const doughnutData = useMemo(
    () => ({
      labels: tagBreakdown.map((t) => t.name),
      datasets: [
        {
          data: tagBreakdown.map((t) => convertAmount(t.amount)),
          backgroundColor: tagBreakdown.map((t) => t.color),
          borderColor: isDark ? '#0F172A' : '#FFFFFF',
          borderWidth: 2,
          hoverOffset: 4,
        },
      ],
    }),
    [tagBreakdown, isDark, convertAmount]
  );

  const subTagDoughnutData = useMemo(
    () => ({
      labels: subTagBreakdown.rows.map((t) => t.name),
      datasets: [
        {
          data: subTagBreakdown.rows.map((t) => convertAmount(t.amount)),
          backgroundColor: subTagBreakdown.rows.map((t) => t.color),
          borderColor: isDark ? '#0F172A' : '#FFFFFF',
          borderWidth: 2,
          hoverOffset: 4,
        },
      ],
    }),
    [subTagBreakdown.rows, isDark, convertAmount]
  );

  const subTagBarData = useMemo(
    () => ({
      labels: subTagBreakdown.rows.map((t) => t.name),
      datasets: [
        {
          label: `Spend (${currencySymbol})`,
          data: subTagBreakdown.rows.map((t) => convertAmount(t.amount)),
          backgroundColor: subTagBreakdown.rows.map((t) => t.color),
          borderRadius: 5,
          barThickness: 18,
        },
      ],
    }),
    [subTagBreakdown.rows, convertAmount, currencySymbol]
  );

  const doughnutOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '66%',
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) =>
            ` ${ctx.label}: ${formatConvertedAmount(Number(ctx.parsed ?? 0), currency)}`,
        },
      },
    },
  };

  const horizontalBarOptions: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${formatConvertedAmount(Number(ctx.parsed.x ?? 0), currency)}`,
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        grid: { color: gridColor },
        ticks: {
          color: tickColor,
          font: { size: 11 },
          callback: (val) =>
            formatConvertedAmount(Number(val), currency, { compactAxis: true }),
        },
      },
      y: {
        grid: { display: false },
        ticks: { color: labelColor, font: { size: 11, weight: 500 } },
      },
    },
  };

  const paymentData = useMemo(
    () => ({
      labels: paymentBreakdown.map((p) => p.method),
      datasets: [
        {
          label: `Spend (${currencySymbol})`,
          data: paymentBreakdown.map((p) => convertAmount(p.amount)),
          backgroundColor: paymentBreakdown.map((p) => p.color),
          borderRadius: 5,
          barThickness: 18,
        },
      ],
    }),
    [paymentBreakdown, convertAmount, currencySymbol]
  );

  return {
    hasExpenses: expenses.length > 0,
    formatAmount,
    tagMap,
    directChildrenByParentKey,
    trendStyle,
    setTrendStyle,
    trendChartData,
    trendOptions,
    tagBreakdown,
    doughnutData,
    doughnutOptions,
    parentSelectorOptions,
    activeParentTag,
    setUserSelectedParentId,
    subTagStyle,
    setSubTagStyle,
    subTagBreakdown,
    subTagDoughnutData,
    subTagBarData,
    horizontalBarOptions,
    paymentData,
  };
}

export type ExpenseAnalyticsState = ReturnType<typeof useExpenseAnalytics>;

const TIMEFRAME_OPTIONS: Array<{ id: Timeframe; label: string }> = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
];

export function ExpenseTrendChartCard({
  analytics,
  timeframe,
  onTimeframeChange,
}: {
  analytics: ExpenseAnalyticsState;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
            Expense Trend
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Spending trajectory aggregated by selected timeframe
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            {TIMEFRAME_OPTIONS.map((tf) => (
              <button
                key={tf.id}
                type="button"
                onClick={() => onTimeframeChange(tf.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  timeframe === tf.id
                    ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => analytics.setTrendStyle('bar')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                analytics.trendStyle === 'bar'
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Bar
            </button>
            <button
              type="button"
              onClick={() => analytics.setTrendStyle('line')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                analytics.trendStyle === 'line'
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Line
            </button>
          </div>
        </div>
      </div>

      {!analytics.hasExpenses ? (
        <div className="h-64 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
          No matching expenses to plot for the selected filters.
        </div>
      ) : (
        <div className="h-64">
          {analytics.trendStyle === 'bar' ? (
            <Bar
              data={analytics.trendChartData}
              options={analytics.trendOptions as ChartOptions<'bar'>}
            />
          ) : (
            <Line
              data={analytics.trendChartData}
              options={analytics.trendOptions as ChartOptions<'line'>}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function SpendingByTagCard({ analytics }: { analytics: ExpenseAnalyticsState }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
          Spending by Tag
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Weighted allocation across system and custom tags
        </p>
      </div>
      {analytics.tagBreakdown.length === 0 ? (
        <div className="h-60 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
          Tag breakdown appears once expenses are logged.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-center">
          <div className="sm:col-span-5 h-52">
            <Doughnut data={analytics.doughnutData} options={analytics.doughnutOptions} />
          </div>
          <div className="sm:col-span-7 max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 pr-1">
            {analytics.tagBreakdown.map((item) => {
              const hasChildren =
                (analytics.directChildrenByParentKey.get(item.name.trim().toLowerCase())?.length ??
                  0) > 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (analytics.tagMap.has(item.id)) analytics.setUserSelectedParentId(item.id);
                  }}
                  title={
                    hasChildren
                      ? `Inspect sub-tags of ${item.name}`
                      : analytics.tagMap.has(item.id)
                        ? `Select ${item.name}`
                        : undefined
                  }
                  className="w-full py-2 flex items-center justify-between gap-3 text-xs text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded px-1 -mx-1 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                      {item.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0 font-mono-tabular">
                    <span className="text-slate-500 dark:text-slate-400">{item.percent}%</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {analytics.formatAmount(item.amount)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function SpendingBySubTagsCard({ analytics }: { analytics: ExpenseAnalyticsState }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
            Spending by Sub-tags
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {analytics.activeParentTag
              ? `Sub-tag breakdown for ${analytics.activeParentTag.name}${
                  analytics.subTagBreakdown.totalAmount > 0
                    ? ` · ${analytics.formatAmount(analytics.subTagBreakdown.totalAmount)}`
                    : ''
                }`
              : 'Select a parent tag to inspect its child sub-tags'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            aria-label="Select parent tag for sub-tag breakdown"
            value={analytics.activeParentTag?.id ?? ''}
            onChange={(e) => analytics.setUserSelectedParentId(e.target.value)}
            disabled={analytics.parentSelectorOptions.length === 0}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-600 max-w-[180px]"
          >
            {analytics.parentSelectorOptions.map(({ tag, childCount }) => (
              <option key={tag.id} value={tag.id}>
                {tag.name} ({childCount} {childCount === 1 ? 'sub-tag' : 'sub-tags'})
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => analytics.setSubTagStyle('doughnut')}
              className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                analytics.subTagStyle === 'doughnut'
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Ring
            </button>
            <button
              type="button"
              onClick={() => analytics.setSubTagStyle('bar')}
              className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                analytics.subTagStyle === 'bar'
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Bar
            </button>
          </div>
        </div>
      </div>

      {!analytics.activeParentTag || analytics.subTagBreakdown.childCount === 0 ? (
        <div className="h-60 px-4 flex items-center justify-center text-center text-xs sm:text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
          {analytics.activeParentTag
            ? `No sub-tags created under "${analytics.activeParentTag.name}" yet. Add a child tag in Tags & Members to view this breakdown.`
            : 'Select a parent tag to inspect sub-tag spending.'}
        </div>
      ) : analytics.subTagBreakdown.rows.length === 0 ? (
        <div className="h-60 px-4 flex items-center justify-center text-center text-xs sm:text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
          No spending recorded under {analytics.activeParentTag.name} sub-tags for the current filters.
        </div>
      ) : analytics.subTagStyle === 'bar' ? (
        <div className="h-60">
          <Bar data={analytics.subTagBarData} options={analytics.horizontalBarOptions} />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-center">
          <div className="sm:col-span-5 h-52">
            <Doughnut data={analytics.subTagDoughnutData} options={analytics.doughnutOptions} />
          </div>
          <div className="sm:col-span-7 max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 pr-1">
            {analytics.subTagBreakdown.rows.map((item) => (
              <div
                key={item.id}
                className="py-2 flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-xs shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                    {item.name}
                  </span>
                </div>
                <div className="flex items-center gap-2.5 shrink-0 font-mono-tabular">
                  <span className="text-slate-500 dark:text-slate-400">{item.percent}%</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {analytics.formatAmount(item.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PaymentMethodChartCard({ analytics }: { analytics: ExpenseAnalyticsState }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
          Payment Method Breakdown
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Comparison across PhonePe, Google Pay, BHIM UPI, Paytm, Cards &amp; Cash
        </p>
      </div>
      {!analytics.hasExpenses ? (
        <div className="h-60 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
          Payment channel totals appear once expenses are logged.
        </div>
      ) : (
        <div className="h-60">
          <Bar data={analytics.paymentData} options={analytics.horizontalBarOptions} />
        </div>
      )}
    </div>
  );
}

export function AnalyticsCharts({
  expenses,
  tags,
  timeframe,
  onTimeframeChange,
  isDark = false,
}: AnalyticsChartsProps) {
  const analytics = useExpenseAnalytics({
    expenses,
    tags,
    timeframe,
    isDark,
  });

  return (
    <section aria-label="Spending Analytics" className="space-y-6">
      <ExpenseTrendChartCard
        analytics={analytics}
        timeframe={timeframe}
        onTimeframeChange={onTimeframeChange}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SpendingByTagCard analytics={analytics} />
        <SpendingBySubTagsCard analytics={analytics} />
      </div>
      <PaymentMethodChartCard analytics={analytics} />
    </section>
  );
}
