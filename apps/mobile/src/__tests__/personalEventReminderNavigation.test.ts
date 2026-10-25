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
const mockResolve = jest.fn();

jest.mock('../app/rootNavigation', () => ({
  rootNavigateNested: (...args: unknown[]) => mockRootNavigateNested(...args),
  rootNavigationRef: { isReady: () => mockRootReady() },
  isSchoolNavigationReady: () => mockRootReady(),
  subscribeSchoolNavigationReady: () => () => undefined,
}));
jest.mock('../app/publicNavigation', () => ({
  isPublicNavigationReady: () => mockPublicReady(),
  publicNavigatePersonalCalendar: (...args: unknown[]) => mockPublicNavigate(...args),
  subscribePublicNavigationReady: () => () => undefined,
}));
jest.mock('../services/personalEventReminders', () => ({
  resolvePersonalEventReminderTap: (...args: unknown[]) => mockResolve(...args),
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
