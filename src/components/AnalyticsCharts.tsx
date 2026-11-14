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
import { formatINR, PAYMENT_METHOD_COLORS } from '../constants';

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

export function AnalyticsCharts({
  expenses,
  tags,
  timeframe,
  onTimeframeChange,
}: AnalyticsChartsProps) {
  const [trendStyle, setTrendStyle] = useState<'bar' | 'line'>('bar');

  const tagMap = useMemo(() => {
    const map = new Map<string, Tag>();
    for (const t of tags) map.set(t.id, t);
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

  const tagBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    for (const exp of expenses) {
      const expTags = exp.tagIds.length > 0 ? exp.tagIds : ['other'];
      // Split expense amount evenly across its selected tags for accurate sum
      const share = exp.amount / expTags.length;
      for (const tid of expTags) {
        totals.set(tid, (totals.get(tid) ?? 0) + share);
      }
    }
    const rows = Array.from(totals.entries())
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
  }, [expenses, tagMap]);

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
          label: 'Spend (₹)',
          data: trendSeries.values,
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
    [trendSeries, trendStyle]
  );

  const trendOptions: ChartOptions<'bar'> & ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${formatINR(Number(ctx.parsed.y ?? 0))}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#64748B', font: { size: 11 } },
      },
      y: {
        beginAtZero: true,
        grid: { color: '#F1F5F9' },
        ticks: {
          color: '#64748B',
          font: { size: 11 },
          callback: (val) => `₹${Number(val).toLocaleString('en-IN')}`,
        },
      },
    },
  };

  const doughnutData = useMemo(
    () => ({
      labels: tagBreakdown.map((t) => t.name),
      datasets: [
        {
          data: tagBreakdown.map((t) => t.amount),
          backgroundColor: tagBreakdown.map((t) => t.color),
          borderColor: '#FFFFFF',
          borderWidth: 2,
          hoverOffset: 4,
        },
      ],
    }),
    [tagBreakdown]
  );

  const doughnutOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '66%',
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${ctx.label}: ${formatINR(Number(ctx.parsed ?? 0))}`,
        },
      },
    },
  };

  const paymentData = useMemo(
    () => ({
      labels: paymentBreakdown.map((p) => p.method),
      datasets: [
        {
          label: 'Spend (₹)',
          data: paymentBreakdown.map((p) => p.amount),
          backgroundColor: paymentBreakdown.map((p) => p.color),
          borderRadius: 5,
          barThickness: 18,
        },
      ],
    }),
    [paymentBreakdown]
  );

  const paymentOptions: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${formatINR(Number(ctx.parsed.x ?? 0))}`,
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        grid: { color: '#F1F5F9' },
        ticks: {
          color: '#64748B',
          font: { size: 11 },
          callback: (val) => `₹${Number(val).toLocaleString('en-IN')}`,
        },
      },
      y: {
        grid: { display: false },
        ticks: { color: '#334155', font: { size: 11, weight: 500 } },
      },
    },
  };

  const timeframes: Array<{ id: Timeframe; label: string }> = [
    { id: 'daily', label: 'Daily' },
    { id: 'weekly', label: 'Weekly' },
    { id: 'monthly', label: 'Monthly' },
    { id: 'yearly', label: 'Yearly' },
  ];

  return (
    <section aria-label="Spending Analytics" className="space-y-6">
      {/* Trend Chart */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Expense Trend
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Spending trajectory aggregated by selected timeframe
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {timeframes.map((tf) => (
                <button
                  key={tf.id}
                  type="button"
                  onClick={() => onTimeframeChange(tf.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    timeframe === tf.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setTrendStyle('bar')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  trendStyle === 'bar'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Bar
              </button>
              <button
                type="button"
                onClick={() => setTrendStyle('line')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  trendStyle === 'line'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Line
              </button>
            </div>
          </div>
        </div>

        {expenses.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
            No matching expenses to plot for the selected filters.
          </div>
        ) : (
          <div className="h-64">
            {trendStyle === 'bar' ? (
              <Bar data={trendChartData} options={trendOptions as ChartOptions<'bar'>} />
            ) : (
              <Line data={trendChartData} options={trendOptions as ChartOptions<'line'>} />
            )}
          </div>
        )}
      </div>

      {/* Tag Doughnut + Payment Method Horizontal Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="font-display text-base font-bold text-slate-900">
              Spending by Tag
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Weighted allocation across system and custom tags
            </p>
          </div>
          {tagBreakdown.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
              Tag breakdown appears once expenses are logged.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-center">
              <div className="sm:col-span-5 h-52">
                <Doughnut data={doughnutData} options={doughnutOptions} />
              </div>
              <div className="sm:col-span-7 max-h-52 overflow-y-auto divide-y divide-slate-100 pr-1">
                {tagBreakdown.map((item) => (
                  <div
                    key={item.id}
                    className="py-2 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-xs shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="font-medium text-slate-800 truncate">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0 font-mono-tabular">
                      <span className="text-slate-500">{item.percent}%</span>
                      <span className="font-semibold text-slate-900">{formatINR(item.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="font-display text-base font-bold text-slate-900">
              Payment Method Breakdown
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Comparison across PhonePe, Google Pay, BHIM UPI, Paytm, Cards &amp; Cash
            </p>
          </div>
          {expenses.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
              Payment channel totals appear once expenses are logged.
            </div>
          ) : (
            <div className="h-60">
              <Bar data={paymentData} options={paymentOptions} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
