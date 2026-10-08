/* global process, fetch */
const { beforeEach, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const {
  createEventRegistrationHandlers,
  normalizeRegistrationPolicy,
  releaseDeletedUserEventRegistration,
  prepareRegistrationPolicy,
} = require('./eventRegistration');
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host ?? ''))
  throw new Error('Explicit local Firestore emulator required');
const projectId = 'demo-campus-event-concurrency';
const app = initializeApp({ projectId }, projectId);
const db = getFirestore(app);
const now = Date.parse('2030-06-01T00:00:00Z');
const inputPolicy = {
  enabled: true,
  free: true,
  eligibility: 'active-school-members',
  opensAt: '2030-05-01T00:00:00Z',
  closesAt: '2030-07-01T00:00:00Z',
  allowCancellation: true,
  cancellationClosesAt: '2030-07-02T00:00:00Z',
};
const policy = normalizeRegistrationPolicy(inputPolicy);
const path = 'schools/pu/clubEvents/one';
const handlers = (database = db) =>
  createEventRegistrationHandlers({ db: database, now: () => now });
const args = (uid, requestId = 'registration-attempt-01') => ({
  auth: { uid },
  data: { schoolId: 'pu', eventId: 'one', requestId },
});
const register = (uid = 'alice', requestId) => handlers().registerCampusEvent(args(uid, requestId));
const cancel = (uid = 'alice', requestId = 'cancellation-attempt-01') =>
  handlers().cancelCampusEventRegistration(args(uid, requestId));
async function invariants() {
  const event = (await db.doc(path).get()).data();
  const active = await db
    .collection(`${path}/registrations`)
    .where('status', '==', 'registered')
    .get();
  assert.equal(event.appRegistrationCount, active.size);
  assert.ok(active.size <= event.capacity);
  return event;
}
beforeEach(async () => {
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  assert.equal(response.ok, true);
  await db
    .doc(path)
    .set({ schoolId: 'pu', capacity: 1, registrationPolicy: policy, appRegistrationCount: 0 });
  for (const uid of ['alice', 'bob']) {
    await db.doc(`schools/pu/members/${uid}`).set({ status: 'active' });
    await db.doc(`users/${uid}`).set({ schoolId: 'pu' });
  }
});
after(async () => {
  await db.terminate();
  await deleteApp(app);
});
test('two users race for one seat: exactly one registration commits', async () => {
  const results = await Promise.allSettled([register('alice'), register('bob')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  await invariants();
});
test('concurrent duplicate requests do not create extra seats and old replay cannot undo cancellation', async () => {
  await Promise.all([register(), register(), register()]);
  await invariants();
  await Promise.all([cancel(), cancel()]);
  assert.equal((await register()).state.status, 'cancelled');
  assert.equal((await invariants()).appRegistrationCount, 0);
});
test('concurrent cancellation and another user registration keep count and registrations consistent', async () => {
  await register();
  await Promise.allSettled([cancel(), register('bob')]);
  await invariants();
});
test('transaction retries recheck membership, deletion marker and changed policy', async () => {
  for (const [target, patch] of [
    ['schools/pu/members/alice', { status: 'inactive' }],
    ['users/alice', { accountDeletionInProgress: true }],
    [path, { 'registrationPolicy.enabled': false }],
  ]) {
    let attempts = 0;
    const database = {
      collection: db.collection.bind(db),
      runTransaction: (callback) =>
        db.runTransaction(async (transaction) => {
          attempts++;
          if (attempts === 2) await db.doc(target).update(patch);
          const result = await callback(transaction);
          if (attempts === 1) {
            const error = new Error('retry');
            error.code = 10;
            throw error;
          }
          return result;
        }),
    };
    await assert.rejects(handlers(database).registerCampusEvent(args('alice')));
    assert.equal(attempts, 2);
    assert.equal((await invariants()).appRegistrationCount, 0);
    await db.doc('schools/pu/members/alice').set({ status: 'active' });
    await db.doc('users/alice').set({ schoolId: 'pu' });
    await db.doc(path).update({ registrationPolicy: policy });
  }
});
test('account deletion releases the seat once even after the cancellation deadline', async () => {
  await register();
  await db.doc(path).update({ 'registrationPolicy.allowCancellation': false });
  const registrationRef = db.doc(`${path}/registrations/alice`);
  await Promise.all([
    releaseDeletedUserEventRegistration({ db, registrationRef, uid: 'alice' }),
    releaseDeletedUserEventRegistration({ db, registrationRef, uid: 'alice' }),
  ]);
  assert.equal((await invariants()).appRegistrationCount, 0);
  assert.equal((await registrationRef.get()).exists, false);
});
test('account deletion never adopts a legacy or uncontrolled registration counter', async () => {
  const legacy = db.doc('schools/pu/events/old/registrations/alice');
  await legacy.set({ userId: 'alice' });
  assert.equal(
    await releaseDeletedUserEventRegistration({ db, registrationRef: legacy, uid: 'alice' }),
    false,
  );
  const old = db.doc('schools/pu/clubEvents/old/registrations/alice');
  await old.set({ userId: 'alice', status: 'registered' });
  await db.doc('schools/pu/clubEvents/old').set({ registeredCount: 7 });
  assert.equal(
    await releaseDeletedUserEventRegistration({ db, registrationRef: old, uid: 'alice' }),
    false,
  );
  assert.equal((await db.doc('schools/pu/clubEvents/old').get()).data().registeredCount, 7);
});
test('initial enabling checks real legacy queries and never imports unknown counts', async () => {
  const run = () =>
    db.runTransaction((transaction) =>
      prepareRegistrationPolicy({
        db,
        transaction,
        schoolId: 'pu',
        eventId: 'old',
        previous: {},
        input: inputPolicy,
        capacity: 2,
      }),
    );
  assert.equal((await run()).appRegistrationCount, 0);
  await db.doc('schools/pu/events/old/registrations/other').set({ userId: 'other' });
  await assert.rejects(run(), { code: 'failed-precondition' });
});
