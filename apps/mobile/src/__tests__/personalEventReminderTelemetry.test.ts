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

test('personal reminder receipt and click telemetry omit title and payload', () => {
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

  const data = { type: PERSONAL_EVENT_REMINDER_TYPE, v: 1, t: 'tok', g: 1 };
  receivedHandlers[0]!({
    request: { content: { title: '個人行程提醒', data } },
  });
  responseHandlers[0]!({
    actionIdentifier: 'default',
    notification: { request: { content: { title: '個人行程提醒', data } } },
  });

  expect(trackEvent).toHaveBeenCalledWith('notification_received', {
    category: 'personal_event_reminder_local',
  });
  expect(trackEvent).toHaveBeenCalledWith('notification_clicked', {
    category: 'personal_event_reminder_local',
  });
  const serialized = JSON.stringify((trackEvent as jest.Mock).mock.calls);
  expect(serialized).not.toContain('tok');
  expect(serialized).not.toContain('個人行程提醒');
});
