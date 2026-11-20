/** @jest-environment node */
import { createTeacherLiveSessionStarter } from '../../services/teacherLiveSessionStarter';

const token = 'A'.repeat(43);
const future = '2099-01-01T00:00:00.000Z';
const instructor = {
  uid: 'teacher-a',
  schoolId: 'school-a',
  groupId: 'course-1',
  role: 'instructor',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function liveSession(sessionId = 'live-1') {
  return {
    success: true,
    active: true,
    sessionId,
    qrToken: token,
    qrExpiresAt: future,
  };
}

function starter(overrides: {
  send?: jest.Mock;
  newRequestId?: () => string;
  current?: { uid: string | null; schoolId: string | null };
  now?: () => number;
} = {}) {
  const send = overrides.send ?? jest.fn().mockResolvedValue(liveSession());
  const current = overrides.current ?? { uid: instructor.uid, schoolId: instructor.schoolId };
  return {
    send,
    current,
    ...createTeacherLiveSessionStarter({
      send,
      newRequestId: overrides.newRequestId ?? (() => 'req-1'),
      currentScope: () => current,
      now: overrides.now ?? (() => Date.parse('2026-10-16T00:00:00.000Z')),
    }),
  };
}

test('starts with a 10-minute QR window matching the web classroom', async () => {
  const { send, start } = starter();
  await expect(start(instructor)).resolves.toEqual({
    status: 'started',
    sessionId: 'live-1',
    groupId: 'course-1',
  });
  expect(send).toHaveBeenCalledWith({
    groupId: 'course-1',
    requestId: 'req-1',
    qrExpiryMinutes: 10,
  });
});

test.each(['member', 'teacher', 'moderator', 'ta', null, undefined])(
  'denies a %j membership before calling the server',
  async (role) => {
    const { send, start } = starter();
    await expect(start({ ...instructor, role })).resolves.toEqual({ status: 'denied' });
    expect(send).not.toHaveBeenCalled();
  },
);

test('reuses one request id until the server confirms the session', async () => {
  const { send, start } = starter({
    send: jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(liveSession()),
  });
  await expect(start(instructor)).resolves.toEqual({ status: 'unconfirmed' });
  await expect(start(instructor)).resolves.toEqual({
    status: 'started',
    sessionId: 'live-1',
    groupId: 'course-1',
  });
  expect(send.mock.calls).toEqual([
    [{ groupId: 'course-1', requestId: 'req-1', qrExpiryMinutes: 10 }],
    [{ groupId: 'course-1', requestId: 'req-1', qrExpiryMinutes: 10 }],
  ]);
});

test('does not start a second request while the first is still open', async () => {
  const pending = deferred<ReturnType<typeof liveSession>>();
  const { send, start } = starter({ send: jest.fn().mockReturnValue(pending.promise) });
  const first = start(instructor);
  await expect(start(instructor)).resolves.toEqual({ status: 'busy' });
  pending.resolve(liveSession());
  await expect(first).resolves.toEqual({
    status: 'started',
    sessionId: 'live-1',
    groupId: 'course-1',
  });
  expect(send).toHaveBeenCalledTimes(1);
});

test('drops a late success after the teacher account has already changed', async () => {
  const pending = deferred<ReturnType<typeof liveSession>>();
  const current = { uid: instructor.uid, schoolId: instructor.schoolId };
  const { start } = starter({
    send: jest.fn().mockReturnValue(pending.promise),
    current,
  });
  const first = start(instructor);
  current.uid = 'teacher-b';
  pending.resolve(liveSession('old-live'));
  await expect(first).resolves.toEqual({ status: 'stale' });
});

test('rejects a success payload that is missing a usable QR token', async () => {
  const { start } = starter({
    send: jest.fn().mockResolvedValue({
      success: true,
      active: true,
      sessionId: 'live-1',
      qrToken: 'short',
      qrExpiresAt: future,
    }),
  });
  await expect(start(instructor)).resolves.toEqual({ status: 'unconfirmed' });
});

test('treats an inactive reused session as closed', async () => {
  const { start } = starter({
    send: jest.fn().mockResolvedValue({ ...liveSession(), active: false }),
  });
  await expect(start(instructor)).resolves.toEqual({ status: 'closed' });
});
