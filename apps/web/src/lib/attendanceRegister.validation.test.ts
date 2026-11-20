import { expect, it } from 'vitest';
import {
  REGISTER_LABELS, assembleAttendanceRegister, attendanceRegisterCsv,
  filterAttendanceRegister, summarizeAttendanceRegister, type RegisterStatus,
} from './attendanceRegister';

const student = { uid: 'student', displayName: '陳同學', studentId: 'S001' };
const scope = { courseId: 'course', sessionId: 'session', complete: true };
const checkedAt = '2026-10-27T02:00:00.000Z';
const receipt = (patch: Record<string, unknown> = {}) => ({
  id: student.uid,
  data: {
    uid: student.uid, groupId: scope.courseId, sessionId: scope.sessionId,
    status: 'present', source: 'qr', checkedInAt: '2026-10-27T01:00:00Z', ...patch,
  },
});
const statuses = Object.keys(REGISTER_LABELS) as RegisterStatus[];

it.each([
  ['present'], ['late'], ['absent'], ['excused'], ['present', 'late'],
  [], {}, null, undefined, 0, 1, true, false,
].map((value) => ({ value })))('rejects a non-string persisted status: $value', ({ value }) => {
  const rows = assembleAttendanceRegister([student], [receipt({ status: value })], scope);
  expect(rows[0]).toMatchObject({
    status: 'unavailable', source: null, checkedInAt: null, correctedAt: null,
  });
  const counts = summarizeAttendanceRegister(rows);
  for (const status of statuses) {
    expect(counts[status]).toBe(filterAttendanceRegister(rows, status, '').length);
  }
  expect(counts.present).toBe(0);
  expect(counts.absent).toBe(0);
  expect(attendanceRegisterCsv(rows, checkedAt)).toContain('待核實');
});

it.each([
  ['qr'], ['manual'], [], {}, '', 'imported-unknown', 0, true, false,
].map((value) => ({ value })))('does not hide a malformed source as an unmarked record: $value', ({ value }) => {
  const rows = assembleAttendanceRegister([student], [receipt({ source: value })], scope);
  expect(rows[0].status).toBe('unavailable');
  expect(rows[0].source).toBeNull();
});

it.each(['absent', 'excused'])('does not accept QR as the source of an explicit %s decision', (status) => {
  const rows = assembleAttendanceRegister([student], [receipt({ status, checkedInAt: null })], scope);
  expect(rows[0].status).toBe('unavailable');
});

it.each([undefined, null])('keeps valid legacy records without a source: %s', (source) => {
  const rows = assembleAttendanceRegister([student], [receipt({ source })], scope);
  expect(rows[0]).toMatchObject({ status: 'present', source: null });
  expect(summarizeAttendanceRegister(rows).present).toBe(1);
  expect(filterAttendanceRegister(rows, 'present', '')).toHaveLength(1);
});

it.each(['present', 'late', 'absent', 'excused'])('preserves valid teacher-attested %s records', (status) => {
  const rows = assembleAttendanceRegister([student], [receipt({
    status, source: 'manual', correctedAt: checkedAt,
    checkedInAt: status === 'present' || status === 'late' ? '2026-10-27T01:00:00Z' : null,
  })], scope);
  expect(rows[0]).toMatchObject({ status, source: 'manual', correctedAt: checkedAt });
  expect(filterAttendanceRegister(rows, status as RegisterStatus, 'Ｓ００１')).toHaveLength(1);
});

it('never invokes a stored status coercion to classify an attendance record', () => {
  const status = { toString() { throw new Error('do not coerce persisted status'); } };
  const rows = assembleAttendanceRegister([student], [receipt({ status })], scope);
  expect(rows[0].status).toBe('unavailable');
  expect(attendanceRegisterCsv(rows, checkedAt)).toContain('待核實');
});
