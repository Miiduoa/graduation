/** @jest-environment node */
import { doc, onSnapshot, type Firestore } from 'firebase/firestore';
import { httpsCallable, type Functions } from 'firebase/functions';
import {
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
const snapshot = (data?: Record<string, unknown>) => ({ exists: () => !!data, data: () => data });
const observer = () => ({
  onTeacher: jest.fn(),
  onToken: jest.fn(),
  onJoined: jest.fn(),
  onError: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
  listeners = [];
  jest
    .mocked(doc)
    .mockImplementation(((_db: unknown, ...parts: string[]) => parts.join('/')) as never);
  jest.mocked(onSnapshot).mockImplementation(((
    path: string,
    next: Listener['next'],
    error: Listener['error'],
  ) => {
    const stop = jest.fn();
    listeners.push({ path, next, error, stop });
    return stop;
  }) as never);
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
  listeners[1].next(snapshot({ qrToken: 'secret' }));
  expect(state.onTeacher).toHaveBeenLastCalledWith(true);
  expect(state.onToken).toHaveBeenLastCalledWith('secret');
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
  secret.next(snapshot({ qrToken: 'before-revocation' }));
  listeners[0].next(snapshot({ role: 'instructor', status: 'removed' }));
  secret.next(snapshot({ qrToken: 'stale-secret' }));
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
  listeners[1].next(snapshot({ qrToken: 'stale' }));
  listeners[2].next(snapshot({ status: 'present' }));
  expect(state.onToken).not.toHaveBeenCalled();
  expect(state.onJoined).not.toHaveBeenCalled();
  expect(onSnapshot).not.toHaveBeenCalled();
});

test('failed membership or secret subscriptions clear permission-sensitive state', () => {
  const state = observer();
  subscribeClassroomAttendance(db, identity, state);
  listeners[0].next(snapshot({ role: 'instructor', status: 'active' }));
  listeners[1].next(snapshot({ qrToken: 'secret' }));
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
