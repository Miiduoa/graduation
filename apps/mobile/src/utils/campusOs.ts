import type {
  Course,
  InboxItem,
  InboxIntent,
  InboxTask,
  InboxUrgency,
  FreshnessState,
  RoleMode,
  UserRole,
} from "../data/types";

export function resolveRoleMode(role?: UserRole | null, isAuthenticated?: boolean): RoleMode {
  if (!isAuthenticated) return "guest";
  if (role === "admin" || role === "principal") return "admin";
  if (role === "teacher" || role === "professor" || role === "staff") return "teacher";
  return "student";
}

export function isTeachingRole(role?: UserRole | null): boolean {
  return resolveRoleMode(role, true) === "teacher" || resolveRoleMode(role, true) === "admin";
}

export function getFreshnessState(date?: Date | null): FreshnessState {
  if (!date) return "stale";
  const diff = Date.now() - date.getTime();
  if (diff <= 1000 * 60 * 30) return "live";
  if (diff <= 1000 * 60 * 60 * 12) return "new";
  if (diff <= 1000 * 60 * 60 * 24) return "today";
  return "stale";
}

export function getInboxIntent(task: InboxTask): InboxIntent {
  if (task.preferredIntent) return task.preferredIntent;

  switch (task.kind) {
    case "assignment":
    case "quiz":
      return "submit";
    case "live":
      return "join";
    case "group":
    default:
      return (task.unreadCount ?? 0) > 0 ? "read" : "review";
  }
}

export function getInboxUrgency(task: InboxTask): InboxUrgency {
  if (task.kind === "live") return "critical";
  if (task.priority >= 90) return "critical";
  if (task.priority >= 70) return "high";
  if (task.priority >= 40) return "medium";
  if (task.priority <= 0) return "critical";
  if (task.priority <= 1) return "high";
  if (task.priority <= 2) return "medium";
  return "low";
}

export function getActionLabel(intent: InboxIntent): string {
  switch (intent) {
    case "submit":
      return "立即處理";
    case "join":
      return "進入課堂";
    case "reply":
      return "立即回覆";
    case "navigate":
      return "開始導航";
    case "verify":
      return "前往確認";
    case "read":
      return "查看變更";
    case "review":
    default:
      return "打開看看";
  }
}

export function toInboxItem(task: InboxTask): InboxItem {
  const intent = getInboxIntent(task);
  const urgency = getInboxUrgency(task);
  const freshness = task.dueAt ? getFreshnessState(task.dueAt) : "today";

  return {
    ...task,
    intent,
    urgency,
    freshness,
    actionLabel: task.actionLabel ?? getActionLabel(intent),
    reason:
      task.reason ??
      (task.kind === "live"
        ? "課堂正在進行，錯過會直接影響出席與互動"
        : task.kind === "assignment"
          ? "這項作業會影響本週進度"
          : task.kind === "quiz"
            ? "評量接近截止，延後會壓縮準備時間"
            : "這則更新可能改變你的下一步"),
    consequence:
      task.consequence ??
      (task.kind === "live"
        ? "可能錯過簽到、課堂互動或教材說明"
        : task.kind === "group"
          ? "可能漏看課程異動、公告或回覆"
          : "可能變成更高壓的臨時處理"),
    nextStep:
      task.nextStep ??
      (task.kind === "live"
        ? "現在進入課堂模式"
        : task.kind === "group"
          ? "先看更新，再決定是否進一步處理"
          : "先打開內容，確認要求與完成條件"),
  };
}

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function normalizeCourseTimes(course: Course) {
  const scheduleItem = course.schedule?.[0];
  const start = course.startTime ?? scheduleItem?.startTime ?? "23:59";
  const end = course.endTime ?? scheduleItem?.endTime ?? "23:59";
  return { start, end };
}

export function getTodayCourses(courses: Course[], date: Date = new Date()) {
  const weekday = date.getDay();
  return courses
    .filter((course) => (course.dayOfWeek ?? course.schedule?.[0]?.dayOfWeek) === weekday)
    .sort((a, b) => {
      const aStart = normalizeCourseTimes(a).start;
      const bStart = normalizeCourseTimes(b).start;
      return toMinutes(aStart) - toMinutes(bStart);
    });
}

export function getNextCourse(courses: Course[], date: Date = new Date()): Course | null {
  const now = date.getHours() * 60 + date.getMinutes();
  return (
    getTodayCourses(courses, date).find((course) => {
      const { end } = normalizeCourseTimes(course);
      return toMinutes(end) >= now;
    }) ?? null
  );
}

export function formatDueWindow(date?: Date | null): string {
  if (!date) return "等待下一步";
  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60000);
  if (diffMinutes <= 0) return "已到時間，現在處理";
  if (diffMinutes < 60) return `${diffMinutes} 分鐘內要處理`;
  if (diffMinutes < 24 * 60) {
    const hours = Math.floor(diffMinutes / 60);
    return `${hours} 小時內到期`;
  }
  const days = Math.ceil(diffMinutes / (24 * 60));
  return `${days} 天內要完成`;
}

export function roleSummary(roleMode: RoleMode) {
  switch (roleMode) {
    case "teacher":
      return {
        label: "教學模式",
        hint: "先處理課堂節奏與待發佈項目",
      };
    case "admin":
      return {
        label: "管理模式",
        hint: "優先處理校務風險與整體運作",
      };
    case "student":
      return {
        label: "學習模式",
        hint: "先完成今天最重要的一步",
      };
    default:
      return {
        label: "訪客模式",
        hint: "先選擇學校，再建立你的使用節奏",
      };
  }
}
