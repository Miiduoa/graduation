import {
  notificationListFilter,
  notificationTypeLabel,
} from '@campus/shared/src/notificationListFilter';
import type { AccountNotification } from './privateMessages';
import { listSearchText } from './serviceListNavigation';

type NotificationCategory = 'all' | 'course' | 'campus' | 'social' | 'services' | 'other';
export type NotificationListFilters = {
  q: string;
  category: NotificationCategory;
  onlyUnread: boolean;
};

export const NOTIFICATION_CATEGORIES: ReadonlyArray<{
  value: NotificationCategory;
  label: string;
  types: readonly string[];
}> = [
  { value: 'all', label: '全部類型', types: [] },
  {
    value: 'course',
    label: '課業與點名',
    types: [
      'assignment',
      'assignment_due',
      'homework',
      'quiz',
      'grade',
      'feedback',
      'material',
      'unread_material',
      'course_material',
      'live_session',
      'assignment_submission',
    ],
  },
  { value: 'campus', label: '公告與活動', types: ['announcement', 'event'] },
  {
    value: 'social',
    label: '訊息與邀請',
    types: [
      'message',
      'group_post',
      'group_invite',
      'friend_request',
      'friend_invite',
      'friend_accepted',
    ],
  },
  { value: 'services', label: '訂單與生活', types: ['order', 'leave', 'library_due'] },
  { value: 'other', label: '其他通知', types: ['system'] },
];

export const DEFAULT_NOTIFICATION_FILTERS: NotificationListFilters = {
  q: '',
  category: 'all',
  onlyUnread: false,
};

export function readNotificationListFilters(value: unknown): NotificationListFilters {
  const saved =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const category = NOTIFICATION_CATEGORIES.find((item) => item.value === saved.category)?.value;
  return {
    q: typeof saved.q === 'string' ? listSearchText(saved.q) : '',
    category: category ?? 'all',
    onlyUnread: saved.onlyUnread === true,
  };
}

export function filterNotifications(
  rows: readonly AccountNotification[],
  filters: NotificationListFilters,
): AccountNotification[] {
  const needle = filters.q.trim().normalize('NFKC').toLowerCase();
  return notificationListFilter(rows, filters.onlyUnread ? 'unread' : 'all').filter((row) => {
    const category =
      NOTIFICATION_CATEGORIES.find((item) => item.types.includes(row.type))?.value ?? 'other';
    const text = `${row.title}\n${row.body}\n${notificationTypeLabel(row.type)}`
      .normalize('NFKC')
      .toLowerCase();
    return (filters.category === 'all' || filters.category === category) && text.includes(needle);
  });
}
