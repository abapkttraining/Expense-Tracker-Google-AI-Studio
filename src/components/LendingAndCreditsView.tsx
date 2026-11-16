import { useMemo } from 'react';
import {
  ArrowDownLeft,
  CheckCircle2,
  HandCoins,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { formatINR, getTodayISO } from '../constants';
import { useCurrency } from '../hooks/useCurrency';
import type { Expense, ReceivedMoney } from '../types';
import { computeLendingSummary } from '../utils/lendingUtils';

interface LendingAndCreditsViewProps {
  projectName: string;
  expenses: Expense[];
  receivedMoney: ReceivedMoney[];
  onNewLendingExpense: () => void;
  onEditExpense: (expense: Expense) => void;
  onRecordPaymentForExpense: (expense: Expense) => void;
  onAddGeneralReceived: () => void;
  onDeleteReceivedMoney: (receivedId: string) => Promise<void>;
}

export function LendingAndCreditsView({
  projectName,
  expenses,
  receivedMoney,
  onNewLendingExpense,
  onEditExpense,
  onRecordPaymentForExpense,
  onAddGeneralReceived,
  onDeleteReceivedMoney,
}: LendingAndCreditsViewProps) {
  const { currency, formatAmount } = useCurrency();
  const currentMonthPrefix = getTodayISO().slice(0, 7);

  const summary = useMemo(
    () => computeLendingSummary(expenses, receivedMoney, currentMonthPrefix),
    [expenses, receivedMoney, currentMonthPrefix]
  );

  const totalGrossSpend = useMemo(
    () => expenses.reduce((sum, e) => sum + e.amount, 0),
    [expenses]
  );

  const netExpenditure = Math.round((totalGrossSpend - summary.totalReceivedAllTime) * 100) / 100;

  const expenseMap = useMemo(() => {
    const map = new Map<string, Expense>();
    for (const e of expenses) map.set(e.id, e);
    return map;
  }, [expenses]);

  return (
    <div className="space-y-6">
      {/* 3-Card Lending & Balance Summary */}
      <section
        aria-label="Lending and Money Received Summary"
        className="grid grid-cols-1 sm:grid-cols-3 gap-4"
      >
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
            Pending Lending Receivable
          </span>
          <div className="font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-100">
            {formatAmount(summary.totalReceivableOutstanding)}
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400 block">
            {summary.activeLoanCount === 0
              ? 'No pending external loans'
              : `${summary.activeLoanCount} active ${
                  summary.activeLoanCount === 1 ? 'split' : 'splits'
                } · ${summary.totalPendingPeople} ${
                  summary.totalPendingPeople === 1 ? 'person' : 'people'
                } pending`}
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
            Total Money Received
          </span>
          <div className="font-mono-tabular text-2xl font-bold text-emerald-700 dark:text-emerald-400">
            {formatAmount(summary.totalReceivedAllTime)}
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular block">
            {formatAmount(summary.totalReceivedThisMonth)} this month · {receivedMoney.length}{' '}
            {receivedMoney.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
            Net Project Expenditure
          </span>
          <div className="font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-100">
            {netExpenditure < 0
              ? `+${formatAmount(Math.abs(netExpenditure))} surplus`
              : formatAmount(netExpenditure)}
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular block">
            {formatAmount(totalGrossSpend)} spent − {formatAmount(summary.totalReceivedAllTime)}{' '}
            received
          </span>
        </div>
      </section>

      {/* External Group Lending Tracker */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              External Lending &amp; Group Splits
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Expenses split with people outside {projectName} — record who paid to reduce remaining balances
            </p>
          </div>
          <button
            type="button"
            onClick={onNewLendingExpense}
            className="px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Lending Split</span>
          </button>
        </div>

        {summary.loans.length === 0 ? (
          <div className="py-10 px-4 text-center space-y-3 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
            <Users className="w-7 h-7 text-slate-400 dark:text-slate-500 mx-auto" />
            <div className="space-y-1 max-w-md mx-auto">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                No external lending splits yet
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Paid for dinner, tickets, or a trip with people not on this project? Log a lending split, pick the number of people, and track repayments as each person pays back.
              </p>
            </div>
            <button
              type="button"
              onClick={onNewLendingExpense}
              className="px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create First Lending Split</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {summary.loans.map((loan) => {
              const progressPct =
                loan.info.totalReceivable > 0
                  ? Math.min(100, Math.round((loan.paidAmount / loan.info.totalReceivable) * 100))
                  : 100;

              return (
                <div
                  key={loan.expense.id}
                  className={`rounded-xl border p-4 sm:p-5 space-y-3.5 ${
                    loan.isSettled
                      ? 'bg-slate-50/70 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'
                      : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                          {loan.expense.description || loan.info.label || 'External Split'}
                        </h3>
                        {loan.isSettled ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Fully Settled</span>
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                            Pending
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {loan.expense.date}
                        {loan.info.label ? ` · ${loan.info.label}` : ''} · Split across{' '}
                        {loan.info.totalPeople}{' '}
                        {loan.info.totalPeople === 1 ? 'person' : 'people'}
                        {loan.info.includeSelf ? ' (incl. you)' : ' (all external)'} ·{' '}
                        <span className="font-mono-tabular">
                          {formatAmount(loan.info.perPersonShare)}/ea
                        </span>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onEditExpense(loan.expense)}
                      aria-label={`Edit ${loan.expense.description || 'lending expense'}`}
                      className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-mono-tabular">
                      <span className="text-slate-600 dark:text-slate-400">
                        Paid: <strong className="text-emerald-700 dark:text-emerald-400">{formatAmount(loan.paidAmount)}</strong>{' '}
                        ({loan.paidPeopleCount}/{loan.info.owedPeopleCount}{' '}
                        {loan.info.owedPeopleCount === 1 ? 'person' : 'people'})
                      </span>
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        Left: {formatAmount(loan.remainingBalance)}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          loan.isSettled ? 'bg-emerald-600' : 'bg-teal-600'
                        }`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                      Total Spent: {formatAmount(loan.expense.amount)} · To Collect:{' '}
                      {formatAmount(loan.info.totalReceivable)}
                    </div>
                    {!loan.isSettled && (
                      <button
                        type="button"
                        onClick={() => onRecordPaymentForExpense(loan.expense)}
                        className="px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap"
                      >
                        <HandCoins className="w-3.5 h-3.5" />
                        <span>Add Paid</span>
                      </button>
                    )}
                  </div>

                  {loan.repayments.length > 0 && (
                    <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">
                        Recorded Repayments
                      </span>
                      <div className="space-y-1">
                        {loan.repayments.map((rep) => (
                          <div
                            key={rep.id}
                            className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300"
                          >
                            <span className="truncate">
                              {rep.date} · {rep.source}
                              {rep.peoplePaidCount
                                ? ` (${rep.peoplePaidCount} ${
                                    rep.peoplePaidCount === 1 ? 'person' : 'people'
                                  })`
                                : ''}
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-mono-tabular font-semibold text-emerald-700 dark:text-emerald-400">
                                +{formatAmount(rep.amount)}
                              </span>
                              <button
                                type="button"
                                onClick={() => void onDeleteReceivedMoney(rep.id)}
                                aria-label={`Delete repayment of ${formatINR(rep.amount)}`}
                                className="p-1 rounded text-slate-400 hover:text-red-700 dark:hover:text-red-400 cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Money Received & Expense Offsets History */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Money Received &amp; Expense Offsets
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Incoming refunds, repayments, or credits balancing out individual expenses and monthly totals
            </p>
          </div>
          <button
            type="button"
            onClick={onAddGeneralReceived}
            className="px-3.5 py-2 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/60 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowDownLeft className="w-3.5 h-3.5" />
            <span>Add Money Received</span>
          </button>
        </div>

        {receivedMoney.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No money received logged yet. Add a refund, friend repayment, or incoming credit to balance out expenses or monthly expenditure.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-[11px] font-semibold text-slate-500 dark:text-slate-400 tracking-wide">
                  <th className="py-2.5 px-5 whitespace-nowrap">Date</th>
                  <th className="py-2.5 px-4">Source &amp; Note</th>
                  <th className="py-2.5 px-4">Balances Out</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Method</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Received</th>
                  <th className="py-2.5 px-5 text-right whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {receivedMoney.map((item) => {
                  const linked = item.linkedExpenseId
                    ? expenseMap.get(item.linkedExpenseId)
                    : undefined;
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-3 px-5 font-mono-tabular text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {item.date}
                      </td>
                      <td className="py-3 px-4 min-w-[180px]">
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {item.source}
                          {item.peoplePaidCount ? (
                            <span className="ml-1.5 font-normal text-slate-500 dark:text-slate-400">
                              ({item.peoplePaidCount}{' '}
                              {item.peoplePaidCount === 1 ? 'person' : 'people'})
                            </span>
                          ) : null}
                        </div>
                        {item.note && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {item.note}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">
                        {linked ? (
                          <span>
                            Expense:{' '}
                            <strong className="text-slate-800 dark:text-slate-100">
                              {linked.description || 'Untitled'}
                            </strong>
                          </span>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">
                            Monthly &amp; Total Expenditure
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {item.paymentMethod}
                      </td>
                      <td
                        title={
                          currency !== 'INR' ? `Base amount: ${formatINR(item.amount)}` : undefined
                        }
                        className="py-3 px-4 text-right font-mono-tabular font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap"
                      >
                        +{formatAmount(item.amount)}
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void onDeleteReceivedMoney(item.id)}
                          aria-label={`Delete received entry from ${item.source}`}
                          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
