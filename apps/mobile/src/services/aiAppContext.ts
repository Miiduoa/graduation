import type { AgentMemory, LocalTrainingDB } from '../data/puAIAgentData';
import { exportTrainingInsights } from '../data/puAIAgentData';
import type { PostLoginContext } from '../data/postLoginTypes';
import type {
  Announcement,
  AttendanceSession,
  BusRoute,
  Cafeteria,
  CalendarEvent,
  Conversation,
  Course,
  CourseModule,
  CourseSpace,
  DormPackage,
  DormitoryInfo,
  Enrollment,
  Grade,
  Group,
  HealthAppointment,
  HealthRecord,
  InboxTask,
  LibraryLoan,
  LibrarySeat,
  LostFoundItem,
  MenuItem,
  NextBestAction,
  Notification,
  Order,
  Poi,
  PrintJob,
  Printer,
  PulseAggregate,
  Quiz,
  RepairRequest,
  RoleGroup,
  SeatReservation,
  StudentRiskSnapshot,
  Transaction,
  User,
  UserAchievement,
  WashingMachine,
  WashingReservation,
} from '../data/types';
import type { DataSource } from '../data/source';
import type { AIContext } from './ai';
import type { ProactiveAIReport } from './proactiveAI';
import { getInMemoryPostLoginContext } from './postLoginContextHolder';

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
  userProfile: User | null;
  enrollments: Enrollment[];
  grades: Grade[];
  gpa: { gpa: number; totalCredits: number; totalPoints: number } | null;
  groups: Group[];
  courseSpaces: CourseSpace[];
  courseModules: CourseModule[];
  quizzes: Quiz[];
  attendanceSessions: AttendanceSession[];
  inboxTasks: InboxTask[];
  userAchievements: UserAchievement[];
  dormitoryInfo: DormitoryInfo | null;
  transactions: Transaction[];
  healthRecords: HealthRecord[];
  lostFoundItems: LostFoundItem[];
  librarySeats: LibrarySeat[];
  busRoutes: BusRoute[];
  printers: Printer[];
  washingMachines: WashingMachine[];
  loadIssues?: Record<string, string>;
};

export type AIAppContextInput = {
  schoolId: string;
  userId?: string | null;
  userName?: string | null;
  role?:
    | RoleGroup
    | 'teacher'
    | 'faculty'
    | 'staff'
    | 'student'
    | 'admin'
    | 'vendor'
    | 'guest'
    | null;
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
  events?: Array<{
    id: string;
    title: string;
    location?: string;
    startsAt?: string;
    source?: string;
  }>;
  cafeterias?: Cafeteria[];
  menus?: MenuItem[];
  pois?: Poi[];
  proactiveReports?: ProactiveAIReport[];
  runtimeData?: Partial<AIAppRuntimeData>;
  agentMemory?: AgentMemory | null;
  trainingDB?: LocalTrainingDB | null;
  /** 當前這一句使用者輸入（用於從 learnedSkills 挑出相關程序備忘） */
  lastUserMessage?: string | null;
  dialogContextSummary?: string;
  conversationSummary?: string;
  now?: Date;
  /** 若未傳，buildAIAppContext 會在 schoolId 相符時改用 getInMemoryPostLoginContext() */
  postLoginContext?: PostLoginContext | null;
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
    userProfile: null,
    enrollments: [],
    grades: [],
    gpa: null,
    groups: [],
    courseSpaces: [],
    courseModules: [],
    quizzes: [],
    attendanceSessions: [],
    inboxTasks: [],
    userAchievements: [],
    dormitoryInfo: null,
    transactions: [],
    healthRecords: [],
    lostFoundItems: [],
    librarySeats: [],
    busRoutes: [],
    printers: [],
    washingMachines: [],
    loadIssues: {},
  };
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  if (typeof value === 'object') {
    const record = value as { seconds?: unknown; _seconds?: unknown; toDate?: unknown };
    if (typeof record.toDate === 'function') {
      const parsed = (record.toDate as () => Date)();
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }
    const seconds = typeof record.seconds === 'number' ? record.seconds : record._seconds;
    if (typeof seconds === 'number') return new Date(seconds * 1000);
  }
  return null;
}

function formatDate(value: unknown): string | undefined {
  const date = toDate(value);
  if (!date) return undefined;
  return date.toLocaleString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isWithinHours(value: unknown, now: Date, hours: number): boolean {
  const date = toDate(value);
  if (!date) return false;
  const diffHours = (date.getTime() - now.getTime()) / 3_600_000;
  return diffHours >= 0 && diffHours <= hours;
}

function normalizeRole(role: AIAppContextInput['role']): AIContext['role'] {
  if (role === 'faculty') return 'teacher';
  if (role === 'vendor') return 'staff';
  if (role === 'guest' || !role) return undefined;
  if (
    role === 'student' ||
    role === 'teacher' ||
    role === 'staff' ||
    role === 'department_head' ||
    role === 'admin'
  )
    return role;
  return undefined;
}

function runtime(input?: Partial<AIAppRuntimeData>): AIAppRuntimeData {
  return { ...emptyAIAppRuntimeData(), ...(input ?? {}) };
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { code?: unknown; originalError?: unknown };
  if (typeof record.code === 'string') return record.code;
  return getErrorCode(record.originalError);
}

function isPermissionDenied(error: unknown): boolean {
  if (getErrorCode(error) === 'permission-denied') return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Missing or insufficient permissions|permission-denied/i.test(message);
}

function buildCoverage(
  input: AIAppContextInput,
  data: AIAppRuntimeData,
): NonNullable<AIContext['appDataCoverage']> {
  const rows = [
    ['courses', '課程', input.courses?.length ?? 0, 'courses'],
    ['assignments', '作業', input.pendingAssignments?.length ?? 0, 'assignments'],
    ['announcements', '公告', input.announcements?.length ?? 0, 'announcements'],
    ['events', '活動', input.events?.length ?? 0, 'events'],
    ['menus', '餐點', input.menus?.length ?? 0, 'menus'],
    ['pois', '地點', input.pois?.length ?? 0, 'pois'],
    ['pulse', '校園脈動', data.pulseAggregates.length, 'pulseAggregates'],
    ['risk', '學習風險', data.riskSnapshots.length, 'riskSnapshots'],
    ['next_actions', '下一步建議', data.nextBestActions.length, 'nextBestActions'],
    ['calendar', '行事曆', data.calendarEvents.length, 'calendarEvents'],
    ['notifications', '通知', data.notifications.length, 'notifications'],
    ['orders', '訂單', data.orders.length, 'orders'],
    ['repairs', '報修', data.repairRequests.length, 'repairRequests'],
    ['health', '健康預約', data.healthAppointments.length, 'healthAppointments'],
    ['library', '圖書借閱', data.libraryLoans.length, 'libraryLoans'],
    ['print', '列印工作', data.printJobs.length, 'printJobs'],
    ['washing', '洗衣預約', data.washingReservations.length, 'washingReservations'],
    ['dorm', '宿舍包裹', data.dormPackages.length, 'dormPackages'],
    ['profile', '使用者資料', data.userProfile ? 1 : 0, 'userProfile'],
    ['enrollments', '修課紀錄', data.enrollments.length, 'enrollments'],
    ['grades', '成績', data.grades.length, 'grades'],
    ['gpa', 'GPA', data.gpa ? 1 : 0, 'gpa'],
    ['groups', '群組', data.groups.length, 'groups'],
    ['course_spaces', '課程空間', data.courseSpaces.length, 'courseSpaces'],
    ['course_modules', '課程模組', data.courseModules.length, 'courseModules'],
    ['quizzes', '測驗', data.quizzes.length, 'quizzes'],
    ['attendance', '出席', data.attendanceSessions.length, 'attendanceSessions'],
    ['inbox', 'Inbox 任務', data.inboxTasks.length, 'inboxTasks'],
    ['achievements', '成就', data.userAchievements.length, 'userAchievements'],
    ['dormitory', '宿舍資料', data.dormitoryInfo ? 1 : 0, 'dormitoryInfo'],
    ['transactions', '交易', data.transactions.length, 'transactions'],
    ['health_records', '健康紀錄', data.healthRecords.length, 'healthRecords'],
    ['lost_found', '失物招領', data.lostFoundItems.length, 'lostFoundItems'],
    ['library_seats', '圖書館座位', data.librarySeats.length, 'librarySeats'],
    ['bus', '公車', data.busRoutes.length, 'busRoutes'],
    ['printers', '印表機', data.printers.length, 'printers'],
    ['washing_machines', '洗衣機', data.washingMachines.length, 'washingMachines'],
  ] as const;

  return rows.map(([key, label, count, issueKey]) => {
    const issue = data.loadIssues?.[issueKey];
    return {
      key,
      label,
      count,
      state: issue ? ('blocked' as const) : count > 0 ? ('live' as const) : ('empty' as const),
      detail: issue ?? (count > 0 ? `${count} 筆` : '目前無資料'),
    };
  });
}

function buildLongTermMemoryLines(memory?: AgentMemory | null): string[] {
  if (!memory) return [];
  const lines: string[] = [];
  const prefs = memory.preferences;
  const prefParts = [
    prefs.foodPreferences.length > 0
      ? `飲食偏好：${prefs.foodPreferences.slice(0, 4).join('、')}`
      : '',
    prefs.allergens.length > 0 ? `過敏：${prefs.allergens.slice(0, 4).join('、')}` : '',
    prefs.frequentLocations.length > 0
      ? `常去地點：${prefs.frequentLocations.slice(0, 4).join('、')}`
      : '',
    prefs.communicationStyle ? `溝通風格：${prefs.communicationStyle}` : '',
  ].filter(Boolean);
  if (prefParts.length > 0) lines.push(`長期偏好：${prefParts.join('；')}`);

  const learnedFacts = (memory.learnedFacts ?? [])
    .slice(-5)
    .map((fact) => fact.fact)
    .filter(Boolean);
  if (learnedFacts.length > 0) lines.push(`已學到的使用者事實：${learnedFacts.join('；')}`);

  const recentActions = (memory.recentActions ?? [])
    .slice(-5)
    .map((action) => action.toolId)
    .filter(Boolean);
  if (recentActions.length > 0) lines.push(`近期互動/操作：${recentActions.join('、')}`);

  return lines;
}

export function buildAIAppPulseSummary(input: AIAppContextInput): string {
  const data = runtime(input.runtimeData);
  const now = input.now ?? new Date();
  const lines: string[] = [];

  const lateAssignments = (input.pendingAssignments ?? []).filter(
    (assignment) => assignment.isLate,
  );
  const dueSoonAssignments = (input.pendingAssignments ?? []).filter(
    (assignment) => !assignment.isLate && isWithinHours(assignment.dueAt, now, 72),
  );
  const nextClass = (input.courses ?? [])
    .flatMap((course) => {
      const schedules =
        Array.isArray(course.schedule) && course.schedule.length > 0
          ? course.schedule
          : [
              {
                dayOfWeek: course.dayOfWeek,
                startTime: course.startTime,
                endTime: course.endTime,
                location: course.location,
              },
            ];
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
  const topActions = [...data.nextBestActions].sort((a, b) => a.priority - b.priority).slice(0, 4);
  const crowdedLocations = data.pulseAggregates
    .filter((pulse) => pulse.currentLevel >= 4)
    .sort((a, b) => b.currentLevel - a.currentLevel || b.confidence - a.confidence)
    .slice(0, 4);
  const activeOrders = data.orders.filter(
    (order) => !/completed|cancelled|refunded/i.test(compact(order.status)),
  );
  const activeRepairs = data.repairRequests.filter(
    (repair) => !/completed|cancelled/i.test(compact(repair.status)),
  );
  const upcomingHealth = data.healthAppointments.slice(0, 3);
  const activeReservations = data.seatReservations.slice(0, 3);
  const unreadNotifications = data.notifications.filter(
    (notification) => !(notification as any).read && !(notification as any).readAt,
  );
  const proactive = (input.proactiveReports ?? [])
    .filter((report) => !report.dismissedAt)
    .slice(0, 4);

  lines.push(
    `資料時間：${now.toLocaleString('zh-TW')}；網路狀態：${input.isOnline === false ? '離線' : '線上或未知'}。`,
  );

  if (topRisk) {
    lines.push(`學習/生活風險：${topRisk.level}，分數 ${topRisk.score}。${topRisk.summary}`);
  }
  if (lateAssignments.length > 0) {
    lines.push(
      `逾期作業：${lateAssignments
        .slice(0, 4)
        .map(
          (assignment) =>
            `${assignment.title}${assignment.groupName ? `（${assignment.groupName}）` : ''}`,
        )
        .join('、')}。`,
    );
  }
  if (dueSoonAssignments.length > 0) {
    lines.push(
      `72 小時內截止：${dueSoonAssignments
        .slice(0, 4)
        .map(
          (assignment) =>
            `${assignment.title}${formatDate(assignment.dueAt) ? ` ${formatDate(assignment.dueAt)}` : ''}`,
        )
        .join('、')}。`,
    );
  }
  if (nextClass) {
    lines.push(
      `今日下一堂課候選：${nextClass.course.name} ${nextClass.startTime ?? ''}${nextClass.location ? `，${nextClass.location}` : ''}。`,
    );
  }
  if (topActions.length > 0) {
    lines.push(
      `Next Best Actions：${topActions.map((action) => `${action.title}（${action.urgency}，下一步：${action.nextStep || action.actionLabel}）`).join('；')}。`,
    );
  }
  if (crowdedLocations.length > 0) {
    lines.push(
      `校園即時脈動：${crowdedLocations.map((pulse) => `${pulse.locationName} ${pulse.currentLevel}/5 ${pulse.trend}，建議時段 ${pulse.bestTimeToVisit ?? '未提供'}`).join('；')}。`,
    );
  } else if (data.pulseAggregates.length > 0) {
    lines.push(
      `校園即時脈動：目前沒有 4/5 以上擁擠點，已有 ${data.pulseAggregates.length} 個地點回報。`,
    );
  }
  if (activeOrders.length > 0)
    lines.push(
      `進行中訂單：${activeOrders
        .slice(0, 3)
        .map((order) => `${order.id} ${order.status}`)
        .join('、')}。`,
    );
  if (activeRepairs.length > 0)
    lines.push(
      `進行中報修：${activeRepairs
        .slice(0, 3)
        .map((repair) => `${repair.type} ${repair.status}`)
        .join('、')}。`,
    );
  if (upcomingHealth.length > 0)
    lines.push(
      `健康預約：${upcomingHealth.map((appt) => `${appt.department} ${appt.date ?? ''} ${appt.timeSlot ?? ''}`).join('、')}。`,
    );
  if (activeReservations.length > 0)
    lines.push(
      `座位預約：${activeReservations.map((reservation) => `${reservation.seatId ?? reservation.id} ${reservation.date ?? ''}`).join('、')}。`,
    );
  if (unreadNotifications.length > 0)
    lines.push(
      `未讀通知：${unreadNotifications
        .slice(0, 4)
        .map((notification) => notification.title)
        .join('、')}。`,
    );
  if (proactive.length > 0)
    lines.push(
      `近期主動回報：${proactive.map((report) => `${report.title}（${report.priority}）`).join('；')}。`,
    );

  lines.push(...buildLongTermMemoryLines(input.agentMemory));

  if (lines.length <= 1) {
    lines.push('目前沒有高優先待辦或風險訊號；回答時仍要檢查 App 資料覆蓋，不要捏造即時狀態。');
  }

  return lines.join('\n');
}

function compactRecord(value: unknown, maxChars = 360): string {
  try {
    const json = JSON.stringify(value ?? null);
    return json.length > maxChars ? `${json.slice(0, maxChars)}...` : json;
  } catch {
    return String(value ?? '').slice(0, maxChars);
  }
}

function buildAppDataRecords(
  input: AIAppContextInput,
  data: AIAppRuntimeData,
): NonNullable<AIContext['appDataRecords']> {
  const records: NonNullable<AIContext['appDataRecords']> = [];
  const add = (key: string, label: string, text: string, priority = 0) => {
    const clean = text.trim();
    if (!clean) return;
    records.push({ key, label, text: clean, priority });
  };
  const addMany = <T,>(
    key: string,
    label: string,
    rows: T[] | undefined,
    summarize: (row: T, index: number) => string,
    priority = 0,
    limit = 30,
  ) => {
    (rows ?? []).slice(0, limit).forEach((row, index) => add(key, label, summarize(row, index), priority));
  };

  if (data.userProfile) {
    add(
      'profile',
      '使用者資料',
      compactRecord({
        id: data.userProfile.id,
        name: data.userProfile.displayName,
        email: data.userProfile.email,
        studentId: data.userProfile.studentId,
        department: data.userProfile.department,
        year: data.userProfile.year,
        role: data.userProfile.role,
        schoolId: data.userProfile.schoolId,
        balance: data.userProfile.balance,
      }),
      80,
    );
  } else if (input.userId || input.userName) {
    add(
      'profile',
      '使用者資料',
      compactRecord({
        id: input.userId,
        name: input.userName,
        role: input.role,
        schoolId: input.schoolId,
      }),
      60,
    );
  }

  addMany('courses', '課程', input.courses, (course) => compactRecord({
    id: course.id,
    name: course.name,
    teacher: course.teacher ?? course.instructor,
    location: course.location,
    dayOfWeek: course.dayOfWeek,
    startTime: course.startTime,
    endTime: course.endTime,
    credits: course.credits,
    schedule: course.schedule,
  }), 70);
  addMany('assignments', '作業', input.pendingAssignments, (assignment) => compactRecord(assignment), 78);
  addMany('enrollments', '修課紀錄', data.enrollments, (row) => compactRecord(row), 58);
  addMany('grades', '成績', data.grades, (row) => compactRecord(row), 75);
  if (data.gpa) add('gpa', 'GPA', compactRecord(data.gpa), 75);

  addMany('course_spaces', '課程空間', data.courseSpaces, (row) => compactRecord(row), 52);
  addMany('course_modules', '課程模組', data.courseModules, (row) => compactRecord(row), 45);
  addMany('quizzes', '測驗', data.quizzes, (row) => compactRecord(row), 55);
  addMany('attendance', '出席', data.attendanceSessions, (row) => compactRecord(row), 55);
  addMany('inbox', 'Inbox 任務', data.inboxTasks, (row) => compactRecord(row), 68);

  addMany('announcements', '公告', input.announcements, (row) => compactRecord(row), 30);
  addMany('events', '活動', input.events, (row) => compactRecord(row), 30);
  addMany('cafeterias', '餐廳', input.cafeterias, (row) => compactRecord(row), 25);
  addMany('menus', '餐點', input.menus, (row) => compactRecord(row), 45);
  addMany('pois', '地點', input.pois, (row) => compactRecord(row), 45);
  addMany('pulse', '校園脈動', data.pulseAggregates, (row) => compactRecord(row), 40);
  addMany('next_actions', '下一步建議', data.nextBestActions, (row) => compactRecord(row), 72);
  addMany('risk', '學習風險', data.riskSnapshots, (row) => compactRecord(row), 72);

  addMany('calendar', '行事曆', data.calendarEvents, (row) => compactRecord(row), 70);
  addMany('notifications', '通知', data.notifications, (row) => compactRecord(row), 60);
  addMany('conversations', '訊息對話', data.conversations, (row) => compactRecord(row), 48);
  addMany('groups', '群組', data.groups, (row) => compactRecord(row), 45);

  addMany('orders', '訂單', data.orders, (row) => compactRecord(row), 70);
  addMany('transactions', '交易', data.transactions, (row) => compactRecord(row), 62);

  addMany('library', '圖書借閱', data.libraryLoans, (row) => compactRecord(row), 68);
  addMany('library_seats', '圖書館座位', data.librarySeats, (row) => compactRecord(row), 42);
  addMany('seat_reservations', '座位預約', data.seatReservations, (row) => compactRecord(row), 68);

  if (data.dormitoryInfo) add('dormitory', '宿舍資料', compactRecord(data.dormitoryInfo), 68);
  addMany('repairs', '報修', data.repairRequests, (row) => compactRecord(row), 65);
  addMany('dorm', '宿舍包裹', data.dormPackages, (row) => compactRecord(row), 62);
  addMany('washing', '洗衣預約', data.washingReservations, (row) => compactRecord(row), 62);
  addMany('washing_machines', '洗衣機', data.washingMachines, (row) => compactRecord(row), 40);

  addMany('print', '列印工作', data.printJobs, (row) => compactRecord(row), 65);
  addMany('printers', '印表機', data.printers, (row) => compactRecord(row), 40);

  addMany('health', '健康預約', data.healthAppointments, (row) => compactRecord(row), 65);
  addMany('health_records', '健康紀錄', data.healthRecords, (row) => compactRecord(row), 62);

  addMany('achievements', '成就', data.userAchievements, (row) => compactRecord(row), 45);
  addMany('lost_found', '失物招領', data.lostFoundItems, (row) => compactRecord(row), 35);
  addMany('bus', '公車', data.busRoutes, (row) => compactRecord(row), 35);

  return records;
}

function roleFromPostLoginContext(plc: PostLoginContext): AIAppContextInput['role'] {
  switch (plc.roles.primaryRole) {
    case 'student':
      return 'student';
    case 'teacher':
      return 'teacher';
    case 'departmentAdmin':
      return 'department_head';
    case 'admin':
      return 'admin';
    case 'staff':
    case 'shopOwner':
      return 'staff';
    default:
      return 'student';
  }
}

function postLoginCoursesToAiCourses(plc: PostLoginContext): Course[] {
  const student = plc.asStudent?.courses ?? [];
  const teaching = plc.asTeacher?.teachingCourses ?? [];
  const byId = new Map<string, (typeof student)[0]>();
  for (const c of student) byId.set(c.id, c);
  for (const c of teaching) byId.set(c.id, c);
  return [...byId.values()].map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    instructor: c.teacherNames?.[0] ?? '',
    credits: c.credits,
    semester: c.semesterId,
    schedule: (c.schedule ?? []).map((s) => ({
      dayOfWeek: s.weekday,
      startTime: '',
      endTime: '',
      location: s.room ?? '',
      startPeriod: s.periodStart,
      endPeriod: s.periodEnd,
    })),
  }));
}

/** 當畫面未帶課程／作業／公告時，優先使用 PostLoginContext（記憶體或呼叫端傳入） */
function mergeWithPostLoginContext(raw: AIAppContextInput): AIAppContextInput {
  const plc =
    raw.postLoginContext ??
    (() => {
      const m = getInMemoryPostLoginContext();
      return m && m.schoolId === raw.schoolId ? m : null;
    })();
  if (!plc) return raw;

  const coursesFromPlc = postLoginCoursesToAiCourses(plc);
  const pendingFromPlc =
    plc.asStudent?.pendingAssignments?.map((a) => ({
      id: a.id,
      title: a.title,
      groupName: a.courseId,
      dueAt: a.dueAt,
      isLate: a.status === 'overdue',
    })) ?? [];
  const announcementsFromPlc = plc.latestAnnouncements.map((a) => ({
    id: a.id,
    title: a.title,
    body: '',
    publishedAt: a.publishedAt,
    source: a.source,
  }));

  return {
    ...raw,
    role: raw.role ?? roleFromPostLoginContext(plc),
    courses: raw.courses?.length ? raw.courses : coursesFromPlc,
    pendingAssignments: raw.pendingAssignments?.length ? raw.pendingAssignments : pendingFromPlc,
    announcements: raw.announcements?.length ? raw.announcements : announcementsFromPlc,
  };
}

export function buildAIAppContext(raw: AIAppContextInput): AIContext {
  const input = mergeWithPostLoginContext(raw);
  const data = runtime(input.runtimeData);
  const appPulseSummary = buildAIAppPulseSummary(input);
  const dialogSummary = [input.dialogContextSummary, input.conversationSummary]
    .filter(Boolean)
    .join(' ');

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
      category: menu.category != null ? String(menu.category) : undefined,
      isPopular: Boolean(menu.popular),
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
      groupName: assignment.groupName ?? '',
      dueAt: formatDate(assignment.dueAt),
      isLate: assignment.isLate,
    })),
    weeklyReport: input.weeklyReport
      ? {
          summary: typeof input.weeklyReport.summary === 'string' ? input.weeklyReport.summary : '',
          stats: {
            onTimeRate:
              typeof input.weeklyReport.stats?.onTimeRate === 'number'
                ? input.weeklyReport.stats.onTimeRate
                : 100,
            totalSubmissions:
              typeof input.weeklyReport.stats?.totalSubmissions === 'number'
                ? input.weeklyReport.stats.totalSubmissions
                : 0,
            newAchievements:
              typeof input.weeklyReport.stats?.newAchievements === 'number'
                ? input.weeklyReport.stats.newAchievements
                : 0,
          },
        }
      : undefined,
    calendarEvents: data.calendarEvents.slice(0, 12).map((event) => ({
      id: event.id,
      title: event.title,
      startAt: event.startAt ?? event.startDate,
      endAt: event.endAt ?? event.endDate,
      location: event.location,
      type: event.type,
    })),
    notifications: data.notifications.slice(0, 12).map((notification) => ({
      id: notification.id,
      title: notification.title,
      body: notification.body,
      read: notification.read,
    })),
    conversations: data.conversations.slice(0, 10).map((conversation) => ({
      id: conversation.id,
      memberCount: conversation.memberIds?.length,
      unreadCount: conversation.unreadCount,
      lastMessageAt: conversation.lastMessageAt,
      lastMessage: conversation.lastMessage?.content,
    })),
    orders: data.orders.slice(0, 10).map((order) => ({
      id: order.id,
      status: order.status,
      cafeteria: order.cafeteria,
      merchantName: order.merchantName,
      total: order.total ?? order.totalAmount ?? order.totalPrice,
      items: (order.items ?? []).slice(0, 6).map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
      })),
    })),
    repairRequests: data.repairRequests.slice(0, 10).map((request) => ({
      id: request.id,
      type: request.type,
      title: request.title,
      status: request.status,
      room: request.room,
      priority: request.priority,
    })),
    healthAppointments: data.healthAppointments.slice(0, 10).map((appointment) => ({
      id: appointment.id,
      department: appointment.department,
      date: appointment.date,
      timeSlot: appointment.timeSlot,
      status: appointment.status,
      doctorName: appointment.doctorName,
    })),
    seatReservations: data.seatReservations.slice(0, 10).map((reservation) => ({
      id: reservation.id,
      seatId: reservation.seatId,
      date: reservation.date,
      startTime: reservation.startTime,
      endTime: reservation.endTime,
      status: reservation.status,
    })),
    libraryLoans: data.libraryLoans.slice(0, 10).map((loan) => ({
      id: loan.id,
      bookId: loan.bookId,
      bookTitle: loan.book?.title,
      dueAt: loan.dueAt ?? loan.dueDate,
      status: loan.status,
    })),
    printJobs: data.printJobs.slice(0, 10).map((job) => ({
      id: job.id,
      printerId: job.printerId,
      fileName: job.fileName,
      pages: job.pages,
      status: job.status,
      cost: job.cost,
    })),
    washingReservations: data.washingReservations.slice(0, 10).map((reservation) => ({
      id: reservation.id,
      machineId: reservation.machineId,
      startTime: reservation.startTime,
      endTime: reservation.endTime,
      status: reservation.status,
    })),
    dormPackages: data.dormPackages.slice(0, 10).map((pkg) => ({
      id: pkg.id,
      carrier: pkg.carrier,
      trackingNumber: pkg.trackingNumber,
      status: pkg.status,
      location: pkg.location,
    })),
    trainingInsights: input.trainingDB
      ? exportTrainingInsights(input.trainingDB, input.lastUserMessage)
      : undefined,
    appPulseSummary,
    appDataCoverage: buildCoverage(input, data),
    appDataRecords: buildAppDataRecords(input, data),
    contextSummary: dialogSummary,
  };
}

async function safeLoad<T>(
  label: string,
  load: () => Promise<T>,
  fallback: T,
  loadIssues?: Record<string, string>,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    const logger = isPermissionDenied(error) ? console.debug : console.warn;
    logger(`[AIAppContext] ${label} load failed:`, error);
    if (loadIssues) {
      const code = getErrorCode(error);
      const message = (error as any)?.message ?? (error as any)?.originalError?.message ?? '載入失敗';
      loadIssues[label] = code ? `${code}: ${message}` : String(message);
    }
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
  const loadIssues: Record<string, string> = {};

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
    userProfile,
    enrollments,
    grades,
    gpa,
    groups,
    courseSpaces,
    courseModules,
    quizzes,
    attendanceSessions,
    inboxTasks,
    userAchievements,
    dormitoryInfo,
    transactions,
    healthRecords,
    lostFoundItems,
    librarySeats,
    busRoutes,
    printers,
    washingMachines,
  ] = await Promise.all([
    dataSource.listPulseAggregates
      ? safeLoad(
          'pulseAggregates',
          () => dataSource.listPulseAggregates!(schoolId ?? undefined),
          base.pulseAggregates,
          loadIssues,
        )
      : Promise.resolve(base.pulseAggregates),
    userId && dataSource.listNextBestActions
      ? safeLoad(
          'nextBestActions',
          () => dataSource.listNextBestActions!(userId, schoolId ?? undefined),
          base.nextBestActions,
          loadIssues,
        )
      : Promise.resolve(base.nextBestActions),
    userId && dataSource.listRiskSnapshots
      ? safeLoad(
          'riskSnapshots',
          () => dataSource.listRiskSnapshots!(userId, schoolId ?? undefined),
          base.riskSnapshots,
          loadIssues,
        )
      : Promise.resolve(base.riskSnapshots),
    userId
      ? safeLoad(
          'calendarEvents',
          () =>
            dataSource.listCalendarEvents(
              userId,
              start.toISOString(),
              end.toISOString(),
              schoolId ?? undefined,
            ),
          base.calendarEvents,
          loadIssues,
        )
      : Promise.resolve(base.calendarEvents),
    userId
      ? safeLoad(
          'notifications',
          () => dataSource.listNotifications(userId, { limit: 20 }),
          base.notifications,
          loadIssues,
        )
      : Promise.resolve(base.notifications),
    userId
      ? safeLoad(
          'orders',
          () => dataSource.listOrders(userId, { limit: 10 }, schoolId ?? undefined),
          base.orders,
          loadIssues,
        )
      : Promise.resolve(base.orders),
    userId
      ? safeLoad(
          'repairRequests',
          () => dataSource.listRepairRequests(userId, { limit: 10 }, schoolId ?? undefined),
          base.repairRequests,
          loadIssues,
        )
      : Promise.resolve(base.repairRequests),
    userId
      ? safeLoad(
          'healthAppointments',
          () => dataSource.listHealthAppointments(userId, { limit: 10 }, schoolId ?? undefined),
          base.healthAppointments,
          loadIssues,
        )
      : Promise.resolve(base.healthAppointments),
    userId
      ? safeLoad(
          'seatReservations',
          () => dataSource.listSeatReservations(userId, schoolId ?? undefined),
          base.seatReservations,
          loadIssues,
        )
      : Promise.resolve(base.seatReservations),
    userId
      ? safeLoad(
          'printJobs',
          () => dataSource.listPrintJobs(userId, { limit: 10 }, schoolId ?? undefined),
          base.printJobs,
          loadIssues,
        )
      : Promise.resolve(base.printJobs),
    userId
      ? safeLoad(
          'dormPackages',
          () => dataSource.listDormPackages(userId, { limit: 10 }, schoolId ?? undefined),
          base.dormPackages,
          loadIssues,
        )
      : Promise.resolve(base.dormPackages),
    userId
      ? safeLoad(
          'conversations',
          () => dataSource.listConversations(userId, { limit: 10 }, schoolId ?? undefined),
          base.conversations,
          loadIssues,
        )
      : Promise.resolve(base.conversations),
    userId
      ? safeLoad(
          'libraryLoans',
          () => dataSource.listLoans(userId, schoolId ?? undefined),
          base.libraryLoans,
          loadIssues,
        )
      : Promise.resolve(base.libraryLoans),
    userId
      ? safeLoad(
          'washingReservations',
          () => dataSource.listWashingReservations(userId, schoolId ?? undefined),
          base.washingReservations,
          loadIssues,
        )
      : Promise.resolve(base.washingReservations),
    userId
      ? safeLoad('userProfile', () => dataSource.getUser(userId), base.userProfile, loadIssues)
      : Promise.resolve(base.userProfile),
    userId
      ? safeLoad(
          'enrollments',
          () => dataSource.listEnrollments(userId, undefined, schoolId ?? undefined),
          base.enrollments,
          loadIssues,
        )
      : Promise.resolve(base.enrollments),
    userId
      ? safeLoad(
          'grades',
          () => dataSource.listGrades(userId, undefined, schoolId ?? undefined),
          base.grades,
          loadIssues,
        )
      : Promise.resolve(base.grades),
    userId
      ? safeLoad('gpa', () => dataSource.getGPA(userId, schoolId ?? undefined), base.gpa, loadIssues)
      : Promise.resolve(base.gpa),
    userId
      ? safeLoad('groups', () => dataSource.listGroups(userId, { limit: 20 }), base.groups, loadIssues)
      : Promise.resolve(base.groups),
    userId
      ? safeLoad(
          'courseSpaces',
          () => dataSource.listCourseSpaces(userId, schoolId ?? undefined),
          base.courseSpaces,
          loadIssues,
        )
      : Promise.resolve(base.courseSpaces),
    userId
      ? safeLoad(
          'courseModules',
          () => dataSource.listCourseModules(userId, undefined, schoolId ?? undefined),
          base.courseModules,
          loadIssues,
        )
      : Promise.resolve(base.courseModules),
    userId
      ? safeLoad(
          'quizzes',
          () => dataSource.listQuizzes(userId, undefined, schoolId ?? undefined),
          base.quizzes,
          loadIssues,
        )
      : Promise.resolve(base.quizzes),
    userId
      ? safeLoad(
          'attendanceSessions',
          () => dataSource.listAttendanceSessions(userId, undefined, schoolId ?? undefined),
          base.attendanceSessions,
          loadIssues,
        )
      : Promise.resolve(base.attendanceSessions),
    userId
      ? safeLoad(
          'inboxTasks',
          () => dataSource.listInboxTasks(userId, schoolId ?? undefined),
          base.inboxTasks,
          loadIssues,
        )
      : Promise.resolve(base.inboxTasks),
    userId
      ? safeLoad(
          'userAchievements',
          () => dataSource.getUserAchievements(userId, schoolId ?? undefined),
          base.userAchievements,
          loadIssues,
        )
      : Promise.resolve(base.userAchievements),
    userId
      ? safeLoad('dormitoryInfo', () => dataSource.getDormitoryInfo(userId), base.dormitoryInfo, loadIssues)
      : Promise.resolve(base.dormitoryInfo),
    userId
      ? safeLoad(
          'transactions',
          () => dataSource.listTransactions(userId, { limit: 20 }, schoolId ?? undefined),
          base.transactions,
          loadIssues,
        )
      : Promise.resolve(base.transactions),
    userId
      ? safeLoad(
          'healthRecords',
          () => dataSource.listHealthRecords(userId, { limit: 20 }, schoolId ?? undefined),
          base.healthRecords,
          loadIssues,
        )
      : Promise.resolve(base.healthRecords),
    safeLoad(
      'lostFoundItems',
      () => dataSource.listLostFoundItems(schoolId ?? undefined, { limit: 20 }),
      base.lostFoundItems,
      loadIssues,
    ),
    safeLoad(
      'librarySeats',
      () => dataSource.listSeats(schoolId ?? undefined),
      base.librarySeats,
      loadIssues,
    ),
    safeLoad(
      'busRoutes',
      () => dataSource.listBusRoutes(schoolId ?? undefined),
      base.busRoutes,
      loadIssues,
    ),
    safeLoad(
      'printers',
      () => dataSource.listPrinters(schoolId ?? undefined, { limit: 20 }),
      base.printers,
      loadIssues,
    ),
    safeLoad(
      'washingMachines',
      () => dataSource.listWashingMachines(schoolId ?? undefined),
      base.washingMachines,
      loadIssues,
    ),
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
    userProfile,
    enrollments,
    grades,
    gpa,
    groups,
    courseSpaces,
    courseModules,
    quizzes,
    attendanceSessions,
    inboxTasks,
    userAchievements,
    dormitoryInfo,
    transactions,
    healthRecords,
    lostFoundItems,
    librarySeats,
    busRoutes,
    printers,
    washingMachines,
    loadIssues,
  };
}

// ════════════════════════════════════════════════════════════
// AI Ambient Awareness（原 aiAmbientAwareness.ts，已併入）
// ════════════════════════════════════════════════════════════

import { loadAiPersonalContext, type AiPersonalContext } from '../features/ai';

export type AIAmbientAwarenessReason =
  | 'startup'
  | 'mount'
  | 'foreground-timer'
  | 'app-active'
  | 'app-background'
  | 'manual';

export type AIAmbientAwarenessSnapshot = {
  runtimeData: AIAppRuntimeData;
  personalContext: AiPersonalContext | null;
  refreshedAt: number;
  reason: AIAmbientAwarenessReason | string;
};

const DEFAULT_MIN_INTERVAL_MS = 15_000;

let _ambientSnapshot: AIAmbientAwarenessSnapshot = {
  runtimeData: emptyAIAppRuntimeData(),
  personalContext: null,
  refreshedAt: 0,
  reason: 'startup',
};
let _ambientInFlight: Promise<AIAmbientAwarenessSnapshot> | null = null;
const _ambientListeners = new Set<(snapshot: AIAmbientAwarenessSnapshot) => void>();

function _notifyAmbient(snapshot: AIAmbientAwarenessSnapshot) {
  _ambientListeners.forEach((listener) => {
    try { listener(snapshot); } catch (e) { console.warn('[AIAmbientAwareness] listener failed:', e); }
  });
}

export function getAIAmbientAwarenessSnapshot(): AIAmbientAwarenessSnapshot {
  return _ambientSnapshot;
}

export function subscribeAIAmbientAwareness(
  listener: (snapshot: AIAmbientAwarenessSnapshot) => void,
): () => void {
  _ambientListeners.add(listener);
  listener(_ambientSnapshot);
  return () => { _ambientListeners.delete(listener); };
}

export async function refreshAIAmbientAwareness(params: {
  dataSource: DataSource;
  userId?: string | null;
  schoolId?: string | null;
  reason?: AIAmbientAwarenessReason | string;
  force?: boolean;
  minIntervalMs?: number;
}): Promise<AIAmbientAwarenessSnapshot> {
  const now = Date.now();
  const minIntervalMs = params.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  if (!params.force && now - _ambientSnapshot.refreshedAt < minIntervalMs) return _ambientSnapshot;
  if (_ambientInFlight) return _ambientInFlight;

  _ambientInFlight = (async () => {
    try {
      const [runtimeData, personalContext] = await Promise.all([
        loadAIAppRuntimeData({
          dataSource: params.dataSource,
          userId: params.userId ?? null,
          schoolId: params.schoolId ?? null,
        }),
        params.userId && params.schoolId
          ? loadAiPersonalContext({ uid: params.userId, schoolId: params.schoolId }).catch((e) => {
              console.warn('[AIAmbientAwareness] personal context load failed:', e);
              return null;
            })
          : Promise.resolve(null),
      ]);

      _ambientSnapshot = {
        runtimeData,
        personalContext,
        refreshedAt: Date.now(),
        reason: params.reason ?? 'manual',
      };
      _notifyAmbient(_ambientSnapshot);
      return _ambientSnapshot;
    } catch (error) {
      console.warn('[AIAmbientAwareness] refresh failed:', error);
      return _ambientSnapshot;
    } finally {
      _ambientInFlight = null;
    }
  })();

  return _ambientInFlight;
}
