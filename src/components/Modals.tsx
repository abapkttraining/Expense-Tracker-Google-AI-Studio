import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, Loader2, SlidersHorizontal, Trash2, UserPlus, X } from 'lucide-react';
import { formatINR, getTodayISO, TAG_COLOR_SWATCHES } from '../constants';
import { useCurrency } from '../hooks/useCurrency';
import { findDuplicateExpenses } from '../utils/duplicateUtils';
import { addFrequencyToDate, formatFrequencyLabel } from '../utils/recurringUtils';
import {
  computeEqualSplitShares,
  computePercentageSplitShares,
} from '../utils/splitUtils';
import {
  PAYMENT_METHODS,
  RECURRING_FREQUENCIES,
  type Expense,
  type Invite,
  type PaymentMethod,
  type Project,
  type ProjectMember,
  type RecurringFrequency,
  type SplitMode,
  type Tag,
} from '../types';
import { SplitSettingsModal, type SplitSettingsDraft } from './SplitSettingsModal';
import { UserAvatar } from './UserAvatar';

/* -------------------- Expense Modal -------------------- */

interface ExpenseModalProps {
  open: boolean;
  onClose: () => void;
  editingExpense: Expense | null;
  initialSplitMode?: SplitMode;
  project: Project;
  existingExpenses: Expense[];
  members: ProjectMember[];
  tags: Tag[];
  currentUserUid: string;
  onSubmit: (data: {
    amount: number;
    date: string;
    description: string;
    paidByUid: string;
    paymentMethod: PaymentMethod;
    tagIds: string[];
    isRecurring: boolean;
    frequency?: RecurringFrequency;
    nextDueDate?: string;
    splitMode: SplitMode;
    splitShares?: Record<string, number>;
    splitPercentages?: Record<string, number>;
    externalTotalPeople?: number;
    externalIncludeSelf?: boolean;
    externalLabel?: string;
  }) => Promise<void>;
}

export function ExpenseModal({
  open,
  onClose,
  editingExpense,
  initialSplitMode,
  project,
  existingExpenses,
  members,
  tags,
  currentUserUid,
  onSubmit,
}: ExpenseModalProps) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getTodayISO());
  const [description, setDescription] = useState('');
  const [paidByUid, setPaidByUid] = useState(currentUserUid);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('PhonePe');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [nextDueDate, setNextDueDate] = useState('');
  const [splitMode, setSplitMode] = useState<SplitMode>('none');
  const [equalUids, setEqualUids] = useState<string[]>([]);
  const [exactInputs, setExactInputs] = useState<Record<string, string>>({});
  const [percentInputs, setPercentInputs] = useState<Record<string, string>>({});
  const [externalTotalPeople, setExternalTotalPeople] = useState('2');
  const [externalIncludeSelf, setExternalIncludeSelf] = useState(true);
  const [externalLabel, setExternalLabel] = useState('');
  const [splitSettingsOpen, setSplitSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateConfirmPending, setDuplicateConfirmPending] = useState(false);
  const { currency, inrPerUnit, formatAmount } = useCurrency();

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDuplicateConfirmPending(false);
    setSplitSettingsOpen(false);
    const allMemberUids = members.map((m) => m.uid);
    if (editingExpense) {
      setAmount(String(editingExpense.amount));
      setDate(editingExpense.date);
      setDescription(editingExpense.description);
      setPaidByUid(editingExpense.paidByUid);
      setPaymentMethod(editingExpense.paymentMethod);
      setSelectedTags(editingExpense.tagIds);
      const rec = Boolean(editingExpense.isRecurring);
      const freq = editingExpense.frequency ?? 'monthly';
      setIsRecurring(rec);
      setFrequency(freq);
      setNextDueDate(
        rec
          ? editingExpense.nextDueDate || addFrequencyToDate(editingExpense.date, freq)
          : addFrequencyToDate(editingExpense.date, freq)
      );

      const mode = editingExpense.splitMode ?? 'none';
      setSplitMode(mode);
      const existingShares = editingExpense.splitShares ?? {};
      const activeUids = Object.keys(existingShares).filter((uid) => existingShares[uid] > 0);
      setEqualUids(activeUids.length > 0 ? activeUids : allMemberUids);

      const nextExact: Record<string, string> = {};
      const nextPercent: Record<string, string> = {};
      for (const m of members) {
        const shareVal = existingShares[m.uid];
        nextExact[m.uid] = shareVal && shareVal > 0 ? String(shareVal) : '';
        const pctVal = editingExpense.splitPercentages?.[m.uid];
        if (pctVal && pctVal > 0) {
          nextPercent[m.uid] = String(pctVal);
        } else if (shareVal && shareVal > 0 && editingExpense.amount > 0) {
          nextPercent[m.uid] = String(Math.round((shareVal / editingExpense.amount) * 10000) / 100);
        } else {
          nextPercent[m.uid] = '';
        }
      }
      setExactInputs(nextExact);
      setPercentInputs(nextPercent);
      const extPeople = editingExpense.externalTotalPeople ?? 2;
      setExternalTotalPeople(String(extPeople));
      setExternalIncludeSelf(extPeople === 1 ? false : (editingExpense.externalIncludeSelf ?? true));
      setExternalLabel(editingExpense.externalLabel ?? '');
    } else {
      const today = getTodayISO();
      setAmount('');
      setDate(today);
      setDescription('');
      setPaidByUid(currentUserUid);
      setPaymentMethod('PhonePe');
      setIsRecurring(false);
      setFrequency('monthly');
      setNextDueDate(addFrequencyToDate(today, 'monthly'));
      const defaultTag = tags.find((t) => t.id === 'other') ?? tags[0];
      setSelectedTags(defaultTag ? [defaultTag.id] : []);
      setSplitMode(initialSplitMode ?? 'none');
      setEqualUids(allMemberUids);
      setExactInputs({});
      setPercentInputs({});
      setExternalTotalPeople('2');
      setExternalIncludeSelf(true);
      setExternalLabel('');
    }
  }, [open, editingExpense, initialSplitMode, currentUserUid, tags, members]);

  const numericAmount = Number(amount) || 0;
  const parsedExternalPeople = Math.max(1, Math.min(50, Math.round(Number(externalTotalPeople) || 0)));
  const effectiveExternalIncludeSelf = parsedExternalPeople === 1 ? false : externalIncludeSelf;
  const externalOwedPeople = effectiveExternalIncludeSelf
    ? Math.max(0, parsedExternalPeople - 1)
    : parsedExternalPeople;
  const externalPerPerson =
    numericAmount > 0 && parsedExternalPeople > 0
      ? Math.round((numericAmount / parsedExternalPeople) * 100) / 100
      : 0;
  const externalTotalReceivable = effectiveExternalIncludeSelf
    ? Math.max(0, Math.round((numericAmount - externalPerPerson) * 100) / 100)
    : Math.round(numericAmount * 100) / 100;

  const equalSharesPreview = useMemo(
    () => computeEqualSplitShares(numericAmount, equalUids),
    [numericAmount, equalUids]
  );

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

  const duplicateMatches = useMemo(
    () =>
      findDuplicateExpenses(
        {
          description,
          date,
          amount: numericAmount,
        },
        existingExpenses,
        editingExpense?.id
      ),
    [description, date, numericAmount, existingExpenses, editingExpense?.id]
  );

  useEffect(() => {
    setDuplicateConfirmPending(false);
  }, [amount, date, description]);

  if (!open) return null;

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  const toggleEqualParticipant = (uid: string) => {
    setEqualUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const fillEqualValuesForMode = (targetMode: SplitMode) => {
    const uids = members.map((m) => m.uid);
    if (uids.length === 0) return;
    if (targetMode === 'exact' && numericAmount > 0) {
      const shares = computeEqualSplitShares(numericAmount, uids);
      const next: Record<string, string> = {};
      for (const uid of uids) {
        next[uid] = shares[uid] ? String(shares[uid]) : '';
      }
      setExactInputs(next);
    } else if (targetMode === 'percentage') {
      const base = Math.floor((10000 / uids.length)) / 100;
      const next: Record<string, string> = {};
      let acc = 0;
      uids.forEach((uid, idx) => {
        if (idx === uids.length - 1) {
          next[uid] = String(Math.round((100 - acc) * 100) / 100);
        } else {
          next[uid] = String(base);
          acc += base;
        }
      });
      setPercentInputs(next);
    }
  };

  const handleSplitModeChange = (nextMode: SplitMode) => {
    setSplitMode(nextMode);
    if (nextMode === 'equal' && equalUids.length === 0) {
      setEqualUids(members.map((m) => m.uid));
    }
    if (nextMode === 'exact') {
      if (members.every((m) => !exactInputs[m.uid]) && numericAmount > 0) {
        fillEqualValuesForMode('exact');
      }
      setSplitSettingsOpen(true);
    }
    if (nextMode === 'percentage') {
      if (members.every((m) => !percentInputs[m.uid])) {
        fillEqualValuesForMode('percentage');
      }
      setSplitSettingsOpen(true);
    }
  };

  const handleOpenSplitSettings = () => {
    if (splitMode === 'none' && members.length > 0 && members.every((m) => !exactInputs[m.uid]) && numericAmount > 0) {
      fillEqualValuesForMode('exact');
    }
    setSplitSettingsOpen(true);
  };

  const handleApplySplitSettings = (draft: SplitSettingsDraft) => {
    setSplitMode(draft.splitMode);
    setEqualUids(draft.equalUids);
    setExactInputs(draft.exactInputs);
    setPercentInputs(draft.percentInputs);
    if (typeof draft.updatedExpenseAmount === 'number' && draft.updatedExpenseAmount > 0) {
      setAmount(String(draft.updatedExpenseAmount));
    }
    setError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Enter a valid amount greater than ₹0.');
      return;
    }
    if (selectedTags.length === 0) {
      setError('Select at least one tag.');
      return;
    }

    let splitShares: Record<string, number> | undefined;
    let splitPercentages: Record<string, number> | undefined;
    let extPeopleToSave: number | undefined;
    let extIncludeSelfToSave: boolean | undefined;
    let extLabelToSave: string | undefined;

    if (splitMode === 'equal') {
      if (equalUids.length === 0) {
        setError('Select at least one member to split this expense equally.');
        return;
      }
      splitShares = computeEqualSplitShares(numericAmount, equalUids);
    } else if (splitMode === 'exact') {
      const shares: Record<string, number> = {};
      for (const m of members) {
        const val = Number(exactInputs[m.uid]);
        if (Number.isFinite(val) && val > 0) {
          shares[m.uid] = Math.round(val * 100) / 100;
        }
      }
      if (Object.keys(shares).length === 0 || Math.abs(exactSum - numericAmount) > 0.01) {
        setError(
          `Exact split amounts (${formatINR(exactSum)}) must equal the total expense (${formatINR(numericAmount)}).`
        );
        return;
      }
      splitShares = shares;
    } else if (splitMode === 'percentage') {
      const pcts: Record<string, number> = {};
      for (const m of members) {
        const val = Number(percentInputs[m.uid]);
        if (Number.isFinite(val) && val > 0) {
          pcts[m.uid] = Math.round(val * 100) / 100;
        }
      }
      if (Object.keys(pcts).length === 0 || Math.abs(percentSum - 100) > 0.01) {
        setError(`Percentage splits (${percentSum.toFixed(1)}%) must total 100%.`);
        return;
      }
      splitPercentages = pcts;
      splitShares = computePercentageSplitShares(numericAmount, pcts);
    } else if (splitMode === 'external') {
      const rawPeople = Number(externalTotalPeople);
      if (!Number.isFinite(rawPeople) || rawPeople < 1 || rawPeople > 50) {
        setError('Enter between 1 and 50 people for an external lending split.');
        return;
      }
      extPeopleToSave = Math.round(rawPeople);
      extIncludeSelfToSave = extPeopleToSave === 1 ? false : externalIncludeSelf;
      extLabelToSave = externalLabel.trim() || undefined;
    }

    if (duplicateMatches.length > 0 && !duplicateConfirmPending) {
      setDuplicateConfirmPending(true);
      setError(null);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        amount: numericAmount,
        date,
        description: description.trim(),
        paidByUid,
        paymentMethod,
        tagIds: selectedTags,
        isRecurring,
        frequency: isRecurring ? frequency : undefined,
        nextDueDate: isRecurring ? nextDueDate || addFrequencyToDate(date, frequency) : undefined,
        splitMode,
        splitShares,
        splitPercentages,
        externalTotalPeople: extPeopleToSave,
        externalIncludeSelf: extIncludeSelfToSave,
        externalLabel: extLabelToSave,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save expense.');
    } finally {
      setSaving(false);
    }
  };

  const { topLevelTags, subTagGroups } = (() => {
    const parentGroups = new Map<string, Tag[]>();
    const topLevel: Tag[] = [];
    for (const t of tags) {
      const parent = t.parentCategory.trim();
      if (!parent) {
        topLevel.push(t);
      } else {
        const key = parent;
        const list = parentGroups.get(key) ?? [];
        list.push(t);
        parentGroups.set(key, list);
      }
    }
    const groups = Array.from(parentGroups.entries()).map(([parentName, children]) => ({
      parentName,
      children,
    }));
    return { topLevelTags: topLevel, subTagGroups: groups };
  })();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editingExpense ? 'Edit Expense' : 'Add Expense'}
      className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-black/60 flex items-center justify-center p-4"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              {editingExpense ? 'Edit Expense' : 'Add Expense'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Project: {project.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                Amount (₹)
              </span>
              <input
                type="number"
                step="any"
                min="1"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono-tabular text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
              />
              {currency !== 'INR' && numericAmount > 0 && (
                <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400 block">
                  ≈ {formatAmount(numericAmount)} (1 {currency} = ₹{inrPerUnit[currency].toFixed(2)})
                </span>
              )}
            </label>

            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                Date
              </span>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => {
                  const val = e.target.value;
                  setDate(val);
                  if (!editingExpense || !editingExpense.nextDueDate) {
                    setNextDueDate(addFrequencyToDate(val, frequency));
                  }
                }}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono-tabular text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
              />
            </label>
          </div>

          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
              Description (optional)
            </span>
            <input
              type="text"
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Dinner at Spice Route with friends"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                Paid By
              </span>
              <select
                value={paidByUid}
                onChange={(e) => setPaidByUid(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-950 focus:outline-none focus:border-teal-600"
              >
                {members.map((m) => (
                  <option key={m.uid} value={m.uid}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                Payment Method
              </span>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-950 focus:outline-none focus:border-teal-600"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Tags (select one or more)
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                {selectedTags.length} selected
              </span>
            </div>

            {subTagGroups.map((group) => (
              <div key={group.parentName} className="space-y-1.5">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
                  {group.parentName} Sub-tags
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {group.children.map((tag) => {
                    const active = selectedTags.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          active
                            ? 'bg-slate-900 dark:bg-teal-600 text-white border-slate-900 dark:border-teal-600'
                            : 'bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
                Categories
              </span>
              <div className="flex flex-wrap gap-1.5">
                {topLevelTags.map((tag) => {
                  const active = selectedTags.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-slate-900 dark:bg-teal-600 text-white border-slate-900 dark:border-teal-600'
                          : 'bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Recurring Schedule */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                  Recurring Bill / Subscription
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                  Receive upcoming and overdue payment reminders
                </span>
              </div>
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setIsRecurring(checked);
                  if (checked && !nextDueDate) {
                    setNextDueDate(addFrequencyToDate(date, frequency));
                  }
                }}
                className="w-4 h-4 accent-teal-700 rounded cursor-pointer"
              />
            </label>

            {isRecurring && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
                <label className="space-y-1 block">
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 block">
                    Frequency
                  </span>
                  <select
                    value={frequency}
                    onChange={(e) => {
                      const nextFreq = e.target.value as RecurringFrequency;
                      setFrequency(nextFreq);
                      setNextDueDate(addFrequencyToDate(date, nextFreq));
                    }}
                    className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 focus:outline-none focus:border-teal-600"
                  >
                    {RECURRING_FREQUENCIES.map((freq) => (
                      <option key={freq} value={freq}>
                        {formatFrequencyLabel(freq)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 block">
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 block">
                    Next Due Date
                  </span>
                  <input
                    type="date"
                    required={isRecurring}
                    value={nextDueDate}
                    onChange={(e) => setNextDueDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 font-mono-tabular text-xs text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 focus:outline-none focus:border-teal-600"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Split Expense Among Collaborators */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                  Split Expense
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                  {members.length > 1
                    ? 'Equal or custom unequal splits across collaborators'
                    : 'Invite collaborators to split expenses'}
                </span>
              </div>
              <button
                type="button"
                onClick={handleOpenSplitSettings}
                className="px-2.5 py-1.5 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/60 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Split Settings</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
              {(
                [
                  { id: 'none', label: 'No Split' },
                  { id: 'equal', label: 'Equal' },
                  { id: 'exact', label: 'Exact ₹' },
                  { id: 'percentage', label: 'Percent %' },
                  { id: 'external', label: 'Lend / Group' },
                ] as const
              ).map((option) => {
                const active = splitMode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleSplitModeChange(option.id)}
                    className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            {splitMode === 'equal' && (
              <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span>Select participants ({equalUids.length} selected)</span>
                  <span className="font-mono-tabular">
                    {equalUids.length > 0 && numericAmount > 0
                      ? `${formatINR(numericAmount / equalUids.length)} / person`
                      : '₹0.00 / person'}
                  </span>
                </div>
                <div className="divide-y divide-slate-200/70 dark:divide-slate-800">
                  {members.map((m) => {
                    const checked = equalUids.includes(m.uid);
                    const share = checked ? equalSharesPreview[m.uid] ?? 0 : 0;
                    return (
                      <label
                        key={m.uid}
                        className="py-2 flex items-center justify-between gap-3 cursor-pointer"
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleEqualParticipant(m.uid)}
                            className="w-4 h-4 accent-teal-700 rounded cursor-pointer"
                          />
                          <UserAvatar name={m.displayName} photoURL={m.photoURL} size="xs" />
                          <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                            {m.displayName}
                          </span>
                        </span>
                        <span
                          className={`font-mono-tabular text-xs font-medium shrink-0 ${
                            checked
                              ? 'text-slate-900 dark:text-slate-100'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          {formatINR(share)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {splitMode === 'exact' && (
              <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-3 space-y-2.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-slate-600 dark:text-slate-400">
                    Unequal Split · Custom Amounts
                  </span>
                  <span
                    className={`font-mono-tabular font-semibold ${
                      Math.abs(exactSum - numericAmount) <= 0.01 && numericAmount > 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {Math.abs(exactSum - numericAmount) <= 0.01 && numericAmount > 0
                      ? `Matched ${formatINR(numericAmount)}`
                      : `Allocated ${formatINR(exactSum)} / ${formatINR(numericAmount)}`}
                  </span>
                </div>
                <div className="divide-y divide-slate-200/70 dark:divide-slate-800">
                  {members.map((m) => {
                    const val = Number(exactInputs[m.uid]) || 0;
                    return (
                      <div key={m.uid} className="py-1.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <UserAvatar name={m.displayName} photoURL={m.photoURL} size="xs" />
                          <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                            {m.displayName}
                          </span>
                        </div>
                        <span
                          className={`font-mono-tabular text-xs font-medium shrink-0 ${
                            val > 0
                              ? 'text-slate-900 dark:text-slate-100'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          {formatINR(val)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={handleOpenSplitSettings}
                  className="w-full py-1.5 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-teal-700 dark:text-teal-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Edit Custom Amounts in Split Settings
                </button>
              </div>
            )}

            {splitMode === 'percentage' && (
              <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-3 space-y-2.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-slate-600 dark:text-slate-400">
                    Unequal Split · Percentages
                  </span>
                  <span
                    className={`font-mono-tabular font-semibold ${
                      Math.abs(percentSum - 100) <= 0.01
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {Math.abs(percentSum - 100) <= 0.01
                      ? '100% allocated'
                      : `Allocated: ${percentSum.toFixed(1)}%`}
                  </span>
                </div>
                <div className="divide-y divide-slate-200/70 dark:divide-slate-800">
                  {members.map((m) => {
                    const pct = Number(percentInputs[m.uid]) || 0;
                    const rupeeShare = numericAmount > 0 ? (numericAmount * pct) / 100 : 0;
                    return (
                      <div key={m.uid} className="py-1.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <UserAvatar name={m.displayName} photoURL={m.photoURL} size="xs" />
                          <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                            {m.displayName}
                          </span>
                        </div>
                        <span
                          className={`font-mono-tabular text-xs font-medium shrink-0 ${
                            pct > 0
                              ? 'text-slate-900 dark:text-slate-100'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          {pct}% · {formatINR(rupeeShare)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={handleOpenSplitSettings}
                  className="w-full py-1.5 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-teal-700 dark:text-teal-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Edit Percentages in Split Settings
                </button>
              </div>
            )}

            {splitMode === 'external' && (
              <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 space-y-3">
                <div>
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                    External Lending / Non-Member Split
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                    Split across people outside this project and record repayments as each person pays back
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1 block">
                    <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 block">
                      Number of People (1–50)
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      step={1}
                      value={externalTotalPeople}
                      onChange={(e) => setExternalTotalPeople(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-tabular text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
                    />
                  </label>

                  <label className="space-y-1 block">
                    <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 block">
                      Borrower / Group Label (optional)
                    </span>
                    <input
                      type="text"
                      maxLength={100}
                      value={externalLabel}
                      onChange={(e) => setExternalLabel(e.target.value)}
                      placeholder="e.g. College Friends, Rahul"
                      className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
                    />
                  </label>
                </div>

                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <div>
                    <span className="text-xs font-medium text-slate-800 dark:text-slate-200 block">
                      Include myself in this split
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                      {parsedExternalPeople === 1
                        ? 'Single person — full amount is receivable from borrower'
                        : effectiveExternalIncludeSelf
                          ? `Split by ${parsedExternalPeople}; ${externalOwedPeople} ${
                              externalOwedPeople === 1 ? 'person owes' : 'people owe'
                            } you`
                          : `All ${parsedExternalPeople} external people owe you`}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    disabled={parsedExternalPeople === 1}
                    checked={effectiveExternalIncludeSelf}
                    onChange={(e) => setExternalIncludeSelf(e.target.checked)}
                    className="w-4 h-4 accent-teal-700 rounded cursor-pointer disabled:opacity-40"
                  />
                </label>

                <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono-tabular">
                  <span className="text-slate-600 dark:text-slate-400">
                    Per person: <strong className="text-slate-900 dark:text-slate-100">{formatAmount(externalPerPerson)}</strong>
                  </span>
                  <span className="text-teal-800 dark:text-teal-300 font-semibold">
                    To collect ({externalOwedPeople}): {formatAmount(externalTotalReceivable)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {duplicateMatches.length > 0 && (
            <div
              role="alert"
              className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/80 text-xs text-amber-900 dark:text-amber-200 space-y-1.5"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <p className="font-semibold">
                    Possible duplicate expense ({duplicateMatches.length}{' '}
                    {duplicateMatches.length === 1 ? 'match' : 'matches'} found)
                  </p>
                  <p className="text-amber-800 dark:text-amber-300 leading-relaxed">
                    An expense with the same description
                    {description.trim() ? ` (“${description.trim()}”)` : ' (blank)'}, date (
                    <span className="font-mono-tabular">{date}</span>), and amount (
                    <span className="font-mono-tabular font-semibold">
                      {formatAmount(numericAmount)}
                    </span>
                    ) already exists in {project.name} — logged by{' '}
                    <span className="font-medium">{duplicateMatches[0].paidByName}</span> via{' '}
                    <span className="font-medium">{duplicateMatches[0].paymentMethod}</span>.
                  </p>
                  {duplicateConfirmPending && (
                    <p className="font-semibold text-amber-900 dark:text-amber-100">
                      Click &ldquo;Save Anyway&rdquo; below to confirm logging this duplicate entry.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className={`px-4 py-2 text-sm font-medium rounded-lg text-white inline-flex items-center gap-2 disabled:opacity-60 cursor-pointer transition-colors ${
                duplicateConfirmPending && duplicateMatches.length > 0
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-teal-700 hover:bg-teal-800'
              }`}
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>
                {duplicateConfirmPending && duplicateMatches.length > 0
                  ? 'Save Anyway'
                  : editingExpense
                    ? 'Save Changes'
                    : 'Save Expense'}
              </span>
            </button>
          </div>
        </form>
      </div>

      <SplitSettingsModal
        open={splitSettingsOpen}
        onClose={() => setSplitSettingsOpen(false)}
        expenseAmount={numericAmount}
        paidByName={members.find((m) => m.uid === paidByUid)?.displayName ?? 'Member'}
        members={members}
        initialSplitMode={splitMode}
        initialEqualUids={equalUids}
        initialExactInputs={exactInputs}
        initialPercentInputs={percentInputs}
        onApply={handleApplySplitSettings}
      />
    </div>
  );
}

/* -------------------- Project Modal -------------------- */

interface ProjectModalProps {
  open: boolean;
  onClose: () => void;
  editingProject?: Project | null;
  onSubmit: (name: string, description: string, monthlyBudget: number | null) => Promise<void>;
}

export function ProjectModal({ open, onClose, editingProject, onSubmit }: ProjectModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [monthlyBudget, setMonthlyBudget] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { currency, inrPerUnit, formatAmount } = useCurrency();

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(editingProject?.name ?? '');
    setDescription(editingProject?.description ?? '');
    setMonthlyBudget(
      editingProject?.monthlyBudget ? String(editingProject.monthlyBudget) : ''
    );
  }, [open, editingProject]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Project name is required.');
      return;
    }
    const trimmedBudget = monthlyBudget.trim();
    let parsedBudget: number | null = null;
    if (trimmedBudget) {
      const n = Number(trimmedBudget);
      if (!Number.isFinite(n) || n <= 0) {
        setError('Monthly budget must be greater than ₹0.');
        return;
      }
      parsedBudget = n;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(name.trim(), description.trim(), parsedBudget);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save project.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editingProject ? 'Edit Project' : 'Create Project'}
      className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-black/60 flex items-center justify-center p-4"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
            {editingProject ? 'Edit Project' : 'New Expense Project'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
              Project Name
            </span>
            <input
              type="text"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Goa Trip, Home Expenses, Personal"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
            />
          </label>

          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
              Description (optional)
            </span>
            <textarea
              rows={2}
              maxLength={240}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Shared household bills and groceries"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600 resize-none"
            />
          </label>

          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
              Monthly Budget Limit in ₹ (optional)
            </span>
            <input
              type="number"
              min="1"
              step="any"
              value={monthlyBudget}
              onChange={(e) => setMonthlyBudget(e.target.value)}
              placeholder="e.g. 25000"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono-tabular text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
            />
            {currency !== 'INR' && Number(monthlyBudget) > 0 && (
              <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400 block">
                ≈ {formatAmount(Number(monthlyBudget))} (1 {currency} = ₹{inrPerUnit[currency].toFixed(2)})
              </span>
            )}
          </label>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-teal-700 hover:bg-teal-800 text-white inline-flex items-center gap-2 disabled:opacity-60 cursor-pointer"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{editingProject ? 'Update Project' : 'Create Project'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* -------------------- Invite Member Modal -------------------- */

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  members: ProjectMember[];
  sentInvites: Invite[];
  onInvite: (email: string) => Promise<string>;
  onRevokeInvite: (inviteId: string) => Promise<void>;
}

export function InviteModal({
  open,
  onClose,
  project,
  members,
  sentInvites,
  onInvite,
  onRevokeInvite,
}: InviteModalProps) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setStatusMsg(null);
    setError(null);
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = email.trim().toLowerCase();
    if (!cleaned || !cleaned.includes('@')) {
      setError('Enter a valid Gmail or email address.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setStatusMsg(null);
    try {
      const msg = await onInvite(cleaned);
      setStatusMsg(msg);
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send invite.');
    } finally {
      setSubmitting(false);
    }
  };

  const pendingSent = sentInvites.filter((inv) => inv.status === 'pending');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Invite Collaborator"
      className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-black/60 flex items-center justify-center p-4"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Invite to {project.name}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Collaborators can view and add expenses in this project
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                Collaborator Gmail / Email
              </span>
              <div className="flex gap-2">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="friend@gmail.com"
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-teal-700 hover:bg-teal-800 text-white inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <UserPlus className="w-4 h-4" />
                  )}
                  <span>Invite</span>
                </button>
              </div>
            </label>

            {statusMsg && (
              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
                {statusMsg}
              </div>
            )}
            {error && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
              >
                {error}
              </div>
            )}
          </form>

          <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Current Members ({members.length})
            </h3>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {members.map((m) => (
                <div key={m.uid} className="py-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <UserAvatar name={m.displayName} photoURL={m.photoURL} size="sm" />
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {m.displayName}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 capitalize shrink-0">
                    {m.role}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {pendingSent.length > 0 && (
            <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Pending Invites ({pendingSent.length})
              </h3>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {pendingSent.map((inv) => (
                  <div key={inv.id} className="py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-700 dark:text-slate-300 truncate">
                      {inv.invitedEmail}
                    </span>
                    <button
                      type="button"
                      onClick={() => void onRevokeInvite(inv.id)}
                      aria-label={`Revoke invite to ${inv.invitedEmail}`}
                      className="p-1.5 rounded text-slate-400 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------- Custom Tag Modal -------------------- */

interface TagModalProps {
  open: boolean;
  onClose: () => void;
  tags: Tag[];
  defaultParentCategory?: string;
  editingTag?: Tag | null;
  onSubmit: (name: string, color: string, parentCategory: string) => Promise<void>;
}

export function TagModal({
  open,
  onClose,
  tags,
  defaultParentCategory = '',
  editingTag = null,
  onSubmit,
}: TagModalProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(TAG_COLOR_SWATCHES[0]);
  const [parentCategory, setParentCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editingTag) {
      setName(editingTag.name);
      setColor(editingTag.color || TAG_COLOR_SWATCHES[0]);
      setParentCategory(editingTag.parentCategory || '');
    } else {
      setName('');
      setColor(TAG_COLOR_SWATCHES[0]);
      setParentCategory(defaultParentCategory);
    }
    setError(null);
  }, [open, editingTag, defaultParentCategory]);

  // Exclude the tag being edited and any of its descendants to avoid cycles
  const availableParentOptions = useMemo(() => {
    const blockedNames = new Set<string>();
    if (editingTag) {
      const queue = [editingTag.name.trim().toLowerCase()];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (blockedNames.has(current)) continue;
        blockedNames.add(current);
        for (const t of tags) {
          if (t.parentCategory.trim().toLowerCase() === current) {
            queue.push(t.name.trim().toLowerCase());
          }
        }
      }
    }

    return [...tags]
      .filter((t) => !blockedNames.has(t.name.trim().toLowerCase()))
      .sort((a, b) => {
        // Show top-level tags first, then sub-tags alphabetically
        const aTop = a.parentCategory.trim() === '' ? 0 : 1;
        const bTop = b.parentCategory.trim() === '' ? 0 : 1;
        if (aTop !== bTop) return aTop - bTop;
        return a.name.localeCompare(b.name);
      });
  }, [tags, editingTag]);

  if (!open) return null;

  const isEditing = Boolean(editingTag);
  const modalTitle = isEditing
    ? `Edit Tag: ${editingTag!.name}`
    : defaultParentCategory
    ? `Add Sub-tag under "${defaultParentCategory}"`
    : 'Create Tag';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Tag name is required.');
      return;
    }
    const duplicate = tags.some(
      (t) =>
        t.id !== editingTag?.id &&
        t.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
      setError('A tag with this name already exists in the project.');
      return;
    }
    if (
      parentCategory.trim().toLowerCase() === trimmedName.toLowerCase()
    ) {
      setError('A tag cannot be its own parent.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSubmit(trimmedName, color, parentCategory.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save tag.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={modalTitle}
      className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-black/60 flex items-center justify-center p-4"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 truncate">
            {modalTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
              Tag Name
            </span>
            <input
              type="text"
              required
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Travel, Flights, Petrol, Rent"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
            />
          </label>

          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
              Parent Tag (optional)
            </span>
            <select
              value={parentCategory}
              onChange={(e) => setParentCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-950 focus:outline-none focus:border-teal-600"
            >
              <option value="">None (Top-level Parent Tag)</option>
              {availableParentOptions.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.parentCategory ? `${t.name} (under ${t.parentCategory})` : t.name}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
              Leave as Top-level to create a parent tag, or pick any existing tag to create a child sub-tag.
            </span>
          </label>

          <div className="space-y-2">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
              Badge Color
            </span>
            <div className="flex flex-wrap gap-2">
              {TAG_COLOR_SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => setColor(swatch)}
                  aria-label={`Select color ${swatch}`}
                  className={`w-7 h-7 rounded-md transition-transform cursor-pointer ${
                    color === swatch
                      ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-slate-100 dark:ring-offset-slate-900 scale-105'
                      : ''
                  }`}
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-teal-700 hover:bg-teal-800 text-white inline-flex items-center gap-2 disabled:opacity-60 cursor-pointer"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{isEditing ? 'Save Changes' : 'Create Tag'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
