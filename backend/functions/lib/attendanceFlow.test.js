'use strict';
const testCase = typeof jest === 'undefined' ? require('node:test').test : global.test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createLiveAttendanceHandlers } = require('./liveAttendance');
const { TransactionStore, Timestamp, FieldValue, HttpsError } = require('../test-support/transactionStore');
const client = process.env.ATTENDANCE_CLIENT_DIR;
const clientModule = (name) => path.join(client, name + (process.env.ATTENDANCE_CLIENT_EXT || '.js'));
// This cross-runtime test is executed by the focused Node runner after tsc.
// The backend's existing Jest suite still runs the entrypoint and export tests below.
const flowCase = client ? testCase : testCase.skip;
function fixture() {
  const db = new TransactionStore(); const clock = { now: Date.parse('2026-10-08T07:00:00.000Z') };
  db.put('groups/course-1', { type: 'course' });
  db.put('groups/course-1/members/teacher-1', { role: 'instructor', status: 'active' });
  for (const uid of ['student-1', 'student-2']) db.put('groups/course-1/members/' + uid, { role: 'member', status: 'active' });
  const backend = createLiveAttendanceHandlers({ db, Timestamp, FieldValue, HttpsError, clock: () => clock.now });
  const teacherRequest = (data) => ({ auth: { uid: 'teacher-1' }, data });
  const { createTeacherAttendance } = require(clientModule('teacherAttendance'));
  const teacher = createTeacherAttendance({ uid: 'teacher-1', groupId: 'course-1' }, {
    now: () => clock.now,
    start: (groupId) => backend.startLiveSession(teacherRequest({ groupId })),
    end: (groupId, sessionId) => backend.endLiveSession(teacherRequest({ groupId, sessionId })),
    read: async (groupId, sessionId) => {
      const live = db.get(`groups/${groupId}/liveSessions/${sessionId}`);
      const mirror = db.get(`groups/${groupId}/attendanceSessions/${sessionId}`);
      return { ...live, active: live.active && mirror.active, attendeeCount: mirror.attendeeCount };
    },
  });
  return { db, clock, backend, teacher };
}
flowCase('teacher starts → student signs → teacher reads count → teacher closes', async () => {
  const f = fixture(); await f.teacher.start();
  const state = f.teacher.getState(); assert.equal(state.phase, 'active');
  const scope = { uid: 'student-1', groupId: 'course-1', sessionId: state.sessionId };
  const { buildLiveAttendanceRequest, parseLiveAttendanceReceipt } = require(clientModule('liveAttendanceReceipt'));
  const request = buildLiveAttendanceRequest(scope, state.token);
  const response = await f.backend.verifyAttendanceClaim({ auth: { uid: scope.uid }, data: request });
  assert.ok(parseLiveAttendanceReceipt(response, scope));
  await f.teacher.inspect(); assert.equal(f.teacher.getState().count, 1);
  await f.teacher.end(); assert.equal(f.teacher.getState().phase, 'closed');
  await assert.rejects(f.backend.verifyAttendanceClaim({ auth: { uid: 'student-2' }, data: request }));
  const retry = await f.backend.verifyAttendanceClaim({ auth: { uid: scope.uid }, data: request });
  assert.equal(retry.checkedInAt, response.checkedInAt); assert.equal(retry.alreadyRecorded, true);
});
flowCase('expiry hides the displayed QR and server rejects an unused old token', async () => {
  const f = fixture(); await f.teacher.start(); const s = f.teacher.getState();
  f.clock.now = Date.parse(s.expiresAt); f.teacher.tick(); assert.equal(f.teacher.getState().token, '');
  await assert.rejects(f.backend.verifyAttendanceClaim({ auth: { uid: 'student-1' }, data: { groupId: 'course-1', sessionId: s.sessionId, qrToken: s.token } }), (e) => e.code === 'deadline-exceeded');
});
flowCase('the QR matrix encodes the exact bearer token from the server', async () => {
  const f = fixture(); await f.teacher.start(); const { attendanceQr } = require(clientModule('attendanceQr'));
  assert.equal(attendanceQr(f.teacher.getState().token).length, 29);
  assert.equal(JSON.stringify(f.db.dump()).includes(f.teacher.getState().token), false);
});
flowCase('closing with revoked teacher membership fails and never shows a closed acknowledgement', async () => {
  const f = fixture(); await f.teacher.start();
  f.db.put('groups/course-1/members/teacher-1', { role: 'instructor', status: 'left' });
  await f.teacher.end(); assert.equal(f.teacher.getState().phase, 'unavailable');
  assert.equal(f.db.get('groups/course-1/liveSessions/' + f.teacher.getState().sessionId).active, true);
});

testCase('Firebase entry preserves unrelated exports and replaces all attendance endpoints', () => {
  const original = { unrelated: () => 9, startLiveSession: () => 'old', endLiveSession: () => 'old', joinLiveSession: () => 'old' };
  const handlers = { startLiveSession() {}, endLiveSession() {}, joinLiveSession() {}, verifyAttendanceClaim() {} };
  const source = fs.readFileSync(path.join(__dirname, '../entry.js'), 'utf8');
  const target = { exports: {} }; const requested = [];
  vm.runInNewContext(source, { module: target, console, require: (name) => {
    requested.push(name);
    if (name === './index') return original;
    if (name === 'firebase-admin/firestore') return { getFirestore: () => ({}), FieldValue: {}, Timestamp: {} };
    if (name === 'firebase-admin/messaging') return { getMessaging: () => ({}) };
    if (name === 'firebase-functions/v2/https') return { onCall: (options, fn) => ({ options, fn }), HttpsError };
    if (name === './lib/notificationService') return { createNotificationService: () => ({ getUserPushTokens: async () => [] }) };
    if (name === './lib/liveAttendance') return { createLiveAttendanceHandlers: () => handlers };
    throw new Error('unexpected dependency ' + name);
  } });
  assert.equal(requested[0], './index'); assert.equal(target.exports.unrelated, original.unrelated);
  for (const name of Object.keys(handlers)) {
    assert.equal(target.exports[name].fn, handlers[name]); assert.equal(target.exports[name].options.region, 'asia-east1');
  }
  assert.equal(require('../package.json').main, 'entry.js');
});
