'use strict';

const assert = require('node:assert/strict');
const test = globalThis.test || require('node:test').test;
const { createVerifyAttendanceClaim } = require('./verifyClaim');

const NOW = Date.parse('2026-10-08T06:30:00Z');
const GROUP = 'course-1';
const SESSION = 'class-1';
const UID = 'student.one';
const TOKEN = 'server-classroom-token-not-a-six-digit-demo-code';
const paths = {
  group: `groups/${GROUP}`, member: `groups/${GROUP}/members/${UID}`,
  live: `groups/${GROUP}/liveSessions/${SESSION}`,
  session: `groups/${GROUP}/attendanceSessions/${SESSION}`,
  record: `groups/${GROUP}/attendanceSessions/${SESSION}/attendanceRecords/${UID}`,
};
class CallableError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const Fields = { increment: (value) => ({ incrementBy: value }) };
const Times = { fromMillis: (value) => new Date(value) };

function copy(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(copy);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
  }
  return value;
}

function merge(previous, next) {
  const out = copy(previous ?? {});
  for (const [key, value] of Object.entries(next)) {
    if (value && typeof value === 'object' && 'incrementBy' in value) {
      out[key] = (out[key] ?? 0) + value.incrementBy;
    } else if (value && typeof value === 'object' && !(value instanceof Date)) {
      out[key] = merge(out[key], value);
    } else out[key] = copy(value);
  }
  return out;
}

// Small optimistic-transaction double. Real Firestore coverage lives in *.emulator.cjs.
function setup() {
  const initial = {
    [paths.group]: { type: 'course' },
    [paths.member]: { status: 'active', role: 'member' },
    [paths.live]: { active: true, teacherId: 'teacher-1', qrToken: TOKEN,
      startedAt: new Date(NOW - 60_000), qrExpiresAt: new Date(NOW + 300_000) },
    [paths.session]: { active: true, groupId: GROUP, liveSessionId: SESSION,
      source: 'live_session', attendanceMode: 'qr', attendeeCount: 0 },
  };
  const documents = new Map(Object.entries(initial));
  const versions = new Map();
  let commits = 0;
  let attempts = 0;
  let beforeCommit = null;
  let now = NOW;
  const update = (path, data) => {
    if (data === undefined) documents.delete(path); else documents.set(path, copy(data));
    versions.set(path, (versions.get(path) ?? 0) + 1);
  };
  function ref(path) {
    return { path, doc: (id) => ref(`${path}/${id}`), collection: (name) => ref(`${path}/${name}`) };
  }
  const db = {
    collection: ref,
    async runTransaction(callback) {
      for (let attempt = 0; attempt < 12; attempt++) {
        attempts++;
        const reads = new Map();
        const writes = [];
        const transaction = {
          async get(reference) {
            assert.equal(writes.length, 0, 'all reads must precede writes');
            reads.set(reference.path, versions.get(reference.path) ?? 0);
            const value = copy(documents.get(reference.path));
            return { exists: value !== undefined, data: () => value };
          },
          create(reference, value) { writes.push({ kind: 'create', path: reference.path, value }); },
          set(reference, value, options) {
            assert.deepEqual(options, { merge: true });
            writes.push({ kind: 'merge', path: reference.path, value });
          },
        };
        const result = await callback(transaction);
        if (beforeCommit) {
          const hook = beforeCommit; beforeCommit = null; await hook();
        }
        if ([...reads].some(([path, version]) => (versions.get(path) ?? 0) !== version)) continue;
        for (const write of writes) {
          if (write.kind === 'create') assert.equal(documents.has(write.path), false);
        }
        for (const write of writes) {
          update(write.path, write.kind === 'create' ? write.value : merge(documents.get(write.path), write.value));
        }
        commits++;
        return result;
      }
      throw new Error('transaction retry budget exhausted');
    },
  };
  const handler = createVerifyAttendanceClaim({ db, FieldValue: Fields, Timestamp: Times,
    HttpsError: CallableError, clock: () => now });
  return { handler, documents, update, get commits() { return commits; },
    get attempts() { return attempts; }, set now(value) { now = value; },
    set beforeCommit(hook) { beforeCommit = hook; } };
}
const request = (data = {}) => ({ auth: { uid: UID }, data: {
  courseId: GROUP, sessionId: SESSION, claim: { token: TOKEN }, ...data,
} });
async function rejectsWithoutRecord(context, req, code) {
  await assert.rejects(() => context.handler(req), (error) => error.code === code);
  assert.equal(context.documents.has(paths.record), false);
  assert.equal(context.documents.get(paths.session).attendeeCount, 0);
}

test('commits a QR attendance record and returns a receipt for the authenticated UID', async () => {
  const context = setup();
  const result = await context.handler(request());
  assert.deepEqual(result, { valid: true, attendanceRecorded: true, status: 'present', uid: UID,
    courseId: GROUP, sessionId: SESSION, checkedInAt: new Date(NOW).toISOString(), alreadyRecorded: false });
  assert.equal(context.documents.get(paths.record).uid, UID);
  assert.equal(context.documents.get(paths.session).attendeeCount, 1);
  assert.equal(context.commits, 1);
});

test('stores dotted UIDs as a literal attendee key, preserving other students', async () => {
  const context = setup();
  context.update(paths.session, { ...context.documents.get(paths.session), attendees: { 'another.user': new Date(NOW - 1) } });
  await context.handler(request());
  const attendees = context.documents.get(paths.session).attendees;
  assert.equal(attendees.student, undefined);
  assert.ok(attendees['student.one'] instanceof Date);
  assert.ok(attendees['another.user'] instanceof Date);
});

test('rejects unauthenticated requests', async () => {
  await rejectsWithoutRecord(setup(), { data: request().data }, 'unauthenticated');
});

test('rejects a forged claim UID without publishing attendance for either account', async () => {
  await rejectsWithoutRecord(setup(), request({ claim: { token: TOKEN, uid: 'other-student' } }), 'permission-denied');
});

for (const courseId of ['', 'group/elsewhere', '..', '__reserved__', ' course-1', 12, 'x'.repeat(201)]) {
  test(`rejects invalid course identifier ${JSON.stringify(courseId)}`, async () => {
    await rejectsWithoutRecord(setup(), request({ courseId }), 'invalid-argument');
  });
}
for (const claim of [null, [], {}, { token: '' }, { token: 42 }, { token: 'x'.repeat(1025) }]) {
  test(`rejects missing or malformed QR proof ${JSON.stringify(claim).slice(0,50)}`, async () => {
    await rejectsWithoutRecord(setup(), request({ claim }), 'invalid-argument');
  });
}
for (const membership of [undefined, { role: 'member' }, { status: 'left', role: 'member' },
  { status: 'pending', role: 'member' }, { status: 'active', role: 'instructor' }, { status: 'active', role: 'owner' }]) {
  test(`requires current student membership: ${JSON.stringify(membership)}`, async () => {
    const context = setup(); context.update(paths.member, membership);
    await rejectsWithoutRecord(context, request(), 'permission-denied');
  });
}

test('rejects attendance for a different course or missing session', async () => {
  await rejectsWithoutRecord(setup(), request({ courseId: 'another-course' }), 'permission-denied');
  await rejectsWithoutRecord(setup(), request({ sessionId: 'another-session' }), 'not-found');
});

test('does not accept a client-created or mismatched attendance configuration', async () => {
  const context = setup();
  context.update(paths.session, { ...context.documents.get(paths.session), source: 'client-demo' });
  await rejectsWithoutRecord(context, request(), 'failed-precondition');
});

test('a teacher cannot check in as a student even with a student-role record', async () => {
  const context = setup();
  context.update(paths.live, { ...context.documents.get(paths.live), teacherId: UID });
  await rejectsWithoutRecord(context, request(), 'permission-denied');
});

test('checks the real QR instead of client supplied secret or preflight result', async () => {
  await rejectsWithoutRecord(setup(), request({ claim: { token: 'fake-qr', valid: true, secret: TOKEN } }), 'permission-denied');
});

test('uses server time for late status, ignoring the claimed timestamp', async () => {
  const context = setup();
  context.update(paths.live, { ...context.documents.get(paths.live), lateAfterAt: new Date(NOW - 1) });
  const result = await context.handler(request({ claim: { token: TOKEN, claimedAt: '2000-01-01T00:00:00Z' } }));
  assert.equal(result.status, 'late');
  assert.equal(result.checkedInAt, new Date(NOW).toISOString());
});

for (const change of [{ active: false }, { startedAt: new Date(NOW + 1) },
  { qrExpiresAt: new Date(NOW) }, { qrExpiresAt: undefined }, { closesAt: new Date(NOW) },
  { startedAt: 'invalid' }, { lateAfterAt: 'invalid' }]) {
  test(`fails closed on session state ${JSON.stringify(change)}`, async () => {
    const context = setup(); context.update(paths.live, { ...context.documents.get(paths.live), ...change });
    await assert.rejects(() => context.handler(request()));
    assert.equal(context.documents.has(paths.record), false);
  });
}

test('retries return the original receipt without changing the timestamp or count', async () => {
  const context = setup();
  const first = await context.handler(request());
  context.now = NOW + 500_000;
  context.update(paths.live, { ...context.documents.get(paths.live), active: false });
  const second = await context.handler(request());
  assert.equal(second.alreadyRecorded, true);
  assert.equal(second.checkedInAt, first.checkedInAt);
  assert.equal(context.documents.get(paths.session).attendeeCount, 1);
});

test('concurrent duplicate requests have one writer and matching receipts', async () => {
  const context = setup();
  const results = await Promise.all(Array.from({ length: 6 }, () => context.handler(request())));
  assert.equal(results.filter((result) => !result.alreadyRecorded).length, 1);
  assert.equal(context.documents.get(paths.session).attendeeCount, 1);
  assert.ok(context.attempts > 6);
});

test('rechecks membership if it is revoked while the transaction is committing', async () => {
  const context = setup();
  context.beforeCommit = () => context.update(paths.member, { status: 'left', role: 'member' });
  await rejectsWithoutRecord(context, request(), 'permission-denied');
});

test('a failed commit does not return success or apply partial writes', async () => {
  const context = setup();
  context.beforeCommit = () => { throw new Error('storage unavailable'); };
  await assert.rejects(() => context.handler(request()), /storage unavailable/);
  assert.equal(context.documents.has(paths.record), false);
  assert.equal(context.documents.get(paths.session).attendeeCount, 0);
});

test('keeps teacher adjustments instead of overwriting them on student retry', async () => {
  const context = setup();
  context.update(paths.record, { uid: UID, groupId: GROUP, sessionId: SESSION,
    status: 'excused', checkedInAt: new Date(NOW) });
  await assert.rejects(() => context.handler(request()), (error) => error.code === 'failed-precondition');
  assert.equal(context.documents.get(paths.record).status, 'excused');
});

test('refuses to increment invalid aggregate data', async () => {
  const context = setup(); context.update(paths.session, { ...context.documents.get(paths.session), attendeeCount: NaN });
  await assert.rejects(() => context.handler(request()), (error) => error.code === 'failed-precondition');
  assert.ok(Number.isNaN(context.documents.get(paths.session).attendeeCount));
  assert.equal(context.documents.has(paths.record), false);
});
