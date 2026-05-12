import type { UserRole } from '../data/types';

export type CourseNavigationRole = UserRole | 'guest' | 'department' | null | undefined;

export type NavigationLike = {
  navigate?: (name: string, params?: unknown) => void;
};

export type NavigationTarget = {
  tab: string;
  screen?: string;
  params?: Record<string, unknown>;
};

/**
 * 新導航 (4+1) 的 Tab 名稱集合。所有舊名都會被映射到這 5 個之一。
 */
const NEW_TAB_NAMES = new Set(['Today', '學習', '校園', '訊息', '我的']);

/**
 * 舊 Tab → 新 Tab 的映射：
 *   課程/教學/服務/審核/管理 → 學習
 *   收件匣 → 訊息
 *   其他維持
 */
export function migrateTabName(name: string | null | undefined): string {
  if (!name) return 'Today';
  if (NEW_TAB_NAMES.has(name)) return name;
  if (name === '課程' || name === '教學' || name === '服務' || name === '審核' || name === '管理') {
    return '學習';
  }
  if (name === '收件匣') return '訊息';
  return name;
}

function isCourseTabName(name: string | null | undefined): boolean {
  return name === '課程' || name === '教學' || name === '學習';
}

/**
 * 取得課程相關的根 Tab。新導航下，所有角色都使用 '學習'，
 * 內部由 LearnStack dispatcher 依角色選擇正確的首頁。
 */
export function getCourseRootTab(_role: CourseNavigationRole): '學習' {
  return '學習';
}

export function getRoleFallbackTab(_role: CourseNavigationRole): string {
  // 新導航：所有角色都從 'Today' fallback；管理/審核入口移到 HeaderDrawer
  return 'Today';
}

export function normalizeCourseScreen(
  role: CourseNavigationRole,
  screen?: string | null,
): string | undefined {
  // 新導航：所有角色的 LearnStack 都以 'LearnHome' 為首頁（內部 dispatcher 決定顯示內容）
  if (!screen || screen === 'CoursesHome' || screen === 'TeachingHub') {
    return 'LearnHome';
  }
  return screen;
}

export function buildCourseNavigationTarget(
  role: CourseNavigationRole,
  screen?: string | null,
  params?: Record<string, unknown>,
): NavigationTarget {
  const targetScreen = screen === 'CourseHub' && !params?.groupId ? undefined : screen;
  return {
    tab: '學習',
    screen: normalizeCourseScreen(role, targetScreen),
    params,
  };
}

export function buildNavigationTarget(
  role: CourseNavigationRole,
  tab: string,
  screen?: string | null,
  params?: Record<string, unknown>,
): NavigationTarget {
  const newTab = migrateTabName(tab);

  if (isCourseTabName(tab) || newTab === '學習') {
    return buildCourseNavigationTarget(role, screen, params);
  }

  return {
    tab: newTab,
    screen: screen ?? undefined,
    params,
  };
}

export function navigateToTarget(
  navigation: NavigationLike | null | undefined,
  target: NavigationTarget,
): void {
  if (!navigation?.navigate) return;

  // 攔截：AI Chat 已不是 Stack 內的 Screen，改用全域 overlay
  if (target.screen === 'AIChat' || target.screen === 'AIChatScreen') {
    try {
      // 動態 require 避開循環依賴
      const { aiOverlay } = require('../app/useAIOverlay');
      const tp = target.params && typeof target.params === 'object' ? target.params : undefined;
      const prompt =
        tp && typeof (tp as { prompt?: unknown }).prompt === 'string'
          ? (tp as { prompt: string }).prompt
          : undefined;
      const proactiveReportId =
        tp && typeof (tp as { proactiveReportId?: unknown }).proactiveReportId === 'string'
          ? (tp as { proactiveReportId: string }).proactiveReportId
          : undefined;
      aiOverlay.open({
        mode: 'chat',
        prompt,
        proactiveReportId,
        source: 'navigateToTarget',
      });
      return;
    } catch (err) {
      console.warn('[navigateToTarget] AI overlay redirect failed, falling back:', err);
    }
  }

  // 自動將任何舊 Tab 名稱遷移到新導航結構
  const tab = migrateTabName(target.tab);

  if (target.screen) {
    navigation.navigate(
      tab,
      target.params ? { screen: target.screen, params: target.params } : { screen: target.screen },
    );
    return;
  }

  navigation.navigate(tab, target.params);
}

export function navigateToCourseScreen(
  navigation: NavigationLike | null | undefined,
  role: CourseNavigationRole,
  screen?: string | null,
  params?: Record<string, unknown>,
): void {
  navigateToTarget(navigation, buildCourseNavigationTarget(role, screen, params));
}

export function navigateToCourseHome(
  navigation: NavigationLike | null | undefined,
  role: CourseNavigationRole,
  params?: Record<string, unknown>,
): void {
  navigateToCourseScreen(navigation, role, undefined, params);
}

export function navigateToCourseWorkspace(
  navigation: NavigationLike | null | undefined,
  role: CourseNavigationRole,
  params?: Record<string, unknown>,
): void {
  navigateToCourseScreen(navigation, role, params?.groupId ? 'CourseHub' : undefined, params);
}
