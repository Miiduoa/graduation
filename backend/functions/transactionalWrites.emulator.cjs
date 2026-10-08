/* global process, fetch */
const { after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createGroupMembershipHandlers } = require('./groupMembership');
const { createOrderHandler } = require('./createOrder');
const { createSubmitProductFeedback } = require('./productFeedback');

const emulatorHost = /^(?:127\.0\.0\.1|localhost|0\.0\.0\.0):([0-9]{1,5})$/.exec(
  process.env.FIRESTORE_EMULATOR_HOST || '',
);
if (!emulatorHost || Number(emulatorHost[1]) < 1 || Number(emulatorHost[1]) > 65535) {
  throw new Error('Run only with an explicit local FIRESTORE_EMULATOR_HOST');
}
const host = `127.0.0.1:${emulatorHost[1]}`;
process.env.FIRESTORE_EMULATOR_HOST = host;
const projectId = 'demo-campus-order-concurrency';
const app = initializeApp({ projectId }, 'transaction-concurrency-tests');
const db = getFirestore(app);
const membership = () => createGroupMembershipHandlers({ db });
const join = (uid = 'alice') =>
  membership().joinGroupByCode({
    auth: { uid },
    data: { schoolId: 'pu', joinCode: 'JOINONE' },
  });
const leave = (uid = 'alice') =>
  membership().leaveGroup({ auth: { uid }, data: { groupId: 'one' } });
const order = (uid = 'alice', change = {}) =>
  createOrderHandler({ db })({
    auth: { uid },
    data: {
      schoolId: 'pu',
      cafeteriaId: 'cafe',
      requestId: 'one-attempt',
      items: [{ menuItemId: 'rice', quantity: 2, price: -100 }],
      paymentMethod: 'onsite',
      expectedTotal: 210,
      ...change,
    },
  });
const read = async (path) => (await db.doc(path).get()).data();
const feedback = (uid = 'alice', change = {}) =>
  createSubmitProductFeedback({ db })({
    auth: { uid },
    data: {
      requestId: 'feedback-request-0001',
      schoolId: 'pu',
      kind: 'general',
      feedbackType: 'bug',
      title: '公告無法載入',
      description: '切換學校後的畫面沒有更新。',
      ...change,
    },
  });
beforeEach(async () => {
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  assert.equal(response.ok, true);
  const batch = db.batch();
  const seeds = [
    [
      'groups/one',
      { schoolId: 'pu', name: 'Real club', type: 'club', joinCode: 'JOINONE', memberCount: 1 },
    ],
    ['groups/one/members/owner', { uid: 'owner', role: 'owner', status: 'active' }],
    ...['owner', 'alice', 'bob', 'charlie'].map((uid) => [
      `schools/pu/members/${uid}`,
      { status: 'active' },
    ]),
    [
      'schools/pu/cafeterias/cafe',
      {
        name: 'Real cafeteria',
        merchantId: 'merchant',
        pilotStatus: 'live',
        orderingEnabled: true,
      },
    ],
    ['schools/pu/cafeterias/cafe/operators/operator', { status: 'active' }],
    [
      'schools/pu/menus/rice',
      { cafeteriaId: 'cafe', name: 'Rice', price: 100, orderingEnabled: true, available: true },
    ],
  ];
  for (const [path, data] of seeds) batch.set(db.doc(path), data);
  await batch.commit();
});
after(async () => {
  await db.terminate();
  await deleteApp(app);
});

test('concurrent feedback retries persist one receipt with a server timestamp', async () => {
  const results = await Promise.all(Array.from({ length: 4 }, () => feedback()));
  assert.equal(results.filter((result) => !result.reused).length, 1);
  assert.equal(new Set(results.map((result) => result.feedbackId)).size, 1);
  const documents = await db.collection('feedback').get();
  assert.equal(documents.size, 1);
  assert.equal(documents.docs[0].data().submittedBy, 'alice');
  assert.ok(documents.docs[0].data().createdAt.toMillis() > 0);
});

test('concurrent changed feedback with one key commits one intent', async () => {
  const results = await Promise.allSettled([
    feedback(),
    feedback('alice', { title: '另一個問題' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(
    results.find((result) => result.status === 'rejected').reason.code,
    'already-exists',
  );
  assert.equal((await db.collection('feedback').get()).size, 1);
});

test('feedback accounts remain separate and revoked members cannot reuse a receipt', async () => {
  const [alice, bob] = await Promise.all([feedback(), feedback('bob')]);
  assert.notEqual(alice.feedbackId, bob.feedbackId);
  assert.equal((await db.collection('feedback').get()).size, 2);
  await db.doc('schools/pu/members/alice').update({ status: 'inactive' });
  await assert.rejects(feedback(), { code: 'permission-denied' });
  assert.equal((await db.collection('feedback').get()).size, 2);
});

test('concurrent joins and leaves from fresh sessions change count once and preserve mirrors', async () => {
  const joins = await Promise.all(Array.from({ length: 4 }, () => join()));
  assert.equal(joins.filter((result) => !result.reused).length, 1);
  assert.equal((await read('groups/one')).memberCount, 2);
  assert.equal((await read('groups/one/members/alice')).status, 'active');
  assert.equal((await read('users/alice/groups/one')).status, 'active');
  const leaves = await Promise.all(Array.from({ length: 4 }, () => leave()));
  assert.equal(leaves.filter((result) => !result.reused).length, 1);
  assert.equal((await read('groups/one')).memberCount, 1);
  assert.equal((await read('groups/one/members/alice')).status, 'left');
  assert.equal((await read('users/alice/groups/one')).status, 'left');
});
test('different users joining concurrently have no lost count increment', async () => {
  await Promise.all(['alice', 'bob', 'charlie'].map((uid) => join(uid)));
  assert.equal((await read('groups/one')).memberCount, 4);
  for (const uid of ['alice', 'bob', 'charlie']) {
    assert.equal((await read(`groups/one/members/${uid}`)).status, 'active');
    assert.equal((await read(`users/${uid}/groups/one`)).status, 'active');
  }
});
test('competing join and leave remain consistent with the final membership', async () => {
  await join();
  await Promise.all([leave(), join(), leave(), join()]);
  const member = await read('groups/one/members/alice');
  const mirror = await read('users/alice/groups/one');
  assert.equal(mirror.status, member.status);
  assert.equal((await read('groups/one')).memberCount, member.status === 'active' ? 2 : 1);
});
test('owner exit is rejected and never changes active membership or count', async () => {
  await assert.rejects(leave('owner'), { code: 'failed-precondition' });
  assert.equal((await read('groups/one')).memberCount, 1);
  assert.equal((await read('groups/one/members/owner')).status, 'active');
});
test('concurrent identical orders create exactly one server priced receipt and durable request key', async () => {
  const results = await Promise.all(Array.from({ length: 4 }, () => order()));
  assert.equal(results.filter((result) => !result.reused).length, 1);
  assert.equal(new Set(results.map((result) => result.orderId)).size, 1);
  for (const result of results) assert.equal(result.total, 210);
  const [canonical, mirrors, keys] = await Promise.all([
    db.collection('schools/pu/orders').get(),
    db.collection('users/alice/schools/pu/orders').get(),
    db.collection('_orderRequests').get(),
  ]);
  assert.equal(canonical.size, 1);
  assert.equal(mirrors.size, 1);
  assert.equal(keys.size, 1);
  assert.deepEqual(canonical.docs[0].data(), mirrors.docs[0].data());
  assert.equal(canonical.docs[0].data().items[0].price, 100);
  assert.equal(canonical.docs[0].data().paymentStatus, 'pending');
  await db.doc('schools/pu/menus/rice').update({ price: 200 });
  assert.equal((await order()).total, 210);
});
test('concurrent same key with different payload commits one intent and rejects the other', async () => {
  const results = await Promise.allSettled([
    order(),
    order('alice', { items: [{ menuItemId: 'rice', quantity: 1 }], expectedTotal: 105 }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejection = results.find((result) => result.status === 'rejected');
  assert.equal(rejection.reason.code, 'already-exists');
  assert.equal((await db.collection('schools/pu/orders').get()).size, 1);
  assert.equal((await db.collection('_orderRequests').get()).size, 1);
});
test('the same request ID across accounts cannot share an order or receipt', async () => {
  const [alice, bob] = await Promise.all([order('alice'), order('bob')]);
  assert.notEqual(alice.orderId, bob.orderId);
  assert.equal(alice.userId, 'alice');
  assert.equal(bob.userId, 'bob');
  assert.equal((await db.collection('schools/pu/orders').get()).size, 2);
  assert.equal((await db.collection('users/alice/schools/pu/orders').get()).size, 1);
  assert.equal((await db.collection('users/bob/schools/pu/orders').get()).size, 1);
});

test('competing accepted and rejected intents cannot both produce final outcomes for the same key', async () => {
  const results = await Promise.allSettled([order(), order('alice', { expectedTotal: 1 })]);
  const successes = results.filter((result) => result.status === 'fulfilled');
  const notCreated = results.filter(
    (result) =>
      result.status === 'rejected' && result.reason.details?.orderOutcome === 'not_created',
  );
  assert.equal(successes.length + notCreated.length, 1);
  assert.equal(
    results.filter(
      (result) => result.status === 'rejected' && result.reason.code === 'already-exists',
    ).length,
    1,
  );
  assert.equal((await db.collection('schools/pu/orders').get()).size, successes.length);
  assert.equal((await db.collection('users/alice/schools/pu/orders').get()).size, successes.length);
  assert.equal((await db.collection('_orderRequests').get()).size, 1);
});
test('a committed rejection remains rejected after menu repair and requires a new reviewed request', async () => {
  await db.doc('schools/pu/menus/rice').update({ available: false });
  const results = await Promise.allSettled([order(), order(), order()]);
  for (const result of results) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason.details.orderOutcome, 'not_created');
  }
  assert.equal((await db.collection('schools/pu/orders').get()).size, 0);
  assert.equal((await db.collection('_orderRequests').get()).size, 1);
  await db.doc('schools/pu/menus/rice').update({ available: true });
  await assert.rejects(order(), (error) => error.details?.orderOutcome === 'not_created');
  assert.equal((await order('alice', { requestId: 'reviewed-new-attempt' })).reused, false);
  assert.equal((await db.collection('schools/pu/orders').get()).size, 1);
});

const { createOrderStatusHandlers } = require('./orderTransitions');
const { createTimeoutOrderProcessor } = require('./ordering/orderTimeoutOperations');
const { createInspectionEnforcement } = require('./ordering/inspectionEnforcement');
const { Timestamp } = require('firebase-admin/firestore');
const statusRequest = (id, status, uid = 'operator') => ({
  auth: { uid },
  data: { schoolId: 'pu', orderId: id, status },
});
const statusHandlers = (database = db, notify = async () => ({ status: 'accepted' })) =>
  createOrderStatusHandlers({ db: database, sendPushToUser: notify });
const updateOrder = (id, status) => statusHandlers().updateOrderStatus(statusRequest(id, status));
async function assertReceipts(id) {
  const canonical = await read(`schools/pu/orders/${id}`);
  assert.deepEqual(await read(`users/alice/schools/pu/orders/${id}`), canonical);
  return canonical;
}
async function setupOrder(status = 'pending') {
  const result = await order();
  for (const next of ['confirmed', 'preparing', 'ready', 'completed']) {
    if (status === 'pending') break;
    await updateOrder(result.orderId, next);
    if (status === next) break;
  }
  return result.orderId;
}
async function inspectionEvent(score = 50) {
  const reference = db.doc('schools/pu/inspections/review');
  await reference.set({ score, vendorId: 'cafe', overallComment: '檢查' });
  return {
    params: { schoolId: 'pu', inspectionId: 'review' },
    data: { after: await reference.get() },
  };
}
function injectedDatabase(beforeTransaction) {
  let attempts = 0;
  return {
    collection: db.collection.bind(db),
    runTransaction: async (callback) => {
      await beforeTransaction(++attempts);
      return db.runTransaction(callback);
    },
  };
}

test('concurrent merchant retries advance once with identical server timestamps and one notification', async () => {
  const id = await setupOrder('preparing');
  let notifications = 0;
  const handler = statusHandlers(db, async () => {
    notifications++;
    return { status: 'accepted' };
  });
  const results = await Promise.all(
    Array.from({ length: 4 }, () => handler.updateOrderStatus(statusRequest(id, 'ready'))),
  );
  assert.equal(results.filter((result) => !result.reused).length, 1);
  assert.equal(notifications, 1);
  const receipt = await assertReceipts(id);
  assert.equal(receipt.status, 'ready');
  assert.ok(receipt.readyAt.toMillis() > 0);
  assert.equal(receipt.updatedAt.toMillis(), receipt.readyAt.toMillis());
  await db.doc(`users/alice/schools/pu/orders/${id}`).delete();
  assert.equal((await handler.updateOrderStatus(statusRequest(id, 'ready'))).reused, true);
  assert.deepEqual(await assertReceipts(id), receipt);
  assert.equal(notifications, 1);
});

test('customer cancellation competing with preparation commits exactly one legal outcome', async () => {
  const id = await setupOrder('confirmed');
  const results = await Promise.allSettled([
    updateOrder(id, 'preparing'),
    statusHandlers().cancelOrder(statusRequest(id, undefined, 'alice')),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(
    results.find((result) => result.status === 'rejected').reason.code,
    'failed-precondition',
  );
  assert.ok(['preparing', 'cancelled'].includes((await assertReceipts(id)).status));
});

test('merchant completion competing with cancellation cannot reopen a terminal order', async () => {
  const id = await setupOrder('ready');
  const results = await Promise.allSettled([
    updateOrder(id, 'completed'),
    updateOrder(id, 'cancelled'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(
    results.find((result) => result.status === 'rejected').reason.code,
    'failed-precondition',
  );
  assert.ok(['completed', 'cancelled'].includes((await assertReceipts(id)).status));
});

test('mirror write failure rolls the real transaction back before status or notification can escape', async () => {
  const id = await setupOrder();
  let notifications = 0;
  const database = {
    collection: db.collection.bind(db),
    runTransaction: (callback) =>
      db.runTransaction((transaction) =>
        callback({
          getAll: transaction.getAll.bind(transaction),
          update: transaction.update.bind(transaction),
          set: () => {
            throw new Error('mirror write rejected');
          },
        }),
      ),
  };
  await assert.rejects(
    statusHandlers(database, async () => {
      notifications++;
    }).updateOrderStatus(statusRequest(id, 'cancelled')),
    /mirror write rejected/,
  );
  assert.equal((await assertReceipts(id)).status, 'pending');
  assert.equal(notifications, 0);
});

test('Firestore transaction retry rechecks a revoked operator before any commit', async () => {
  const id = await setupOrder();
  let attempts = 0;
  const database = {
    collection: db.collection.bind(db),
    runTransaction: (callback) =>
      db.runTransaction(async (transaction) => {
        attempts++;
        if (attempts === 2)
          await db
            .doc('schools/pu/cafeterias/cafe/operators/operator')
            .update({ status: 'inactive' });
        const result = await callback(transaction);
        if (attempts === 1) {
          const error = new Error('force transaction retry');
          error.code = 10;
          throw error;
        }
        return result;
      }),
  };
  await assert.rejects(statusHandlers(database).updateOrderStatus(statusRequest(id, 'confirmed')), {
    code: 'permission-denied',
  });
  assert.equal(attempts, 2);
  assert.equal((await assertReceipts(id)).status, 'pending');
});

test('stale timeout candidates cannot cancel a newly accepted or collected order', async () => {
  for (const [status, advance] of [
    ['pending', 'confirmed'],
    ['ready', 'completed'],
  ]) {
    const id = await setupOrder(status);
    const timestamp = Timestamp.fromMillis(0);
    await db.doc(`schools/pu/orders/${id}`).update({ createdAt: timestamp, readyAt: timestamp });
    await updateOrder(id, advance);
    const processor = createTimeoutOrderProcessor({
      db,
      sendPushToUser: async () => {
        throw new Error('must not notify');
      },
    });
    assert.equal(
      (await processor({ schoolId: 'pu', orderId: id, expectedStatus: status })).changed,
      false,
    );
    assert.equal((await assertReceipts(id)).status, advance);
    // The next loop needs a different immutable creation key.
    await db.doc(`_orderRequests/${id}`).delete();
    await db.doc(`schools/pu/orders/${id}`).delete();
    await db.doc(`users/alice/schools/pu/orders/${id}`).delete();
  }
});

test('parallel timeout workers and merchant acceptance preserve one mirrored final state', async () => {
  const id = await setupOrder();
  await db.doc(`schools/pu/orders/${id}`).update({ createdAt: Timestamp.fromMillis(0) });
  let notifications = 0;
  const processor = createTimeoutOrderProcessor({
    db,
    sendPushToUser: async () => {
      notifications++;
      return { status: 'accepted' };
    },
  });
  const results = await Promise.allSettled([
    processor({ schoolId: 'pu', orderId: id, expectedStatus: 'pending' }),
    processor({ schoolId: 'pu', orderId: id, expectedStatus: 'pending' }),
    updateOrder(id, 'confirmed'),
  ]);
  const receipt = await assertReceipts(id);
  assert.ok(['confirmed', 'cancelled'].includes(receipt.status));
  assert.equal(notifications, receipt.status === 'cancelled' ? 1 : 0);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled' && result.value.changed).length,
    notifications,
  );
});

test('inspection retries cancel unpaid onsite orders once without requesting a refund and block new orders', async () => {
  const id = await setupOrder('ready');
  const event = await inspectionEvent();
  const enforce = createInspectionEnforcement({ db });
  await Promise.all([enforce(event), enforce(event), enforce(event)]);
  const receipt = await assertReceipts(id);
  assert.equal(receipt.status, 'cancelled');
  assert.equal(receipt.cancelReason, 'admin_vendor_suspended');
  const refunds = await db.collection('schools/pu/refunds').get();
  assert.equal(refunds.size, 0);
  assert.deepEqual((await read('schools/pu/inspectionEnforcements/review')).affectedOrderIds, [id]);
  assert.equal((await read('schools/pu/cafeterias/cafe')).orderingEnabled, false);
  await assert.rejects(order('alice', { requestId: 'after-closure' }), {
    code: 'failed-precondition',
  });
});

test('inspection never cancels a collected order from a stale candidate query', async () => {
  const id = await setupOrder('ready');
  const event = await inspectionEvent();
  const database = injectedDatabase(async (count) => {
    if (count === 2) await updateOrder(id, 'completed');
  });
  await createInspectionEnforcement({ db: database })(event);
  assert.equal((await assertReceipts(id)).status, 'completed');
  assert.equal((await db.collection('schools/pu/refunds').get()).size, 0);
  assert.deepEqual((await read('schools/pu/inspectionEnforcements/review')).affectedOrderIds, []);
});

test('a closed transaction response after commit reuses the inspection and cancellation receipts', async () => {
  const id = await setupOrder('ready');
  const event = await inspectionEvent();
  let attempts = 0;
  const database = {
    collection: db.collection.bind(db),
    runTransaction: async (callback) => {
      const result = await db.runTransaction(callback);
      attempts += 1;
      if (attempts === 1 || attempts === 3) {
        const failure = new Error('3 INVALID_ARGUMENT: Transaction is invalid or closed.');
        failure.code = 3;
        throw failure;
      }
      return result;
    },
  };
  await createInspectionEnforcement({ db: database })(event);
  assert.equal(attempts, 4);
  assert.equal((await assertReceipts(id)).status, 'cancelled');
  assert.deepEqual((await read('schools/pu/inspectionEnforcements/review')).affectedOrderIds, [id]);
  assert.equal((await db.collection('schools/pu/refunds').get()).size, 0);
  assert.equal((await read('schools/pu/cafeterias/cafe')).orderingEnabled, false);
});

test('a replaced inspection score prevents stale enforcement before and during order processing', async () => {
  const id = await setupOrder();
  const event = await inspectionEvent();
  const database = injectedDatabase(async (count) => {
    if (count === 2) await db.doc('schools/pu/inspections/review').update({ score: 95 });
  });
  await createInspectionEnforcement({ db: database })(event);
  assert.equal((await assertReceipts(id)).status, 'pending');
  assert.equal((await db.collection('schools/pu/refunds').get()).size, 0);
  await createInspectionEnforcement({ db })(event);
  assert.equal((await assertReceipts(id)).status, 'pending');
});

test('refund request failure cannot commit cancellation or its mirror; retry completes the same receipt', async () => {
  const id = await setupOrder();
  const payment = db.batch();
  payment.update(db.doc(`schools/pu/orders/${id}`), {
    paymentMethod: 'linepay',
    paymentStatus: 'paid',
  });
  payment.update(db.doc(`users/alice/schools/pu/orders/${id}`), {
    paymentMethod: 'linepay',
    paymentStatus: 'paid',
  });
  await payment.commit();
  const event = await inspectionEvent();
  const database = {
    collection: db.collection.bind(db),
    runTransaction: (callback) =>
      db.runTransaction((transaction) =>
        callback({
          getAll: transaction.getAll.bind(transaction),
          set: transaction.set.bind(transaction),
          update: transaction.update.bind(transaction),
          create: () => {
            throw new Error('refund request unavailable');
          },
        }),
      ),
  };
  await assert.rejects(
    createInspectionEnforcement({ db: database })(event),
    /refund request unavailable/,
  );
  assert.equal((await assertReceipts(id)).status, 'pending');
  assert.deepEqual((await read('schools/pu/inspectionEnforcements/review')).affectedOrderIds, []);
  await createInspectionEnforcement({ db })(event);
  assert.equal((await assertReceipts(id)).status, 'cancelled');
  assert.equal((await db.collection('schools/pu/refunds').get()).size, 1);
});

test('inspection warning never closes orders and suspension retries do not extend seven days', async () => {
  const id = await setupOrder();
  await createInspectionEnforcement({ db })(await inspectionEvent(80));
  assert.equal((await assertReceipts(id)).status, 'pending');
  assert.equal((await read('schools/pu/cafeterias/cafe')).orderingEnabled, true);
  const event = await inspectionEvent(70);
  await createInspectionEnforcement({ db, now: () => 1000 })(event);
  await createInspectionEnforcement({ db, now: () => 9999999 })(event);
  assert.equal(
    (await read('schools/pu/inspectionEnforcements/review')).resumeAt,
    new Date(1000 + 7 * 86400000).toISOString(),
  );
  assert.equal((await assertReceipts(id)).status, 'pending');
});

test('force closure drains more than one candidate batch without dropping mirrored cancellations', async () => {
  const originalId = await setupOrder();
  const receipt = await read(`schools/pu/orders/${originalId}`);
  const batch = db.batch();
  for (let i = 0; i < 200; i++) {
    const id = `extra-${i}`;
    const data = { ...receipt, orderId: id };
    batch.set(db.doc(`schools/pu/orders/${id}`), data);
    batch.set(db.doc(`users/alice/schools/pu/orders/${id}`), data);
  }
  await batch.commit();
  await createInspectionEnforcement({ db })(await inspectionEvent());
  assert.equal(
    (
      await db
        .collection('schools/pu/orders')
        .where('status', 'in', ['pending', 'confirmed', 'preparing', 'ready'])
        .get()
    ).size,
    0,
  );
  assert.equal((await db.collection('schools/pu/refunds').get()).size, 0);
  assert.equal(
    (await read('schools/pu/inspectionEnforcements/review')).affectedOrderIds.length,
    201,
  );
  assert.equal((await assertReceipts('extra-199')).status, 'cancelled');
});

for (const status of ['pending', 'preparing', 'ready']) {
  test(`timeout pagination reaches overdue ${status} orders beyond 100 ineligible candidates`, async () => {
    const { createOrderTimeoutSweep } = require('./ordering/orderTimeoutOperations');
    const now = 3600000;
    const batch = db.batch();
    batch.set(db.doc('schools/pu'), { name: 'School' });
    for (let i = 0; i <= 100; i++) {
      const id = i === 100 ? 'z-overdue' : `a${String(i).padStart(3, '0')}`;
      const time = Timestamp.fromMillis(i === 100 || status === 'preparing' ? 0 : now);
      const data = {
        orderId: id,
        userId: 'alice',
        schoolId: 'pu',
        cafeteriaId: 'cafe',
        status,
        total: 100,
        createdAt: time,
        preparingAt: time,
        readyAt: time,
        ...(status === 'preparing' && i !== 100 ? { timeoutNotified: true } : {}),
      };
      batch.set(db.doc(`schools/pu/orders/${id}`), data);
      batch.set(db.doc(`users/alice/schools/pu/orders/${id}`), data);
    }
    await batch.commit();
    let notifications = 0;
    const result = await createOrderTimeoutSweep({
      db,
      now: () => now,
      logger: { info() {}, warn() {} },
      sendPushToUser: async () => {
        notifications++;
        return { status: 'accepted' };
      },
    })();
    assert.equal(notifications, 1);
    const final = await assertReceipts('z-overdue');
    assert.equal(final.status, status === 'preparing' ? 'preparing' : 'cancelled');
    if (status === 'preparing') assert.equal(final.timeoutNotified, true);
    assert.equal(
      result[
        { pending: 'pendingCancelled', preparing: 'preparingNotified', ready: 'readyNoShow' }[
          status
        ]
      ],
      1,
    );
    assert.equal((await assertReceipts('a000')).status, status);
  });
}

for (const payment of [
  { paymentMethod: 'linepay', paymentStatus: 'paid' },
  { paymentMethod: 'campus_card', paymentStatus: 'paid' },
  { paymentMethod: null, paymentStatus: null },
]) {
  test(`inspection cancellation creates only manual payment review for ${JSON.stringify(payment)}`, async () => {
    const id = await setupOrder();
    const batch = db.batch();
    batch.update(db.doc(`schools/pu/orders/${id}`), payment);
    batch.update(db.doc(`users/alice/schools/pu/orders/${id}`), payment);
    await batch.commit();
    const event = await inspectionEvent();
    const enforce = createInspectionEnforcement({ db });
    await Promise.all([enforce(event), enforce(event)]);
    assert.equal((await assertReceipts(id)).status, 'cancelled');
    const refunds = await db.collection('schools/pu/refunds').get();
    assert.equal(refunds.size, 1);
    const review = refunds.docs[0].data();
    assert.equal(review.status, 'needs_review');
    assert.equal(review.manualReviewRequired, true);
    assert.equal(review.orderTotal, 210);
    assert.equal(review.studentUid, 'alice');
    assert.equal(review.paymentMethod, payment.paymentMethod);
    assert.equal(review.paymentStatus, payment.paymentStatus);
    assert.equal('amount' in review, false);
    assert.equal('destination' in review, false);
    assert.equal('gatewayRefundId' in review, false);
    assert.equal((await db.collection('users/alice/schools/pu/walletLedger').get()).size, 0);
  });
}
