import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { limit, onSnapshot } from 'firebase/firestore';
import { watchAttendanceLive, type AttendanceLiveOptions } from './watchAttendanceLive';

type Watcher = {
  path: string;
  next: (value: unknown) => void;
  error: () => void;
  stop: ReturnType<typeof vi.fn>;
};
const auth = vi.hoisted(() => ({ uid: 'student', configured: true }));
vi.mock('./firebase', () => ({ getDb: () => ({}),
  isFirebaseConfigured: () => auth.configured,
  getAuth: () => ({ currentUser: { uid: auth.uid } }),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  query: (path: string) => path,
  where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), onSnapshot: vi.fn(),
}));
let watchers: Watcher[];
let dispose: () => void;
let visible = true;
let online = true;
const metadata = { fromCache: false, hasPendingWrites: false };
function sessions(patch: Record<string, unknown> = {}, meta = metadata) {
  return { metadata: meta, docs: [{ id: 'session', data: () => ({
    groupId: 'course', sessionId: 'session', schemaVersion: 2, teacherId: 'teacher', active: true,
    startedAt: '2026-10-27T01:00:00Z', qrExpiresAt: '2026-10-27T01:10:00Z', attendeeCount: 0, ...patch,
  }) }] };
}
function receipt(patch: Record<string, unknown> = {}, meta = metadata) {
  return { metadata: meta, id: 'student', exists: () => true, data: () => ({
    uid: 'student', groupId: 'course', sessionId: 'session', status: 'present', source: 'qr',
    checkedInAt: '2026-10-27T01:02:00Z', ...patch,
  }) };
}
function begin(teacher = false) {
  const options: AttendanceLiveOptions = {
    courseId: 'course', uid: 'student', canReadRoster: teacher,
    onSessions: vi.fn(), onState: vi.fn(),
  };
  dispose = watchAttendanceLive(options);
  return options;
}
beforeEach(() => {
  vi.clearAllMocks(); auth.uid = 'student'; auth.configured = true;
  watchers = []; visible = true; online = true; dispose = () => {};
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden');
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  vi.mocked(onSnapshot).mockImplementation(((path: string, _options: unknown, next: Watcher['next'], error: Watcher['error']) => {
    const stop = vi.fn(); watchers.push({ path, next, error, stop }); return stop;
  }) as never);
});
afterEach(() => { dispose(); vi.restoreAllMocks(); });

it('bounds recent sessions and listens only to this signed-in student, never classmates', () => {
  const callbacks = begin(); watchers[0].next(sessions());
  expect(limit).toHaveBeenCalledWith(50);
  expect(watchers.map((item) => item.path)).toEqual([
    'groups/course/attendanceSessions', 'groups/course/attendanceSessions/session/attendanceRecords/student',
  ]);
  watchers[1].next(receipt());
  expect(callbacks.onSessions).toHaveBeenLastCalledWith([expect.objectContaining({
    id: 'session', ownStatus: 'present', ownRecord: expect.objectContaining({ uid: 'student', source: 'qr' }),
  })]);
  expect(callbacks.onState).toHaveBeenLastCalledWith('live');
});
it('does not read student receipts on the teacher view', () => {
  const callbacks = begin(true); watchers[0].next(sessions({ attendeeCount: 23 }));
  expect(watchers).toHaveLength(1);
  expect(callbacks.onSessions).toHaveBeenLastCalledWith([expect.objectContaining({ attendeeCount: 23 })]);
});
it.each([{ fromCache: true, hasPendingWrites: false }, { fromCache: false, hasPendingWrites: true }])(
  'never accepts unconfirmed class snapshot metadata %j', (meta) => {
    const callbacks = begin(); watchers[0].next(sessions({}, meta));
    expect(callbacks.onSessions).not.toHaveBeenCalled();
    expect(watchers).toHaveLength(1);
    expect(callbacks.onState).toHaveBeenLastCalledWith('connecting');
  },
);
it('never accepts a local personal write before the server', () => {
  const callbacks = begin(); watchers[0].next(sessions());
  watchers[1].next(receipt({}, { fromCache: false, hasPendingWrites: true }));
  expect(callbacks.onSessions).not.toHaveBeenCalled();
});
it('treats a missing server receipt as unknown, not absence', () => {
  const callbacks = begin(); watchers[0].next(sessions());
  watchers[1].next({ metadata, id: 'student', exists: () => false });
  expect(callbacks.onSessions).toHaveBeenLastCalledWith([expect.objectContaining({ ownRecord: null, ownStatus: null })]);
});
it('receives a teacher-confirmed leave without requiring a check-in timestamp', () => {
  const callbacks = begin(); watchers[0].next(sessions());
  watchers[1].next(receipt({ status: 'excused', source: 'manual', checkedInAt: null, correctedAt: '2026-10-27T02:00:00Z' }));
  expect(callbacks.onSessions).toHaveBeenLastCalledWith([expect.objectContaining({ ownRecord: null, ownStatus: 'excused' })]);
});
it.each([{ groupId: 'other' }, { sessionId: 'other' }, { schemaVersion: 1 }, { attendeeCount: '1' },
  { attendeeCount: -1 }, { attendeeCount: null }, { active: 'true' }, { startedAt: 'bad' }, { qrExpiresAt: null }])(
  'fails closed on a malformed or cross-course session %j', (patch) => {
    const callbacks = begin(); watchers[0].next(sessions(patch));
    expect(callbacks.onState).toHaveBeenLastCalledWith('error');
    expect(callbacks.onSessions).not.toHaveBeenCalled();
    expect(watchers[0].stop).toHaveBeenCalledTimes(1);
  },
);
it.each([{ uid: 'classmate' }, { groupId: 'other' }, { status: ['present'] }, { checkedInAt: null }])(
  'does not emit an invalid personal receipt %j', (patch) => {
    const callbacks = begin(); watchers[0].next(sessions()); watchers[1].next(receipt(patch));
    expect(callbacks.onState).toHaveBeenLastCalledWith('error');
    expect(callbacks.onSessions).not.toHaveBeenCalled();
    expect(watchers.every((item) => item.stop.mock.calls.length === 1)).toBe(true);
  },
);
it('stops background reads, ignores late responses, and reconnects when visible', () => {
  const callbacks = begin(); watchers[0].next(sessions()); const old = watchers[1];
  visible = false; document.dispatchEvent(new Event('visibilitychange'));
  expect(callbacks.onState).toHaveBeenLastCalledWith('paused');
  old.next(receipt()); expect(callbacks.onSessions).not.toHaveBeenCalled();
  expect(watchers.every((item) => item.stop.mock.calls.length === 1)).toBe(true);
  visible = true; document.dispatchEvent(new Event('visibilitychange'));
  expect(watchers).toHaveLength(3);
  watchers[2].next({ metadata, docs: [] });
  expect(callbacks.onSessions).toHaveBeenLastCalledWith([]);
});
it('does not treat browser online as proof of a server-confirmed snapshot', () => {
  const callbacks = begin(true); watchers[0].next(sessions());
  online = false; window.dispatchEvent(new Event('offline'));
  expect(callbacks.onState).toHaveBeenLastCalledWith('offline');
  online = true; window.dispatchEvent(new Event('online'));
  expect(callbacks.onState).toHaveBeenLastCalledWith('connecting');
  expect(callbacks.onSessions).toHaveBeenCalledTimes(1);
});
it('checks the account again after returning from background', () => {
  const callbacks = begin(); visible = false; document.dispatchEvent(new Event('visibilitychange'));
  auth.uid = 'other-account'; visible = true; document.dispatchEvent(new Event('visibilitychange'));
  expect(callbacks.onState).toHaveBeenLastCalledWith('error');
  expect(watchers).toHaveLength(1);
});
it('handles pagehide and restored pages without leaking hidden subscriptions', () => {
  const callbacks = begin(); window.dispatchEvent(new Event('pagehide'));
  expect(callbacks.onState).toHaveBeenLastCalledWith('paused');
  window.dispatchEvent(new Event('pageshow'));
  expect(watchers).toHaveLength(2);
  dispose(); window.dispatchEvent(new Event('pageshow'));
  expect(watchers).toHaveLength(2);
  expect(watchers.every((item) => item.stop.mock.calls.length === 1)).toBe(true);
});
it('does not attach any listeners before a visible online session is available', () => {
  visible = false; const callbacks = begin();
  expect(callbacks.onState).toHaveBeenLastCalledWith('paused'); expect(onSnapshot).not.toHaveBeenCalled();
});
