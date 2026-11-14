import { auth } from '../lib/firebase';
import { getTodayISO } from '../constants';
import type { ParsedExpenseDraft, ProjectMember, Tag } from '../types';

export async function parseExpenseWithAI(
  message: string,
  tags: Tag[],
  members: ProjectMember[]
): Promise<ParsedExpenseDraft> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must be signed in to use the AI expense assistant.');
  }

  const idToken = await user.getIdToken();
  const response = await fetch('/api/ai/parse-expense', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      message,
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

  const payload = (await response.json()) as ParsedExpenseDraft & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to parse expense message.');
  }
  return payload;
}
