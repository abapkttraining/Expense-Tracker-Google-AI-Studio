import { useMemo, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  HandCoins,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { getTodayISO } from '../constants';
import { useCurrency } from '../hooks/useCurrency';
import {
  computeProjectBalances,
  prioritizeDebtsForUser,
  type SimplifiedDebt,
} from '../utils/splitUtils';
import {
  PAYMENT_METHODS,
  type Expense,
  type PaymentMethod,
  type ProjectMember,
  type Settlement,
} from '../types';
import { UserAvatar } from './UserAvatar';

interface SplitsBalancesViewProps {
  projectName: string;
  currentUserUid: string;
  members: ProjectMember[];
  expenses: Expense[];
  settlements: Settlement[];
  onRecordSettlement: (input: {
    fromUid: string;
    fromName: string;
    fromPhoto: string;
    toUid: string;
    toName: string;
    toPhoto: string;
    amount: number;
    date: string;
    paymentMethod: PaymentMethod;
    note?: string;
  }) => Promise<void>;
  onDeleteSettlement: (settlementId: string) => Promise<void>;
  onAddSplitExpense: () => void;
}

export function SplitsBalancesView({
  projectName,
  currentUserUid,
  members,
  expenses,
  settlements,
  onRecordSettlement,
  onDeleteSettlement,
  onAddSplitExpense,
}: SplitsBalancesViewProps) {
  const { currency, inrPerUnit, formatAmount } = useCurrency();
  const report = useMemo(
    () => computeProjectBalances(expenses, settlements, members),
    [expenses, settlements, members]
  );

  const [suggestionMode, setSuggestionMode] = useState<'simplified' | 'pairwise'>('simplified');
  const [quickMethod, setQuickMethod] = useState<PaymentMethod>('PhonePe');
  const [settlingRowKey, setSettlingRowKey] = useState<string | null>(null);
  const [confirmSettleAll, setConfirmSettleAll] = useState(false);
  const [settlingAll, setSettlingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [settleModalOpen, setSettleModalOpen] = useState(false);
  const [fromUid, setFromUid] = useState('');
  const [toUid, setToUid] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getTodayISO());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('PhonePe');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const memberOptions = useMemo(() => {
    const map = new Map<string, { uid: string; displayName: string; photoURL: string }>();
    for (const m of members) {
      map.set(m.uid, { uid: m.uid, displayName: m.displayName, photoURL: m.photoURL });
    }
    for (const b of report.memberBalances) {
      if (!map.has(b.uid)) {
        map.set(b.uid, { uid: b.uid, displayName: b.displayName, photoURL: b.photoURL });
      }
    }
    return Array.from(map.values());
  }, [members, report.memberBalances]);

  const showModeToggle =
    report.simplifiedDebts.length > 0 &&
    report.pairwiseDebts.length > 0 &&
    (report.transfersSaved > 0 || report.pairwiseDebts.length !== report.simplifiedDebts.length);

  const effectiveMode = showModeToggle ? suggestionMode : 'simplified';

  const displayedDebts = useMemo(() => {
    const raw = effectiveMode === 'pairwise' ? report.pairwiseDebts : report.simplifiedDebts;
    return prioritizeDebtsForUser(raw, currentUserUid);
  }, [effectiveMode, report.pairwiseDebts, report.simplifiedDebts, currentUserUid]);

  const openSettleModal = (debt?: SimplifiedDebt) => {
    setFormError(null);
    setDate(getTodayISO());
    setPaymentMethod(quickMethod);
    if (debt) {
      setFromUid(debt.fromUid);
      setToUid(debt.toUid);
      setAmount(String(debt.amount));
      setNote(`Settled ${projectName} balance`);
    } else {
      const first = memberOptions[0]?.uid ?? currentUserUid;
      const second = memberOptions.find((m) => m.uid !== first)?.uid ?? '';
      setFromUid(first);
      setToUid(second);
      setAmount('');
      setNote('');
    }
    setSettleModalOpen(true);
  };

  const handleQuickSettle = async (debt: SimplifiedDebt) => {
    const rowKey = `${debt.fromUid}-${debt.toUid}`;
    setSettlingRowKey(rowKey);
    setActionError(null);
    setConfirmSettleAll(false);
    try {
      await onRecordSettlement({
        fromUid: debt.fromUid,
        fromName: debt.fromName,
        fromPhoto: debt.fromPhoto,
        toUid: debt.toUid,
        toName: debt.toName,
        toPhoto: debt.toPhoto,
        amount: debt.amount,
        date: getTodayISO(),
        paymentMethod: quickMethod,
        note: `Quick settlement (${projectName})`,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to record quick settlement.');
    } finally {
      setSettlingRowKey(null);
    }
  };

  const handleSettleAll = async () => {
    if (report.simplifiedDebts.length === 0) return;
    setSettlingAll(true);
    setActionError(null);
    const snapshot = [...report.simplifiedDebts];
    try {
      for (const debt of snapshot) {
        await onRecordSettlement({
          fromUid: debt.fromUid,
          fromName: debt.fromName,
          fromPhoto: debt.fromPhoto,
          toUid: debt.toUid,
          toName: debt.toName,
          toPhoto: debt.toPhoto,
          amount: debt.amount,
          date: getTodayISO(),
          paymentMethod: quickMethod,
          note: `Quick settle all (${projectName})`,
        });
      }
      setConfirmSettleAll(false);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed while settling all suggested balances.'
      );
    } finally {
      setSettlingAll(false);
    }
  };

  const handleSubmitSettlement = async (e: FormEvent) => {
    e.preventDefault();
    const numericAmount = Number(amount);
    if (!fromUid || !toUid || fromUid === toUid) {
      setFormError('Select two different members for the settlement.');
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFormError('Enter a valid settlement amount greater than ₹0.');
      return;
    }

    const fromMember = memberOptions.find((m) => m.uid === fromUid);
    const toMember = memberOptions.find((m) => m.uid === toUid);
    if (!fromMember || !toMember) {
      setFormError('Invalid member selection.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await onRecordSettlement({
        fromUid: fromMember.uid,
        fromName: fromMember.displayName,
        fromPhoto: fromMember.photoURL,
        toUid: toMember.uid,
        toName: toMember.displayName,
        toPhoto: toMember.photoURL,
        amount: Math.round(numericAmount * 100) / 100,
        date,
        paymentMethod,
        note: note.trim() || undefined,
      });
      setSettleModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to record settlement.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Split Overview Strip */}
      <section
        aria-label="Split Balance Overview"
        className="grid grid-cols-1 sm:grid-cols-3 gap-4"
      >
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
            Shared Split Volume
          </span>
          <div className="font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-100">
            {formatAmount(report.totalSplitExpenseVolume)}
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular block">
            {report.splitExpenseCount} split{' '}
            {report.splitExpenseCount === 1 ? 'expense' : 'expenses'}
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
            Unsettled Balances
          </span>
          <div className="font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-100">
            {formatAmount(report.totalUnsettledAmount)}
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400 block">
            {report.simplifiedDebts.length === 0
              ? 'All members are settled up'
              : report.transfersSaved > 0
                ? `${report.simplifiedDebts.length} quick ${
                    report.simplifiedDebts.length === 1 ? 'transfer' : 'transfers'
                  } (saves ${report.transfersSaved})`
                : `${report.simplifiedDebts.length} suggested ${
                    report.simplifiedDebts.length === 1 ? 'transfer' : 'transfers'
                  }`}
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
            Recorded Settlements
          </span>
          <div className="font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-100">
            {formatAmount(report.totalSettlementVolume)}
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular block">
            {settlements.length} {settlements.length === 1 ? 'repayment' : 'repayments'} logged
          </span>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Quick Settlement Suggestions */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                <span>Quick Settlement Suggestions</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {report.simplifiedDebts.length === 0
                  ? `All ${projectName} collaborator balances are settled`
                  : effectiveMode === 'pairwise'
                    ? 'Direct pair-by-pair balances across individual shared expenses'
                    : report.transfersSaved > 0
                      ? `Consolidated ${report.pairwiseDebts.length} direct splits into ${report.simplifiedDebts.length} quick ${
                          report.simplifiedDebts.length === 1 ? 'transfer' : 'transfers'
                        }`
                      : `Minimum transfers to settle ${projectName} balances`}
              </p>
            </div>
            {memberOptions.length > 1 && (
              <button
                type="button"
                onClick={() => openSettleModal()}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap"
              >
                <HandCoins className="w-3.5 h-3.5" />
                <span>Custom Settle</span>
              </button>
            )}
          </div>

          {report.simplifiedDebts.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                {showModeToggle && (
                  <div
                    role="tablist"
                    aria-label="Settlement suggestion mode"
                    className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-0.5"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={effectiveMode === 'simplified'}
                      onClick={() => {
                        setSuggestionMode('simplified');
                        setConfirmSettleAll(false);
                      }}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                        effectiveMode === 'simplified'
                          ? 'bg-white dark:bg-slate-900 text-teal-800 dark:text-teal-300 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      Smart Simplified ({report.simplifiedDebts.length})
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={effectiveMode === 'pairwise'}
                      onClick={() => {
                        setSuggestionMode('pairwise');
                        setConfirmSettleAll(false);
                      }}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                        effectiveMode === 'pairwise'
                          ? 'bg-white dark:bg-slate-900 text-teal-800 dark:text-teal-300 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      Direct Pairwise ({report.pairwiseDebts.length})
                    </button>
                  </div>
                )}

                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                  <span>Via</span>
                  <select
                    aria-label="Quick settle payment method"
                    value={quickMethod}
                    onChange={(e) => setQuickMethod(e.target.value as PaymentMethod)}
                    className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-600"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {effectiveMode === 'simplified' && report.simplifiedDebts.length >= 2 && (
                <div className="flex items-center gap-1.5">
                  {!confirmSettleAll ? (
                    <button
                      type="button"
                      disabled={settlingAll || settlingRowKey !== null}
                      onClick={() => setConfirmSettleAll(true)}
                      className="px-2.5 py-1 rounded-md border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/60 text-xs font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/60 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      Settle All ({report.simplifiedDebts.length})
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={settlingAll}
                        onClick={() => void handleSettleAll()}
                        className="px-2.5 py-1 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-60 cursor-pointer whitespace-nowrap"
                      >
                        {settlingAll ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Check className="w-3 h-3" />
                        )}
                        <span>{settlingAll ? 'Settling...' : 'Confirm Settle All'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={settlingAll}
                        onClick={() => setConfirmSettleAll(false)}
                        className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {actionError && (
            <div
              role="alert"
              className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-2"
            >
              <span>{actionError}</span>
              <button
                type="button"
                onClick={() => setActionError(null)}
                aria-label="Dismiss settlement error"
                className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/60 cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {report.simplifiedDebts.length === 0 ? (
            <div className="py-8 text-center space-y-3 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg px-4">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400 mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Everything is settled up
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {report.splitExpenseCount === 0
                    ? 'Add a shared expense with Equal, Exact, or Percentage split to see quick settlement suggestions.'
                    : 'No pending debts remain among collaborators.'}
                </p>
              </div>
              {report.splitExpenseCount === 0 && (
                <button
                  type="button"
                  onClick={onAddSplitExpense}
                  className="px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Split Expense</span>
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {displayedDebts.map((debt) => {
                const rowKey = `${debt.fromUid}-${debt.toUid}`;
                const isSettlingThis = settlingRowKey === rowKey;
                const userPays = debt.fromUid === currentUserUid;
                const userReceives = debt.toUid === currentUserUid;
                const involvesUser = userPays || userReceives;

                return (
                  <div
                    key={rowKey}
                    className={`py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      involvesUser
                        ? 'bg-teal-50/40 dark:bg-teal-950/20 -mx-2.5 px-2.5 rounded-lg'
                        : ''
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap text-sm">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                          <UserAvatar name={debt.fromName} photoURL={debt.fromPhoto} size="xs" />
                          <span className="truncate max-w-[115px]">
                            {userPays ? 'You' : debt.fromName}
                          </span>
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                          <UserAvatar name={debt.toName} photoURL={debt.toPhoto} size="xs" />
                          <span className="truncate max-w-[115px]">
                            {userReceives ? 'You' : debt.toName}
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono-tabular text-sm font-bold text-teal-800 dark:text-teal-400">
                          {formatAmount(debt.amount)}
                        </span>
                        {userPays && (
                          <span className="text-[11px] font-semibold text-red-700 dark:text-red-400">
                            You pay
                          </span>
                        )}
                        {userReceives && (
                          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                            Owes you
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={settlingAll || settlingRowKey !== null}
                        onClick={() => openSettleModal(debt)}
                        aria-label={`Edit settlement from ${debt.fromName} to ${debt.toName}`}
                        title="Edit amount, date, or note"
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={settlingAll || settlingRowKey !== null}
                        onClick={() => void handleQuickSettle(debt)}
                        className="px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer whitespace-nowrap"
                      >
                        {isSettlingThis ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        <span>{isSettlingThis ? 'Settling...' : 'Quick Settle'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Member Net Balances */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Member Net Balances
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Positive means owed back; negative means owes the group
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-[11px] font-semibold text-slate-500 dark:text-slate-400 tracking-wide">
                  <th className="py-2.5 px-5">Member</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Shared Paid</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Fair Share</th>
                  <th className="py-2.5 px-5 text-right whitespace-nowrap">Net Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {report.memberBalances.map((mb) => {
                  const isPositive = mb.netBalance > 0.009;
                  const isNegative = mb.netBalance < -0.009;
                  return (
                    <tr key={mb.uid} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-2.5">
                          <UserAvatar name={mb.displayName} photoURL={mb.photoURL} size="xs" />
                          <span className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-[160px]">
                            {mb.displayName}
                            {mb.uid === currentUserUid ? ' (You)' : ''}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatAmount(mb.sharedPaid)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatAmount(mb.sharedOwed)}
                      </td>
                      <td className="py-3 px-5 text-right font-mono-tabular text-xs font-semibold whitespace-nowrap">
                        {isPositive ? (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            Gets back {formatAmount(mb.netBalance)}
                          </span>
                        ) : isNegative ? (
                          <span className="text-red-700 dark:text-red-400">
                            Owes {formatAmount(Math.abs(mb.netBalance))}
                          </span>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">
                            Settled · {formatAmount(0)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Settlement History */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Settlement History
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
              {settlements.length} {settlements.length === 1 ? 'record' : 'records'}
            </span>
          </div>
        </div>

        {settlements.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No settlements recorded yet. Use &ldquo;Quick Settle&rdquo; above once a member pays back their share.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-[11px] font-semibold text-slate-500 dark:text-slate-400 tracking-wide">
                  <th className="py-2.5 px-5 whitespace-nowrap">Date</th>
                  <th className="py-2.5 px-4">Transfer</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Payment Method</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Amount</th>
                  <th className="py-2.5 px-5 text-right whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {settlements.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-5 font-mono-tabular text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {s.date}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-900 dark:text-slate-100">
                        <span>{s.fromName}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                        <span>{s.toName}</span>
                      </div>
                      {s.note && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {s.note}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {s.paymentMethod}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                      {formatAmount(s.amount)}
                    </td>
                    <td className="py-3 px-5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => void onDeleteSettlement(s.id)}
                        aria-label={`Delete settlement from ${s.fromName} to ${s.toName}`}
                        className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Record Settlement Modal */}
      {settleModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Record Settlement"
          className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-black/60 flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Record Settlement
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Log a repayment between {projectName} collaborators
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSettleModalOpen(false)}
                aria-label="Close modal"
                className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitSettlement} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5 block">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                    Paid By
                  </span>
                  <select
                    value={fromUid}
                    onChange={(e) => setFromUid(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-950 focus:outline-none focus:border-teal-600"
                  >
                    {memberOptions.map((m) => (
                      <option key={m.uid} value={m.uid}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                    Paid To
                  </span>
                  <select
                    value={toUid}
                    onChange={(e) => setToUid(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-950 focus:outline-none focus:border-teal-600"
                  >
                    {memberOptions.map((m) => (
                      <option key={m.uid} value={m.uid}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5 block">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                    Amount (₹)
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono-tabular text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
                  />
                  {currency !== 'INR' && Number(amount) > 0 && (
                    <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400 block">
                      ≈ {formatAmount(Number(amount))} (1 {currency} = ₹{inrPerUnit[currency].toFixed(2)})
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
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono-tabular text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
                  />
                </label>
              </div>

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

              <label className="space-y-1.5 block">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                  Note (optional)
                </span>
                <input
                  type="text"
                  maxLength={200}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. GPay transfer for Goa trip"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
                />
              </label>

              {formError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
                >
                  {formError}
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSettleModalOpen(false)}
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
                  <span>Save Settlement</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
