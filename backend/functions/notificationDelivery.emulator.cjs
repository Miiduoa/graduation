/* global process, fetch */
const { after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { createNotificationService } = require('./lib/notificationService');

const match = /^(?:127\.0\.0\.1|localhost|0\.0\.0\.0):([0-9]{1,5})$/.exec(
  process.env.FIRESTORE_EMULATOR_HOST || '',
);
if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535)
  throw new Error('An explicit local Firestore emulator is required');
const host = `127.0.0.1:${match[1]}`;
const projectId = 'demo-campus-notification-concurrency';
const app = initializeApp({ projectId }, 'notification-concurrency-tests');
const db = getFirestore(app);
const tokenRef = db.doc('users/alice/pushTokens/device');
const userRef = db.doc('users/alice');
const pushToken = 'ExpoPushToken[valid-test-token]';
const note = { title: '領餐通知', body: '餐點已備妥。' };
const now = new Date('2026-10-08T04:00:00Z');
const ok = (data) => ({ ok: true, json: async () => ({ data }) });
function barrier() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
beforeEach(async () => {
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  assert.equal(response.ok, true);
  await userRef.set({ schoolId: 'pu' });
  await tokenRef.set({ token: pushToken, type: 'expo' });
});
after(async () => {
  await db.terminate();
  await deleteApp(app);
});

test('accepted provider response cannot recreate token receipt after deletion starts', async () => {
  const started = barrier();
  const finish = barrier();
  const service = createNotificationService({
    db,
    now: () => now,
    fetch: async () => {
      started.release();
      await finish.promise;
      return ok([{ status: 'ok', id: 'one' }]);
    },
  });
  const sending = service.sendPushToUser('alice', note);
  await started.promise;
  await userRef.set(
    { notificationDeliveryDisabled: true, accountDeletionInProgress: true },
    { merge: true },
  );
  await tokenRef.delete();
  finish.release();
  assert.equal((await sending).status, 'accepted');
  assert.equal((await db.doc('pendingPushReceipts/one').get()).exists, false);
  assert.equal((await service.sendPushToUser('alice', note)).reason, 'account_unavailable');
});

test('invalid provider token response cannot delete the same token re-registered during request', async () => {
  const started = barrier();
  const finish = barrier();
  const service = createNotificationService({
    db,
    now: () => now,
    fetch: async () => {
      started.release();
      await finish.promise;
      return ok([{ status: 'error', details: { error: 'DeviceNotRegistered' } }]);
    },
  });
  const sending = service.sendPushToUser('alice', note);
  await started.promise;
  await tokenRef.set({ token: pushToken, type: 'expo', refreshed: true });
  finish.release();
  assert.equal((await sending).status, 'failed');
  assert.equal((await tokenRef.get()).data().refreshed, true);
});

for (const expired of [true, false]) {
  test(`two receipt sweeps preserve the confirmed result despite a stale missing response (expired=${expired})`, async () => {
    const receiptRef = db.doc('pendingPushReceipts/one');
    await receiptRef.set({
      uid: 'alice',
      token: pushToken,
      tokenPath: tokenRef.path,
      tokenUpdatedAt: (await tokenRef.get()).updateTime,
      createdAt: Timestamp.fromDate(
        new Date(expired ? '2026-10-07T03:30:00Z' : '2026-10-08T03:30:00Z'),
      ),
      nextCheckAt: Timestamp.fromDate(new Date('2026-10-08T03:45:00Z')),
    });
    const started = barrier();
    const finish = barrier();
    const slow = createNotificationService({
      db,
      now: () => now,
      fetch: async () => {
        started.release();
        await finish.promise;
        return ok({});
      },
    });
    const fast = createNotificationService({
      db,
      now: () => now,
      fetch: async () => ok({ one: { status: 'ok' } }),
    });
    const staleSweep = slow.processPendingReceipts();
    await started.promise;
    await fast.processPendingReceipts();
    finish.release();
    await staleSweep;
    assert.equal(
      (await db.doc('pushReceiptResults/one').get()).data().status,
      'provider_confirmed',
    );
    assert.equal((await receiptRef.get()).exists, false);
    assert.equal((await tokenRef.get()).exists, true);
  });
}

test('account removal while receipt lookup is in flight leaves no receipt history', async () => {
  const receiptRef = db.doc('pendingPushReceipts/one');
  await receiptRef.set({
    uid: 'alice',
    createdAt: Timestamp.fromDate(new Date('2026-10-08T03:30:00Z')),
    nextCheckAt: Timestamp.fromDate(new Date('2026-10-08T03:45:00Z')),
  });
  const started = barrier();
  const finish = barrier();
  const service = createNotificationService({
    db,
    now: () => now,
    fetch: async () => {
      started.release();
      await finish.promise;
      return ok({ one: { status: 'ok' } });
    },
  });
  const checking = service.processPendingReceipts();
  await started.promise;
  await userRef.delete();
  finish.release();
  await checking;
  assert.equal((await receiptRef.get()).exists, false);
  assert.equal((await db.doc('pushReceiptResults/one').get()).exists, false);
});
