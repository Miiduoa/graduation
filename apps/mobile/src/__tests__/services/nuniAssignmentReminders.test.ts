import { Platform } from 'react-native';
import { nuniReminderWindow } from '../../services/nuniAssignmentReminderWindow';
import {
  cancelNuniAssignmentReminder, cancelSubmittedNuniAssignmentReminder, confirmNuniAssignmentReminder,
  resolveNuniAssignmentReminderTap, retainNuniAssignmentReminders,
} from '../../services/nuniAssignmentReminders';

type Alarm = {
  identifier: string;
  content: { title: string; body: string; data: Record<string, string> };
  trigger: { date: Date; channelId?: string };
};
const mockAlarms = new Map<string, Alarm>();
const mockDisk = new Map<string, string>();
const mockWrite = jest.fn(async (k: string, value: string) => { mockDisk.set(k, value); });
const mockPermission = jest.fn();
const mockRequest = jest.fn();
const mockChannel = jest.fn();
const mockSchedule = jest.fn(async (a: Alarm) => {
  mockAlarms.set(a.identifier, a);
  return a.identifier;
});
const mockCancel = jest.fn(async (id: string) => { mockAlarms.delete(id); });
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (k: string) => mockDisk.get(k) ?? null,
  setItem: (k: string, value: string) => mockWrite(k, value),
  removeItem: async (k: string) => { mockDisk.delete(k); },
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: () => mockPermission(),
  requestPermissionsAsync: () => mockRequest(),
  setNotificationChannelAsync: () => mockChannel(),
  SchedulableTriggerInputTypes: { DATE: 'date' }, AndroidImportance: { DEFAULT: 3, NONE: 0 },
  getAllScheduledNotificationsAsync: async () => [...mockAlarms.values()],
  scheduleNotificationAsync: (a: Alarm) => mockSchedule(a),
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
}));

const id = '40000000-0000-4000-8000-000000000001';
const target = {
  accountId: 'pa_' + id, schoolId: 'school_1', workspaceId: 'cw_' + id, assignmentId: 'cwa_' + id,
};
const other = { ...target, assignmentId: target.assignmentId.replace(/1$/, '2') };
const current = () => true;
const dueAt = '2030-05-05T09:00:00';
const due = Date.parse('2030-05-05T01:00:00Z');
const review = { dueAt, leadMinutes: 60, isCurrent: current, recheck: async () => true };
const alarm = () => [...mockAlarms.values()][0];
const tap = (a: Alarm, scope = target) => resolveNuniAssignmentReminderTap(a.content.data, a.identifier, scope);
const source = { workspaceId: target.workspaceId, assignmentId: target.assignmentId };
const platform = (value: string) => { Object.defineProperty(Platform, 'OS', { configurable: true, value }); };
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(due - 86_400_000 * 2);
  jest.clearAllMocks();
  mockDisk.clear();
  mockAlarms.clear();
  mockPermission.mockResolvedValue({ granted: true, canAskAgain: true });
  platform('ios');
});
afterEach(() => { jest.useRealTimers(); });

it('uses Taipei wall time and an opaque payload, confirms the native entry and coalesces repeated requests', async () => {
  const [a, b] = await Promise.all([
    confirmNuniAssignmentReminder(target, review), confirmNuniAssignmentReminder(target, review),
  ]);
  expect([a, b].sort()).toEqual(['scheduled', 'unchanged']);
  expect(mockSchedule).toHaveBeenCalledTimes(1);
  const scheduled = alarm();
  expect(scheduled.trigger.date.getTime()).toBe(due - 3_600_000);
  expect(scheduled.content.data).toEqual({ category: 'nuni_assignment_due', lookupToken: expect.any(String) });
  for (const value of Object.values(target)) expect(JSON.stringify(scheduled)).not.toContain(value);
  // Delivered alerts disappear from the scheduled inventory before being tapped.
  mockAlarms.clear();
  expect(await tap(scheduled)).toEqual(source);
  expect(await tap(scheduled, { ...target, schoolId: 'other' })).toBeNull();
  expect(await tap(scheduled, { ...target, accountId: other.assignmentId })).toBeNull();
  expect(await resolveNuniAssignmentReminderTap(scheduled.content.data, 'some-other-alarm', target)).toBeNull();
  jest.setSystemTime(due);
  expect(await tap(scheduled)).toBeNull();
});

it('rotates the lookup after rescheduling and revokes taps after explicit cancellation', async () => {
  await confirmNuniAssignmentReminder(target, review);
  const old = alarm();
  expect(await confirmNuniAssignmentReminder(target, { ...review, leadMinutes: 15 })).toBe('scheduled');
  const updated = alarm();
  expect(mockAlarms.size).toBe(1);
  expect(updated.identifier).not.toBe(old.identifier);
  expect(await tap(old)).toBeNull();
  expect(await tap(updated)).toEqual(source);
  expect(await cancelNuniAssignmentReminder(target, current)).toBe('cancelled');
  expect(mockAlarms.size).toBe(0);
  expect(await tap(updated)).toBeNull();
  expect(await cancelNuniAssignmentReminder(target, current)).toBe('absent');
});

it('creates the Android channel before the permission dialog and rechecks the live assignment afterwards', async () => {
  platform('android');
  mockPermission.mockResolvedValue({ granted: false, canAskAgain: true });
  mockRequest.mockResolvedValue({ granted: true });
  const check = jest.fn(async () => false);
  expect(await confirmNuniAssignmentReminder(target, { ...review, recheck: check })).toBe('stale');
  expect(mockChannel.mock.invocationCallOrder[0]).toBeLessThan(mockRequest.mock.invocationCallOrder[0]);
  expect(mockRequest.mock.invocationCallOrder[0]).toBeLessThan(check.mock.invocationCallOrder[0]);
  expect(mockSchedule).not.toHaveBeenCalled();
  expect(await confirmNuniAssignmentReminder(target, review)).toBe('scheduled');
  expect(alarm().trigger.channelId).toBe('campus-agent-local-reminders');
});

it('never schedules on denied permission, unsupported platforms, invalid sources or missed reminder windows', async () => {
  platform('web');
  expect(await confirmNuniAssignmentReminder(target, review)).toBe('unsupported');
  platform('ios');
  expect(await confirmNuniAssignmentReminder({ ...target, assignmentId: 'malformed' }, review)).toBe('stale');
  expect(await confirmNuniAssignmentReminder(target, { ...review, isCurrent: () => false })).toBe('stale');
  expect(await confirmNuniAssignmentReminder(target, { ...review, dueAt: 'bad' })).toBe('expired');
  expect(mockPermission).not.toHaveBeenCalled();
  mockPermission.mockResolvedValue({ granted: false, canAskAgain: false });
  expect(await confirmNuniAssignmentReminder(target, review)).toBe('denied');
  expect(mockRequest).not.toHaveBeenCalled();
  jest.setSystemTime(due - 3_600_000 - 60_000);
  expect(await confirmNuniAssignmentReminder(target, review)).toBe('expired');
  expect(nuniReminderWindow(due + 367 * 86_400_000, due + 366 * 86_400_000, due)).toBe('too-far');
  expect(mockSchedule).not.toHaveBeenCalled();
});

it('rejects unconfirmed native writes and rolls an alarm back if the captured session changes during scheduling', async () => {
  mockSchedule.mockImplementationOnce(async (a) => a.identifier);
  expect(await confirmNuniAssignmentReminder(target, review)).toBe('failed');
  let active = true;
  mockSchedule.mockImplementationOnce(async (a) => {
    active = false;
    mockAlarms.set(a.identifier, a);
    return a.identifier;
  });
  expect(await confirmNuniAssignmentReminder(target, { ...review, isCurrent: () => active })).toBe('stale');
  expect(mockDisk.size).toBe(0);
  expect(mockAlarms.size).toBe(0);
});

it('a submitted receipt cancels only that account and assignment, also fencing a pending source read', async () => {
  await confirmNuniAssignmentReminder(target, review);
  const first = alarm();
  await confirmNuniAssignmentReminder(other, review);
  let finish!: (ok: boolean) => void;
  let started!: () => void;
  const reading = new Promise<void>((r) => { started = r; });
  const inflight = confirmNuniAssignmentReminder(target, { ...review, recheck: () => {
    started();
    return new Promise<boolean>((r) => { finish = r; });
  } });
  await reading;
  expect(await cancelSubmittedNuniAssignmentReminder({ ...target, accountId: 'other' })).toBe('absent');
  expect(await cancelSubmittedNuniAssignmentReminder(target)).toBe('cancelled');
  finish(true);
  expect(await inflight).toBe('stale');
  expect(await tap(first)).toBeNull();
  expect(mockAlarms.size).toBe(1);
  expect(await tap(alarm())).toEqual({ workspaceId: other.workspaceId, assignmentId: other.assignmentId });
});

it('removes foreign and interrupted alarms on owner cleanup while preserving unrelated notifications', async () => {
  await confirmNuniAssignmentReminder(target, review);
  const own = alarm();
  const accountB = { ...target, accountId: target.accountId.replace(/1$/, '2') };
  await confirmNuniAssignmentReminder(accountB, review);
  mockAlarms.set('other-feature', { ...own, identifier: 'other-feature' });
  mockAlarms.set('nuni.assignment.due.orphan', { ...own, identifier: 'nuni.assignment.due.orphan' });
  await retainNuniAssignmentReminders(target.accountId);
  expect([...mockAlarms.keys()].sort()).toEqual([own.identifier, 'other-feature'].sort());
  expect(await tap(own)).toEqual(source);
  await retainNuniAssignmentReminders(null);
  expect([...mockAlarms.keys()]).toEqual(['other-feature']);
  expect(await tap(own)).toBeNull();
});

it('reports a native cancellation failure and permits a retry', async () => {
  await confirmNuniAssignmentReminder(target, review);
  mockCancel.mockImplementationOnce(async () => undefined);
  expect(await cancelNuniAssignmentReminder(target, current)).toBe('failed');
  expect(await cancelNuniAssignmentReminder(target, current)).toBe('cancelled');
});

it('preserves the previous alarm and tap if writing its replacement fails after the disk write', async () => {
  await confirmNuniAssignmentReminder(target, review);
  const old = alarm();
  mockWrite.mockImplementationOnce(async (k, value) => {
    mockDisk.set(k, value);
    throw new Error('bridge failure');
  });
  expect(await confirmNuniAssignmentReminder(target, { ...review, leadMinutes: 15 })).toBe('failed');
  expect([...mockAlarms.keys()]).toEqual([old.identifier]);
  expect(await tap(old)).toEqual(source);
});

it('honors an Android channel disabled independently of app permissions', async () => {
  platform('android');
  mockChannel.mockResolvedValueOnce({ importance: 0 });
  expect(await confirmNuniAssignmentReminder(target, review)).toBe('denied');
  expect(mockRequest).not.toHaveBeenCalled();
  expect(mockSchedule).not.toHaveBeenCalled();
});
