/**
 * Safe Navigate Helper — 防止未註冊 route 把 APP crash
 *
 * 用法：
 *   import { safeNavigate } from '../ui/safeNavigate';
 *   safeNavigate(nav, 'CourseDiscussion', { groupId: '123' });
 *
 * 若該 route 不存在，會：
 *   1. log 警告（dev 模式還會印出建議的 fallback）
 *   2. 用 Alert 友善提示「此功能正在開發中」
 *   3. 嘗試 fallback（例如 'CourseDiscussion' 找不到時試 'CourseHub'）
 */
import { Alert } from 'react-native';

const FALLBACK_ROUTES: Record<string, string> = {
  GroupDetail: 'CourseDiscussion',
  CourseDiscussion: 'CourseHub',
  CourseHub: 'CoursesHome',
  Companion: 'CompanionCollection',
  CompanionCollection: 'Companion',
  Constellation: 'Companion',
  Attendance: 'CourseHub',
  QuizCenter: 'CourseHub',
  CourseGradebook: 'CourseHub',
};

type AnyParams = Record<string, unknown>;

export function safeNavigate(nav: unknown, route: string, params?: AnyParams): boolean {
  if (!nav || typeof (nav as { navigate?: unknown }).navigate !== 'function') {
    console.warn(`[safeNavigate] no nav provided for route ${route}`);
    return false;
  }
  const navObj = nav as { navigate: (r: string, p?: AnyParams) => void };
  try {
    navObj.navigate(route, params);
    return true;
  } catch (e) {
    const fb = FALLBACK_ROUTES[route];
    console.warn(`[safeNavigate] '${route}' not handled${fb ? `, trying fallback '${fb}'` : ''}`, e);
    if (fb) {
      try {
        navObj.navigate(fb, params);
        return true;
      } catch (e2) {
        console.warn(`[safeNavigate] fallback '${fb}' also failed`, e2);
      }
    }
    Alert.alert(
      '此功能整修中',
      `「${route}」這個畫面目前還沒接上。下個版本就會出現。`,
    );
    return false;
  }
}

/**
 * 給 NavigationContainer onUnhandledAction 用的 listener。
 * 不阻擋預設行為，只記 log + 提示。
 */
export function logUnhandledNavigation(action: { type?: string; payload?: { name?: string } }) {
  const name = action?.payload?.name ?? '<unknown>';
  console.warn(`[Navigation] unhandled action ${action?.type} → '${name}'`);
  if (__DEV__) {
    console.warn(`[Navigation] 提示：到 LearnStack.tsx 或 MeStack.tsx 把 '${name}' 註冊進 Stack.Screen。`);
  }
}
