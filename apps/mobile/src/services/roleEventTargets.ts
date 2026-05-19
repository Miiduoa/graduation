/**
 * Role Event Targets — 依「actor 角色 + 流程類型」回傳正確的 targetUids
 *
 * 解決的問題：很多 screen 在 emitXxx 時 hardcoded `targetUids: ['demo_teacher_chang']`，
 * 結果 demo 老師點了「請假申請」就變成「自己把假單送給自己」。
 *
 * 規則（demo 環境，真實系統會由後端依組織關係決定）：
 *   - 請假（leave_requested）
 *       student / ta / club_officer → 送給授課老師 + 系主任
 *       teacher                     → 送給系主任（不能送給自己）
 *       department_head             → 送給系統管理員（demo 用 admin）
 *       admin / vendor / alumni / guest → 無此流程
 *   - 宿舍報修（dorm_repair_requested）
 *       住宿生（任何有 dorm 的 demo 角色）→ 送給系主任
 *       其他角色 → 無此流程
 *   - 求助（help_requested）
 *       student → 送給 TA + 老師
 *       其他角色 → 無此流程（老師有自己的求助管道，不在此處）
 *   - 討論（discussion_posted）
 *       student → 送給老師 + TA
 *       teacher → 廣播（targetUids 全空，全班可見）
 *   - 簽到（attendance_checked_in）
 *       student → 送給授課老師
 *       其他角色 → 無此流程
 *   - 下單（order_placed）
 *       student → 送給該餐廳的 vendor
 *       其他角色 → 無此流程
 *
 * 所有 helper 都會自動把 actor 自己從目標排除（雙保險：roleEventBus 也有同樣的過濾）
 */

import type { UserRole } from '../data/types';

// 已知的 demo uid（保持與 demoUserStories.ts / LoginLandingScreen.tsx 同步）
const DEMO_TEACHER = 'demo_teacher_chang';
const DEMO_TA = 'demo_ta_lin';
const DEMO_DEPT_HEAD = 'demo_admin_huang';
const DEMO_ADMIN_SYS = 'demo_admin_sys';
const DEMO_VENDOR_CAFETERIA = 'demo_cafeteria';

function excludeSelf(actorUid: string | null | undefined, targets: string[]): string[] {
  return targets.filter((t) => t && t !== actorUid);
}

/** 該角色能否在「請假」頁送出申請 */
export function canSubmitLeaveRequest(role: UserRole | string | null | undefined): boolean {
  return (
    role === 'student' ||
    role === 'ta' ||
    role === 'club_officer' ||
    role === 'teacher' ||
    role === 'professor' ||
    role === 'department_head' ||
    role === 'principal'
  );
}

/** 請假流程的 targetUids（依 actor 角色） */
export function getLeaveRequestTargets(
  actorRole: UserRole | string | null | undefined,
  actorUid: string,
): string[] {
  switch (actorRole) {
    case 'student':
    case 'ta':
    case 'club_officer':
      return excludeSelf(actorUid, [DEMO_TEACHER, DEMO_DEPT_HEAD]);
    case 'teacher':
    case 'professor':
      // 教師請假 → 系主任（系所主管）審核
      return excludeSelf(actorUid, [DEMO_DEPT_HEAD]);
    case 'department_head':
    case 'principal':
      // 系主任請假 → 校長 / 行政管理員
      return excludeSelf(actorUid, [DEMO_ADMIN_SYS]);
    default:
      return [];
  }
}

/** 該角色說明文字（用於 UI 提示） */
export function getLeaveTargetLabel(
  actorRole: UserRole | string | null | undefined,
): string {
  switch (actorRole) {
    case 'student':
    case 'ta':
    case 'club_officer':
      return '授課老師 + 系主任';
    case 'teacher':
    case 'professor':
      return '系所主管（系主任）';
    case 'department_head':
    case 'principal':
      return '校務管理員';
    default:
      return '';
  }
}

/** 該角色能否提交宿舍報修 */
export function canSubmitDormRepair(role: UserRole | string | null | undefined): boolean {
  // 限住宿身分：學生 / 社團幹部（也是學生身分）/ TA（多數為研究生住宿）
  return role === 'student' || role === 'ta' || role === 'club_officer';
}

export function getDormRepairTargets(actorUid: string): string[] {
  return excludeSelf(actorUid, [DEMO_DEPT_HEAD]);
}

/** 該角色能否在「求助」頁送出求助訊息 */
export function canRequestHelp(role: UserRole | string | null | undefined): boolean {
  return role === 'student' || role === 'club_officer';
}

export function getHelpRequestTargets(actorUid: string): string[] {
  return excludeSelf(actorUid, [DEMO_TA, DEMO_TEACHER]);
}

/** 該角色能否張貼課堂討論 */
export function canPostDiscussion(role: UserRole | string | null | undefined): boolean {
  return (
    role === 'student' ||
    role === 'ta' ||
    role === 'club_officer' ||
    role === 'teacher' ||
    role === 'professor'
  );
}

/** 課堂討論的 targetUids（學生→老師+TA、老師→廣播給全班） */
export function getDiscussionTargets(
  actorRole: UserRole | string | null | undefined,
  actorUid: string,
): string[] | undefined {
  if (actorRole === 'teacher' || actorRole === 'professor') {
    // 老師發討論 → 廣播（undefined = 全班 / __all__）
    return undefined;
  }
  // 學生 / TA → 通知老師 + TA
  return excludeSelf(actorUid, [DEMO_TEACHER, DEMO_TA]);
}

/** 該角色能否簽到課堂（學生視角） */
export function canCheckInAttendance(role: UserRole | string | null | undefined): boolean {
  return role === 'student' || role === 'ta' || role === 'club_officer';
}

export function getAttendanceCheckInTargets(actorUid: string): string[] {
  return excludeSelf(actorUid, [DEMO_TEACHER]);
}

/** 該角色能否在校園 APP 下餐 */
export function canPlaceOrder(role: UserRole | string | null | undefined): boolean {
  // 餐廳員工不該對自己餐廳下單；訪客 / 校友也不該（demo 隔離）
  return (
    role === 'student' ||
    role === 'teacher' ||
    role === 'professor' ||
    role === 'ta' ||
    role === 'club_officer' ||
    role === 'department_head' ||
    role === 'admin' ||
    role === 'staff'
  );
}

export function getOrderPlacedTargets(
  actorUid: string,
  merchantUid: string = DEMO_VENDOR_CAFETERIA,
): string[] {
  return excludeSelf(actorUid, [merchantUid]);
}

// ─────────────────────────────────────────────────────────
// UI 文案 — 給 screen 用「您的角色目前無法使用此功能」的訊息
// ─────────────────────────────────────────────────────────

export function getRoleNotEligibleMessage(
  role: UserRole | string | null | undefined,
  flowLabel: string,
): { title: string; body: string } {
  return {
    title: `${flowLabel}不適用於目前角色`,
    body:
      `目前的 demo 角色為「${roleLabel(role)}」，此流程僅供校內師生使用。\n` +
      `可在「我的 → 切換角色」中改成學生 / 教師等帳號試看看。`,
  };
}

function roleLabel(role: UserRole | string | null | undefined): string {
  switch (role) {
    case 'student': return '學生';
    case 'teacher':
    case 'professor': return '教師';
    case 'ta': return '助教';
    case 'club_officer': return '社團幹部';
    case 'department_head':
    case 'principal': return '系主任';
    case 'admin': return '系統管理員';
    case 'staff': return '行政人員';
    case 'vendor': return '餐廳員工 / 廠商';
    case 'alumni': return '校友';
    case 'guest': return '訪客';
    default: return '未知角色';
  }
}
