import type { Expense } from '../types';

export interface DuplicateCandidate {
  description: string;
  date: string;
  amount: number;
}

export function normalizeExpenseDescription(description: string): string {
  return description.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function toAmountPaisa(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

export function makeDuplicateSignature(candidate: DuplicateCandidate): string {
  const datePart = candidate.date.trim();
  const amountPart = toAmountPaisa(candidate.amount);
  const descPart = normalizeExpenseDescription(candidate.description);
  return `${datePart}::${amountPart}::${descPart}`;
}

export function findDuplicateExpenses(
  candidate: DuplicateCandidate,
  existingExpenses: Expense[],
  excludeExpenseId?: string
): Expense[] {
  const targetPaisa = toAmountPaisa(candidate.amount);
  const targetDate = candidate.date.trim();
  if (targetPaisa <= 0 || !targetDate) return [];

  const targetDesc = normalizeExpenseDescription(candidate.description);

  return existingExpenses.filter((exp) => {
    if (excludeExpenseId && exp.id === excludeExpenseId) return false;
    if (exp.date.trim() !== targetDate) return false;
    if (toAmountPaisa(exp.amount) !== targetPaisa) return false;
    return normalizeExpenseDescription(exp.description) === targetDesc;
  });
}
