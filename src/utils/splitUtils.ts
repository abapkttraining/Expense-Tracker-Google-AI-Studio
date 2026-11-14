import type { Expense, ProjectMember, Settlement, SplitMode } from '../types';

export interface MemberBalanceSummary {
  uid: string;
  displayName: string;
  photoURL: string;
  totalPaid: number; // All expenses paid (personal + shared)
  sharedPaid: number; // Expenses paid that participate in splits
  sharedOwed: number; // Total owed across split expenses
  settlementsPaid: number; // Cash/UPI sent to settle debts
  settlementsReceived: number; // Cash/UPI received from others
  netBalance: number; // > 0 means gets money back; < 0 means owes money
}

export interface SimplifiedDebt {
  fromUid: string;
  fromName: string;
  fromPhoto: string;
  toUid: string;
  toName: string;
  toPhoto: string;
  amount: number;
}

export interface ProjectBalanceReport {
  memberBalances: MemberBalanceSummary[];
  simplifiedDebts: SimplifiedDebt[];
  totalSplitExpenseVolume: number;
  splitExpenseCount: number;
  totalSettlementVolume: number;
  totalUnsettledAmount: number;
}

function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

function fromPaise(paise: number): number {
  return Math.round(paise) / 100;
}

/**
 * Splits `amount` equally among `participantUids` using integer paise arithmetic
 * so the individual shares always sum to `amount` exactly.
 */
export function computeEqualSplitShares(
  amount: number,
  participantUids: string[]
): Record<string, number> {
  const uniqueUids = Array.from(new Set(participantUids)).filter(Boolean);
  if (uniqueUids.length === 0 || !(amount > 0)) return {};

  const totalPaise = toPaise(amount);
  const count = uniqueUids.length;
  const basePaise = Math.floor(totalPaise / count);
  let remainder = totalPaise - basePaise * count;

  const shares: Record<string, number> = {};
  for (const uid of uniqueUids) {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    shares[uid] = fromPaise(basePaise + extra);
  }
  return shares;
}

/**
 * Computes exact ₹ shares from percentages (0-100), absorbing any 1-paise
 * rounding residual into the participant with the largest percentage.
 */
export function computePercentageSplitShares(
  amount: number,
  percentages: Record<string, number>
): Record<string, number> {
  const entries = Object.entries(percentages).filter(([, pct]) => Number.isFinite(pct) && pct > 0);
  if (entries.length === 0 || !(amount > 0)) return {};

  const totalPaise = toPaise(amount);
  const paiseMap: Record<string, number> = {};
  let allocatedPaise = 0;
  let largestUid = entries[0][0];
  let largestPct = -1;

  for (const [uid, pct] of entries) {
    const sharePaise = Math.round((totalPaise * pct) / 100);
    paiseMap[uid] = sharePaise;
    allocatedPaise += sharePaise;
    if (pct > largestPct) {
      largestPct = pct;
      largestUid = uid;
    }
  }

  const diff = totalPaise - allocatedPaise;
  if (diff !== 0 && largestUid) {
    paiseMap[largestUid] = Math.max(0, (paiseMap[largestUid] ?? 0) + diff);
  }

  const shares: Record<string, number> = {};
  for (const [uid, p] of Object.entries(paiseMap)) {
    if (p > 0) {
      shares[uid] = fromPaise(p);
    }
  }
  return shares;
}

export function isExpenseSplit(expense: Expense): boolean {
  return Boolean(
    expense.splitMode &&
      expense.splitMode !== 'none' &&
      expense.splitShares &&
      Object.keys(expense.splitShares).length > 0
  );
}

export function formatSplitSummaryLabel(
  expense: Expense,
  membersByUid?: Map<string, { displayName: string }>
): string | null {
  if (!isExpenseSplit(expense)) return null;
  const shares = expense.splitShares!;
  const entries = Object.entries(shares).filter(([, amt]) => amt > 0);
  const count = entries.length;
  if (count === 0) return null;

  const mode: SplitMode = expense.splitMode ?? 'equal';
  if (mode === 'equal') {
    const firstAmt = entries[0][1];
    return `Split equally (${count} ${count === 1 ? 'person' : 'people'} · ₹${firstAmt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}/ea)`;
  }

  if (mode === 'percentage' && expense.splitPercentages) {
    const topParts = entries
      .slice(0, 3)
      .map(([uid]) => {
        const name = membersByUid?.get(uid)?.displayName.split(' ')[0] ?? 'Member';
        const pct = expense.splitPercentages?.[uid] ?? 0;
        return `${name} ${pct}%`;
      })
      .join(', ');
    return entries.length > 3 ? `Split % (${topParts}, +${entries.length - 3})` : `Split % (${topParts})`;
  }

  const parts = entries
    .slice(0, 3)
    .map(([uid, amt]) => {
      const name = membersByUid?.get(uid)?.displayName.split(' ')[0] ?? 'Member';
      return `${name} ₹${amt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    })
    .join(', ');
  return entries.length > 3 ? `Split (${parts}, +${entries.length - 3})` : `Split (${parts})`;
}

export function computeProjectBalances(
  expenses: Expense[],
  settlements: Settlement[],
  members: ProjectMember[]
): ProjectBalanceReport {
  const memberInfo = new Map<
    string,
    {
      displayName: string;
      photoURL: string;
      totalPaidPaise: number;
      sharedPaidPaise: number;
      sharedOwedPaise: number;
      settlementsPaidPaise: number;
      settlementsReceivedPaise: number;
    }
  >();

  const ensureMember = (uid: string, fallbackName = 'Former Member', fallbackPhoto = '') => {
    if (!memberInfo.has(uid)) {
      memberInfo.set(uid, {
        displayName: fallbackName,
        photoURL: fallbackPhoto,
        totalPaidPaise: 0,
        sharedPaidPaise: 0,
        sharedOwedPaise: 0,
        settlementsPaidPaise: 0,
        settlementsReceivedPaise: 0,
      });
    }
    return memberInfo.get(uid)!;
  };

  for (const m of members) {
    ensureMember(m.uid, m.displayName, m.photoURL);
  }

  let totalSplitExpensePaise = 0;
  let splitExpenseCount = 0;

  for (const exp of expenses) {
    const payer = ensureMember(exp.paidByUid, exp.paidByName, exp.paidByPhoto);
    const expPaise = toPaise(exp.amount);
    payer.totalPaidPaise += expPaise;

    if (isExpenseSplit(exp)) {
      splitExpenseCount += 1;
      totalSplitExpensePaise += expPaise;
      payer.sharedPaidPaise += expPaise;

      const shareEntries = Object.entries(exp.splitShares!);
      let sumSharePaise = 0;
      for (const [uid, shareAmt] of shareEntries) {
        if (!(shareAmt > 0)) continue;
        const shareP = toPaise(shareAmt);
        sumSharePaise += shareP;
        ensureMember(uid).sharedOwedPaise += shareP;
      }
      // Guard against any legacy/manual rounding drift so net balances always sum to 0
      const drift = expPaise - sumSharePaise;
      if (drift !== 0) {
        payer.sharedOwedPaise += drift;
      }
    }
  }

  let totalSettlementPaise = 0;
  for (const s of settlements) {
    const amtPaise = toPaise(s.amount);
    if (!(amtPaise > 0) || s.fromUid === s.toUid) continue;
    totalSettlementPaise += amtPaise;
    ensureMember(s.fromUid, s.fromName, s.fromPhoto).settlementsPaidPaise += amtPaise;
    ensureMember(s.toUid, s.toName, s.toPhoto).settlementsReceivedPaise += amtPaise;
  }

  const memberBalances: MemberBalanceSummary[] = [];
  const creditors: Array<{ uid: string; displayName: string; photoURL: string; paise: number }> = [];
  const debtors: Array<{ uid: string; displayName: string; photoURL: string; paise: number }> = [];
  let totalPositivePaise = 0;

  for (const [uid, info] of memberInfo.entries()) {
    const netPaise =
      info.sharedPaidPaise -
      info.sharedOwedPaise +
      info.settlementsPaidPaise -
      info.settlementsReceivedPaise;

    memberBalances.push({
      uid,
      displayName: info.displayName,
      photoURL: info.photoURL,
      totalPaid: fromPaise(info.totalPaidPaise),
      sharedPaid: fromPaise(info.sharedPaidPaise),
      sharedOwed: fromPaise(info.sharedOwedPaise),
      settlementsPaid: fromPaise(info.settlementsPaidPaise),
      settlementsReceived: fromPaise(info.settlementsReceivedPaise),
      netBalance: fromPaise(netPaise),
    });

    if (netPaise > 0) {
      totalPositivePaise += netPaise;
      creditors.push({
        uid,
        displayName: info.displayName,
        photoURL: info.photoURL,
        paise: netPaise,
      });
    } else if (netPaise < 0) {
      debtors.push({
        uid,
        displayName: info.displayName,
        photoURL: info.photoURL,
        paise: -netPaise,
      });
    }
  }

  memberBalances.sort((a, b) => b.netBalance - a.netBalance);

  // Greedy minimum-transfer debt simplification
  creditors.sort((a, b) => b.paise - a.paise);
  debtors.sort((a, b) => b.paise - a.paise);

  const simplifiedDebts: SimplifiedDebt[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const settlePaise = Math.min(debtor.paise, creditor.paise);

    if (settlePaise > 0) {
      simplifiedDebts.push({
        fromUid: debtor.uid,
        fromName: debtor.displayName,
        fromPhoto: debtor.photoURL,
        toUid: creditor.uid,
        toName: creditor.displayName,
        toPhoto: creditor.photoURL,
        amount: fromPaise(settlePaise),
      });
    }

    debtor.paise -= settlePaise;
    creditor.paise -= settlePaise;
    if (debtor.paise === 0) i += 1;
    if (creditor.paise === 0) j += 1;
  }

  return {
    memberBalances,
    simplifiedDebts,
    totalSplitExpenseVolume: fromPaise(totalSplitExpensePaise),
    splitExpenseCount,
    totalSettlementVolume: fromPaise(totalSettlementPaise),
    totalUnsettledAmount: fromPaise(totalPositivePaise),
  };
}
