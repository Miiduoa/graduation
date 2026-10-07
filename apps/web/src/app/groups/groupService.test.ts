import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import { joinByCode, leaveMemberGroup, loadMyGroups } from './groupService';

const runtime = vi.hoisted(() => ({
  user: null as null | { uid: string; getIdToken: () => Promise<string> },
  configured: true,
}));
vi.mock('@/lib/firebase', () => ({
  getDb: () => ({}),
  isFirebaseConfigured: () => runtime.configured,
  getAuth: () => ({ currentUser: runtime.user, app: { options: { projectId: 'campus-test' } } }),
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDocFromServer: vi.fn(),
  getDocsFromServer: vi.fn(),
}));
const fetchMock = vi.fn();
const records = new Map<string, Record<string, unknown> | null>();
function snapshot(path: string) {
  const data = records.get(path);
  return { id: path.split('/').at(-1), exists: () => data != null, data: () => data };
}
function mirror(overrides: Record<string, unknown> = {}) {
  return {
    groupId: 'firestore-1',
    schoolId: 'pu',
    type: 'course',
    status: 'active',
    role: 'member',
    ...overrides,
  };
}
function seedGroup(overrides: Record<string, unknown> = {}) {
  records.set('groups/firestore-1', {
    name: '真實課程群組',
    type: 'course',
    schoolId: 'pu',
    courseId: 'PU-SECTION-77',
    memberCount: 4,
    ...overrides,
  });
  records.set('groups/firestore-1/members/alice', {
    uid: 'alice',
    status: 'active',
    role: 'member',
  });
  records.set('users/alice/groups/firestore-1', mirror());
}
function response(result: unknown, ok = true) {
  return { ok, json: async () => ({ result }) } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.configured = true;
  runtime.user = { uid: 'alice', getIdToken: vi.fn().mockResolvedValue('alice-token') };
  records.clear();
  seedGroup();
  vi.mocked(getDocFromServer).mockImplementation(
    async (ref) => snapshot((ref as unknown as { path: string }).path) as never,
  );
  vi.mocked(getDocsFromServer).mockImplementation(
    async () =>
      ({
        docs: [...records.entries()]
          .filter(([path]) => path.startsWith('users/alice/groups/'))
          .map(([path]) => snapshot(path)),
      }) as never,
  );
  fetchMock.mockReset().mockResolvedValue(response({ success: true, groupId: 'firestore-1' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it('loads only current school active memberships and uses the Firestore group ID rather than the school section ID', async () => {
  records.set('users/alice/groups/left', mirror({ groupId: 'left', status: 'left' }));
  records.set(
    'users/alice/groups/other-school',
    mirror({ groupId: 'other-school', schoolId: 'nthu' }),
  );
  expect(await loadMyGroups('alice', 'pu')).toEqual([
    expect.objectContaining({
      id: 'firestore-1',
      name: '真實課程群組',
      type: 'course',
      memberCount: 4,
    }),
  ]);
  expect(getDocsFromServer).toHaveBeenCalledExactlyOnceWith({ path: 'users/alice/groups' });
  expect(getDocFromServer).toHaveBeenCalledWith({ path: 'groups/firestore-1/members/alice' });
  expect(getDocFromServer).not.toHaveBeenCalledWith({ path: 'groups/PU-SECTION-77' });
});

it('does not accept a mirror that substitutes a section ID for its canonical group ID', async () => {
  records.set('users/alice/groups/firestore-1', mirror({ groupId: 'PU-SECTION-77' }));
  await expect(loadMyGroups('alice', 'pu')).rejects.toThrow();
  expect(getDocFromServer).not.toHaveBeenCalled();
});

it.each(['left', 'pending', undefined])(
  'requires active group membership instead of trusting a mirror (%s)',
  async (status) => {
    records.set('groups/firestore-1/members/alice', { uid: 'alice', status });
    await expect(loadMyGroups('alice', 'pu')).rejects.toThrow();
  },
);

it('rejects a group stored under another school', async () => {
  seedGroup({ schoolId: 'nthu' });
  await expect(loadMyGroups('alice', 'pu')).rejects.toThrow();
});

it('does not manufacture a member count when the server omits it', async () => {
  seedGroup({ memberCount: undefined });
  expect((await loadMyGroups('alice', 'pu'))[0].memberCount).toBeNull();
});

it('propagates source errors instead of substituting demo groups or empty results', async () => {
  vi.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('permission-denied'));
  await expect(loadMyGroups('alice', 'pu')).rejects.toThrow('permission-denied');
  runtime.configured = false;
  await expect(loadMyGroups('alice', 'pu')).rejects.toThrow();
});

it('calls the existing invitation endpoint using the captured user token and confirms both server membership records', async () => {
  const group = await joinByCode('alice', 'pu', ' abcd1234 ', () => true);
  expect(group.id).toBe('firestore-1');
  const [url, request] = fetchMock.mock.calls[0];
  expect(url).toBe('https://asia-east1-campus-test.cloudfunctions.net/joinGroupByCode');
  expect(request.headers.Authorization).toBe('Bearer alice-token');
  expect(JSON.parse(request.body)).toEqual({ data: { schoolId: 'pu', joinCode: 'ABCD1234' } });
  expect(getDocFromServer).toHaveBeenCalledWith({ path: 'users/alice/groups/firestore-1' });
  expect(getDocFromServer).toHaveBeenCalledWith({ path: 'groups/firestore-1/members/alice' });
});

it.each([null, { ...mirror(), status: 'left' }, { ...mirror(), schoolId: 'nthu' }])(
  'does not claim joined when the callable succeeds but the membership mirror is inconsistent (%s)',
  async (value) => {
    records.set('users/alice/groups/firestore-1', value);
    await expect(joinByCode('alice', 'pu', 'ABCD1234', () => true)).rejects.toThrow();
  },
);

it('does not treat a failed callable envelope as success', async () => {
  fetchMock.mockResolvedValueOnce(response({ success: false, groupId: 'firestore-1' }));
  await expect(joinByCode('alice', 'pu', 'ABCD1234', () => true)).rejects.toThrow();
  expect(getDocFromServer).not.toHaveBeenCalled();
});

it('never sends the mutation if the account changes while obtaining the initiating token', async () => {
  let finish!: (token: string) => void;
  runtime.user!.getIdToken = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const operation = joinByCode('alice', 'pu', 'ABCD1234', () => true);
  runtime.user = { uid: 'bob', getIdToken: async () => 'bob-token' };
  finish('alice-token');
  await expect(operation).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('rejects a new login session even if it has the same UID', async () => {
  let finish!: (token: string) => void;
  runtime.user!.getIdToken = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const operation = joinByCode('alice', 'pu', 'ABCD1234', () => true);
  runtime.user = { uid: 'alice', getIdToken: async () => 'new-token' };
  finish('alice-token');
  await expect(operation).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('stops before sending when the school or page scope has changed', async () => {
  let current = true;
  runtime.user!.getIdToken = async () => {
    current = false;
    return 'alice-token';
  };
  await expect(joinByCode('alice', 'pu', 'ABCD1234', () => current)).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not disclose results or continue membership reads after an account switch during the request', async () => {
  fetchMock.mockImplementationOnce(async () => {
    runtime.user = { uid: 'bob', getIdToken: async () => 'bob-token' };
    return response({ success: true, groupId: 'firestore-1' });
  });
  await expect(joinByCode('alice', 'pu', 'ABCD1234', () => true)).rejects.toThrow();
  expect(getDocFromServer).not.toHaveBeenCalled();
});

it('confirms leaving through the server-owned user mirror without reading the now-protected group afterward', async () => {
  fetchMock.mockImplementationOnce(async () => {
    records.set('users/alice/groups/firestore-1', mirror({ status: 'left' }));
    return response({ success: true });
  });
  await leaveMemberGroup('alice', 'pu', 'firestore-1', () => true);
  expect(fetchMock.mock.calls[0][0]).toContain('/leaveGroup');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ data: { groupId: 'firestore-1' } });
  expect(getDocFromServer).toHaveBeenLastCalledWith({ path: 'users/alice/groups/firestore-1' });
  expect(getDocFromServer).toHaveBeenCalledTimes(3);
});

it('does not claim left when the backend returns success but the server mirror remains active', async () => {
  await expect(leaveMemberGroup('alice', 'pu', 'firestore-1', () => true)).rejects.toThrow();
});

it('does not send a leave request for the actual group owner', async () => {
  records.set('groups/firestore-1/members/alice', {
    uid: 'alice',
    role: 'owner',
    status: 'active',
  });
  await expect(leaveMemberGroup('alice', 'pu', 'firestore-1', () => true)).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
