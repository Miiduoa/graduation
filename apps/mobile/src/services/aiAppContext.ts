import type {
  AgentMemory,
  LocalTrainingDB,
} from "../data/puAIAgentData";
import {
  exportTrainingInsights,
} from "../data/puAIAgentData";
import type {
  Announcement,
  Cafeteria,
  CalendarEvent,
  Conversation,
  Course,
  DormPackage,
  HealthAppointment,
  LibraryLoan,
  MenuItem,
  NextBestAction,
  Notification,
  Order,
  Poi,
  PrintJob,
  PulseAggregate,
  RepairRequest,
  RoleGroup,
  SeatReservation,
  StudentRiskSnapshot,
  WashingReservation,
} from "../data/types";
import type { DataSource } from "../data/source";
import type { AIContext } from "./ai";
import type { ProactiveAIReport } from "./proactiveAI";

type AnyAssignment = {
  id: string;
  title: string;
  groupName?: string | null;
  dueAt?: unknown;
  isLate?: boolean;
};

export type AIAppRuntimeData = {
  nextBestActions: NextBestAction[];
  riskSnapshots: StudentRiskSnapshot[];
  pulseAggregates: PulseAggregate[];
  calendarEvents: CalendarEvent[];
  notifications: Notification[];
  orders: Order[];
  repairRequests: RepairRequest[];
  healthAppointments: HealthAppointment[];
  seatReservations: SeatReservation[];
  printJobs: PrintJob[];
  dormPackages: DormPackage[];
  conversations: Conversation[];
  libraryLoans: LibraryLoan[];
  washingReservations: WashingReservation[];
};

export type AIAppContextInput = {
  schoolId: string;
  userId?: string | null;
  userName?: string | null;
  role?: RoleGroup | "teacher" | "faculty" | "staff" | "student" | "admin" | "vendor" | "guest" | null;
  isOnline?: boolean;
  courses?: Course[];
  pendingAssignments?: AnyAssignment[];
  weeklyReport?: {
    summary?: string;
    stats?: {
      onTimeRate?: number;
      totalSubmissions?: number;
      newAchievements?: number;
    };
  } | null;
  announcements?: Announcement[];
  events?: Array<{ id: string; title: string; location?: string; startsAt?: string; source?: string }>;
  cafeterias?: Cafeteria[];
  menus?: MenuItem[];
  pois?: Poi[];
  proactiveReports?: ProactiveAIReport[];
  runtimeData?: Partial<AIAppRuntimeData>;
  agentMemory?: AgentMemory | null;
  trainingDB?: LocalTrainingDB | null;
  dialogContextSummary?: string;
  conversationSummary?: string;
  now?: Date;
};

export function emptyAIAppRuntimeData(): AIAppRuntimeData {
  return {
    nextBestActions: [],
    riskSnapshots: [],
    pulseAggregates: [],
    calendarEvents: [],
    notifications: [],
    orders: [],
    repairRequests: [],
    healthAppointments: [],
    seatReservations: [],
    printJobs: [],
    dormPackages: [],
    conversations: [],
    libraryLoans: [],
    washingReservations: [],
  };
}

function compact(value: unknown): string {
  return String(value ?? "").trim();
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  if (typeof value === "object") {
    const record = value as { seconds?: unknown; _seconds?: unknown; toDate?: unknown };
    if (typeof record.toDate === "function") {
      const parsed = (record.toDate as () => Date)();
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }
    const seconds = typeof record.seconds === "number" ? record.seconds : record._seconds;
    if (typeof seconds === "number") return new Date(seconds * 1000);
  }
  return null;
}

function formatDate(value: unknown): string | undefined {
  const date = toDate(value);
  if (!date) return undefined;
  return date.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isWithinHours(value: unknown, now: Date, hours: number): boolean {
  const date = toDate(value);
  if (!date) return false;
  const diffHours = (date.getTime() - now.getTime()) / 3_600_000;
  return diffHours >= 0 && diffHours <= hours;
}

function normalizeRole(role: AIAppContextInput["role"]): AIContext["role"] {
  if (role === "faculty") return "teacher";
  if (role === "vendor") return "staff";
  if (role === "guest" || !role) return undefined;
  if (role === "student" || role === "teacher" || role === "staff" || role === "department_head" || role === "admin") return role;
  return undefined;
}

function runtime(input?: Partial<AIAppRuntimeData>): AIAppRuntimeData {
  return { ...emptyAIAppRuntimeData(), ...(input ?? {}) };
}

function buildCoverage(input: AIAppContextInput, data: AIAppRuntimeData): NonNullable<AIContext["appDataCoverage"]> {
  const rows = [
    ["courses", "課程", input.courses?.length ?? 0],
    ["assignments", "作業", input.pendingAssignments?.length ?? 0],
    ["announcements", "公告", input.announcements?.length ?? 0],
    ["events", "活動", input.events?.length ?? 0],
    ["menus", "餐點", input.menus?.length ?? 0],
    ["pois", "地點", input.pois?.length ?? 0],
    ["pulse", "校園脈動", data.pulseAggregates.length],
    ["risk", "學習風險", data.riskSnapshots.length],
    ["next_actions", "下一步建議", data.nextBestActions.length],
    ["calendar", "行事曆", data.calendarEvents.length],
    ["notifications", "通知", data.notifications.length],
    ["orders", "訂單", data.orders.length],
    ["repairs", "報修", data.repairRequests.length],
    ["health", "健康預約", data.healthAppointments.length],
    ["library", "圖書借閱", data.libraryLoans.length],
    ["dorm", "宿舍包裹", data.dormPackages.length],
  ] as const;

  return rows.map(([key, label, count]) => ({
    key,
    label,
    count,
    state: count > 0 ? "live" as const : "empty" as const,
    detail: count > 0 ? `${count} 筆` : "目前無資料",
  }));
}

function buildLongTermMemoryLines(memory?: AgentMemory | null): string[] {
  if (!memory) return [];
  const lines: string[] = [];
  const prefs = memory.preferences;
  const prefParts = [
    prefs.foodPreferences.length > 0 ? `飲食偏好：${prefs.foodPreferences.slice(0, 4).join("、")}` : "",
    prefs.allergens.length > 0 ? `過敏：${prefs.allergens.slice(0, 4).join("、")}` : "",
    prefs.frequentLocations.length > 0 ? `常去地點：${prefs.frequentLocations.slice(0, 4).join("、")}` : "",
    prefs.communicationStyle ? `溝通風格：${prefs.communicationStyle}` : "",
  ].filter(Boolean);
  if (prefParts.length > 0) lines.push(`長期偏好：${prefParts.join("；")}`);

  const learnedFacts = (memory.learnedFacts ?? []).slice(-5).map((fact) => fact.fact).filter(Boolean);
  if (learnedFacts.length > 0) lines.push(`已學到的使用者事實：${learnedFacts.join("；")}`);

  const recentActions = (memory.recentActions ?? []).slice(-5).map((action) => action.toolId).filter(Boolean);
  if (recentActions.length > 0) lines.push(`近期互動/操作：${recentActions.join("、")}`);

  return lines;
}

export function buildAIAppPulseSummary(input: AIAppContextInput): string {
  const data = runtime(input.runtimeData);
  const now = input.now ?? new Date();
  const lines: string[] = [];

  const lateAssignments = (input.pendingAssignments ?? []).filter((assignment) => assignment.isLate);
  const dueSoonAssignments = (input.pendingAssignments ?? []).filter((assignment) => !assignment.isLate && isWithinHours(assignment.dueAt, now, 72));
  const nextClass = (input.courses ?? [])
    .flatMap((course) => {
      const schedules = Array.isArray(course.schedule) && course.schedule.length > 0
        ? course.schedule
        : [{ dayOfWeek: course.dayOfWeek, startTime: course.startTime, endTime: course.endTime, location: course.location }];
      return schedules
        .filter((schedule) => schedule.dayOfWeek === now.getDay())
        .map((schedule) => ({
          course,
          startTime: schedule.startTime ?? course.startTime,
          endTime: schedule.endTime ?? course.endTime,
          location: schedule.location ?? course.location,
        }));
    })
    .filter((row) => row.startTime)
    .sort((left, right) => compact(left.startTime).localeCompare(compact(right.startTime)))[0];

  const topRisk = [...data.riskSnapshots].sort((a, b) => b.score - a.score)[0];
  const topActions = [...data.nextBestActions]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 4);
  const crowdedLocations = data.pulseAggregates
    .filter((pulse) => pulse.currentLevel >= 4)
    .sort((a, b) => b.currentLevel - a.currentLevel || b.confidence - a.confidence)
    .slice(0, 4);
  const activeOrders = data.orders.filter((order) => !/completed|cancelled|refunded/i.test(compact(order.status)));
  const activeRepairs = data.repairRequests.filter((repair) => !/completed|cancelled/i.test(compact(repair.status)));
  const upcomingHealth = data.healthAppointments.slice(0, 3);
  const activeReservations = data.seatReservations.slice(0, 3);
  const unreadNotifications = data.notifications.filter((notification) => !(notification as any).read && !(notification as any).readAt);
  const proactive = (input.proactiveReports ?? [])
    .filter((report) => !report.dismissedAt)
    .slice(0, 4);

  lines.push(`資料時間：${now.toLocaleString("zh-TW")}；網路狀態：${input.isOnline === false ? "離線" : "線上或未知"}。`);

  if (topRisk) {
    lines.push(`學習/生活風險：${topRisk.level}，分數 ${topRisk.score}。${topRisk.summary}`);
  }
  if (lateAssignments.length > 0) {
    lines.push(`逾期作業：${lateAssignments.slice(0, 4).map((assignment) => `${assignment.title}${assignment.groupName ? `（${assignment.groupName}）` : ""}`).join("、")}。`);
  }
  if (dueSoonAssignments.length > 0) {
    lines.push(`72 小時內截止：${dueSoonAssignments.slice(0, 4).map((assignment) => `${assignment.title}${formatDate(assignment.dueAt) ? ` ${formatDate(assignment.dueAt)}` : ""}`).join("、")}。`);
  }
  if (nextClass) {
    lines.push(`今日下一堂課候選：${nextClass.course.name} ${nextClass.startTime ?? ""}${nextClass.location ? `，${nextClass.location}` : ""}。`);
  }
  if (topActions.length > 0) {
    lines.push(`Next Best Actions：${topActions.map((action) => `${action.title}（${action.urgency}，下一步：${action.nextStep || action.actionLabel}）`).join("；")}。`);
  }
  if (crowdedLocations.length > 0) {
    lines.push(`校園即時脈動：${crowdedLocations.map((pulse) => `${pulse.locationName} ${pulse.currentLevel}/5 ${pulse.trend}，建議時段 ${pulse.bestTimeToVisit ?? "未提供"}`).join("；")}。`);
  } else if (data.pulseAggregates.length > 0) {
    lines.push(`校園即時脈動：目前沒有 4/5 以上擁擠點，已有 ${data.pulseAggregates.length} 個地點回報。`);
  }
  if (activeOrders.length > 0) lines.push(`進行中訂單：${activeOrders.slice(0, 3).map((order) => `${order.id} ${order.status}`).join("、")}。`);
  if (activeRepairs.length > 0) lines.push(`進行中報修：${activeRepairs.slice(0, 3).map((repair) => `${repair.type} ${repair.status}`).join("、")}。`);
  if (upcomingHealth.length > 0) lines.push(`健康預約：${upcomingHealth.map((appt) => `${appt.department} ${appt.date ?? ""} ${appt.timeSlot ?? ""}`).join("、")}。`);
  if (activeReservations.length > 0) lines.push(`座位預約：${activeReservations.map((reservation) => `${reservation.seatId ?? reservation.id} ${reservation.date ?? ""}`).join("、")}。`);
  if (unreadNotifications.length > 0) lines.push(`未讀通知：${unreadNotifications.slice(0, 4).map((notification) => notification.title).join("、")}。`);
  if (proactive.length > 0) lines.push(`近期主動回報：${proactive.map((report) => `${report.title}（${report.priority}）`).join("；")}。`);

  lines.push(...buildLongTermMemoryLines(input.agentMemory));

  if (lines.length <= 1) {
    lines.push("目前沒有高優先待辦或風險訊號；回答時仍要檢查 App 資料覆蓋，不要捏造即時狀態。");
  }

  return lines.join("\n");
}

export function buildAIAppContext(input: AIAppContextInput): AIContext {
  const data = runtime(input.runtimeData);
  const appPulseSummary = buildAIAppPulseSummary(input);
  const dialogSummary = [input.dialogContextSummary, input.conversationSummary].filter(Boolean).join(" ");

  return {
    schoolId: input.schoolId,
    userId: input.userId ?? undefined,
    userName: input.userName ?? undefined,
    role: normalizeRole(input.role),
    announcements: (input.announcements ?? []).map((announcement) => ({
      id: announcement.id,
      title: announcement.title,
      source: announcement.source,
    })),
    events: (input.events ?? []).map((event) => ({
      id: event.id,
      title: event.title,
      location: event.location,
      startsAt: event.startsAt,
    })),
    menus: (input.menus ?? []).map((menu) => ({
      id: menu.id,
      name: menu.name ?? menu.cafeteria,
      price: menu.price,
      cafeteria: menu.cafeteria,
    })),
    pois: (input.pois ?? []).map((poi) => ({
      id: poi.id,
      name: poi.name,
      category: poi.category,
    })),
    courses: (input.courses ?? []).map((course) => ({
      id: course.id,
      name: course.name,
      teacher: course.teacher ?? course.instructor,
      dayOfWeek: course.dayOfWeek,
      startPeriod: course.startPeriod,
      endPeriod: course.endPeriod,
      startTime: course.startTime,
      endTime: course.endTime,
      location: course.location,
      credits: course.credits,
      schedule: (course.schedule ?? []).map((schedule) => ({
        dayOfWeek: schedule.dayOfWeek,
        startPeriod: schedule.startPeriod,
        endPeriod: schedule.endPeriod,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        location: schedule.location,
      })),
    })),
    pendingAssignments: (input.pendingAssignments ?? []).map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      groupName: assignment.groupName ?? "",
      dueAt: formatDate(assignment.dueAt),
      isLate: assignment.isLate,
    })),
    weeklyReport: input.weeklyReport
      ? {
          summary: typeof input.weeklyReport.summary === "string" ? input.weeklyReport.summary : "",
          stats: {
            onTimeRate: typeof input.weeklyReport.stats?.onTimeRate === "number" ? input.weeklyReport.stats.onTimeRate : 100,
            totalSubmissions: typeof input.weeklyReport.stats?.totalSubmissions === "number" ? input.weeklyReport.stats.totalSubmissions : 0,
            newAchievements: typeof input.weeklyReport.stats?.newAchievements === "number" ? input.weeklyReport.stats.newAchievements : 0,
          },
        }
      : undefined,
    trainingInsights: input.trainingDB ? exportTrainingInsights(input.trainingDB) : undefined,
    appPulseSummary,
    appDataCoverage: buildCoverage(input, data),
    contextSummary: dialogSummary,
  };
}

async function safeLoad<T>(label: string, load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch (error) {
    console.warn(`[AIAppContext] ${label} load failed:`, error);
    return fallback;
  }
}

export async function loadAIAppRuntimeData(params: {
  dataSource: DataSource;
  userId?: string | null;
  schoolId?: string | null;
  now?: Date;
}): Promise<AIAppRuntimeData> {
  const { dataSource, userId, schoolId } = params;
  const now = params.now ?? new Date();
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const base = emptyAIAppRuntimeData();

  const [
    pulseAggregates,
    nextBestActions,
    riskSnapshots,
    calendarEvents,
    notifications,
    orders,
    repairRequests,
    healthAppointments,
    seatReservations,
    printJobs,
    dormPackages,
    conversations,
    libraryLoans,
    washingReservations,
  ] = await Promise.all([
    dataSource.listPulseAggregates
      ? safeLoad("pulseAggregates", () => dataSource.listPulseAggregates!(schoolId ?? undefined), base.pulseAggregates)
      : Promise.resolve(base.pulseAggregates),
    userId && dataSource.listNextBestActions
      ? safeLoad("nextBestActions", () => dataSource.listNextBestActions!(userId, schoolId ?? undefined), base.nextBestActions)
      : Promise.resolve(base.nextBestActions),
    userId && dataSource.listRiskSnapshots
      ? safeLoad("riskSnapshots", () => dataSource.listRiskSnapshots!(userId, schoolId ?? undefined), base.riskSnapshots)
      : Promise.resolve(base.riskSnapshots),
    userId
      ? safeLoad("calendarEvents", () => dataSource.listCalendarEvents(userId, start.toISOString(), end.toISOString(), schoolId ?? undefined), base.calendarEvents)
      : Promise.resolve(base.calendarEvents),
    userId
      ? safeLoad("notifications", () => dataSource.listNotifications(userId, { limit: 20 }), base.notifications)
      : Promise.resolve(base.notifications),
    userId
      ? safeLoad("orders", () => dataSource.listOrders(userId, { limit: 10 }, schoolId ?? undefined), base.orders)
      : Promise.resolve(base.orders),
    userId
      ? safeLoad("repairRequests", () => dataSource.listRepairRequests(userId, { limit: 10 }, schoolId ?? undefined), base.repairRequests)
      : Promise.resolve(base.repairRequests),
    userId
      ? safeLoad("healthAppointments", () => dataSource.listHealthAppointments(userId, { limit: 10 }, schoolId ?? undefined), base.healthAppointments)
      : Promise.resolve(base.healthAppointments),
    userId
      ? safeLoad("seatReservations", () => dataSource.listSeatReservations(userId, schoolId ?? undefined), base.seatReservations)
      : Promise.resolve(base.seatReservations),
    userId
      ? safeLoad("printJobs", () => dataSource.listPrintJobs(userId, { limit: 10 }, schoolId ?? undefined), base.printJobs)
      : Promise.resolve(base.printJobs),
    userId
      ? safeLoad("dormPackages", () => dataSource.listDormPackages(userId, { limit: 10 }, schoolId ?? undefined), base.dormPackages)
      : Promise.resolve(base.dormPackages),
    userId
      ? safeLoad("conversations", () => dataSource.listConversations(userId, { limit: 10 }, schoolId ?? undefined), base.conversations)
      : Promise.resolve(base.conversations),
    userId
      ? safeLoad("libraryLoans", () => dataSource.listLoans(userId, schoolId ?? undefined), base.libraryLoans)
      : Promise.resolve(base.libraryLoans),
    userId
      ? safeLoad("washingReservations", () => dataSource.listWashingReservations(userId, schoolId ?? undefined), base.washingReservations)
      : Promise.resolve(base.washingReservations),
  ]);

  return {
    nextBestActions,
    riskSnapshots,
    pulseAggregates,
    calendarEvents,
    notifications,
    orders,
    repairRequests,
    healthAppointments,
    seatReservations,
    printJobs,
    dormPackages,
    conversations,
    libraryLoans,
    washingReservations,
  };
}
