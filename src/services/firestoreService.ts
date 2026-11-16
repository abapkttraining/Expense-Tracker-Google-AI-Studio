import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { DEFAULT_SYSTEM_TAGS, getTodayISO } from '../constants';
import { addFrequencyToDate } from '../utils/recurringUtils';
import type {
  Expense,
  Invite,
  PaymentMethod,
  Project,
  ProjectMember,
  ReceivedMoney,
  RecurringFrequency,
  Settlement,
  SplitMode,
  Tag,
} from '../types';

const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
} as const;

type OperationTypeValue = (typeof OperationType)[keyof typeof OperationType];

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationTypeValue;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{
      providerId?: string | null;
      email?: string | null;
    }>;
  };
}

function handleFirestoreError(
  error: unknown,
  operationType: OperationTypeValue,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function sha256Hex(input: string): Promise<string> {
  const normalized = input.trim().toLowerCase();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128);
}

export async function syncUserProfile(user: User): Promise<void> {
  const email = (user.email ?? '').trim().toLowerCase();
  const displayName = (user.displayName || email.split('@')[0] || 'User').slice(0, 100);
  const photoURL = (user.photoURL ?? '').slice(0, 500);

  const userPath = `users/${user.uid}`;
  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email,
        displayName,
        photoURL,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        email,
        displayName,
        photoURL,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  if (email) {
    const emailHash = await sha256Hex(email);
    const indexPath = `userEmailIndex/${emailHash}`;
    try {
      const indexRef = doc(db, 'userEmailIndex', emailHash);
      const indexSnap = await getDoc(indexRef);
      if (!indexSnap.exists()) {
        await setDoc(indexRef, {
          uid: user.uid,
          displayName,
          photoURL,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(indexRef, {
          displayName,
          photoURL,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, indexPath);
    }
  }
}

export async function createProject(
  user: User,
  name: string,
  description: string,
  monthlyBudget?: number | null
): Promise<string> {
  const projectRef = doc(collection(db, 'projects'));
  const projectId = projectRef.id;
  const displayName = (user.displayName || user.email?.split('@')[0] || 'Member').slice(0, 100);
  const photoURL = (user.photoURL ?? '').slice(0, 500);

  const projectPayload: Record<string, unknown> = {
    name: name.trim().slice(0, 80),
    description: description.trim().slice(0, 240),
    ownerId: user.uid,
    memberUids: [user.uid],
    currency: 'INR',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (typeof monthlyBudget === 'number' && Number.isFinite(monthlyBudget) && monthlyBudget > 0) {
    projectPayload.monthlyBudget = Math.round(monthlyBudget * 100) / 100;
  }

  try {
    const batch = writeBatch(db);
    batch.set(projectRef, projectPayload);

    const memberRef = doc(db, 'projects', projectId, 'members', user.uid);
    batch.set(memberRef, {
      uid: user.uid,
      displayName,
      photoURL,
      role: 'owner',
      projectMemberUids: [user.uid],
      joinedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `projects/${projectId}`);
  }

  // Seed default system tags right after project & owner member doc commit
  try {
    const tagBatch = writeBatch(db);
    for (const tagDef of DEFAULT_SYSTEM_TAGS) {
      const tagRef = doc(db, 'projects', projectId, 'tags', tagDef.id);
      tagBatch.set(tagRef, {
        name: tagDef.name,
        color: tagDef.color,
        parentCategory: tagDef.parentCategory,
        isSystem: true,
        createdByUid: user.uid,
        projectMemberUids: [user.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await tagBatch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `projects/${projectId}/tags`);
  }

  return projectId;
}

export async function updateProjectDetails(
  projectId: string,
  name: string,
  description: string,
  monthlyBudget?: number | null
): Promise<void> {
  const path = `projects/${projectId}`;
  const hasValidBudget =
    typeof monthlyBudget === 'number' && Number.isFinite(monthlyBudget) && monthlyBudget > 0;

  const updates: Record<string, unknown> = {
    name: name.trim().slice(0, 80),
    description: description.trim().slice(0, 240),
    updatedAt: serverTimestamp(),
  };

  if (monthlyBudget !== undefined) {
    updates.monthlyBudget = hasValidBudget
      ? Math.round(monthlyBudget * 100) / 100
      : deleteField();
  }

  try {
    await updateDoc(doc(db, 'projects', projectId), updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateProjectBudget(
  projectId: string,
  monthlyBudget: number | null
): Promise<void> {
  const path = `projects/${projectId}`;
  const hasValidBudget =
    typeof monthlyBudget === 'number' && Number.isFinite(monthlyBudget) && monthlyBudget > 0;
  try {
    await updateDoc(doc(db, 'projects', projectId), {
      monthlyBudget: hasValidBudget ? Math.round(monthlyBudget * 100) / 100 : deleteField(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteProject(projectId: string): Promise<void> {
  const path = `projects/${projectId}`;
  try {
    await deleteDoc(doc(db, 'projects', projectId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeUserProjects(
  uid: string,
  onData: (projects: Project[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = 'projects';
  const q = query(collection(db, 'projects'), where('memberUids', 'array-contains', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: Project[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Project, 'id'>),
      }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeProjectMembers(
  projectId: string,
  uid: string,
  onData: (members: ProjectMember[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `projects/${projectId}/members`;
  const q = query(
    collection(db, 'projects', projectId, 'members'),
    where('projectMemberUids', 'array-contains', uid)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list: ProjectMember[] = snapshot.docs.map((d) => d.data() as ProjectMember);
      list.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.displayName.localeCompare(b.displayName)));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeProjectTags(
  projectId: string,
  uid: string,
  onData: (tags: Tag[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `projects/${projectId}/tags`;
  const q = query(
    collection(db, 'projects', projectId, 'tags'),
    where('projectMemberUids', 'array-contains', uid)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list: Tag[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Tag, 'id'>),
      }));
      list.sort((a, b) => {
        if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeProjectExpenses(
  projectId: string,
  uid: string,
  onData: (expenses: Expense[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `projects/${projectId}/expenses`;
  const q = query(
    collection(db, 'projects', projectId, 'expenses'),
    where('projectMemberUids', 'array-contains', uid),
    orderBy('date', 'desc')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list: Expense[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Expense, 'id'>),
      }));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeProjectSettlements(
  projectId: string,
  uid: string,
  onData: (settlements: Settlement[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `projects/${projectId}/settlements`;
  const q = query(
    collection(db, 'projects', projectId, 'settlements'),
    where('projectMemberUids', 'array-contains', uid),
    orderBy('date', 'desc')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list: Settlement[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Settlement, 'id'>),
      }));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeProjectReceivedMoney(
  projectId: string,
  uid: string,
  onData: (items: ReceivedMoney[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `projects/${projectId}/receivedMoney`;
  const q = query(
    collection(db, 'projects', projectId, 'receivedMoney'),
    where('projectMemberUids', 'array-contains', uid),
    orderBy('date', 'desc')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list: ReceivedMoney[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ReceivedMoney, 'id'>),
      }));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribePendingInvites(
  email: string,
  onData: (invites: Invite[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const normalized = email.trim().toLowerCase();
  const path = 'invites';
  const q = query(
    collection(db, 'invites'),
    where('invitedEmail', '==', normalized),
    where('status', '==', 'pending')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list: Invite[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Invite, 'id'>),
      }));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeSentInvites(
  projectId: string,
  uid: string,
  onData: (invites: Invite[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = 'invites';
  const q = query(
    collection(db, 'invites'),
    where('invitedByUid', '==', uid),
    where('projectId', '==', projectId)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list: Invite[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Invite, 'id'>),
      }));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export async function inviteMemberToProject(
  project: Project,
  inviter: User,
  rawEmail: string
): Promise<{ mode: 'added_directly' | 'pending_invite'; targetName: string }> {
  const email = rawEmail.trim().toLowerCase();
  const inviterName = (inviter.displayName || inviter.email?.split('@')[0] || 'Collaborator').slice(
    0,
    100
  );

  if (project.memberUids.length >= 25) {
    throw new Error('This project has reached the maximum of 25 collaborators.');
  }

  const emailHash = await sha256Hex(email);
  const indexSnap = await getDoc(doc(db, 'userEmailIndex', emailHash));

  if (indexSnap.exists() && project.ownerId === inviter.uid) {
    const target = indexSnap.data() as {
      uid: string;
      displayName: string;
      photoURL: string;
    };

    if (project.memberUids.includes(target.uid)) {
      throw new Error(`${target.displayName} is already a member of this project.`);
    }

    const updatedMemberUids = Array.from(new Set([...project.memberUids, target.uid]));

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'projects', project.id), {
        memberUids: updatedMemberUids,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'projects', project.id, 'members', target.uid), {
        uid: target.uid,
        displayName: target.displayName.slice(0, 100),
        photoURL: (target.photoURL ?? '').slice(0, 500),
        role: 'member',
        projectMemberUids: updatedMemberUids,
        joinedAt: serverTimestamp(),
      });

      const [membersSnap, tagsSnap, expensesSnap, settlementsSnap, receivedSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'projects', project.id, 'members'),
            where('projectMemberUids', 'array-contains', inviter.uid)
          )
        ),
        getDocs(
          query(
            collection(db, 'projects', project.id, 'tags'),
            where('projectMemberUids', 'array-contains', inviter.uid)
          )
        ),
        getDocs(
          query(
            collection(db, 'projects', project.id, 'expenses'),
            where('projectMemberUids', 'array-contains', inviter.uid)
          )
        ),
        getDocs(
          query(
            collection(db, 'projects', project.id, 'settlements'),
            where('projectMemberUids', 'array-contains', inviter.uid)
          )
        ),
        getDocs(
          query(
            collection(db, 'projects', project.id, 'receivedMoney'),
            where('projectMemberUids', 'array-contains', inviter.uid)
          )
        ),
      ]);

      membersSnap.docs.forEach((d) => {
        batch.update(d.ref, { projectMemberUids: updatedMemberUids });
      });
      tagsSnap.docs.forEach((d) => {
        batch.update(d.ref, { projectMemberUids: updatedMemberUids, updatedAt: serverTimestamp() });
      });
      expensesSnap.docs.forEach((d) => {
        batch.update(d.ref, { projectMemberUids: updatedMemberUids, updatedAt: serverTimestamp() });
      });
      settlementsSnap.docs.forEach((d) => {
        batch.update(d.ref, { projectMemberUids: updatedMemberUids, updatedAt: serverTimestamp() });
      });
      receivedSnap.docs.forEach((d) => {
        batch.update(d.ref, { projectMemberUids: updatedMemberUids, updatedAt: serverTimestamp() });
      });

      await batch.commit();
      return { mode: 'added_directly', targetName: target.displayName };
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `projects/${project.id}/members`);
    }
  }

  // Pending invite flow (also works when non-owner invites or user hasn't logged in yet)
  const inviteId = sanitizeId(`${project.id}-${emailHash.slice(0, 20)}`);
  const inviteRef = doc(db, 'invites', inviteId);
  try {
    await setDoc(inviteRef, {
      projectId: project.id,
      projectName: project.name.slice(0, 80),
      invitedEmail: email,
      invitedByUid: inviter.uid,
      invitedByName: inviterName,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { mode: 'pending_invite', targetName: email };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `invites/${inviteId}`);
  }
}

export async function acceptInvite(invite: Invite, user: User): Promise<void> {
  const displayName = (user.displayName || user.email?.split('@')[0] || 'Member').slice(0, 100);
  const photoURL = (user.photoURL ?? '').slice(0, 500);

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'projects', invite.projectId, 'members', user.uid), {
      uid: user.uid,
      displayName,
      photoURL,
      role: 'member',
      inviteId: invite.id,
      projectMemberUids: [user.uid],
      joinedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'invites', invite.id), {
      status: 'accepted',
      acceptedByUid: user.uid,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'projects', invite.projectId), {
      memberUids: arrayUnion(user.uid),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `invites/${invite.id}`);
  }
}

export async function declineInvite(invite: Invite): Promise<void> {
  try {
    await updateDoc(doc(db, 'invites', invite.id), {
      status: 'declined',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `invites/${invite.id}`);
  }
}

export async function revokeInvite(inviteId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'invites', inviteId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `invites/${inviteId}`);
  }
}

export async function syncProjectMemberUidsIfNeeded(
  project: Project,
  currentUid: string,
  members: ProjectMember[],
  tags: Tag[],
  expenses: Expense[],
  settlements: Settlement[] = [],
  receivedMoney: ReceivedMoney[] = []
): Promise<void> {
  const expected = [...project.memberUids].sort();
  const matches = (arr: string[]) => {
    if (arr.length !== expected.length) return false;
    const sorted = [...arr].sort();
    return sorted.every((val, idx) => val === expected[idx]);
  };

  const staleMembers = members.filter((m) => !matches(m.projectMemberUids || []));
  const staleTags = tags.filter((t) => !matches(t.projectMemberUids || []));
  const staleExpenses = expenses.filter((e) => !matches(e.projectMemberUids || []));
  const staleSettlements = settlements.filter((s) => !matches(s.projectMemberUids || []));
  const staleReceived = receivedMoney.filter((r) => !matches(r.projectMemberUids || []));

  if (
    staleMembers.length === 0 &&
    staleTags.length === 0 &&
    staleExpenses.length === 0 &&
    staleSettlements.length === 0 &&
    staleReceived.length === 0
  ) {
    return;
  }

  try {
    const batch = writeBatch(db);
    let count = 0;
    for (const m of staleMembers) {
      if (count >= 400) break;
      batch.update(doc(db, 'projects', project.id, 'members', m.uid), {
        projectMemberUids: project.memberUids,
      });
      count++;
    }
    for (const t of staleTags) {
      if (count >= 400) break;
      batch.update(doc(db, 'projects', project.id, 'tags', t.id), {
        projectMemberUids: project.memberUids,
        updatedAt: serverTimestamp(),
      });
      count++;
    }
    for (const e of staleExpenses) {
      if (count >= 400) break;
      batch.update(doc(db, 'projects', project.id, 'expenses', e.id), {
        projectMemberUids: project.memberUids,
        updatedAt: serverTimestamp(),
      });
      count++;
    }
    for (const s of staleSettlements) {
      if (count >= 400) break;
      batch.update(doc(db, 'projects', project.id, 'settlements', s.id), {
        projectMemberUids: project.memberUids,
        updatedAt: serverTimestamp(),
      });
      count++;
    }
    for (const r of staleReceived) {
      if (count >= 400) break;
      batch.update(doc(db, 'projects', project.id, 'receivedMoney', r.id), {
        projectMemberUids: project.memberUids,
        updatedAt: serverTimestamp(),
      });
      count++;
    }
    if (count > 0 && project.memberUids.includes(currentUid)) {
      await batch.commit();
    }
  } catch (error) {
    console.warn('Background member sync deferred:', error);
  }
}

export async function createCustomTag(
  project: Project,
  user: User,
  name: string,
  color: string,
  parentCategory = ''
): Promise<string> {
  const slug = sanitizeId(
    `${name.trim().toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 6)}`
  );
  const path = `projects/${project.id}/tags/${slug}`;
  try {
    await setDoc(doc(db, 'projects', project.id, 'tags', slug), {
      name: name.trim().slice(0, 40),
      color,
      parentCategory: parentCategory.trim().slice(0, 40),
      isSystem: false,
      createdByUid: user.uid,
      projectMemberUids: project.memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return slug;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateTag(
  projectId: string,
  tagId: string,
  updates: { name: string; color: string; parentCategory: string }
): Promise<void> {
  const path = `projects/${projectId}/tags/${tagId}`;
  try {
    await updateDoc(doc(db, 'projects', projectId, 'tags', tagId), {
      name: updates.name.trim().slice(0, 40),
      color: updates.color,
      parentCategory: updates.parentCategory.trim().slice(0, 40),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteCustomTag(projectId: string, tagId: string): Promise<void> {
  const path = `projects/${projectId}/tags/${tagId}`;
  try {
    await deleteDoc(doc(db, 'projects', projectId, 'tags', tagId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface ExpenseInput {
  amount: number;
  date: string;
  description: string;
  paidByUid: string;
  paidByName: string;
  paidByPhoto: string;
  paymentMethod: PaymentMethod;
  tagIds: string[];
  source: 'manual' | 'ai_chat';
  isRecurring?: boolean;
  frequency?: RecurringFrequency;
  nextDueDate?: string;
  splitMode?: SplitMode;
  splitShares?: Record<string, number>;
  splitPercentages?: Record<string, number>;
  externalTotalPeople?: number;
  externalIncludeSelf?: boolean;
  externalLabel?: string;
}

function cleanNumericMap(map: Record<string, number> | undefined): Record<string, number> | undefined {
  if (!map) return undefined;
  const cleaned: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    if (k && typeof v === 'number' && Number.isFinite(v) && v > 0) {
      cleaned[k] = Math.round(v * 100) / 100;
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export async function createExpense(
  project: Project,
  user: User,
  input: ExpenseInput
): Promise<string> {
  const expenseRef = doc(collection(db, 'projects', project.id, 'expenses'));
  const path = `projects/${project.id}/expenses/${expenseRef.id}`;
  const isRecurring = Boolean(input.isRecurring);
  const frequency = isRecurring ? input.frequency ?? 'monthly' : undefined;
  const nextDueDate =
    isRecurring && frequency
      ? input.nextDueDate || addFrequencyToDate(input.date, frequency)
      : undefined;

  const splitMode: SplitMode = input.splitMode ?? 'none';
  const isExternalSplit = splitMode === 'external';
  const cleanedShares =
    splitMode !== 'none' && !isExternalSplit ? cleanNumericMap(input.splitShares) : undefined;
  const cleanedPercentages =
    splitMode === 'percentage' ? cleanNumericMap(input.splitPercentages) : undefined;
  const externalTotalPeople = isExternalSplit
    ? Math.max(1, Math.min(50, Math.round(input.externalTotalPeople ?? 2)))
    : undefined;
  const externalIncludeSelf = isExternalSplit
    ? externalTotalPeople === 1
      ? false
      : Boolean(input.externalIncludeSelf ?? true)
    : undefined;
  const externalLabel = isExternalSplit ? input.externalLabel?.trim().slice(0, 100) : undefined;

  const effectiveSplitMode: SplitMode = isExternalSplit
    ? 'external'
    : cleanedShares
      ? splitMode
      : 'none';

  const payload: Record<string, unknown> = {
    amount: Math.round(input.amount * 100) / 100,
    date: input.date,
    description: input.description.trim().slice(0, 200),
    paidByUid: input.paidByUid,
    paidByName: input.paidByName.slice(0, 100),
    paidByPhoto: (input.paidByPhoto ?? '').slice(0, 500),
    paymentMethod: input.paymentMethod,
    tagIds: input.tagIds.slice(0, 10),
    createdByUid: user.uid,
    projectMemberUids: project.memberUids,
    source: input.source,
    isRecurring,
    splitMode: effectiveSplitMode,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (isRecurring && frequency && nextDueDate) {
    payload.frequency = frequency;
    payload.nextDueDate = nextDueDate;
  }
  if (cleanedShares) {
    payload.splitShares = cleanedShares;
  }
  if (cleanedPercentages) {
    payload.splitPercentages = cleanedPercentages;
  }
  if (isExternalSplit && externalTotalPeople !== undefined) {
    payload.externalTotalPeople = externalTotalPeople;
    payload.externalIncludeSelf = externalIncludeSelf;
    if (externalLabel) {
      payload.externalLabel = externalLabel;
    }
  }

  try {
    await setDoc(expenseRef, payload);
    return expenseRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateExpense(
  project: Project,
  expenseId: string,
  input: Omit<ExpenseInput, 'source'>
): Promise<void> {
  const path = `projects/${project.id}/expenses/${expenseId}`;
  const isRecurring = Boolean(input.isRecurring);
  const frequency = isRecurring ? input.frequency ?? 'monthly' : undefined;
  const nextDueDate =
    isRecurring && frequency
      ? input.nextDueDate || addFrequencyToDate(input.date, frequency)
      : undefined;

  const splitMode: SplitMode = input.splitMode ?? 'none';
  const isExternalSplit = splitMode === 'external';
  const cleanedShares =
    splitMode !== 'none' && !isExternalSplit ? cleanNumericMap(input.splitShares) : undefined;
  const cleanedPercentages =
    splitMode === 'percentage' ? cleanNumericMap(input.splitPercentages) : undefined;
  const externalTotalPeople = isExternalSplit
    ? Math.max(1, Math.min(50, Math.round(input.externalTotalPeople ?? 2)))
    : undefined;
  const externalIncludeSelf = isExternalSplit
    ? externalTotalPeople === 1
      ? false
      : Boolean(input.externalIncludeSelf ?? true)
    : undefined;
  const externalLabel = isExternalSplit ? input.externalLabel?.trim().slice(0, 100) : undefined;

  const effectiveSplitMode: SplitMode = isExternalSplit
    ? 'external'
    : cleanedShares
      ? splitMode
      : 'none';

  const payload: Record<string, unknown> = {
    amount: Math.round(input.amount * 100) / 100,
    date: input.date,
    description: input.description.trim().slice(0, 200),
    paidByUid: input.paidByUid,
    paidByName: input.paidByName.slice(0, 100),
    paidByPhoto: (input.paidByPhoto ?? '').slice(0, 500),
    paymentMethod: input.paymentMethod,
    tagIds: input.tagIds.slice(0, 10),
    projectMemberUids: project.memberUids,
    isRecurring,
    frequency: isRecurring && frequency ? frequency : deleteField(),
    nextDueDate: isRecurring && nextDueDate ? nextDueDate : deleteField(),
    splitMode: effectiveSplitMode,
    splitShares: cleanedShares ?? deleteField(),
    splitPercentages: cleanedPercentages ?? deleteField(),
    externalTotalPeople: isExternalSplit && externalTotalPeople ? externalTotalPeople : deleteField(),
    externalIncludeSelf: isExternalSplit ? externalIncludeSelf : deleteField(),
    externalLabel: isExternalSplit && externalLabel ? externalLabel : deleteField(),
    updatedAt: serverTimestamp(),
  };

  try {
    await updateDoc(doc(db, 'projects', project.id, 'expenses', expenseId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function logRecurringBillPayment(
  project: Project,
  user: User,
  expense: Expense,
  dueDate: string
): Promise<string> {
  const freq = expense.frequency ?? 'monthly';
  const paidDate = getTodayISO();
  const nextCycleDate = addFrequencyToDate(dueDate, freq);
  const newExpenseRef = doc(collection(db, 'projects', project.id, 'expenses'));
  const oldExpenseRef = doc(db, 'projects', project.id, 'expenses', expense.id);

  const newPayload: Record<string, unknown> = {
    amount: expense.amount,
    date: paidDate,
    description: expense.description,
    paidByUid: expense.paidByUid,
    paidByName: expense.paidByName,
    paidByPhoto: expense.paidByPhoto,
    paymentMethod: expense.paymentMethod,
    tagIds: expense.tagIds,
    createdByUid: user.uid,
    projectMemberUids: project.memberUids,
    source: 'manual',
    isRecurring: true,
    frequency: freq,
    nextDueDate: nextCycleDate,
    splitMode: expense.splitMode ?? 'none',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (expense.splitMode === 'external' && (expense.externalTotalPeople ?? 0) >= 1) {
    newPayload.externalTotalPeople = expense.externalTotalPeople;
    newPayload.externalIncludeSelf = expense.externalIncludeSelf ?? true;
    if (expense.externalLabel) {
      newPayload.externalLabel = expense.externalLabel;
    }
  } else if (expense.splitMode && expense.splitMode !== 'none' && expense.splitShares) {
    newPayload.splitShares = expense.splitShares;
  }
  if (expense.splitMode === 'percentage' && expense.splitPercentages) {
    newPayload.splitPercentages = expense.splitPercentages;
  }

  try {
    const batch = writeBatch(db);
    // Keep historical occurrence in ledger without triggering duplicate alerts
    batch.update(oldExpenseRef, {
      isRecurring: false,
      frequency: deleteField(),
      nextDueDate: deleteField(),
      updatedAt: serverTimestamp(),
    });
    // Record newly paid recurring bill with next cycle scheduled
    batch.set(newExpenseRef, newPayload);
    await batch.commit();
    return newExpenseRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `projects/${project.id}/expenses/${expense.id}`);
  }
}

export async function skipRecurringBillCycle(
  project: Project,
  expense: Expense,
  currentDueDate: string
): Promise<void> {
  const freq = expense.frequency ?? 'monthly';
  const nextCycleDate = addFrequencyToDate(currentDueDate, freq);
  const path = `projects/${project.id}/expenses/${expense.id}`;
  try {
    await updateDoc(doc(db, 'projects', project.id, 'expenses', expense.id), {
      nextDueDate: nextCycleDate,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteExpense(projectId: string, expenseId: string): Promise<void> {
  const path = `projects/${projectId}/expenses/${expenseId}`;
  try {
    await deleteDoc(doc(db, 'projects', projectId, 'expenses', expenseId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface SettlementInput {
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
}

export async function createSettlement(
  project: Project,
  user: User,
  input: SettlementInput
): Promise<string> {
  const settlementRef = doc(collection(db, 'projects', project.id, 'settlements'));
  const path = `projects/${project.id}/settlements/${settlementRef.id}`;
  const trimmedNote = input.note?.trim().slice(0, 200);

  const payload: Record<string, unknown> = {
    fromUid: input.fromUid,
    fromName: input.fromName.slice(0, 100),
    fromPhoto: (input.fromPhoto ?? '').slice(0, 500),
    toUid: input.toUid,
    toName: input.toName.slice(0, 100),
    toPhoto: (input.toPhoto ?? '').slice(0, 500),
    amount: Math.round(input.amount * 100) / 100,
    date: input.date,
    paymentMethod: input.paymentMethod,
    createdByUid: user.uid,
    projectMemberUids: project.memberUids,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (trimmedNote) {
    payload.note = trimmedNote;
  }

  try {
    await setDoc(settlementRef, payload);
    return settlementRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteSettlement(projectId: string, settlementId: string): Promise<void> {
  const path = `projects/${projectId}/settlements/${settlementId}`;
  try {
    await deleteDoc(doc(db, 'projects', projectId, 'settlements', settlementId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface ReceivedMoneyInput {
  amount: number;
  date: string;
  source: string;
  note?: string;
  paymentMethod: PaymentMethod;
  linkedExpenseId?: string;
  peoplePaidCount?: number;
}

export async function createReceivedMoney(
  project: Project,
  user: User,
  input: ReceivedMoneyInput
): Promise<string> {
  const ref = doc(collection(db, 'projects', project.id, 'receivedMoney'));
  const path = `projects/${project.id}/receivedMoney/${ref.id}`;
  const trimmedNote = input.note?.trim().slice(0, 200);
  const trimmedSource = input.source.trim().slice(0, 80) || 'Money Received';

  const payload: Record<string, unknown> = {
    amount: Math.round(input.amount * 100) / 100,
    date: input.date,
    source: trimmedSource,
    paymentMethod: input.paymentMethod,
    createdByUid: user.uid,
    projectMemberUids: project.memberUids,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (trimmedNote) {
    payload.note = trimmedNote;
  }
  if (input.linkedExpenseId && /^[a-zA-Z0-9_-]+$/.test(input.linkedExpenseId)) {
    payload.linkedExpenseId = input.linkedExpenseId.slice(0, 128);
  }
  if (
    typeof input.peoplePaidCount === 'number' &&
    Number.isFinite(input.peoplePaidCount) &&
    input.peoplePaidCount >= 0
  ) {
    payload.peoplePaidCount = Math.min(50, Math.round(input.peoplePaidCount));
  }

  try {
    await setDoc(ref, payload);
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteReceivedMoney(projectId: string, receivedId: string): Promise<void> {
  const path = `projects/${projectId}/receivedMoney/${receivedId}`;
  try {
    await deleteDoc(doc(db, 'projects', projectId, 'receivedMoney', receivedId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
