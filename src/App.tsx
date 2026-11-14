import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  Check,
  Download,
  FolderPlus,
  LogOut,
  Menu,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  Tag as TagIcon,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { auth, googleAuthProvider } from './lib/firebase';
import { formatINR, getTodayISO } from './constants';
import {
  acceptInvite,
  createCustomTag,
  createExpense,
  createProject,
  createSettlement,
  declineInvite,
  deleteCustomTag,
  deleteExpense,
  deleteProject,
  deleteSettlement,
  inviteMemberToProject,
  logRecurringBillPayment,
  revokeInvite,
  skipRecurringBillCycle,
  subscribePendingInvites,
  subscribeProjectExpenses,
  subscribeProjectMembers,
  subscribeProjectSettlements,
  subscribeProjectTags,
  subscribeSentInvites,
  subscribeUserProjects,
  syncProjectMemberUidsIfNeeded,
  syncUserProfile,
  updateExpense,
  updateProjectBudget,
  updateProjectDetails,
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
import { evaluateRecurringBills } from './utils/recurringUtils';
import { computeEqualSplitShares, computeProjectBalances } from './utils/splitUtils';
import { AiExpenseDrawer } from './components/AiExpenseDrawer';
import { AnalyticsCharts } from './components/AnalyticsCharts';
import { AuthGate } from './components/AuthGate';
import { BudgetToastContainer } from './components/BudgetToastContainer';
import { ExpenseTable } from './components/ExpenseTable';
import { ExpenseModal, InviteModal, ProjectModal, TagModal } from './components/Modals';
import { MonthlyBudgetCard } from './components/MonthlyBudgetCard';
import { RecurringAlertsBanner } from './components/RecurringAlertsBanner';
import { SplitsBalancesView } from './components/SplitsBalancesView';
import { UserAvatar } from './components/UserAvatar';

type ActiveView = 'overview' | 'ledger' | 'splits' | 'manage';

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
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [tagModalOpen, setTagModalOpen] = useState(false);

  const [confirmDeleteExpense, setConfirmDeleteExpense] = useState<Expense | null>(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<Project | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [budgetToasts, setBudgetToasts] = useState<BudgetToastItem[]>([]);

  const [scheduleTickDate, setScheduleTickDate] = useState<string>(() => getTodayISO());
  const [lastScheduleCheck, setLastScheduleCheck] = useState<Date>(() => new Date());

  const bootstrappedUserRef = useRef<string | null>(null);

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

  // Subscribe to active project members, tags, expenses, settlements, sent invites
  useEffect(() => {
    if (!user || !activeProject) {
      setMembers([]);
      setTags([]);
      setExpenses([]);
      setSettlements([]);
      setSentInvites([]);
      return;
    }

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
      settlements
    );
  }, [user, activeProject, members, tags, expenses, settlements]);

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

  const currentUserNetBalance = useMemo(() => {
    if (!user) return 0;
    return balanceReport.memberBalances.find((b) => b.uid === user.uid)?.netBalance ?? 0;
  }, [balanceReport.memberBalances, user]);

  const filteredExpenses = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return expenses.filter((exp) => {
      if (q && !(exp.description || '').toLowerCase().includes(q)) return false;
      if (filters.memberUid !== 'all' && exp.paidByUid !== filters.memberUid) return false;
      if (filters.paymentMethod !== 'all' && exp.paymentMethod !== filters.paymentMethod) {
        return false;
      }
      if (
        filters.tagIds.length > 0 &&
        !filters.tagIds.some((tid) => exp.tagIds.includes(tid))
      ) {
        return false;
      }
      if (filters.startDate && exp.date < filters.startDate) return false;
      if (filters.endDate && exp.date > filters.endDate) return false;
      return true;
    });
  }, [expenses, filters]);

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
      });
      setBudgetToasts((prev) => [...prev.slice(-2), toast]);
    },
    []
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
  }) => {
    if (!user || !activeProject) return;
    const payer = members.find((m) => m.uid === data.paidByUid) ?? {
      uid: user.uid,
      displayName: user.displayName || user.email?.split('@')[0] || 'Member',
      photoURL: user.photoURL ?? '',
    };

    const currentMonthPrefix = getTodayISO().slice(0, 7);
    const previousSpend = metrics.thisMonthSpend;
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
      });
      notifyBudgetThresholdIfCrossed(
        activeProject,
        previousSpend,
        previousSpend - prevContribution + nextContribution
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

  const handleExportCsv = () => {
    if (!activeProject || filteredExpenses.length === 0) return;
    const tagMap = new Map(tags.map((t) => [t.id, t.name]));
    const rows = [
      [
        'Date',
        'Description',
        'Amount (INR)',
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

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm text-slate-500">Loading workspace...</div>
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileSidebarOpen && (
        <div
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden"
        />
      )}

      {/* Left Sidebar (260px) */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-40 h-screen w-[260px] shrink-0 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            KhataLedger
          </span>
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label="Close sidebar"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Projects Switcher */}
          <div className="space-y-2">
            <div className="px-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">Projects</span>
              <button
                type="button"
                onClick={() => {
                  setEditingProject(null);
                  setProjectModalOpen(true);
                }}
                aria-label="Create new project"
                className="p-1 rounded text-slate-500 hover:text-teal-700 hover:bg-slate-100 cursor-pointer"
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
                        ? 'bg-teal-50 text-teal-900 font-semibold'
                        : 'text-slate-700 hover:bg-slate-100'
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
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProject(proj);
                            setProjectModalOpen(true);
                          }}
                          aria-label={`Edit ${proj.name}`}
                          className="p-1 rounded text-slate-500 hover:text-slate-900 cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        {projects.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteProject(proj)}
                            aria-label={`Delete ${proj.name}`}
                            className="p-1 rounded text-slate-500 hover:text-red-700 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
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
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Project</span>
              </button>
            </div>
          </div>

          {/* Collaborators in Active Project */}
          {activeProject && (
            <div className="space-y-2.5 pt-4 border-t border-slate-200">
              <div className="px-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  Members ({members.length})
                </span>
                <button
                  type="button"
                  onClick={() => setInviteModalOpen(true)}
                  className="text-xs font-medium text-teal-700 hover:text-teal-800 inline-flex items-center gap-1 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Invite</span>
                </button>
              </div>
              <div className="space-y-1.5 px-2">
                {members.map((m) => (
                  <div key={m.uid} className="flex items-center gap-2.5 py-1">
                    <UserAvatar name={m.displayName} photoURL={m.photoURL} size="xs" />
                    <span className="text-xs font-medium text-slate-700 truncate flex-1">
                      {m.displayName}
                    </span>
                    <span className="text-[11px] text-slate-400 capitalize">{m.role}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending Incoming Invites */}
          {pendingInvites.length > 0 && (
            <div className="space-y-2 pt-4 border-t border-slate-200">
              <span className="px-2 text-xs font-semibold text-teal-800 block">
                Pending Invites ({pendingInvites.length})
              </span>
              <div className="space-y-2">
                {pendingInvites.map((inv) => (
                  <div
                    key={inv.id}
                    className="p-3 rounded-lg bg-teal-50/70 border border-teal-200 space-y-2"
                  >
                    <div className="text-xs">
                      <p className="font-semibold text-slate-900 truncate">{inv.projectName}</p>
                      <p className="text-slate-600 truncate">From {inv.invitedByName}</p>
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
                        className="py-1.5 px-2 rounded-md border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 cursor-pointer"
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

        {/* User Footer */}
        <div className="p-4 border-t border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <UserAvatar
              name={user.displayName || user.email || 'User'}
              photoURL={user.photoURL ?? ''}
              size="sm"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900 truncate">
                {user.displayName || 'Account'}
              </p>
              <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            aria-label="Sign out"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract (3 clean zones) */}
        <header className="sticky top-0 z-20 h-16 px-4 sm:px-6 lg:px-8 bg-white border-b border-slate-200 flex items-center justify-between gap-8">
          {/* Zone 1: Menu toggle (mobile) + Active Project Breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open projects menu"
              className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="font-display text-base font-bold text-slate-900 truncate">
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
                  ? 'border-teal-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setActiveView('ledger')}
              className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                activeView === 'ledger'
                  ? 'border-teal-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Ledger
            </button>
            <button
              type="button"
              onClick={() => setActiveView('splits')}
              className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                activeView === 'splits'
                  ? 'border-teal-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Balances
            </button>
            <button
              type="button"
              onClick={() => setActiveView('manage')}
              className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                activeView === 'manage'
                  ? 'border-teal-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Tags &amp; Members
            </button>
          </nav>

          {/* Zone 3: Primary Action */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={!activeProject}
              onClick={() => {
                setEditingExpense(null);
                setExpenseModalOpen(true);
              }}
              className="px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Expense</span>
            </button>
          </div>
        </header>

        {/* Mobile View Switcher */}
        <div className="md:hidden px-4 py-2 bg-white border-b border-slate-200 flex items-center gap-2 overflow-x-auto">
          {(
            [
              { id: 'overview', label: 'Overview' },
              { id: 'ledger', label: 'Ledger' },
              { id: 'splits', label: 'Balances' },
              { id: 'manage', label: 'Tags & Members' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveView(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                activeView === tab.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
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
              className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between gap-4"
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
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
              <h2 className="font-display text-lg font-bold text-slate-900">
                Create or accept a project to get started
              </h2>
              <p className="text-sm text-slate-600 max-w-md mx-auto">
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
                <p className="text-sm text-slate-600">
                  {activeProject.description || 'Shared project expense workspace'}
                </p>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setInviteModalOpen(true)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Invite Member</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTagModalOpen(true)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <TagIcon className="w-3.5 h-3.5" />
                    <span>New Tag</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiDrawerOpen(true)}
                    className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <MessageSquareText className="w-3.5 h-3.5" />
                    <span>AI Expense Chat</span>
                  </button>
                </div>
              </div>

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

              {/* 4-Column Metric Summary Strip */}
              <section
                aria-label="Project Summary Metrics"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
              >
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                  <span className="text-xs font-medium text-slate-500 block">
                    Total Spend {hasActiveFilters ? '(Filtered)' : ''}
                  </span>
                  <div className="font-mono-tabular text-2xl font-bold text-slate-900">
                    {formatINR(metrics.totalSpend)}
                  </div>
                  <span className="text-xs text-slate-500 font-mono-tabular block">
                    {filteredExpenses.length}{' '}
                    {filteredExpenses.length === 1 ? 'transaction' : 'transactions'}
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                  <span className="text-xs font-medium text-slate-500 block">This Month</span>
                  <div className="font-mono-tabular text-2xl font-bold text-slate-900">
                    {formatINR(metrics.thisMonthSpend)}
                  </div>
                  <span className="text-xs text-slate-500 font-mono-tabular block">
                    {activeProject.monthlyBudget
                      ? `of ${formatINR(activeProject.monthlyBudget)} cap`
                      : new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                  <span className="text-xs font-medium text-slate-500 block">Top Category</span>
                  <div className="font-display text-xl font-bold text-slate-900 truncate">
                    {metrics.topTagName}
                  </div>
                  <span className="text-xs text-slate-500 font-mono-tabular block">
                    {formatINR(metrics.topTagAmount)}
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                  <span className="text-xs font-medium text-slate-500 block">Top Method</span>
                  <div className="font-display text-xl font-bold text-slate-900 truncate">
                    {metrics.topMethod}
                  </div>
                  <span className="text-xs text-slate-500 font-mono-tabular block">
                    {formatINR(metrics.topMethodAmount)}
                  </span>
                </div>
              </section>

              {/* Dynamic Filter Bar (shown on Overview & Ledger) */}
              {(activeView === 'overview' || activeView === 'ledger') && (
                <section
                  aria-label="Expense Filters"
                  className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                    <div className="relative lg:col-span-2">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={filters.search}
                        onChange={(e) =>
                          setFilters((prev) => ({ ...prev, search: e.target.value }))
                        }
                        placeholder="Search descriptions..."
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-teal-600"
                      />
                    </div>

                    <select
                      aria-label="Filter by member"
                      value={filters.memberUid}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, memberUid: e.target.value }))
                      }
                      className="px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-800 bg-white focus:outline-none focus:border-teal-600"
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
                      className="px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-800 bg-white focus:outline-none focus:border-teal-600"
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
                      className="px-3 py-2 rounded-lg border border-slate-200 font-mono-tabular text-xs text-slate-800 focus:outline-none focus:border-teal-600"
                    />

                    <input
                      type="date"
                      aria-label="End date"
                      value={filters.endDate}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, endDate: e.target.value }))
                      }
                      className="px-3 py-2 rounded-lg border border-slate-200 font-mono-tabular text-xs text-slate-800 focus:outline-none focus:border-teal-600"
                    />
                  </div>

                  {/* Interactive Multi-Tag Filter Buttons */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-medium text-slate-500 mr-1">
                        Filter tags:
                      </span>
                      {tags.map((tag) => {
                        const active = filters.tagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => toggleFilterTag(tag.id)}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              active
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>

                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={() => setFilters(EMPTY_FILTERS)}
                        className="text-xs font-medium text-teal-700 hover:text-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Reset Filters
                      </button>
                    )}
                  </div>
                </section>
              )}

              {activeView === 'overview' && (
                <>
                  {(balanceReport.totalUnsettledAmount > 0 || Math.abs(currentUserNetBalance) > 0.009) && (
                    <div className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs sm:text-sm text-slate-700">
                        {currentUserNetBalance > 0.009 ? (
                          <span>
                            Your split balance:{' '}
                            <strong className="font-mono-tabular text-emerald-700">
                              You are owed {formatINR(currentUserNetBalance)}
                            </strong>
                          </span>
                        ) : currentUserNetBalance < -0.009 ? (
                          <span>
                            Your split balance:{' '}
                            <strong className="font-mono-tabular text-red-700">
                              You owe {formatINR(Math.abs(currentUserNetBalance))}
                            </strong>
                          </span>
                        ) : (
                          <span>
                            Unsettled group balance:{' '}
                            <strong className="font-mono-tabular text-slate-900">
                              {formatINR(balanceReport.totalUnsettledAmount)}
                            </strong>
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveView('splits')}
                        className="text-xs font-semibold text-teal-700 hover:text-teal-800 cursor-pointer"
                      >
                        View Balances &amp; Settle Up &rarr;
                      </button>
                    </div>
                  )}
                  <MonthlyBudgetCard
                    project={activeProject}
                    thisMonthSpend={metrics.thisMonthSpend}
                    onUpdateBudget={async (budget) => {
                      await updateProjectBudget(activeProject.id, budget);
                    }}
                  />
                  <AnalyticsCharts
                    expenses={filteredExpenses}
                    tags={tags}
                    timeframe={timeframe}
                    onTimeframeChange={setTimeframe}
                  />
                  <ExpenseTable
                    expenses={filteredExpenses}
                    tags={tags}
                    members={members}
                    loading={expensesLoading}
                    hasActiveFilters={hasActiveFilters}
                    onClearFilters={() => setFilters(EMPTY_FILTERS)}
                    onEdit={(exp) => {
                      setEditingExpense(exp);
                      setExpenseModalOpen(true);
                    }}
                    onDelete={(exp) => setConfirmDeleteExpense(exp)}
                    onAddFirst={() => {
                      setEditingExpense(null);
                      setExpenseModalOpen(true);
                    }}
                  />
                </>
              )}

              {activeView === 'ledger' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      disabled={filteredExpenses.length === 0}
                      onClick={handleExportCsv}
                      className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export CSV</span>
                    </button>
                  </div>
                  <ExpenseTable
                    expenses={filteredExpenses}
                    tags={tags}
                    members={members}
                    loading={expensesLoading}
                    hasActiveFilters={hasActiveFilters}
                    onClearFilters={() => setFilters(EMPTY_FILTERS)}
                    onEdit={(exp) => {
                      setEditingExpense(exp);
                      setExpenseModalOpen(true);
                    }}
                    onDelete={(exp) => setConfirmDeleteExpense(exp)}
                    onAddFirst={() => {
                      setEditingExpense(null);
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
                    setExpenseModalOpen(true);
                  }}
                />
              )}

              {activeView === 'manage' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Tags Management */}
                  <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h2 className="font-display text-base font-bold text-slate-900">
                          Project Tags
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Seeded system categories and custom tags for {activeProject.name}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setTagModalOpen(true)}
                        className="px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Create Custom Tag</span>
                      </button>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {tags.map((tag) => (
                        <div
                          key={tag.id}
                          className="py-2.5 flex items-center justify-between gap-3 text-sm"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span
                              className="w-3.5 h-3.5 rounded-xs shrink-0"
                              style={{ backgroundColor: tag.color }}
                            />
                            <span className="font-medium text-slate-900 truncate">{tag.name}</span>
                            {tag.parentCategory && (
                              <span className="text-xs text-slate-500">
                                · Sub-tag of {tag.parentCategory}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs text-slate-400">
                              {tag.isSystem ? 'System' : 'Custom'}
                            </span>
                            {!tag.isSystem && (
                              <button
                                type="button"
                                onClick={() => void deleteCustomTag(activeProject.id, tag.id)}
                                aria-label={`Delete tag ${tag.name}`}
                                className="p-1.5 rounded text-slate-400 hover:text-red-700 hover:bg-red-50 cursor-pointer"
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
                  <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h2 className="font-display text-base font-bold text-slate-900">
                          Collaborators
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Invite members by Gmail address
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setInviteModalOpen(true)}
                        className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Invite</span>
                      </button>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {members.map((m) => (
                        <div key={m.uid} className="py-2.5 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <UserAvatar name={m.displayName} photoURL={m.photoURL} size="sm" />
                            <span className="text-sm font-medium text-slate-900 truncate">
                              {m.displayName}
                            </span>
                          </div>
                          <span className="text-xs text-slate-500 capitalize shrink-0">
                            {m.role}
                          </span>
                        </div>
                      ))}
                    </div>

                    {sentInvites.filter((i) => i.status === 'pending').length > 0 && (
                      <div className="pt-4 border-t border-slate-200 space-y-2">
                        <h3 className="text-xs font-semibold text-slate-600">
                          Awaiting Sign-In
                        </h3>
                        {sentInvites
                          .filter((i) => i.status === 'pending')
                          .map((inv) => (
                            <div
                              key={inv.id}
                              className="py-1.5 flex items-center justify-between gap-2 text-xs text-slate-600"
                            >
                              <span className="truncate">{inv.invitedEmail}</span>
                              <button
                                type="button"
                                onClick={() => void revokeInvite(inv.id)}
                                className="text-red-600 hover:underline cursor-pointer shrink-0"
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
          className="fixed bottom-5 right-5 z-30 h-12 px-4 rounded-full bg-slate-900 hover:bg-slate-800 text-white shadow-lg flex items-center gap-2 text-xs font-semibold transition-transform hover:scale-[1.02] cursor-pointer"
        >
          <MessageSquareText className="w-4 h-4 text-teal-400" />
          <span>Ask AI to Log Expense</span>
        </button>
      )}

      {/* AI Expense Assistant Drawer */}
      {activeProject && (
        <AiExpenseDrawer
          open={aiDrawerOpen}
          onClose={() => setAiDrawerOpen(false)}
          projectName={activeProject.name}
          tags={tags}
          members={members}
          onConfirmSave={handleAiConfirmSave}
        />
      )}

      {/* Modals */}
      {activeProject && (
        <ExpenseModal
          open={expenseModalOpen}
          onClose={() => {
            setExpenseModalOpen(false);
            setEditingExpense(null);
          }}
          editingExpense={editingExpense}
          project={activeProject}
          members={members}
          tags={tags}
          currentUserUid={user.uid}
          onSubmit={handleSaveExpense}
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
          onClose={() => setTagModalOpen(false)}
          onSubmit={async (name, color, parentCategory) => {
            await createCustomTag(activeProject, user, name, color, parentCategory);
          }}
        />
      )}

      {/* Delete Expense Confirmation Dialog */}
      {confirmDeleteExpense && activeProject && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900">Delete Expense?</h3>
            <p className="text-sm text-slate-600">
              Remove{' '}
              <span className="font-semibold text-slate-900">
                {confirmDeleteExpense.description || 'this expense'}
              </span>{' '}
              ({formatINR(confirmDeleteExpense.amount)}) from {activeProject.name}?
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteExpense(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
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
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900">Delete Project?</h3>
            <p className="text-sm text-slate-600">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-slate-900">{confirmDeleteProject.name}</span>?
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteProject(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
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
      <BudgetToastContainer
        toasts={budgetToasts}
        onDismiss={dismissBudgetToast}
        onInspectBudget={() => setActiveView('overview')}
      />
    </div>
  );
}
