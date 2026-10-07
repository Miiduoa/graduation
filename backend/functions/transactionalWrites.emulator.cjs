/* global process, fetch */
const { after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createGroupMembershipHandlers } = require('./groupMembership');
const { createOrderHandler } = require('./createOrder');

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
