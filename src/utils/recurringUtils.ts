import type { Expense, RecurringFrequency } from '../types';

export interface RecurringBillAlert {
  expense: Expense;
  dueDate: string;
  daysDiff: number; // < 0 = overdue, 0 = due today, > 0 = upcoming
  status: 'overdue' | 'due_today' | 'upcoming';
}

function parseIsoParts(isoDate: string): { year: number; month: number; day: number } {
  const [y, m, d] = isoDate.split('-').map(Number);
  return {
    year: y || 2026,
    month: m || 1,
    day: d || 1,
  };
}

function toIsoDate(year: number, month: number, day: number): string {
  const yy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function daysInMonth(year: number, month1To12: number): number {
  return new Date(year, month1To12, 0).getDate();
}

export function addFrequencyToDate(isoDate: string, frequency: RecurringFrequency): string {
  const { year, month, day } = parseIsoParts(isoDate);

  if (frequency === 'daily') {
    const dt = new Date(Date.UTC(year, month - 1, day + 1));
    return dt.toISOString().slice(0, 10);
  }

  if (frequency === 'weekly') {
    const dt = new Date(Date.UTC(year, month - 1, day + 7));
    return dt.toISOString().slice(0, 10);
  }

  if (frequency === 'monthly') {
    const nextMonthZeroBased = month; // month is 1-12, so month is next month in 0-based
    const targetYear = year + Math.floor(nextMonthZeroBased / 12);
    const targetMonth = (nextMonthZeroBased % 12) + 1;
    const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));
    return toIsoDate(targetYear, targetMonth, clampedDay);
  }

  // yearly
  const targetYear = year + 1;
  const clampedDay = Math.min(day, daysInMonth(targetYear, month));
  return toIsoDate(targetYear, month, clampedDay);
}

export function computeNextDueDate(expense: Pick<Expense, 'date' | 'isRecurring' | 'frequency' | 'nextDueDate'>): string | null {
  if (!expense.isRecurring || !expense.frequency) return null;
  if (expense.nextDueDate && /^\d{4}-\d{2}-\d{2}$/.test(expense.nextDueDate)) {
    return expense.nextDueDate;
  }
  return addFrequencyToDate(expense.date, expense.frequency);
}

export function diffDaysBetweenIso(fromIso: string, toIso: string): number {
  const a = parseIsoParts(fromIso);
  const b = parseIsoParts(toIso);
  const utcA = Date.UTC(a.year, a.month - 1, a.day);
  const utcB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((utcB - utcA) / (1000 * 60 * 60 * 24));
}

export function evaluateRecurringBills(
  expenses: Expense[],
  todayIso: string,
  upcomingWindowDays = 7
): RecurringBillAlert[] {
  const alerts: RecurringBillAlert[] = [];

  for (const expense of expenses) {
    if (!expense.isRecurring || !expense.frequency) continue;
    const dueDate = computeNextDueDate(expense);
    if (!dueDate) continue;

    const daysDiff = diffDaysBetweenIso(todayIso, dueDate);
    if (daysDiff <= upcomingWindowDays) {
      const status: RecurringBillAlert['status'] =
        daysDiff < 0 ? 'overdue' : daysDiff === 0 ? 'due_today' : 'upcoming';
      alerts.push({
        expense,
        dueDate,
        daysDiff,
        status,
      });
    }
  }

  // Overdue oldest first, then due today, then closest upcoming
  alerts.sort((a, b) => a.daysDiff - b.daysDiff);
  return alerts;
}

export function formatFrequencyLabel(frequency?: RecurringFrequency): string {
  if (!frequency) return '';
  return frequency.charAt(0).toUpperCase() + frequency.slice(1);
}
