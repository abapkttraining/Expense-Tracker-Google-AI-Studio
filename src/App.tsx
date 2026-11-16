import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  ArrowDownLeft,
  ArrowRight,
  Check,
  ChevronUp,
  CornerDownRight,
  Download,
  FileDown,
  FolderPlus,
  Loader2,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sun,
  Tag as TagIcon,
  Trash2,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';
import { auth, googleAuthProvider } from './lib/firebase';
import { formatINR, getTodayISO } from './constants';
import {
  acceptInvite,
  createCustomTag,
  createExpense,
  createProject,
  createReceivedMoney,
  createSettlement,
  declineInvite,
  deleteCustomTag,
  deleteExpense,
  deleteProject,
  deleteReceivedMoney,
  deleteSettlement,
  inviteMemberToProject,
  logRecurringBillPayment,
  revokeInvite,
  skipRecurringBillCycle,
  subscribePendingInvites,
  subscribeProjectExpenses,
  subscribeProjectMembers,
  subscribeProjectReceivedMoney,
  subscribeProjectSettlements,
  subscribeProjectTags,
  subscribeSentInvites,
  subscribeUserProjects,
  syncProjectMemberUidsIfNeeded,
  syncUserProfile,
  updateExpense,
  updateProjectBudget,
  updateProjectDetails,
  updateTag,
} from './services/firestoreService';
import {
  PAYMENT_METHODS,
  type Expense,
  type ExpenseFilters,
  type Invite,
  type ParsedExpenseDraft,
  type PaymentMethod,
  type Project,
  type ProjectMember,
  type ReceivedMoney,
  type RecurringFrequency,
  type Settlement,
  type SplitMode,
  type Tag,
  type Timeframe,
} from './types';
import {
  buildBudgetToast,
  detectCrossedBudgetThreshold,
  type BudgetToastItem,
} from './utils/budgetUtils';
import { computeLendingSummary } from './utils/lendingUtils';
import { evaluateRecurringBills } from './utils/recurringUtils';
import { downloadFullLedgerPdf, downloadMonthlyExpensePdf } from './utils/pdfReportUtils';
import {
  computeEqualSplitShares,
  computeProjectBalances,
  prioritizeDebtsForUser,
} from './utils/splitUtils';
import { AiExpenseDrawer } from './components/AiExpenseDrawer';
import {
  ExpenseTrendChartCard,
  PaymentMethodChartCard,
  SpendingBySubTagsCard,
  SpendingByTagCard,
  useExpenseAnalytics,
} from './components/AnalyticsCharts';
import { AuthGate } from './components/AuthGate';
import { BudgetToastContainer } from './components/BudgetToastContainer';
import { CurrencyToggle } from './components/CurrencyToggle';
import { ExpenseTable } from './components/ExpenseTable';
import { LendingAndCreditsView } from './components/LendingAndCreditsView';
import { ExpenseModal, InviteModal, ProjectModal, TagModal } from './components/Modals';
import { MonthlyBudgetCard } from './components/MonthlyBudgetCard';
import { OverviewCustomizeModal } from './components/OverviewCustomizeModal';
import { ReceivedMoneyModal } from './components/ReceivedMoneyModal';
import { RecurringAlertsBanner } from './components/RecurringAlertsBanner';
import { SpendingInsightsCard } from './components/SpendingInsightsCard';
import { SplitsBalancesView } from './components/SplitsBalancesView';
import { ThemeToggleButton } from './components/ThemeToggleButton';
import { UserAvatar } from './components/UserAvatar';
import { useCurrency } from './hooks/useCurrency';
import {
  DEFAULT_METRIC_ORDER,
  useOverviewLayout,
  type OverviewMetricId,
  type OverviewWidgetId,
} from './hooks/useOverviewLayout';
import { useTheme } from './hooks/useTheme';

type ActiveView = 'overview' | 'ledger' | 'splits' | 'lending' | 'manage';

const EMPTY_FILTERS: ExpenseFilters = {
  search: '',
  memberUid: 'all',
  paymentMethod: 'all',
  tagIds: [],
  startDate: '',
  endDate: '',
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [receivedMoney, setReceivedMoney] = useState<ReceivedMoney[]>([]);
  const [expensesLoading, setExpensesLoading] = useState(false);

  const [pendingInvites, setPendingInvites] = useState<Invite[]>([]);
  const [sentInvites, setSentInvites] = useState<Invite[]>([]);

  const [activeView, setActiveView] = useState<ActiveView>('overview');
  const [timeframe, setTimeframe] = useState<Timeframe>('daily');
  const [filters, setFilters] = useState<ExpenseFilters>(EMPTY_FILTERS);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);

  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [expenseInitialSplitMode, setExpenseInitialSplitMode] = useState<SplitMode | undefined>(undefined);
  const [receivedModalOpen, setReceivedModalOpen] = useState(false);
  const [receivedTargetExpense, setReceivedTargetExpense] = useState<Expense | null>(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [defaultTagParent, setDefaultTagParent] = useState('');
  const [editingTag, setEditingTag] = useState<Tag | null>(null);

  const [confirmDeleteExpense, setConfirmDeleteExpense] = useState<Expense | null>(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<Project | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [budgetToasts, setBudgetToasts] = useState<BudgetToastItem[]>([]);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingFullPdf, setExportingFullPdf] = useState(false);
  const [customizeOverviewOpen, setCustomizeOverviewOpen] = useState(false);
  const [selectedAnalyticsParentId, setSelectedAnalyticsParentId] = useState('');
  const [overviewQuickSettlingKey, setOverviewQuickSettlingKey] = useState<string | null>(null);
  const [overviewConfirmSettleKey, setOverviewConfirmSettleKey] = useState<string | null>(null);

  const [scheduleTickDate, setScheduleTickDate] = useState<string>(() => getTodayISO());
  const [lastScheduleCheck, setLastScheduleCheck] = useState<Date>(() => new Date());

  const { theme, isDark, setTheme } = useTheme();
  const overviewLayout = useOverviewLayout();
  const {
    currency,
    rates,
    inrPerUnit,
    rateSnapshot,
    loadingRates,
    isFallbackRate,
    setCurrency,
    refreshRates,
    convertAmount,
    formatAmount,
  } = useCurrency();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const bootstrappedUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [userMenuOpen]);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        try {
          await syncUserProfile(nextUser);
        } catch (err) {
          console.error('Profile sync error:', err);
        }
      } else {
        setProjects([]);
        setProjectsLoaded(false);
        setActiveProjectId(null);
        setMembers([]);
        setTags([]);
        setExpenses([]);
        setSettlements([]);
        setReceivedMoney([]);
        setPendingInvites([]);
        setSentInvites([]);
        bootstrappedUserRef.current = null;
      }
    });
    return unsub;
  }, []);

  // Subscribe to user's projects and incoming email invites
  useEffect(() => {
    if (!user) return;
    setProjectsLoaded(false);

    const unsubProjects = subscribeUserProjects(
      user.uid,
      (list) => {
        setProjects(list);
        setProjectsLoaded(true);
        setActiveProjectId((prev) => {
          if (prev && list.some((p) => p.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      },
      (err) => setGlobalError(err.message)
    );

    const unsubInvites = user.email
      ? subscribePendingInvites(
          user.email,
          (list) => setPendingInvites(list),
          (err) => setGlobalError(err.message)
        )
      : () => {};

    return () => {
      unsubProjects();
      unsubInvites();
    };
  }, [user]);

  // Auto-create initial "Personal Expenses" workspace for brand-new users
  useEffect(() => {
    if (!user || !projectsLoaded) return;
    if (projects.length === 0 && pendingInvites.length === 0 && bootstrappedUserRef.current !== user.uid) {
      bootstrappedUserRef.current = user.uid;
      void createProject(user, 'Personal Expenses', 'Everyday spending, bills, and UPI payments')
        .then((id) => setActiveProjectId(id))
        .catch((err) => setGlobalError(err instanceof Error ? err.message : 'Setup failed'));
    }
  }, [user, projectsLoaded, projects.length, pendingInvites.length]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );

  // Subscribe to active project members, tags, expenses, settlements, receivedMoney, sent invites
  useEffect(() => {
    if (!user || !activeProject) {
      setMembers([]);
      setTags([]);
      setExpenses([]);
      setSettlements([]);
      setReceivedMoney([]);
      setSentInvites([]);
      return;
    }

    setOverviewConfirmSettleKey(null);
    setExpensesLoading(true);
    const unsubMembers = subscribeProjectMembers(
      activeProject.id,
      user.uid,
      (list) => setMembers(list),
      (err) => setGlobalError(err.message)
    );
    const unsubTags = subscribeProjectTags(
      activeProject.id,
      user.uid,
      (list) => setTags(list),
      (err) => setGlobalError(err.message)
    );
    const unsubExpenses = subscribeProjectExpenses(
      activeProject.id,
      user.uid,
      (list) => {
        setExpenses(list);
        setExpensesLoading(false);
      },
      (err) => {
        setGlobalError(err.message);
        setExpensesLoading(false);
      }
    );
    const unsubSettlements = subscribeProjectSettlements(
      activeProject.id,
      user.uid,
      (list) => setSettlements(list),
      (err) => setGlobalError(err.message)
    );
    const unsubReceived = subscribeProjectReceivedMoney(
      activeProject.id,
      user.uid,
      (list) => setReceivedMoney(list),
      (err) => setGlobalError(err.message)
    );
    const unsubSent = subscribeSentInvites(
      activeProject.id,
      user.uid,
      (list) => setSentInvites(list),
      (err) => setGlobalError(err.message)
    );

    return () => {
      unsubMembers();
      unsubTags();
      unsubExpenses();
      unsubSettlements();
      unsubReceived();
      unsubSent();
    };
  }, [user, activeProject?.id]);

  // Keep subcollection memberUids synced when a pending invitee joins
  useEffect(() => {
    if (!user || !activeProject) return;
    void syncProjectMemberUidsIfNeeded(
      activeProject,
      user.uid,
      members,
      tags,
      expenses,
      settlements,
      receivedMoney
    );
  }, [user, activeProject, members, tags, expenses, settlements, receivedMoney]);

  // Scheduled recurring bills check: runs immediately on expense updates, every 60s, and on tab focus
  useEffect(() => {
    const runScheduledCheck = () => {
      setScheduleTickDate(getTodayISO());
      setLastScheduleCheck(new Date());
    };

    runScheduledCheck();
    const intervalId = window.setInterval(runScheduledCheck, 60_000);
    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        runScheduledCheck();
      }
    };
    window.addEventListener('focus', runScheduledCheck);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', runScheduledCheck);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
    };
  }, [expenses]);

  const recurringAlerts = useMemo(
    () => evaluateRecurringBills(expenses, scheduleTickDate, 7),
    [expenses, scheduleTickDate]
  );

  const lastCheckedLabel = useMemo(
    () =>
      lastScheduleCheck.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [lastScheduleCheck]
  );

  const balanceReport = useMemo(
    () => computeProjectBalances(expenses, settlements, members),
    [expenses, settlements, members]
  );

  const lendingSummary = useMemo(
    () => computeLendingSummary(expenses, receivedMoney, scheduleTickDate.slice(0, 7)),
    [expenses, receivedMoney, scheduleTickDate]
  );

  const currentUserNetBalance = useMemo(() => {
    if (!user) return 0;
    return balanceReport.memberBalances.find((b) => b.uid === user.uid)?.netBalance ?? 0;
  }, [balanceReport.memberBalances, user]);

  const topQuickSettlements = useMemo(
    () => prioritizeDebtsForUser(balanceReport.simplifiedDebts, user?.uid ?? '').slice(0, 3),
    [balanceReport.simplifiedDebts, user]
  );

  const filteredExpenses = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    let effectiveTagIds: Set<string> | null = null;
    if (filters.tagIds.length > 0) {
      effectiveTagIds = new Set<string>(filters.tagIds);
      const childrenByParentName = new Map<string, Tag[]>();
      for (const t of tags) {
        const parentKey = t.parentCategory.trim().toLowerCase();
        if (!parentKey) continue;
        const list = childrenByParentName.get(parentKey) ?? [];
        list.push(t);
        childrenByParentName.set(parentKey, list);
      }
      const queue = [...filters.tagIds];
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const currentTag = tags.find((t) => t.id === currentId);
        if (!currentTag) continue;
        const children =
          childrenByParentName.get(currentTag.name.trim().toLowerCase()) ?? [];
        for (const child of children) {
          if (!effectiveTagIds.has(child.id)) {
            effectiveTagIds.add(child.id);
            queue.push(child.id);
          }
        }
      }
    }

    return expenses.filter((exp) => {
      if (q && !(exp.description || '').toLowerCase().includes(q)) return false;
      if (filters.memberUid !== 'all' && exp.paidByUid !== filters.memberUid) return false;
      if (filters.paymentMethod !== 'all' && exp.paymentMethod !== filters.paymentMethod) {
        return false;
      }
      if (effectiveTagIds && !exp.tagIds.some((tid) => effectiveTagIds.has(tid))) {
        return false;
      }
      if (filters.startDate && exp.date < filters.startDate) return false;
      if (filters.endDate && exp.date > filters.endDate) return false;
      return true;
    });
  }, [expenses, filters, tags]);

  const hierarchicalTags = useMemo(() => {
    const childrenMap = new Map<string, Tag[]>();
    const tagByName = new Map<string, Tag>();
    for (const t of tags) {
      tagByName.set(t.name.trim().toLowerCase(), t);
    }

    const roots: Tag[] = [];
    for (const t of tags) {
      const parentKey = t.parentCategory.trim().toLowerCase();
      if (!parentKey || !tagByName.has(parentKey) || parentKey === t.name.trim().toLowerCase()) {
        roots.push(t);
      } else {
        const list = childrenMap.get(parentKey) ?? [];
        list.push(t);
        childrenMap.set(parentKey, list);
      }
    }

    const rows: Array<{ tag: Tag; depth: number; childCount: number }> = [];
    const visited = new Set<string>();
    const visit = (tag: Tag, depth: number) => {
      if (visited.has(tag.id)) return;
      visited.add(tag.id);
      const children = childrenMap.get(tag.name.trim().toLowerCase()) ?? [];
      rows.push({ tag, depth, childCount: children.length });
      for (const child of children) {
        visit(child, depth + 1);
      }
    };

    for (const root of roots) {
      visit(root, 0);
    }
    for (const t of tags) {
      if (!visited.has(t.id)) {
        visit(t, 0);
      }
    }
    return rows;
  }, [tags]);

  const hasActiveFilters = Boolean(
    filters.search ||
      filters.memberUid !== 'all' ||
      filters.paymentMethod !== 'all' ||
      filters.tagIds.length > 0 ||
      filters.startDate ||
      filters.endDate
  );

  const metrics = useMemo(() => {
    const totalSpend = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

    const currentMonthPrefix = getTodayISO().slice(0, 7);
    const thisMonthSpend = expenses
      .filter((e) => e.date.startsWith(currentMonthPrefix))
      .reduce((sum, e) => sum + e.amount, 0);

    const tagTotals = new Map<string, number>();
    const methodTotals = new Map<string, number>();
    for (const exp of filteredExpenses) {
      methodTotals.set(
        exp.paymentMethod,
        (methodTotals.get(exp.paymentMethod) ?? 0) + exp.amount
      );
      const share = exp.amount / Math.max(exp.tagIds.length, 1);
      for (const tid of exp.tagIds) {
        tagTotals.set(tid, (tagTotals.get(tid) ?? 0) + share);
      }
    }

    let topTagId = '';
    let topTagAmount = 0;
    for (const [id, amt] of tagTotals.entries()) {
      if (amt > topTagAmount) {
        topTagAmount = amt;
        topTagId = id;
      }
    }
    const topTagName = tags.find((t) => t.id === topTagId)?.name ?? 'None';

    let topMethod = 'None';
    let topMethodAmount = 0;
    for (const [m, amt] of methodTotals.entries()) {
      if (amt > topMethodAmount) {
        topMethodAmount = amt;
        topMethod = m;
      }
    }

    return {
      totalSpend,
      thisMonthSpend,
      topTagName,
      topTagAmount,
      topMethod,
      topMethodAmount,
    };
  }, [filteredExpenses, expenses, tags]);

  const analytics = useExpenseAnalytics({
    expenses: filteredExpenses,
    tags,
    timeframe,
    isDark,
    selectedParentTagId: selectedAnalyticsParentId,
    onSelectParentTagId: setSelectedAnalyticsParentId,
  });

  const handleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Google Sign-In failed. Please try again.'
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    setUserMenuOpen(false);
    await signOut(auth);
  };

  const dismissBudgetToast = useCallback((id: string) => {
    setBudgetToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notifyBudgetThresholdIfCrossed = useCallback(
    (project: Project, previousSpend: number, nextSpend: number) => {
      const budget = project.monthlyBudget;
      if (typeof budget !== 'number' || !(budget > 0)) return;
      const crossed = detectCrossedBudgetThreshold(previousSpend, nextSpend, budget);
      if (crossed === null) return;
      const toast = buildBudgetToast({
        projectId: project.id,
        projectName: project.name,
        previousSpend,
        newSpend: nextSpend,
        budget,
        threshold: crossed,
        formatAmount,
      });
      setBudgetToasts((prev) => [...prev.slice(-2), toast]);
    },
    [formatAmount]
  );

  const handleSaveExpense = async (data: {
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
  }) => {
    if (!user || !activeProject) return;
    const payer = members.find((m) => m.uid === data.paidByUid) ?? {
      uid: user.uid,
      displayName: user.displayName || user.email?.split('@')[0] || 'Member',
      photoURL: user.photoURL ?? '',
    };

    const currentMonthPrefix = getTodayISO().slice(0, 7);
    const previousSpend = Math.max(0, metrics.thisMonthSpend - lendingSummary.totalReceivedThisMonth);
    const nextContribution = data.date.startsWith(currentMonthPrefix) ? data.amount : 0;

    if (editingExpense) {
      const prevContribution = editingExpense.date.startsWith(currentMonthPrefix)
        ? editingExpense.amount
        : 0;
      await updateExpense(activeProject, editingExpense.id, {
        amount: data.amount,
        date: data.date,
        description: data.description,
        paidByUid: payer.uid,
        paidByName: payer.displayName,
        paidByPhoto: payer.photoURL,
        paymentMethod: data.paymentMethod,
        tagIds: data.tagIds,
        isRecurring: data.isRecurring,
        frequency: data.frequency,
        nextDueDate: data.nextDueDate,
        splitMode: data.splitMode,
        splitShares: data.splitShares,
        splitPercentages: data.splitPercentages,
        externalTotalPeople: data.externalTotalPeople,
        externalIncludeSelf: data.externalIncludeSelf,
        externalLabel: data.externalLabel,
      });
      notifyBudgetThresholdIfCrossed(
        activeProject,
        previousSpend,
        Math.max(0, previousSpend - prevContribution + nextContribution)
      );
    } else {
      await createExpense(activeProject, user, {
        amount: data.amount,
        date: data.date,
        description: data.description,
        paidByUid: payer.uid,
        paidByName: payer.displayName,
        paidByPhoto: payer.photoURL,
        paymentMethod: data.paymentMethod,
        tagIds: data.tagIds,
        source: 'manual',
        isRecurring: data.isRecurring,
        frequency: data.frequency,
        nextDueDate: data.nextDueDate,
        splitMode: data.splitMode,
        splitShares: data.splitShares,
        splitPercentages: data.splitPercentages,
        externalTotalPeople: data.externalTotalPeople,
        externalIncludeSelf: data.externalIncludeSelf,
        externalLabel: data.externalLabel,
      });
      notifyBudgetThresholdIfCrossed(
        activeProject,
        previousSpend,
        previousSpend + nextContribution
      );
    }
  };

  const handleAiConfirmSave = async (draft: ParsedExpenseDraft) => {
    if (!user || !activeProject) return;
    const payer = members.find((m) => m.uid === draft.paidByUid) ?? {
      uid: user.uid,
      displayName: user.displayName || user.email?.split('@')[0] || 'Member',
      photoURL: user.photoURL ?? '',
    };
    const shouldSplitEqually = draft.splitMode === 'equal' && members.length > 1;
    const splitShares = shouldSplitEqually
      ? computeEqualSplitShares(
          draft.amount,
          members.map((m) => m.uid)
        )
      : undefined;

    const currentMonthPrefix = getTodayISO().slice(0, 7);
    const previousSpend = metrics.thisMonthSpend;
    const nextContribution = draft.date.startsWith(currentMonthPrefix) ? draft.amount : 0;

    await createExpense(activeProject, user, {
      amount: draft.amount,
      date: draft.date,
      description: draft.description,
      paidByUid: payer.uid,
      paidByName: payer.displayName,
      paidByPhoto: payer.photoURL,
      paymentMethod: draft.paymentMethod,
      tagIds: draft.matchedTagIds,
      source: 'ai_chat',
      isRecurring: Boolean(draft.isRecurring),
      frequency: draft.isRecurring ? draft.frequency ?? 'monthly' : undefined,
      splitMode: shouldSplitEqually ? 'equal' : 'none',
      splitShares,
    });

    notifyBudgetThresholdIfCrossed(
      activeProject,
      previousSpend,
      previousSpend + nextContribution
    );
  };

  const handleAiConfirmSaveBatch = async (drafts: ParsedExpenseDraft[]) => {
    if (!user || !activeProject || drafts.length === 0) return;
    const currentMonthPrefix = getTodayISO().slice(0, 7);
    const previousSpend = metrics.thisMonthSpend;
    let addedMonthSpend = 0;

    for (const draft of drafts) {
      const payer = members.find((m) => m.uid === draft.paidByUid) ?? {
        uid: user.uid,
        displayName: user.displayName || user.email?.split('@')[0] || 'Member',
        photoURL: user.photoURL ?? '',
      };
      const shouldSplitEqually = draft.splitMode === 'equal' && members.length > 1;
      const splitShares = shouldSplitEqually
        ? computeEqualSplitShares(
            draft.amount,
            members.map((m) => m.uid)
          )
        : undefined;

      await createExpense(activeProject, user, {
        amount: draft.amount,
        date: draft.date,
        description: draft.description,
        paidByUid: payer.uid,
        paidByName: payer.displayName,
        paidByPhoto: payer.photoURL,
        paymentMethod: draft.paymentMethod,
        tagIds: draft.matchedTagIds,
        source: 'ai_chat',
        isRecurring: Boolean(draft.isRecurring),
        frequency: draft.isRecurring ? draft.frequency ?? 'monthly' : undefined,
        splitMode: shouldSplitEqually ? 'equal' : 'none',
        splitShares,
      });

      if (draft.date.startsWith(currentMonthPrefix)) {
        addedMonthSpend += draft.amount;
      }
    }

    if (addedMonthSpend > 0) {
      notifyBudgetThresholdIfCrossed(
        activeProject,
        previousSpend,
        previousSpend + addedMonthSpend
      );
    }
  };

  const handleExportCsv = () => {
    if (!activeProject || filteredExpenses.length === 0) return;
    const tagMap = new Map(tags.map((t) => [t.id, t.name]));
    const includeConvertedCol = currency !== 'INR';
    const rows = [
      [
        'Date',
        'Description',
        'Amount (INR)',
        ...(includeConvertedCol ? [`Amount (${currency})`] : []),
        'Paid By',
        'Payment Method',
        'Tags',
        'Split Mode',
        'Recurring',
        'Frequency',
        'Source',
      ],
      ...filteredExpenses.map((e) => [
        e.date,
        `"${e.description.replace(/"/g, '""')}"`,
        String(e.amount),
        ...(includeConvertedCol ? [String(convertAmount(e.amount))] : []),
        `"${e.paidByName.replace(/"/g, '""')}"`,
        `"${e.paymentMethod}"`,
        `"${e.tagIds.map((id) => tagMap.get(id) ?? id).join(', ')}"`,
        e.splitMode ?? 'none',
        e.isRecurring ? 'Yes' : 'No',
        e.frequency ?? '',
        e.source,
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeProject.name.toLowerCase().replace(/\s+/g, '-')}-expenses.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadMonthlyPdf = () => {
    if (!activeProject || !user || exportingPdf) return;
    setExportingPdf(true);
    setGlobalError(null);
    try {
      downloadMonthlyExpensePdf({
        project: activeProject,
        expenses,
        tags,
        userName: user.displayName || user.email || 'Member',
        currency,
        rates,
        inrPerUnit,
      });
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'Unable to generate monthly PDF summary.'
      );
    } finally {
      setExportingPdf(false);
    }
  };

  const handleDownloadFullLedgerPdf = () => {
    if (!activeProject || !user || exportingFullPdf || expenses.length === 0) return;
    setExportingFullPdf(true);
    setGlobalError(null);
    try {
      downloadFullLedgerPdf({
        project: activeProject,
        expenses,
        tags,
        userName: user.displayName || user.email || 'Member',
        currency,
        rates,
        inrPerUnit,
      });
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'Unable to generate full ledger PDF report.'
      );
    } finally {
      setExportingFullPdf(false);
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-sm text-slate-500 dark:text-slate-400">Loading workspace...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthGate onSignIn={handleSignIn} signingIn={signingIn} error={authError} />;
  }

  const toggleFilterTag = (tagId: string) => {
    setFilters((prev) => ({
      ...prev,
      tagIds: prev.tagIds.includes(tagId)
        ? prev.tagIds.filter((id) => id !== tagId)
        : [...prev.tagIds, tagId],
    }));
  };

  const renderMetricCard = (metricId: OverviewMetricId) => {
    if (!activeProject) return null;
    switch (metricId) {
      case 'totalSpend':
        return (
          <div
            key="totalSpend"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1"
          >
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
              {!hasActiveFilters && lendingSummary.totalReceivedAllTime > 0
                ? 'Net Total Spend'
                : `Total Spend ${hasActiveFilters ? '(Filtered)' : ''}`}
            </span>
            <div className="font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-100">
              {!hasActiveFilters && lendingSummary.totalReceivedAllTime > 0
                ? metrics.totalSpend - lendingSummary.totalReceivedAllTime < 0
                  ? `+${formatAmount(
                      Math.abs(metrics.totalSpend - lendingSummary.totalReceivedAllTime)
                    )} surplus`
                  : formatAmount(metrics.totalSpend - lendingSummary.totalReceivedAllTime)
                : formatAmount(metrics.totalSpend)}
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular block">
              {!hasActiveFilters && lendingSummary.totalReceivedAllTime > 0
                ? `${formatAmount(metrics.totalSpend)} spent − ${formatAmount(
                    lendingSummary.totalReceivedAllTime
                  )} received`
                : `${filteredExpenses.length} ${
                    filteredExpenses.length === 1 ? 'transaction' : 'transactions'
                  }`}
            </span>
          </div>
        );
      case 'thisMonth':
        return (
          <div
            key="thisMonth"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {lendingSummary.totalReceivedThisMonth > 0
                  ? 'This Month (Net)'
                  : 'This Month'}
              </span>
              <button
                type="button"
                onClick={handleDownloadMonthlyPdf}
                disabled={exportingPdf}
                title="Download current month's PDF summary report"
                aria-label="Download monthly PDF summary report"
                className="px-2 py-0.5 text-[11px] font-semibold rounded-md border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/60 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 transition-colors"
              >
                {exportingPdf ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <FileDown className="w-3 h-3" />
                )}
                <span>{exportingPdf ? 'Generating...' : 'PDF Report'}</span>
              </button>
            </div>
            <div className="font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-100">
              {lendingSummary.totalReceivedThisMonth > 0
                ? metrics.thisMonthSpend - lendingSummary.totalReceivedThisMonth < 0
                  ? `+${formatAmount(
                      Math.abs(metrics.thisMonthSpend - lendingSummary.totalReceivedThisMonth)
                    )} surplus`
                  : formatAmount(metrics.thisMonthSpend - lendingSummary.totalReceivedThisMonth)
                : formatAmount(metrics.thisMonthSpend)}
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular block">
              {lendingSummary.totalReceivedThisMonth > 0
                ? `${formatAmount(metrics.thisMonthSpend)} − ${formatAmount(
                    lendingSummary.totalReceivedThisMonth
                  )} received`
                : activeProject.monthlyBudget
                  ? `of ${formatAmount(activeProject.monthlyBudget)} cap`
                  : new Date().toLocaleDateString('en-IN', {
                      month: 'long',
                      year: 'numeric',
                    })}
            </span>
          </div>
        );
      case 'topCategory':
        return (
          <div
            key="topCategory"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1"
          >
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
              Top Category
            </span>
            <div className="font-display text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
              {metrics.topTagName}
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular block">
              {formatAmount(metrics.topTagAmount)}
            </span>
          </div>
        );
      case 'topMethod':
        return (
          <div
            key="topMethod"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1"
          >
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
              Top Method
            </span>
            <div className="font-display text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
              {metrics.topMethod}
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular block">
              {formatAmount(metrics.topMethodAmount)}
            </span>
          </div>
        );
    }
  };

  const renderSummaryMetricsSection = (
    metricOrder: OverviewMetricId[],
    hiddenSet: Set<OverviewMetricId>,
    sectionKey?: string
  ) => {
    if (!activeProject) return null;
    const visibleIds = metricOrder.filter((id) => !hiddenSet.has(id));
    if (visibleIds.length === 0) return null;

    const gridColsClass =
      visibleIds.length === 1
        ? 'grid-cols-1'
        : visibleIds.length === 2
          ? 'grid-cols-1 sm:grid-cols-2'
          : visibleIds.length === 3
            ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
            : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';

    return (
      <section
        key={sectionKey}
        aria-label="Project Summary Metrics"
        className={`grid ${gridColsClass} gap-4`}
      >
        {visibleIds.map((id) => renderMetricCard(id))}
      </section>
    );
  };

  const renderOverviewWidget = (widgetId: OverviewWidgetId): ReactNode => {
    if (!activeProject) return null;
    switch (widgetId) {
      case 'summaryMetrics':
        return renderSummaryMetricsSection(
          overviewLayout.layout.metricOrder,
          overviewLayout.hiddenMetricSet,
          'summaryMetrics'
        );
      case 'monthlyBudget':
        return (
          <MonthlyBudgetCard
            key="monthlyBudget"
            project={activeProject}
            thisMonthSpend={metrics.thisMonthSpend}
            thisMonthReceived={lendingSummary.totalReceivedThisMonth}
            onUpdateBudget={async (budget) => {
              await updateProjectBudget(activeProject.id, budget);
            }}
          />
        );
      case 'spendingInsights':
        return (
          <SpendingInsightsCard
            key="spendingInsights"
            expenses={expenses}
            tags={tags}
            activeTagFilters={filters.tagIds}
            onFilterByTag={toggleFilterTag}
            onInspectExpense={(exp) => {
              setEditingExpense(exp);
              setExpenseInitialSplitMode(undefined);
              setExpenseModalOpen(true);
            }}
            onAddExpense={() => {
              setEditingExpense(null);
              setExpenseInitialSplitMode(undefined);
              setExpenseModalOpen(true);
            }}
          />
        );
      case 'trendChart':
        return (
          <ExpenseTrendChartCard
            key="trendChart"
            analytics={analytics}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
          />
        );
      case 'tagChart':
        return <SpendingByTagCard key="tagChart" analytics={analytics} />;
      case 'subTagChart':
        return <SpendingBySubTagsCard key="subTagChart" analytics={analytics} />;
      case 'paymentChart':
        return <PaymentMethodChartCard key="paymentChart" analytics={analytics} />;
      case 'expenseLedger':
        return (
          <ExpenseTable
            key="expenseLedger"
            expenses={filteredExpenses}
            tags={tags}
            members={members}
            receivedByExpenseId={lendingSummary.receivedByExpenseId}
            loading={expensesLoading}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={() => setFilters(EMPTY_FILTERS)}
            onEdit={(exp) => {
              setEditingExpense(exp);
              setExpenseInitialSplitMode(undefined);
              setExpenseModalOpen(true);
            }}
            onDelete={(exp) => setConfirmDeleteExpense(exp)}
            onRecordReceived={(exp) => {
              setReceivedTargetExpense(exp);
              setReceivedModalOpen(true);
            }}
            onAddFirst={() => {
              setEditingExpense(null);
              setExpenseInitialSplitMode(undefined);
              setExpenseModalOpen(true);
            }}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileSidebarOpen && (
        <div
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-slate-900/30 dark:bg-slate-950/60 lg:hidden"
        />
      )}

      {/* Left Sidebar (260px) */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-40 h-screen w-[260px] shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-transform duration-200 ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-16 px-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
            KhataLedger
          </span>
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label="Close sidebar"
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Projects Switcher */}
          <div className="space-y-2">
            <div className="px-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Projects
              </span>
              <button
                type="button"
                onClick={() => {
                  setEditingProject(null);
                  setProjectModalOpen(true);
                }}
                aria-label="Create new project"
                className="p-1 rounded text-slate-500 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <FolderPlus className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              {projects.map((proj) => {
                const isActive = proj.id === activeProject?.id;
                return (
                  <div
                    key={proj.id}
                    className={`group flex items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors ${
                      isActive
                        ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-900 dark:text-teal-200 font-semibold'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveProjectId(proj.id);
                        setFilters(EMPTY_FILTERS);
                        setMobileSidebarOpen(false);
                      }}
                      className="flex-1 text-left truncate cursor-pointer"
                    >
                      {proj.name}
                    </button>
                    {proj.ownerId === user.uid && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProject(proj);
                            setProjectModalOpen(true);
                            setMobileSidebarOpen(false);
                          }}
                          aria-label={`Edit ${proj.name}`}
                          className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {projects.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteProject(proj);
                              setMobileSidebarOpen(false);
                            }}
                            aria-label={`Delete ${proj.name}`}
                            className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  setEditingProject(null);
                  setProjectModalOpen(true);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Project</span>
              </button>
            </div>
          </div>

          {/* Collaborators in Active Project */}
          {activeProject && (
            <div className="space-y-2.5 pt-4 border-t border-slate-200 dark:border-slate-800">
              <div className="px-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Members ({members.length})
                </span>
                <button
                  type="button"
                  onClick={() => setInviteModalOpen(true)}
                  className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 inline-flex items-center gap-1 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Invite</span>
                </button>
              </div>
              <div className="space-y-1.5 px-2">
                {members.map((m) => (
                  <div key={m.uid} className="flex items-center gap-2.5 py-1">
                    <UserAvatar name={m.displayName} photoURL={m.photoURL} size="xs" />
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate flex-1">
                      {m.displayName}
                    </span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 capitalize">
                      {m.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending Incoming Invites */}
          {pendingInvites.length > 0 && (
            <div className="space-y-2 pt-4 border-t border-slate-200 dark:border-slate-800">
              <span className="px-2 text-xs font-semibold text-teal-800 dark:text-teal-300 block">
                Pending Invites ({pendingInvites.length})
              </span>
              <div className="space-y-2">
                {pendingInvites.map((inv) => (
                  <div
                    key={inv.id}
                    className="p-3 rounded-lg bg-teal-50/70 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 space-y-2"
                  >
                    <div className="text-xs">
                      <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {inv.projectName}
                      </p>
                      <p className="text-slate-600 dark:text-slate-400 truncate">
                        From {inv.invitedByName}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void acceptInvite(inv, user).then(() =>
                            setActiveProjectId(inv.projectId)
                          )
                        }
                        className="flex-1 py-1.5 px-2 rounded-md bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 cursor-pointer"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => void declineInvite(inv)}
                        className="py-1.5 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* User Settings Footer & Dropdown */}
        <div ref={userMenuRef} className="relative p-3 border-t border-slate-200 dark:border-slate-800">
          {userMenuOpen && (
            <div
              role="menu"
              aria-label="User settings"
              className="absolute bottom-full left-3 right-3 mb-2 z-50 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-lg p-2 space-y-2"
            >
              <div className="px-2.5 py-1.5 border-b border-slate-100 dark:border-slate-800">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {user.displayName || 'Account'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {user.email}
                </p>
              </div>

              <div className="px-2.5 py-1 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    Appearance
                  </span>
                  <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 capitalize">
                    {theme}
                  </span>
                </div>
                <div
                  role="group"
                  aria-label="Theme selection"
                  className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800"
                >
                  <button
                    type="button"
                    onClick={() => setTheme('light')}
                    aria-pressed={theme === 'light'}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      theme === 'light'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    <Sun className="w-3.5 h-3.5" />
                    <span>Light</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme('dark')}
                    aria-pressed={theme === 'dark'}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      theme === 'dark'
                        ? 'bg-slate-900 text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5" />
                    <span>Dark</span>
                  </button>
                </div>
              </div>

              <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void handleSignOut()}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setUserMenuOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            aria-label="Open user settings menu"
            className="w-full flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5 min-w-0 text-left">
              <UserAvatar
                name={user.displayName || user.email || 'User'}
                photoURL={user.photoURL ?? ''}
                size="sm"
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {user.displayName || 'Account'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {user.email}
                </p>
              </div>
            </div>
            <ChevronUp
              className={`w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0 transition-transform ${
                userMenuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract (3 clean zones) */}
        <header className="sticky top-0 z-20 h-16 px-4 sm:px-6 lg:px-8 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 sm:gap-8">
          {/* Zone 1: Menu toggle (mobile) + Active Project Breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open projects menu"
              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                {activeProject?.name ?? 'Select a Project'}
              </h1>
            </div>
          </div>

          {/* Zone 2: Clean single-line navigation links */}
          <nav aria-label="Workspace Views" className="hidden md:flex items-center gap-6">
            <button
              type="button"
              onClick={() => setActiveView('overview')}
              className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                activeView === 'overview'
                  ? 'border-teal-700 dark:border-teal-400 text-slate-900 dark:text-slate-100'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setActiveView('ledger')}
              className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                activeView === 'ledger'
                  ? 'border-teal-700 dark:border-teal-400 text-slate-900 dark:text-slate-100'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Ledger
            </button>
            <button
              type="button"
              onClick={() => setActiveView('splits')}
              className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                activeView === 'splits'
                  ? 'border-teal-700 dark:border-teal-400 text-slate-900 dark:text-slate-100'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Balances
            </button>
            <button
              type="button"
              onClick={() => setActiveView('lending')}
              className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                activeView === 'lending'
                  ? 'border-teal-700 dark:border-teal-400 text-slate-900 dark:text-slate-100'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Lending{lendingSummary.activeLoanCount > 0 ? ` (${lendingSummary.activeLoanCount})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setActiveView('manage')}
              className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                activeView === 'manage'
                  ? 'border-teal-700 dark:border-teal-400 text-slate-900 dark:text-slate-100'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Tags &amp; Members
            </button>
          </nav>

          {/* Zone 3: Currency Toggle + Theme Toggle + Primary Action */}
          <div className="flex items-center gap-2 shrink-0">
            <CurrencyToggle />
            <ThemeToggleButton />
            <button
              type="button"
              disabled={!activeProject}
              onClick={() => {
                setEditingExpense(null);
                setExpenseInitialSplitMode(undefined);
                setExpenseModalOpen(true);
              }}
              className="px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add Expense</span>
              <span className="sm:hidden">Add</span>
            </button>
          </div>
        </header>

        {/* Mobile View Switcher */}
        <div className="md:hidden px-4 py-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 overflow-x-auto">
          {(
            [
              { id: 'overview', label: 'Overview' },
              { id: 'ledger', label: 'Ledger' },
              { id: 'splits', label: 'Balances' },
              {
                id: 'lending',
                label:
                  lendingSummary.activeLoanCount > 0
                    ? `Lending (${lendingSummary.activeLoanCount})`
                    : 'Lending',
              },
              { id: 'manage', label: 'Tags & Members' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveView(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                activeView === tab.id
                  ? 'bg-slate-900 dark:bg-teal-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Main Viewport */}
        <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          {globalError && (
            <div
              role="alert"
              className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-4"
            >
              <span>{globalError}</span>
              <button
                type="button"
                onClick={() => setGlobalError(null)}
                className="font-semibold underline cursor-pointer shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {!activeProject ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-4">
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                Create or accept a project to get started
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                Each project keeps its own members, tags, and expenses isolated.
              </p>
              <button
                type="button"
                onClick={() => {
                  setEditingProject(null);
                  setProjectModalOpen(true);
                }}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-teal-700 text-white hover:bg-teal-800 cursor-pointer"
              >
                Create Project
              </button>
            </div>
          ) : (
            <>
              {/* Workspace Action Strip */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {activeProject.description || 'Shared project expense workspace'}
                </p>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      setReceivedTargetExpense(null);
                      setReceivedModalOpen(true);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <ArrowDownLeft className="w-3.5 h-3.5" />
                    <span>+ Received</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInviteModalOpen(true)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Invite Member</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTagModalOpen(true)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <TagIcon className="w-3.5 h-3.5" />
                    <span>New Tag</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiDrawerOpen(true)}
                    className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-slate-800 text-white hover:bg-slate-800 dark:hover:bg-slate-700 border border-transparent dark:border-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <MessageSquareText className="w-3.5 h-3.5" />
                    <span>AI Expense Chat</span>
                  </button>
                </div>
              </div>

              {/* Active Foreign Currency Exchange Rate Notice */}
              {currency !== 'INR' && (
                <div
                  role="status"
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-600 dark:text-slate-300">
                    <span className="font-semibold text-teal-800 dark:text-teal-400">
                      Display currency: {currency}
                    </span>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                      ·
                    </span>
                    <span className="font-mono-tabular font-medium text-slate-800 dark:text-slate-200">
                      1 {currency} = ₹{inrPerUnit[currency].toFixed(2)}
                    </span>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                      ·
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {isFallbackRate ? 'Offline fallback rate' : rateSnapshot.source} (
                      {rateSnapshot.date}) · Entries stored in INR
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      disabled={loadingRates}
                      onClick={() => void refreshRates()}
                      className="text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-teal-700 dark:hover:text-teal-400 inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${loadingRates ? 'animate-spin' : ''}`}
                      />
                      <span>{loadingRates ? 'Updating...' : 'Refresh Rate'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrency('INR')}
                      className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                    >
                      Reset to INR
                    </button>
                  </div>
                </div>
              )}

              {/* Scheduled Recurring Bills Notification Banner */}
              <RecurringAlertsBanner
                alerts={recurringAlerts}
                lastCheckedLabel={lastCheckedLabel}
                onLogPayment={async (alert) => {
                  try {
                    const previousSpend = metrics.thisMonthSpend;
                    await logRecurringBillPayment(activeProject, user, alert.expense, alert.dueDate);
                    notifyBudgetThresholdIfCrossed(
                      activeProject,
                      previousSpend,
                      previousSpend + alert.expense.amount
                    );
                  } catch (err) {
                    setGlobalError(
                      err instanceof Error ? err.message : 'Unable to log recurring payment.'
                    );
                  }
                }}
                onSkipCycle={async (alert) => {
                  try {
                    await skipRecurringBillCycle(activeProject, alert.expense, alert.dueDate);
                  } catch (err) {
                    setGlobalError(
                      err instanceof Error ? err.message : 'Unable to skip recurring cycle.'
                    );
                  }
                }}
                onEditExpense={(exp) => {
                  setEditingExpense(exp);
                  setExpenseModalOpen(true);
                }}
              />

              {/* Metric Summary Strip (non-Overview tabs; Overview renders it inside customizable widgets) */}
              {activeView !== 'overview' &&
                renderSummaryMetricsSection(DEFAULT_METRIC_ORDER, new Set())}

              {/* Dynamic Filter Bar (shown on Overview & Ledger) */}
              {(activeView === 'overview' || activeView === 'ledger') && (
                <section
                  aria-label="Expense Filters"
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                    <div className="relative lg:col-span-2">
                      <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={filters.search}
                        onChange={(e) =>
                          setFilters((prev) => ({ ...prev, search: e.target.value }))
                        }
                        placeholder="Search descriptions..."
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-teal-600 dark:focus:border-teal-400"
                      />
                    </div>

                    <select
                      aria-label="Filter by member"
                      value={filters.memberUid}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, memberUid: e.target.value }))
                      }
                      className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 focus:outline-none focus:border-teal-600 dark:focus:border-teal-400"
                    >
                      <option value="all">All Members</option>
                      {members.map((m) => (
                        <option key={m.uid} value={m.uid}>
                          {m.displayName}
                        </option>
                      ))}
                    </select>

                    <select
                      aria-label="Filter by payment method"
                      value={filters.paymentMethod}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, paymentMethod: e.target.value }))
                      }
                      className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 focus:outline-none focus:border-teal-600 dark:focus:border-teal-400"
                    >
                      <option value="all">All Payment Methods</option>
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>

                    <input
                      type="date"
                      aria-label="Start date"
                      value={filters.startDate}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, startDate: e.target.value }))
                      }
                      className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono-tabular text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-600 dark:focus:border-teal-400"
                    />

                    <input
                      type="date"
                      aria-label="End date"
                      value={filters.endDate}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, endDate: e.target.value }))
                      }
                      className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono-tabular text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-600 dark:focus:border-teal-400"
                    />
                  </div>

                  {/* Interactive Multi-Tag Filter Buttons */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mr-1">
                        Filter tags:
                      </span>
                      {hierarchicalTags.map(({ tag }) => {
                        const active = filters.tagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => toggleFilterTag(tag.id)}
                            title={
                              tag.parentCategory
                                ? `${tag.name} (sub-tag of ${tag.parentCategory})`
                                : tag.name
                            }
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              active
                                ? 'bg-slate-900 dark:bg-teal-600 text-white border-slate-900 dark:border-teal-600'
                                : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
                          >
                            {tag.parentCategory ? `${tag.parentCategory} › ${tag.name}` : tag.name}
                          </button>
                        );
                      })}
                    </div>

                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={() => setFilters(EMPTY_FILTERS)}
                        className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Reset Filters
                      </button>
                    )}
                  </div>
                </section>
              )}

              {activeView === 'overview' && (
                <>
                  {/* Overview Layout Customization Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                      <span>
                        Showing{' '}
                        <strong className="font-semibold text-slate-700 dark:text-slate-200">
                          {overviewLayout.visibleWidgetCount} of {overviewLayout.totalWidgetCount}
                        </strong>{' '}
                        overview widgets
                      </span>
                      {overviewLayout.isCustomized && (
                        <button
                          type="button"
                          onClick={overviewLayout.resetLayout}
                          className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Reset layout</span>
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setCustomizeOverviewOpen(true)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                      <span>Customize Overview</span>
                    </button>
                  </div>

                  {(balanceReport.totalUnsettledAmount > 0 || Math.abs(currentUserNetBalance) > 0.009) && (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-5 py-3.5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                          <Zap className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                          {currentUserNetBalance > 0.009 ? (
                            <span>
                              Your split balance:{' '}
                              <strong className="font-mono-tabular text-emerald-700 dark:text-emerald-400">
                                You are owed {formatAmount(currentUserNetBalance)}
                              </strong>
                            </span>
                          ) : currentUserNetBalance < -0.009 ? (
                            <span>
                              Your split balance:{' '}
                              <strong className="font-mono-tabular text-red-700 dark:text-red-400">
                                You owe {formatAmount(Math.abs(currentUserNetBalance))}
                              </strong>
                            </span>
                          ) : (
                            <span>
                              Unsettled group balance:{' '}
                              <strong className="font-mono-tabular text-slate-900 dark:text-slate-100">
                                {formatAmount(balanceReport.totalUnsettledAmount)}
                              </strong>
                            </span>
                          )}
                          {balanceReport.transfersSaved > 0 && (
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              · {balanceReport.simplifiedDebts.length} quick{' '}
                              {balanceReport.simplifiedDebts.length === 1
                                ? 'transfer'
                                : 'transfers'}{' '}
                              (saves {balanceReport.transfersSaved})
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveView('splits')}
                          className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 cursor-pointer whitespace-nowrap"
                        >
                          View All Balances &amp; Splits &rarr;
                        </button>
                      </div>

                      {topQuickSettlements.length > 0 && (
                        <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 space-y-2">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Quick Settlement Suggestions
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                            {topQuickSettlements.map((debt) => {
                              const rowKey = `${debt.fromUid}-${debt.toUid}`;
                              const isConfirming = overviewConfirmSettleKey === rowKey;
                              const isSettling = overviewQuickSettlingKey === rowKey;
                              const fromLabel = debt.fromUid === user.uid ? 'You' : debt.fromName;
                              const toLabel = debt.toUid === user.uid ? 'You' : debt.toName;

                              return (
                                <div
                                  key={rowKey}
                                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40"
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1 text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                                      <span className="truncate">{fromLabel}</span>
                                      <ArrowRight className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0" />
                                      <span className="truncate">{toLabel}</span>
                                    </div>
                                    <div className="font-mono-tabular text-xs font-bold text-teal-800 dark:text-teal-400">
                                      {formatAmount(debt.amount)}
                                    </div>
                                  </div>

                                  {!isConfirming ? (
                                    <button
                                      type="button"
                                      disabled={overviewQuickSettlingKey !== null}
                                      onClick={() => setOverviewConfirmSettleKey(rowKey)}
                                      className="px-2.5 py-1 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-semibold disabled:opacity-50 cursor-pointer shrink-0 whitespace-nowrap"
                                    >
                                      Quick Settle
                                    </button>
                                  ) : (
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        disabled={isSettling}
                                        onClick={async () => {
                                          setOverviewQuickSettlingKey(rowKey);
                                          try {
                                            await createSettlement(activeProject, user, {
                                              fromUid: debt.fromUid,
                                              fromName: debt.fromName,
                                              fromPhoto: debt.fromPhoto,
                                              toUid: debt.toUid,
                                              toName: debt.toName,
                                              toPhoto: debt.toPhoto,
                                              amount: debt.amount,
                                              date: getTodayISO(),
                                              paymentMethod: 'PhonePe',
                                              note: `Quick settlement (${activeProject.name})`,
                                            });
                                            setOverviewConfirmSettleKey(null);
                                          } catch (err) {
                                            setGlobalError(
                                              err instanceof Error
                                                ? err.message
                                                : 'Failed to record quick settlement.'
                                            );
                                          } finally {
                                            setOverviewQuickSettlingKey(null);
                                          }
                                        }}
                                        className="px-2 py-1 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-60 cursor-pointer whitespace-nowrap"
                                      >
                                        {isSettling ? (
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                          <Check className="w-3 h-3" />
                                        )}
                                        <span>{isSettling ? 'Saving' : 'Confirm'}</span>
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isSettling}
                                        onClick={() => setOverviewConfirmSettleKey(null)}
                                        aria-label="Cancel quick settle"
                                        className="p-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {balanceReport.simplifiedDebts.length > 3 && (
                            <button
                              type="button"
                              onClick={() => setActiveView('splits')}
                              className="text-[11px] font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                            >
                              +{balanceReport.simplifiedDebts.length - 3} more suggested transfers
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {(lendingSummary.activeLoanCount > 0 || lendingSummary.totalReceivedAllTime > 0) && (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                        {lendingSummary.activeLoanCount > 0 ? (
                          <span>
                            External lending pending:{' '}
                            <strong className="font-mono-tabular text-teal-700 dark:text-teal-400">
                              {formatAmount(lendingSummary.totalReceivableOutstanding)}
                            </strong>{' '}
                            across {lendingSummary.activeLoanCount}{' '}
                            {lendingSummary.activeLoanCount === 1 ? 'split' : 'splits'} (
                            {lendingSummary.totalPendingPeople}{' '}
                            {lendingSummary.totalPendingPeople === 1 ? 'person' : 'people'} left)
                          </span>
                        ) : (
                          <span>
                            Money received:{' '}
                            <strong className="font-mono-tabular text-emerald-700 dark:text-emerald-400">
                              {formatAmount(lendingSummary.totalReceivedAllTime)}
                            </strong>{' '}
                            balancing project expenditure
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveView('lending')}
                        className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 cursor-pointer"
                      >
                        Manage Lending &amp; Received &rarr;
                      </button>
                    </div>
                  )}

                  {(() => {
                    const visibleWidgets = overviewLayout.layout.widgetOrder.filter(
                      (id) => !overviewLayout.hiddenWidgetSet.has(id)
                    );
                    if (visibleWidgets.length === 0) {
                      return (
                        <div className="bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-10 text-center space-y-3">
                          <p className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                            All Overview widgets are hidden
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                            Turn widgets back on or restore the default Overview layout to see your metrics, charts, and ledger.
                          </p>
                          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                            <button
                              type="button"
                              onClick={() => setCustomizeOverviewOpen(true)}
                              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-teal-700 text-white hover:bg-teal-800 inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5" />
                              <span>Customize Overview</span>
                            </button>
                            <button
                              type="button"
                              onClick={overviewLayout.resetLayout}
                              className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Restore Default Layout</span>
                            </button>
                          </div>
                        </div>
                      );
                    }

                    const renderedNodes: ReactNode[] = [];
                    for (let idx = 0; idx < visibleWidgets.length; idx += 1) {
                      const widgetId = visibleWidgets[idx];
                      const nextWidgetId = visibleWidgets[idx + 1];
                      if (
                        (widgetId === 'tagChart' && nextWidgetId === 'subTagChart') ||
                        (widgetId === 'subTagChart' && nextWidgetId === 'tagChart')
                      ) {
                        renderedNodes.push(
                          <div
                            key={`${widgetId}-${nextWidgetId}`}
                            className="grid grid-cols-1 lg:grid-cols-2 gap-6"
                          >
                            {renderOverviewWidget(widgetId)}
                            {renderOverviewWidget(nextWidgetId)}
                          </div>
                        );
                        idx += 1;
                      } else {
                        renderedNodes.push(renderOverviewWidget(widgetId));
                      }
                    }
                    return renderedNodes;
                  })()}
                </>
              )}

              {activeView === 'ledger' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-end gap-2.5">
                    <button
                      type="button"
                      disabled={expenses.length === 0 || exportingFullPdf}
                      onClick={handleDownloadFullLedgerPdf}
                      className="px-3.5 py-2 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/60 text-xs font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/60 inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                    >
                      {exportingFullPdf ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FileDown className="w-3.5 h-3.5" />
                      )}
                      <span>{exportingFullPdf ? 'Generating PDF...' : 'Export Full Ledger'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={filteredExpenses.length === 0}
                      onClick={handleExportCsv}
                      className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export CSV</span>
                    </button>
                  </div>
                  <ExpenseTable
                    expenses={filteredExpenses}
                    tags={tags}
                    members={members}
                    receivedByExpenseId={lendingSummary.receivedByExpenseId}
                    loading={expensesLoading}
                    hasActiveFilters={hasActiveFilters}
                    onClearFilters={() => setFilters(EMPTY_FILTERS)}
                    onEdit={(exp) => {
                      setEditingExpense(exp);
                      setExpenseInitialSplitMode(undefined);
                      setExpenseModalOpen(true);
                    }}
                    onDelete={(exp) => setConfirmDeleteExpense(exp)}
                    onRecordReceived={(exp) => {
                      setReceivedTargetExpense(exp);
                      setReceivedModalOpen(true);
                    }}
                    onAddFirst={() => {
                      setEditingExpense(null);
                      setExpenseInitialSplitMode(undefined);
                      setExpenseModalOpen(true);
                    }}
                  />
                </div>
              )}

              {activeView === 'splits' && (
                <SplitsBalancesView
                  projectName={activeProject.name}
                  currentUserUid={user.uid}
                  members={members}
                  expenses={expenses}
                  settlements={settlements}
                  onRecordSettlement={async (input) => {
                    await createSettlement(activeProject, user, input);
                  }}
                  onDeleteSettlement={async (settlementId) => {
                    await deleteSettlement(activeProject.id, settlementId);
                  }}
                  onAddSplitExpense={() => {
                    setEditingExpense(null);
                    setExpenseInitialSplitMode(undefined);
                    setExpenseModalOpen(true);
                  }}
                />
              )}

              {activeView === 'lending' && (
                <LendingAndCreditsView
                  projectName={activeProject.name}
                  expenses={expenses}
                  receivedMoney={receivedMoney}
                  onNewLendingExpense={() => {
                    setEditingExpense(null);
                    setExpenseInitialSplitMode('external');
                    setExpenseModalOpen(true);
                  }}
                  onEditExpense={(exp) => {
                    setEditingExpense(exp);
                    setExpenseInitialSplitMode(undefined);
                    setExpenseModalOpen(true);
                  }}
                  onRecordPaymentForExpense={(exp) => {
                    setReceivedTargetExpense(exp);
                    setReceivedModalOpen(true);
                  }}
                  onAddGeneralReceived={() => {
                    setReceivedTargetExpense(null);
                    setReceivedModalOpen(true);
                  }}
                  onDeleteReceivedMoney={async (receivedId) => {
                    await deleteReceivedMoney(activeProject.id, receivedId);
                  }}
                />
              )}

              {activeView === 'manage' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Tags Management */}
                  <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                          Project Tags
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          Create top-level parent tags or add child sub-tags under any existing tag
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTag(null);
                          setDefaultTagParent('');
                          setTagModalOpen(true);
                        }}
                        className="px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Create Tag</span>
                      </button>
                    </div>

                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {hierarchicalTags.map(({ tag, depth, childCount }) => (
                        <div
                          key={tag.id}
                          style={depth > 0 ? { paddingLeft: `${Math.min(depth, 3) * 20}px` } : undefined}
                          className="py-2.5 flex items-center justify-between gap-3 text-sm"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {depth > 0 && (
                              <CornerDownRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                            )}
                            <span
                              className="w-3.5 h-3.5 rounded-xs shrink-0"
                              style={{ backgroundColor: tag.color }}
                            />
                            <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                              {tag.name}
                            </span>
                            {childCount > 0 && (
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0 font-mono-tabular">
                                · {childCount} {childCount === 1 ? 'sub-tag' : 'sub-tags'}
                              </span>
                            )}
                            {depth === 0 && tag.parentCategory && (
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                · Sub-tag of {tag.parentCategory}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                            <span className="hidden sm:inline text-[11px] text-slate-400 dark:text-slate-500 mr-1">
                              {tag.isSystem ? 'System' : 'Custom'}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTag(null);
                                setDefaultTagParent(tag.name);
                                setTagModalOpen(true);
                              }}
                              aria-label={`Add child sub-tag under ${tag.name}`}
                              className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Child</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTag(tag);
                                setDefaultTagParent('');
                                setTagModalOpen(true);
                              }}
                              aria-label={`Edit tag ${tag.name}`}
                              className="p-1.5 rounded text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {!tag.isSystem && (
                              <button
                                type="button"
                                onClick={() => void deleteCustomTag(activeProject.id, tag.id)}
                                aria-label={`Delete tag ${tag.name}`}
                                className="p-1.5 rounded text-slate-400 dark:text-slate-500 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Members & Invitations */}
                  <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                          Collaborators
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          Invite members by Gmail address
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setInviteModalOpen(true)}
                        className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Invite</span>
                      </button>
                    </div>

                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {members.map((m) => (
                        <div key={m.uid} className="py-2.5 flex items-center justify-between gap-3">
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

                    {sentInvites.filter((i) => i.status === 'pending').length > 0 && (
                      <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
                        <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                          Awaiting Sign-In
                        </h3>
                        {sentInvites
                          .filter((i) => i.status === 'pending')
                          .map((inv) => (
                            <div
                              key={inv.id}
                              className="py-1.5 flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400"
                            >
                              <span className="truncate">{inv.invitedEmail}</span>
                              <button
                                type="button"
                                onClick={() => void revokeInvite(inv.id)}
                                className="text-red-600 dark:text-red-400 hover:underline cursor-pointer shrink-0"
                              >
                                Revoke
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Floating Quick-Add / AI Entry Button on Mobile & Desktop */}
      {activeProject && !aiDrawerOpen && (
        <button
          type="button"
          onClick={() => setAiDrawerOpen(true)}
          aria-label="Open AI Expense Chat"
          className="fixed bottom-5 right-5 z-30 h-12 px-4 rounded-full bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 border border-transparent dark:border-slate-700 text-white shadow-lg flex items-center gap-2 text-xs font-semibold transition-transform hover:scale-[1.02] cursor-pointer"
        >
          <MessageSquareText className="w-4 h-4 text-teal-400" />
          <span>Ask AI &middot; Log &amp; Chat</span>
        </button>
      )}

      {/* AI Expense Assistant Drawer */}
      {activeProject && (
        <AiExpenseDrawer
          key={activeProject.id}
          open={aiDrawerOpen}
          onClose={() => setAiDrawerOpen(false)}
          projectId={activeProject.id}
          projectName={activeProject.name}
          monthlyBudget={activeProject.monthlyBudget}
          existingExpenses={expenses}
          tags={tags}
          members={members}
          settlements={settlements}
          receivedMoney={receivedMoney}
          onConfirmSave={handleAiConfirmSave}
          onConfirmSaveBatch={handleAiConfirmSaveBatch}
        />
      )}

      {/* Modals */}
      {activeProject && (
        <ExpenseModal
          open={expenseModalOpen}
          onClose={() => {
            setExpenseModalOpen(false);
            setEditingExpense(null);
            setExpenseInitialSplitMode(undefined);
          }}
          editingExpense={editingExpense}
          initialSplitMode={expenseInitialSplitMode}
          project={activeProject}
          existingExpenses={expenses}
          members={members}
          tags={tags}
          currentUserUid={user.uid}
          onSubmit={handleSaveExpense}
        />
      )}

      {activeProject && (
        <ReceivedMoneyModal
          open={receivedModalOpen}
          onClose={() => {
            setReceivedModalOpen(false);
            setReceivedTargetExpense(null);
          }}
          projectName={activeProject.name}
          expenses={expenses}
          receivedMoney={receivedMoney}
          initialExpense={receivedTargetExpense}
          onSubmit={async (input) => {
            await createReceivedMoney(activeProject, user, input);
          }}
        />
      )}

      <ProjectModal
        open={projectModalOpen}
        onClose={() => {
          setProjectModalOpen(false);
          setEditingProject(null);
        }}
        editingProject={editingProject}
        onSubmit={async (name, description, monthlyBudget) => {
          if (editingProject) {
            await updateProjectDetails(editingProject.id, name, description, monthlyBudget);
          } else {
            const newId = await createProject(user, name, description, monthlyBudget);
            setActiveProjectId(newId);
            setFilters(EMPTY_FILTERS);
          }
        }}
      />

      {activeProject && (
        <InviteModal
          open={inviteModalOpen}
          onClose={() => setInviteModalOpen(false)}
          project={activeProject}
          members={members}
          sentInvites={sentInvites}
          onInvite={async (email) => {
            const res = await inviteMemberToProject(activeProject, user, email);
            return res.mode === 'added_directly'
              ? `${res.targetName} was added directly to ${activeProject.name}.`
              : `Invitation created for ${res.targetName}. It will link automatically when they sign in with Google.`;
          }}
          onRevokeInvite={revokeInvite}
        />
      )}

      {activeProject && (
        <TagModal
          open={tagModalOpen}
          onClose={() => {
            setTagModalOpen(false);
            setEditingTag(null);
            setDefaultTagParent('');
          }}
          tags={tags}
          defaultParentCategory={defaultTagParent}
          editingTag={editingTag}
          onSubmit={async (name, color, parentCategory) => {
            if (editingTag) {
              const previousName = editingTag.name;
              await updateTag(activeProject.id, editingTag.id, {
                name,
                color,
                parentCategory,
              });
              // Keep child tags linked if a parent tag was renamed
              if (previousName.trim() !== name.trim()) {
                const affectedChildren = tags.filter(
                  (t) =>
                    t.id !== editingTag.id &&
                    t.parentCategory.trim().toLowerCase() === previousName.trim().toLowerCase()
                );
                await Promise.all(
                  affectedChildren.map((child) =>
                    updateTag(activeProject.id, child.id, {
                      name: child.name,
                      color: child.color,
                      parentCategory: name.trim(),
                    })
                  )
                );
              }
            } else {
              await createCustomTag(activeProject, user, name, color, parentCategory);
            }
          }}
        />
      )}

      {/* Delete Expense Confirmation Dialog */}
      {confirmDeleteExpense && activeProject && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-slate-950/70 flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Delete Expense?
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Remove{' '}
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {confirmDeleteExpense.description || 'this expense'}
              </span>{' '}
              ({formatAmount(confirmDeleteExpense.amount)}
              {currency !== 'INR' ? ` / ${formatINR(confirmDeleteExpense.amount)}` : ''}) from{' '}
              {activeProject.name}?
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteExpense(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = confirmDeleteExpense;
                  setConfirmDeleteExpense(null);
                  await deleteExpense(activeProject.id, target.id);
                }}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Project Confirmation Dialog */}
      {confirmDeleteProject && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-slate-950/70 flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Delete Project?
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {confirmDeleteProject.name}
              </span>
              ?
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteProject(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = confirmDeleteProject;
                  setConfirmDeleteProject(null);
                  await deleteProject(target.id);
                }}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white cursor-pointer"
              >
                Delete Project
              </button>
            </div>
          </div>
        </div>
      )}
      <OverviewCustomizeModal
        open={customizeOverviewOpen}
        onClose={() => setCustomizeOverviewOpen(false)}
        layout={overviewLayout.layout}
        hiddenWidgetSet={overviewLayout.hiddenWidgetSet}
        hiddenMetricSet={overviewLayout.hiddenMetricSet}
        isCustomized={overviewLayout.isCustomized}
        onToggleWidget={overviewLayout.toggleWidget}
        onMoveWidget={overviewLayout.moveWidget}
        onStepWidget={overviewLayout.stepWidget}
        onToggleMetric={overviewLayout.toggleMetric}
        onMoveMetric={overviewLayout.moveMetric}
        onStepMetric={overviewLayout.stepMetric}
        onShowAll={overviewLayout.showAll}
        onResetLayout={overviewLayout.resetLayout}
      />
      <BudgetToastContainer
        toasts={budgetToasts}
        onDismiss={dismissBudgetToast}
        onInspectBudget={() => setActiveView('overview')}
      />
    </div>
  );
}
