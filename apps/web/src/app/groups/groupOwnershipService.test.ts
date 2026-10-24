import { beforeEach, expect, it, vi } from 'vitest';
import {
  createGroupOwnershipOrigin,
  isGroupOwnershipOriginCurrent,
  loadEligibleOwnershipMembers,
  transferGroupOwnership,
  transferGroupOwnershipErrorMessage,
} from './groupOwnershipService';

const runtime = vi.hoisted(() => ({ functionsConfigured: true }));
const authState = vi.hoisted(() => {
  const user = {
    uid: 'alice',
    getIdToken: async () => 'token',
  };
  const auth = { currentUser: user as typeof user | null };
  return {
    user,
    auth,
    setUid(uid: string | null) {
      if (!uid) {
        auth.currentUser = null;
        return;
      }
      user.uid = uid;
      auth.currentUser = user;
    },
  };
});

vi.mock('@/lib/firebase', () => ({
  isFirebaseConfigured: () => true,
  getAuth: () => authState.auth,
  getDb: () => ({}),
  getCloudFunctionUrl: (name: string) => `https://fn.test/${name}`,
}));
vi.mock('@/lib/functionsUrl', async (original) => ({
  ...(await original<typeof import('@/lib/functionsUrl')>()),
  areFunctionsConfigured: () => runtime.functionsConfigured,
}));

const firestore = vi.hoisted(() => {
  const docs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
  return {
    docs,
    getDocsFromServer: vi.fn(async () => ({ docs })),
    getDocFromServer: vi.fn(),
    fetchSchoolDirectoryProfiles: vi.fn(async (_school: string, uids: string[]) =>
      uids.map((uid) => ({ uid, displayName: `名:${uid}` })),
    ),
  };
});

vi.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...path: string[]) => path.join('/'),
  doc: (_: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => args,
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  startAfter: (...args: unknown[]) => ({ startAfter: args }),
  limit: (n: number) => ({ limit: n }),
  getDocsFromServer: firestore.getDocsFromServer,
  getDocFromServer: firestore.getDocFromServer,
}));

vi.mock('@/lib/community/firestore', () => ({
  fetchSchoolDirectoryProfiles: firestore.fetchSchoolDirectoryProfiles,
}));

beforeEach(() => {
  runtime.functionsConfigured = true;
  authState.setUid('alice');
  firestore.docs.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          success: true,
          reused: false,
          groupId: 'g1',
          schoolId: 'pu',
          fromUid: 'alice',
          toUid: 'bob',
          actorNewRole: 'member',
          operationId: 'op-1',
        },
      }),
    })),
  );
});

it('fences ownership origins across identity and generation changes', () => {
  const origin = createGroupOwnershipOrigin({
    generation: 2,
    uid: 'alice',
    schoolId: 'pu',
    groupId: 'g1',
    targetUid: 'bob',
    operationId: 'op-1',
  });
  expect(
    isGroupOwnershipOriginCurrent(origin, {
      generation: 2,
      uid: 'alice',
      schoolId: 'pu',
      groupId: 'g1',
    }),
  ).toBe(true);
  expect(
    isGroupOwnershipOriginCurrent(origin, {
      generation: 3,
      uid: 'alice',
      schoolId: 'pu',
      groupId: 'g1',
    }),
  ).toBe(false);
  expect(
    isGroupOwnershipOriginCurrent(origin, {
      generation: 2,
      uid: 'carol',
      schoolId: 'pu',
      groupId: 'g1',
    }),
  ).toBe(false);
});

it('lists only active non-owner members with real directory display names', async () => {
  firestore.docs.push(
    { id: 'alice', data: () => ({ role: 'owner', status: 'active' }) },
    { id: 'bob', data: () => ({ role: 'member', status: 'active' }) },
    { id: 'carol', data: () => ({ role: 'moderator', status: 'active' }) },
  );
  const page = await loadEligibleOwnershipMembers('alice', 'pu', 'g1');
  expect(page.members.map((row) => row.uid)).toEqual(['bob', 'carol']);
  expect(page.members[0].displayName).toBe('名:bob');
  expect(firestore.fetchSchoolDirectoryProfiles).toHaveBeenCalledWith('pu', ['bob', 'carol']);
});

it('does not call Cloud Functions when the functions base URL is unset', async () => {
  runtime.functionsConfigured = false;
  await expect(
    transferGroupOwnership('alice', {
      groupId: 'g1',
      targetUid: 'bob',
      operationId: 'op-1',
      expectedCurrentOwnerUid: 'alice',
    }),
  ).rejects.toMatchObject({
    code: 'functions-unconfigured',
    message: '群組擁有權轉讓尚未啟用',
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(transferGroupOwnershipErrorMessage(new Error('群組擁有權轉讓尚未啟用'))).toBe(
    '群組擁有權轉讓尚未啟用',
  );
});

it('posts transfer with stable operation id and rejects identity mismatch', async () => {
  const result = await transferGroupOwnership('alice', {
    groupId: 'g1',
    targetUid: 'bob',
    operationId: 'op-1',
    expectedCurrentOwnerUid: 'alice',
  });
  expect(result.actorNewRole).toBe('member');
  expect(fetch).toHaveBeenCalledWith(
    'https://fn.test/transferGroupOwnership',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        data: {
          groupId: 'g1',
          targetUid: 'bob',
          operationId: 'op-1',
          expectedCurrentOwnerUid: 'alice',
        },
      }),
    }),
  );
  await expect(
    transferGroupOwnership('alice', {
      groupId: 'g1',
      targetUid: 'bob',
      operationId: 'op-1',
      expectedCurrentOwnerUid: 'other',
    }),
  ).rejects.toThrow(/不符/);
});

it('surfaces recoverable Traditional Chinese errors', () => {
  expect(transferGroupOwnershipErrorMessage(new Error('目前帳號必須為此校有效成員。'))).toMatch(
    /校/,
  );
  expect(transferGroupOwnershipErrorMessage(new Error('INTERNAL'))).toMatch(/重試/);
});
