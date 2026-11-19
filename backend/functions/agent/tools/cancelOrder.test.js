const { transactionStore } = require('../../testSupport/transactionStore');
let mockStore;
jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: () => mockStore.db,
}));
const { Timestamp } = require('firebase-admin/firestore');
const tool = require('./cancelOrder');
const { confirmedAgentWrite } = require('../actionReceipt');

const canonical = 'schools/pu/orders/one';
const mirror = 'users/alice/schools/pu/orders/one';
const ctx = { uid: 'alice', schoolId: 'pu' };
const base = {
  orderId: 'one',
  schoolId: 'pu',
  userId: 'alice',
  cafeteriaId: 'cafe',
  status: 'pending',
  total: 100,
  queueNumber: 4,
  queueStatus: 'assigned',
  createdAt: Timestamp.fromMillis(1000),
};

// Keep the old direct get/update/set path executable so regressions expose its
// unsafe writes, rather than merely failing because a mock method is missing.
function cancellationStore() {
  const store = transactionStore([
    [canonical, { ...base }],
    [mirror, { ...base }],
    ['users/alice', { status: 'active' }],
    ['schools/pu/members/alice', { status: 'active' }],
  ]);
  const reads = [];
  const writes = [];
  const originalCollection = store.db.collection;
  const run = store.db.runTransaction;
  let directMirrorFailure = false;
  function changeSource() {
    const change = store.changeSource;
    store.changeSource = undefined;
    change?.();
  }
  function read(path, transactional) {
    reads.push({ path, transactional });
    if (path === store.failReadPath) throw store.readError;
  }
  function wrapCollection(collection) {
    return { ...collection, doc: (id) => wrapRef(collection.doc(id)) };
  }
  function wrapRef(ref) {
    return {
      ...ref,
      collection: (name) => wrapCollection(ref.collection(name)),
      get: async () => {
        read(ref.path, false);
        const snapshot = await ref.get();
        changeSource();
        return snapshot;
      },
      update: async (data) => {
        writes.push({ path: ref.path, transactional: false });
        if (!store.docs.has(ref.path)) throw new Error('missing document');
        store.docs.set(ref.path, { ...store.docs.get(ref.path), ...data });
      },
      set: async (data, options) => {
        writes.push({ path: ref.path, transactional: false });
        if (directMirrorFailure && ref.path === mirror) throw new Error('commit unavailable');
        store.docs.set(ref.path, options?.merge ? { ...store.docs.get(ref.path), ...data } : data);
      },
    };
  }
  store.db.collection = (name) => wrapCollection(originalCollection(name));
  store.db.runTransaction = (callback) => {
    changeSource();
    return run((transaction) => callback({
      ...transaction,
      getAll: async (...refs) => {
        refs.forEach((ref) => read(ref.path, true));
        return transaction.getAll(...refs);
      },
      ...Object.fromEntries(['update', 'set'].map((method) => [
        method,
        (ref, data) => {
          writes.push({ path: ref.path, transactional: true });
          return transaction[method](ref, data);
        },
      ])),
    }));
  };
  const failCommit = store.failNextCommit;
  store.failNextCommit = () => {
    failCommit();
    directMirrorFailure = true;
  };
  return Object.assign(store, { reads, writes });
}

beforeEach(() => {
  mockStore = cancellationStore();
});

test.each(['pending', 'confirmed'])('cancels %s through the shared transaction with complete matching receipts', async (status) => {
  mockStore.docs.set(canonical, { ...base, status });
  mockStore.docs.set(mirror, { status: 'stale', total: 1 });
  const input = { orderId: 'one', reason: '  改變安排  ', userId: 'bob', schoolId: 'other' };

  const result = await tool.execute(ctx, input);

  expect(tool.requiresConfirmation).toBe(true);
  expect(result).toMatchObject({ success: true, orderId: 'one', status: 'cancelled', reused: false });
  expect(confirmedAgentWrite('cancelOrder', result, input)).toBe(true);
  expect(mockStore.docs.get(canonical)).toMatchObject({
    status: 'cancelled',
    cancelReason: '改變安排',
    cancelledBy: 'customer',
    queueNumber: null,
    queueStatus: 'cancelled',
    cancelledQueueNumber: 4,
    total: 100,
  });
  expect(mockStore.docs.get(mirror)).toEqual(mockStore.docs.get(canonical));
  expect(mockStore.reads).toEqual(expect.arrayContaining([
    { path: canonical, transactional: true },
    { path: 'users/alice', transactional: true },
    { path: 'schools/pu/members/alice', transactional: true },
  ]));
  expect(mockStore.writes.every((write) => write.transactional)).toBe(true);
});
test.each([undefined, '', '   '])('keeps the Chinese default cancellation reason for %j', async (reason) => {
  await tool.execute(ctx, { orderId: 'one', reason });
  expect(mockStore.docs.get(canonical).cancelReason).toBe('使用者取消');
});
test('keeps the confirmed input ID in the Agent receipt when the shared service normalizes it', async () => {
  const input = { orderId: ' one ' };

  const result = await tool.execute(ctx, input);

  expect(confirmedAgentWrite('cancelOrder', result, input)).toBe(true);
  expect(mockStore.docs.get(canonical).status).toBe('cancelled');
  expect(mockStore.docs.get(mirror)).toEqual(mockStore.docs.get(canonical));
});
test('cancelled replay repairs the full mirror without overwriting the original reason or time', async () => {
  const original = {
    ...base,
    status: 'cancelled',
    cancelReason: 'first reason',
    cancelledAt: Timestamp.fromMillis(2000),
    updatedAt: Timestamp.fromMillis(2000),
    cancelledBy: 'customer',
    queueNumber: null,
    queueStatus: 'cancelled',
    cancelledQueueNumber: 4,
  };
  mockStore.docs.set(canonical, original);
  mockStore.docs.delete(mirror);

  expect(await tool.execute(ctx, { orderId: 'one', reason: 'later reason' })).toMatchObject({
    success: true,
    orderId: 'one',
    reused: true,
  });

  expect(mockStore.docs.get(canonical)).toEqual(original);
  expect(mockStore.docs.get(mirror)).toEqual(original);
});
test.each(['preparing', 'ready', 'completed', 'unknown', undefined, ''])(
  'rejects %j source status without writes',
  async (status) => {
    const original = { ...base, status };
    mockStore.docs.set(canonical, original);

    await expect(tool.execute(ctx, { orderId: 'one' })).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(mockStore.docs.get(canonical)).toEqual(original);
    expect(mockStore.docs.get(mirror)).toEqual(base);
    expect(mockStore.writes).toEqual([]);
  },
);
test.each([
  ['wrong owner', () => mockStore.docs.set(canonical, { ...base, userId: 'bob' })],
  ['inactive membership', () => mockStore.docs.set('schools/pu/members/alice', { status: 'inactive' })],
  ['missing membership', () => mockStore.docs.delete('schools/pu/members/alice')],
])('rechecks %s before cancellation', async (_label, change) => {
  change();
  const original = new Map(mockStore.docs);

  await expect(tool.execute(ctx, { orderId: 'one' })).rejects.toMatchObject({ code: 'permission-denied' });

  expect(mockStore.docs).toEqual(original);
  expect(mockStore.writes).toEqual([]);
});
test.each([
  { status: 'disabled' },
  { status: 'suspended' },
  { status: 'inactive' },
  { status: 'deleted' },
  { status: 'active', accountDeletionInProgress: true },
  { accountDeletionInProgress: true },
])('rejects an account made unavailable before cancellation %j', async (account) => {
  mockStore.changeSource = () => mockStore.docs.set('users/alice', account);

  await expect(tool.execute(ctx, { orderId: 'one' })).rejects.toMatchObject({
    code: 'failed-precondition',
    details: { reason: 'account-deletion' },
  });

  expect(mockStore.docs.get(canonical)).toEqual(base);
  expect(mockStore.docs.get(mirror)).toEqual(base);
  expect(mockStore.writes).toEqual([]);
});
test('an unavailable account cannot repair an already cancelled mirror', async () => {
  const original = { ...base, status: 'cancelled', cancelReason: 'first' };
  mockStore.docs.set(canonical, original);
  mockStore.docs.delete(mirror);
  mockStore.docs.set('users/alice', { status: 'disabled' });

  await expect(tool.execute(ctx, { orderId: 'one' })).rejects.toMatchObject({
    code: 'failed-precondition',
    details: { reason: 'account-deletion' },
  });

  expect(mockStore.docs.get(canonical)).toEqual(original);
  expect(mockStore.docs.has(mirror)).toBe(false);
  expect(mockStore.writes).toEqual([]);
});
test.each([
  ['active', { status: 'active' }],
  ['legacy', { displayName: 'Alice' }],
  ['missing', undefined],
])('preserves %s account and legacy membership compatibility', async (_label, account) => {
  if (account) mockStore.docs.set('users/alice', account);
  else mockStore.docs.delete('users/alice');
  mockStore.docs.set('schools/pu/members/alice', { role: 'student' });

  expect(await tool.execute(ctx, { orderId: 'one' })).toMatchObject({ success: true });
  expect(mockStore.docs.get(mirror)).toEqual(mockStore.docs.get(canonical));
});
test.each([canonical, 'users/alice', 'schools/pu/members/alice'])(
  'propagates a failed read of %s without writes',
  async (path) => {
    const error = new Error('source unavailable');
    mockStore.failReadPath = path;
    mockStore.readError = error;

    await expect(tool.execute(ctx, { orderId: 'one' })).rejects.toBe(error);

    expect(mockStore.docs.get(canonical)).toEqual(base);
    expect(mockStore.docs.get(mirror)).toEqual(base);
    expect(mockStore.writes).toEqual([]);
  },
);
test.each([
  ['preparing', { ...base, status: 'preparing' }, 'failed-precondition'],
  ['another owner', { ...base, userId: 'bob' }, 'permission-denied'],
  ['missing', undefined, 'not-found'],
])('rechecks a canonical source changed to %s before committing cancellation', async (_label, order, code) => {
  mockStore.changeSource = () => {
    if (order) mockStore.docs.set(canonical, order);
    else mockStore.docs.delete(canonical);
  };

  await expect(tool.execute(ctx, { orderId: 'one' })).rejects.toMatchObject({ code });

  expect(mockStore.docs.get(canonical)).toEqual(order);
  expect(mockStore.docs.get(mirror)).toEqual(base);
  expect(mockStore.writes).toEqual([]);
});
test('failed commits cannot leave a cancelled canonical receipt beside an unchanged mirror', async () => {
  mockStore.failNextCommit();

  await expect(tool.execute(ctx, { orderId: 'one' })).rejects.toThrow('commit unavailable');

  expect(mockStore.docs.get(canonical)).toEqual(base);
  expect(mockStore.docs.get(mirror)).toEqual(base);
  expect(mockStore.writes.every((write) => write.transactional)).toBe(true);
  expect(await tool.execute(ctx, { orderId: 'one' })).toMatchObject({ success: true, reused: false });
  expect(mockStore.docs.get(mirror)).toEqual(mockStore.docs.get(canonical));
});
