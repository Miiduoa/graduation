import { beforeEach, expect, it, vi } from 'vitest';
import {
  deleteDoc,
  getDocsFromServer,
  limit,
  orderBy,
  runTransaction,
  startAfter,
  updateDoc,
} from 'firebase/firestore';
import { readMemberGroup } from './groupService';
import {
  canEditPost,
  createGroupDiscussionPost,
  deleteGroupDiscussionPost,
  loadGroupDiscussionPage,
  updateGroupDiscussionPost,
} from './groupDiscussionService';

const runtime = vi.hoisted(() => ({
  user: null as null | { uid: string },
  configured: true,
  revision: 0,
  docs: new Map<string, Record<string, unknown>>(),
  failCommitOnce: false,
  txnAttempts: 0,
}));

vi.mock('@/lib/firebase', () => ({
  getDb: () => ({}),
  isFirebaseConfigured: () => runtime.configured,
  getAuth: () => ({ currentUser: runtime.user }),
}));

vi.mock('./groupService', () => ({
  readMemberGroup: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...parts: unknown[]) => parts,
  orderBy: vi.fn((...args: unknown[]) => ({ orderBy: args })),
  limit: vi.fn((n: number) => ({ limit: n })),
  startAfter: vi.fn((cursor: unknown) => ({ startAfter: cursor })),
  serverTimestamp: () => 'server-time',
  getDocsFromServer: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  runTransaction: vi.fn(),
}));

const membership = {
  id: 'g1',
  schoolId: 'pu',
  name: '讀書會',
  description: '',
  type: 'study' as const,
  role: 'member',
  memberCount: 3,
};

function postDoc(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      kind: 'post',
      title: `標題 ${id}`,
      body: `內容 ${id}`,
      authorId: 'alice',
      authorName: 'Alice',
      schoolId: 'pu',
      createdAt: id,
      ...overrides,
    }),
  };
}

function installTransaction() {
  vi.mocked(runTransaction).mockImplementation(async (_db, callback) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      runtime.txnAttempts += 1;
      const revision = runtime.revision;
      const snapshot = new Map(runtime.docs);
      const changes: Array<{ path: string; row?: Record<string, unknown> }> = [];
      const value = await callback({
        get: async (ref: { path: string }) => {
          const row = snapshot.get(ref.path);
          return {
            id: ref.path.split('/').at(-1),
            exists: () => row !== undefined,
            data: () => row,
          };
        },
        set: (ref: { path: string }, row: Record<string, unknown>) => {
          changes.push({ path: ref.path, row });
        },
      } as never);
      if (runtime.revision !== revision) continue;
      if (changes.length) {
        if (runtime.failCommitOnce) {
          runtime.failCommitOnce = false;
          throw new Error('unavailable');
        }
        for (const change of changes) {
          if (change.row) runtime.docs.set(change.path, change.row);
        }
        runtime.revision += 1;
      }
      return value;
    }
    throw new Error('transaction-conflict');
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.configured = true;
  runtime.user = { uid: 'alice' };
  runtime.revision = 0;
  runtime.docs = new Map([
    ['groups/g1/members/alice', { uid: 'alice', status: 'active', schoolId: 'pu', role: 'member' }],
  ]);
  runtime.failCommitOnce = false;
  runtime.txnAttempts = 0;
  installTransaction();
  vi.mocked(readMemberGroup).mockResolvedValue(membership);
  vi.mocked(getDocsFromServer).mockResolvedValue({
    docs: [postDoc('p1'), postDoc('p2')],
  } as never);
  vi.mocked(updateDoc).mockResolvedValue(undefined as never);
  vi.mocked(deleteDoc).mockResolvedValue(undefined as never);
});

it('loads posts only after membership is confirmed for the school scope', async () => {
  const result = await loadGroupDiscussionPage('alice', 'pu', 'g1', () => true);
  expect(readMemberGroup).toHaveBeenCalledWith('alice', 'pu', 'g1');
  expect(limit).toHaveBeenCalledWith(20);
  expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  expect(result.group.id).toBe('g1');
  expect(result.page.posts).toHaveLength(2);
  expect(result.page.hasMore).toBe(false);
});

it('paginates with startAfter and rejects revoked membership before write', async () => {
  const cursor = postDoc('cursor');
  await loadGroupDiscussionPage('alice', 'pu', 'g1', () => true, cursor as never);
  expect(startAfter).toHaveBeenCalledWith(cursor);

  vi.mocked(readMemberGroup).mockRejectedValueOnce(new Error('Group membership is no longer active'));
  await expect(
    createGroupDiscussionPost(
      'alice',
      'pu',
      'g1',
      { title: 't', body: 'b', postId: 'intent-1' },
      () => true,
    ),
  ).rejects.toThrow(/no longer active/);
  expect(runTransaction).not.toHaveBeenCalled();
});

it('blocks announcement posts for regular members and allows managers via transaction create', async () => {
  await expect(
    createGroupDiscussionPost(
      'alice',
      'pu',
      'g1',
      { title: '公告', body: '內容', kind: 'announcement', postId: 'ann-1' },
      () => true,
    ),
  ).rejects.toThrow(/managers/);

  vi.mocked(readMemberGroup).mockResolvedValueOnce({ ...membership, role: 'owner' });
  await createGroupDiscussionPost(
    'alice',
    'pu',
    'g1',
    { title: '公告', body: '內容', kind: 'announcement', postId: 'ann-1' },
    () => true,
    'Owner',
  );
  expect(runtime.docs.get('groups/g1/posts/ann-1')).toMatchObject({
    kind: 'announcement',
    authorId: 'alice',
    schoolId: 'pu',
    title: '公告',
    body: '內容',
    clientIntentId: 'ann-1',
  });
});

it('retries the same intent without duplicating after a lost success result', async () => {
  const intent = 'intent-stable-1';
  let current = true;
  vi.mocked(runTransaction).mockImplementationOnce(async (_db, callback) => {
    const tx = {
      get: async (ref: { path: string }) => {
        const row = runtime.docs.get(ref.path);
        return { id: ref.path.split('/').at(-1), exists: () => row !== undefined, data: () => row };
      },
      set: (ref: { path: string }, row: Record<string, unknown>) => {
        runtime.docs.set(ref.path, row);
        current = false; // leave / unmount after write committed inside txn
      },
    };
    return callback(tx as never);
  });

  await expect(
    createGroupDiscussionPost(
      'alice',
      'pu',
      'g1',
      { title: '外拍', body: '週三集合', postId: intent },
      () => current,
    ),
  ).rejects.toThrow(/Account or connection changed/);
  expect(runtime.docs.get(`groups/g1/posts/${intent}`)).toMatchObject({
    title: '外拍',
    body: '週三集合',
  });

  installTransaction();
  const confirmed = await createGroupDiscussionPost(
    'alice',
    'pu',
    'g1',
    { title: '外拍', body: '週三集合', postId: intent },
    () => true,
  );
  expect(confirmed.id).toBe(intent);
  expect(confirmed.body).toBe('週三集合');

  // 改稿不得覆寫既有 likes／內容
  runtime.docs.set(`groups/g1/posts/${intent}`, {
    ...runtime.docs.get(`groups/g1/posts/${intent}`)!,
    likes: 7,
    likedBy: ['bob'],
    body: '週三集合',
  });
  await expect(
    createGroupDiscussionPost(
      'alice',
      'pu',
      'g1',
      { title: '外拍', body: '改成週五集合', postId: intent },
      () => true,
    ),
  ).rejects.toThrow(/Post intent conflict/);
  expect(runtime.docs.get(`groups/g1/posts/${intent}`)).toMatchObject({
    body: '週三集合',
    likes: 7,
    likedBy: ['bob'],
  });

  const next = await createGroupDiscussionPost(
    'alice',
    'pu',
    'g1',
    { title: '外拍', body: '改成週五集合', postId: 'intent-stable-2' },
    () => true,
  );
  expect(next.id).toBe('intent-stable-2');
  expect(runtime.docs.get('groups/g1/posts/intent-stable-2')).toMatchObject({
    body: '改成週五集合',
  });
});

it('transaction callback re-checks scope and does not overwrite on intervening change', async () => {
  const intent = 'race-1';
  let attempts = 0;
  vi.mocked(runTransaction).mockImplementation(async (_db, callback) => {
    for (let i = 0; i < 3; i += 1) {
      attempts += 1;
      const revision = runtime.revision;
      const snapshot = new Map(runtime.docs);
      const changes: Array<{ path: string; row: Record<string, unknown> }> = [];
      const value = await callback({
        get: async (ref: { path: string }) => {
          const row = snapshot.get(ref.path);
          return { id: ref.path.split('/').at(-1), exists: () => row !== undefined, data: () => row };
        },
        set: (ref: { path: string }, row: Record<string, unknown>) => {
          changes.push({ path: ref.path, row });
        },
      } as never);
      // First attempt: simulate concurrent writer winning before commit.
      if (attempts === 1) {
        runtime.docs.set(`groups/g1/posts/${intent}`, {
          kind: 'post',
          title: '外拍',
          body: '已被其他人／先前意圖寫入的不同內容',
          authorId: 'alice',
          schoolId: 'pu',
          likes: 3,
          likedBy: ['carol'],
        });
        runtime.revision += 1;
        continue;
      }
      if (runtime.revision !== revision) continue;
      for (const change of changes) runtime.docs.set(change.path, change.row);
      runtime.revision += 1;
      return value;
    }
    throw new Error('transaction-conflict');
  });

  await expect(
    createGroupDiscussionPost(
      'alice',
      'pu',
      'g1',
      { title: '外拍', body: '我的原稿', postId: intent },
      () => true,
    ),
  ).rejects.toThrow(/Post intent conflict/);
  expect(runtime.docs.get(`groups/g1/posts/${intent}`)).toMatchObject({
    body: '已被其他人／先前意圖寫入的不同內容',
    likes: 3,
    likedBy: ['carol'],
  });
  expect(attempts).toBeGreaterThan(1);
});

it('aborts when uid/school scope flips during a transaction retry', async () => {
  let current = true;
  let calls = 0;
  vi.mocked(runTransaction).mockImplementation(async (_db, callback) => {
    calls += 1;
    if (calls === 1) {
      current = false;
      runtime.revision += 1; // force retry
    }
    return callback({
      get: async (ref: { path: string }) => {
        const row = runtime.docs.get(ref.path);
        return { id: ref.path.split('/').at(-1), exists: () => row !== undefined, data: () => row };
      },
      set: vi.fn(),
    } as never);
  });

  await expect(
    createGroupDiscussionPost(
      'alice',
      'pu',
      'g1',
      { title: 't', body: 'b', postId: 'scope-flip' },
      () => current,
    ),
  ).rejects.toThrow(/Account or connection changed/);
  expect(runtime.docs.has('groups/g1/posts/scope-flip')).toBe(false);
});

it('enforces author or manager checks for edit and delete', async () => {
  const foreign = {
    id: 'p9',
    groupId: 'g1',
    kind: 'post' as const,
    title: '別人的',
    body: '內容',
    authorId: 'bob',
    authorName: 'Bob',
    schoolId: 'pu',
    createdAt: null,
  };
  await expect(
    updateGroupDiscussionPost(
      'alice',
      'pu',
      'g1',
      'p9',
      { title: '改', body: '文' },
      () => true,
      foreign,
    ),
  ).rejects.toThrow(/Not allowed/);
  expect(updateDoc).not.toHaveBeenCalled();

  expect(canEditPost('member', 'alice', 'alice')).toBe(true);
  expect(canEditPost('member', 'bob', 'alice')).toBe(false);
  expect(canEditPost('owner', 'bob', 'alice')).toBe(true);

  vi.mocked(readMemberGroup).mockResolvedValueOnce({ ...membership, role: 'moderator' });
  await deleteGroupDiscussionPost('alice', 'pu', 'g1', 'p9', () => true, foreign);
  expect(deleteDoc).toHaveBeenCalledWith({ path: 'groups/g1/posts/p9' });
});

it('rejects malformed path identifiers', async () => {
  await expect(loadGroupDiscussionPage('alice', 'pu', 'g1/../x', () => true)).rejects.toThrow(
    /Invalid group/,
  );
});
