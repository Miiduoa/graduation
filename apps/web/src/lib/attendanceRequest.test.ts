import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ATTENDANCE_REQUEST_TIMEOUT_MS,
  ATTENDANCE_RESULT_UNKNOWN,
  isAttendanceResultUncertain,
  requestAttendance,
} from './attendanceRequest';
import { FunctionsUnconfiguredError } from './functionsUrl';

const fetchMock = vi.fn();
const command = { groupId: 'class-a', sessionId: 'session-a', studentUid: 'student',
  status: 'late', reason: '授課教師已核對遲到時間', requestId: 'original-attempt', expectedRevision: 3 };
let user: { uid: string; getIdToken: () => Promise<string> } | null;
const options = { getUser: () => user, resolveUrl: (name: string) => `/api/fn/${name}` };
const response = (payload: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status,
  json: async () => payload });
const success = { result: { success: true, status: 'late', reused: false } };
const request = () => requestAttendance('correctAttendanceRecord', command, options);

beforeEach(() => {
  user = { uid: 'teacher', getIdToken: async () => 'token' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('keeps the callable wire format and clears its timer after success', async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValue(response(success));
  await expect(request()).resolves.toEqual(success.result);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('/api/fn/correctAttendanceRecord', expect.objectContaining({
    body: JSON.stringify({ data: command }), cache: 'no-store', signal: expect.any(AbortSignal),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
  }));
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['token', 'headers', 'body'])('bounds a stalled %s and ignores late completion', async (stage) => {
  vi.useFakeTimers();
  let resolveToken!: (value: string) => void;
  let resolveResponse!: (value: ReturnType<typeof response>) => void;
  let resolveBody!: (value: unknown) => void;
  if (stage === 'token') user!.getIdToken = () => new Promise((resolve) => { resolveToken = resolve; });
  if (stage === 'headers') fetchMock.mockImplementation(() => new Promise((resolve) => { resolveResponse = resolve; }));
  if (stage === 'body') fetchMock.mockResolvedValue({ ok: true, status: 200,
    json: () => new Promise((resolve) => { resolveBody = resolve; }) });
  const failed = request().catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(ATTENDANCE_REQUEST_TIMEOUT_MS);
  expect(await failed).toMatchObject({ code: ATTENDANCE_RESULT_UNKNOWN });
  expect(vi.getTimerCount()).toBe(0);
  if (stage === 'token') {
    resolveToken('late-token');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();
  } else {
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    if (stage === 'headers') resolveResponse(response(success));
    else resolveBody(success);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }
});

it('never sends after the account changes during token refresh', async () => {
  user!.getIdToken = async () => { user = { uid: 'other', getIdToken: async () => 'other-token' }; return 'old-token'; };
  await expect(request()).rejects.toMatchObject({ code: 'functions/unauthenticated' });
  expect(fetchMock).not.toHaveBeenCalled();
});
it('refuses a retry under a different actor before obtaining a token', async () => {
  const getIdToken = vi.fn(async () => 'other-token');
  user = { uid: 'other', getIdToken };
  await expect(requestAttendance('correctAttendanceRecord', command, { ...options, expectedUid: 'teacher' }))
    .rejects.toMatchObject({ code: 'functions/unauthenticated' });
  expect(getIdToken).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});
it('does not deliver a previous account success into a new account', async () => {
  fetchMock.mockImplementation(async () => {
    user = { uid: 'other', getIdToken: async () => 'other-token' };
    return response(success);
  });
  await expect(request()).rejects.toMatchObject({ code: ATTENDANCE_RESULT_UNKNOWN });
});

it.each([null, [], { result: { success: true } }, { result: { success: false } },
  { result: { success: true, status: 'absent', reused: false } },
  { result: { success: true, status: 'late', reused: 'false' } }])(
  'does not treat a malformed or unrelated receipt as confirmation: %j', async (payload) => {
    fetchMock.mockResolvedValue(response(payload));
    await expect(request()).rejects.toMatchObject({ code: ATTENDANCE_RESULT_UNKNOWN });
  },
);
it('keeps broken JSON and network failures ambiguous without automatic retry', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('HTML'); } })
    .mockRejectedValueOnce(new TypeError('network'));
  await expect(request()).rejects.toMatchObject({ code: ATTENDANCE_RESULT_UNKNOWN });
  await expect(request()).rejects.toMatchObject({ code: ATTENDANCE_RESULT_UNKNOWN });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it.each([500, 502, 503, 504])('does not label a generic HTTP %s as unconfigured', async (status) => {
  fetchMock.mockResolvedValue(response({ error: { status: 'UNAVAILABLE', message: 'temporary outage' } }, status));
  await expect(request()).rejects.toMatchObject({ code: ATTENDANCE_RESULT_UNKNOWN });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('preserves explicit not-enabled errors and definite revision conflicts', async () => {
  fetchMock.mockResolvedValueOnce(response({ error: { status: 'UNAVAILABLE', message: '尚未啟用' } }, 503))
    .mockResolvedValueOnce(response({ error: { status: 'ABORTED', message: 'newer revision' } }, 409));
  await expect(request()).rejects.toBeInstanceOf(FunctionsUnconfiguredError);
  await expect(request()).rejects.toMatchObject({ code: 'functions/aborted' });
});
it('distinguishes a join token expiry from an ambiguous correction deadline', async () => {
  fetchMock.mockResolvedValue(response({ error: { status: 'DEADLINE_EXCEEDED', message: 'QR code has expired' } }, 504));
  await expect(requestAttendance('joinLiveSession', command, options)).rejects.toMatchObject({ code: 'functions/deadline-exceeded' });
  await expect(request()).rejects.toMatchObject({ code: ATTENDANCE_RESULT_UNKNOWN });
});
it('accepts supported callable data envelopes and validates start and join receipts', async () => {
  fetchMock.mockResolvedValueOnce(response({ data: success.result }))
    .mockResolvedValueOnce(response({ result: { success: true, alreadyJoined: true, checkedInAt: '2026-10-28T01:00:00Z' } }))
    .mockResolvedValueOnce(response({ result: { success: true, active: true, sessionId: 'session-a', qrToken: 'private', qrExpiresAt: '2026-10-28T01:10:00Z' } }))
    .mockResolvedValueOnce(response({ result: { success: true, alreadyJoined: true, checkedInAt: 'invalid' } }))
    .mockResolvedValueOnce(response({ result: { success: true, active: true, sessionId: '../bad', qrToken: 'private', qrExpiresAt: '2026-10-28T01:10:00Z' } }));
  await expect(request()).resolves.toEqual(success.result);
  await expect(requestAttendance('joinLiveSession', command, options)).resolves.toMatchObject({ alreadyJoined: true });
  await expect(requestAttendance('startLiveSession', command, options)).resolves.toMatchObject({ sessionId: 'session-a' });
  await expect(requestAttendance('joinLiveSession', command, options)).rejects.toMatchObject({ code: ATTENDANCE_RESULT_UNKNOWN });
  await expect(requestAttendance('startLiveSession', command, options)).rejects.toMatchObject({ code: ATTENDANCE_RESULT_UNKNOWN });
});
it('requires reconciliation for unknown errors rather than assuming rollback', () => {
  for (const error of [new Error('offline'), { code: ATTENDANCE_RESULT_UNKNOWN }, { code: 'functions/internal' }])
    expect(isAttendanceResultUncertain(error)).toBe(true);
  for (const code of ['aborted', 'permission-denied', 'unauthenticated', 'invalid-argument'])
    expect(isAttendanceResultUncertain({ code: `functions/${code}` })).toBe(false);
});
