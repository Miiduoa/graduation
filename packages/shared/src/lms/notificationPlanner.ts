/**
 * Notification Planner — 智慧通知決策引擎（TronClass 沒有）
 *
 * 純函式：給定學生／老師現況（schedule、homeworks、attendance、grades 等），
 * 決定該推什麼提醒、何時推、優先序如何。
 *
 * 設計：
 *  - 完全 deterministic，方便測試
 *  - 每條建議都有 reason 給 UI 顯示
 *  - 同類型通知會 dedupe（避免騷擾）
 *  - cooldown 機制：太頻繁的提醒 throttle 掉
 *  - 除 ctx.now 外，不得依賴其他隱性全域狀態
 *
 * ─────────────────────────────────────────────────────────
 * 點名／出席通知狀態表（硬性：沒有點名紀錄 ≠ 缺席）
 * ─────────────────────────────────────────────────────────
 * | # | 條件 | 對象 | 輸出 kind | 文案要點 | 禁止 |
 * |---|------|------|-----------|----------|------|
 * | 1 | 今天沒有這門課，或還沒到上課時間 | 全員 | （不通知） | — | 不得推論缺席 |
 * | 2 | 上課中或已下課，且老師尚未建立點名場次 | 老師 | attendance_session_missing_teacher | 「本堂尚未點名」（一堂一次＋cooldown） | 不得寫缺席／曠課／扣分 |
 * | 2 | 同上 | 學生 | attendance_session_missing_student | 「老師本堂尚未點名，不會記為缺席」 | 不得暗示已記缺席 |
 * | 3 | 點名場次開放中、學生尚未簽到 | 學生 | attendance_active | 「點名進行中，請簽到」 | — |
 * | 4 | 點名場次已結束、學生沒有簽到紀錄、且老師未標記缺席 | 學生 | attendance_no_checkin_record | 狀態名「沒有簽到紀錄」；提醒向老師確認或申請更正 | 不得稱缺席／曠課 |
 * | 5 | 資料讀取失敗，或課表未連結／無法對應本堂 | 全員 | （不通知） | — | 不得推論 |
 * | 6 | 老師在伺服器明確標記缺席 | 學生 | （不新增推播；沿用既有畫面） | 既有「教師已登記本次缺席」 | planner 不另產推播 |
 *
 * 學生端規則 2 選擇「顯示」中性訊息：口試評審要求釐清「沒點名≠缺席」，
 * 明示可降低學生誤以為已被記缺席的焦慮。
 */

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type NotificationKind =
  | 'class_soon' // 下堂課 30 分鐘內
  | 'classroom_change' // 教室異動
  | 'hw_due_soon' // 作業 < 24h 到期
  | 'hw_overdue' // 已逾期
  | 'exam_today' // 今天考試
  | 'exam_tomorrow' // 明天考試
  | 'unread_material' // 教材 3 天沒翻
  | 'attendance_active' // 老師現在開點名
  | 'attendance_session_missing_teacher' // 本堂尚未點名（老師）
  | 'attendance_session_missing_student' // 老師本堂尚未點名，不會記為缺席（學生）
  | 'attendance_no_checkin_record' // 沒有簽到紀錄（≠缺席）
  | 'attendance_pattern_risk' // 連續缺席偵測
  | 'grade_published' // 新成績發布
  | 'discussion_reply' // 有人回我的討論
  | 'risk_radar' // 學習風險
  | 'peer_review_due'; // 互評到期

export type NotificationSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string;
  /** 建議推送時間 (ISO)；null 表示立即 */
  scheduledAt: string | null;
  /** 點擊後跳轉 deep link，例如 'CourseModules?groupId=71378' */
  deepLink?: string;
  /** 用於 UI 顯示的 category emoji */
  emoji: string;
}

/**
 * 單堂課的點名情境。呼叫端必須把課表／場次狀態寫清楚；
 * planner 只讀這些欄位與 ctx.now，不做隱性推論。
 */
export type AttendanceScheduleStatus =
  | 'ok'
  | 'no_class_today'
  | 'before_class'
  | 'unlinked'
  | 'error';

export type AttendanceSessionStatus =
  | { kind: 'none' }
  | {
      kind: 'active';
      id: string;
      /** 學生是否已有合格簽到紀錄（present/late + checkedInAt） */
      studentCheckedIn: boolean;
    }
  | {
      kind: 'ended';
      id: string;
      studentCheckedIn: boolean;
      /** 老師在伺服器明確標記的缺席 */
      studentMarkedAbsent: boolean;
      studentMarkedExcused: boolean;
    };

export interface TodayAttendanceSituation {
  courseId: string;
  courseName: string;
  viewerRole: 'student' | 'teacher';
  /**
   * ok：已進入或已結束本堂（classStartAt／classEndAt 必填）
   * before_class／no_class_today：不通知
   * unlinked／error：不通知、不推論
   */
  scheduleStatus: AttendanceScheduleStatus;
  /** ISO；scheduleStatus === 'ok' | 'before_class' 時提供 */
  classStartAt?: string | null;
  classEndAt?: string | null;
  session: AttendanceSessionStatus;
}

export interface NotificationContext {
  now: string; // ISO
  upcomingClasses?: Array<{
    courseId: string;
    courseName: string;
    startAt: string;
    location?: string;
    locationChanged?: boolean;
    oldLocation?: string;
  }>;
  homeworks?: Array<{
    id: string | number;
    courseId: string | number;
    courseName: string;
    title: string;
    dueAt: string | null;
    submitted: boolean;
  }>;
  exams?: Array<{
    id: string | number;
    courseId: string | number;
    courseName: string;
    title: string;
    startAt: string | null;
    submitted: boolean;
  }>;
  /** 舊版：僅描述已存在的場次；active 時產生 attendance_active */
  attendanceSessions?: Array<{
    id: string;
    courseId: string | number;
    courseName: string;
    active: boolean;
    startedAt: string;
  }>;
  /**
   * 今日各課點名情境（含「尚未建立場次」）。
   * 與 attendanceSessions 並存：situations 優先處理規則 1–6；
   * 若某課已在 situations 以 active 處理，不再重複用 attendanceSessions 產生。
   */
  todayAttendanceSituations?: TodayAttendanceSituation[];
  unreadMaterials?: Array<{
    courseId: string | number;
    courseName: string;
    lastOpenedAt: string | null;
    materialCount: number;
  }>;
  recentGrades?: Array<{
    courseId: string | number;
    courseName: string;
    itemTitle: string;
    publishedAt: string;
  }>;
  discussionReplies?: Array<{
    threadId: string | number;
    courseId: string | number;
    courseName: string;
    title: string;
    replierName: string;
    repliedAt: string;
  }>;
  riskAlerts?: Array<{
    courseId: string | number;
    courseName: string;
    riskLevel: 'low' | 'medium' | 'high';
    reason: string;
  }>;
  peerReviewsDue?: Array<{
    id: string | number;
    courseId: string | number;
    courseName: string;
    assignmentTitle: string;
    dueAt: string;
  }>;
}

export interface PlanNotificationsOptions {
  /** 用於 dedupe 的 cache key 對應「最近 N 小時內已推過的 kind」 */
  recentlySent?: Array<{ kind: NotificationKind; key: string; at: string }>;
  /** 同一個 (kind, key) cooldown 多少小時不再推，預設 4 */
  cooldownHours?: number;
}

/** 點名相關輸出禁止出現的字樣（缺席標記本身除外，且規則 6 不經 planner 產推播） */
export const ATTENDANCE_NOTICE_FORBIDDEN_TERMS = ['缺席', '曠課', '扣分'] as const;

export function attendanceNoticeTextIsSafe(text: string): boolean {
  return !ATTENDANCE_NOTICE_FORBIDDEN_TERMS.some((term) => text.includes(term));
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function hoursBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return (to - from) / (1000 * 60 * 60);
}

function severityOrder(s: NotificationSeverity): number {
  return s === 'critical' ? 0 : s === 'high' ? 1 : s === 'medium' ? 2 : 3;
}

function makeId(kind: NotificationKind, key: string): string {
  return `${kind}::${key}`;
}

function isOnCooldown(
  kind: NotificationKind,
  key: string,
  now: string,
  cooldownHours: number,
  recent: PlanNotificationsOptions['recentlySent'],
): boolean {
  if (!recent || recent.length === 0) return false;
  for (const r of recent) {
    if (r.kind === kind && r.key === key) {
      const ago = hoursBetween(r.at, now);
      if (ago < cooldownHours) return true;
    }
  }
  return false;
}

function meetingKey(courseId: string, classStartAt: string | null | undefined): string {
  return `${courseId}::${classStartAt ?? 'unknown'}`;
}

/**
 * 依狀態表處理單堂點名情境。回傳要 push 的項目（尚未套 cooldown）。
 * 規則 6：老師已標記缺席 → 不產新推播。
 */
export function planAttendanceSituationNotices(
  situation: TodayAttendanceSituation,
  _now: string,
): Array<Omit<NotificationItem, 'id'> & { key: string }> {
  const { courseId, courseName, viewerRole, scheduleStatus, session } = situation;
  const classStartAt = situation.classStartAt ?? null;
  const deepLinkBase = `AttendanceMultiMethod?courseId=${courseId}`;

  // 已有場次：規則 3／4／6 只依場次與伺服器標記，不依賴課表連結。
  if (session.kind === 'active') {
    // 3. 場次開放中、學生尚未簽到
    if (viewerRole === 'student' && !session.studentCheckedIn) {
      return [
        {
          kind: 'attendance_active',
          key: session.id,
          severity: 'critical',
          emoji: '✅',
          title: `${courseName} 點名進行中`,
          body: '點名進行中，請簽到',
          scheduledAt: null,
          deepLink: `${deepLinkBase}&sessionId=${session.id}`,
        },
      ];
    }
    return [];
  }

  if (session.kind === 'ended') {
    // 6. 老師明確標記缺席／請假 → 不新增推播（沿用既有畫面）
    if (session.studentMarkedAbsent || session.studentMarkedExcused) {
      return [];
    }
    // 4. 已結束、沒有簽到紀錄 → 狀態叫「沒有簽到紀錄」，不叫缺席
    if (viewerRole === 'student' && !session.studentCheckedIn) {
      return [
        {
          kind: 'attendance_no_checkin_record',
          key: session.id,
          severity: 'medium',
          emoji: '📝',
          title: `${courseName} 沒有簽到紀錄`,
          body: '沒有簽到紀錄。若有出席請向老師確認或申請更正。',
          scheduledAt: null,
          deepLink: `${deepLinkBase}&sessionId=${session.id}`,
        },
      ];
    }
    return [];
  }

  // session.kind === 'none'：規則 1／2／5 需要明確課表狀態
  // 5. 資料失敗／課表未連結 → 不通知、不推論
  if (scheduleStatus === 'error' || scheduleStatus === 'unlinked') {
    return [];
  }
  // 1. 今天沒課或還沒上課 → 不通知
  if (scheduleStatus === 'no_class_today' || scheduleStatus === 'before_class') {
    return [];
  }

  // 2. 上課中或已下課，尚未建立點名場次
  if (viewerRole === 'teacher') {
    return [
      {
        kind: 'attendance_session_missing_teacher',
        key: meetingKey(courseId, classStartAt),
        severity: 'high',
        emoji: '📋',
        title: `${courseName} 本堂尚未點名`,
        body: '本堂尚未點名。需要紀錄出席時，請開啟點名場次。',
        scheduledAt: null,
        deepLink: deepLinkBase,
      },
    ];
  }
  return [
    {
      kind: 'attendance_session_missing_student',
      key: meetingKey(courseId, classStartAt),
      severity: 'medium',
      emoji: 'ℹ️',
      title: `${courseName} 老師本堂尚未點名`,
      body: '老師本堂尚未點名，不會記為缺席。',
      scheduledAt: null,
      deepLink: deepLinkBase,
    },
  ];
}

/** 由課表起迄與現在時間推得 scheduleStatus（純函式，只讀傳入值）。 */
export function resolveAttendanceScheduleStatus(input: {
  now: string;
  hasScheduleLink: boolean;
  scheduleLoadError?: boolean;
  classStartAt?: string | null;
  classEndAt?: string | null;
}): AttendanceScheduleStatus {
  if (input.scheduleLoadError) return 'error';
  if (!input.hasScheduleLink) return 'unlinked';
  if (!input.classStartAt || !input.classEndAt) return 'no_class_today';
  const nowMs = new Date(input.now).getTime();
  const startMs = new Date(input.classStartAt).getTime();
  const endMs = new Date(input.classEndAt).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return 'error';
  }
  if (nowMs < startMs) return 'before_class';
  return 'ok';
}

// ─────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────

export function planNotifications(
  ctx: NotificationContext,
  options: PlanNotificationsOptions = {},
): NotificationItem[] {
  const out: NotificationItem[] = [];
  const cooldown = options.cooldownHours ?? 4;
  const recent = options.recentlySent ?? [];

  function push(item: Omit<NotificationItem, 'id'> & { key: string }) {
    const id = makeId(item.kind, item.key);
    if (isOnCooldown(item.kind, item.key, ctx.now, cooldown, recent)) return;
    out.push({ id, ...item });
  }

  // 1. 下堂課 30 分鐘內
  for (const c of ctx.upcomingClasses ?? []) {
    const mins = hoursBetween(ctx.now, c.startAt) * 60;
    if (mins > 0 && mins <= 30) {
      push({
        kind: 'class_soon',
        key: c.courseId,
        severity: 'high',
        emoji: '🏫',
        title: `${Math.round(mins)} 分鐘後 ${c.courseName}`,
        body: c.location ? `教室：${c.location}` : '請準備上課',
        scheduledAt: null,
        deepLink: `CourseHome?courseId=${c.courseId}`,
      });
    }
    if (c.locationChanged && c.oldLocation) {
      push({
        kind: 'classroom_change',
        key: `${c.courseId}::${c.startAt}`,
        severity: 'critical',
        emoji: '📍',
        title: `${c.courseName} 教室異動`,
        body: `從 ${c.oldLocation} 改到 ${c.location ?? '未公布'}`,
        scheduledAt: null,
        deepLink: `CourseHome?courseId=${c.courseId}`,
      });
    }
  }

  // 2. 作業：24h 內到期 / 逾期
  for (const hw of ctx.homeworks ?? []) {
    if (hw.submitted || !hw.dueAt) continue;
    const hoursLeft = hoursBetween(ctx.now, hw.dueAt);
    if (hoursLeft < 0) {
      push({
        kind: 'hw_overdue',
        key: String(hw.id),
        severity: 'critical',
        emoji: '⏰',
        title: `已逾期：${hw.title}`,
        body: `${hw.courseName} · 逾期 ${Math.abs(Math.round(hoursLeft))} 小時，建議聯絡老師補交`,
        scheduledAt: null,
        deepLink: `HomeworkSubmit?courseId=${hw.courseId}&hwId=${hw.id}`,
      });
    } else if (hoursLeft <= 24) {
      const dueMs = new Date(hw.dueAt).getTime();
      const oneHourBeforeMs = dueMs - 60 * 60 * 1000;
      const nowMs = new Date(ctx.now).getTime();
      const scheduledAt =
        Number.isFinite(dueMs) && oneHourBeforeMs > nowMs
          ? new Date(oneHourBeforeMs).toISOString()
          : null;
      push({
        kind: 'hw_due_soon',
        key: String(hw.id),
        severity: hoursLeft <= 3 ? 'critical' : 'high',
        emoji: '📝',
        title: `${Math.round(hoursLeft)} 小時內到期：${hw.title}`,
        body: `${hw.courseName} · 還沒繳交`,
        scheduledAt,
        deepLink: `HomeworkSubmit?courseId=${hw.courseId}&hwId=${hw.id}`,
      });
    }
  }

  // 3. 考試：今天 / 明天
  for (const ex of ctx.exams ?? []) {
    if (ex.submitted || !ex.startAt) continue;
    const hoursLeft = hoursBetween(ctx.now, ex.startAt);
    if (hoursLeft > 0 && hoursLeft <= 12) {
      push({
        kind: 'exam_today',
        key: String(ex.id),
        severity: 'critical',
        emoji: '📝',
        title: `今天考試：${ex.title}`,
        body: `${ex.courseName} · ${Math.round(hoursLeft)} 小時後開始`,
        scheduledAt: null,
        deepLink: `QuizCenter?groupId=${ex.courseId}&assignmentId=${ex.id}`,
      });
    } else if (hoursLeft > 12 && hoursLeft <= 36) {
      push({
        kind: 'exam_tomorrow',
        key: String(ex.id),
        severity: 'high',
        emoji: '📚',
        title: `明天考試：${ex.title}`,
        body: `${ex.courseName} · 建議今晚複習`,
        scheduledAt: null,
        deepLink: `QuizCenter?groupId=${ex.courseId}&assignmentId=${ex.id}`,
      });
    }
  }

  // 4. 今日點名情境（狀態表 1–6）
  const situationActiveSessionIds = new Set<string>();
  for (const situation of ctx.todayAttendanceSituations ?? []) {
    for (const item of planAttendanceSituationNotices(situation, ctx.now)) {
      push(item);
      if (item.kind === 'attendance_active') {
        situationActiveSessionIds.add(item.key);
      }
    }
  }

  // 4b. 舊版 attendanceSessions：僅 active；已由 situations 處理的場次不重複
  for (const att of ctx.attendanceSessions ?? []) {
    if (!att.active) continue;
    if (situationActiveSessionIds.has(att.id)) continue;
    push({
      kind: 'attendance_active',
      key: att.id,
      severity: 'critical',
      emoji: '✅',
      title: `${att.courseName} 老師開點名中`,
      body: '請立即進入課程簽到',
      scheduledAt: null,
      deepLink: `AttendanceMultiMethod?courseId=${att.courseId}&sessionId=${att.id}`,
    });
  }

  // 5. 教材 3 天沒翻
  for (const um of ctx.unreadMaterials ?? []) {
    if (um.materialCount === 0) continue;
    const days = um.lastOpenedAt ? hoursBetween(um.lastOpenedAt, ctx.now) / 24 : 999;
    if (days >= 3) {
      push({
        kind: 'unread_material',
        key: String(um.courseId),
        severity: 'low',
        emoji: '📖',
        title: `${um.courseName} 已 ${Math.floor(days)} 天沒翻`,
        body: `${um.materialCount} 份教材待消化`,
        scheduledAt: null,
        deepLink: `CourseModules?groupId=${um.courseId}`,
      });
    }
  }

  // 6. 新成績發布
  for (const g of ctx.recentGrades ?? []) {
    push({
      kind: 'grade_published',
      key: `${g.courseId}::${g.itemTitle}`,
      severity: 'medium',
      emoji: '📊',
      title: `${g.courseName} 新成績`,
      body: `${g.itemTitle} 已批改`,
      scheduledAt: null,
      deepLink: `CourseScores?groupId=${g.courseId}`,
    });
  }

  // 7. 討論回覆
  for (const r of ctx.discussionReplies ?? []) {
    push({
      kind: 'discussion_reply',
      key: String(r.threadId),
      severity: 'medium',
      emoji: '💬',
      title: `${r.replierName} 回覆了你的討論`,
      body: `${r.courseName} · ${r.title}`,
      scheduledAt: null,
      deepLink: `DiscussionThread?threadId=${r.threadId}&courseId=${r.courseId}`,
    });
  }

  // 8. 學習風險雷達
  for (const ra of ctx.riskAlerts ?? []) {
    if (ra.riskLevel === 'low') continue;
    push({
      kind: 'risk_radar',
      key: String(ra.courseId),
      severity: ra.riskLevel === 'high' ? 'critical' : 'high',
      emoji: '🚨',
      title: `${ra.courseName} 學習警示`,
      body: ra.reason,
      scheduledAt: null,
      deepLink: `CourseHome?courseId=${ra.courseId}`,
    });
  }

  // 9. 互評到期
  for (const pr of ctx.peerReviewsDue ?? []) {
    const hoursLeft = hoursBetween(ctx.now, pr.dueAt);
    if (hoursLeft < 0 || hoursLeft > 48) continue;
    push({
      kind: 'peer_review_due',
      key: String(pr.id),
      severity: hoursLeft <= 12 ? 'high' : 'medium',
      emoji: '💯',
      title: `互評 ${Math.round(hoursLeft)} 小時內到期`,
      body: `${pr.courseName} · ${pr.assignmentTitle}`,
      scheduledAt: null,
      deepLink: `PeerReviewSubmit?courseId=${pr.courseId}&reviewId=${pr.id}`,
    });
  }

  // 排序：severity > scheduledAt
  out.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
  return out;
}
