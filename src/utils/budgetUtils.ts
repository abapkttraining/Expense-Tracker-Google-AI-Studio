import { formatINR } from '../constants';

export const BUDGET_THRESHOLDS = [50, 80, 90, 95, 100] as const;

export type BudgetThreshold = (typeof BUDGET_THRESHOLDS)[number];

export type BudgetToastSeverity = 'info' | 'warning' | 'high' | 'critical' | 'exceeded';

export interface BudgetToastItem {
  id: string;
  projectId: string;
  projectName: string;
  threshold: BudgetThreshold;
  severity: BudgetToastSeverity;
  previousSpend: number;
  newSpend: number;
  budget: number;
  percentUsed: number;
  title: string;
  message: string;
  createdAt: number;
}

export function getThresholdSeverity(threshold: BudgetThreshold): BudgetToastSeverity {
  switch (threshold) {
    case 50:
      return 'info';
    case 80:
      return 'warning';
    case 90:
      return 'high';
    case 95:
      return 'critical';
    case 100:
      return 'exceeded';
  }
}

/**
 * Evaluates whether adding or increasing an expense in the current month
 * pushed the project's monthly spend across any of the 50%, 80%, 90%, 95%, 100% thresholds.
 * Returns the highest newly crossed threshold (or 100 if already >=100% and spend increased further).
 */
export function detectCrossedBudgetThreshold(
  previousSpend: number,
  newSpend: number,
  budget: number | undefined
): BudgetThreshold | null {
  if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) {
    return null;
  }
  if (!(newSpend > previousSpend)) {
    return null;
  }

  const prevPct = (previousSpend / budget) * 100;
  const nextPct = (newSpend / budget) * 100;

  let highestCrossed: BudgetThreshold | null = null;
  for (const t of BUDGET_THRESHOLDS) {
    if (prevPct < t && nextPct >= t) {
      highestCrossed = t;
    }
  }

  // If already at or over 100% and a new expense pushes spend even further past the cap,
  // still notify the user that they remain over 100%.
  if (highestCrossed === null && prevPct >= 100 && nextPct > prevPct) {
    return 100;
  }

  return highestCrossed;
}

export function buildBudgetToast(params: {
  projectId: string;
  projectName: string;
  previousSpend: number;
  newSpend: number;
  budget: number;
  threshold: BudgetThreshold;
  formatAmount?: (amountInINR: number) => string;
}): BudgetToastItem {
  const {
    projectId,
    projectName,
    previousSpend,
    newSpend,
    budget,
    threshold,
    formatAmount = formatINR,
  } = params;
  const percentUsed = Math.round((newSpend / budget) * 1000) / 10;
  const severity = getThresholdSeverity(threshold);
  const remaining = budget - newSpend;

  let title: string;
  let message: string;

  if (threshold === 100) {
    if (remaining < 0) {
      title = '100%+ Monthly Budget Exceeded';
      message = `${projectName} is now at ${percentUsed}% (${formatAmount(Math.abs(remaining))} over cap).`;
    } else {
      title = '100% Monthly Budget Reached';
      message = `${projectName} has reached its full monthly limit (${percentUsed}% used).`;
    }
  } else if (threshold === 95) {
    title = '95% Monthly Budget Critical';
    message = `Only ${formatAmount(remaining)} remaining in ${projectName}'s monthly budget.`;
  } else if (threshold === 90) {
    title = '90% Monthly Budget Reached';
    message = `${projectName} reached ${percentUsed}% of its monthly cap (${formatAmount(remaining)} left).`;
  } else if (threshold === 80) {
    title = '80% Monthly Budget Reached';
    message = `${projectName} is at ${percentUsed}% of its monthly limit with ${formatAmount(remaining)} left.`;
  } else {
    title = '50% Monthly Budget Reached';
    message = `${projectName} passed the halfway mark (${percentUsed}% of monthly cap used).`;
  }

  return {
    id: `budget-toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    projectId,
    projectName,
    threshold,
    severity,
    previousSpend,
    newSpend,
    budget,
    percentUsed,
    title,
    message,
    createdAt: Date.now(),
  };
}
