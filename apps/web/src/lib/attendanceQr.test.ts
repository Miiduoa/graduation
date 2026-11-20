import { expect, it } from 'vitest';
import { attendanceCameraError, parseAttendanceQr } from './attendanceQr';

const scope = { groupId: 'course-a', sessionId: 'session-a' };
const valid = { ...scope, qrToken: 'server-issued-secret' };
it('extracts a token only for the exact course and session', () => {
  expect(parseAttendanceQr(JSON.stringify(valid), scope)).toEqual({ ok: true, token: valid.qrToken });
});
it.each([
  '', 'not-json', 'https://example.test/scan', 'null', '[]', '42', '"token"',
  JSON.stringify({ ...valid, qrToken: ['secret'] }),
  JSON.stringify({ ...valid, qrToken: '' }),
  JSON.stringify({ ...valid, qrToken: 'a'.repeat(513) }),
  JSON.stringify({ ...valid, qrToken: 'a\u0000b' }),
  JSON.stringify({ ...valid, qrToken: 'token\n' }),
  JSON.stringify({ ...valid, groupId: ['course-a'] }),
  JSON.stringify({ ...valid, sessionId: {} }),
  JSON.stringify({ ...valid, groupId: '../course-a' }),
  'x'.repeat(2049),
])('rejects malformed and unrelated QR input without exposing its content: %#', (raw) => {
  const result = parseAttendanceQr(raw, scope);
  expect(result.ok).toBe(false);
  expect('token' in result).toBe(false);
  if (!result.ok) expect(result.message).not.toContain(valid.qrToken);
});
it('distinguishes another class from a replaced or old attendance session', () => {
  expect(parseAttendanceQr(JSON.stringify({ ...valid, groupId: 'other' }), scope))
    .toMatchObject({ ok: false, message: expect.stringContaining('另一堂課') });
  expect(parseAttendanceQr(JSON.stringify({ ...valid, sessionId: 'old' }), scope))
    .toMatchObject({ ok: false, message: expect.stringContaining('不是本次點名') });
});
it.each(['NotAllowedError', 'SecurityError', 'NotFoundError', 'NotReadableError', 'Unknown'])
('provides a manual fallback without displaying internal errors: %s', (name) => {
  const message = attendanceCameraError({ name, message: 'private camera device ID' });
  expect(message).toContain('簽到碼');
  expect(message).not.toContain('private');
});
