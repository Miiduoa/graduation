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
  const mode = resolveRoleMode(role, true);
  return mode === "teacher" || mode === "admin";
}

function safeGetTime(value: unknown): number | null {
  // NOTE: Hermes can throw "Date.prototype.getTime() called on non-Date object"
  // if we call a cross-realm Date's getTime(). Avoid calling `getTime` unless it's
  // a real Date instance in THIS realm.
  try {
    if (value instanceof Date) {
      const t = value.getTime();
      return Number.isFinite(t) ? t : null;
    }

    if (value == null) return null;

    if (typeof (value as { toMillis?: unknown }).toMillis === "function") {
      const t = (value as { toMillis: () => number }).toMillis();
      return typeof t === "number" && Number.isFinite(t) ? t : null;
    }

    if (typeof (value as { toDate?: unknown }).toDate === "function") {
      return safeGetTime((value as { toDate: () => unknown }).toDate());
    }

    if (typeof (value as { seconds?: unknown }).seconds === "number") {
      return (value as { seconds: number }).seconds * 1000;
    }
    if (typeof (value as { _seconds?: unknown })._seconds === "number") {
      return (value as { _seconds: number })._seconds * 1000;
    }

    if (typeof value === "string" || typeof value === "number") {
      const t = new Date(value).getTime();
      return Number.isFinite(t) ? t : null;
    }

    if (Object.prototype.toString.call(value) === "[object Date]") {
      // Cross-realm Date: use string parsing instead of calling getTime().
      const parsed = Date.parse(String(value));
      return Number.isFinite(parsed) ? parsed : null;
    }

    if (typeof value === "object" && typeof (value as { getTime?: unknown }).getTime === "function") {
      // Date-like object: best effort via string coercion, but never invoke getTime().
      const parsed = Date.parse(String(value));
      return Number.isFinite(parsed) ? parsed : null;
    }
  } catch {
    return null;
  }

  return null;
}

function asDate(value: unknown): Date | null {
  if (!value) return null;

  // 1. If it has toMillis() (live Firestore Timestamp), use that directly
  if (typeof (value as { toMillis?: unknown }).toMillis === "function") {
    const ms = (value as { toMillis: () => number }).toMillis();
    if (typeof ms === "number" && !Number.isNaN(ms)) return new Date(ms);
  }

  // 2. If it looks like a Date, try getTime() safely (Hermes can throw on cross-realm Dates)
  const isDateLike =
    value instanceof Date || Object.prototype.toString.call(value) === "[object Date]";
  if (isDateLike) {
    const t = safeGetTime(value);
    if (t !== null) return new Date(t);
  }

  // 3. Firestore Timestamp with toDate()
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      const t = safeGetTime(d);
      if (t !== null) return d;
      // toDate() returned a cross-realm Date — re-wrap
      try {
        const n = +(d as Date);
        if (typeof n === "number" && !Number.isNaN(n)) return new Date(n);
      } catch { /* ignore */ }
    } catch { /* ignore */ }
    return null;
  }

  // 4. Serialised Firestore Timestamp ({_seconds, _nanoseconds} or {seconds, nanoseconds})
  const maybeFirestore = value as { _seconds?: unknown; _nanoseconds?: unknown; seconds?: unknown; nanoseconds?: unknown };
  const seconds =
    (typeof maybeFirestore._seconds === "number" ? maybeFirestore._seconds : maybeFirestore.seconds) as
      | number
      | undefined;
  const nanoseconds =
    (typeof maybeFirestore._nanoseconds === "number" ? maybeFirestore._nanoseconds : maybeFirestore.nanoseconds) as
      | number
      | undefined;
  if (typeof seconds === "number") {
    const ms = seconds * 1000 + Math.round((nanoseconds ?? 0) / 1e6);
    return new Date(ms);
  }

  // 5. Plain object with getTime (non-Date) — e.g. mock objects
  if (typeof value === "object" && typeof (value as { getTime?: unknown }).getTime === "function") {
    const t = safeGetTime(value);
    if (t !== null) return new Date(t);
  }

  // 6. ISO string / epoch millis
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value as string | number);
    const t = safeGetTime(d);
    return t !== null ? d : null;
  }

  return null;
}

export function getFreshnessState(date?: Date | string | number | null): FreshnessState {
  const d = asDate(date);
  if (!d) return "stale";
  const t = safeGetTime(d);
  if (t === null) return "stale";
  const diff = Date.now() - t;
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
  const todayCourses = courses.filter(
    (course) => (course.dayOfWeek ?? course.schedule?.[0]?.dayOfWeek) === weekday
  );

  // Precompute start minutes once per course to avoid repeated parsing during sort.
  const startMinuteMap = new Map<Course, number>();
  for (const course of todayCourses) {
    const start = normalizeCourseTimes(course).start;
    startMinuteMap.set(course, toMinutes(start));
  }

  return todayCourses.sort(
    (a, b) => (startMinuteMap.get(a) ?? Number.MAX_SAFE_INTEGER) - (startMinuteMap.get(b) ?? Number.MAX_SAFE_INTEGER)
  );
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

export function formatDueWindow(date?: Date | string | number | null): string {
  const d = asDate(date);
  if (!d) return "等待下一步";
  const t = safeGetTime(d);
  if (t === null) return "等待下一步";
  const diffMinutes = Math.round((t - Date.now()) / 60000);
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
        label: "瀏覽模式",
        hint: "可先查看公開資訊，登入靜宜學號後再同步個人課表與成績",
      };
  }
}
