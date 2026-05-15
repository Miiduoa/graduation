/**
 * Notification Planner — 智慧通知決策引擎（TronClass 沒有）
 *
 * 純函式：給定學生現況（schedule、homeworks、attendance、grades 等），
 * 決定該推什麼提醒、何時推、優先序如何。
 *
 * 設計：
 *  - 完全 deterministic，方便測試
 *  - 每條建議都有 reason 給 UI 顯示
 *  - 同類型通知會 dedupe（避免騷擾）
 *  - cooldown 機制：太頻繁的提醒 throttle 掉
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
  attendanceSessions?: Array<{
    id: string;
    courseId: string | number;
    courseName: string;
    active: boolean;
    startedAt: string;
  }>;
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

  // 4. 老師現在開點名
  for (const att of ctx.attendanceSessions ?? []) {
    if (att.active) {
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
