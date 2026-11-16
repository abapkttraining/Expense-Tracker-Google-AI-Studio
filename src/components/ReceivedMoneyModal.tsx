import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Loader2, Minus, Plus, X } from 'lucide-react';
import { formatINR, getTodayISO } from '../constants';
import { useCurrency } from '../hooks/useCurrency';
import {
  PAYMENT_METHODS,
  type Expense,
  type PaymentMethod,
  type ReceivedMoney,
} from '../types';
import { getExternalSplitInfo } from '../utils/lendingUtils';

const SOURCE_PRESETS = [
  'Friend Repayment',
  'Refund',
  'Reimbursement',
  'Cashback',
  'Salary / Pocket Money',
  'Other',
] as const;

interface ReceivedMoneyModalProps {
  open: boolean;
  onClose: () => void;
  projectName: string;
  expenses: Expense[];
  receivedMoney: ReceivedMoney[];
  initialExpense?: Expense | null;
  onSubmit: (input: {
    amount: number;
    date: string;
    source: string;
    note?: string;
    paymentMethod: PaymentMethod;
    linkedExpenseId?: string;
    peoplePaidCount?: number;
  }) => Promise<void>;
}

export function ReceivedMoneyModal({
  open,
  onClose,
  projectName,
  expenses,
  receivedMoney,
  initialExpense = null,
  onSubmit,
}: ReceivedMoneyModalProps) {
  const { currency, inrPerUnit, formatAmount } = useCurrency();

  const [linkedExpenseId, setLinkedExpenseId] = useState('');
  const [repayMode, setRepayMode] = useState<'people' | 'custom'>('people');
  const [peoplePaid, setPeoplePaid] = useState(1);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getTodayISO());
  const [source, setSource] = useState('Friend Repayment');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('PhonePe');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedExpense = useMemo(
    () => expenses.find((e) => e.id === linkedExpenseId) ?? null,
    [expenses, linkedExpenseId]
  );

  const externalInfo = useMemo(
    () => (selectedExpense ? getExternalSplitInfo(selectedExpense) : null),
    [selectedExpense]
  );

  const linkedStats = useMemo(() => {
    if (!selectedExpense) {
      return { alreadyReceived: 0, alreadyPeoplePaid: 0 };
    }
    let alreadyReceived = 0;
    let alreadyPeoplePaid = 0;
    for (const r of receivedMoney) {
      if (r.linkedExpenseId === selectedExpense.id) {
        alreadyReceived += r.amount;
        alreadyPeoplePaid += r.peoplePaidCount ?? 0;
      }
    }
    return {
      alreadyReceived: Math.round(alreadyReceived * 100) / 100,
      alreadyPeoplePaid,
    };
  }, [selectedExpense, receivedMoney]);

  const externalRemainingBalance = useMemo(() => {
    if (!externalInfo) return 0;
    return Math.max(
      0,
      Math.round((externalInfo.totalReceivable - linkedStats.alreadyReceived) * 100) / 100
    );
  }, [externalInfo, linkedStats.alreadyReceived]);

  const externalRemainingPeople = useMemo(() => {
    if (!externalInfo) return 0;
    if (externalRemainingBalance <= 0.01) return 0;
    const equivPaid =
      externalInfo.perPersonShare > 0
        ? Math.floor((linkedStats.alreadyReceived + 0.01) / externalInfo.perPersonShare)
        : 0;
    const effectivePaid = Math.max(linkedStats.alreadyPeoplePaid, equivPaid);
    return Math.max(0, externalInfo.owedPeopleCount - effectivePaid);
  }, [externalInfo, externalRemainingBalance, linkedStats]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDate(getTodayISO());
    setPaymentMethod('PhonePe');
    setNote('');

    if (initialExpense) {
      setLinkedExpenseId(initialExpense.id);
      const info = getExternalSplitInfo(initialExpense);
      if (info) {
        setRepayMode('people');
        setPeoplePaid(1);
        setSource(info.label ? `Repayment · ${info.label}` : 'Friend Repayment');
        setAmount(String(info.perPersonShare));
      } else {
        setRepayMode('custom');
        setSource('Reimbursement');
        let already = 0;
        for (const r of receivedMoney) {
          if (r.linkedExpenseId === initialExpense.id) already += r.amount;
        }
        const remaining = Math.max(0, Math.round((initialExpense.amount - already) * 100) / 100);
        setAmount(remaining > 0 ? String(remaining) : String(initialExpense.amount));
      }
    } else {
      setLinkedExpenseId('');
      setRepayMode('custom');
      setPeoplePaid(1);
      setSource('Refund');
      setAmount('');
    }
  }, [open, initialExpense, receivedMoney]);

  // Keep amount synced when user adjusts peoplePaid in 'people' mode
  useEffect(() => {
    if (!open || !externalInfo || repayMode !== 'people') return;
    const clampedPeople = Math.max(1, Math.min(Math.max(1, externalRemainingPeople || externalInfo.owedPeopleCount), peoplePaid));
    const computed =
      clampedPeople >= externalRemainingPeople && externalRemainingBalance > 0
        ? externalRemainingBalance
        : Math.round(clampedPeople * externalInfo.perPersonShare * 100) / 100;
    setAmount(String(computed));
  }, [open, externalInfo, repayMode, peoplePaid, externalRemainingPeople, externalRemainingBalance]);

  if (!open) return null;

  const numericAmount = Number(amount) || 0;
  const maxPeopleSelectable = Math.max(1, externalRemainingPeople || externalInfo?.owedPeopleCount || 1);

  const nextRemainingForExpense = selectedExpense
    ? externalInfo
      ? Math.max(0, Math.round((externalRemainingBalance - numericAmount) * 100) / 100)
      : Math.max(
          0,
          Math.round((selectedExpense.amount - linkedStats.alreadyReceived - numericAmount) * 100) /
            100
        )
    : null;

  const handleLinkedExpenseChange = (nextId: string) => {
    setLinkedExpenseId(nextId);
    const exp = expenses.find((e) => e.id === nextId);
    if (!exp) {
      setRepayMode('custom');
      return;
    }
    const info = getExternalSplitInfo(exp);
    if (info) {
      setRepayMode('people');
      setPeoplePaid(1);
      setSource(info.label ? `Repayment · ${info.label}` : 'Friend Repayment');
    } else {
      setRepayMode('custom');
      setSource('Reimbursement');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Enter a valid amount greater than ₹0.');
      return;
    }
    if (!source.trim()) {
      setError('Enter where this money was received from.');
      return;
    }

    const effectivePeoplePaid =
      externalInfo && repayMode === 'people'
        ? Math.max(1, Math.min(maxPeopleSelectable, peoplePaid))
        : externalInfo && externalInfo.perPersonShare > 0
          ? Math.floor((numericAmount + 0.01) / externalInfo.perPersonShare)
          : undefined;

    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        amount: Math.round(numericAmount * 100) / 100,
        date,
        source: source.trim(),
        note: note.trim() || undefined,
        paymentMethod,
        linkedExpenseId: linkedExpenseId || undefined,
        peoplePaidCount: effectivePeoplePaid,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save received money.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={externalInfo ? 'Record Lending Repayment' : 'Add Money Received'}
      className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-black/60 flex items-center justify-center p-4"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 truncate">
              {externalInfo
                ? 'Record Lending Repayment'
                : selectedExpense
                  ? 'Balance Out Expense'
                  : 'Add Money Received'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              Project: {projectName} · Reduces net &amp; monthly expenditure
            </p>
          </div>
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
          {/* Link to an expense (or general credit) */}
          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
              Link to Expense (optional)
            </span>
            <select
              value={linkedExpenseId}
              onChange={(e) => handleLinkedExpenseChange(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-950 focus:outline-none focus:border-teal-600"
            >
              <option value="">General Money Received (balances monthly &amp; total spend)</option>
              {expenses.map((exp) => {
                const ext = getExternalSplitInfo(exp);
                const prefix = ext ? '[Lend] ' : '';
                return (
                  <option key={exp.id} value={exp.id}>
                    {prefix}
                    {exp.description || 'Expense'} · {exp.date} · {formatINR(exp.amount)}
                  </option>
                );
              })}
            </select>
          </label>

          {/* External Lending Summary & People Paid Selector */}
          {externalInfo && selectedExpense && (
            <div className="rounded-lg border border-teal-200 dark:border-teal-900/70 bg-teal-50/60 dark:bg-teal-950/30 p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                    {selectedExpense.description || externalInfo.label || 'External Group Split'}
                  </span>
                  <span className="text-[11px] text-slate-600 dark:text-slate-400">
                    {externalInfo.owedPeopleCount}{' '}
                    {externalInfo.owedPeopleCount === 1 ? 'person owes' : 'people owe'} you ·{' '}
                    {formatAmount(externalInfo.perPersonShare)}/person
                  </span>
                </div>
                <div className="text-right font-mono-tabular">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                    Remaining Receivable
                  </span>
                  <span className="text-sm font-bold text-teal-800 dark:text-teal-300">
                    {formatAmount(externalRemainingBalance)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1 p-1 bg-white/80 dark:bg-slate-900/80 rounded-lg border border-teal-200/70 dark:border-teal-900/60">
                <button
                  type="button"
                  onClick={() => setRepayMode('people')}
                  className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    repayMode === 'people'
                      ? 'bg-teal-700 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  By People Paid
                </button>
                <button
                  type="button"
                  onClick={() => setRepayMode('custom')}
                  className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    repayMode === 'custom'
                      ? 'bg-teal-700 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Custom Amount
                </button>
              </div>

              {repayMode === 'people' && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-medium text-slate-800 dark:text-slate-200 block">
                      How many people paid?
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {externalRemainingPeople > 0
                        ? `${externalRemainingPeople} of ${externalInfo.owedPeopleCount} still pending`
                        : 'All shares covered'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPeoplePaid((p) => Math.max(1, p - 1))}
                      disabled={peoplePaid <= 1}
                      aria-label="Decrease people paid"
                      className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={maxPeopleSelectable}
                      value={peoplePaid}
                      onChange={(e) => {
                        const val = Math.max(1, Math.min(maxPeopleSelectable, Number(e.target.value) || 1));
                        setPeoplePaid(val);
                      }}
                      aria-label="Number of people paid"
                      className="w-14 text-center py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono-tabular text-sm font-semibold text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => setPeoplePaid((p) => Math.min(maxPeopleSelectable, p + 1))}
                      disabled={peoplePaid >= maxPeopleSelectable}
                      aria-label="Increase people paid"
                      className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Amount & Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                Amount Received (₹)
              </span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (externalInfo && repayMode === 'people') {
                    setRepayMode('custom');
                  }
                }}
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
                Date Received
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

          {selectedExpense && nextRemainingForExpense !== null && numericAmount > 0 && (
            <div className="px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-400">
                {externalInfo ? 'Remaining balance after this payment:' : 'Net expense after balancing:'}
              </span>
              <span className="font-mono-tabular font-bold text-emerald-700 dark:text-emerald-400">
                {nextRemainingForExpense <= 0.01
                  ? `Settled (${formatAmount(0)})`
                  : formatAmount(nextRemainingForExpense)}
              </span>
            </div>
          )}

          {/* Source & Presets */}
          <div className="space-y-2">
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                Received From / Source
              </span>
              <input
                type="text"
                required
                maxLength={80}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g. Rahul, Office Reimbursement, Amazon Refund"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
              />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SOURCE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setSource(preset)}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer ${
                    source === preset
                      ? 'bg-slate-900 dark:bg-teal-600 text-white border-slate-900 dark:border-teal-600'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                Received Into (Method)
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
                placeholder="e.g. Paid via GPay"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
              />
            </label>
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
              <span>Save Money Received</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
