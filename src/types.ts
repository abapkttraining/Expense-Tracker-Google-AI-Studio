export const PAYMENT_METHODS = [
  'PhonePe',
  'Google Pay (GPay)',
  'BHIM UPI',
  'Paytm',
  'Debit Card',
  'Credit Card',
  'Cash',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const RECURRING_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;

export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export const SPLIT_MODES = ['none', 'equal', 'exact', 'percentage'] as const;

export type SplitMode = (typeof SPLIT_MODES)[number];

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  memberUids: string[];
  currency: 'INR';
  monthlyBudget?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ProjectMember {
  uid: string;
  displayName: string;
  photoURL: string;
  role: 'owner' | 'member';
  inviteId?: string;
  projectMemberUids: string[];
  joinedAt?: unknown;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  parentCategory: string;
  isSystem: boolean;
  createdByUid: string;
  projectMemberUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Expense {
  id: string;
  amount: number;
  date: string; // YYYY-MM-DD
  description: string;
  paidByUid: string;
  paidByName: string;
  paidByPhoto: string;
  paymentMethod: PaymentMethod;
  tagIds: string[];
  createdByUid: string;
  projectMemberUids: string[];
  source: 'manual' | 'ai_chat';
  isRecurring?: boolean;
  frequency?: RecurringFrequency;
  nextDueDate?: string; // YYYY-MM-DD
  splitMode?: SplitMode;
  splitShares?: Record<string, number>;
  splitPercentages?: Record<string, number>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Settlement {
  id: string;
  fromUid: string;
  fromName: string;
  fromPhoto: string;
  toUid: string;
  toName: string;
  toPhoto: string;
  amount: number;
  date: string; // YYYY-MM-DD
  paymentMethod: PaymentMethod;
  note?: string;
  createdByUid: string;
  projectMemberUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Invite {
  id: string;
  projectId: string;
  projectName: string;
  invitedEmail: string;
  invitedByUid: string;
  invitedByName: string;
  status: 'pending' | 'accepted' | 'declined';
  acceptedByUid?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ParsedExpenseDraft {
  amount: number;
  description: string;
  paymentMethod: PaymentMethod;
  date: string;
  matchedTagIds: string[];
  paidByUid: string;
  isRecurring?: boolean;
  frequency?: RecurringFrequency;
  splitMode?: SplitMode;
  assistantReply: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ExpenseFilters {
  search: string;
  memberUid: string;
  paymentMethod: string;
  tagIds: string[];
  startDate: string;
  endDate: string;
}

export type Timeframe = 'daily' | 'weekly' | 'monthly' | 'yearly';
