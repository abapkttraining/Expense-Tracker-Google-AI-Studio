import { auth } from '../lib/firebase';
import { getTodayISO } from '../constants';
import type {
  Expense,
  ParsedExpenseBatchResponse,
  ProjectChatResponse,
  ProjectChatTurn,
  ProjectMember,
  ReceivedMoney,
  Settlement,
  Tag,
} from '../types';

export interface AiExpenseAttachmentPayload {
  mimeType: string;
  data: string; // raw base64 without data: prefix
  fileName?: string;
}

export type AiExpenseImagePayload = AiExpenseAttachmentPayload;

export async function parseExpenseWithAI(
  input: {
    message?: string;
    image?: AiExpenseAttachmentPayload;
    attachment?: AiExpenseAttachmentPayload;
  },
  tags: Tag[],
  members: ProjectMember[]
): Promise<ParsedExpenseBatchResponse> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must be signed in to use the AI expense assistant.');
  }

  const idToken = await user.getIdToken();
  const attachment = input.attachment ?? input.image;

  const response = await fetch('/api/ai/parse-expense', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      message: input.message ?? '',
      attachment,
      todayDate: getTodayISO(),
      currentUserUid: user.uid,
      tags: tags.map((t) => ({
        id: t.id,
        name: t.name,
        parentCategory: t.parentCategory || undefined,
      })),
      members: members.map((m) => ({
        uid: m.uid,
        displayName: m.displayName,
      })),
    }),
  });

  const rawText = await response.text();
  let payload: (ParsedExpenseBatchResponse & { error?: string }) | null = null;
  try {
    payload = JSON.parse(rawText) as ParsedExpenseBatchResponse & { error?: string };
  } catch {
    payload = null;
  }

  if (!response.ok || !payload) {
    throw new Error(
      payload?.error ||
        (response.status === 413
          ? 'Attached file is too large for upload. Please try a smaller PDF or screenshot.'
          : 'Failed to parse expense.')
    );
  }
  return payload;
}

export async function askProjectChatbot(input: {
  projectId: string;
  projectName: string;
  monthlyBudget?: number;
  question: string;
  history: ProjectChatTurn[];
  displayCurrency?: string;
  expenses: Expense[];
  tags: Tag[];
  members: ProjectMember[];
  settlements: Settlement[];
  receivedMoney: ReceivedMoney[];
}): Promise<ProjectChatResponse> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must be signed in to use the AI project assistant.');
  }

  const idToken = await user.getIdToken();

  const response = await fetch('/api/ai/project-chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      projectId: input.projectId,
      projectName: input.projectName,
      monthlyBudget: input.monthlyBudget,
      question: input.question,
      history: input.history,
      todayDate: getTodayISO(),
      displayCurrency: input.displayCurrency ?? 'INR',
      expenses: input.expenses.map((e) => ({
        id: e.id,
        amount: e.amount,
        date: e.date,
        description: e.description,
        paidByUid: e.paidByUid,
        paidByName: e.paidByName,
        paymentMethod: e.paymentMethod,
        tagIds: e.tagIds,
        isRecurring: e.isRecurring,
        frequency: e.frequency,
        nextDueDate: e.nextDueDate,
        splitMode: e.splitMode,
        splitShares: e.splitShares,
        externalTotalPeople: e.externalTotalPeople,
        externalLabel: e.externalLabel,
      })),
      tags: input.tags.map((t) => ({
        id: t.id,
        name: t.name,
        parentCategory: t.parentCategory || undefined,
      })),
      members: input.members.map((m) => ({
        uid: m.uid,
        displayName: m.displayName,
      })),
      settlements: input.settlements.map((s) => ({
        fromName: s.fromName,
        toName: s.toName,
        amount: s.amount,
        date: s.date,
        paymentMethod: s.paymentMethod,
      })),
      receivedMoney: input.receivedMoney.map((r) => ({
        amount: r.amount,
        date: r.date,
        source: r.source,
        paymentMethod: r.paymentMethod,
        linkedExpenseId: r.linkedExpenseId,
        note: r.note,
      })),
    }),
  });

  const rawText = await response.text();
  let payload: (ProjectChatResponse & { error?: string }) | null = null;
  try {
    payload = JSON.parse(rawText) as ProjectChatResponse & { error?: string };
  } catch {
    payload = null;
  }

  if (!response.ok || !payload) {
    throw new Error(payload?.error || 'Failed to get response from Gemini assistant.');
  }
  return payload;
}
