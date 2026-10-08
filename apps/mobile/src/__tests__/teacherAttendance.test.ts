{
/* Tests run in the existing Jest suite or node --experimental-strip-types. */
const testCase = typeof jest === 'undefined' ? require('node:test').test : global.test;
const assert = require('node:assert/strict');
const root = process.env.ATTENDANCE_CLIENT_DIR;
const { createTeacherAttendance } = require(root ? `${root}/teacherAttendance${process.env.ATTENDANCE_CLIENT_EXT || '.js'}` : '../services/teacherAttendance.ts');
const { attendanceQr } = require(root ? `${root}/attendanceQr${process.env.ATTENDANCE_CLIENT_EXT || '.js'}` : '../services/attendanceQr.ts');
const NOW = Date.parse('2026-10-08T07:00:00.000Z');
const TOKEN = 'A'.repeat(32);
const scope = { uid: 'teacher-1', groupId: 'course-1' };
const startAck = { success: true, groupId: 'course-1', sessionId: 'session-1', qrToken: TOKEN, qrExpiresAt: new Date(NOW + 300_000).toISOString() };
function fixture(overrides = {}) {
  const calls = { start: 0, end: 0, read: 0 };
  const time = { now: NOW };
  const api = createTeacherAttendance(scope, {
    now: () => time.now,
    start: async () => { calls.start++; return startAck; },
    end: async () => { calls.end++; return { success: true, groupId: 'course-1', sessionId: 'session-1', active: false, endedAt: new Date(time.now).toISOString() }; },
    read: async () => { calls.read++; return { groupId: 'course-1', sessionId: 'session-1', teacherId: scope.uid, active: true, attendeeCount: 3 }; },
    ...overrides,
  });
  return { api, calls, time };
}
function deferred() {
  let resolve: (value: unknown) => void = () => {};
  let reject: (value: unknown) => void = () => {};
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
testCase('teacher only displays the token returned for this course', async () => {
  const { api } = fixture(); await api.start();
  assert.equal(api.getState().token, TOKEN); assert.equal(api.getState().phase, 'active');
});
testCase('double taps cause one start request, not duplicate sessions', async () => {
  const pending = deferred(); let calls = 0;
  const { api } = fixture({ start: () => { calls++; return pending.promise; } });
  const first = api.start(); await api.start(); assert.equal(calls, 1);
  pending.resolve(startAck); await first; assert.equal(api.getState().phase, 'active');
});
for (const [label, mutation] of [
  ['wrong course', { groupId: 'other' }], ['missing success', { success: false }],
  ['short token', { qrToken: '123456' }], ['bad expiry', { qrExpiresAt: 'bad' }],
  ['invalid id', { sessionId: '../bad' }],
] as const) testCase(`rejects start acknowledgement: ${label}`, async () => {
  const { api } = fixture({ start: async () => ({ ...startAck, ...mutation }) }); await api.start();
  assert.equal(api.getState().phase, 'uncertain'); assert.equal(api.getState().token, '');
});
testCase('a lost start response blocks blind duplicate creation', async () => {
  let calls = 0; const { api } = fixture({ start: async () => { calls++; throw new Error('network'); } });
  await api.start(); await api.start(); assert.equal(calls, 1); assert.equal(api.getState().phase, 'uncertain');
});
testCase('closing requires a matching server acknowledgement', async () => {
  const { api } = fixture({ end: async () => ({ success: true }) });
  await api.start(); await api.end(); assert.equal(api.getState().phase, 'unavailable'); assert.equal(api.getState().token, '');
});
testCase('valid close permits a later new session', async () => {
  const { api, calls } = fixture(); await api.start(); await api.end();
  assert.equal(api.getState().phase, 'closed'); assert.equal(api.getState().token, '');
  await api.start(); assert.equal(calls.start, 2);
});
testCase('expiry clears the token at the exact boundary', async () => {
  const { api, time } = fixture(); await api.start(); time.now += 300_000; api.tick();
  assert.equal(api.getState().phase, 'expired'); assert.equal(api.getState().token, '');
});
testCase('an already expired response is never displayed', async () => {
  const { api } = fixture({ start: async () => ({ ...startAck, qrExpiresAt: new Date(NOW).toISOString() }) });
  await api.start(); assert.equal(api.getState().phase, 'expired'); assert.equal(api.getState().token, '');
});
testCase('snapshot refresh updates counts without replacing the token from Firestore', async () => {
  const { api } = fixture(); await api.start(); await api.inspect();
  assert.equal(api.getState().count, 3); assert.equal(api.getState().token, TOKEN);
});
testCase('opening an existing session never recovers a token from public data', async () => {
  const { api } = fixture({ read: async () => ({ ...scope, teacherId: scope.uid, sessionId: 'session-1', active: true, attendeeCount: 4, qrToken: TOKEN }) });
  await api.inspect('session-1'); assert.equal(api.getState().token, ''); assert.equal(api.getState().phase, 'unavailable');
});
for (const mutation of [{ teacherId: 'other' }, { attendeeCount: -1 }, { attendeeCount: NaN }, { groupId: 'other' }]) {
  testCase(`bad snapshot suppresses QR: ${JSON.stringify(mutation)}`, async () => {
    const { api } = fixture({ read: async () => ({ ...scope, teacherId: scope.uid, sessionId: 'session-1', active: true, attendeeCount: 4, ...mutation }) });
    await api.start(); await api.inspect(); assert.equal(api.getState().token, '');
  });
}
testCase('closing elsewhere clears the local token on refresh', async () => {
  const { api } = fixture({ read: async () => ({ ...scope, teacherId: scope.uid, sessionId: 'session-1', active: false, attendeeCount: 2 }) });
  await api.start(); await api.inspect(); assert.equal(api.getState().phase, 'closed'); assert.equal(api.getState().token, '');
});
testCase('logout disposes state and late responses cannot repopulate it', async () => {
  const pending = deferred(); const { api } = fixture({ start: () => pending.promise });
  const first = api.start(); api.dispose(); pending.resolve(startAck); await first;
  assert.equal(api.getState().token, ''); assert.equal(api.getState().phase, 'idle');
});
testCase('stale refresh response cannot undo a confirmed close', async () => {
  const pending = deferred(); const { api } = fixture({ read: () => pending.promise });
  await api.start(); const read = api.inspect(); await api.end();
  pending.resolve({ ...scope, teacherId: scope.uid, sessionId: 'session-1', active: true, attendeeCount: 7 }); await read;
  assert.equal(api.getState().phase, 'closed'); assert.equal(api.getState().token, '');
});
for (const bad of ['', '123456', 'A'.repeat(31), 'A'.repeat(33), '含'.repeat(32), ' '.repeat(32)]) {
  testCase('QR encoder rejects an unsupported token ' + bad.length, () => assert.throws(() => attendanceQr(bad)));
}
testCase('QR has a deterministic 29 by 29 boolean matrix', () => {
  const matrix = attendanceQr(TOKEN);
  assert.equal(matrix.length, 29); assert.ok(matrix.every((r: boolean[]) => r.length === 29 && r.every((v) => typeof v === 'boolean')));
  assert.deepEqual(matrix, attendanceQr(TOKEN));
});

}
