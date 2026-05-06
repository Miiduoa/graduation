import type { UserRole } from "../data/types";

export type CourseNavigationRole = UserRole | "guest" | "department" | null | undefined;

export type NavigationLike = {
  navigate?: (name: string, params?: unknown) => void;
};

export type NavigationTarget = {
  tab: string;
  screen?: string;
  params?: Record<string, unknown>;
};

function isCourseTabName(name: string | null | undefined): boolean {
  return name === "課程" || name === "教學";
}

export function getCourseRootTab(role: CourseNavigationRole): "課程" | "教學" | null {
  if (role === "teacher" || role === "professor") return "教學";
  if (!role || role === "guest" || role === "student" || role === "alumni") return "課程";
  return null;
}

export function getRoleFallbackTab(role: CourseNavigationRole): string {
  if (role === "admin") return "管理";
  if (role === "principal" || role === "department") return "審核";
  if (role === "staff") return "服務";
  return "Today";
}

export function normalizeCourseScreen(
  role: CourseNavigationRole,
  screen?: string | null,
): string | undefined {
  const rootTab = getCourseRootTab(role);
  if (!rootTab) return undefined;

  if (!screen) {
    return rootTab === "教學" ? "TeachingHub" : "CoursesHome";
  }

  if (rootTab === "教學" && screen === "CoursesHome") return "TeachingHub";
  if (rootTab === "課程" && screen === "TeachingHub") return "CoursesHome";
  return screen;
}

export function buildCourseNavigationTarget(
  role: CourseNavigationRole,
  screen?: string | null,
  params?: Record<string, unknown>,
): NavigationTarget {
  const rootTab = getCourseRootTab(role);
  if (!rootTab) {
    return { tab: getRoleFallbackTab(role) };
  }

  const targetScreen = screen === "CourseHub" && !params?.groupId ? undefined : screen;

  return {
    tab: rootTab,
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
  if (isCourseTabName(tab)) {
    return buildCourseNavigationTarget(role, screen, params);
  }

  return {
    tab,
    screen: screen ?? undefined,
    params,
  };
}

export function navigateToTarget(navigation: NavigationLike | null | undefined, target: NavigationTarget): void {
  if (!navigation?.navigate) return;

  if (target.screen) {
    navigation.navigate(
      target.tab,
      target.params
        ? { screen: target.screen, params: target.params }
        : { screen: target.screen },
    );
    return;
  }

  navigation.navigate(target.tab, target.params);
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
  navigateToCourseScreen(
    navigation,
    role,
    params?.groupId ? "CourseHub" : undefined,
    params,
  );
}
