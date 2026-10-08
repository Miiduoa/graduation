'use strict';

// Executes unchanged in Jest and Node's built-in runner.
const testCase = typeof jest === 'undefined' ? require('node:test').test : global.test;
const assert = require('node:assert/strict');
const { createLiveAttendanceHandlers, hashQrToken } = require('./liveAttendance');
const { TransactionStore, Timestamp, FieldValue, HttpsError } = require('../test-support/transactionStore');

const NOW = Date.parse('2026-10-08T07:00:00.000Z');
const GROUP = 'course-space-1';
const SESSION = 'session-1';
const TOKEN = '1234567890abcdefghij_A-complete-token';
const groupPath = `groups/${GROUP}`;
const livePath = `${groupPath}/liveSessions/${SESSION}`;
const mirrorPath = `${groupPath}/attendanceSessions/${SESSION}`;
const memberPath = (uid) => `${groupPath}/members/${uid}`;
const receiptPath = (uid) => `${mirrorPath}/attendanceRecords/${uid}`;

function fixture(overrides = {}) {
  const db = new TransactionStore();
  const timer = { now: NOW };
  const messages = [];
  const common = {
    sessionId: SESSION, groupId: GROUP, teacherId: 'teacher-1',
    startedAt: Timestamp.fromMillis(NOW - 60_000), endedAt: null,
    active: true, attendeeCount: 0,
  };
  db.put(groupPath, { type: 'course', name: '測試課程' });
  db.put(memberPath('teacher-1'), { status: 'active', role: 'instructor' });
  db.put(memberPath('student-1'), { status: 'active', role: 'member' });
  db.put(memberPath('student-2'), { status: 'active', role: 'member' });
  db.put(livePath, {
    ...common, qrTokenHash: hashQrToken(TOKEN), qrProtocol: 'sha256-v1',
    qrExpiresAt: Timestamp.fromMillis(NOW + 60_000), ...overrides,
  });
  db.put(mirrorPath, { ...common, liveSessionId: SESSION, source: 'live_session' });
  const api = createLiveAttendanceHandlers({
    db, FieldValue, Timestamp, HttpsError, clock: () => timer.now,
    notifySessionStarted: async (message) => { messages.push(message); },
  });
  const request = (data = {}, uid = 'student-1') => ({
    auth: { uid }, data: { groupId: GROUP, sessionId: SESSION, qrToken: TOKEN, ...data },
  });
  return { db, timer, messages, api, request };
}
const hasCode = (code) => (error) => error?.code === code;
const rejectUnchanged = async (f, request, code) => {
  const before = f.db.dump();
  await assert.rejects(f.api.verifyAttendanceClaim(request), hasCode(code));
  assert.deepEqual(f.db.dump(), before);
};

testCase('start returns a complete token only to the caller; stores only its SHA-256 hash', async () => {
  const f = fixture();
  const result = await f.api.startLiveSession({ auth: { uid: 'teacher-1' }, data: { groupId: GROUP } });
  assert.equal(result.qrToken.length, 32);
  const session = f.db.get(`${groupPath}/liveSessions/${result.sessionId}`);
  const mirror = f.db.get(`${groupPath}/attendanceSessions/${result.sessionId}`);
  assert.equal(session.qrTokenHash, hashQrToken(result.qrToken));
  assert.equal(session.qrProtocol, 'sha256-v1');
  assert.equal(Object.hasOwn(session, 'qrToken'), false);
  assert.equal(JSON.stringify(f.db.dump()).includes(result.qrToken), false);
  assert.equal(session.startedAt.toMillis(), mirror.startedAt.toMillis());
  assert.equal(f.messages.length, 1);
  assert.equal(Object.hasOwn(f.messages[0], 'qrToken'), false);
});

testCase('two sessions started in the same millisecond never overwrite each other', async () => {
  const f = fixture();
  const request = { auth: { uid: 'teacher-1' }, data: { groupId: GROUP } };
  const results = await Promise.all([f.api.startLiveSession(request), f.api.startLiveSession(request)]);
  assert.notEqual(results[0].sessionId, results[1].sessionId);
  assert.notEqual(results[0].qrToken, results[1].qrToken);
});

testCase('session creation fails atomically and never notifies on a storage failure', async () => {
  const f = fixture(); const before = f.db.dump(); f.db.failCommits = true;
  await assert.rejects(f.api.startLiveSession({ auth: { uid: 'teacher-1' }, data: { groupId: GROUP } }), /SIMULATED_COMMIT_FAILURE/);
  assert.deepEqual(f.db.dump(), before);
  assert.deepEqual(f.messages, []);
});

testCase('a notification outage does not hide a committed session or its returned token', async () => {
  const f = fixture(); const warnings = [];
  const api = createLiveAttendanceHandlers({ db: f.db, Timestamp, FieldValue, HttpsError,
    clock: () => NOW, notifySessionStarted: async () => { throw new Error('push failed'); }, warn: (message) => warnings.push(message) });
  const result = await api.startLiveSession({ auth: { uid: 'teacher-1' }, data: { groupId: GROUP } });
  assert.equal(result.success, true);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].includes(result.qrToken), false);
});

for (const minutes of [0, -1, 16, 1.1, '5', Infinity, NaN]) {
  testCase(`start rejects invalid lifetime ${String(minutes)}`, async () => {
    const f = fixture();
    await assert.rejects(f.api.startLiveSession({ auth: { uid: 'teacher-1' }, data: { groupId: GROUP, qrExpiryMinutes: minutes } }), hasCode('invalid-argument'));
  });
}

testCase('zero latitude and longitude are preserved instead of being treated as absent', async () => {
  const f = fixture();
  const result = await f.api.startLiveSession({ auth: { uid: 'teacher-1' }, data: { groupId: GROUP, classroomLat: 0, classroomLng: 0 } });
  assert.deepEqual(f.db.get(`${groupPath}/liveSessions/${result.sessionId}`).location, { lat: 0, lng: 0, radiusM: 100 });
});

testCase('partial or out-of-range coordinates are rejected', async () => {
  for (const coordinates of [{ classroomLat: 1 }, { classroomLat: 91, classroomLng: 0 }, { classroomLat: NaN, classroomLng: 1 }]) {
    const f = fixture();
    await assert.rejects(f.api.startLiveSession({ auth: { uid: 'teacher-1' }, data: { groupId: GROUP, ...coordinates } }), hasCode('invalid-argument'));
  }
});

testCase('a revoked instructor cannot create a session', async () => {
  const f = fixture(); f.db.put(memberPath('teacher-1'), { role: 'instructor', status: 'left' });
  await assert.rejects(f.api.startLiveSession({ auth: { uid: 'teacher-1' }, data: { groupId: GROUP } }), hasCode('permission-denied'));
});

testCase('an enrolled student cannot open attendance', async () => {
  const f = fixture();
  await assert.rejects(f.api.startLiveSession({ auth: { uid: 'student-1' }, data: { groupId: GROUP } }), hasCode('permission-denied'));
});

testCase('QR verification commits one scoped receipt and the same nested attendance timestamp', async () => {
  const f = fixture(); const receipt = await f.api.verifyAttendanceClaim(f.request());
  assert.deepEqual(receipt, { success: true, attendanceRecorded: true, alreadyRecorded: false,
    valid: true, uid: 'student-1', groupId: GROUP, sessionId: SESSION,
    status: 'present', checkedInAt: new Date(NOW).toISOString() });
  assert.equal(f.db.get(receiptPath('student-1')).checkedInAt.toMillis(), NOW);
  assert.equal(f.db.get(mirrorPath).attendees['student-1'].toMillis(), NOW);
  assert.equal(Object.hasOwn(f.db.get(mirrorPath), 'attendees.student-1'), false);
  assert.equal(f.db.get(mirrorPath).attendeeCount, 1);
  assert.equal(f.db.get(livePath).attendeeCount, 1);
});

testCase('repeated check-in preserves the first status, timestamp and both counts', async () => {
  const f = fixture(); const first = await f.api.verifyAttendanceClaim(f.request());
  const before = f.db.dump(); f.timer.now += 30_000;
  const second = await f.api.verifyAttendanceClaim(f.request());
  assert.equal(second.alreadyRecorded, true);
  assert.equal(second.checkedInAt, first.checkedInAt);
  assert.deepEqual(f.db.dump(), before);
});

testCase('24 simultaneous retries produce one attendance record and one count increment', async () => {
  const f = fixture();
  const receipts = await Promise.all(Array.from({ length: 24 }, () => f.api.verifyAttendanceClaim(f.request())));
  assert.equal(receipts.filter((r) => !r.alreadyRecorded).length, 1);
  assert.equal(f.db.get(mirrorPath).attendeeCount, 1);
  assert.equal(f.db.get(livePath).attendeeCount, 1);
  assert.ok(f.db.attempts > 24, 'Harness should exercise transaction retries');
});

testCase('different students signing concurrently retain each other in nested maps', async () => {
  const f = fixture();
  await Promise.all([f.api.verifyAttendanceClaim(f.request()), f.api.verifyAttendanceClaim(f.request({}, 'student-2'))]);
  assert.deepEqual(Object.keys(f.db.get(mirrorPath).attendees).sort(), ['student-1', 'student-2']);
  assert.equal(f.db.get(mirrorPath).attendeeCount, 2);
});

testCase('joining a room without a QR does not mark attendance', async () => {
  const f = fixture();
  assert.deepEqual(await f.api.joinLiveSession(f.request({ qrToken: undefined })), { success: true, attendanceRecorded: false });
  assert.equal(f.db.get(receiptPath('student-1')), undefined);
  assert.equal(f.db.get(mirrorPath).attendeeCount, 0);
  assert.equal(f.db.get(livePath).attendeeCount, 1);
});

testCase('room join followed by QR sign-in increments only the attendance count', async () => {
  const f = fixture(); await f.api.joinLiveSession(f.request({ qrToken: undefined }));
  const joined = f.db.get(livePath).attendees['student-1'].toMillis(); f.timer.now += 1000;
  await f.api.verifyAttendanceClaim(f.request());
  assert.equal(f.db.get(livePath).attendeeCount, 1);
  assert.equal(f.db.get(mirrorPath).attendeeCount, 1);
  assert.equal(f.db.get(livePath).attendees['student-1'].toMillis(), joined);
});

testCase('an instructor may enter the room but cannot record their own attendance', async () => {
  const f = fixture(); await f.api.joinLiveSession(f.request({ qrToken: undefined }, 'teacher-1'));
  await rejectUnchanged(f, f.request({}, 'teacher-1'), 'permission-denied');
});

testCase('client-supplied UID and time cannot create attendance for another person', async () => {
  const f = fixture();
  const receipt = await f.api.verifyAttendanceClaim(f.request({ uid: 'victim', claim: { uid: 'victim', claimedAt: '2000-01-01T00:00:00Z' } }));
  assert.equal(receipt.uid, 'student-1');
  assert.equal(receipt.checkedInAt, new Date(NOW).toISOString());
  assert.equal(f.db.get(receiptPath('victim')), undefined);
});

testCase('valid QR cannot be reused in another course', async () => {
  const f = fixture();
  f.db.put('groups/other', {});
  f.db.put('groups/other/members/student-1', { status: 'active', role: 'member' });
  await rejectUnchanged(f, f.request({ groupId: 'other' }), 'not-found');
});

for (const uid of [undefined, null, '', ' ', '__proto__']) {
  testCase(`rejects invalid authenticated identity ${String(uid)}`, async () => {
    const f = fixture();
    await rejectUnchanged(f, { auth: { uid }, data: f.request().data }, 'unauthenticated');
  });
}
for (const status of [undefined, null, 'left', 'pending', 'joined', 'revoked']) {
  testCase(`rejects non-active membership ${String(status)}`, async () => {
    const f = fixture(); f.db.put(memberPath('student-1'), { role: 'member', status });
    await rejectUnchanged(f, f.request(), 'permission-denied');
  });
}

testCase('missing membership is rejected', async () => {
  const f = fixture(); f.db.delete(memberPath('student-1'));
  await rejectUnchanged(f, f.request(), 'permission-denied');
});

for (const id of ['', '/', '../other', '__proto__', ' course ', 'x'.repeat(129), 'x\ny']) {
  testCase(`rejects invalid course/document ID ${JSON.stringify(id)}`, async () => {
    const f = fixture();
    await rejectUnchanged(f, f.request({ groupId: id }), 'invalid-argument');
    assert.equal(f.db.getCalls, 0);
  });
}

testCase('UIDs containing dots remain literal map keys', async () => {
  const f = fixture(); f.db.put(memberPath('student.one'), { role: 'member', status: 'active' });
  await f.api.verifyAttendanceClaim(f.request({}, 'student.one'));
  assert.equal(f.db.get(mirrorPath).attendees['student.one'].toMillis(), NOW);
  assert.equal(Object.hasOwn(f.db.get(mirrorPath).attendees, 'student'), false);
});

for (const token of [undefined, null, '', 123, 'ABC123', 'x'.repeat(513), ` ${TOKEN}`]) {
  testCase(`rejects missing or malformed QR ${String(token).slice(0, 30)}`, async () => {
    const f = fixture(); await rejectUnchanged(f, f.request({ qrToken: token }), 'invalid-argument');
  });
}

testCase('a forged complete token cannot cause any write', async () => {
  const f = fixture(); await rejectUnchanged(f, f.request({ qrToken: 'wrong-but-long-enough-token' }), 'permission-denied');
});

testCase('a publicly readable old bearer token requires instructor restart', async () => {
  const f = fixture({ qrToken: TOKEN });
  await rejectUnchanged(f, f.request(), 'failed-precondition');
});

testCase('a hash copied from the session document is not accepted as the QR token', async () => {
  const f = fixture(); await rejectUnchanged(f, f.request({ qrToken: hashQrToken(TOKEN) }), 'permission-denied');
});

for (const value of [null, true, {}, { toMillis: () => NaN }, Timestamp.fromMillis(NOW - 61_000)]) {
  testCase(`rejects missing or invalid QR expiry ${String(value)}`, async () => {
    const f = fixture({ qrExpiresAt: value }); await rejectUnchanged(f, f.request(), 'failed-precondition');
  });
}

testCase('expiry is exclusive: a new check-in at the deadline is rejected', async () => {
  const f = fixture({ qrExpiresAt: Timestamp.fromMillis(NOW) });
  await rejectUnchanged(f, f.request(), 'deadline-exceeded');
});

testCase('late status is derived only from server-owned times', async () => {
  const f = fixture({ lateAfterAt: Timestamp.fromMillis(NOW - 1) });
  assert.equal((await f.api.verifyAttendanceClaim(f.request())).status, 'late');
});

testCase('exactly at the late boundary remains present', async () => {
  const f = fixture({ lateAfterAt: Timestamp.fromMillis(NOW) });
  assert.equal((await f.api.verifyAttendanceClaim(f.request())).status, 'present');
});

testCase('invalid late boundary is not treated as present', async () => {
  const f = fixture({ lateAfterAt: null }); await rejectUnchanged(f, f.request(), 'failed-precondition');
});

testCase('retry after expiry or closure returns an existing receipt without writes', async () => {
  const f = fixture(); const first = await f.api.verifyAttendanceClaim(f.request());
  f.timer.now += 300_000; f.db.put(livePath, { ...f.db.get(livePath), active: false, endedAt: Timestamp.fromMillis(f.timer.now) });
  const before = f.db.dump(); const retry = await f.api.verifyAttendanceClaim(f.request());
  assert.equal(retry.alreadyRecorded, true); assert.equal(retry.checkedInAt, first.checkedInAt);
  assert.deepEqual(f.db.dump(), before);
});

for (const status of ['absent', 'excused', 'suspicious']) {
  testCase(`never overwrites an instructor's ${status} decision`, async () => {
    const f = fixture(); f.db.put(receiptPath('student-1'), { uid: 'student-1', status, source: 'manual' });
    await rejectUnchanged(f, f.request(), 'failed-precondition');
  });
}

testCase('legacy or mismatched receipts are not promoted into verified records', async () => {
  const f = fixture(); await f.api.verifyAttendanceClaim(f.request());
  f.db.put(receiptPath('student-1'), { ...f.db.get(receiptPath('student-1')), uid: 'student-2' });
  await rejectUnchanged(f, f.request(), 'failed-precondition');
});

testCase('missing or closed mirror session cannot be resurrected', async () => {
  const f = fixture(); f.db.delete(mirrorPath); await rejectUnchanged(f, f.request(), 'failed-precondition');
  const g = fixture(); g.db.put(mirrorPath, { ...g.db.get(mirrorPath), active: false });
  await rejectUnchanged(g, g.request(), 'failed-precondition');
});

testCase('server storage failure never returns a receipt or partially increments counts', async () => {
  const f = fixture(); const before = f.db.dump(); f.db.failCommits = true;
  await assert.rejects(f.api.verifyAttendanceClaim(f.request()), /SIMULATED_COMMIT_FAILURE/);
  assert.deepEqual(f.db.dump(), before);
});

testCase('revocation during a transaction retry is rechecked and blocks the write', async () => {
  const f = fixture();
  f.db.beforeCommit = async (db) => db.put(memberPath('student-1'), { role: 'member', status: 'left' });
  await assert.rejects(f.api.verifyAttendanceClaim(f.request()), hasCode('permission-denied'));
  assert.equal(f.db.get(receiptPath('student-1')), undefined);
  assert.equal(f.db.get(mirrorPath).attendeeCount, 0);
  assert.ok(f.db.attempts >= 2);
});

testCase('closure while committing is rechecked before another transaction attempt', async () => {
  const f = fixture();
  f.db.beforeCommit = async (db) => db.put(livePath, { ...db.get(livePath), active: false });
  await assert.rejects(f.api.verifyAttendanceClaim(f.request()), hasCode('not-found'));
  assert.equal(f.db.get(receiptPath('student-1')), undefined);
});

testCase('expiry during a conflict retry uses the new server time', async () => {
  const f = fixture();
  f.db.beforeCommit = async (db) => { f.timer.now += 60_000; db.put(groupPath, { type: 'course', name: 'updated' }); };
  await assert.rejects(f.api.verifyAttendanceClaim(f.request()), hasCode('deadline-exceeded'));
  assert.equal(f.db.get(receiptPath('student-1')), undefined);
});

testCase('invalid server clock cannot produce attendance', async () => {
  const f = fixture(); f.timer.now = NaN; await rejectUnchanged(f, f.request(), 'internal');
});

testCase('end closes both session documents atomically and retains student records', async () => {
  const f = fixture(); await f.api.verifyAttendanceClaim(f.request());
  const before = f.db.get(receiptPath('student-1'));
  const response = await f.api.endLiveSession(f.request({}, 'teacher-1'));
  assert.equal(response.active, false);
  assert.equal(f.db.get(livePath).active, false); assert.equal(f.db.get(mirrorPath).active, false);
  assert.deepEqual(f.db.get(receiptPath('student-1')), before);
});
testCase('duplicate close returns the original close time', async () => {
  const f = fixture(); const first = await f.api.endLiveSession(f.request({}, 'teacher-1'));
  f.timer.now += 5000; assert.deepEqual(await f.api.endLiveSession(f.request({}, 'teacher-1')), first);
});
for (const [uid, membership] of [
  ['student-1', { status: 'active', role: 'member' }],
  ['teacher-2', { status: 'active', role: 'instructor' }],
  ['teacher-1', { status: 'left', role: 'instructor' }],
]) testCase('unauthorized actor cannot close: ' + uid + membership.status, async () => {
  const f = fixture(); f.db.put(memberPath(uid), membership); const before = f.db.dump();
  await assert.rejects(f.api.endLiveSession(f.request({}, uid)), hasCode('permission-denied'));
  assert.deepEqual(f.db.dump(), before);
});
testCase('a new check-in fails after the teacher closes; original receipt remains readable', async () => {
  const f = fixture(); const receipt = await f.api.verifyAttendanceClaim(f.request());
  await f.api.endLiveSession(f.request({}, 'teacher-1'));
  await assert.rejects(f.api.verifyAttendanceClaim(f.request({}, 'student-2')), hasCode('failed-precondition'));
  const retry = await f.api.verifyAttendanceClaim(f.request());
  assert.equal(retry.checkedInAt, receipt.checkedInAt); assert.equal(retry.alreadyRecorded, true);
});
