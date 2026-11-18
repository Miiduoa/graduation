'use strict';

const { transactionStore } = require('../testSupport/transactionStore');
const { assignQueueNumberHandler, assignNumberForOrder } = require('./queueNumber');

const NOW = new Date('2026-10-13T12:05:00+08:00');
const ORDER_PATH = 'schools/pu/orders/o1';
const MIRROR_PATH = 'users/alice/schools/pu/orders/o1';
const COUNTER_PATH = 'schools/pu/queueCounters/cafe__tpe__2026-10-13';
const ACCOUNT_ERROR = { code: 'failed-precondition', details: { reason: 'account-deletion' } };
const actors = [
  { role: 'customer', uid: 'alice' },
  { role: 'merchant', uid: 'staff' },
  { role: 'system', uid: 'alice' },
];

describe('queue assignment rechecks the acting account in its transaction', () => {
  let store;
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    const order = {
      orderId: 'o1', userId: 'alice', schoolId: 'pu', cafeteriaId: 'cafe',
      status: 'pending', queueNumber: null, queueStatus: 'pending_confirmation',
      paymentMethod: 'onsite', paymentStatus: 'pending', total: 105,
    };
    store = transactionStore([
      ['users/alice', { status: 'active' }],
      ['users/staff', { status: 'active' }],
      ['schools/pu/cafeterias/cafe/operators/staff', { status: 'active' }],
      [ORDER_PATH, order], [MIRROR_PATH, { ...order }],
      ['users/alice/schools/pu/wallet/balance', { available: 1000, pending: 0 }],
      ['paymentIntents/untouched', { userId: 'alice', status: 'pending', amount: 105 }],
    ]);
  });
  afterEach(() => jest.useRealTimers());

  function invoke(actor, extra = {}) {
    if (actor.role === 'system') {
      return assignNumberForOrder(store.db, {
        schoolId: 'pu', orderId: 'o1', uid: actor.uid, actor: 'system', now: NOW, ...extra,
      });
    }
    return assignQueueNumberHandler({ db: store.db })({
      auth: { uid: actor.uid },
      data: { schoolId: 'pu', orderId: 'o1', ...(actor.role === 'merchant' ? { as: 'merchant' } : {}) },
    });
  }

  function observe({ actor, change, readError } = {}) {
    const reads = [];
    const writes = [];
    const runTransaction = store.db.runTransaction.bind(store.db);
    store.db.runTransaction = (callback) => {
      if (change) store.docs.set(`users/${actor.uid}`, change);
      return runTransaction((tx) => callback({
        ...tx,
        get: (reference) => {
          reads.push(reference.path);
          if (readError && reference.path === `users/${actor.uid}`) throw readError;
          return tx.get(reference);
        },
        getAll: (...references) => {
          reads.push(...references.map((reference) => reference.path));
          if (readError && references.some((reference) => reference.path === `users/${actor.uid}`)) throw readError;
          return tx.getAll(...references);
        },
        ...Object.fromEntries(['set', 'update', 'create'].map((method) => [method, (...args) => {
          writes.push(args[0].path);
          return tx[method](...args);
        }])),
      }));
    };
    return { reads, writes };
  }

  function snapshot() {
    return new Map([...store.docs].map(([path, data]) => [path, { ...data }]));
  }

  async function rejectWithoutWrites(actor, state) {
    const readError = state === 'unreadable' ? new Error('account source unavailable') : undefined;
    const change = state === 'unreadable' ? undefined
      : state === 'deleting' ? { accountDeletionInProgress: true } : { status: state };
    const before = snapshot();
    if (change) before.set(`users/${actor.uid}`, change);
    const observed = observe({ actor, change, readError });

    const attempt = invoke(actor);
    if (readError) await expect(attempt).rejects.toBe(readError);
    else await expect(attempt).rejects.toMatchObject(ACCOUNT_ERROR);

    expect(observed.reads).toContain(`users/${actor.uid}`);
    expect(observed.writes).toEqual([]);
    expect(store.docs).toEqual(before);
    expect(store.docs.get(ORDER_PATH)).toBeDefined();
  }

  for (const actor of actors) {
    test.each(['disabled', 'suspended', 'inactive', 'deleted', 'deleting', 'unreadable'])(
      `${actor.role}: a %s account cannot allocate a number or mutate service/payment data`,
      async (state) => rejectWithoutWrites(actor, state),
    );

    test.each(['disabled', 'unreadable'])(
      `${actor.role}: a %s account cannot replay an existing number or repair its receipt`,
      async (state) => {
        store.docs.set(ORDER_PATH, {
          ...store.docs.get(ORDER_PATH), queueNumber: 7,
          queueStatus: actor.role === 'customer' ? 'pending_confirmation' : 'assigned',
        });
        store.docs.delete(MIRROR_PATH);
        store.docs.set(COUNTER_PATH, { vendorId: 'cafe', date: '2026-10-13', nextSerial: 7 });
        await rejectWithoutWrites(actor, state);
      },
    );

    test.each(['assigned', 'cancelled'])(
      `${actor.role}: a cancelled order with a leftover number and %s queue status cannot be replayed`,
      async (queueStatus) => {
        store.docs.set(ORDER_PATH, {
          ...store.docs.get(ORDER_PATH), status: 'cancelled', queueNumber: 7, queueStatus,
        });
        store.docs.set(COUNTER_PATH, { vendorId: 'cafe', date: '2026-10-13', nextSerial: 7 });
        const before = snapshot();
        const observed = observe();

        await expect(invoke(actor)).rejects.toMatchObject({ code: 'failed-precondition' });

        expect(observed.writes).toEqual([]);
        expect(store.docs).toEqual(before);
      },
    );

    test(`${actor.role}: a completed order still returns its existing historical number without writes`, async () => {
      store.docs.set(ORDER_PATH, {
        ...store.docs.get(ORDER_PATH), status: 'completed', queueNumber: 7, queueStatus: 'assigned',
      });
      store.docs.set(COUNTER_PATH, { vendorId: 'cafe', date: '2026-10-13', nextSerial: 7 });
      const before = snapshot();
      const observed = observe();

      await expect(invoke(actor)).resolves.toMatchObject({ queueNumber: 7, reused: true, status: 'completed' });

      expect(observed.writes).toEqual([]);
      expect(store.docs).toEqual(before);
    });

    test.each(['active', 'legacy', 'missing'])(
      `${actor.role}: preserves a %s profile and the shared counter without changing payments`,
      async (state) => {
        if (state === 'missing') store.docs.delete(`users/${actor.uid}`);
        else store.docs.set(`users/${actor.uid}`, state === 'active' ? { status: 'active' } : { displayName: 'Legacy' });
        const beforePayments = [...store.docs].filter(([path]) => path.includes('/wallet/') || path.startsWith('paymentIntents/'));
        const first = await invoke(actor);
        const replay = await invoke(actor);

        expect(first).toMatchObject({ queueNumber: 1, reused: false,
          status: actor.role === 'merchant' ? 'confirmed' : 'pending' });
        expect(replay).toMatchObject({ queueNumber: 1, reused: true });
        expect(store.docs.get(COUNTER_PATH).nextSerial).toBe(1);
        expect(store.docs.get(MIRROR_PATH)).toEqual(store.docs.get(ORDER_PATH));
        expect([...store.docs].filter(([path]) => path.includes('/wallet/') || path.startsWith('paymentIntents/'))).toEqual(beforePayments);
      },
    );
  }

  test.each([null, 7])('an active operator can still handle an existing disabled-buyer order with number %s', async (queueNumber) => {
    store.docs.set('users/alice', { status: 'disabled' });
    store.docs.set(ORDER_PATH, { ...store.docs.get(ORDER_PATH), queueNumber });
    const observed = observe();

    const result = await invoke(actors[1]);

    expect(result).toMatchObject({ queueNumber: queueNumber || 1, status: 'confirmed' });
    expect(observed.reads).not.toContain('users/alice');
    expect(store.docs.get(MIRROR_PATH)).toEqual(store.docs.get(ORDER_PATH));
  });

  test('internal system checks the canonical buyer even if its supplied uid differs', async () => {
    store.docs.set('users/alice', { status: 'suspended' });
    store.docs.set('users/bob', { status: 'active' });
    const before = snapshot();
    const observed = observe();

    await expect(invoke(actors[2], { uid: 'bob' })).rejects.toMatchObject(ACCOUNT_ERROR);

    expect(observed.reads).toContain('users/alice');
    expect(observed.reads).not.toContain('users/bob');
    expect(observed.writes).toEqual([]);
    expect(store.docs).toEqual(before);
  });

  test.each([undefined, 'invalid/owner'])('internal system cannot skip its account source for invalid buyer %s', async (userId) => {
    store.docs.set(ORDER_PATH, { ...store.docs.get(ORDER_PATH), userId, queueNumber: 7, queueStatus: 'assigned' });
    const before = snapshot();
    const observed = observe();

    await expect(invoke(actors[2], { uid: undefined })).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(observed.writes).toEqual([]);
    expect(store.docs).toEqual(before);
  });
});
