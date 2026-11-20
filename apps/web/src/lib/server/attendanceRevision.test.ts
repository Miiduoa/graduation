// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createLiveSessionHandlers } from './attendanceSessionHandlers';
import { createMemoryGroupStore } from './memoryGroupStore';

const require = createRequire(import.meta.url);
const functions = require('../../../../../backend/functions/attendanceSessions.js') as {
  createLiveSessionHandlers: typeof createLiveSessionHandlers;
};
const root = 'groups/course';
const recordPath = `${root}/attendanceSessions/session/attendanceRecords/student`;
function seed() {
  return createMemoryGroupStore([
    [root, { type: 'course', schoolId: 'school' }],
    [`${root}/members/teacher`, { role: 'instructor', status: 'active' }],
    [`${root}/members/second`, { role: 'instructor', status: 'active' }],
    [`${root}/members/student`, { role: 'student', status: 'active' }],
    ['schools/school/members/teacher', { status: 'active' }],
    ['schools/school/members/second', { status: 'active' }],
    ['schools/school/members/student', { status: 'active' }],
    [`${root}/liveSessions/session`, { schemaVersion: 2, groupId: 'course', sessionId: 'session', active: false, attendeeCount: 0 }],
    [`${root}/attendanceSessions/session`, { schemaVersion: 2, groupId: 'course', sessionId: 'session', active: false, attendeeCount: 0 }],
  ]);
}
const command = (status: string, requestId: string, expectedRevision: unknown, uid = 'teacher') => ({
  auth: { uid }, data: { groupId: 'course', sessionId: 'session', studentUid: 'student',
    status, reason: '授課教師現場確認出席紀錄', requestId,
    ...(expectedRevision !== undefined ? { expectedRevision } : {}),
  },
});
for (const [name, factory] of [
  ['web', createLiveSessionHandlers], ['functions', functions.createLiveSessionHandlers],
] as const) describe(`${name} reviewed correction revisions`, () => {
  function setup() {
    const store = seed();
    return { store, handlers: factory({ db: store.db as never, now: () => 1793152800000 }) };
  }
  it('does not overwrite a newer instructor decision from an older review', async () => {
    const { store, handlers } = setup();
    await handlers.correctAttendanceRecord(command('excused', 'first', null));
    await expect(handlers.correctAttendanceRecord(command('absent', 'second', null, 'second')))
      .rejects.toMatchObject({ code: 'aborted' });
    expect(store.docs.get(recordPath)).toMatchObject({ status: 'excused', revision: 1 });
    expect([...store.docs.keys()].filter((key) => key.includes('/attendanceCorrections/'))).toHaveLength(1);
    await handlers.correctAttendanceRecord(command('absent', 'reviewed-again', 1, 'second'));
    expect(store.docs.get(recordPath)).toMatchObject({ status: 'absent', revision: 2 });
  });
  it('reuses an acknowledged request before checking its now-older expected revision', async () => {
    const { store, handlers } = setup();
    const request = command('present', 'same', null);
    await handlers.correctAttendanceRecord(request);
    expect(await handlers.correctAttendanceRecord(request)).toMatchObject({ success: true, reused: true });
    expect(store.docs.get(recordPath)?.revision).toBe(1);
    expect(store.docs.get(`${root}/attendanceSessions/session`)?.attendeeCount).toBe(1);
    await expect(handlers.correctAttendanceRecord(command('present', 'same', 1)))
      .rejects.toMatchObject({ code: 'already-exists' });
  });
  it('legacy callers increment revisions so a previously reviewed form detects their changes', async () => {
    const { store, handlers } = setup();
    await handlers.correctAttendanceRecord(command('excused', 'legacy', undefined));
    await expect(handlers.correctAttendanceRecord(command('absent', 'stale', null)))
      .rejects.toMatchObject({ code: 'aborted' });
    expect(store.docs.get(recordPath)?.revision).toBe(1);
  });
  it.each([null, '0', false, [], {}, -1, 0.5, Number.MAX_SAFE_INTEGER])('does not repair a malformed stored revision %j implicitly', async (revision) => {
    const { store, handlers } = setup();
    store.docs.set(recordPath, { uid: 'student', groupId: 'course', sessionId: 'session', status: 'excused', revision });
    await expect(handlers.correctAttendanceRecord(command('present', 'attempt', undefined)))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect([...store.docs.keys()].filter((key) => key.includes('/attendanceCorrections/'))).toHaveLength(0);
  });
  it.each(['0', false, [], {}, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects malformed expected revision %j', async (revision) => {
    const { store, handlers } = setup();
    await expect(handlers.correctAttendanceRecord(command('present', 'attempt', revision)))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(store.docs.has(recordPath)).toBe(false);
  });
});
