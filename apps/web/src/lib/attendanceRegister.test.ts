import { expect, it } from 'vitest';
import { assembleAttendanceRegister, attendanceRegisterCsv, filterAttendanceRegister, summarizeAttendanceRegister } from './attendanceRegister';

const students = [
  { uid: 'alice', displayName: '學生甲', studentId: 'S001' },
  { uid: 'bob', displayName: '學生乙', studentId: 'S002' },
];
const scope = { courseId: 'course', sessionId: 'session', complete: true };
const receipt = (patch: Record<string, unknown> = {}) => ({ id: 'alice', data: {
  uid: 'alice', groupId: 'course', sessionId: 'session', status: 'present',
  source: 'qr', checkedInAt: '2026-10-27T01:00:00Z', ...patch,
} });

it('keeps missing receipts unconfirmed instead of inferring absence', () => {
  const rows = assembleAttendanceRegister(students, [], scope);
  expect(summarizeAttendanceRegister(rows)).toMatchObject({ unconfirmed: 2, absent: 0, present: 0 });
});
it('does not interpret truncated receipt queries as missing attendance', () => {
  const rows = assembleAttendanceRegister(students, [receipt()], { ...scope, complete: false });
  expect(rows.map((row) => row.status)).toEqual(['present', 'unavailable']);
});
it.each([{ uid: 'other' }, { groupId: 'other' }, { sessionId: 'other' }, { status: 'forged' }, { checkedInAt: null }, { checkedInAt: 'bad-time' }])(
  'rejects mismatched or malformed receipt %j', (patch) => {
    expect(assembleAttendanceRegister(students, [receipt(patch)], scope)[0].status).toBe('unavailable');
  },
);
it.each(['absent', 'excused'])('shows explicit %s without needing a check-in timestamp', (status) => {
  const row = assembleAttendanceRegister(students, [receipt({ status, source: 'manual', checkedInAt: null, correctedAt: '2026-10-27T02:00:00Z' })], scope)[0];
  expect(row.status).toBe(status);
  expect(row.checkedInAt).toBeNull();
  expect(row.correctedAt).toBe('2026-10-27T02:00:00.000Z');
});
it('requires a valid approval time for manual records', () => {
  expect(assembleAttendanceRegister(students, [receipt({ source: 'manual' })], scope)[0].status).toBe('unavailable');
});
it('uses current membership identity and ignores non-member receipts', () => {
  const rows = assembleAttendanceRegister(students, [receipt({ displayName: '偽造姓名' }), { id: 'outsider', data: receipt().data }], scope);
  expect(rows).toHaveLength(2);
  expect(rows[0].displayName).toBe('學生甲');
});
it('combines status with width-insensitive name, number and UID searches', () => {
  const rows = assembleAttendanceRegister(students, [receipt()], scope);
  expect(filterAttendanceRegister(rows, 'unconfirmed', 'ｓ００２')).toEqual([rows[1]]);
  expect(filterAttendanceRegister(rows, 'present', 'bob')).toEqual([]);
  expect(filterAttendanceRegister(rows, 'all', '學生甲')).toEqual([rows[0]]);
});
it('exports uncertain states explicitly and escapes formulas and quotes', () => {
  const rows = assembleAttendanceRegister([{ uid: 'a', displayName: '=1+1', studentId: '"S"' }], [], scope);
  const csv = attendanceRegisterCsv(rows, '2026-10-27T02:00:00Z');
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain('"\'=1+1"');
  expect(csv).toContain('"""S"""');
  expect(csv).toContain('尚無紀錄');
  expect(csv).toContain('本次查核時間');
});
