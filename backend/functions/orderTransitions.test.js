jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: jest.fn(),
}));
const { Timestamp, getFirestore } = require('firebase-admin/firestore');
const { createOrderStatusHandlers } = require('./orderTransitions');
const { createTimeoutOrderProcessor } = require('./ordering/orderTimeoutOperations');
const { transactionStore } = require('./testSupport/transactionStore');

const canonical = 'schools/pu/orders/one';
const mirror = 'users/alice/schools/pu/orders/one';
const stamp = Timestamp.fromMillis(1000);
const base = {
  orderId: 'one',
  schoolId: 'pu',
  userId: 'alice',
  cafeteriaId: 'cafe',
  status: 'pending',
  total: 100,
  paymentStatus: 'pending',
  createdAt: stamp,
};
const request = (status, uid = 'operator', data = {}) => ({
  auth: { uid },
  data: { schoolId: 'pu', orderId: 'one', status, ...data },
});
let store, handlers, push, logger;
beforeEach(() => {
  store = transactionStore([
    [canonical, { ...base }],
    [mirror, { ...base }],
    ['schools/pu/members/alice', { status: 'active' }],
    ['schools/pu/members/admin', { status: 'active', role: 'admin' }],
    ['schools/pu/cafeterias/cafe/operators/operator', { status: 'active' }],
  ]);
  push = jest.fn().mockResolvedValue({ status: 'accepted', accepted: 1, failed: 0 });
  logger = { warn: jest.fn() };
  handlers = createOrderStatusHandlers({ db: store.db, sendPushToUser: push, logger });
});
function setStatus(status) {
  store.docs.set(canonical, { ...base, status });
  store.docs.set(mirror, { ...base, status });
}
const next = {
  pending: 'confirmed',
  confirmed: 'preparing',
  preparing: 'ready',
  ready: 'completed',
};
const targets = ['confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
const states = ['pending', ...targets];
test.each(states.flatMap((from) => targets.map((to) => [from, to])))(
  '%s → %s preserves only legal transitions',
  async (from, to) => {
    setStatus(from);
    const legal = from === to || next[from] === to || (to === 'cancelled' && from in next);
    if (!legal) {
      await expect(handlers.updateOrderStatus(request(to))).rejects.toMatchObject({
        code: 'failed-precondition',
      });
      expect(store.docs.get(canonical).status).toBe(from);
      expect(push).not.toHaveBeenCalled();
    } else {
      expect(await handlers.updateOrderStatus(request(to))).toMatchObject({
        success: true,
        status: to,
        reused: from === to,
      });
      expect(store.docs.get(canonical).status).toBe(to);
    }
    expect(store.docs.get(mirror)).toEqual(store.docs.get(canonical));
  },
);
test.each(states)(
  'customer cancellation from %s follows the existing preparation boundary',
  async (status) => {
    setStatus(status);
    if (['pending', 'confirmed', 'cancelled'].includes(status)) {
      expect(await handlers.cancelOrder(request(undefined, 'alice'))).toMatchObject({
        success: true,
        reused: status === 'cancelled',
      });
      expect(store.docs.get(canonical).status).toBe('cancelled');
    } else
      await expect(handlers.cancelOrder(request(undefined, 'alice'))).rejects.toMatchObject({
        code: 'failed-precondition',
      });
    expect(store.docs.get(mirror)).toEqual(store.docs.get(canonical));
  },
);
test('same target retries repair the mirror without replacing timestamps, reasons or sending duplicate notifications', async () => {
  const first = await handlers.updateOrderStatus(request('cancelled'));
  const original = store.docs.get(canonical);
  store.docs.delete(mirror);
  expect(first.reused).toBe(false);
  expect(await handlers.updateOrderStatus(request('cancelled'))).toMatchObject({
    reused: true,
    notification: { status: 'not_requested' },
  });
  expect(store.docs.get(canonical)).toEqual(original);
  expect(store.docs.get(mirror)).toEqual(original);
  expect(push).toHaveBeenCalledTimes(1);
  await handlers.cancelOrder(request(undefined, 'alice', { reason: 'overwrite' }));
  expect(store.docs.get(canonical)).toEqual(original);
});
test('customer retries preserve the original cancellation reason', async () => {
  await handlers.cancelOrder(request(undefined, 'alice', { reason: 'first' }));
  const original = store.docs.get(canonical);
  await handlers.cancelOrder(request(undefined, 'alice', { reason: 'later' }));
  expect(store.docs.get(canonical)).toEqual(original);
  expect(original.cancelReason).toBe('first');
  expect(push).not.toHaveBeenCalled();
});
test('admin/editor override and cafeteria operator access retain their existing scopes', async () => {
  await expect(handlers.updateOrderStatus(request('confirmed', 'stranger'))).rejects.toMatchObject({
    code: 'permission-denied',
  });
  store.docs.get('schools/pu/members/admin').status = 'inactive';
  await expect(handlers.updateOrderStatus(request('confirmed', 'admin'))).rejects.toMatchObject({
    code: 'permission-denied',
  });
  store.docs.set('schools/pu/members/admin', { role: 'editor', status: 'active' });
  delete store.docs.get(canonical).cafeteriaId;
  await expect(handlers.updateOrderStatus(request('confirmed'))).rejects.toMatchObject({
    code: 'permission-denied',
  });
  expect(await handlers.updateOrderStatus(request('confirmed', 'admin'))).toMatchObject({
    success: true,
  });
});
test('customer authorization is rechecked even for an already cancelled order', async () => {
  setStatus('cancelled');
  await expect(handlers.cancelOrder(request(undefined, 'bob'))).rejects.toMatchObject({
    code: 'permission-denied',
  });
  store.docs.get('schools/pu/members/alice').status = 'inactive';
  await expect(handlers.cancelOrder(request(undefined, 'alice'))).rejects.toMatchObject({
    code: 'permission-denied',
  });
});
test.each([{ schoolId: 'a/b' }, { orderId: {} }, { status: 'pending' }, { status: 'unknown' }])(
  'malformed input never writes %j',
  async (data) => {
    await expect(
      handlers.updateOrderStatus(request('confirmed', 'operator', data)),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(store.docs.get(canonical)).toEqual(base);
  },
);
test('unauthenticated, missing and mismatched canonical receipts fail closed', async () => {
  await expect(
    handlers.updateOrderStatus({ data: request('confirmed').data }),
  ).rejects.toMatchObject({ code: 'unauthenticated' });
  await expect(
    handlers.updateOrderStatus(request('confirmed', 'operator', { orderId: 'missing' })),
  ).rejects.toMatchObject({ code: 'not-found' });
  for (const patch of [
    { schoolId: 'other' },
    { orderId: 'other' },
    { userId: '../other' },
    { status: 'unknown' },
  ]) {
    store.docs.set(canonical, { ...base, ...patch });
    await expect(handlers.updateOrderStatus(request('confirmed'))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(store.docs.get(mirror)).toEqual(base);
  }
});
test('commit failures never split receipts or emit a notification; retry can commit once', async () => {
  store.failNextCommit();
  await expect(handlers.updateOrderStatus(request('cancelled'))).rejects.toThrow(
    'commit unavailable',
  );
  expect(store.docs.get(canonical)).toEqual(base);
  expect(store.docs.get(mirror)).toEqual(base);
  expect(push).not.toHaveBeenCalled();
  expect((await handlers.updateOrderStatus(request('cancelled'))).reused).toBe(false);
  expect(push).toHaveBeenCalledTimes(1);
});
test.each(['status', 'permission'])('a transaction retry rechecks changed %s', async (kind) => {
  const run = store.db.runTransaction;
  store.db.runTransaction = async (callback) => {
    store.failNextCommit();
    await expect(run(callback)).rejects.toThrow('commit unavailable');
    if (kind === 'status') {
      setStatus('completed');
    } else store.docs.get('schools/pu/cafeterias/cafe/operators/operator').status = 'inactive';
    return run(callback);
  };
  await expect(handlers.updateOrderStatus(request('cancelled'))).rejects.toMatchObject({
    code: kind === 'status' ? 'failed-precondition' : 'permission-denied',
  });
  expect(store.docs.get(mirror)).toEqual(store.docs.get(canonical));
  expect(push).not.toHaveBeenCalled();
});
test('notification failure reports the committed order truthfully', async () => {
  push.mockRejectedValue(new Error('provider offline'));
  expect(await handlers.updateOrderStatus(request('cancelled'))).toMatchObject({
    success: true,
    notification: { status: 'failed' },
  });
  expect(store.docs.get(canonical).status).toBe('cancelled');
  expect(store.docs.get(mirror)).toEqual(store.docs.get(canonical));
  expect(logger.warn).toHaveBeenCalledTimes(1);
});
test('timeout requires a valid persisted time, original status and exact elapsed boundary', async () => {
  const processOrder = createTimeoutOrderProcessor({
    db: store.db,
    sendPushToUser: push,
    now: () => 601000,
    logger,
  });
  const input = { schoolId: 'pu', orderId: 'one', expectedStatus: 'pending' };
  expect(await processOrder(input)).toMatchObject({ changed: false });
  store.docs.get(canonical).createdAt = 'invalid';
  expect(await processOrder(input)).toMatchObject({ changed: false });
  store.docs.get(canonical).createdAt = Timestamp.fromMillis(0);
  setStatus('confirmed');
  expect(await processOrder(input)).toMatchObject({ changed: false });
  setStatus('pending');
  store.docs.get(canonical).createdAt = Timestamp.fromMillis(0);
  expect(await processOrder(input)).toMatchObject({ changed: true });
  expect(await processOrder(input)).toMatchObject({ changed: false });
  expect(store.docs.get(canonical).cancelReason).toBe('system_timeout');
  expect(store.docs.get(mirror)).toEqual(store.docs.get(canonical));
  expect(push).toHaveBeenCalledTimes(1);
  expect(push.mock.calls[0][1].body).not.toContain('退款');
});
test.each(['preparing', 'ready'])('%s timeout updates both receipts once', async (status) => {
  setStatus(status);
  const processOrder = createTimeoutOrderProcessor({
    db: store.db,
    sendPushToUser: push,
    now: () => 3600000,
    logger,
  });
  expect(
    await processOrder({ schoolId: 'pu', orderId: 'one', expectedStatus: status }),
  ).toMatchObject({ changed: true });
  expect(
    await processOrder({ schoolId: 'pu', orderId: 'one', expectedStatus: status }),
  ).toMatchObject({ changed: false });
  expect(store.docs.get(canonical).status).toBe(status === 'preparing' ? 'preparing' : 'cancelled');
  expect(store.docs.get(mirror)).toEqual(store.docs.get(canonical));
  expect(push).toHaveBeenCalledTimes(1);
});
test('the deployed callable bindings use the transactional handlers', async () => {
  getFirestore.mockReturnValue(store.db);
  const exported = require('./index');
  expect(await exported.updateOrderStatus.run(request('confirmed'))).toMatchObject({
    success: true,
    status: 'confirmed',
  });
  expect(await exported.cancelOrder.run(request(undefined, 'alice'))).toMatchObject({
    success: true,
    status: 'cancelled',
  });
  expect(store.docs.get(mirror)).toEqual(store.docs.get(canonical));
});

test.each(
  ['production', 'preview', 'development'].flatMap((environment) =>
    ['walletHold', 'walletCapture', 'walletRelease', 'refundCaptured'].flatMap((operation) =>
      ['member', 'admin', 'anonymous'].map((role) => [environment, operation, role]),
    ),
  ),
)('%s %s never accesses a wallet or provider for %s', async (environment, operation, role) => {
  getFirestore.mockReturnValue(store.db);
  const exported = require('./index');
  const previousEnv = process.env.APP_ENV;
  process.env.APP_ENV = environment;
  const original = new Map(store.docs);
  const fetchSpy = jest
    .spyOn(global, 'fetch')
    .mockRejectedValue(new Error('Provider must not be contacted'));
  getFirestore.mockClear();
  try {
    await expect(
      exported[operation].run({
        auth:
          role === 'anonymous'
            ? undefined
            : { uid: role, token: { role, admin: role === 'admin' } },
        data: {
          schoolId: 'pu',
          orderId: 'one',
          holdId: 'someone-elses-hold',
          walletHoldId: 'someone-elses-hold',
          amount: 99999,
          paymentMethod: 'campus_card',
        },
      }),
    ).rejects.toMatchObject({
      code: role === 'anonymous' ? 'unauthenticated' : 'failed-precondition',
    });
    expect(getFirestore).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store.docs).toEqual(original);
  } finally {
    fetchSpy.mockRestore();
    if (previousEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previousEnv;
  }
});
