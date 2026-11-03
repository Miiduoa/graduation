import { describe, expect, it } from 'vitest';
import { attendanceCountdown, attendanceProjectionCount, canPresentAttendanceQr } from './attendanceProjection';

const image = 'data:image/png;base64,QUJDRA==';
const now = Date.parse('2026-10-28T01:00:00Z');
const expiry = '2026-10-28T01:10:00Z';

describe('classroom QR projection boundaries', () => {
  it('accepts only an unexpired inline PNG generated for the current session', () => {
    expect(canPresentAttendanceQr(image, expiry, now)).toBe(true);
  });
  it.each([null, '', 'invalid', '2026-10-28T01:00:00Z', '2026-10-28T00:59:59Z'])(
    'rejects missing, invalid or expired deadlines: %s', (value) => {
      expect(canPresentAttendanceQr(image, value, now)).toBe(false);
    },
  );
  it.each(['', 'https://example.com/qr.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,<script>', 'data:image/png;base64,'])('rejects external or malformed images: %s', (value) => {
    expect(canPresentAttendanceQr(value, expiry, now)).toBe(false);
  });
  it('rejects invalid clocks and excessive inline image data', () => {
    expect(canPresentAttendanceQr(image, expiry, NaN)).toBe(false);
    expect(canPresentAttendanceQr(`data:image/png;base64,${'A'.repeat(2_000_001)}`, expiry, now)).toBe(false);
  });
  it.each([[600, '10:00'], [59, '0:59'], [0, '0:00'], [1.1, '0:02'], [null, '—'], [NaN, '—'], [-1, '—']])('formats remaining time without false precision: %s', (value, formatted) => {
    expect(attendanceCountdown(value as number | null)).toBe(formatted);
  });
  it.each([[0, '0'], [42, '42'], [-1, '—'], [Infinity, '—'], [1.2, '—']])('does not invent a count: %s', (value, formatted) => {
    expect(attendanceProjectionCount(value as number)).toBe(formatted);
  });
});
