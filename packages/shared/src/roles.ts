/**
 * Single-source-of-truth 角色與權限定義
 * ----------------------------------------
 * 之前 codebase 有 5 套各自為政的角色 enum：
 *   - postLoginRoles.ResolvedAppRole（11 種）
 *   - auth.AuthRole / RoleGroup（5 種）
 *   - apps/web/src/lib/demoRole.DemoRole（8 種）
 *   - apps/web/src/app/lms-admin/role-matrix CourseRoleKey（4 種）
 *   - apps/mobile/src/services/permissions RoleGroup（6 種）
 *
 * 這個檔案是新的唯一權威。其他檔案應該逐步遷移過來，並以 `toCampusRole()` /
 * `toCourseRole()` 做雙向映射，避免欄位寫入 / 讀取對不上導致按鈕看似可點
 * 但 silently no-op（這正是「點了沒反應」的常見根因之一）。
 */

// ──────────────────────────────────────────────
// 校園層級角色（在整個 tenant 中的身分）
// ──────────────────────────────────────────────
export const CAMPUS_ROLES = [
  'student',
  'teacher',
  'professor',
  'ta', // 助教（後端展開為 course-level 的 'assistant'）
  'department_head',
  'principal',
  'admin',
  'staff',
  'alumni',
  'parent', // 家長：可看綁定的學生資料
  'vendor',
  'guest',
] as const;

export type CampusRole = (typeof CAMPUS_ROLES)[number];

export function isCampusRole(value: unknown): value is CampusRole {
  return typeof value === 'string' && (CAMPUS_ROLES as readonly string[]).includes(value);
}

// ──────────────────────────────────────────────
// 課程層級角色（在單一 course/group 中的身分）
// ──────────────────────────────────────────────
export const COURSE_ROLES = [
  'teacher', // 授課教師 = 過去 codebase 中混用的 owner / instructor
  'assistant', // 助教 / TA = 過去混用的 ta
  'moderator', // 課程版主 / 旁聽協助
  'student',
] as const;

export type CourseRole = (typeof COURSE_ROLES)[number];

export function isCourseRole(value: unknown): value is CourseRole {
  return typeof value === 'string' && (COURSE_ROLES as readonly string[]).includes(value);
}

// ──────────────────────────────────────────────
// 映射：把雜亂的歷史值（postLogin / demoRole / Firestore）
// 收斂回 CampusRole
// ──────────────────────────────────────────────
const LEGACY_CAMPUS_ALIAS: Record<string, CampusRole> = {
  // postLoginRoles.ResolvedAppRole 的歷史值
  student: 'student',
  teacher: 'teacher',
  professor: 'professor',
  department_head: 'department_head',
  principal: 'principal',
  admin: 'admin',
  staff: 'staff',
  alumni: 'alumni',
  vendor: 'vendor',
  department: 'department_head', // 舊資料把系/院寫成 department，照映到系主任
  school: 'admin', // 舊資料的 school-level 視為 admin
  // demoRole 額外值
  ta: 'ta',
  club_officer: 'student', // 社團幹部本質仍是 student，cap 另外給
  guest: 'guest',
  // 課程角色被誤寫到 user.primaryRole 時也吸收回來
  owner: 'teacher',
  instructor: 'teacher',
  assistant: 'ta',
  moderator: 'staff',
  // 中文 / 縮寫
  '學生': 'student',
  '老師': 'teacher',
  '教師': 'teacher',
  '管理員': 'admin',
  '系主任': 'department_head',
  '校長': 'principal',
  '校友': 'alumni',
  '家長': 'parent',
  '訪客': 'guest',
};

/** 寬鬆 parse 一個可能來自任何歷史來源的值，落地成 CampusRole；未知值回傳 null。 */
export function toCampusRole(value: unknown): CampusRole | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  if (isCampusRole(v)) return v;
  const lower = v.toLowerCase();
  if (isCampusRole(lower)) return lower;
  return LEGACY_CAMPUS_ALIAS[v] ?? LEGACY_CAMPUS_ALIAS[lower] ?? null;
}

/** 同上但有 fallback，常用於 SSR 預設值。 */
export function toCampusRoleOr(value: unknown, fallback: CampusRole = 'guest'): CampusRole {
  return toCampusRole(value) ?? fallback;
}

// ──────────────────────────────────────────────
// 映射：CampusRole → CourseRole（同一人預設的課程角色）
// 注意：實際課程角色仍應以 groups/{courseId}/members/{uid}.role 為準，
// 此映射只用在「使用者剛加入課程、尚未指定角色」的預設值。
// ──────────────────────────────────────────────
export function defaultCourseRoleFor(campusRole: CampusRole): CourseRole {
  switch (campusRole) {
    case 'teacher':
    case 'professor':
    case 'principal':
    case 'department_head':
      return 'teacher';
    case 'ta':
      return 'assistant';
    case 'admin':
    case 'staff':
      return 'moderator';
    case 'student':
    case 'alumni':
    case 'parent':
    case 'vendor':
    case 'guest':
    default:
      return 'student';
  }
}

const LEGACY_COURSE_ALIAS: Record<string, CourseRole> = {
  owner: 'teacher',
  instructor: 'teacher',
  teacher: 'teacher',
  professor: 'teacher',
  ta: 'assistant',
  assistant: 'assistant',
  moderator: 'moderator',
  member: 'student',
  student: 'student',
  auditor: 'student',
};

export function toCourseRole(value: unknown): CourseRole | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (isCourseRole(v)) return v;
  return LEGACY_COURSE_ALIAS[v] ?? null;
}

// ──────────────────────────────────────────────
// 能力（Capability）— 跨 web / mobile 共用的最小集合
// ──────────────────────────────────────────────
export const CAMPUS_CAPABILITIES = [
  'courses.view',
  'courses.edit',
  'assignment.submit',
  'assignment.grade',
  'grade.publish',
  'grade.viewSelf',
  'grade.viewLinkedChild', // 家長
  'attendance.mark',
  'attendance.viewSelf',
  'attendance.viewLinkedChild',
  'admin.dashboard',
  'admin.course_verify',
  'admin.role_matrix',
  'role.assume', // demo / 開發切換角色
  'teacher.dashboard',
  'achievements.view',
] as const;

export type CampusCapability = (typeof CAMPUS_CAPABILITIES)[number];

/**
 * 預設能力表 — 細粒度權限仍應該到 Supabase course_role_capabilities /
 * Firestore rules 校驗，此處只是 UI 層的第一道閘，避免把點不動的按鈕渲染給沒權限的角色。
 */
export const DEFAULT_ROLE_CAPABILITIES: Record<CampusRole, ReadonlyArray<CampusCapability>> = {
  student: [
    'courses.view',
    'assignment.submit',
    'grade.viewSelf',
    'attendance.viewSelf',
    'achievements.view',
  ],
  teacher: [
    'courses.view',
    'courses.edit',
    'assignment.grade',
    'grade.publish',
    'attendance.mark',
    'teacher.dashboard',
    'achievements.view',
  ],
  professor: [
    'courses.view',
    'courses.edit',
    'assignment.grade',
    'grade.publish',
    'attendance.mark',
    'teacher.dashboard',
    'achievements.view',
  ],
  ta: [
    'courses.view',
    'assignment.grade',
    'attendance.mark',
    'teacher.dashboard',
    'achievements.view',
  ],
  department_head: [
    'courses.view',
    'teacher.dashboard',
    'admin.course_verify',
    'achievements.view',
  ],
  principal: [
    'courses.view',
    'teacher.dashboard',
    'admin.dashboard',
    'admin.course_verify',
    'achievements.view',
  ],
  admin: [
    'courses.view',
    'courses.edit',
    'assignment.grade',
    'grade.publish',
    'attendance.mark',
    'admin.dashboard',
    'admin.course_verify',
    'admin.role_matrix',
    'role.assume',
    'teacher.dashboard',
    'achievements.view',
  ],
  staff: ['courses.view', 'achievements.view'],
  alumni: ['achievements.view'],
  parent: ['grade.viewLinkedChild', 'attendance.viewLinkedChild'],
  vendor: [],
  guest: [],
};

export function hasCapability(role: CampusRole, cap: CampusCapability): boolean {
  return DEFAULT_ROLE_CAPABILITIES[role]?.includes(cap) ?? false;
}

/**
 * 多身分用：使用者可能同時是 teacher + department_head；只要其中一個有此能力即可。
 */
export function anyRoleHasCapability(roles: ReadonlyArray<CampusRole>, cap: CampusCapability): boolean {
  for (const r of roles) {
    if (hasCapability(r, cap)) return true;
  }
  return false;
}

// ──────────────────────────────────────────────
// 跨角色資料關聯（為了讓 backend / frontend 對得起來）
// ──────────────────────────────────────────────

/**
 * 各 entity 主鍵欄位名稱 — 統一用 camelCase。
 * 後端如果是 Supabase / Postgres 需要 snake_case，請在 adapter 層轉換。
 */
export const ENTITY_KEYS = {
  user: { primary: 'uid' as const },
  course: { primary: 'courseId' as const },
  assignment: { primary: 'assignmentId' as const, parent: 'courseId' as const },
  submission: {
    primary: 'submissionId' as const,
    parent: 'assignmentId' as const,
    actor: 'studentId' as const,
  },
  gradebookEntry: {
    primary: 'gradeId' as const,
    parent: 'courseId' as const,
    actor: 'studentId' as const,
    optionalRef: 'assignmentId' as const,
  },
  attendance: {
    primary: 'attendanceId' as const,
    parent: 'courseId' as const,
    actor: 'studentId' as const,
  },
  parentLink: {
    primary: 'linkId' as const,
    parent: 'parentUid' as const,
    actor: 'studentUid' as const,
  },
} as const;

/**
 * Cross-role action contract — 描述「誰可以做、寫到哪、誰看得到」。
 * 比 actionGraph.ts 更精簡，目的是讓 reviewer 一眼看出資料流向。
 */
export type CrossRoleAction = {
  id: string;
  doer: CampusRole | CampusRole[];
  capability: CampusCapability;
  writes: ReadonlyArray<keyof typeof ENTITY_KEYS>;
  /** 誰能讀到結果（用於 RLS / Firestore rules 對齊） */
  readers: ReadonlyArray<CampusRole>;
};

export const CROSS_ROLE_ACTIONS: ReadonlyArray<CrossRoleAction> = [
  {
    id: 'teacher.createAssignment',
    doer: ['teacher', 'professor', 'ta'],
    capability: 'courses.edit',
    writes: ['assignment'],
    readers: ['teacher', 'professor', 'ta', 'student', 'department_head', 'admin'],
  },
  {
    id: 'student.submitAssignment',
    doer: 'student',
    capability: 'assignment.submit',
    writes: ['submission'],
    readers: ['student', 'teacher', 'professor', 'ta'], // 同學不應看到他人 submission
  },
  {
    id: 'teacher.gradeAssignment',
    doer: ['teacher', 'professor', 'ta'],
    capability: 'assignment.grade',
    writes: ['gradebookEntry'],
    readers: ['teacher', 'professor', 'ta', 'department_head', 'admin'],
  },
  {
    id: 'teacher.publishGrades',
    doer: ['teacher', 'professor'],
    capability: 'grade.publish',
    writes: ['gradebookEntry'],
    readers: [
      'teacher',
      'professor',
      'ta',
      'student', // 學生只能看自己的（由 RLS 篩）
      'parent', // 家長看自己的子女
      'department_head',
      'admin',
    ],
  },
  {
    id: 'teacher.markAttendance',
    doer: ['teacher', 'professor', 'ta'],
    capability: 'attendance.mark',
    writes: ['attendance'],
    readers: [
      'teacher',
      'professor',
      'ta',
      'student',
      'parent',
      'department_head',
      'admin',
    ],
  },
];

/** Helper：找出某個 capability 對應的所有 action（供前端 disabled-state 用） */
export function findActionsForCapability(cap: CampusCapability): ReadonlyArray<CrossRoleAction> {
  return CROSS_ROLE_ACTIONS.filter((a) => a.capability === cap);
}
