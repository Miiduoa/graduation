'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { createVerifyAttendanceClaim } = require('./verifyClaim');

if (!/^((127\.0\.0\.1|localhost):\d+)$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
  throw new Error('Run against a loopback Firestore emulator only. Never use a production database.');
}
const app = initializeApp({ projectId: 'demo-campus-attendance' }, `attendance-${process.pid}`);
const db = getFirestore(app);
after(async () => { await db.terminate(); await deleteApp(app); });

async function fixture(t) {
  const groupId = `attendance-test-${randomUUID()}`;
  const group = db.collection('groups').doc(groupId);
  const sessionId = 'class-1';
  const uid = 'student.with.dots';
  const now = Date.now();
  const token = randomUUID();
  const live = group.collection('liveSessions').doc(sessionId);
  const session = group.collection('attendanceSessions').doc(sessionId);
  const member = group.collection('members').doc(uid);
  const record = session.collection('attendanceRecords').doc(uid);
  await db.runTransaction(async (tx) => {
    tx.set(group, { type: 'course' });
    tx.set(member, { status: 'active', role: 'member' });
    tx.set(live, { active: true, teacherId: 'teacher-1', qrToken: token,
      startedAt: Timestamp.fromMillis(now - 60_000), qrExpiresAt: Timestamp.fromMillis(now + 300_000) });
    tx.set(session, { active: true, groupId, liveSessionId: sessionId, source: 'live_session',
      attendanceMode: 'qr', attendeeCount: 0 });
  });
  t.after(() => db.recursiveDelete(group));
  const handler = createVerifyAttendanceClaim({ db, FieldValue, Timestamp, HttpsError, clock: () => now });
  const request = { auth: { uid }, data: { courseId: groupId, sessionId, claim: { token } } };
  return { group, live, session, member, record, handler, request, uid, now };
}

test('real Firestore: concurrent submissions create one record and one increment', async (t) => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 4 }, () => f.handler(f.request)));
  assert.equal(results.filter((r) => r.alreadyRecorded === false).length, 1);
  const record = (await f.record.get()).data();
  const session = (await f.session.get()).data();
  assert.equal((await f.session.collection('attendanceRecords').get()).size, 1);
  assert.equal(session.attendeeCount, 1);
  assert.ok(session.attendees[f.uid] instanceof Timestamp);
  assert.equal(session.attendees.student, undefined);
  for (const receipt of results) {
    assert.equal(receipt.checkedInAt, record.checkedInAt.toDate().toISOString());
    assert.equal(receipt.uid, f.uid);
  }
});

test('real Firestore: retry after closure preserves the original record', async (t) => {
  const f = await fixture(t);
  const first = await f.handler(f.request);
  await f.live.update({ active: false, qrExpiresAt: Timestamp.fromMillis(0) });
  const retry = await f.handler(f.request);
  assert.equal(retry.alreadyRecorded, true);
  assert.equal(retry.checkedInAt, first.checkedInAt);
  assert.equal((await f.session.get()).data().attendeeCount, 1);
});

test('real Firestore: revoked membership creates no attendance', async (t) => {
  const f = await fixture(t);
  await f.member.update({ status: 'left' });
  await assert.rejects(() => f.handler(f.request), (error) => error.code === 'permission-denied');
  assert.equal((await f.record.get()).exists, false);
  assert.equal((await f.session.get()).data().attendeeCount, 0);
});

test('real Firestore: forged account and wrong QR do not publish a record', async (t) => {
  const f = await fixture(t);
  await assert.rejects(() => f.handler({ ...f.request, data: { ...f.request.data,
    claim: { ...f.request.data.claim, uid: 'someone-else' } } }), (error) => error.code === 'permission-denied');
  await assert.rejects(() => f.handler({ ...f.request, data: { ...f.request.data,
    claim: { token: 'wrong' } } }), (error) => error.code === 'permission-denied');
  assert.equal((await f.record.get()).exists, false);
});

test('real Firestore: expiry is determined by server time', async (t) => {
  const f = await fixture(t);
  await f.live.update({ qrExpiresAt: Timestamp.fromMillis(f.now) });
  await assert.rejects(() => f.handler({ ...f.request, data: { ...f.request.data,
    claim: { ...f.request.data.claim, claimedAt: '2000-01-01T00:00:00Z' } } }),
  (error) => error.code === 'deadline-exceeded');
  assert.equal((await f.record.get()).exists, false);
});
