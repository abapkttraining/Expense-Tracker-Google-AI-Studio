import { useEffect, useMemo, useState } from 'react';
import { Check, RotateCcw, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { formatINR } from '../constants';
import { useCurrency } from '../hooks/useCurrency';
import { computeEqualSplitShares, computePercentageSplitShares } from '../utils/splitUtils';
import type { ProjectMember, SplitMode } from '../types';
import { UserAvatar } from './UserAvatar';

export interface SplitSettingsDraft {
  splitMode: SplitMode;
  equalUids: string[];
  exactInputs: Record<string, string>;
  percentInputs: Record<string, string>;
  updatedExpenseAmount?: number;
}

interface SplitSettingsModalProps {
  open: boolean;
  onClose: () => void;
  expenseAmount: number;
  paidByName: string;
  members: ProjectMember[];
  initialSplitMode: SplitMode;
  initialEqualUids: string[];
  initialExactInputs: Record<string, string>;
  initialPercentInputs: Record<string, string>;
  onApply: (draft: SplitSettingsDraft) => void;
}

export function SplitSettingsModal({
  open,
  onClose,
  expenseAmount,
  paidByName,
  members,
  initialSplitMode,
  initialEqualUids,
  initialExactInputs,
  initialPercentInputs,
  onApply,
}: SplitSettingsModalProps) {
  const [mode, setMode] = useState<Exclude<SplitMode, 'none'>>('exact');
  const [equalUids, setEqualUids] = useState<string[]>([]);
  const [exactInputs, setExactInputs] = useState<Record<string, string>>({});
  const [percentInputs, setPercentInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const { currency, formatAmount } = useCurrency();

  useEffect(() => {
    if (!open) return;
    setError(null);
    const defaultMode: Exclude<SplitMode, 'none'> =
      initialSplitMode === 'none' ? 'exact' : initialSplitMode;
    setMode(defaultMode);
    setEqualUids(
      initialEqualUids.length > 0 ? initialEqualUids : members.map((m) => m.uid)
    );
    setExactInputs({ ...initialExactInputs });
    setPercentInputs({ ...initialPercentInputs });
  }, [
    open,
    initialSplitMode,
    initialEqualUids,
    initialExactInputs,
    initialPercentInputs,
    members,
  ]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const exactSum = useMemo(
    () =>
      members.reduce((sum, m) => {
        const val = Number(exactInputs[m.uid]);
        return sum + (Number.isFinite(val) && val > 0 ? val : 0);
      }, 0),
    [members, exactInputs]
  );

  const percentSum = useMemo(
    () =>
      members.reduce((sum, m) => {
        const val = Number(percentInputs[m.uid]);
        return sum + (Number.isFinite(val) && val > 0 ? val : 0);
      }, 0),
    [members, percentInputs]
  );

  const equalShares = useMemo(
    () => computeEqualSplitShares(expenseAmount, equalUids),
    [expenseAmount, equalUids]
  );

  const percentagePreviewShares = useMemo(() => {
    const pctMap: Record<string, number> = {};
    for (const m of members) {
      const val = Number(percentInputs[m.uid]);
      if (Number.isFinite(val) && val > 0) {
        pctMap[m.uid] = val;
      }
    }
    return computePercentageSplitShares(expenseAmount, pctMap);
  }, [members, percentInputs, expenseAmount]);

  if (!open) return null;

  const exactRemaining = Math.round((expenseAmount - exactSum) * 100) / 100;
  const percentRemaining = Math.round((100 - percentSum) * 100) / 100;

  const isExactMatched = expenseAmount > 0 && Math.abs(exactRemaining) <= 0.01;
  const isPercentMatched = Math.abs(percentRemaining) <= 0.01;

  const toggleEqualMember = (uid: string) => {
    setError(null);
    setEqualUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const toggleExactMemberIncluded = (uid: string) => {
    setError(null);
    const current = Number(exactInputs[uid]) || 0;
    if (current > 0) {
      setExactInputs((prev) => ({ ...prev, [uid]: '' }));
    } else if (exactRemaining > 0) {
      setExactInputs((prev) => ({ ...prev, [uid]: String(exactRemaining) }));
    } else {
      setExactInputs((prev) => ({ ...prev, [uid]: '0' }));
    }
  };

  const togglePercentMemberIncluded = (uid: string) => {
    setError(null);
    const current = Number(percentInputs[uid]) || 0;
    if (current > 0) {
      setPercentInputs((prev) => ({ ...prev, [uid]: '' }));
    } else if (percentRemaining > 0) {
      setPercentInputs((prev) => ({ ...prev, [uid]: String(percentRemaining) }));
    } else {
      setPercentInputs((prev) => ({ ...prev, [uid]: '0' }));
    }
  };

  const handleDistributeEvenly = () => {
    setError(null);
    const allUids = members.map((m) => m.uid);
    if (allUids.length === 0) return;

    if (mode === 'equal') {
      setEqualUids(allUids);
      return;
    }

    if (mode === 'exact') {
      if (!(expenseAmount > 0)) {
        setError('Enter an expense amount first to distribute exact ₹ evenly.');
        return;
      }
      const activeUids = allUids.filter((uid) => (Number(exactInputs[uid]) || 0) > 0);
      const targetUids = activeUids.length > 0 ? activeUids : allUids;
      const shares = computeEqualSplitShares(expenseAmount, targetUids);
      const next: Record<string, string> = {};
      for (const uid of allUids) {
        next[uid] = shares[uid] ? String(shares[uid]) : '';
      }
      setExactInputs(next);
      return;
    }

    if (mode === 'percentage') {
      const activeUids = allUids.filter((uid) => (Number(percentInputs[uid]) || 0) > 0);
      const targetUids = activeUids.length > 0 ? activeUids : allUids;
      const base = Math.floor(10000 / targetUids.length) / 100;
      const next: Record<string, string> = {};
      let acc = 0;
      targetUids.forEach((uid, idx) => {
        if (idx === targetUids.length - 1) {
          next[uid] = String(Math.round((100 - acc) * 100) / 100);
        } else {
          next[uid] = String(base);
          acc += base;
        }
      });
      setPercentInputs(next);
    }
  };

  const handleClearValues = () => {
    setError(null);
    if (mode === 'equal') {
      setEqualUids([]);
    } else if (mode === 'exact') {
      setExactInputs({});
    } else {
      setPercentInputs({});
    }
  };

  const handleAssignRemainingToMember = (uid: string) => {
    setError(null);
    if (mode === 'exact') {
      const current = Number(exactInputs[uid]) || 0;
      const target = Math.max(0, Math.round((current + exactRemaining) * 100) / 100);
      setExactInputs((prev) => ({ ...prev, [uid]: target > 0 ? String(target) : '' }));
    } else if (mode === 'percentage') {
      const current = Number(percentInputs[uid]) || 0;
      const target = Math.max(0, Math.round((current + percentRemaining) * 100) / 100);
      setPercentInputs((prev) => ({ ...prev, [uid]: target > 0 ? String(target) : '' }));
    }
  };

  const handleApply = (overrideAmount?: number) => {
    const effectiveAmount = overrideAmount ?? expenseAmount;

    if (mode === 'equal') {
      if (equalUids.length === 0) {
        setError('Select at least one member for an equal split.');
        return;
      }
      onApply({
        splitMode: 'equal',
        equalUids,
        exactInputs,
        percentInputs,
      });
      onClose();
      return;
    }

    if (mode === 'exact') {
      if (!(effectiveAmount > 0)) {
        setError('Enter an expense amount > ₹0 or use the split sum as the expense total.');
        return;
      }
      if (exactSum <= 0 || Math.abs(exactSum - effectiveAmount) > 0.01) {
        setError(
          `Custom amounts (${formatINR(exactSum)}) must equal the expense total (${formatINR(effectiveAmount)}).`
        );
        return;
      }
      onApply({
        splitMode: 'exact',
        equalUids,
        exactInputs,
        percentInputs,
        updatedExpenseAmount: overrideAmount,
      });
      onClose();
      return;
    }

    if (mode === 'percentage') {
      if (percentSum <= 0 || Math.abs(percentSum - 100) > 0.01) {
        setError(`Percentages (${percentSum.toFixed(1)}%) must add up to exactly 100%.`);
        return;
      }
      onApply({
        splitMode: 'percentage',
        equalUids,
        exactInputs,
        percentInputs,
      });
      onClose();
    }
  };

  const handleDisableSplit = () => {
    onApply({
      splitMode: 'none',
      equalUids,
      exactInputs,
      percentInputs,
    });
    onClose();
  };

  const progressRatio =
    mode === 'exact'
      ? expenseAmount > 0
        ? Math.min(100, Math.max(0, (exactSum / expenseAmount) * 100))
        : 0
      : mode === 'percentage'
        ? Math.min(100, Math.max(0, percentSum))
        : equalUids.length > 0
          ? 100
          : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Split Settings"
      className="fixed inset-0 z-[60] bg-slate-900/50 dark:bg-black/70 flex items-center justify-center p-4"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 flex items-center justify-center shrink-0">
              <SlidersHorizontal className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                Split Settings
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                Total: <span className="font-mono-tabular font-semibold">{formatINR(expenseAmount)}</span>
                {currency !== 'INR' && expenseAmount > 0 && (
                  <span className="font-mono-tabular"> (≈ {formatAmount(expenseAmount)})</span>
                )}
                {' · '}Paid by {paidByName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close split settings"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Split Method Tabs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Split Method
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleDistributeEvenly}
                  className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 inline-flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Distribute evenly</span>
                </button>
                <button
                  type="button"
                  onClick={handleClearValues}
                  className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 inline-flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              {(
                [
                  { id: 'exact', label: 'Custom Amounts (₹)' },
                  { id: 'percentage', label: 'Percentages (%)' },
                  { id: 'equal', label: 'Equal Split' },
                ] as const
              ).map((tab) => {
                const active = mode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setError(null);
                      setMode(tab.id);
                    }}
                    className={`py-2 px-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Allocation Bar */}
          {mode !== 'equal' && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-400">
                  {mode === 'exact'
                    ? `Allocated: ${formatINR(exactSum)} / ${formatINR(expenseAmount)}`
                    : `Allocated: ${percentSum.toFixed(1)}% / 100%`}
                </span>
                <span
                  className={`font-mono-tabular font-semibold ${
                    (mode === 'exact' ? isExactMatched : isPercentMatched)
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : (mode === 'exact' ? exactRemaining < 0 : percentRemaining < 0)
                        ? 'text-red-700 dark:text-red-400'
                        : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {mode === 'exact'
                    ? isExactMatched
                      ? 'Balanced'
                      : exactRemaining > 0
                        ? `${formatINR(exactRemaining)} left`
                        : `Over by ${formatINR(Math.abs(exactRemaining))}`
                    : isPercentMatched
                      ? '100% balanced'
                      : percentRemaining > 0
                        ? `${percentRemaining.toFixed(1)}% left`
                        : `Over by ${Math.abs(percentRemaining).toFixed(1)}%`}
                </span>
              </div>

              <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full transition-all duration-200 ${
                    (mode === 'exact' ? isExactMatched : isPercentMatched)
                      ? 'bg-emerald-600 dark:bg-emerald-500'
                      : (mode === 'exact' ? exactRemaining < 0 : percentRemaining < 0)
                        ? 'bg-red-600 dark:bg-red-500'
                        : 'bg-teal-700 dark:bg-teal-500'
                  }`}
                  style={{ width: `${progressRatio}%` }}
                />
              </div>

              {mode === 'exact' && exactSum > 0 && expenseAmount <= 0 && (
                <div className="pt-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Expense amount is currently ₹0.
                  </span>
                  <button
                    type="button"
                    onClick={() => handleApply(Math.round(exactSum * 100) / 100)}
                    className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                  >
                    Use {formatINR(exactSum)} as Expense Total &amp; Apply
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Member Rows */}
          <div className="divide-y divide-slate-200/80 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-950">
            {members.map((member) => {
              if (mode === 'equal') {
                const checked = equalUids.includes(member.uid);
                const share = checked ? equalShares[member.uid] ?? 0 : 0;
                return (
                  <label
                    key={member.uid}
                    className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-900/70 cursor-pointer"
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleEqualMember(member.uid)}
                        className="w-4 h-4 accent-teal-700 rounded cursor-pointer"
                      />
                      <UserAvatar name={member.displayName} photoURL={member.photoURL} size="xs" />
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {member.displayName}
                      </span>
                    </span>
                    <span
                      className={`font-mono-tabular text-sm font-semibold shrink-0 ${
                        checked
                          ? 'text-slate-900 dark:text-slate-100'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {formatINR(share)}
                    </span>
                  </label>
                );
              }

              if (mode === 'exact') {
                const val = Number(exactInputs[member.uid]) || 0;
                const included = val > 0;
                const pctOfTotal =
                  expenseAmount > 0 && val > 0 ? Math.round((val / expenseAmount) * 1000) / 10 : 0;
                return (
                  <div
                    key={member.uid}
                    className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-900/50"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        aria-label={`Include ${member.displayName}`}
                        checked={included}
                        onChange={() => toggleExactMemberIncluded(member.uid)}
                        className="w-4 h-4 accent-teal-700 rounded cursor-pointer shrink-0"
                      />
                      <UserAvatar name={member.displayName} photoURL={member.photoURL} size="xs" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                          {member.displayName}
                        </p>
                        {expenseAmount > 0 && (
                          <p className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                            {pctOfTotal}% of total
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {!isExactMatched && expenseAmount > 0 && exactRemaining !== 0 && (
                        <button
                          type="button"
                          onClick={() => handleAssignRemainingToMember(member.uid)}
                          title="Assign remaining difference to this member"
                          className="px-2 py-1 rounded text-[11px] font-medium text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/60 hover:bg-teal-100 dark:hover:bg-teal-900/60 cursor-pointer whitespace-nowrap"
                        >
                          {exactRemaining > 0 ? '+Rem' : 'Adjust'}
                        </button>
                      )}
                      <div className="relative w-28">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 dark:text-slate-500 font-mono-tabular">
                          ₹
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          aria-label={`Exact amount for ${member.displayName}`}
                          value={exactInputs[member.uid] ?? ''}
                          onChange={(e) => {
                            setError(null);
                            setExactInputs((prev) => ({ ...prev, [member.uid]: e.target.value }));
                          }}
                          placeholder="0.00"
                          className="w-full pl-6 pr-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-tabular text-xs text-right text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
                        />
                      </div>
                    </div>
                  </div>
                );
              }

              // Percentage mode
              const pctVal = Number(percentInputs[member.uid]) || 0;
              const included = pctVal > 0;
              const rupeePreview = percentagePreviewShares[member.uid] ?? 0;

              return (
                <div
                  key={member.uid}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-900/50"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      aria-label={`Include ${member.displayName}`}
                      checked={included}
                      onChange={() => togglePercentMemberIncluded(member.uid)}
                      className="w-4 h-4 accent-teal-700 rounded cursor-pointer shrink-0"
                    />
                    <UserAvatar name={member.displayName} photoURL={member.photoURL} size="xs" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {member.displayName}
                      </p>
                      <p className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                        Share: {formatINR(rupeePreview)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!isPercentMatched && percentRemaining !== 0 && (
                      <button
                        type="button"
                        onClick={() => handleAssignRemainingToMember(member.uid)}
                        title="Assign remaining percentage to this member"
                        className="px-2 py-1 rounded text-[11px] font-medium text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/60 hover:bg-teal-100 dark:hover:bg-teal-900/60 cursor-pointer whitespace-nowrap"
                      >
                        {percentRemaining > 0 ? '+Rem' : 'Adjust'}
                      </button>
                    )}
                    <div className="relative w-24">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        aria-label={`Percentage share for ${member.displayName}`}
                        value={percentInputs[member.uid] ?? ''}
                        onChange={(e) => {
                          setError(null);
                          setPercentInputs((prev) => ({ ...prev, [member.uid]: e.target.value }));
                        }}
                        placeholder="0"
                        className="w-full pl-2.5 pr-6 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-tabular text-xs text-right text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 dark:text-slate-500 font-mono-tabular">
                        %
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleDisableSplit}
            className="text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
          >
            Turn off split
          </button>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs sm:text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleApply()}
              className="px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Apply Split</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
