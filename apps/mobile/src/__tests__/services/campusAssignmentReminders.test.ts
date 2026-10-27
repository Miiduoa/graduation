import {
  scheduleCampusAssignmentReminder,
  cancelCampusAssignmentReminder,
  CAMPUS_AGENT_REMINDER_PREFIX,
} from '../../services/campusAssignmentReminders';
import type { CampusSenseSnapshot } from '../../services/campusSenseSnapshot';
import type { CampusPlanStep } from '../../services/offlineCampusPlanner';
import * as Notifications from 'expo-notifications';

let mockUid: string | null = 'A';
let mockConfig = false;
let mockPermission = { granted: true, canAskAgain: true, status: 'granted' };
const mockReceipts = new Map<string, string>();
const mockScheduled = new Map<string, { identifier: string; content: unknown }>();
const mockGetAll = jest.fn(async () => Array.from(mockScheduled.values()));
const mockSchedule = jest.fn(async ({ identifier, content }: { identifier: string; content: unknown }) => {
  mockScheduled.set(identifier, { identifier, content });
  return identifier;
});
const mockCancel = jest.fn(async (identifier: string) => {
  mockScheduled.delete(identifier);
});
const mockGetItem = jest.fn(async (key: string) => mockReceipts.get(key) ?? null);
const mockSetItem = jest.fn(async (key: string, value: string) => {
  mockReceipts.set(key, value);
});
const mockRemoveItem = jest.fn(async (key: string) => {
  mockReceipts.delete(key);
});
const mockRequestPermission = jest.fn(async () => mockPermission);

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (...args: unknown[]) => mockGetItem(...(args as [string])),
    setItem: (...args: unknown[]) => mockSetItem(...(args as [string, string])),
    removeItem: (...args: unknown[]) => mockRemoveItem(...(args as [string])),
  },
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algo: string, message: string) =>
    require('crypto').createHash('sha256').update(message).digest('hex'),
}));
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: jest.fn(async () => mockPermission),
  requestPermissionsAsync: () => mockRequestPermission(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: () => mockGetAll(),
  scheduleNotificationAsync: (...args: unknown[]) =>
    mockSchedule(...(args as [{ identifier: string; content: unknown }])),
  cancelScheduledNotificationAsync: (...args: unknown[]) => mockCancel(...(args as [string])),
}));
jest.mock('../../firebase', () => ({
  isFirebaseMockMode: () => mockConfig,
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
}));

const scope = { uid: 'A', schoolId: 'pu' };
const tomorrow = () => new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString();
const step = (dueAt = tomorrow()): CampusPlanStep => ({
  id: 'assignment-0',
  title: '資訊管理期末報告',
  groupName: '資料庫系統',
  dueAt,
  detail: '請到課程頁確認繳交狀態。',
  priority: 'normal',
  evidence: 'authorized-assignments',
  route: '/classroom',
});
const sense = (assignment = step()): CampusSenseSnapshot => ({
  userId: 'A',
  schoolId: 'pu',
  checkedAt: new Date().toISOString(),
  schedule: { status: 'unavailable', count: null },
  assignments: {
    status: 'available', count: 1,
    items: [{
      title: assignment.title,
      groupName: assignment.groupName || '',
      dueAt: assignment.dueAt || null,
    }],
  },
  announcements: { status: 'unavailable', items: [] },
});
const request = (assignment = step()) => ({
  scope,
  step: assignment,
  snapshot: sense(assignment),
  leadMinutes: 60 as const,
  isCurrent: () => true,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockReceipts.clear();
  mockScheduled.clear();
  mockUid = 'A';
  mockConfig = false;
  mockPermission = { granted: true, canAskAgain: true, status: 'granted' };
  mockGetAll.mockImplementation(async () => Array.from(mockScheduled.values()));
  mockSchedule.mockImplementation(async ({ identifier, content }) => {
    mockScheduled.set(identifier, { identifier, content });
    return identifier;
  });
  mockSetItem.mockImplementation(async (key: string, value: string) => {
    mockReceipts.set(key, value);
  });
});

test('schedules a real one-time OS reminder after explicit confirmation, without exposing private titles', async () => {
  const input = request();
  const result = await scheduleCampusAssignmentReminder(input);
  expect(result.outcome).toBe('scheduled');
  expect(mockSchedule).toHaveBeenCalledTimes(1);
  const event = mockSchedule.mock.calls[0][0];
  expect(event.identifier).toMatch(new RegExp('^' + CAMPUS_AGENT_REMINDER_PREFIX.replace(/\./g, '\\.')));
  expect(event.content).toEqual(expect.objectContaining({
    title: '校園作業提醒',
    body: expect.not.stringContaining('資訊管理期末報告'),
    data: { type: 'campus_agent_assignment_due_v1' },
  }));
  expect(JSON.stringify(event)).not.toContain(input.scope.uid);
  expect(JSON.stringify(event)).not.toContain('資料庫系統');
  expect(result.triggerAt).toBe(new Date(Date.parse(input.step.dueAt!) - 60 * 60 * 1000).toISOString());
  expect(mockRequestPermission).not.toHaveBeenCalled();
  expect(mockReceipts.size).toBe(1);
});

test('deduplicates identical schedules without a new OS write, even after UI remount', async () => {
  const input = request();
  await scheduleCampusAssignmentReminder(input);
  const second = await scheduleCampusAssignmentReminder(input);
  expect(second.outcome).toBe('already-scheduled');
  expect(mockSchedule).toHaveBeenCalledTimes(1);
});

test('permission denial never schedules or pretends to succeed', async () => {
  mockPermission = { granted: false, canAskAgain: false, status: 'denied' };
  await expect(scheduleCampusAssignmentReminder(request())).rejects.toMatchObject({
    code: 'permission-required',
  });
  expect(mockSchedule).not.toHaveBeenCalled();
  expect(mockReceipts.size).toBe(0);
});

test('an expired or cross-user source is not an execution credential', async () => {
  const input = request();
  const expired = {
    ...input,
    snapshot: { ...input.snapshot, checkedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
  };
  await expect(scheduleCampusAssignmentReminder(expired)).rejects.toMatchObject({
    code: 'expired-source',
  });
  const foreign = { ...input, snapshot: { ...input.snapshot, userId: 'B' } };
  await expect(scheduleCampusAssignmentReminder(foreign)).rejects.toMatchObject({
    code: 'expired-source',
  });
  expect(mockSchedule).not.toHaveBeenCalled();
});

test('never schedules from fake model text, changed deadline, or unknown due date', async () => {
  const input = request();
  const fabricated = { ...input, step: { ...input.step, title: '其他人的作業' } };
  await expect(scheduleCampusAssignmentReminder(fabricated)).rejects.toMatchObject({
    code: 'invalid-source',
  });
  const changedDue = {
    ...input,
    step: { ...input.step, dueAt: new Date(Date.now() + 100 * 60 * 60 * 1000).toISOString() },
  };
  await expect(scheduleCampusAssignmentReminder(changedDue)).rejects.toMatchObject({
    code: 'invalid-source',
  });
  await expect(scheduleCampusAssignmentReminder({
    ...input,
    step: { ...input.step, evidence: 'verification' },
  })).rejects.toMatchObject({ code: 'invalid-source' });
  expect(mockSchedule).not.toHaveBeenCalled();
});

test('cannot accidentally schedule past 1-hour or 24-hour reminder times', async () => {
  const soon = step(new Date(Date.now() + 30 * 60 * 1000).toISOString());
  await expect(scheduleCampusAssignmentReminder(request(soon)))
    .rejects.toMatchObject({ code: 'deadline-too-close' });
  const later = step(new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString());
  await expect(scheduleCampusAssignmentReminder({
    ...request(later), leadMinutes: 1440,
  })).rejects.toMatchObject({ code: 'deadline-too-close' });
  expect(mockSchedule).not.toHaveBeenCalled();
});

test('does not leave an OS notification behind when persistence fails', async () => {
  mockSetItem.mockRejectedValueOnce(new Error('storage full'));
  await expect(scheduleCampusAssignmentReminder(request())).rejects.toMatchObject({
    code: 'native-failed',
  });
  expect(mockSchedule).toHaveBeenCalledTimes(1);
  expect(mockCancel).toHaveBeenCalledTimes(1);
  expect(mockScheduled.size).toBe(0);
  expect(mockReceipts.size).toBe(0);
});

test('account switch during native scheduling triggers best-effort rollback', async () => {
  mockSchedule.mockImplementationOnce(async ({ identifier, content }) => {
    mockScheduled.set(identifier, { identifier, content });
    mockUid = 'B';
    return identifier;
  });
  await expect(scheduleCampusAssignmentReminder(request())).rejects.toMatchObject({
    code: 'session-changed',
  });
  expect(mockCancel).toHaveBeenCalledTimes(1);
  expect(mockScheduled.size).toBe(0);
});

test('cancel affects only its own deterministic reminder id', async () => {
  const input = request();
  await scheduleCampusAssignmentReminder(input);
  mockScheduled.set('another-feature.opaque-id', {
    identifier: 'another-feature.opaque-id', content: { title: 'Unrelated' },
  });
  const cancelled = await cancelCampusAssignmentReminder({
    scope, step: input.step, leadMinutes: 60, isCurrent: () => true,
  });
  expect(cancelled).toBe(true);
  expect(mockScheduled.size).toBe(1);
  expect(mockScheduled.has('another-feature.opaque-id')).toBe(true);
  expect(mockReceipts.size).toBe(0);
});

test('concurrent identical confirmations are rejected while the first is pending', async () => {
  let resolvePermission!: (value: typeof mockPermission) => void;
  mockPermission = { granted: false, canAskAgain: true, status: 'undetermined' };
  mockRequestPermission.mockImplementationOnce(() => new Promise((resolve) => {
    resolvePermission = resolve;
  }));
  const input = request();
  const first = scheduleCampusAssignmentReminder(input);
  for (let i = 0; i < 30 && mockRequestPermission.mock.calls.length === 0; i += 1) {
    await Promise.resolve();
  }
  expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  await expect(scheduleCampusAssignmentReminder(input)).rejects.toMatchObject({ code: 'busy' });
  resolvePermission({ granted: true, canAskAgain: true, status: 'granted' });
  await expect(first).resolves.toMatchObject({ outcome: 'scheduled' });
  expect(mockSchedule).toHaveBeenCalledTimes(1);
});

test('notification budget is shared with other scheduled notifications', async () => {
  for (let i = 0; i < 32; i += 1) {
    mockScheduled.set('another-' + i, { identifier: 'another-' + i, content: {} });
  }
  await expect(scheduleCampusAssignmentReminder(request())).rejects.toMatchObject({
    code: 'device-capacity',
  });
  expect(mockSchedule).not.toHaveBeenCalled();
});

test('an ambiguous native bridge rejection cancels the deterministic own slot', async () => {
  mockSchedule.mockImplementationOnce(async ({ identifier, content }) => {
    mockScheduled.set(identifier, { identifier, content });
    throw new Error('Native bridge response lost after scheduling');
  });
  await expect(scheduleCampusAssignmentReminder(request())).rejects.toMatchObject({
    code: 'native-failed',
  });
  expect(mockCancel).toHaveBeenCalledTimes(1);
  expect(mockScheduled.size).toBe(0);
  expect(mockReceipts.size).toBe(0);
});
