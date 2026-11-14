import { useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, HandCoins, Loader2, Plus, Trash2, X } from 'lucide-react';
import { formatINR, getTodayISO } from '../constants';
import { computeProjectBalances, type SimplifiedDebt } from '../utils/splitUtils';
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
  const report = useMemo(
    () => computeProjectBalances(expenses, settlements, members),
    [expenses, settlements, members]
  );

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

  const openQuickSettle = (debt?: SimplifiedDebt) => {
    setFormError(null);
    setDate(getTodayISO());
    setPaymentMethod('PhonePe');
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
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <span className="text-xs font-medium text-slate-500 block">Shared Split Volume</span>
          <div className="font-mono-tabular text-2xl font-bold text-slate-900">
            {formatINR(report.totalSplitExpenseVolume)}
          </div>
          <span className="text-xs text-slate-500 font-mono-tabular block">
            {report.splitExpenseCount} split{' '}
            {report.splitExpenseCount === 1 ? 'expense' : 'expenses'}
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <span className="text-xs font-medium text-slate-500 block">Unsettled Balances</span>
          <div className="font-mono-tabular text-2xl font-bold text-slate-900">
            {formatINR(report.totalUnsettledAmount)}
          </div>
          <span className="text-xs text-slate-500 block">
            {report.simplifiedDebts.length === 0
              ? 'All members are settled up'
              : `${report.simplifiedDebts.length} suggested ${
                  report.simplifiedDebts.length === 1 ? 'transfer' : 'transfers'
                }`}
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <span className="text-xs font-medium text-slate-500 block">Recorded Settlements</span>
          <div className="font-mono-tabular text-2xl font-bold text-slate-900">
            {formatINR(report.totalSettlementVolume)}
          </div>
          <span className="text-xs text-slate-500 font-mono-tabular block">
            {settlements.length} {settlements.length === 1 ? 'repayment' : 'repayments'} logged
          </span>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Suggested Simplified Settlements */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">Who Pays Whom</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Minimal transfers to settle {projectName} balances
              </p>
            </div>
            {memberOptions.length > 1 && (
              <button
                type="button"
                onClick={() => openQuickSettle()}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <HandCoins className="w-3.5 h-3.5" />
                <span>Custom Settle</span>
              </button>
            )}
          </div>

          {report.simplifiedDebts.length === 0 ? (
            <div className="py-8 text-center space-y-3 border border-dashed border-slate-200 rounded-lg px-4">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">Everything is settled up</p>
                <p className="text-xs text-slate-500">
                  {report.splitExpenseCount === 0
                    ? 'Add a shared expense with Equal, Exact, or Percentage split to track balances.'
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
            <div className="divide-y divide-slate-100">
              {report.simplifiedDebts.map((debt) => (
                <div
                  key={`${debt.fromUid}-${debt.toUid}`}
                  className="py-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                        <UserAvatar name={debt.fromName} photoURL={debt.fromPhoto} size="xs" />
                        <span className="truncate max-w-[110px]">
                          {debt.fromUid === currentUserUid ? 'You' : debt.fromName}
                        </span>
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                        <UserAvatar name={debt.toName} photoURL={debt.toPhoto} size="xs" />
                        <span className="truncate max-w-[110px]">
                          {debt.toUid === currentUserUid ? 'You' : debt.toName}
                        </span>
                      </span>
                    </div>
                    <div className="font-mono-tabular text-sm font-bold text-teal-800">
                      {formatINR(debt.amount)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openQuickSettle(debt)}
                    className="px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    Settle Up
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Member Net Balances */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="font-display text-base font-bold text-slate-900">Member Net Balances</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Positive means owed back; negative means owes the group
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 tracking-wide">
                  <th className="py-2.5 px-5">Member</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Shared Paid</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Fair Share</th>
                  <th className="py-2.5 px-5 text-right whitespace-nowrap">Net Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {report.memberBalances.map((mb) => {
                  const isPositive = mb.netBalance > 0.009;
                  const isNegative = mb.netBalance < -0.009;
                  return (
                    <tr key={mb.uid} className="hover:bg-slate-50/80">
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-2.5">
                          <UserAvatar name={mb.displayName} photoURL={mb.photoURL} size="xs" />
                          <span className="font-medium text-slate-900 truncate max-w-[160px]">
                            {mb.displayName}
                            {mb.uid === currentUserUid ? ' (You)' : ''}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular text-xs text-slate-700 whitespace-nowrap">
                        {formatINR(mb.sharedPaid)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular text-xs text-slate-700 whitespace-nowrap">
                        {formatINR(mb.sharedOwed)}
                      </td>
                      <td className="py-3 px-5 text-right font-mono-tabular text-xs font-semibold whitespace-nowrap">
                        {isPositive ? (
                          <span className="text-emerald-700">
                            Gets back {formatINR(mb.netBalance)}
                          </span>
                        ) : isNegative ? (
                          <span className="text-red-700">
                            Owes {formatINR(Math.abs(mb.netBalance))}
                          </span>
                        ) : (
                          <span className="text-slate-500">Settled · ₹0.00</span>
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
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-base font-bold text-slate-900">Settlement History</h2>
            <span className="text-xs text-slate-500 font-mono-tabular">
              {settlements.length} {settlements.length === 1 ? 'record' : 'records'}
            </span>
          </div>
        </div>

        {settlements.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No settlements recorded yet. Use &ldquo;Settle Up&rdquo; above once a member pays back their share.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 tracking-wide">
                  <th className="py-2.5 px-5 whitespace-nowrap">Date</th>
                  <th className="py-2.5 px-4">Transfer</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Payment Method</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Amount</th>
                  <th className="py-2.5 px-5 text-right whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {settlements.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-5 font-mono-tabular text-xs text-slate-600 whitespace-nowrap">
                      {s.date}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-900">
                        <span>{s.fromName}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{s.toName}</span>
                      </div>
                      {s.note && <div className="text-xs text-slate-500 mt-0.5">{s.note}</div>}
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-slate-700 whitespace-nowrap">
                      {s.paymentMethod}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-emerald-700 whitespace-nowrap">
                      {formatINR(s.amount)}
                    </td>
                    <td className="py-3 px-5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => void onDeleteSettlement(s.id)}
                        aria-label={`Delete settlement from ${s.fromName} to ${s.toName}`}
                        className="p-2 rounded-lg text-slate-500 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
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
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Record Settlement
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Log a repayment between {projectName} collaborators
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSettleModalOpen(false)}
                aria-label="Close modal"
                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitSettlement} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5 block">
                  <span className="text-xs font-medium text-slate-700 block">Paid By</span>
                  <select
                    value={fromUid}
                    onChange={(e) => setFromUid(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 bg-white focus:outline-none focus:border-teal-600"
                  >
                    {memberOptions.map((m) => (
                      <option key={m.uid} value={m.uid}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-xs font-medium text-slate-700 block">Paid To</span>
                  <select
                    value={toUid}
                    onChange={(e) => setToUid(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 bg-white focus:outline-none focus:border-teal-600"
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
                  <span className="text-xs font-medium text-slate-700 block">Amount (₹)</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono-tabular text-sm text-slate-900 focus:outline-none focus:border-teal-600"
                  />
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-xs font-medium text-slate-700 block">Date</span>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono-tabular text-sm text-slate-900 focus:outline-none focus:border-teal-600"
                  />
                </label>
              </div>

              <label className="space-y-1.5 block">
                <span className="text-xs font-medium text-slate-700 block">Payment Method</span>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 bg-white focus:outline-none focus:border-teal-600"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1.5 block">
                <span className="text-xs font-medium text-slate-700 block">Note (optional)</span>
                <input
                  type="text"
                  maxLength={200}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. GPay transfer for Goa trip"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-teal-600"
                />
              </label>

              {formError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
                >
                  {formError}
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSettleModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
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
