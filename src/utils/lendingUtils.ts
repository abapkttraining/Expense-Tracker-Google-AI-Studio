import type { Expense, ReceivedMoney } from '../types';

export interface ExternalSplitInfo {
  totalPeople: number;
  includeSelf: boolean;
  owedPeopleCount: number;
  perPersonShare: number;
  totalReceivable: number;
  label: string;
}

export interface ExternalLoanStatus {
  expense: Expense;
  info: ExternalSplitInfo;
  paidAmount: number;
  paidPeopleCount: number;
  remainingBalance: number;
  remainingPeople: number;
  isSettled: boolean;
  repayments: ReceivedMoney[];
}

export interface LendingAndBalanceSummary {
  loans: ExternalLoanStatus[];
  activeLoanCount: number;
  totalReceivableOriginal: number;
  totalReceivablePaid: number;
  totalReceivableOutstanding: number;
  totalPendingPeople: number;
  receivedByExpenseId: Map<string, { totalAmount: number; peoplePaidCount: number; entries: ReceivedMoney[] }>;
  totalReceivedAllTime: number;
  totalReceivedThisMonth: number;
}

export function getExternalSplitInfo(expense: Pick<Expense, 'amount' | 'splitMode' | 'externalTotalPeople' | 'externalIncludeSelf' | 'externalLabel'>): ExternalSplitInfo | null {
  if (expense.splitMode !== 'external') return null;
  const totalPeople = Math.max(1, Math.min(50, Math.round(expense.externalTotalPeople ?? 2)));
  const includeSelf = totalPeople === 1 ? false : Boolean(expense.externalIncludeSelf ?? true);
  const owedPeopleCount = includeSelf ? Math.max(0, totalPeople - 1) : totalPeople;
  const perPersonShare = Math.round((expense.amount / totalPeople) * 100) / 100;
  const totalReceivable = includeSelf
    ? Math.max(0, Math.round((expense.amount - perPersonShare) * 100) / 100)
    : Math.round(expense.amount * 100) / 100;

  return {
    totalPeople,
    includeSelf,
    owedPeopleCount,
    perPersonShare,
    totalReceivable,
    label: (expense.externalLabel ?? '').trim(),
  };
}

export function computeLendingSummary(
  expenses: Expense[],
  receivedMoney: ReceivedMoney[],
  currentMonthPrefix: string
): LendingAndBalanceSummary {
  const receivedByExpenseId = new Map<
    string,
    { totalAmount: number; peoplePaidCount: number; entries: ReceivedMoney[] }
  >();

  let totalReceivedAllTime = 0;
  let totalReceivedThisMonth = 0;

  for (const item of receivedMoney) {
    totalReceivedAllTime += item.amount;
    if (item.date.startsWith(currentMonthPrefix)) {
      totalReceivedThisMonth += item.amount;
    }
    if (item.linkedExpenseId) {
      const bucket = receivedByExpenseId.get(item.linkedExpenseId) ?? {
        totalAmount: 0,
        peoplePaidCount: 0,
        entries: [],
      };
      bucket.totalAmount = Math.round((bucket.totalAmount + item.amount) * 100) / 100;
      bucket.peoplePaidCount += item.peoplePaidCount ?? 0;
      bucket.entries.push(item);
      receivedByExpenseId.set(item.linkedExpenseId, bucket);
    }
  }

  const loans: ExternalLoanStatus[] = [];
  let activeLoanCount = 0;
  let totalReceivableOriginal = 0;
  let totalReceivablePaid = 0;
  let totalReceivableOutstanding = 0;
  let totalPendingPeople = 0;

  for (const exp of expenses) {
    const info = getExternalSplitInfo(exp);
    if (!info) continue;

    const bucket = receivedByExpenseId.get(exp.id);
    const paidAmount = Math.round((bucket?.totalAmount ?? 0) * 100) / 100;
    const remainingBalance = Math.max(
      0,
      Math.round((info.totalReceivable - paidAmount) * 100) / 100
    );
    const isSettled = remainingBalance <= 0.01;

    const equivalentPeopleFromAmount =
      info.perPersonShare > 0 ? Math.floor((paidAmount + 0.01) / info.perPersonShare) : 0;
    const rawPaidPeople = Math.max(bucket?.peoplePaidCount ?? 0, equivalentPeopleFromAmount);
    const paidPeopleCount = isSettled
      ? info.owedPeopleCount
      : Math.min(info.owedPeopleCount, Math.max(0, rawPaidPeople));
    const remainingPeople = isSettled ? 0 : Math.max(0, info.owedPeopleCount - paidPeopleCount);

    totalReceivableOriginal += info.totalReceivable;
    totalReceivablePaid += Math.min(info.totalReceivable, paidAmount);
    totalReceivableOutstanding += remainingBalance;

    if (!isSettled) {
      activeLoanCount += 1;
      totalPendingPeople += remainingPeople;
    }

    loans.push({
      expense: exp,
      info,
      paidAmount,
      paidPeopleCount,
      remainingBalance,
      remainingPeople,
      isSettled,
      repayments: bucket?.entries ?? [],
    });
  }

  // Sort active loans first (highest remaining first), then settled loans by date desc
  loans.sort((a, b) => {
    if (a.isSettled !== b.isSettled) return a.isSettled ? 1 : -1;
    return b.expense.date.localeCompare(a.expense.date);
  });

  return {
    loans,
    activeLoanCount,
    totalReceivableOriginal: Math.round(totalReceivableOriginal * 100) / 100,
    totalReceivablePaid: Math.round(totalReceivablePaid * 100) / 100,
    totalReceivableOutstanding: Math.round(totalReceivableOutstanding * 100) / 100,
    totalPendingPeople,
    receivedByExpenseId,
    totalReceivedAllTime: Math.round(totalReceivedAllTime * 100) / 100,
    totalReceivedThisMonth: Math.round(totalReceivedThisMonth * 100) / 100,
  };
}
