const { evaluateLiveSessionJoin } = require('./liveSessionJoinPolicy');

const allowed = {
  memberExists: true,
  memberStatus: 'active',
  sessionActive: true,
  expectedQrToken: 'server-generated-token',
  qrExpiresAtMs: 120_000,
  nowMs: 60_000,
};

describe('live session join and attendance boundary', () => {
  test('a current member may join without being marked present', () => {
    expect(evaluateLiveSessionJoin(allowed)).toEqual({ ok: true, recordAttendance: false });
  });

  test('a valid server-issued QR token authorizes an attendance record', () => {
    expect(
      evaluateLiveSessionJoin({ ...allowed, providedQrToken: 'server-generated-token' }),
    ).toEqual({ ok: true, recordAttendance: true });
  });

  test.each([
    { memberExists: false },
    { memberStatus: 'inactive' },
    { memberStatus: 'pending' },
    { memberStatus: 'revoked' },
  ])('rejects non-members or inactive memberships (%p)', (overrides) => {
    expect(evaluateLiveSessionJoin({ ...allowed, ...overrides }).ok).toBe(false);
  });

  test('allows legacy group members without an explicit status', () => {
    expect(evaluateLiveSessionJoin({ ...allowed, memberStatus: undefined }).ok).toBe(true);
  });

  test('rejects closed sessions', () => {
    expect(evaluateLiveSessionJoin({ ...allowed, sessionActive: false }).code).toBe('not-found');
  });

  test.each(['wrong', 42])('rejects incorrect QR tokens (%p)', (providedQrToken) => {
    expect(evaluateLiveSessionJoin({ ...allowed, providedQrToken }).code).toBe('permission-denied');
  });

  test('rejects expired or missing expiry metadata', () => {
    expect(
      evaluateLiveSessionJoin({
        ...allowed,
        providedQrToken: 'server-generated-token',
        qrExpiresAtMs: 60_000,
      }).code,
    ).toBe('deadline-exceeded');
    expect(
      evaluateLiveSessionJoin({
        ...allowed,
        providedQrToken: 'server-generated-token',
        qrExpiresAtMs: undefined,
      }).ok,
    ).toBe(false);
  });

  test('unknown QR token cannot be recorded as valid attendance', () => {
    expect(
      evaluateLiveSessionJoin({
        ...allowed,
        expectedQrToken: undefined,
        providedQrToken: 'server-generated-token',
      }).ok,
    ).toBe(false);
  });
});
