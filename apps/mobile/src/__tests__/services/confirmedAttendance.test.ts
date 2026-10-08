import assert from 'node:assert/strict';
import { test as nativeTest } from 'node:test';
import { confirmQrAttendance } from '../../services/confirmedAttendance';

const run = typeof test === 'undefined' ? nativeTest : test;
const input = { courseSpaceId: 'course-1', sessionId: 'class-1', qrToken: 'server-token', uid: 'student-1' };
const valid = { valid: true, attendanceRecorded: true, status: 'present', uid: 'student-1',
  courseId: 'course-1', sessionId: 'class-1', checkedInAt: '2026-10-08T06:30:00.000Z', alreadyRecorded: false };

run('calls the verification endpoint with the actual QR token and account', async () => {
  let notified = 0;
  const result = await confirmQrAttendance(input, {
    invoke: async (payload) => {
      assert.deepEqual(payload, { courseId: 'course-1', sessionId: 'class-1', claim: { token: 'server-token', uid: 'student-1' } });
      return valid;
    },
    onConfirmed: () => { notified++; },
  });
  assert.equal(result.success, true);
  assert.equal(notified, 1);
});

const rejected: unknown[] = [null, [], {}, { success: true, attendanceRecorded: false },
  { ...valid, attendanceRecorded: false }, { ...valid, valid: false }, { ...valid, status: 'absent' },
  { ...valid, uid: 'another-student' }, { ...valid, courseId: 'another-course' },
  { ...valid, sessionId: 'another-class' }, { ...valid, checkedInAt: 'not-a-date' },
  { ...valid, alreadyRecorded: undefined }];
for (let i = 0; i < rejected.length; i++) {
  run(`does not notify or report success for an unconfirmed/mismatched receipt (${i + 1})`, async () => {
    let notified = 0;
    await assert.rejects(() => confirmQrAttendance(input, {
      invoke: async () => rejected[i], onConfirmed: () => { notified++; },
    }));
    assert.equal(notified, 0);
  });
}

run('does not call the backend when a QR code is missing', async () => {
  let called = false;
  await assert.rejects(() => confirmQrAttendance({ ...input, qrToken: '' }, {
    invoke: async () => { called = true; return valid; }, onConfirmed: () => undefined,
  }));
  assert.equal(called, false);
});

run('network failure remains a failure and does not emit attendance', async () => {
  let notified = false;
  await assert.rejects(() => confirmQrAttendance(input, {
    invoke: async () => { throw new Error('unavailable'); }, onConfirmed: () => { notified = true; },
  }), /unavailable/);
  assert.equal(notified, false);
});

run('a retry receipt does not repeat companion side effects', async () => {
  let notified = 0;
  const result = await confirmQrAttendance(input, {
    invoke: async () => ({ ...valid, alreadyRecorded: true }), onConfirmed: () => { notified++; },
  });
  assert.equal(result.success, true);
  assert.equal(notified, 0);
});

run('a failed optional companion hint cannot undo a committed attendance', async () => {
  const result = await confirmQrAttendance(input, {
    invoke: async () => valid, onConfirmed: async () => { throw new Error('hint failed'); },
  });
  assert.equal(result.success, true);
});
