import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockRootNavigateNested = jest.fn(() => true);
const mockApply = jest.fn(() => true);
const mockResolve = jest.fn();
const mockReady = jest.fn(() => true);
const mockReadyListeners = new Set<() => void>();
const listeners: Array<(response: unknown) => void> = [];

jest.mock('../app/rootNavigation', () => ({
  rootNavigateNested: (...args: unknown[]) => mockRootNavigateNested(...args),
  rootNavigationRef: { isReady: () => mockReady() },
  isSchoolNavigationReady: () => mockReady(),
  subscribeSchoolNavigationReady: (listener: () => void) => {
    mockReadyListeners.add(listener);
    if (mockReady()) listener();
    return () => mockReadyListeners.delete(listener);
  },
}));
jest.mock('../utils/applyNotificationDestination', () => ({
  applyNotificationDestination: (...args: unknown[]) => mockApply(...args),
}));
jest.mock('../utils/notificationDestination', () => ({
  resolveNotificationDestination: (...args: unknown[]) => mockResolve(...args),
}));
jest.mock('../services/notifications', () => ({
  addNotificationResponseReceivedListener: (cb: (response: unknown) => void) => {
    listeners.push(cb);
    return { remove: jest.fn() };
  },
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  syncPushTokenForUser: jest.fn(async () => 'token'),
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import * as notices from '../services/notifications';
import {
  navigateFromNotificationData,
  usePushNotifications,
} from '../app/usePushNotifications';

beforeEach(() => {
  jest.clearAllMocks();
  listeners.length = 0;
  mockReady.mockReturnValue(true);
  mockReadyListeners.clear();
  jest.mocked(notices.getLastNotificationResponseAsync).mockReset().mockResolvedValue(null);
  mockResolve.mockReturnValue({
    ok: true,
    mode: 'nested',
    tab: '學習',
    screen: 'Grades',
    params: { gradeId: 'g1', schoolId: 'pu' },
    summary: '開啟成績',
  });
});

test('navigateFromNotificationData threads schoolId so cross-school grades are rejected', () => {
  mockResolve.mockReturnValueOnce({
    ok: false,
    code: 'school_mismatch',
    reason: '跨校',
  });
  const payload = { type: 'grade', gradeId: 'grade-9', schoolId: 'nthu', channel: 'grades' };
  expect(navigateFromNotificationData(payload, 'student', 'pu')).toBe(false);
  expect(mockResolve).toHaveBeenCalledWith(
    { data: payload },
    { role: 'student', schoolId: 'pu' },
  );
  expect(mockRootNavigateNested).toHaveBeenCalledWith('訊息', 'Notifications');
  expect(mockApply).not.toHaveBeenCalled();
});

test('hook handleResponse passes the live schoolId from SchoolNavigation args', async () => {
  const nav = { current: null };
  const { rerender } = renderHook(
    (props: { schoolId: string | null }) =>
      usePushNotifications(nav, 'alice', 'student', props.schoolId),
    { initialProps: { schoolId: 'pu' } },
  );

  await waitFor(() => expect(listeners.length).toBeGreaterThan(0));

  mockResolve.mockReturnValueOnce({
    ok: false,
    code: 'school_mismatch',
    reason: '跨校',
  });

  await act(async () => {
    listeners[listeners.length - 1]!({
      notification: {
        request: {
          identifier: 'n1',
          content: {
            data: { type: 'grade', gradeId: 'g1', schoolId: 'nthu', channel: 'grades' },
          },
        },
      },
      actionIdentifier: 'default',
    });
  });

  expect(mockResolve).toHaveBeenCalledWith(
    {
      data: { type: 'grade', gradeId: 'g1', schoolId: 'nthu', channel: 'grades' },
    },
    { role: 'student', schoolId: 'pu' },
  );
  expect(mockRootNavigateNested).toHaveBeenCalledWith('訊息', 'Notifications');

  // 切校後 listener 以新 schoolId 重新掛載；同校成績可開。
  rerender({ schoolId: 'nthu' });
  await waitFor(() => expect(listeners.length).toBeGreaterThan(1));
  const resolvedBeforeStaleCallback = mockResolve.mock.calls.length;
  await act(async () => {
    listeners[0]!({ notification: { request: { identifier: 'stale', content: {
      data: { type: 'grade', gradeId: 'old-grade', schoolId: 'pu' },
    } } } });
  });
  expect(mockResolve).toHaveBeenCalledTimes(resolvedBeforeStaleCallback);

  mockResolve.mockReturnValueOnce({
    ok: true,
    mode: 'nested',
    tab: '學習',
    screen: 'Grades',
    params: { gradeId: 'g2', schoolId: 'nthu' },
    summary: '開啟成績',
  });
  await act(async () => {
    listeners[listeners.length - 1]!({
      notification: {
        request: {
          identifier: 'n2',
          content: {
            data: { type: 'grade', gradeId: 'g2', schoolId: 'nthu', channel: 'grades' },
          },
        },
      },
    });
  });
  expect(mockResolve).toHaveBeenLastCalledWith(
    {
      data: { type: 'grade', gradeId: 'g2', schoolId: 'nthu', channel: 'grades' },
    },
    { role: 'student', schoolId: 'nthu' },
  );
  expect(mockApply).toHaveBeenCalled();
});

test.each([
  { type: 'personal_event_reminder_v1', v: 1, t: 'tok', g: 1 },
  { category: 'personal_class_occurrence', courseId: 'manual:c1' },
])('personal local reminder payloads are ignored before dedup navigation and clear', async (data) => {
  const {
    clearLastNotificationResponseAsync,
  } = require('../services/notifications') as {
    clearLastNotificationResponseAsync: jest.Mock;
  };
  const nav = { current: null };
  renderHook(() => usePushNotifications(nav, 'alice', 'student', 'pu'));
  await waitFor(() => expect(listeners.length).toBeGreaterThan(0));

  await act(async () => {
    listeners[listeners.length - 1]!({
      notification: {
        request: {
          identifier: 'per-evtrem.tok',
          content: {
            data,
          },
        },
      },
      actionIdentifier: 'default',
    });
  });

  expect(mockResolve).not.toHaveBeenCalled();
  expect(mockApply).not.toHaveBeenCalled();
  expect(mockRootNavigateNested).not.toHaveBeenCalled();
  expect(clearLastNotificationResponseAsync).not.toHaveBeenCalled();
});

test('前景與冷啟動點本機提醒均直達作業，跨帳號只回課程頁', async () => {
  const real = jest.requireActual('../utils/notificationDestination') as typeof import('../utils/notificationDestination');
  mockResolve.mockImplementation(real.resolveNotificationDestination);
  const payload = { type: 'local_assignment_due_v2', uid: 'alice', schoolId: 'pu', groupId: 'course', assignmentId: 'work' };
  const response = { notification: { request: { identifier: 'local-work', content: { data: payload } } } };
  jest.mocked(notices.getLastNotificationResponseAsync).mockResolvedValueOnce(response as never).mockResolvedValueOnce(response as never);
  const view = renderHook(() => usePushNotifications({ current: null }, 'alice', 'student', 'pu'));
  await waitFor(() => expect(mockApply).toHaveBeenCalledWith(expect.objectContaining({
    screen: 'HomeworkSubmit', params: { groupId: 'course', assignmentId: 'work', fromReminder: true },
  }), { role: 'student' }));
  expect(notices.clearLastNotificationResponseAsync).toHaveBeenCalled();
  mockApply.mockClear();
  await act(async () => listeners[listeners.length - 1]!({
    notification: { request: { identifier: 'local-work-next', content: { data: payload } } },
  }));
  expect(mockApply).toHaveBeenCalledWith(expect.objectContaining({ screen: 'HomeworkSubmit' }), { role: 'student' });
  view.unmount();
  const other = renderHook(() => usePushNotifications({ current: null }, 'bob', 'student', 'pu'));
  await act(async () => listeners[listeners.length - 1]!(response));
  expect(mockApply).toHaveBeenLastCalledWith(expect.objectContaining({ screen: 'LearnHome' }), { role: 'student' });
  other.unmount();
});

const push = (id: string) => ({ notification: { request: {
  identifier: id, content: { data: { type: 'grade', gradeId: id, schoolId: 'pu' } },
} } });
const personal = { notification: { request: {
  identifier: 'nuni.assignment.due.token', content: { data: { category: 'nuni_assignment_due', lookupToken: 'token' } },
} } };
type NativeResponse = NonNullable<Awaited<ReturnType<typeof notices.getLastNotificationResponseAsync>>>;

function deferredLast() {
  let finish!: (response: NativeResponse) => void;
  jest.mocked(notices.getLastNotificationResponseAsync)
    .mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  return (response: ReturnType<typeof push>) => finish(response as NativeResponse);
}

test('a live personal tap prevents a delayed startup push from navigating or clearing the OS response', async () => {
  const finish = deferredLast();
  const view = renderHook(() => usePushNotifications({ current: null }, 'alice', 'student', 'pu'));
  await act(async () => { listeners[0]!(personal); finish(push('old')); });
  expect(mockResolve).not.toHaveBeenCalled();
  expect(notices.clearLastNotificationResponseAsync).not.toHaveBeenCalled();
  view.unmount();
});

test('opens only the latest school push when navigation becomes ready after a newer live tap', async () => {
  mockReady.mockReturnValue(false);
  const finish = deferredLast();
  const latest = push('latest');
  const view = renderHook(() => usePushNotifications({ current: null }, 'alice', 'student', 'pu'));
  await act(async () => { listeners[0]!(push('intermediate')); listeners[0]!(latest); });
  expect(mockResolve).not.toHaveBeenCalled();
  jest.mocked(notices.getLastNotificationResponseAsync).mockResolvedValue(latest as NativeResponse);
  mockReady.mockReturnValue(true);
  await act(async () => {
    mockReadyListeners.forEach((listener) => listener());
    mockReadyListeners.forEach((listener) => listener());
    finish(push('old'));
  });
  expect(mockResolve).toHaveBeenCalledTimes(1);
  expect(mockResolve).toHaveBeenCalledWith({ data: latest.notification.request.content.data }, { role: 'student', schoolId: 'pu' });
  expect(notices.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
  view.unmount();
});

test('a personal tap supersedes a queued generic push without clearing another handler’s response', async () => {
  mockReady.mockReturnValue(false);
  const view = renderHook(() => usePushNotifications({ current: null }, 'alice', 'student', 'pu'));
  await act(async () => { listeners[0]!(push('queued')); listeners[0]!(personal); });
  mockReady.mockReturnValue(true);
  await act(async () => { mockReadyListeners.forEach((listener) => listener()); });
  expect(mockResolve).not.toHaveBeenCalled();
  expect(notices.clearLastNotificationResponseAsync).not.toHaveBeenCalled();
  view.unmount();
});

test('a stale native read cannot clear the personal response that followed a restored generic push', async () => {
  const initial = push('restored');
  jest.mocked(notices.getLastNotificationResponseAsync).mockResolvedValueOnce(initial as NativeResponse);
  const finish = deferredLast();
  const view = renderHook(() => usePushNotifications({ current: null }, 'alice', 'student', 'pu'));
  await waitFor(() => expect(mockApply).toHaveBeenCalledTimes(1));
  await act(async () => { listeners[0]!(personal); finish(initial); });
  expect(notices.clearLastNotificationResponseAsync).not.toHaveBeenCalled();
  view.unmount();
});

test('clears only an exact OS response match even if a newer personal tap has not reached the listener', async () => {
  const initial = push('restored');
  jest.mocked(notices.getLastNotificationResponseAsync)
    .mockResolvedValueOnce(initial as NativeResponse)
    .mockResolvedValueOnce(personal as NativeResponse);
  const view = renderHook(() => usePushNotifications({ current: null }, 'alice', 'student', 'pu'));
  await waitFor(() => expect(mockApply).toHaveBeenCalledTimes(1));
  expect(notices.clearLastNotificationResponseAsync).not.toHaveBeenCalled();
  view.unmount();
});

test('a laundry alarm resumes the current screen and clears only its own tap on restore or resume', async () => {
  const alarm = (digit: string) => ({ notification: { request: {
    identifier: 'campus.dorm.laundry.v1.' + digit.repeat(64), content: { data: {} },
  } } }) as NativeResponse;
  jest.mocked(notices.getLastNotificationResponseAsync).mockResolvedValue(alarm('a'));
  const view = renderHook(() => usePushNotifications({ current: null }, 'alice', 'student', 'pu'));
  await waitFor(() => expect(notices.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1));
  expect(mockResolve).not.toHaveBeenCalled();
  expect(mockRootNavigateNested).not.toHaveBeenCalled();
  expect(mockApply).not.toHaveBeenCalled();

  jest.mocked(notices.getLastNotificationResponseAsync).mockResolvedValue(personal as NativeResponse);
  await act(async () => listeners[0]!(alarm('b')));
  expect(notices.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
  expect(mockResolve).not.toHaveBeenCalled();
  view.unmount();
});
