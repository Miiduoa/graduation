'use strict';

// Keep the callable, proposal claim, registry, permission helpers, and repair tool real.
// Only Firebase transport is replaced; both the original .add() path and atomic
// transactions are supported so the regression cannot pass on an incomplete fake.
let mockStore;
jest.mock('firebase-functions/v2/https', () => ({
  ...jest.requireActual('firebase-functions/v2/https'),
  onCall: (_, handler) => handler,
}));
jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: () => mockStore.db,
}));

function copy(value) {
  if (Array.isArray(value)) return value.map(copy);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
  }
  return value;
}

function merge(left, right) {
  const result = copy(left || {});
  for (const [key, value] of Object.entries(right)) {
    result[key] = value && Object.getPrototypeOf(value) === Object.prototype
      ? merge(result[key], value) : copy(value);
  }
  return result;
}

function repairStore() {
  const store = {
    docs: new Map(), reads: [], writes: [], failedReads: new Set(),
    afterClaim: null, claimCount: 0, nextId: 0, failRepairCommit: false,
  };
  function snapshot(reference, values, transaction) {
    store.reads.push({ path: reference.path, transaction });
    if (store.failedReads.has(reference.path)) throw new Error(`source read failed: ${reference.path}`);
    const data = copy(values.get(reference.path));
    return { ref: reference, id: reference.id, exists: data !== undefined, data: () => copy(data) };
  }
  function apply(values, write) {
    if (write.type === 'create' && values.has(write.ref.path)) throw new Error('already exists');
    if (write.type === 'update' && !values.has(write.ref.path)) throw new Error('missing document');
    values.set(write.ref.path, write.options?.merge || write.type === 'update'
      ? merge(values.get(write.ref.path), write.data) : copy(write.data));
  }
  function directWrite(type, reference, data, options) {
    const write = { type, ref: reference, data, options, transaction: false };
    apply(store.docs, write);
    store.writes.push(write);
  }
  function ref(path) {
    const reference = {
      path, id: path.split('/').pop(),
      collection: (name) => collection(`${path}/${name}`),
      get: async () => snapshot(reference, store.docs, false),
      set: async (data, options) => directWrite('set', reference, data, options),
      create: async (data) => directWrite('create', reference, data),
      update: async (data) => directWrite('update', reference, data),
    };
    return reference;
  }
  function collection(path) {
    return {
      path,
      doc: (id = `memo-${++store.nextId}`) => ref(`${path}/${id}`),
      add: async (data) => {
        const reference = ref(`${path}/memo-${++store.nextId}`);
        directWrite('create', reference, data);
        return reference;
      },
    };
  }
  store.db = {
    doc: ref,
    collection,
    async runTransaction(callback) {
      const values = new Map([...store.docs].map(([path, data]) => [path, copy(data)]));
      const writes = [];
      const get = async (reference) => {
        if (writes.length) throw new Error('transaction read after write');
        return snapshot(reference, values, true);
      };
      const tx = {
        get, getAll: (...references) => Promise.all(references.map(get)),
        set: (reference, data, options) => writes.push({ type: 'set', ref: reference, data, options }),
        create: (reference, data) => writes.push({ type: 'create', ref: reference, data }),
        update: (reference, data) => writes.push({ type: 'update', ref: reference, data }),
      };
      const result = await callback(tx);
      if (store.failRepairCommit && writes.some((write) => write.ref.path.includes('/repairRequests/'))) {
        throw new Error('repair commit unavailable');
      }
      const committed = new Map(store.docs);
      writes.forEach((write) => apply(committed, write));
      store.docs.clear();
      for (const [path, data] of committed) store.docs.set(path, data);
      store.writes.push(...writes.map((write) => ({ ...write, transaction: true })));
      if (writes.some((write) => write.data.actionClaims?.['0']?.status === 'started')) {
        store.claimCount++;
        const afterClaim = store.afterClaim;
        store.afterClaim = null;
        if (afterClaim) await afterClaim();
      }
      return result;
    },
  };
  return store;
}

mockStore = repairStore();
const executeAgentWrite = require('./executeAgentWrite');

const RUN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const RUN_PATH = `users/alice/agentRuns/${RUN_ID}`;
const ACCOUNT_PATH = 'users/alice';
const MEMBER_PATH = 'schools/pu/members/alice';
const PERMISSIONS_PATH = 'users/alice/settings/assistantPermissions';
const INPUT = {
  dormitory: 'A棟', room: '301', category: '水電', description: '水龍頭持續漏水', urgency: 'normal',
};

function request(overrides = {}) {
  return {
    auth: { uid: 'alice' },
    data: {
      toolName: 'createDormRepairRequest', agentRunId: RUN_ID,
      input: { ...INPUT }, context: { schoolId: 'pu' },
    },
    ...overrides,
  };
}

function repairWrites() {
  return mockStore.writes.filter((write) => write.ref.path.includes('/repairRequests/'));
}

function repairDocuments() {
  return [...mockStore.docs].filter(([path]) => path.includes('/repairRequests/'));
}

async function expectBlockedAfterClaim() {
  const outcome = await executeAgentWrite(request()).then(
    (result) => ({ result }), (error) => ({ error }),
  );
  expect(mockStore.claimCount).toBe(1);
  expect(repairDocuments()).toEqual([]);
  expect(repairWrites()).toEqual([]);
  expect(outcome.result?.success).not.toBe(true);
  expect(Boolean(outcome.error) || outcome.result?.success === false).toBe(true);
  expect(mockStore.docs.get(RUN_PATH).actionClaims['0'].status).not.toBe('completed');
}

describe('executeAgentWrite repair memo authorization at the write boundary', () => {
  beforeEach(() => {
    // The real handler captures this db at module load: reset contents, not the db.
    mockStore.docs.clear();
    mockStore.reads = [];
    mockStore.writes = [];
    mockStore.failedReads.clear();
    mockStore.afterClaim = null;
    mockStore.claimCount = 0;
    mockStore.nextId = 0;
    mockStore.failRepairCommit = false;
    mockStore.docs.set(ACCOUNT_PATH, { schoolId: 'pu', role: 'student', status: 'active' });
    mockStore.docs.set(MEMBER_PATH, { status: 'active', role: 'student' });
    mockStore.docs.set(PERMISSIONS_PATH, { createDormRepairRequest: true });
    mockStore.docs.set(RUN_PATH, {
      userId: 'alice', schoolId: 'pu', status: 'completed', createdAt: Date.now(),
      actionProposals: [{ toolName: 'createDormRepairRequest', input: { ...INPUT } }],
    });
  });

  test.each([
    ['disabled', { status: 'disabled' }],
    ['suspended', { status: 'suspended' }],
    ['inactive', { status: 'inactive' }],
    ['deleted', { status: 'deleted' }],
    ['deletion marker', { accountDeletionInProgress: true }],
    ['active with deletion marker', { status: 'active', accountDeletionInProgress: true }],
  ])('rejects an account changed to %s after the proposal claim without saving a memo', async (_, profile) => {
    mockStore.afterClaim = () => mockStore.docs.set(ACCOUNT_PATH, { schoolId: 'pu', ...profile });
    await expectBlockedAfterClaim();
  });

  test.each(['inactive', 'suspended', 'missing'])('rejects %s membership after the claim', async (status) => {
    mockStore.afterClaim = () => status === 'missing'
      ? mockStore.docs.delete(MEMBER_PATH) : mockStore.docs.set(MEMBER_PATH, { status, role: 'student' });
    await expectBlockedAfterClaim();
  });

  test.each(['closed', 'missing'])('rejects %s repair permission after the claim', async (state) => {
    mockStore.afterClaim = () => state === 'missing'
      ? mockStore.docs.delete(PERMISSIONS_PATH)
      : mockStore.docs.set(PERMISSIONS_PATH, { createDormRepairRequest: false });
    await expectBlockedAfterClaim();
  });

  test('an enabled seat permission cannot replace revoked repair permission after the claim', async () => {
    mockStore.afterClaim = () => mockStore.docs.set(PERMISSIONS_PATH, {
      createDormRepairRequest: false, reserveSeat: true,
    });
    await expectBlockedAfterClaim();
    expect(mockStore.reads).toContainEqual({ path: PERMISSIONS_PATH, transaction: true });
  });

  test('a disabled seat permission does not block repair permission after the claim', async () => {
    mockStore.afterClaim = () => mockStore.docs.set(PERMISSIONS_PATH, {
      createDormRepairRequest: true, reserveSeat: false,
    });
    const result = await executeAgentWrite(request());
    expect(result).toMatchObject({
      success: true, toolName: 'createDormRepairRequest', status: 'pending',
      repairId: expect.any(String), requestId: result.repairId, dormitory: 'A棟', room: '301',
    });
    expect(mockStore.claimCount).toBe(1);
    expect(mockStore.reads).toContainEqual({ path: PERMISSIONS_PATH, transaction: true });
    expect(repairDocuments()).toHaveLength(1);
    expect(repairWrites()).toHaveLength(1);
    expect(repairWrites()[0].transaction).toBe(true);
    expect(mockStore.docs.get(RUN_PATH).actionClaims['0'].status).toBe('completed');
  });

  test.each([
    ['account', ACCOUNT_PATH], ['membership', MEMBER_PATH], ['permission', PERMISSIONS_PATH],
  ])('fails closed when the %s source read fails after the claim', async (_, path) => {
    mockStore.afterClaim = () => mockStore.failedReads.add(path);
    await expectBlockedAfterClaim();
    expect(mockStore.reads).toContainEqual({ path, transaction: true });
  });

  test('does not leave a memo when its transaction commit fails', async () => {
    mockStore.afterClaim = () => { mockStore.failRepairCommit = true; };
    await expectBlockedAfterClaim();
  });

  test.each([
    ['active profile', { schoolId: 'pu', status: 'active' }],
    ['legacy profile', { schoolId: 'pu' }],
    ['missing profile', undefined],
  ])('saves one confirmed personal memo for an allowed %s', async (label, profile) => {
    if (profile === undefined) mockStore.docs.delete(ACCOUNT_PATH);
    else mockStore.docs.set(ACCOUNT_PATH, profile);
    const result = await executeAgentWrite(request());
    expect(result).toMatchObject({
      success: true, toolName: 'createDormRepairRequest', status: 'pending',
      repairId: expect.any(String), requestId: result.repairId, dormitory: 'A棟', room: '301',
    });
    expect(repairDocuments()).toEqual([[
      `schools/pu/repairRequests/${result.repairId}`,
      expect.objectContaining({ ...INPUT, schoolId: 'pu', userId: 'alice', images: [], status: 'pending' }),
    ]]);
    expect(repairWrites()).toHaveLength(1);
    expect(mockStore.docs.get(RUN_PATH).actionClaims['0'].status).toBe('completed');
    if (label === 'active profile') {
      for (const path of [ACCOUNT_PATH, MEMBER_PATH, PERMISSIONS_PATH]) {
        expect(mockStore.reads).toContainEqual({ path, transaction: true });
      }
      expect(repairWrites()[0].transaction).toBe(true);
    }
  });

  test('keeps legacy active membership compatibility', async () => {
    mockStore.docs.set(MEMBER_PATH, { role: 'student' });
    expect(await executeAgentWrite(request())).toMatchObject({ success: true });
    expect(repairDocuments()).toHaveLength(1);
  });

  test.each(['input', 'user', 'school', 'expired', 'unfinished'])('rejects a changed %s proposal before any claim or memo write', async (change) => {
    const call = request();
    const proposal = mockStore.docs.get(RUN_PATH);
    if (change === 'input') call.data.input.room = '999';
    if (change === 'user') proposal.userId = 'bob';
    if (change === 'school') {
      call.data.context.schoolId = 'other';
      mockStore.docs.set('schools/other/members/alice', { status: 'active', role: 'student' });
    }
    if (change === 'expired') proposal.createdAt = Date.now() - 31 * 60_000;
    if (change === 'unfinished') proposal.status = 'running';
    await expect(executeAgentWrite(call)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockStore.claimCount).toBe(0);
    expect(repairWrites()).toEqual([]);
  });

  test('retrying a confirmed proposal cannot create a second memo', async () => {
    const first = await executeAgentWrite(request());
    await expect(executeAgentWrite(request())).rejects.toMatchObject({ code: 'already-exists' });
    expect(repairDocuments()).toHaveLength(1);
    expect(repairDocuments()[0][0]).toBe(`schools/pu/repairRequests/${first.repairId}`);
    expect(repairWrites()).toHaveLength(1);
  });

  test('a revoked then restored account must prepare a new proposal instead of retrying its claimed action', async () => {
    mockStore.afterClaim = () => mockStore.docs.set(ACCOUNT_PATH, { schoolId: 'pu', status: 'disabled' });
    await expectBlockedAfterClaim();
    mockStore.docs.set(ACCOUNT_PATH, { schoolId: 'pu', status: 'active' });
    await expect(executeAgentWrite(request())).rejects.toMatchObject({ code: 'already-exists' });
    expect(repairDocuments()).toEqual([]);
    expect(repairWrites()).toEqual([]);
  });
});
