import {
  notificationListFilter,
  notificationTypeLabel,
  notificationCampusLabel,
} from '@campus/shared/src/notificationListFilter';

test('filters without reordering or mutating and retains unconfirmed writes', () => {
  const rows = [
    { id: 'a', read: true },
    { id: 'b', read: false },
    { id: 'c', read: true },
  ];
  expect(notificationListFilter(rows, 'unread', (row) => row.id === 'a')).toEqual(rows.slice(0, 2));
  expect(notificationListFilter(rows, 'all')).toEqual(rows);
  expect(rows[0].read).toBe(true);
  expect(notificationListFilter([], 'unread')).toEqual([]);
});

test('labels actual source without assuming the current campus', () => {
  expect(notificationCampusLabel()).toBe('未標示校園');
  expect(notificationCampusLabel({ schoolId: 'unknown-campus' })).toBe('校園（unknown-campus）');
  expect(notificationCampusLabel({ schoolId: 'pu' })).toBe(
    notificationCampusLabel({ schoolId: 'tw-pu' }),
  );
  expect(notificationTypeLabel('assignment')).toBe('作業');
  expect(notificationTypeLabel('new-type')).toBe('其他通知');
  expect(notificationTypeLabel('__proto__')).toBe('其他通知');
});
