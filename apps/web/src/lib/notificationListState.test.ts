import { expect, it } from 'vitest';
import type { AccountNotification } from './privateMessages';
import {
  DEFAULT_NOTIFICATION_FILTERS,
  filterNotifications,
  readNotificationListFilters,
} from './notificationListState';

function notice(type: string, patch: Partial<AccountNotification> = {}): AccountNotification {
  return {
    id: type,
    source: 'user',
    type,
    title: '新的通知',
    body: '需要處理的內容',
    read: false,
    createdAt: null,
    data: { schoolId: 'pu' },
    ...patch,
  };
}

it('combines unread, category and normalized text filters while preserving server order', () => {
  const rows = [
    notice('grade', { title: '資料庫 LAB 成績' }),
    notice('assignment_submission', { body: '資料庫 LAB 繳交', read: true }),
    notice('order', { title: 'LAB 午餐' }),
    notice('live_session', { body: 'Lab 點名開始' }),
  ];
  expect(
    filterNotifications(rows, { q: '  ｌａｂ  ', category: 'course', onlyUnread: true }),
  ).toEqual([rows[0], rows[3]]);
  expect(rows).toHaveLength(4);
  expect(rows[1].read).toBe(true);
});

it.each([
  ['order', '訂單與取餐'],
  ['leave', '請假'],
  ['feedback', '課業回饋'],
  ['live_session', '課堂點名'],
  ['assignment_submission', '待批改作業'],
  ['material', '教材'],
  ['unread_material', '未讀教材'],
  ['course_material', '教材'],
])('searches the displayed %s type label', (type, label) => {
  const row = notice(type);
  expect(filterNotifications([row], { ...DEFAULT_NOTIFICATION_FILTERS, q: label })).toEqual([row]);
});

it('includes unfamiliar notification types in the other category', () => {
  const rows = [notice('future-service'), notice('__proto__'), notice('system'), notice('event')];
  expect(filterNotifications(rows, { ...DEFAULT_NOTIFICATION_FILTERS, category: 'other' })).toEqual(
    rows.slice(0, 3),
  );
});

it.each([null, [], 'saved text', { q: 10, category: 'unknown', onlyUnread: 'true' }])(
  'restores defaults for malformed saved filters %j',
  (value) => {
    expect(readNotificationListFilters(value)).toEqual(DEFAULT_NOTIFICATION_FILTERS);
  },
);

it('limits restored search text and accepts only supported controls', () => {
  expect(
    readNotificationListFilters({
      q: '\u0000' + '學'.repeat(210),
      category: 'services',
      onlyUnread: true,
    }),
  ).toEqual({ q: '學'.repeat(200), category: 'services', onlyUnread: true });
});
