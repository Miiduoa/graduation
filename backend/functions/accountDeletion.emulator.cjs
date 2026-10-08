/* global process, fetch */
const { beforeEach, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createDeleteUserAccountHandler, RETAINED_CATEGORIES } = require('./accountDeletion');

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host ?? ''))
  throw new Error('Explicit local Firestore emulator required');
const projectId = 'demo-campus-account-deletion';
const app = initializeApp({ projectId }, projectId);
const db = getFirestore(app);
const now = Date.parse('2030-06-01T00:00:00Z');
let deletedAuthUsers;
const auth = {
  async deleteUser(uid) {
    const root = (await db.doc(`users/${uid}`).get()).data();
    assert.equal(root.status, 'deleted');
    assert.equal(root.accountDeletionInProgress, true);
    deletedAuthUsers.push(uid);
  },
};
const handler = (database = db) =>
  createDeleteUserAccountHandler({ db: database, auth, now: () => now });
const request = (uid = 'alice') => ({
  auth: { uid, token: { auth_time: now / 1000 } },
  data: { expectedUserId: uid, confirmation: 'DELETE_MY_ACCOUNT' },
});
async function seed(rows) {
  for (let offset = 0; offset < rows.length; offset += 400) {
    const batch = db.batch();
    for (const [path, data] of rows.slice(offset, offset + 400)) batch.set(db.doc(path), data);
    await batch.commit();
  }
}
const exists = async (path) => (await db.doc(path).get()).exists;

beforeEach(async () => {
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  assert.equal(response.ok, true);
  deletedAuthUsers = [];
});
after(async () => {
  await db.terminate();
  await deleteApp(app);
});

test('real collection-group path pagination deletes over 200 memberships and preserves other accounts', async () => {
  const rows = [
    ['users/alice', { displayName: 'Private account', email: 'private@example.test' }],
    ['schools/pu/members/alice', { status: 'active' }],
    ['schools/pu/members/bob', { status: 'active' }],
    ['schools/pu/directory/alice', { displayName: 'Private account' }],
    ['schools/pu/serviceRoles/alice', { status: 'active', orders: true }],
    ['archives/shared/members/alice', { status: 'active' }],
    ['archives/shared/directory/alice', { shared: true }],
  ];
  for (let index = 0; index < 205; index++) {
    const group = `groups/g-${String(index).padStart(3, '0')}`;
    rows.push([group, { schoolId: 'pu', memberCount: 2 }]);
    rows.push([`${group}/members/alice`, { role: 'member', status: 'active' }]);
    rows.push([`${group}/members/bob`, { role: 'member', status: 'active', uid: 'alice' }]);
  }
  await seed(rows);
  const result = await handler()(request());
  assert.deepEqual(result, {
    success: true,
    userId: 'alice',
    retainedCategories: RETAINED_CATEGORIES,
  });
  const members = await db.collectionGroup('members').get();
  assert.equal(
    members.docs.filter((doc) => /^groups\/[^/]+\/members\/alice$/.test(doc.ref.path)).length,
    0,
  );
  assert.equal(
    members.docs.filter((doc) => /^groups\/[^/]+\/members\/bob$/.test(doc.ref.path)).length,
    205,
  );
  const groups = await db.collection('groups').get();
  assert.equal(groups.size, 205);
  assert.ok(groups.docs.every((doc) => doc.data().memberCount === 1));
  assert.equal(await exists('schools/pu/members/alice'), false);
  assert.equal(await exists('schools/pu/directory/alice'), false);
  assert.equal(await exists('schools/pu/serviceRoles/alice'), false);
  assert.equal(await exists('schools/pu/members/bob'), true);
  assert.equal(await exists('archives/shared/members/alice'), true);
  assert.equal(await exists('archives/shared/directory/alice'), true);
  assert.deepEqual(deletedAuthUsers, ['alice']);
});

test('recursive cleanup includes orphan descendants while preserving financial records and other owners', async () => {
  const transaction = { userId: 'alice', status: 'completed', amount: 500, currency: 'TWD' };
  const cancelledOrder = {
    userId: 'alice',
    status: 'cancelled',
    paymentMethod: 'onsite',
    paymentStatus: 'pending',
    total: 75,
  };
  await seed([
    ['users/alice', { displayName: 'Private', customPrivateField: 'remove me', balance: 0 }],
    ['users/alice/private/orphan/children/deep', { personal: true }],
    ['users/alice/postLoginRuns/run', { externalStudentId: 'private' }],
    ['users/alice/schools/pu/favorites/orphan/details/deep', { personal: true }],
    ['users/alice/schools/pu/wallet/balance', { available: 0, pending: 0, currency: 'TWD' }],
    ['users/alice/schools/pu/transactions/paid', transaction],
    ['users/alice/schools/pu/orders/cancelled', cancelledOrder],
    ['schools/pu/orders/cancelled', cancelledOrder],
    ['users/bob/private/orphan/children/deep', { personal: 'keep' }],
    ['groups/g/submissions/alice', { userId: 'alice', score: 90 }],
    ['_puSessions/alice-campus', { ownerUid: 'alice', cookies: 'private' }],
    ['_puTronClassSessions/alice-lms', { ownerUid: 'alice', cookies: 'private' }],
    ['_puSessions/bob-campus', { ownerUid: 'bob', cookies: 'keep' }],
  ]);
  assert.equal(await exists('users/alice/private/orphan'), false);
  assert.equal(await exists('users/alice/schools/pu'), false);
  await handler()(request());
  for (const path of [
    'users/alice/private/orphan/children/deep',
    'users/alice/postLoginRuns/run',
    'users/alice/schools/pu/favorites/orphan/details/deep',
    '_puSessions/alice-campus',
    '_puTronClassSessions/alice-lms',
  ])
    assert.equal(await exists(path), false, path);
  assert.equal(await exists('users/bob/private/orphan/children/deep'), true);
  assert.equal(await exists('_puSessions/bob-campus'), true);
  assert.equal(await exists('groups/g/submissions/alice'), true);
  assert.deepEqual(
    (await db.doc('users/alice/schools/pu/transactions/paid').get()).data(),
    transaction,
  );
  assert.deepEqual(
    (await db.doc('users/alice/schools/pu/orders/cancelled').get()).data(),
    cancelledOrder,
  );
  assert.deepEqual((await db.doc('schools/pu/orders/cancelled').get()).data(), cancelledOrder);
  assert.deepEqual((await db.doc('users/alice/schools/pu').get()).data(), { accountClosed: true });
  const profile = (await db.doc('users/alice').get()).data();
  assert.deepEqual(Object.keys(profile).sort(), [
    'accountDeletionInProgress',
    'deletedAt',
    'notificationDeliveryDisabled',
    'status',
  ]);
  assert.equal(profile.status, 'deleted');
  assert.deepEqual(deletedAuthUsers, ['alice']);
});

test('inspection refunds block closure until settled and retain both owners refund history', async () => {
  const refund = {
    studentUid: 'alice',
    orderId: 'paid-order',
    amount: 75,
    status: 'needs_review',
    reason: 'inspection_rejected',
  };
  const otherRefund = { ...refund, studentUid: 'bob' };
  await seed([
    ['users/alice', { displayName: 'Alice' }],
    ['users/alice/settings/private', { keepUntilClosure: true }],
    ['schools/pu/refunds/alice-refund', refund],
    ['schools/pu/refunds/bob-refund', otherRefund],
  ]);
  await assert.rejects(handler()(request()), (error) => {
    assert.equal(error.code, 'failed-precondition');
    assert.equal(error.details.reason, 'financial-records');
    return true;
  });
  assert.deepEqual(deletedAuthUsers, []);
  assert.deepEqual((await db.doc('users/alice').get()).data(), { displayName: 'Alice' });
  assert.equal(await exists('users/alice/settings/private'), true);
  await db.doc('schools/pu/refunds/alice-refund').update({ status: 'refunded' });
  assert.equal((await handler()(request())).success, true);
  assert.deepEqual((await db.doc('schools/pu/refunds/alice-refund').get()).data(), {
    ...refund,
    status: 'refunded',
  });
  assert.deepEqual((await db.doc('schools/pu/refunds/bob-refund').get()).data(), otherRefund);
  assert.deepEqual(deletedAuthUsers, ['alice']);
});

test('failed cleanup leaves Auth untouched and a retry does not decrement committed membership or event counts twice', async () => {
  const event = 'schools/pu/clubEvents/event';
  await seed([
    ['users/alice', { email: 'private@example.test' }],
    ['groups/g', { memberCount: 2 }],
    ['groups/g/members/alice', { role: 'member', status: 'active' }],
    ['groups/g/members/bob', { role: 'member', status: 'active' }],
    [event, { registrationPolicy: { version: 1 }, appRegistrationCount: 2 }],
    [`${event}/registrations/alice`, { userId: 'alice', status: 'registered' }],
    [`${event}/registrations/bob`, { userId: 'bob', status: 'registered' }],
    ['notifications/fail-once', { userId: 'alice', body: 'private' }],
    ['notifications/bob', { userId: 'bob', body: 'keep' }],
  ]);
  let fail = true;
  const database = {
    collection: db.collection.bind(db),
    collectionGroup: db.collectionGroup.bind(db),
    runTransaction: db.runTransaction.bind(db),
    async recursiveDelete(reference) {
      if (fail && reference.path === 'notifications/fail-once') {
        fail = false;
        throw new Error('injected cleanup unavailable');
      }
      return db.recursiveDelete(reference);
    },
  };
  await assert.rejects(handler(database)(request()), /injected cleanup unavailable/);
  assert.deepEqual(deletedAuthUsers, []);
  assert.equal((await db.doc('users/alice').get()).data().accountDeletionInProgress, true);
  assert.equal((await db.doc('groups/g').get()).data().memberCount, 1);
  assert.equal((await db.doc(event).get()).data().appRegistrationCount, 1);
  assert.equal(await exists('notifications/fail-once'), true);
  assert.equal((await handler(database)(request())).success, true);
  assert.equal((await db.doc('groups/g').get()).data().memberCount, 1);
  assert.equal((await db.doc(event).get()).data().appRegistrationCount, 1);
  assert.equal(await exists('groups/g/members/bob'), true);
  assert.equal(await exists(`${event}/registrations/bob`), true);
  assert.equal(await exists('notifications/bob'), true);
  assert.equal(await exists('notifications/fail-once'), false);
  assert.deepEqual(deletedAuthUsers, ['alice']);
});
