/**
 * Demo Session Helper — 給 mobile demo 用的小工具集
 *
 * 目的：把所有 screen 散落的 `if (!auth.user) 顯示請先登入` 邏輯統一處理。
 *  - demo 帳號永遠視為「已登入」，screen 不該再顯示「請先登入」
 *  - 角色與 demo uid 之間有明確映射（避免亂用 demo uid）
 *
 * 與 state/auth.tsx 的關係：
 *  - auth.user / auth.profile 在 demo 模式下永遠非 null（由 toMockUserProfile 保證）
 *  - 但有些 screen 用 `if (!user) return '請先登入'` 早期返回，
 *    這個 helper 提供一個語意更清楚的 API 讓 screen 改寫
 */

import type { UserRole } from '../data/types';

const DEMO_UID_PREFIX = 'demo_';

/** 判斷 uid 是否為 demo 帳號 */
export function isDemoUid(uid: string | null | undefined): boolean {
  return typeof uid === 'string' && uid.startsWith(DEMO_UID_PREFIX);
}

/**
 * 把 UserRole 對應到「該角色預期會接觸到的功能類型」。
 * 用來決定 demo screen 看到「您的角色暫不開放此功能」時要顯示哪一行說明。
 */
export type RoleFeatureScope =
  | 'academic_student'   // 學生視角的學術功能（看自己成績/作業）
  | 'academic_teacher'   // 教師視角的學術功能（出題/批改/評語）
  | 'academic_ta'        // 助教視角（協助批改）
  | 'club'               // 社團幹部
  | 'department'         // 系所主管
  | 'system_admin'       // 全校管理員
  | 'vendor'             // 餐廳員工/廠商
  | 'public_only'        // 校友/訪客
  ;

const ROLE_TO_SCOPE: Record<string, RoleFeatureScope> = {
  student: 'academic_student',
  teacher: 'academic_teacher',
  professor: 'academic_teacher',
  ta: 'academic_ta',
  club_officer: 'club',
  department_head: 'department',
  principal: 'department',
  admin: 'system_admin',
  staff: 'system_admin',
  vendor: 'vendor',
  alumni: 'public_only',
  guest: 'public_only',
};

export function getRoleScope(role: UserRole | string | null | undefined): RoleFeatureScope {
  if (!role) return 'public_only';
  return ROLE_TO_SCOPE[role] ?? 'public_only';
}

/** 該角色能否存取「教師工作台」類功能 */
export function canAccessTeacherFeatures(role: UserRole | string | null | undefined): boolean {
  const scope = getRoleScope(role);
  return (
    scope === 'academic_teacher' ||
    scope === 'academic_ta' ||
    scope === 'department' ||
    scope === 'system_admin'
  );
}

/** 該角色能否存取「學生視角」功能（看自己成績/排名/作業） */
export function canAccessStudentFeatures(role: UserRole | string | null | undefined): boolean {
  const scope = getRoleScope(role);
  return scope === 'academic_student' || scope === 'system_admin';
}

/** 該角色能否管理商家（看訂單佇列、菜單） */
export function canAccessVendorFeatures(role: UserRole | string | null | undefined): boolean {
  const scope = getRoleScope(role);
  return scope === 'vendor' || scope === 'system_admin';
}

/** 該角色能否管理社團（發公告、報名審核） */
export function canAccessClubOfficerFeatures(role: UserRole | string | null | undefined): boolean {
  const scope = getRoleScope(role);
  return scope === 'club' || scope === 'system_admin';
}

/** 該角色能否查看系所儀表板（系主任/系系統） */
export function canAccessDepartmentFeatures(role: UserRole | string | null | undefined): boolean {
  const scope = getRoleScope(role);
  return scope === 'department' || scope === 'system_admin';
}

/**
 * 給「請先登入」式的早期返回用：在 demo 帳號下永遠 false，
 *   讓 screen 跑進正常 render 路徑、再由 mock 資料填空。
 * 真實未登入時，會回傳 true，照原本顯示「請先登入」。
 */
export function shouldBlockForNoLogin(params: {
  uid: string | null | undefined;
  hasUser: boolean;
}): boolean {
  if (params.hasUser) return false;
  if (isDemoUid(params.uid)) return false;
  return true;
}

/**
 * 給 screen 用的「demo 友善的角色不符」提示文字。
 * 比「請先登入」更精準，也讓 demo 評委一眼看出這是權限隔離而非 bug。
 */
export function getRoleBlockedMessage(
  role: UserRole | string | null | undefined,
  requiredScope: RoleFeatureScope,
): string {
  const labels: Record<RoleFeatureScope, string> = {
    academic_student: '學生',
    academic_teacher: '教師',
    academic_ta: '助教',
    club: '社團幹部',
    department: '系主任 / 系所主管',
    system_admin: '系統管理員',
    vendor: '餐廳員工 / 廠商',
    public_only: '校友 / 訪客',
  };
  const myScope = getRoleScope(role);
  if (myScope === requiredScope) return '';
  return `這項功能僅供「${labels[requiredScope]}」使用；目前的 demo 角色是「${labels[myScope]}」。\n在「我的 → 切換角色」可改換其他 demo 帳號試看看。`;
}
