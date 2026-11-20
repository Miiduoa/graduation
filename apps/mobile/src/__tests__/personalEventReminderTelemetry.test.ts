import * as Notifications from 'expo-notifications';
import { trackEvent } from '../services/analytics';
import {
  addNotificationReceivedListener,
  addNotificationResponseReceivedListener,
} from '../services/notifications';
import { PERSONAL_EVENT_REMINDER_TYPE } from '../services/personalEventReminderModel';

jest.mock('../services/analytics', () => ({ trackEvent: jest.fn() }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
}));

test.each([
  [{ category: 'nuni_assignment_due', lookupToken: 'private-lookup' }, 'nuni_assignment_reminder_local'],
  [{ type: PERSONAL_EVENT_REMINDER_TYPE, v: 1, t: 'tok', g: 1 }, 'personal_event_reminder_local'],
  [{ category: 'personal_class_occurrence', scope: 'private-owner', courseId: 'private-course', startAt: 123 }, 'personal_class_reminder_local'],
] as const)('personal reminder receipt and click telemetry omit title and payload', (data, category) => {
  jest.clearAllMocks();
  const receivedHandlers: Array<(notification: unknown) => void> = [];
  const responseHandlers: Array<(response: unknown) => void> = [];
  (Notifications.addNotificationReceivedListener as jest.Mock).mockImplementation((cb) => {
    receivedHandlers.push(cb);
    return { remove: jest.fn() };
  });
  (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockImplementation((cb) => {
    responseHandlers.push(cb);
    return { remove: jest.fn() };
  });

  addNotificationReceivedListener(() => undefined);
  addNotificationResponseReceivedListener(() => undefined);

  receivedHandlers[0]!({
    request: { content: { title: '個人行程提醒', data } },
  });
  responseHandlers[0]!({
    actionIdentifier: 'default',
    notification: { request: { content: { title: '個人行程提醒', data } } },
  });

  expect(trackEvent).toHaveBeenCalledWith('notification_received', {
    category,
  });
  expect(trackEvent).toHaveBeenCalledWith('notification_clicked', {
    category,
  });
  const serialized = JSON.stringify((trackEvent as jest.Mock).mock.calls);
  expect(serialized).not.toContain('tok');
  expect(serialized).not.toContain('private-');
  expect(serialized).not.toContain('個人行程提醒');
});
