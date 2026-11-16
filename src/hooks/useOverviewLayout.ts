import { useCallback, useEffect, useState } from 'react';

export type OverviewMetricId = 'totalSpend' | 'thisMonth' | 'topCategory' | 'topMethod';

export type OverviewWidgetId =
  | 'summaryMetrics'
  | 'monthlyBudget'
  | 'spendingInsights'
  | 'trendChart'
  | 'tagChart'
  | 'subTagChart'
  | 'paymentChart'
  | 'expenseLedger';

export interface OverviewLayoutConfig {
  widgetOrder: OverviewWidgetId[];
  hiddenWidgets: OverviewWidgetId[];
  metricOrder: OverviewMetricId[];
  hiddenMetrics: OverviewMetricId[];
}

export const DEFAULT_WIDGET_ORDER: OverviewWidgetId[] = [
  'summaryMetrics',
  'monthlyBudget',
  'spendingInsights',
  'trendChart',
  'tagChart',
  'subTagChart',
  'paymentChart',
  'expenseLedger',
];

export const DEFAULT_METRIC_ORDER: OverviewMetricId[] = [
  'totalSpend',
  'thisMonth',
  'topCategory',
  'topMethod',
];

export const OVERVIEW_WIDGET_META: Record<
  OverviewWidgetId,
  { label: string; description: string; category: 'Metrics' | 'Planner' | 'Chart' | 'Ledger' }
> = {
  summaryMetrics: {
    label: 'Summary Metric Cards',
    description: 'KPI strip with Total Spend, This Month, Top Category, and Top Method',
    category: 'Metrics',
  },
  monthlyBudget: {
    label: 'Monthly Budget Tracker',
    description: 'Spending cap progress bar, remaining balance, and threshold alerts',
    category: 'Planner',
  },
  spendingInsights: {
    label: 'Spending Insights',
    description: 'Month-over-month comparisons, category spikes, and outlier observations',
    category: 'Planner',
  },
  trendChart: {
    label: 'Expense Trend Chart',
    description: 'Daily, weekly, monthly, or yearly bar/line expenditure trajectory',
    category: 'Chart',
  },
  tagChart: {
    label: 'Spending by Tag Chart',
    description: 'Doughnut breakdown of weighted spending across parent and custom tags',
    category: 'Chart',
  },
  subTagChart: {
    label: 'Spending by Sub-tags Chart',
    description: 'Ring or bar breakdown of child sub-tags for any selected parent tag',
    category: 'Chart',
  },
  paymentChart: {
    label: 'Payment Method Breakdown',
    description: 'Horizontal bar comparison across UPI apps, cards, and cash',
    category: 'Chart',
  },
  expenseLedger: {
    label: 'Expense Ledger Table',
    description: 'Filterable list of expenses with quick balance-out, edit, and delete actions',
    category: 'Ledger',
  },
};

export const OVERVIEW_METRIC_META: Record<
  OverviewMetricId,
  { label: string; description: string }
> = {
  totalSpend: {
    label: 'Total / Net Spend',
    description: 'Cumulative project spend minus money received',
  },
  thisMonth: {
    label: 'This Month & PDF Report',
    description: 'Current calendar month net spend and quick PDF export button',
  },
  topCategory: {
    label: 'Top Category',
    description: 'Highest-spending tag across active filters',
  },
  topMethod: {
    label: 'Top Method',
    description: 'Most-used payment channel across active filters',
  },
};

const STORAGE_KEY = 'khata-overview-layout-v1';

const DEFAULT_CONFIG: OverviewLayoutConfig = {
  widgetOrder: [...DEFAULT_WIDGET_ORDER],
  hiddenWidgets: [],
  metricOrder: [...DEFAULT_METRIC_ORDER],
  hiddenMetrics: [],
};

function normalizeOrder<T extends string>(candidate: unknown, defaults: readonly T[]): T[] {
  const validSet = new Set<string>(defaults);
  const seen = new Set<T>();
  const result: T[] = [];
  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      if (typeof item === 'string' && validSet.has(item) && !seen.has(item as T)) {
        seen.add(item as T);
        result.push(item as T);
      }
    }
  }
  for (const def of defaults) {
    if (!seen.has(def)) result.push(def);
  }
  return result;
}

function normalizeHidden<T extends string>(candidate: unknown, defaults: readonly T[]): T[] {
  const validSet = new Set<string>(defaults);
  const seen = new Set<T>();
  const result: T[] = [];
  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      if (typeof item === 'string' && validSet.has(item) && !seen.has(item as T)) {
        seen.add(item as T);
        result.push(item as T);
      }
    }
  }
  return result;
}

function readStoredLayout(): OverviewLayoutConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<OverviewLayoutConfig>;
    return {
      widgetOrder: normalizeOrder(parsed.widgetOrder, DEFAULT_WIDGET_ORDER),
      hiddenWidgets: normalizeHidden(parsed.hiddenWidgets, DEFAULT_WIDGET_ORDER),
      metricOrder: normalizeOrder(parsed.metricOrder, DEFAULT_METRIC_ORDER),
      hiddenMetrics: normalizeHidden(parsed.hiddenMetrics, DEFAULT_METRIC_ORDER),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function reorderArray<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= list.length ||
    toIndex >= list.length
  ) {
    return list;
  }
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function useOverviewLayout() {
  const [layout, setLayout] = useState<OverviewLayoutConfig>(() => readStoredLayout());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Ignore storage errors
    }
  }, [layout]);

  const toggleWidget = useCallback((id: OverviewWidgetId) => {
    setLayout((prev) => {
      const hidden = prev.hiddenWidgets.includes(id)
        ? prev.hiddenWidgets.filter((w) => w !== id)
        : [...prev.hiddenWidgets, id];
      return { ...prev, hiddenWidgets: hidden };
    });
  }, []);

  const moveWidget = useCallback((fromId: OverviewWidgetId, toId: OverviewWidgetId) => {
    if (fromId === toId) return;
    setLayout((prev) => {
      const fromIndex = prev.widgetOrder.indexOf(fromId);
      const toIndex = prev.widgetOrder.indexOf(toId);
      return {
        ...prev,
        widgetOrder: reorderArray(prev.widgetOrder, fromIndex, toIndex),
      };
    });
  }, []);

  const stepWidget = useCallback((id: OverviewWidgetId, delta: -1 | 1) => {
    setLayout((prev) => {
      const idx = prev.widgetOrder.indexOf(id);
      return {
        ...prev,
        widgetOrder: reorderArray(prev.widgetOrder, idx, idx + delta),
      };
    });
  }, []);

  const toggleMetric = useCallback((id: OverviewMetricId) => {
    setLayout((prev) => {
      const hidden = prev.hiddenMetrics.includes(id)
        ? prev.hiddenMetrics.filter((m) => m !== id)
        : [...prev.hiddenMetrics, id];
      return { ...prev, hiddenMetrics: hidden };
    });
  }, []);

  const moveMetric = useCallback((fromId: OverviewMetricId, toId: OverviewMetricId) => {
    if (fromId === toId) return;
    setLayout((prev) => {
      const fromIndex = prev.metricOrder.indexOf(fromId);
      const toIndex = prev.metricOrder.indexOf(toId);
      return {
        ...prev,
        metricOrder: reorderArray(prev.metricOrder, fromIndex, toIndex),
      };
    });
  }, []);

  const stepMetric = useCallback((id: OverviewMetricId, delta: -1 | 1) => {
    setLayout((prev) => {
      const idx = prev.metricOrder.indexOf(id);
      return {
        ...prev,
        metricOrder: reorderArray(prev.metricOrder, idx, idx + delta),
      };
    });
  }, []);

  const showAll = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      hiddenWidgets: [],
      hiddenMetrics: [],
    }));
  }, []);

  const resetLayout = useCallback(() => {
    setLayout({
      widgetOrder: [...DEFAULT_WIDGET_ORDER],
      hiddenWidgets: [],
      metricOrder: [...DEFAULT_METRIC_ORDER],
      hiddenMetrics: [],
    });
  }, []);

  const hiddenWidgetSet = new Set(layout.hiddenWidgets);
  const hiddenMetricSet = new Set(layout.hiddenMetrics);
  const visibleWidgetCount = DEFAULT_WIDGET_ORDER.length - hiddenWidgetSet.size;
  const visibleMetricCount = DEFAULT_METRIC_ORDER.length - hiddenMetricSet.size;

  const isCustomized =
    hiddenWidgetSet.size > 0 ||
    hiddenMetricSet.size > 0 ||
    layout.widgetOrder.some((id, idx) => id !== DEFAULT_WIDGET_ORDER[idx]) ||
    layout.metricOrder.some((id, idx) => id !== DEFAULT_METRIC_ORDER[idx]);

  return {
    layout,
    hiddenWidgetSet,
    hiddenMetricSet,
    visibleWidgetCount,
    totalWidgetCount: DEFAULT_WIDGET_ORDER.length,
    visibleMetricCount,
    totalMetricCount: DEFAULT_METRIC_ORDER.length,
    isCustomized,
    toggleWidget,
    moveWidget,
    stepWidget,
    toggleMetric,
    moveMetric,
    stepMetric,
    showAll,
    resetLayout,
  };
}
