import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { PersonalEventReminderBridge } from '../components/PersonalEventReminderBridge';
import * as notificationService from '../services/notifications';
import {
  __resetPersonalEventReminderNavigationForTests,
  flushPendingPersonalEventReminderTap,
  handlePersonalEventReminderResponse,
  setPersonalEventReminderScopeProvider,
} from '../services/personalEventReminderNavigation';
import {
  PERSONAL_EVENT_REMINDER_TYPE,
  buildPersonalEventReminderPayload,
} from '../services/personalEventReminderModel';

const mockRootNavigateNested = jest.fn(() => true);
const mockRootReady = jest.fn(() => false);
const mockPublicReady = jest.fn(() => false);
const mockPublicNavigate = jest.fn(() => true);
const mockPublicTimetable = jest.fn((_params: unknown) => true);
const mockPublicWorkspace = jest.fn();
const mockAssignmentResolve = jest.fn();
const mockResolve = jest.fn();
let mockScope: { owner: string; schoolId: string } | null = null;

jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => mockScope }));
jest.mock('../services/personalImports', () => ({
  personalImportStorageKey: (scope: object) => JSON.stringify(scope),
  subscribePersonalImports: () => () => undefined,
}));
jest.mock('../services/notifications', () => ({
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
}));

jest.mock('../app/rootNavigation', () => ({
  rootNavigateNested: (...args: unknown[]) => mockRootNavigateNested(...args),
  rootNavigationRef: { isReady: () => mockRootReady() },
  isSchoolNavigationReady: () => mockRootReady(),
  subscribeSchoolNavigationReady: () => () => undefined,
}));
jest.mock('../app/publicNavigation', () => ({
  isPublicNavigationReady: () => mockPublicReady(),
  publicNavigateNuniWorkspace: (params: unknown) => mockPublicWorkspace(params),
  publicNavigatePersonalCalendar: (...args: unknown[]) => mockPublicNavigate(...args),
  publicNavigatePersonalTimetable: (params: unknown) => mockPublicTimetable(params),
  subscribePublicNavigationReady: () => () => undefined,
}));
jest.mock('../services/nuniAssignmentReminders', () => ({
  resolveNuniAssignmentReminderTap: (...args: unknown[]) => mockAssignmentResolve(...args),
}));
jest.mock('../services/personalEventReminders', () => ({
  resolvePersonalEventReminderTap: (...args: unknown[]) => mockResolve(...args),
  invalidatePersonalEventRemindersForScopeChange: jest.fn(async () => undefined),
  reconcilePersonalEventReminders: jest.fn(async () => undefined),
}));

beforeEach(() => {
  jest.clearAllMocks();
  __resetPersonalEventReminderNavigationForTests();
  mockRootReady.mockReturnValue(false);
  mockPublicReady.mockReturnValue(false);
  mockResolve.mockResolvedValue({
    ok: true,
    eventId: 'evt-1',
    record: { id: 'evt-1' },
  });
});

test('queues guest taps until public navigator and scope are ready', async () => {
  setPersonalEventReminderScopeProvider(() => ({ owner: 'guest:device', schoolId: 'pu' }));
  const payload = buildPersonalEventReminderPayload({ lookupToken: 'tok', intentGeneration: 1 });
  const response = {
    notification: { request: { identifier: 'per-evtrem.tok', content: { data: payload } } },
  };

  await expect(handlePersonalEventReminderResponse(response)).resolves.toBe(false);
  expect(mockPublicNavigate).not.toHaveBeenCalled();
  expect(mockRootNavigateNested).not.toHaveBeenCalled();

  mockPublicReady.mockReturnValue(true);
  await expect(flushPendingPersonalEventReminderTap()).resolves.toBe(true);
  expect(mockPublicNavigate).toHaveBeenCalledWith({ eventId: 'evt-1' });
  expect(mockRootNavigateNested).not.toHaveBeenCalled();
});

test('school navigator uses nested PersonalCalendar and ignores duplicate replay', async () => {
  setPersonalEventReminderScopeProvider(() => ({
    owner: 'nuni:pa_1',
    schoolId: 'pu',
  }));
  mockRootReady.mockReturnValue(true);
  const payload = buildPersonalEventReminderPayload({ lookupToken: 'tok2', intentGeneration: 2 });
  const response = {
    notification: { request: { identifier: 'per-evtrem.tok2', content: { data: payload } } },
    actionIdentifier: 'default',
  };

  await expect(handlePersonalEventReminderResponse(response)).resolves.toBe(true);
  expect(mockRootNavigateNested).toHaveBeenCalledWith('學習', 'PersonalCalendar', {
    eventId: 'evt-1',
  });

  mockRootNavigateNested.mockClear();
  await expect(handlePersonalEventReminderResponse(response)).resolves.toBe(true);
  expect(mockRootNavigateNested).not.toHaveBeenCalled();
});

test('remote event payloads are ignored by the personal consumer', async () => {
  setPersonalEventReminderScopeProvider(() => ({ owner: 'guest:device', schoolId: 'pu' }));
  mockRootReady.mockReturnValue(true);
  await expect(
    handlePersonalEventReminderResponse({
      notification: {
        request: {
          identifier: 'remote',
          content: { data: { type: 'event', id: 'school-event' } },
        },
      },
    }),
  ).resolves.toBe(false);
  expect(mockResolve).not.toHaveBeenCalled();
  expect(PERSONAL_EVENT_REMINDER_TYPE).toBe('personal_event_reminder_v1');
});

test('safe clear uses the exact queued response identity, not a newer last response', async () => {
  setPersonalEventReminderScopeProvider(() => ({ owner: 'guest:device', schoolId: 'pu' }));
  const first = buildPersonalEventReminderPayload({ lookupToken: 'tok-a', intentGeneration: 1 });
  const second = buildPersonalEventReminderPayload({ lookupToken: 'tok-b', intentGeneration: 2 });
  const queued = {
    notification: { request: { identifier: 'per-evtrem.tok-a', content: { data: first } } },
    actionIdentifier: 'default',
  };
  const newer = {
    notification: { request: { identifier: 'per-evtrem.tok-b', content: { data: second } } },
    actionIdentifier: 'default',
  };

  await expect(handlePersonalEventReminderResponse(queued)).resolves.toBe(false);

  mockPublicReady.mockReturnValue(true);
  mockResolve.mockResolvedValueOnce({ ok: true, eventId: 'evt-1', record: { id: 'evt-1' } });
  const cleared: unknown[] = [];
  await expect(
    flushPendingPersonalEventReminderTap({
      clearLastResponse: async (expected) => {
        cleared.push(expected);
      },
    }),
  ).resolves.toBe(true);
  expect(cleared).toHaveLength(1);
  expect(cleared[0]).toEqual(queued);
  expect(cleared[0]).not.toEqual(newer);
});

test('denied or invalid taps clear the exact response without navigating', async () => {
  setPersonalEventReminderScopeProvider(() => ({ owner: 'guest:device', schoolId: 'pu' }));
  mockPublicReady.mockReturnValue(true);
  mockResolve.mockResolvedValue({ ok: false, reason: 'stale_generation' });
  const payload = buildPersonalEventReminderPayload({ lookupToken: 'tok-x', intentGeneration: 9 });
  const response = {
    notification: { request: { identifier: 'per-evtrem.tok-x', content: { data: payload } } },
    actionIdentifier: 'default',
  };
  const cleared: unknown[] = [];
  await expect(
    handlePersonalEventReminderResponse(response, {
      clearLastResponse: async (expected) => {
        cleared.push(expected);
      },
    }),
  ).resolves.toBe(false);
  expect(mockPublicNavigate).not.toHaveBeenCalled();
  expect(cleared).toEqual([response]);
});

const platformScope = { owner: 'nuni:alice', schoolId: 'pu' };
const firebaseScope = { owner: 'firebase:alice', schoolId: 'pu' };
const classStart = Date.parse('2026-11-04T00:05:00+08:00');

function classResponse(scope: typeof platformScope, overrides: Record<string, unknown> = {}) {
  const data = {
    category: 'personal_class_occurrence',
    scope: JSON.stringify(scope),
    courseId: 'manual:c1',
    startAt: classStart,
    ...overrides,
  };
  return { notification: { request: { identifier: 'class-1', content: { data } } } };
}

test('NUNI cold-start class tap waits for scope and public navigation, using the Taipei occurrence date', async () => {
  const response = classResponse(platformScope);
  await expect(handlePersonalEventReminderResponse(response)).resolves.toBe(false);
  setPersonalEventReminderScopeProvider(() => platformScope);
  await expect(flushPendingPersonalEventReminderTap()).resolves.toBe(false);
  mockPublicReady.mockReturnValue(true);
  await Promise.all([flushPendingPersonalEventReminderTap(), handlePersonalEventReminderResponse(response)]);
  expect(mockPublicTimetable).toHaveBeenCalledTimes(1);
  expect(mockPublicTimetable).toHaveBeenCalledWith({ schoolId: 'pu', courseId: 'manual:c1', date: '2026-11-04', startAt: classStart, reminderScope: JSON.stringify(platformScope) });
  expect(mockResolve).not.toHaveBeenCalled();
});

test('a live school class tap opens the focused timetable and never opens the inbox', async () => {
  setPersonalEventReminderScopeProvider(() => firebaseScope);
  mockRootReady.mockReturnValue(true);
  await expect(handlePersonalEventReminderResponse(classResponse(firebaseScope))).resolves.toBe(true);
  expect(mockRootNavigateNested).toHaveBeenCalledWith('學習', 'PersonalTimetable', {
    schoolId: 'pu', courseId: 'manual:c1', date: '2026-11-04', startAt: classStart, reminderScope: JSON.stringify(firebaseScope),
  });
  expect(mockPublicTimetable).not.toHaveBeenCalled();
});

test.each([
  ['other owner', { owner: 'nuni:bob', schoolId: 'pu' }, {}],
  ['other school', { owner: 'nuni:alice', schoolId: 'nthu' }, {}],
  ['guest', { owner: 'guest:device', schoolId: 'pu' }, {}],
  ['invalid course', platformScope, { courseId: '  ' }],
  ['invalid timestamp', platformScope, { startAt: Number.MAX_SAFE_INTEGER }],
] as const)('rejects a queued class tap after resolving %s', async (_name, resolvedScope, overrides) => {
  const response = classResponse(platformScope, overrides);
  const clear = jest.fn(async () => undefined);
  await handlePersonalEventReminderResponse(response);
  setPersonalEventReminderScopeProvider(() => resolvedScope);
  mockPublicReady.mockReturnValue(true);
  await expect(flushPendingPersonalEventReminderTap({ clearLastResponse: clear })).resolves.toBe(false);
  expect(mockPublicTimetable).not.toHaveBeenCalled();
  expect(mockRootNavigateNested).not.toHaveBeenCalled();
  expect(clear).toHaveBeenCalledWith(response);
});

test('legacy same-scope class taps focus the course without guessing an occurrence date', async () => {
  setPersonalEventReminderScopeProvider(() => platformScope);
  mockPublicReady.mockReturnValue(true);
  await expect(handlePersonalEventReminderResponse(classResponse(platformScope, { startAt: undefined }))).resolves.toBe(true);
  expect(mockPublicTimetable).toHaveBeenCalledWith({ schoolId: 'pu', courseId: 'manual:c1', reminderScope: JSON.stringify(platformScope) });
});

test('the mounted bridge restores a platform tap and receives live taps without school login', async () => {
  const initial = classResponse(platformScope);
  const last = jest.mocked(notificationService.getLastNotificationResponseAsync);
  last.mockResolvedValue(initial as Awaited<ReturnType<typeof last>>);
  mockScope = null;
  mockPublicReady.mockReturnValue(true);
  const view = render(React.createElement(PersonalEventReminderBridge));
  await waitFor(() => expect(last).toHaveBeenCalled());
  expect(mockPublicTimetable).not.toHaveBeenCalled();

  mockScope = platformScope;
  view.rerender(React.createElement(PersonalEventReminderBridge));
  await waitFor(() => expect(mockPublicTimetable).toHaveBeenCalledTimes(1));
  const newer = classResponse(platformScope, { courseId: 'manual:c2' });
  last.mockResolvedValue(newer as Awaited<ReturnType<typeof last>>);
  const [onResponse] = jest.mocked(notificationService.addNotificationResponseReceivedListener).mock.calls[0]!;
  await act(async () => { onResponse(newer as Parameters<typeof onResponse>[0]); });
  expect(mockPublicTimetable).toHaveBeenLastCalledWith(expect.objectContaining({ courseId: 'manual:c2' }));
  expect(mockPublicTimetable).toHaveBeenCalledTimes(2);
  expect(mockRootNavigateNested).not.toHaveBeenCalled();
  view.unmount();
});

const assignmentTap = { notification: { request: {
  identifier: 'os-assignment', content: { data: { category: 'nuni_assignment_due', lookupToken: 'opaque-token' } },
} } };
const assignmentScope = { ...platformScope, nuniContext: 'verified-session' };
const assignmentTarget = { assignmentId: 'assignment-a', workspaceId: 'workspace-a' };

test.each(['public', 'school'])('opens the exact nuni assignment once in the %s navigator', async (navigator) => {
  mockAssignmentResolve.mockResolvedValue(assignmentTarget);
  mockPublicWorkspace.mockReturnValue(true);
  await expect(handlePersonalEventReminderResponse(assignmentTap)).resolves.toBe(false);
  setPersonalEventReminderScopeProvider(() => assignmentScope);
  (navigator === 'school' ? mockRootReady : mockPublicReady).mockReturnValue(true);
  await Promise.all([flushPendingPersonalEventReminderTap(), handlePersonalEventReminderResponse(assignmentTap)]);
  expect(mockAssignmentResolve).toHaveBeenCalledWith(assignmentTap.notification.request.content.data,
    'os-assignment', { accountId: 'alice', schoolId: 'pu' });
  const args = { tab: 'courses', ...assignmentTarget, assistantAccountId: 'alice' };
  if (navigator === 'school') {
    expect(mockRootNavigateNested).toHaveBeenCalledTimes(1);
    expect(mockRootNavigateNested).toHaveBeenCalledWith('我的', 'NuniWorkspace', args);
  } else {
    expect(mockPublicWorkspace).toHaveBeenCalledTimes(1);
    expect(mockPublicWorkspace).toHaveBeenCalledWith(args);
  }
});

test.each([platformScope, firebaseScope, { owner: 'guest:device', schoolId: 'pu' }])(
  'unverified assignment tap cannot look up a receipt for %p', async (scope) => {
    mockPublicReady.mockReturnValue(true);
    setPersonalEventReminderScopeProvider(() => scope);
    const clear = jest.fn(async () => undefined);
    await expect(handlePersonalEventReminderResponse(assignmentTap, { clearLastResponse: clear })).resolves.toBe(false);
    expect(clear).toHaveBeenCalledWith(assignmentTap);
    expect(mockAssignmentResolve).not.toHaveBeenCalled();
    expect(mockPublicWorkspace).not.toHaveBeenCalled();
  },
);


test('keeps the tapped assignment pending through an in-flight session recheck', async () => {
  let verified: typeof assignmentScope | null = assignmentScope;
  mockPublicReady.mockReturnValue(true);
  mockPublicWorkspace.mockReturnValue(true);
  const clear = jest.fn(async () => undefined);
  let finish!: (target: typeof assignmentTarget) => void;
  mockAssignmentResolve.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  mockAssignmentResolve.mockResolvedValue(assignmentTarget);
  setPersonalEventReminderScopeProvider(() => verified);

  const inflight = handlePersonalEventReminderResponse(assignmentTap, { clearLastResponse: clear });
  expect(mockAssignmentResolve).toHaveBeenCalledTimes(1);
  // A foreground auth recheck briefly has no verified identity.
  verified = null;
  setPersonalEventReminderScopeProvider(() => verified);
  finish(assignmentTarget);
  await expect(inflight).resolves.toBe(false);
  expect(mockPublicWorkspace).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();

  verified = assignmentScope;
  setPersonalEventReminderScopeProvider(() => verified);
  await expect(flushPendingPersonalEventReminderTap({ clearLastResponse: clear })).resolves.toBe(true);
  expect(mockPublicWorkspace).toHaveBeenCalledTimes(1);
  expect(mockPublicWorkspace).toHaveBeenCalledWith({
    tab: 'courses', ...assignmentTarget, assistantAccountId: 'alice',
  });
  expect(clear).toHaveBeenCalledTimes(1);
  expect(clear).toHaveBeenCalledWith(assignmentTap);
});

test.each([
  { ...assignmentScope, schoolId: 'other' }, { ...assignmentScope, owner: 'nuni:bob' },
  { ...assignmentScope, nuniContext: undefined }, { ...assignmentScope, nuniContext: 'new-session' },
])('a pending receipt lookup cannot navigate after the scope or session changes', async (changed) => {
  mockPublicReady.mockReturnValue(true);
  setPersonalEventReminderScopeProvider(() => assignmentScope);
  let finish!: (value: typeof assignmentTarget) => void;
  mockAssignmentResolve.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const clear = jest.fn(async () => undefined);
  const pending = handlePersonalEventReminderResponse(assignmentTap, { clearLastResponse: clear });
  setPersonalEventReminderScopeProvider(() => changed);
  finish(assignmentTarget);
  await expect(pending).resolves.toBe(false);
  expect(clear).toHaveBeenCalledWith(assignmentTap);
  expect(mockPublicWorkspace).not.toHaveBeenCalled();
});
