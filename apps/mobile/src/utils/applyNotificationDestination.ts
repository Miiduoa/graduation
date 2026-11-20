import { rootNavigateNested, rootNavigationRef } from '../app/rootNavigation';
import { navigateFromInboxTask } from '../services/inboxActions';
import { isTeachingRole } from './campusOs';
import type { UserRole } from '../data/types';
import type { NotificationDestination } from './notificationDestination';

type NavigationLike = {
  navigate?: (route: string, params?: unknown) => void;
} | null;

/**
 * 執行已驗證的通知目的地。nested 一律走 rootNavigationRef；
 * inboxTask 優先使用呼叫端提供的 navigation（螢幕內），否則退回 root。
 */
export function applyNotificationDestination(
  destination: Extract<NotificationDestination, { ok: true }>,
  options?: {
    navigation?: NavigationLike;
    role?: UserRole | null;
  },
): boolean {
  if (destination.mode === 'nested') {
    return rootNavigateNested(destination.tab, destination.screen, destination.params) !== false;
  }
  const nav = options?.navigation ?? rootNavigationRef;
  return !!navigateFromInboxTask(nav as never, destination.task, {
    role: options?.role,
    isTeachingRole: isTeachingRole(options?.role),
  });
}
