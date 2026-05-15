/**
 * Role-Based Access Control (RBAC) 角色權限管理系統
 *
 * 定義所有角色的權限對照表、功能開關、畫面存取規則
 */

// All possible permissions in the app
export type Permission =
  // Announcements
  | 'announcements.view'
  | 'announcements.create'
  | 'announcements.edit'
  | 'announcements.delete'
  // Courses
  | 'courses.view'
  | 'courses.create'
  | 'courses.manage'
  | 'courses.grade'
  | 'courses.attendance'
  | 'courses.catalog'
  // Campus
  | 'campus.map'
  | 'campus.cafeteria'
  | 'campus.library'
  | 'campus.bus'
  | 'campus.lostfound'
  | 'campus.lostfound.manage'
  // Facilities
  | 'facilities.manage'
  | 'facilities.orders'
  | 'facilities.repairs'
  | 'facilities.printing'
  // Groups/Social
  | 'groups.view'
  | 'groups.create'
  | 'groups.manage'
  // Messages
  | 'messages.view'
  | 'messages.send'
  // User
  | 'profile.view'
  | 'profile.edit'
  | 'achievements.view'
  // Admin
  | 'admin.dashboard'
  | 'admin.members'
  | 'admin.settings'
  | 'admin.analytics'
  | 'admin.course_verify'
  // Department
  | 'approval.workflows'
  | 'approval.reports'
  | 'approval.department';

export type AppRole =
  | 'student'
  | 'teacher'
  | 'professor'
  | 'staff'
  | 'department_head'
  | 'principal'
  | 'admin'
  | 'alumni'
  | 'department'
  | 'school'
  | 'vendor';

// Map roles to their effective role group for tab/feature decisions
export type RoleGroup = 'student' | 'teacher' | 'staff' | 'department_head' | 'admin';

export function getRoleGroup(role: AppRole): RoleGroup {
  switch (role) {
    case 'teacher':
    case 'professor':
      return 'teacher';
    case 'staff':
    case 'vendor':
      return 'staff';
    case 'department_head':
    case 'principal':
    case 'department':
      return 'department_head';
    case 'admin':
    case 'school':
      return 'admin';
    case 'student':
    case 'alumni':
    default:
      return 'student';
  }
}

// Permission matrix
const ROLE_PERMISSIONS: Record<RoleGroup, readonly Permission[]> = {
  student: [
    'announcements.view',
    'courses.view',
    'courses.catalog',
    'campus.map',
    'campus.cafeteria',
    'campus.library',
    'campus.bus',
    'campus.lostfound',
    'groups.view',
    'groups.create',
    'messages.view',
    'messages.send',
    'profile.view',
    'profile.edit',
    'achievements.view',
  ],
  teacher: [
    // Inherits all student permissions
    'announcements.view',
    'announcements.create',
    'announcements.edit',
    'courses.view',
    'courses.catalog',
    'courses.create',
    'courses.manage',
    'courses.grade',
    'courses.attendance',
    'campus.map',
    'campus.cafeteria',
    'campus.library',
    'campus.bus',
    'campus.lostfound',
    'groups.view',
    'groups.create',
    'groups.manage',
    'messages.view',
    'messages.send',
    'profile.view',
    'profile.edit',
    'achievements.view',
  ],
  staff: [
    'announcements.view',
    'courses.catalog',
    'campus.map',
    'campus.cafeteria',
    'campus.library',
    'campus.bus',
    'campus.lostfound',
    'campus.lostfound.manage',
    'facilities.manage',
    'facilities.orders',
    'facilities.repairs',
    'facilities.printing',
    'groups.view',
    'messages.view',
    'messages.send',
    'profile.view',
    'profile.edit',
  ],
  department_head: [
    // Inherits all teacher permissions PLUS approval
    'announcements.view',
    'announcements.create',
    'announcements.edit',
    'announcements.delete',
    'courses.view',
    'courses.catalog',
    'courses.create',
    'courses.manage',
    'courses.grade',
    'courses.attendance',
    'campus.map',
    'campus.cafeteria',
    'campus.library',
    'campus.bus',
    'campus.lostfound',
    'groups.view',
    'groups.create',
    'groups.manage',
    'messages.view',
    'messages.send',
    'profile.view',
    'profile.edit',
    'achievements.view',
    'approval.workflows',
    'approval.reports',
    'approval.department',
    'admin.analytics',
  ],
  admin: [
    // ALL permissions
    'announcements.view',
    'announcements.create',
    'announcements.edit',
    'announcements.delete',
    'courses.view',
    'courses.catalog',
    'courses.create',
    'courses.manage',
    'courses.grade',
    'courses.attendance',
    'campus.map',
    'campus.cafeteria',
    'campus.library',
    'campus.bus',
    'campus.lostfound',
    'campus.lostfound.manage',
    'facilities.manage',
    'facilities.orders',
    'facilities.repairs',
    'facilities.printing',
    'groups.view',
    'groups.create',
    'groups.manage',
    'messages.view',
    'messages.send',
    'profile.view',
    'profile.edit',
    'achievements.view',
    'admin.dashboard',
    'admin.members',
    'admin.settings',
    'admin.analytics',
    'admin.course_verify',
    'approval.workflows',
    'approval.reports',
    'approval.department',
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

import type { GeneratedButtonIconId } from '../ui/generatedButtonIcons';

// Tab configuration per role group
export type TabConfig = {
  key: string;
  label: string;
  /** 單一語意資產；焦點狀態以透明度區分 */
  icon: GeneratedButtonIconId;
};

/**
 * 新導航：4 個 Tab + 中央 AI 球（不是 Tab，是懸浮按鈕）。
 * Tab 名字在所有角色下統一；角色差異藏在「Tab 內部內容」與 AI 球可用工具。
 *
 * 順序：今天 | 學習 | [AI 球] | 校園 | 訊息
 * （AI 球以 placeholder 佔位，由 FloatingTabBar 在中央渲染懸浮 FAB）
 */
export const UNIFIED_TABS: TabConfig[] = [
  { key: 'Today', label: '今天', icon: 'ic_tab_today' },
  { key: '學習', label: '學習', icon: 'ic_tab_study' },
  { key: '校園', label: '校園', icon: 'ic_tab_campus' },
  { key: '訊息', label: '訊息', icon: 'ic_tab_messages' },
];

export function getTabsForRole(_role: AppRole): TabConfig[] {
  // 統一回傳同樣的 4 個 Tab，角色差異移到 Tab 內部處理
  return UNIFIED_TABS;
}

// Screen-level access control
export type ScreenName = string;

const PROTECTED_SCREENS: Record<ScreenName, Permission[]> = {
  AdminDashboard: ['admin.dashboard'],
  AdminCourseVerify: ['admin.course_verify'],
  AddCourse: ['courses.create'],
  /** 與 LearnStack GuardedAcademicOverview／成績／學業 AI 分頁對齊：需課程工作區 */
  AcademicOverview: ['courses.view'],
  Grades: ['courses.view'],
  AcademicInsights: ['courses.view'],
  CreditAuditStack: ['courses.view'],
  /** 選課助理：學生／教師為主；職員可走 AICourseAdvisor 僅在具 courses.catalog 時由畫面另行守門 */
  AICourseAdvisor: ['courses.catalog'],
  /** 與 LearnStack「學業總覽 / 課內成績簿」一致：學生需 courses.view；教師端另依 courses.grade 解鎖編修 */
  CourseGradebook: ['courses.view'],
  /** 課程工作區（與 LearnStack guardCourseView 對齊） */
  CourseHub: ['courses.view'],
  CourseModules: ['courses.view'],
  QuizCenter: ['courses.view'],
  /** 學生簽到／檢視出缺勤需 courses.view；教師操作點名需 courses.attendance */
  Attendance: ['courses.view', 'courses.attendance'],
  LearningAnalytics: ['admin.analytics', 'courses.manage'],
  /** 與 LearnStack GuardedTeacherGrading 對齊 */
  TeacherGrading: ['courses.grade', 'courses.manage'],
};

export function canAccessScreen(role: AppRole, screenName: ScreenName): boolean {
  const required = PROTECTED_SCREENS[screenName];
  if (!required) return true; // No restriction = open to all
  return hasAnyPermission(role, required);
}

// Get the initial route name based on role
// 新導航：所有角色都從「今天」開始；角色差異透過內容適配呈現
export function getInitialRoute(_role: AppRole): string {
  return 'Today';
}

// Role display names (Traditional Chinese)
export function getRoleDisplayName(role: AppRole): string {
  const names: Record<AppRole, string> = {
    student: '學生',
    teacher: '教師',
    professor: '教授',
    staff: '職員',
    department_head: '系所主管',
    principal: '系所主管',
    admin: '管理員',
    alumni: '校友',
    department: '系辦',
    school: '校方',
    vendor: '店家',
  };
  return names[role] ?? '使用者';
}

// Role badge color for UI
export function getRoleBadgeColor(role: AppRole): string {
  const colors: Record<RoleGroup, string> = {
    student: '#4A90D9',
    teacher: '#27AE60',
    staff: '#F39C12',
    department_head: '#8E44AD',
    admin: '#E74C3C',
  };
  return colors[getRoleGroup(role)];
}
