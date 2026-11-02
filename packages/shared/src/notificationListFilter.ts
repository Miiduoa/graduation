import { findSchoolById } from './schools';
import { toInternalSchoolId, toPublicSchoolId } from './schoolIds';

export type NotificationListMode = 'all' | 'unread';

export function notificationListFilter<T extends { read: boolean }>(
  rows: readonly T[],
  mode: NotificationListMode,
  unconfirmed: (row: T) => boolean = () => false,
): T[] {
  return rows.filter((row) => mode === 'all' || !row.read || unconfirmed(row));
}

export function notificationTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    announcement: '公告',
    event: '活動',
    group_post: '群組貼文',
    group_invite: '群組邀請',
    assignment: '作業',
    assignment_due: '作業提醒',
    homework: '作業',
    quiz: '測驗',
    grade: '成績',
    message: '私訊',
    system: '系統',
    friend_request: '好友邀請',
    friend_invite: '好友邀請',
    friend_accepted: '好友回覆',
    library_due: '借閱提醒',
  };
  return Object.prototype.hasOwnProperty.call(labels, type) ? labels[type] : '其他通知';
}

export function notificationCampusLabel(data?: Record<string, unknown>): string {
  const id = typeof data?.schoolId === 'string' ? data.schoolId.trim() : '';
  if (!id) return '未標示校園';
  const school = findSchoolById(toInternalSchoolId(id)) ?? findSchoolById(toPublicSchoolId(id));
  return school?.name ?? `校園（${id}）`;
}
