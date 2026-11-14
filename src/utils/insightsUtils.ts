import { formatINR, getTodayISO } from '../constants';
import type { Expense, Tag } from '../types';

export type InsightSeverity = 'alert' | 'warning' | 'positive' | 'neutral';

export interface SpendingInsight {
  id: string;
  severity: InsightSeverity;
  kind: 'category-spike' | 'overall-surge' | 'outlier-tx' | 'concentration' | 'category-drop' | 'baseline';
  title: string;
  detail: string;
  metricLabel: string;
  comparisonLabel: string;
  tagId?: string;
  expense?: Expense;
}

export interface SpendingInsightsReport {
  currentMonthLabel: string;
  previousMonthLabel: string;
  currentMonthTotal: number;
  previousMonthTotal: number;
  hasPreviousMonthData: boolean;
  anomalyCount: number;
  insights: SpendingInsight[];
}

function getPreviousMonthPrefix(currentMonthPrefix: string): string {
  const [yStr, mStr] = currentMonthPrefix.split('-');
  let year = Number(yStr);
  let month = Number(mStr);
  if (month <= 1) {
    year -= 1;
    month = 12;
  } else {
    month -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

function formatMonthLabel(monthPrefix: string): string {
  const [y, m] = monthPrefix.split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
  });
}

function computeTagTotals(expenses: Expense[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const exp of expenses) {
    const expTags = exp.tagIds.length > 0 ? exp.tagIds : ['other'];
    const share = exp.amount / expTags.length;
    for (const tid of expTags) {
      totals.set(tid, (totals.get(tid) ?? 0) + share);
    }
  }
  return totals;
}

export function analyzeSpendingInsights(
  expenses: Expense[],
  tags: Tag[]
): SpendingInsightsReport {
  const todayISO = getTodayISO();
  const currentMonthPrefix = todayISO.slice(0, 7);
  const previousMonthPrefix = getPreviousMonthPrefix(currentMonthPrefix);

  const currentMonthLabel = formatMonthLabel(currentMonthPrefix);
  const previousMonthLabel = formatMonthLabel(previousMonthPrefix);

  const currentMonthExpenses = expenses.filter((e) => e.date.startsWith(currentMonthPrefix));
  const previousMonthExpenses = expenses.filter((e) => e.date.startsWith(previousMonthPrefix));

  const currentMonthTotal = currentMonthExpenses.reduce((sum, e) => sum + e.amount, 0);
  const previousMonthTotal = previousMonthExpenses.reduce((sum, e) => sum + e.amount, 0);
  const hasPreviousMonthData = previousMonthExpenses.length > 0;

  if (expenses.length === 0) {
    return {
      currentMonthLabel,
      previousMonthLabel,
      currentMonthTotal: 0,
      previousMonthTotal: 0,
      hasPreviousMonthData: false,
      anomalyCount: 0,
      insights: [],
    };
  }

  const tagMap = new Map<string, Tag>();
  for (const t of tags) tagMap.set(t.id, t);

  const currTagTotals = computeTagTotals(currentMonthExpenses);
  const prevTagTotals = computeTagTotals(previousMonthExpenses);

  // Also compute multi-month historical tag averages (all months strictly before currentMonth)
  const earlierExpenses = expenses.filter((e) => e.date.slice(0, 7) < currentMonthPrefix);
  const earlierMonthSet = new Set(earlierExpenses.map((e) => e.date.slice(0, 7)));
  const earlierMonthCount = earlierMonthSet.size;
  const earlierTagTotals = computeTagTotals(earlierExpenses);

  const insights: SpendingInsight[] = [];

  // 1. Category-level spending spikes vs previous month (or historical average)
  const categorySpikes: Array<{
    score: number;
    insight: SpendingInsight;
  }> = [];

  for (const [tagId, rawCurrAmt] of currTagTotals.entries()) {
    const currAmt = Math.round(rawCurrAmt * 100) / 100;
    const prevAmt = Math.round((prevTagTotals.get(tagId) ?? 0) * 100) / 100;
    const tagName = tagMap.get(tagId)?.name ?? 'Other';

    if (prevAmt > 0) {
      const delta = currAmt - prevAmt;
      const pctChange = Math.round((delta / prevAmt) * 100);
      if (pctChange >= 25 && delta >= 200) {
        const severity: InsightSeverity = pctChange >= 75 || delta >= 2000 ? 'alert' : 'warning';
        categorySpikes.push({
          score: delta + pctChange * 10,
          insight: {
            id: `cat-spike-${tagId}`,
            severity,
            kind: 'category-spike',
            title: `${tagName} spending up ${pctChange}% vs ${previousMonthLabel}`,
            detail: `Spent ${formatINR(currAmt)} in ${currentMonthLabel} compared to ${formatINR(prevAmt)} in ${previousMonthLabel} (+${formatINR(delta)}).`,
            metricLabel: `+${pctChange}%`,
            comparisonLabel: `${formatINR(prevAmt)} → ${formatINR(currAmt)}`,
            tagId,
          },
        });
      }
    } else if (earlierMonthCount > 0) {
      const histAvg = (earlierTagTotals.get(tagId) ?? 0) / earlierMonthCount;
      if (histAvg > 0) {
        const delta = currAmt - histAvg;
        const pctChange = Math.round((delta / histAvg) * 100);
        if (pctChange >= 35 && delta >= 250) {
          categorySpikes.push({
            score: delta + pctChange * 8,
            insight: {
              id: `cat-hist-spike-${tagId}`,
              severity: pctChange >= 80 ? 'alert' : 'warning',
              kind: 'category-spike',
              title: `${tagName} is ${pctChange}% above your monthly average`,
              detail: `${formatINR(currAmt)} spent this month vs ${formatINR(histAvg)} average across prior months (+${formatINR(delta)}).`,
              metricLabel: `+${pctChange}%`,
              comparisonLabel: `Avg ${formatINR(histAvg)} → ${formatINR(currAmt)}`,
              tagId,
            },
          });
        }
      } else if (hasPreviousMonthData && currAmt >= 500) {
        categorySpikes.push({
          score: currAmt,
          insight: {
            id: `cat-new-${tagId}`,
            severity: 'warning',
            kind: 'category-spike',
            title: `New ${tagName} spend detected in ${currentMonthLabel}`,
            detail: `Logged ${formatINR(currAmt)} in ${tagName}, which had ₹0 spend in ${previousMonthLabel}.`,
            metricLabel: formatINR(currAmt),
            comparisonLabel: `₹0 in ${previousMonthLabel}`,
            tagId,
          },
        });
      }
    }
  }

  categorySpikes.sort((a, b) => b.score - a.score);
  for (const item of categorySpikes.slice(0, 2)) {
    insights.push(item.insight);
  }

  // 2. Overall Month-over-Month spend anomaly
  if (hasPreviousMonthData && previousMonthTotal > 0 && currentMonthTotal > 0) {
    const overallDelta = currentMonthTotal - previousMonthTotal;
    const overallPct = Math.round((overallDelta / previousMonthTotal) * 100);
    if (overallPct >= 20 && overallDelta >= 500) {
      insights.push({
        id: 'overall-mom-surge',
        severity: overallPct >= 50 ? 'alert' : 'warning',
        kind: 'overall-surge',
        title: `Total spend is ${overallPct}% higher than ${previousMonthLabel}`,
        detail: `${currentMonthLabel} total has reached ${formatINR(currentMonthTotal)} vs ${formatINR(previousMonthTotal)} last month (+${formatINR(overallDelta)}).`,
        metricLabel: `+${overallPct}%`,
        comparisonLabel: `${formatINR(previousMonthTotal)} → ${formatINR(currentMonthTotal)}`,
      });
    } else if (overallPct <= -20 && Math.abs(overallDelta) >= 500) {
      insights.push({
        id: 'overall-mom-drop',
        severity: 'positive',
        kind: 'category-drop',
        title: `Total spend is ${Math.abs(overallPct)}% below ${previousMonthLabel}`,
        detail: `So far in ${currentMonthLabel} you've spent ${formatINR(currentMonthTotal)} compared to ${formatINR(previousMonthTotal)} in ${previousMonthLabel}.`,
        metricLabel: `${overallPct}%`,
        comparisonLabel: `${formatINR(previousMonthTotal)} → ${formatINR(currentMonthTotal)}`,
      });
    }
  }

  // 3. Single-transaction outlier in the current month (compared against baseline median/mean)
  const baselinePool = currentMonthExpenses.length >= 3 ? expenses : earlierExpenses;
  if (baselinePool.length >= 3 && currentMonthExpenses.length > 0) {
    const sortedAmounts = baselinePool.map((e) => e.amount).sort((a, b) => a - b);
    const mid = Math.floor(sortedAmounts.length / 2);
    const median =
      sortedAmounts.length % 2 === 0
        ? (sortedAmounts[mid - 1] + sortedAmounts[mid]) / 2
        : sortedAmounts[mid];

    const largestCurr = [...currentMonthExpenses].sort((a, b) => b.amount - a.amount)[0];
    if (largestCurr && median > 0 && largestCurr.amount >= Math.max(median * 2.5, 500)) {
      const multiplier = Math.round((largestCurr.amount / median) * 10) / 10;
      const txDesc = largestCurr.description?.trim() || 'Unlabeled expense';
      const primaryTag = tagMap.get(largestCurr.tagIds[0] ?? '')?.name ?? 'Other';
      insights.push({
        id: `outlier-tx-${largestCurr.id}`,
        severity: multiplier >= 4 ? 'alert' : 'warning',
        kind: 'outlier-tx',
        title: `Unusually large ${primaryTag} expense (${multiplier}× typical)`,
        detail: `"${txDesc}" (${formatINR(largestCurr.amount)} on ${largestCurr.date}) is ${multiplier}× your median transaction of ${formatINR(median)}.`,
        metricLabel: `${multiplier}×`,
        comparisonLabel: `Median ${formatINR(median)}`,
        expense: largestCurr,
      });
    }
  }

  // 4. Category Drop / Savings highlight if previous month had significant spend
  if (hasPreviousMonthData && insights.length < 3) {
    let bestDrop: { dropAmt: number; insight: SpendingInsight } | null = null;
    for (const [tagId, rawPrevAmt] of prevTagTotals.entries()) {
      const prevAmt = Math.round(rawPrevAmt * 100) / 100;
      const currAmt = Math.round((currTagTotals.get(tagId) ?? 0) * 100) / 100;
      if (prevAmt >= 500 && currAmt > 0) {
        const dropAmt = prevAmt - currAmt;
        const dropPct = Math.round((dropAmt / prevAmt) * 100);
        if (dropPct >= 30 && dropAmt >= 300) {
          if (!bestDrop || dropAmt > bestDrop.dropAmt) {
            const tagName = tagMap.get(tagId)?.name ?? 'Other';
            bestDrop = {
              dropAmt,
              insight: {
                id: `cat-drop-${tagId}`,
                severity: 'positive',
                kind: 'category-drop',
                title: `${tagName} spending down ${dropPct}% vs ${previousMonthLabel}`,
                detail: `Down from ${formatINR(prevAmt)} in ${previousMonthLabel} to ${formatINR(currAmt)} this month (-${formatINR(dropAmt)}).`,
                metricLabel: `-${dropPct}%`,
                comparisonLabel: `${formatINR(prevAmt)} → ${formatINR(currAmt)}`,
                tagId,
              },
            };
          }
        }
      }
    }
    if (bestDrop) insights.push(bestDrop.insight);
  }

  // 5. Fallback / Concentration insight when current month has spend (e.g., first month of tracking)
  if (currentMonthTotal > 0 && currTagTotals.size > 0 && insights.length < 2) {
    const sortedTags = Array.from(currTagTotals.entries()).sort((a, b) => b[1] - a[1]);
    const [topTagId, topTagAmount] = sortedTags[0];
    const sharePct = Math.round((topTagAmount / currentMonthTotal) * 1000) / 10;
    const topTagName = tagMap.get(topTagId)?.name ?? 'Other';

    if (sharePct >= 60 && currentMonthExpenses.length >= 2) {
      insights.push({
        id: `concentration-${topTagId}`,
        severity: sharePct >= 80 ? 'warning' : 'neutral',
        kind: 'concentration',
        title: `${topTagName} drives ${sharePct}% of ${currentMonthLabel} spend`,
        detail: `${formatINR(topTagAmount)} out of ${formatINR(currentMonthTotal)} this month is concentrated in ${topTagName}${!hasPreviousMonthData ? ` (no ${previousMonthLabel} baseline yet)` : ''}.`,
        metricLabel: `${sharePct}%`,
        comparisonLabel: `${formatINR(topTagAmount)} / ${formatINR(currentMonthTotal)}`,
        tagId: topTagId,
      });
    }
  }

  // If previous month exists and zero anomalies triggered, provide a clean nominal status insight
  if (insights.length === 0 && currentMonthExpenses.length > 0) {
    insights.push({
      id: 'nominal-baseline',
      severity: 'positive',
      kind: 'baseline',
      title: hasPreviousMonthData
        ? `No spending anomalies detected vs ${previousMonthLabel}`
        : `Tracking ${currentMonthLabel} baseline (${currentMonthExpenses.length} ${currentMonthExpenses.length === 1 ? 'entry' : 'entries'})`,
      detail: hasPreviousMonthData
        ? `All active categories in ${currentMonthLabel} (${formatINR(currentMonthTotal)}) are within normal range of ${previousMonthLabel} (${formatINR(previousMonthTotal)}).`
        : `Add or import expenses from ${previousMonthLabel} to unlock month-over-month category anomaly comparisons.`,
      metricLabel: formatINR(currentMonthTotal),
      comparisonLabel: hasPreviousMonthData
        ? `vs ${formatINR(previousMonthTotal)}`
        : `${currentMonthExpenses.length} logged`,
    });
  } else if (insights.length === 0 && currentMonthExpenses.length === 0 && hasPreviousMonthData) {
    insights.push({
      id: 'no-current-month-yet',
      severity: 'neutral',
      kind: 'baseline',
      title: `No expenses logged yet in ${currentMonthLabel}`,
      detail: `${previousMonthLabel} closed at ${formatINR(previousMonthTotal)} across ${previousMonthExpenses.length} ${previousMonthExpenses.length === 1 ? 'transaction' : 'transactions'}. New entries this month will be compared automatically.`,
      metricLabel: '₹0',
      comparisonLabel: `${previousMonthLabel}: ${formatINR(previousMonthTotal)}`,
    });
  }

  const anomalyCount = insights.filter(
    (i) => i.severity === 'alert' || i.severity === 'warning'
  ).length;

  return {
    currentMonthLabel,
    previousMonthLabel,
    currentMonthTotal,
    previousMonthTotal,
    hasPreviousMonthData,
    anomalyCount,
    insights: insights.slice(0, 4),
  };
}
