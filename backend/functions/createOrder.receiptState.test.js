'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const { createOrderHandler } = require('./createOrder');
const { createOrderStatusHandlers } = require('./orderTransitions');
const queue = require('./ordering/queueNumber');
const { transactionStore } = require('./testSupport/transactionStore');

const request = {
  auth: { uid: 'alice' },
  data: {
    schoolId: 'pu', cafeteriaId: 'cafe', requestId: 'receipt-state',
    items: [{ menuItemId: 'rice', quantity: 1 }], paymentMethod: 'onsite', expectedTotal: 105,
  },
};

describe('createOrder receipts preserve the observed order lifecycle', () => {
  let store;
  let create;
  let transitions;
  beforeEach(() => {
    store = transactionStore([
      ['users/alice', { status: 'active' }],
      ['users/staff', { status: 'active' }],
      ['schools/pu/members/alice', { status: 'active' }],
      ['schools/pu/cafeterias/cafe', { name: 'Fixture', merchantId: 'merchant', orderingEnabled: true, pilotStatus: 'live' }],
      ['schools/pu/cafeterias/cafe/operators/staff', { status: 'active' }],
      ['schools/pu/menus/rice', { cafeteriaId: 'cafe', name: 'Fixture rice', price: 100, available: true, orderingEnabled: true }],
    ]);
    create = createOrderHandler({ db: store.db });
    transitions = createOrderStatusHandlers({ db: store.db, sendPushToUser: async () => ({ status: 'sent' }) });
  });
  afterEach(() => jest.restoreAllMocks());

  const canonical = (id) => `schools/pu/orders/${id}`;
  const mirror = (id) => `users/alice/schools/pu/orders/${id}`;
  const counters = () => [...store.docs].filter(([path]) => path.includes('/queueCounters/'));
  async function changeStatus(orderId, status) {
    if (status === 'cancelled') {
      return transitions.cancelOrder({ auth: { uid: 'alice' }, data: { schoolId: 'pu', orderId } });
    }
    for (const next of ['confirmed', 'preparing', 'ready', 'completed']) {
      await transitions.updateOrderStatus({ auth: { uid: 'staff' }, data: { schoolId: 'pu', orderId, status: next } });
      if (next === status) break;
    }
  }
  function afterCreation(change) {
    const transact = store.db.runTransaction.bind(store.db);
    let changed = false;
    store.db.runTransaction = async (callback) => {
      const result = await transact(callback);
      if (!changed) {
        changed = true;
        await change(result);
      }
      return result;
    };
  }

  test.each([
    ['cancelled', null, 'cancelled'],
    ['cancelled', 7, 'cancelled'],
    ['completed', null, 'completed'],
    ['completed', 7, 'assigned'],
  ])('replays an existing %s order (stored number %s) without restarting queue allocation', async (status, storedNumber, queueStatus) => {
    const first = await create(request);
    await changeStatus(first.orderId, status);
    const order = { ...store.docs.get(canonical(first.orderId)), queueNumber: storedNumber };
    store.docs.set(canonical(first.orderId), order);
    const beforeCounters = counters();
    const assign = jest.spyOn(queue, 'assignNumberForOrder');

    const replay = await create(request);

    expect(replay).toMatchObject({ success: true, reused: true, status, queueStatus,
      queueNumber: status === 'cancelled' ? null : storedNumber });
    expect(replay).not.toHaveProperty('orderOutcome');
    expect(assign).not.toHaveBeenCalled();
    expect(counters()).toEqual(beforeCounters);
    expect(store.docs.get(canonical(first.orderId))).toEqual(order);
    expect(store.docs.get(mirror(first.orderId))).toEqual(order);
  });

  test.each(['cancelled', 'completed'])(
    'reports %s when a real status transaction commits between creation and numbering',
    async (status) => {
      let afterChange;
      afterCreation(async ({ orderId }) => {
        await changeStatus(orderId, status);
        afterChange = new Map(store.docs);
      });

      const result = await create(request);

      expect(result).toMatchObject({ success: true, reused: false, status, queueNumber: null, queueStatus: status });
      expect(result).not.toHaveProperty('orderOutcome');
      expect(counters()).toEqual([]);
      expect(store.docs).toEqual(afterChange);
    },
  );

  test.each(['confirmed', 'preparing', 'ready', 'completed'])(
    'preserves the %s status observed by a successful queue transaction',
    async (status) => {
      afterCreation(async ({ orderId }) => {
        // A completed order can only return its existing historical number.
        if (status === 'completed') await queue.assignNumberForOrder(store.db, {
          schoolId: 'pu', orderId, uid: 'alice', actor: 'system',
        });
        await changeStatus(orderId, status);
      });

      const result = await create(request);

      expect(result).toMatchObject({ success: true, status, queueNumber: 1, queueStatus: 'assigned' });
      expect(counters()).toHaveLength(1);
      expect(counters()[0][1].nextSerial).toBe(1);
      expect(store.docs.get(canonical(result.orderId)).status).toBe(status);
      expect(store.docs.get(mirror(result.orderId))).toEqual(store.docs.get(canonical(result.orderId)));
    },
  );

  test.each([
    new Error('Order is already closed'),
    new HttpsError('failed-precondition', 'Order is already closed', { status: 'cancelled', queueStatus: 'cancelled' }),
    Object.assign(new Error('fixture forged fields'), {
      orderState: { status: 'cancelled', schoolId: 'pu', userId: 'alice' },
    }),
  ])('does not infer terminal state from untrusted queue error text or details (%s)', async (error) => {
    jest.spyOn(queue, 'assignNumberForOrder').mockRejectedValueOnce(error);

    const result = await create(request);

    expect(result).toMatchObject({ success: true, status: 'pending', queueNumber: null, queueStatus: 'pending_confirmation' });
    expect(result).not.toHaveProperty('orderOutcome');
    expect(store.docs.get(canonical(result.orderId)).status).toBe('pending');
    expect(counters()).toEqual([]);
  });

  test.each(['account', 'order', 'wrong owner', 'wrong school', 'wrong order identity'])(
    'does not attest cancellation when the queue source has %s failure',
    async (failure) => {
      afterCreation(async ({ orderId }) => {
        await changeStatus(orderId, 'cancelled');
        const path = canonical(orderId);
        const corrupt = failure === 'wrong owner' ? { userId: 'bob' }
          : failure === 'wrong school' ? { schoolId: 'other' }
            : failure === 'wrong order identity' ? { orderId: 'other' } : null;
        if (corrupt) store.docs.set(path, { ...store.docs.get(path), ...corrupt });
        else {
          const transact = store.db.runTransaction.bind(store.db);
          store.db.runTransaction = (callback) => transact((tx) => callback({
            ...tx,
            get: (ref) => {
              if (ref.path === (failure === 'account' ? 'users/alice' : path)) {
                throw new HttpsError('unavailable', 'Order is already closed');
              }
              return tx.get(ref);
            },
          }));
        }
      });

      const result = await create(request);

      expect(result).toMatchObject({ success: true, status: 'pending', queueNumber: null, queueStatus: 'pending_confirmation' });
      expect(result).not.toHaveProperty('orderOutcome');
      expect(counters()).toEqual([]);
    },
  );

  test.each([
    { schoolId: 'other' },
    { orderId: 'other' },
    { status: 'unrecognized' },
  ])('does not adopt an existing-number receipt from malformed canonical data %j', async (corrupt) => {
    afterCreation(async ({ orderId }) => {
      store.docs.set(canonical(orderId), {
        ...store.docs.get(canonical(orderId)), queueNumber: 7, queueStatus: 'assigned', ...corrupt,
      });
    });

    const result = await create(request);

    expect(result).toMatchObject({ success: true, status: 'pending', queueNumber: null, queueStatus: 'pending_confirmation' });
    expect(result).not.toHaveProperty('orderOutcome');
    expect(counters()).toEqual([]);
  });

  test.each([
    ['completed', 7],
    ['pending', 7],
    ['confirmed', 7],
    ['pending', null],
  ])('does not accept or allocate a %s queue number %s after the canonical buyer changes', async (status, queueNumber) => {
    let afterChange;
    afterCreation(async ({ orderId }) => {
      store.docs.set('users/bob', { status: 'active' });
      store.docs.set(canonical(orderId), {
        ...store.docs.get(canonical(orderId)), userId: 'bob', status, queueNumber,
        queueStatus: queueNumber == null ? 'pending_confirmation' : 'assigned',
      });
      afterChange = new Map(store.docs);
    });

    const result = await create(request);

    expect(result).toMatchObject({ success: true, userId: 'alice', status: 'pending',
      queueNumber: null, queueStatus: 'pending_confirmation' });
    expect(result).not.toHaveProperty('orderOutcome');
    expect(store.docs).toEqual(afterChange);
    expect(store.docs.has(`users/bob/schools/pu/orders/${result.orderId}`)).toBe(false);
    expect(counters()).toEqual([]);
  });
});
