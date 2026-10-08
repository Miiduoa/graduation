import {
  isAttendanceMethodSupported,
  parseAttendanceConfirmation,
} from '../services/attendanceConfirmation';

describe('attendance server confirmation', () => {
  it.each(['present', 'late'] as const)('accepts explicit server-verified %s', (status) => {
    expect(parseAttendanceConfirmation({ valid: true, status })).toEqual({ status });
  });

  it.each([
    undefined,
    null,
    false,
    true,
    [],
    {},
    { valid: true },
    { valid: false, status: 'present' },
    { success: true, status: 'present' },
    { valid: true, status: 'absent' },
    { valid: true, status: 'suspicious' },
    { valid: 'true', status: 'present' },
    { valid: true, status: 1 },
  ])('does not treat an unconfirmed response as attendance (%p)', (payload) => {
    expect(parseAttendanceConfirmation(payload)).toBeNull();
  });
});

describe('attendance methods offered by the mobile screen', () => {
  it.each(['rotating_qr', 'number_code', 'geofence'])('supports %s', (method) => {
    expect(isAttendanceMethodSupported(method)).toBe(true);
  });

  it('never represents a camera photo as verified liveness', () => {
    expect(isAttendanceMethodSupported('selfie_liveness')).toBe(false);
  });

  it('only permits the QR + location multi-factor flow shown by the UI', () => {
    expect(isAttendanceMethodSupported('multi_factor', ['rotating_qr', 'geofence'])).toBe(true);
    expect(isAttendanceMethodSupported('multi_factor', ['rotating_qr'])).toBe(false);
    expect(isAttendanceMethodSupported('multi_factor', ['rotating_qr', 'selfie_liveness'])).toBe(false);
    expect(isAttendanceMethodSupported('multi_factor', ['rotating_qr', 'geofence', 'number_code'])).toBe(false);
    expect(isAttendanceMethodSupported('multi_factor')).toBe(false);
  });

  it('rejects unknown attendance methods', () => {
    expect(isAttendanceMethodSupported('magic_scan')).toBe(false);
  });
});
