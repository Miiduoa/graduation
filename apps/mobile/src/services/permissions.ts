 
/**
 * Role-Based Access Control (RBAC) 角色權限管理系統
 *
 * 定義所有角色的權限對照表、功能開關、畫面存取規則
 */

// All possible permissions in the app
export type Permission =
  // Announcements
  | "announcements.view"
  | "announcements.create"
  | "announcements.edit"
  | "announcements.delete"
  // Courses
  | "courses.view"
  | "courses.create"
  | "courses.manage"
  | "courses.grade"
  | "courses.attendance"
  // Campus
  | "campus.map"
  | "campus.cafeteria"
  | "campus.library"
  | "campus.bus"
  | "campus.lostfound"
  | "campus.lostfound.manage"
  // Facilities
  | "facilities.manage"
  | "facilities.orders"
  | "facilities.repairs"
  | "facilities.printing"
  // Groups/Social
  | "groups.view"
  | "groups.create"
  | "groups.manage"
  // Messages
  | "messages.view"
  | "messages.send"
  // User
  | "profile.view"
  | "profile.edit"
  | "achievements.view"
  // Admin
  | "admin.dashboard"
  | "admin.members"
  | "admin.settings"
  | "admin.analytics"
  | "admin.course_verify"
  // Department
  | "approval.workflows"
  | "approval.reports"
  | "approval.department";

export type AppRole = "student" | "teacher" | "professor" | "staff" | "principal" | "admin" | "alumni";

// Map roles to their effective role group for tab/feature decisions
export type RoleGroup = "student" | "teacher" | "staff" | "department_head" | "admin";

export function getRoleGroup(role: AppRole): RoleGroup {
  switch (role) {
    case "teacher":
    case "professor":
      return "teacher";
    case "staff":
      return "staff";
    case "principal":
      return "department_head";
    case "admin":
      return "admin";
    case "student":
    case "alumni":
    default:
      return "student";
  }
}

// Permission matrix
const ROLE_PERMISSIONS: Record<RoleGroup, readonly Permission[]> = {
  student: [
    "announcements.view",
    "courses.view",
    "campus.map",
    "campus.cafeteria",
    "campus.library",
    "campus.bus",
    "campus.lostfound",
    "groups.view",
    "groups.create",
    "messages.view",
    "messages.send",
    "profile.view",
    "profile.edit",
    "achievements.view",
  ],
  teacher: [
    // Inherits all student permissions
    "announcements.view",
    "announcements.create",
    "announcements.edit",
    "courses.view",
    "courses.create",
    "courses.manage",
    "courses.grade",
    "courses.attendance",
    "campus.map",
    "campus.cafeteria",
    "campus.library",
    "campus.bus",
    "campus.lostfound",
    "groups.view",
    "groups.create",
    "groups.manage",
    "messages.view",
    "messages.send",
    "profile.view",
    "profile.edit",
    "achievements.view",
  ],
  staff: [
    "announcements.view",
    "campus.map",
    "campus.cafeteria",
    "campus.library",
    "campus.bus",
    "campus.lostfound",
    "campus.lostfound.manage",
    "facilities.manage",
    "facilities.orders",
    "facilities.repairs",
    "facilities.printing",
    "groups.view",
    "messages.view",
    "messages.send",
    "profile.view",
    "profile.edit",
  ],
  department_head: [
    // Inherits all teacher permissions PLUS approval
    "announcements.view",
    "announcements.create",
    "announcements.edit",
    "announcements.delete",
    "courses.view",
    "courses.create",
    "courses.manage",
    "courses.grade",
    "courses.attendance",
    "campus.map",
    "campus.cafeteria",
    "campus.library",
    "campus.bus",
    "campus.lostfound",
    "groups.view",
    "groups.create",
    "groups.manage",
    "messages.view",
    "messages.send",
    "profile.view",
    "profile.edit",
    "achievements.view",
    "approval.workflows",
    "approval.reports",
    "approval.department",
    "admin.analytics",
  ],
  admin: [
    // ALL permissions
    "announcements.view",
    "announcements.create",
    "announcements.edit",
    "announcements.delete",
    "courses.view",
    "courses.create",
    "courses.manage",
    "courses.grade",
    "courses.attendance",
    "campus.map",
    "campus.cafeteria",
    "campus.library",
    "campus.bus",
    "campus.lostfound",
    "campus.lostfound.manage",
    "facilities.manage",
    "facilities.orders",
    "facilities.repairs",
    "facilities.printing",
    "groups.view",
    "groups.create",
    "groups.manage",
    "messages.view",
    "messages.send",
    "profile.view",
    "profile.edit",
    "achievements.view",
    "admin.dashboard",
    "admin.members",
    "admin.settings",
    "admin.analytics",
    "admin.course_verify",
    "approval.workflows",
    "approval.reports",
    "approval.department",
  ],
};

export function getPermissions(role: AppRole): readonly Permission[] {
  return ROLE_PERMISSIONS[getRoleGroup(role)];
}

export function hasPermission(role: AppRole, permission: Permission): boolean {
  return getPermissions(role).includes(permission);
}

export function hasAnyPermission(role: AppRole, permissions: Permission[]): boolean {
  const userPerms = getPermissions(role);
  return permissions.some((p) => userPerms.includes(p));
}

export function hasAllPermissions(role: AppRole, permissions: Permission[]): boolean {
  const userPerms = getPermissions(role);
  return permissions.every((p) => userPerms.includes(p));
}

// Tab configuration per role group
export type TabConfig = {
  key: string;
  label: string;
  icon: { active: string; inactive: string };
};

export function getTabsForRole(role: AppRole): TabConfig[] {
  const roleGroup = getRoleGroup(role);

  const sharedBefore: TabConfig[] = [
    { key: "Today", label: "Today", icon: { active: "sunny", inactive: "sunny-outline" } },
  ];

  const sharedAfter: TabConfig[] = [
    { key: "校園", label: "校園", icon: { active: "map", inactive: "map-outline" } },
    { key: "收件匣", label: "收件匣", icon: { active: "mail", inactive: "mail-outline" } },
    { key: "我的", label: "我的", icon: { active: "person-circle", inactive: "person-circle-outline" } },
  ];

  const roleTab: TabConfig = (() => {
    switch (roleGroup) {
      case "teacher":
        return { key: "教學", label: "教學", icon: { active: "school", inactive: "school-outline" } };
      case "staff":
        return { key: "服務", label: "服務", icon: { active: "construct", inactive: "construct-outline" } };
      case "department_head":
        return { key: "審核", label: "審核", icon: { active: "checkmark-circle", inactive: "checkmark-circle-outline" } };
      case "admin":
        return { key: "管理", label: "管理", icon: { active: "shield-checkmark", inactive: "shield-checkmark-outline" } };
      case "student":
      default:
        return { key: "課程", label: "課程", icon: { active: "book", inactive: "book-outline" } };
    }
  })();

  return [...sharedBefore, roleTab, ...sharedAfter];
}

// Screen-level access control
export type ScreenName = string;

const PROTECTED_SCREENS: Record<ScreenName, Permission[]> = {
  AdminDashboard: ["admin.dashboard"],
  AdminCourseVerify: ["admin.course_verify"],
  AddCourse: ["courses.create"],
  CourseGradebook: ["courses.grade"],
  Attendance: ["courses.attendance"],
  LearningAnalytics: ["admin.analytics", "courses.manage"],
};

export function canAccessScreen(role: AppRole, screenName: ScreenName): boolean {
  const required = PROTECTED_SCREENS[screenName];
  if (!required) return true; // No restriction = open to all
  return hasAnyPermission(role, required);
}

// Get the initial route name based on role
export function getInitialRoute(role: AppRole): string {
  const roleGroup = getRoleGroup(role);
  switch (roleGroup) {
    case "admin":
      return "管理";
    case "department_head":
      return "審核";
    case "teacher":
      return "教學";
    case "staff":
      return "服務";
    default:
      return "Today";
  }
}

// Role display names (Traditional Chinese)
export function getRoleDisplayName(role: AppRole): string {
  const names: Record<AppRole, string> = {
    student: "學生",
    teacher: "教師",
    professor: "教授",
    staff: "職員",
    principal: "系所主管",
    admin: "管理員",
    alumni: "校友",
  };
  return names[role] ?? "使用者";
}

// Role badge color for UI
export function getRoleBadgeColor(role: AppRole): string {
  const colors: Record<RoleGroup, string> = {
    student: "#4A90D9",
    teacher: "#27AE60",
    staff: "#F39C12",
    department_head: "#8E44AD",
    admin: "#E74C3C",
  };
  return colors[getRoleGroup(role)];
}
