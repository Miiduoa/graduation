/** @jest-environment node */
import { doc, onSnapshot, type Firestore } from 'firebase/firestore';
import { httpsCallable, type Functions } from 'firebase/functions';
import {
  attendanceExpiryMillis,
  joinClassroomAttendance,
  readAttendanceQr,
  subscribeClassroomAttendance,
} from '../../services/liveAttendance';

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));

type Listener = {
  path: string;
  next: (snapshot: unknown) => void;
  error: () => void;
  stop: jest.Mock;
};
let listeners: Listener[];
const db = {} as Firestore;
const functions = {} as Functions;
const identity = { groupId: 'course', sessionId: 'session', userId: 'student' };
const token = 'A'.repeat(43);
const expiresAt = Date.parse('2026-10-23T10:10:00Z');
const snapshot = (data?: Record<string, unknown>, fromCache = false, hasPendingWrites = false) => ({
  exists: () => !!data,
  data: () => data,
  metadata: { fromCache, hasPendingWrites },
});
const secretData = (qrToken = token) => ({ qrToken, qrExpiresAt: { toMillis: () => expiresAt } });
const observer = () => ({
  onTeacher: jest.fn(),
  onToken: jest.fn(),
  onQrExpiresAt: jest.fn(),
  onJoined: jest.fn(),
  onError: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-23T10:00:00Z'));
  listeners = [];
  jest
    .mocked(doc)
    .mockImplementation(((_db: unknown, ...parts: string[]) => parts.join('/')) as never);
  jest.mocked(onSnapshot).mockImplementation(((
    path: string,
    _options: unknown,
    next: Listener['next'],
    error: Listener['error'],
  ) => {
    const stop = jest.fn();
    listeners.push({ path, next, error, stop });
    return stop;
  }) as never);
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('students recover their own attendance without reading a token or any other attendee', () => {
  const state = observer();
  subscribeClassroomAttendance(db, identity, state);
  listeners[0].next(snapshot({ role: 'member', status: 'active' }));
  expect(listeners.map((listener) => listener.path)).toEqual([
    'groups/course/members/student',
    'groups/course/attendanceSessions/session/attendanceRecords/student',
  ]);
  listeners[1].next(snapshot({ status: 'present', checkedInAt: '2026-10-07T10:00:00Z' }));
  expect(state.onJoined).toHaveBeenLastCalledWith(true);
  expect(state.onToken).toHaveBeenLastCalledWith(null);
});

test.each(['instructor', 'owner'])('active %s can read the protected token', (role) => {
  const state = observer();
  subscribeClassroomAttendance(db, identity, state);
  listeners[0].next(snapshot({ role, status: 'active' }));
  expect(listeners[1].path).toBe('groups/course/liveSessionSecrets/session');
  listeners[1].next(snapshot(secretData()));
  expect(state.onTeacher).toHaveBeenLastCalledWith(true);
  expect(state.onToken).toHaveBeenLastCalledWith(token);
});

test.each([
  { role: 'instructor', status: 'removed' },
  { role: 'instructor' },
  { role: 'moderator', status: 'active' },
  { role: 'admin', status: 'active' },
])('does not read a token for membership %j', (membership) => {
  subscribeClassroomAttendance(db, identity, observer());
  listeners[0].next(snapshot(membership));
  expect(listeners.some((listener) => listener.path.includes('liveSessionSecrets'))).toBe(false);
});

test('revocation clears private state and rejects already queued secret and attendance callbacks', () => {
  const state = observer();
  subscribeClassroomAttendance(db, identity, state);
  listeners[0].next(snapshot({ role: 'instructor', status: 'active' }));
  const secret = listeners[1];
  const record = listeners[2];
  secret.next(snapshot(secretData()));
  listeners[0].next(snapshot({ role: 'instructor', status: 'removed' }));
  secret.next(snapshot(secretData('B'.repeat(43))));
  record.next(snapshot({ status: 'present' }));
  expect(secret.stop).toHaveBeenCalledTimes(1);
  expect(record.stop).toHaveBeenCalledTimes(1);
  expect(state.onTeacher).toHaveBeenLastCalledWith(false);
  expect(state.onToken).toHaveBeenLastCalledWith(null);
  expect(state.onJoined).toHaveBeenLastCalledWith(false);
});

test('cleanup ignores callbacks from the prior account or classroom', () => {
  const state = observer();
  const stop = subscribeClassroomAttendance(db, identity, state);
  listeners[0].next(snapshot({ role: 'instructor', status: 'active' }));
  stop();
  jest.clearAllMocks();
  listeners[0].next(snapshot({ role: 'instructor', status: 'active' }));
  listeners[1].next(snapshot(secretData('B'.repeat(43))));
  listeners[2].next(snapshot({ status: 'present' }));
  expect(state.onToken).not.toHaveBeenCalled();
  expect(state.onJoined).not.toHaveBeenCalled();
  expect(onSnapshot).not.toHaveBeenCalled();
});

test('failed membership or secret subscriptions clear permission-sensitive state', () => {
  const state = observer();
  subscribeClassroomAttendance(db, identity, state);
  listeners[0].next(snapshot({ role: 'instructor', status: 'active' }));
  listeners[1].next(snapshot(secretData()));
  listeners[1].error();
  expect(state.onToken).toHaveBeenLastCalledWith(null);
  listeners[0].error();
  expect(state.onTeacher).toHaveBeenLastCalledWith(false);
  expect(state.onJoined).toHaveBeenLastCalledWith(false);
  expect(state.onError).toHaveBeenCalledTimes(2);
});

test('requires attendance proof before making a callable request', async () => {
  await expect(
    joinClassroomAttendance(functions, { groupId: 'course', sessionId: 'session', qrToken: '  ' }),
  ).rejects.toThrow('請先掃描');
  expect(httpsCallable).not.toHaveBeenCalled();
});

test('uses server confirmation and preserves duplicate-check-in evidence', async () => {
  const response = { success: true, alreadyJoined: true, checkedInAt: '2026-10-07T10:00:00Z' };
  const call = jest.fn().mockResolvedValue({ data: response });
  jest.mocked(httpsCallable).mockReturnValue(call);
  expect(
    await joinClassroomAttendance(functions, {
      groupId: 'course',
      sessionId: 'session',
      qrToken: ' proof ',
    }),
  ).toEqual(response);
  expect(call).toHaveBeenCalledWith({ groupId: 'course', sessionId: 'session', qrToken: 'proof' });
  call.mockResolvedValueOnce({ data: { success: false } });
  await expect(
    joinClassroomAttendance(functions, {
      groupId: 'course',
      sessionId: 'session',
      qrToken: 'proof',
    }),
  ).rejects.toThrow('尚未完成');
});

test('accepts only this classroom attendance QR format and rejects other classrooms or websites', () => {
  expect(
    readAttendanceQr(
      'campusone://classroom/join?groupId=course&sessionId=session&token=proof',
      'course',
      'session',
    ),
  ).toBe('proof');
  expect(
    readAttendanceQr(
      JSON.stringify({ groupId: 'course', sessionId: 'session', qrToken: 'web-proof' }),
      'course',
      'session',
    ),
  ).toBe('web-proof');
  for (const qr of [
    'https://example.com/join?groupId=course&sessionId=session&token=proof',
    'campusone://classroom/join?groupId=other&sessionId=session&token=proof',
    'campusone://classroom/join?groupId=course&sessionId=other&token=proof',
    'campusone://classroom/join?groupId=course&sessionId=session',
    JSON.stringify({ groupId: 'course', sessionId: 'wrong-session', qrToken: 'web-proof' }),
    JSON.stringify({ groupId: 'course', sessionId: 'session', qrToken: '' }),
    JSON.stringify({ groupId: 'course', sessionId: 'session', qrToken: 123456 }),
  ])
    expect(() => readAttendanceQr(qr, 'course', 'session')).toThrow();
});

test('cached or pending membership and secret data cannot expose a QR token', () => {
  const state = observer();
  subscribeClassroomAttendance(db, identity, state);
  const membership = { role: 'instructor', status: 'active' };
  listeners[0].next(snapshot(membership, true));
  expect(listeners).toHaveLength(1);
  listeners[0].next(snapshot(membership, false, true));
  expect(listeners).toHaveLength(1);
  listeners[0].next(snapshot(membership));
  listeners[1].next(snapshot(secretData(), true));
  expect(state.onToken).toHaveBeenLastCalledWith(null);
  listeners[1].next(snapshot(secretData(), false, true));
  expect(state.onToken).toHaveBeenLastCalledWith(null);
  listeners[1].next(snapshot(secretData()));
  expect(state.onToken).toHaveBeenLastCalledWith(token);
  listeners[0].next(snapshot(membership, true));
  expect(state.onTeacher).toHaveBeenLastCalledWith(false);
  expect(state.onToken).toHaveBeenLastCalledWith(null);
});

test('the QR disappears at its server expiry without another snapshot', () => {
  const state = observer();
  subscribeClassroomAttendance(db, identity, state);
  listeners[0].next(snapshot({ role: 'instructor', status: 'active' }));
  listeners[1].next(snapshot(secretData()));
  jest.advanceTimersByTime(10 * 60_000 - 1);
  expect(state.onToken).toHaveBeenLastCalledWith(token);
  jest.advanceTimersByTime(1);
  expect(state.onToken).toHaveBeenLastCalledWith(null);
  expect(state.onError).toHaveBeenLastCalledWith(expect.stringContaining('已到期'));
  listeners[1].next(snapshot(secretData()));
  expect(state.onToken).toHaveBeenLastCalledWith(null);
});

test.each([
  { qrToken: '123456', qrExpiresAt: new Date(expiresAt) },
  { qrToken: 'A'.repeat(32), qrExpiresAt: new Date(expiresAt) },
  { qrToken: token },
  { qrToken: token, qrExpiresAt: 'invalid' },
  { qrToken: token, qrExpiresAt: { toMillis: () => NaN } },
  {
    qrToken: token,
    qrExpiresAt: {
      toMillis: () => {
        throw new Error('invalid');
      },
    },
  },
])('invalid QR credentials fail closed: %j', (data) => {
  const state = observer();
  subscribeClassroomAttendance(db, identity, state);
  listeners[0].next(snapshot({ role: 'owner', status: 'active' }));
  listeners[1].next(snapshot(data));
  expect(state.onToken).toHaveBeenLastCalledWith(null);
  expect(state.onError).toHaveBeenCalledTimes(1);
});

test('an ended classroom keeps membership and receipt access without reading its QR secret', () => {
  const state = observer();
  subscribeClassroomAttendance(db, identity, state, false);
  listeners[0].next(snapshot({ role: 'instructor', status: 'active' }));
  expect(state.onTeacher).toHaveBeenLastCalledWith(true);
  expect(listeners.some((listener) => listener.path.includes('liveSessionSecrets'))).toBe(false);
});

test('cached or locally pending attendance does not become server-confirmed attendance', () => {
  const state = observer();
  subscribeClassroomAttendance(db, identity, state);
  listeners[0].next(snapshot({ role: 'member', status: 'active' }));
  listeners[1].next(snapshot({ status: 'present' }, true));
  expect(state.onJoined).toHaveBeenLastCalledWith(false);
  listeners[1].next(snapshot({ status: 'present' }, false, true));
  expect(state.onJoined).toHaveBeenLastCalledWith(false);
  listeners[1].next(snapshot({ status: 'present' }));
  expect(state.onJoined).toHaveBeenLastCalledWith(true);
});

test('the expiry reader accepts the existing Firestore and ISO contracts', () => {
  expect(attendanceExpiryMillis({ toMillis: () => expiresAt })).toBe(expiresAt);
  expect(attendanceExpiryMillis({ toDate: () => new Date(expiresAt) })).toBe(expiresAt);
  expect(attendanceExpiryMillis(new Date(expiresAt).toISOString())).toBe(expiresAt);
  expect(attendanceExpiryMillis(new Date(expiresAt))).toBe(expiresAt);
  expect(attendanceExpiryMillis(undefined)).toBeNull();
});
