import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { onAuthStateChanged } from 'firebase/auth';
import { onSnapshot } from 'firebase/firestore';
import { watchAttendanceRegister, type LiveAttendanceRegister } from './watchAttendanceRegister';

const identity = vi.hoisted(() => ({ auth: { currentUser: { uid: 'teacher' } as { uid: string } | null } }));
vi.mock('./firebase', () => ({
  getDb: () => ({}), getAuth: () => identity.auth, isFirebaseConfigured: () => true,
}));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  query: (ref: { path: string }, ...constraints: unknown[]) => ({ ...ref, constraints }),
  where: (...parts: unknown[]) => parts, limit: (value: number) => value, onSnapshot: vi.fn(),
}));
type Metadata = { fromCache: boolean; hasPendingWrites: boolean };
type Row = { id: string; data: () => Record<string, unknown> };
type Snapshot = { id?: string; metadata: Metadata; exists?: () => boolean; data?: () => Record<string, unknown>; docs?: Row[] };
type Listener = { ref: { path: string; constraints?: unknown[] }; next: (value: Snapshot) => void; error: () => void; stop: ReturnType<typeof vi.fn> };
let listeners: Listener[];
let cleanups: (() => void)[];
let authChange: (user: { uid: string } | null) => void;
const server: Metadata = { fromCache: false, hasPendingWrites: false };
const row = (id: string, data: Record<string, unknown>): Row => ({ id, data: () => data });
const snapDoc = (data: Record<string, unknown> | null, metadata = server): Snapshot => ({
  metadata, exists: () => data !== null, data: () => data ?? {},
});
const collection = (docs: Row[], metadata = server): Snapshot => ({ docs, metadata });
const student = (id: string) => row(id, { status: 'active', role: 'student', displayName: `學生${id}`, studentId: `S${id}` });
const receipt = (id = '1', patch: Record<string, unknown> = {}) => row(id, {
  uid: id, groupId: 'course', sessionId: 'session', status: 'present', source: 'qr',
  checkedInAt: '2026-10-28T01:00:00Z', ...patch,
});
const path = 'groups/course/attendanceSessions/session';
function find(suffix: string) {
  const matches = listeners.filter((entry) => entry.ref.path === suffix && entry.stop.mock.calls.length === 0);
  if (!matches.length) throw new Error(`No active listener at ${suffix}`);
  return matches[matches.length - 1];
}
function start() {
  const options = { courseId: 'course', sessionId: 'session', onData: vi.fn(), onState: vi.fn() };
  const stop = watchAttendanceRegister(options);
  cleanups.push(stop);
  return { ...options, stop };
}
function permit() {
  find('groups/course/members/teacher').next(snapDoc({ status: 'active', role: 'instructor' }));
}
function seed() {
  permit();
  find(path).next(snapDoc({ schemaVersion: 2, groupId: 'course', sessionId: 'session', active: true }));
  find('groups/course/members').next(collection([student('1'), student('2')]));
  find(`${path}/attendanceRecords`).next(collection([]));
}
beforeEach(() => {
  vi.clearAllMocks();
  listeners = []; cleanups = [];
  identity.auth.currentUser = { uid: 'teacher' };
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.mocked(onSnapshot).mockImplementation(((ref: Listener['ref'], _options: unknown,
    next: Listener['next'], error: Listener['error']) => {
    const entry = { ref, next, error, stop: vi.fn() };
    listeners.push(entry); return entry.stop;
  }) as never);
  vi.mocked(onAuthStateChanged).mockImplementation(((_auth: unknown, callback: typeof authChange) => {
    authChange = callback; return vi.fn();
  }) as never);
});
afterEach(() => { cleanups.forEach((stop) => stop()); vi.restoreAllMocks(); });

it('subscribes to no class records before confirmed instructor permission', () => {
  const app = start();
  expect(listeners.map((entry) => entry.ref.path)).toEqual(['groups/course/members/teacher']);
  find('groups/course/members/teacher').next(snapDoc({ status: 'active', role: 'instructor' }, { ...server, fromCache: true }));
  expect(listeners).toHaveLength(1);
  expect(app.onData).not.toHaveBeenCalled();
  permit();
  expect(listeners).toHaveLength(4);
  expect(find('groups/course/members').ref.constraints).toEqual([['status', '==', 'active'], 501]);
  expect(find(`${path}/attendanceRecords`).ref.constraints).toEqual([501]);
});
it('updates a row and teacher correction without recreating subscriptions or reading individual students', () => {
  const app = start(); seed();
  expect(app.onData.mock.lastCall?.[0].rows.map((item: { status: string }) => item.status)).toEqual(['unconfirmed', 'unconfirmed']);
  find(`${path}/attendanceRecords`).next(collection([receipt()]));
  expect(app.onData.mock.lastCall?.[0].rows[0].status).toBe('present');
  find(`${path}/attendanceRecords`).next(collection([receipt('1', {
    status: 'excused', source: 'manual', checkedInAt: null, correctedAt: '2026-10-28T02:00:00Z',
  })]));
  expect(app.onData.mock.lastCall?.[0].rows[0].status).toBe('excused');
  expect(listeners).toHaveLength(4);
  expect(app.onState).toHaveBeenLastCalledWith('live');
});
it('waits for all three server snapshots and rejects pending local writes', () => {
  const app = start(); permit();
  find(path).next(snapDoc({ schemaVersion: 2, groupId: 'course', sessionId: 'session', active: true }));
  find('groups/course/members').next(collection([student('1')]));
  expect(app.onData).not.toHaveBeenCalled();
  find(`${path}/attendanceRecords`).next(collection([receipt()], { ...server, hasPendingWrites: true }));
  expect(app.onData).not.toHaveBeenCalled();
  find(`${path}/attendanceRecords`).next(collection([receipt()]));
  expect(app.onData).toHaveBeenCalledTimes(1);
  find('groups/course/members').next(collection([student('1')], { ...server, fromCache: true }));
  expect(app.onState).toHaveBeenLastCalledWith('connecting');
});
it.each(['member', 'moderator', 'admin', null])('does not grant the teacher register to role %s', (role) => {
  const app = start();
  find('groups/course/members/teacher').next(snapDoc({ status: 'active', role }));
  expect(listeners).toHaveLength(1);
  expect(app.onData).not.toHaveBeenCalled();
  expect(app.onState).toHaveBeenLastCalledWith('error');
});
it('revoking membership stops every data listener and ignores already queued callbacks', () => {
  const app = start(); seed();
  const old = find(`${path}/attendanceRecords`);
  const calls = app.onData.mock.calls.length;
  find('groups/course/members/teacher').next(snapDoc({ status: 'removed', role: 'instructor' }));
  expect(listeners.every((entry) => entry.stop.mock.calls.length === 1)).toBe(true);
  old.next(collection([receipt()]));
  expect(app.onData).toHaveBeenCalledTimes(calls);
  expect(app.onState).toHaveBeenLastCalledWith('error');
});
it('rechecks every source after a role change, without reusing earlier receipts', () => {
  const app = start(); seed();
  const old = find(`${path}/attendanceRecords`);
  find('groups/course/members/teacher').next(snapDoc({ status: 'active', role: 'owner' }));
  expect(old.stop).toHaveBeenCalledTimes(1);
  expect(app.onState).toHaveBeenLastCalledWith('connecting');
  const calls = app.onData.mock.calls.length;
  old.next(collection([receipt()]));
  expect(app.onData).toHaveBeenCalledTimes(calls);
  expect(listeners).toHaveLength(7);
});
it('marks missing receipts unverified after truncation and never permits a complete export', () => {
  const app = start(); seed();
  find(`${path}/attendanceRecords`).next(collection(Array.from({ length: 501 }, (_, index) => receipt(`old-${index}`))));
  const latest = app.onData.mock.lastCall?.[0] as LiveAttendanceRegister;
  expect(latest.complete).toBe(false);
  expect(latest.receiptsComplete).toBe(false);
  expect(latest.rows.every((item) => item.status === 'unavailable')).toBe(true);
});
it('marks a truncated enrollment query as partial rather than claiming the full class count', () => {
  const app = start(); seed();
  find('groups/course/members').next(collection(Array.from({ length: 501 }, (_, index) => student(String(index)))));
  const latest = app.onData.mock.lastCall?.[0] as LiveAttendanceRegister;
  expect(latest.membersComplete).toBe(false);
  expect(latest.rows).toHaveLength(500);
  expect(latest.complete).toBe(false);
});
it('removes unenrolled students when the membership collection updates', () => {
  const app = start(); seed();
  find(`${path}/attendanceRecords`).next(collection([receipt()]));
  find('groups/course/members').next(collection([student('2')]));
  expect(app.onData.mock.lastCall?.[0].rows.map((item: { uid: string }) => item.uid)).toEqual(['2']);
});
it.each([{ schemaVersion: 1 }, { groupId: 'other' }, { sessionId: 'old' }, { active: 'true' }])(
  'fails closed on an invalid session %j', (patch) => {
    const app = start(); permit();
    find(path).next(snapDoc({ schemaVersion: 2, groupId: 'course', sessionId: 'session', active: true, ...patch }));
    expect(app.onState).toHaveBeenLastCalledWith('error');
    expect(app.onData).not.toHaveBeenCalled();
  },
);
it('stops in the background and requires fresh authorization plus fresh data on return', () => {
  const app = start(); seed();
  const calls = app.onData.mock.calls.length;
  const old = find(`${path}/attendanceRecords`);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(app.onState).toHaveBeenLastCalledWith('paused');
  old.next(collection([receipt()]));
  expect(app.onData).toHaveBeenCalledTimes(calls);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(app.onState).toHaveBeenLastCalledWith('connecting');
  expect(listeners.filter((entry) => entry.stop.mock.calls.length === 0)).toHaveLength(1);
});
it('online alone never announces a restored or successful attendance state', () => {
  const app = start(); seed();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  window.dispatchEvent(new Event('offline'));
  expect(app.onState).toHaveBeenLastCalledWith('offline');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  expect(app.onState).toHaveBeenLastCalledWith('connecting');
});
it('immediately stops when the auth account changes, and cannot resume under another identity', () => {
  const app = start(); seed();
  identity.auth.currentUser = { uid: 'other' };
  authChange(identity.auth.currentUser);
  expect(app.onState).toHaveBeenLastCalledWith('error');
  expect(listeners.every((entry) => entry.stop.mock.calls.length === 1)).toBe(true);
  window.dispatchEvent(new Event('online'));
  expect(listeners).toHaveLength(4);
});
it('stops all subscriptions on errors and disposal, including callbacks after unmount', () => {
  const app = start(); seed();
  find(`${path}/attendanceRecords`).error();
  expect(app.onState).toHaveBeenLastCalledWith('error');
  const before = app.onState.mock.calls.length;
  app.stop(); app.stop();
  window.dispatchEvent(new Event('pageshow'));
  expect(app.onState).toHaveBeenCalledTimes(before);
  expect(listeners.every((entry) => entry.stop.mock.calls.length === 1)).toBe(true);
});
