/* global process, fetch */
const { after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { createNotificationService } = require('./lib/notificationService');
const { createDormWorkflowHandler } = require('./dormWorkflow');
const { createSchoolAnnouncementNotifyHandler } = require('./lib/coherenceNotify');

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

test('staff announcement retry preserves its read time order and reaches only local staff', async () => {
  const seed = db.batch();
  for (const [uid, schoolId, role] of [
    ['alice', 'pu', 'teacher'], ['bob', 'pu', 'student'], ['chris', 'other', 'teacher'],
  ]) {
    seed.set(db.doc(`schools/pu/members/${uid}`), { status: 'active', role: 'member' });
    seed.set(db.doc(`users/${uid}`), { schoolId, role });
  }
  await seed.commit();
  const attempts = [];
  const handler = createSchoolAnnouncementNotifyHandler({
    db,
    sendPushToUser: async (uid) => {
      attempts.push(uid);
      if (attempts.length === 1) throw new Error('provider unavailable');
    },
    log: { error() {} },
  });
  const event = {
    params: { schoolId: 'pu', announcementId: 'staff' },
    data: { data: () => ({ title: '教師會議', audience: 'staff', studentFeed: false }) },
  };
  await assert.rejects(handler(event), /provider unavailable/);
  const inbox = db.collectionGroup('notifications');
  const first = await inbox.get();
  assert.equal(first.size, 1);
  const [original] = first.docs;
  assert.equal(original.ref.parent.parent.id, 'alice');
  await original.ref.update({ read: true });
  await handler(event);
  const retry = await inbox.get();
  assert.equal(retry.size, 1);
  assert.equal(retry.docs[0].get('read'), true);
  assert.ok(original.get('createdAt').isEqual(retry.docs[0].get('createdAt')));
  assert.deepEqual(attempts, ['alice', 'alice']);
});

test('dorm publication binds the Expo message to each resident’s private inbox, including on retry', async () => {
  const seed = db.batch();
  seed.set(db.doc('schools/pu'), { dormWorkflowEnabled: true });
  seed.set(db.doc('schools/pu/members/staff'), { role: 'staff' });
  seed.set(db.doc('schools/pu/dormStaffRoles/staff'), { status: 'active', packages: true, buildings: ['A'] });
  const residents = ['alice', 'bob', 'muted'];
  for (const uid of residents) {
    seed.set(db.doc(`users/${uid}`), { schoolId: 'pu' });
    seed.set(db.doc(`schools/pu/members/${uid}`), { role: 'student', status: 'active' });
    seed.set(db.doc(`schools/pu/dormResidents/${uid}`), { userId: uid, building: 'A', active: true });
    seed.set(db.doc(`users/${uid}/pushTokens/device`), { token: `ExpoPushToken[test-${uid}]`, type: 'expo' });
  }
  seed.set(db.doc('users/muted/settings/notifications'), { announcements: false });
  await seed.commit();

  const messages = [];
  const service = createNotificationService({
    db,
    now: () => now,
    fetch: async (_url, init) => {
      const batch = JSON.parse(init.body);
      return ok(batch.map((message) => {
        messages.push(message);
        return { status: 'ok', id: `ticket-${messages.length}` };
      }));
    },
  });
  const publish = createDormWorkflowHandler({ db, sendPushToUser: service.sendPushToUser });
  const request = { auth: { uid: 'staff' }, data: {
    schoolId: 'pu', action: 'announce', building: 'A', title: '停水', body: '明日施工', key: 'first-publication',
  } };
  const receipt = await publish(request);
  assert.equal(receipt.acceptedRecipients, 2);
  assert.equal(receipt.recipients, 3);
  const keys = new Set();
  for (const uid of residents) {
    const inbox = await db.collection(`users/${uid}/notifications`).get();
    assert.equal(inbox.size, 1);
    const [row] = inbox.docs;
    const data = row.get('data');
    assert.match(data.deliveryKey, /^[0-9a-f-]{36}$/);
    assert.deepEqual(data, {
      type: 'announcement', schoolId: 'pu', channel: 'dormitory', dormAnnouncementId: receipt.id,
      inboxNotificationId: row.id, deliveryKey: data.deliveryKey,
    });
    keys.add(data.deliveryKey);
    const token = `ExpoPushToken[test-${uid}]`;
    const message = messages.find((item) => item.to === token);
    if (uid === 'muted') assert.equal(message, undefined);
    else assert.deepEqual(message, {
      to: token, title: '宿舍公告', body: '開啟宿舍頁查看本棟公告。', sound: 'default', channelId: 'dormitory', data,
    });
    await row.ref.update({ read: true });
  }
  assert.equal(keys.size, residents.length);
  assert.deepEqual(await publish(request), receipt);
  assert.equal(messages.length, 2);
  const afterRetry = await db.collectionGroup('notifications').get();
  assert.equal(afterRetry.size, residents.length);
  assert.ok(afterRetry.docs.every((row) => row.get('read') && keys.has(row.get('data.deliveryKey'))));
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
