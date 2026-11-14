import { useMemo } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { formatINR } from '../constants';
import { computeNextDueDate, formatFrequencyLabel } from '../utils/recurringUtils';
import { formatSplitSummaryLabel } from '../utils/splitUtils';
import type { Expense, ProjectMember, Tag } from '../types';
import { UserAvatar } from './UserAvatar';

interface ExpenseTableProps {
  expenses: Expense[];
  tags: Tag[];
  members?: ProjectMember[];
  loading: boolean;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
  onAddFirst: () => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function ExpenseTable({
  expenses,
  tags,
  members = [],
  loading,
  onEdit,
  onDelete,
  onAddFirst,
  hasActiveFilters,
  onClearFilters,
}: ExpenseTableProps) {
  const tagMap = useMemo(() => {
    const map = new Map<string, Tag>();
    for (const t of tags) map.set(t.id, t);
    return map;
  }, [tags]);

  const memberMap = useMemo(() => {
    const map = new Map<string, ProjectMember>();
    for (const m of members) map.set(m.uid, m);
    return map;
  }, [members]);

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="h-5 w-36 bg-slate-100 rounded animate-pulse" />
          <div className="h-4 w-24 bg-slate-100 rounded animate-pulse" />
        </div>
        <div className="divide-y divide-slate-100">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="px-5 py-3.5 flex items-center justify-between gap-4">
              <div className="h-4 w-24 bg-slate-100 rounded animate-pulse" />
              <div className="h-4 w-48 bg-slate-100 rounded animate-pulse" />
              <div className="h-4 w-28 bg-slate-100 rounded animate-pulse" />
              <div className="h-4 w-20 bg-slate-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (expenses.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
        <div className="space-y-1.5 max-w-md mx-auto">
          <h3 className="font-display text-base font-bold text-slate-900">
            {hasActiveFilters ? 'No expenses match your filters' : 'No expenses recorded yet'}
          </h3>
          <p className="text-sm text-slate-600">
            {hasActiveFilters
              ? 'Adjust the member, payment method, tag, or date range filters to see entries.'
              : 'Log your first expense manually or describe it in plain English using the AI Expense Assistant.'}
          </p>
        </div>
        <div className="flex items-center justify-center gap-3">
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={onClearFilters}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Clear Filters
            </button>
          ) : (
            <button
              type="button"
              onClick={onAddFirst}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-teal-700 text-white hover:bg-teal-800 transition-colors inline-flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Log First Expense</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-base font-bold text-slate-900">Expense Ledger</h2>
          <span className="text-xs text-slate-500 font-mono-tabular">
            {expenses.length} {expenses.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 tracking-wide">
              <th className="py-2.5 px-5 whitespace-nowrap">Date</th>
              <th className="py-2.5 px-4">Description &amp; Tags</th>
              <th className="py-2.5 px-4 whitespace-nowrap">Paid By</th>
              <th className="py-2.5 px-4 whitespace-nowrap">Payment Method</th>
              <th className="py-2.5 px-4 text-right whitespace-nowrap">Amount</th>
              <th className="py-2.5 px-5 text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {expenses.map((expense) => {
              const resolvedTags = expense.tagIds
                .map((id) => tagMap.get(id))
                .filter((t): t is Tag => Boolean(t));
              const splitLabel = formatSplitSummaryLabel(expense, memberMap);

              return (
                <tr
                  key={expense.id}
                  className="hover:bg-slate-50/80 transition-colors group"
                >
                  <td className="py-3 px-5 font-mono-tabular text-xs text-slate-600 whitespace-nowrap">
                    {expense.date}
                  </td>
                  <td className="py-3 px-4 min-w-[220px]">
                    <div className="font-medium text-slate-900 leading-snug">
                      {expense.description?.trim() ? (
                        expense.description
                      ) : (
                        <span className="text-slate-400 font-normal">No description</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
                      {resolvedTags.length > 0 ? (
                        resolvedTags.map((tag, idx) => (
                          <span key={tag.id} className="inline-flex items-center gap-1.5">
                            {idx > 0 && <span aria-hidden="true">·</span>}
                            <span style={{ color: tag.color }} className="font-medium">
                              {tag.parentCategory ? `${tag.parentCategory} / ${tag.name}` : tag.name}
                            </span>
                          </span>
                        ))
                      ) : (
                        <span>Uncategorized</span>
                      )}
                      {splitLabel && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-indigo-700 font-medium">{splitLabel}</span>
                        </>
                      )}
                      {expense.isRecurring && expense.frequency && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-teal-700 font-medium">
                            Recurring ({formatFrequencyLabel(expense.frequency)}, due{' '}
                            {computeNextDueDate(expense)})
                          </span>
                        </>
                      )}
                      {expense.source === 'ai_chat' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-400">AI entry</span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <UserAvatar
                        name={expense.paidByName}
                        photoURL={expense.paidByPhoto}
                        size="xs"
                      />
                      <span className="text-xs font-medium text-slate-700 truncate max-w-[130px]">
                        {expense.paidByName}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs font-medium text-slate-700 whitespace-nowrap">
                    {expense.paymentMethod}
                  </td>
                  <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-slate-900 whitespace-nowrap">
                    {formatINR(expense.amount)}
                  </td>
                  <td className="py-3 px-5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onEdit(expense)}
                        aria-label={`Edit ${expense.description || 'expense'}`}
                        className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(expense)}
                        aria-label={`Delete ${expense.description || 'expense'}`}
                        className="p-2 rounded-lg text-slate-500 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
