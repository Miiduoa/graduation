import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import type { Announcement, Course } from '../data/types';
import type { PendingGroupAssignment } from '../features/groups';
import { getScopedStorageKey } from './scopedStorage';
import {
  cancelNotification,
  checkPushPermission,
  scheduleLocalNotification,
  sendImmediateNotification,
} from './notifications';

export type ProactiveAIReportKind =
  | 'daily_brief'
  | 'class_soon'
  | 'assignment_due'
  | 'assignment_late'
  | 'announcement';

export type ProactiveAIReportPriority = 'critical' | 'high' | 'medium' | 'low';

export type ProactiveAIReport = {
  id: string;
  kind: ProactiveAIReportKind;
  priority: ProactiveAIReportPriority;
  title: string;
  body: string;
  createdAt: string;
  expiresAt?: string;
  sourceHash: string;
  seenInChat?: boolean;
  notifiedAt?: string;
  dismissedAt?: string;
  data?: Record<string, unknown>;
  suggestions?: string[];
  actions?: Array<{ label: string; action: string; params?: Record<string, unknown> }>;
};

export type ProactiveAIReportInput = {
  userId?: string | null;
  schoolId?: string | null;
  courses?: Course[];
  pendingAssignments?: Array<
    | PendingGroupAssignment
    | {
        id: string;
        groupId?: string;
        groupName?: string;
        title: string;
        dueAt?: string | number | Date | { seconds?: number; _seconds?: number } | null;
        isLate?: boolean;
      }
  >;
  announcements?: Announcement[];
};

type ProactiveAIState = {
  lastSyncAt?: string;
  lastScheduleHash?: string;
  scheduledNotificationIds: string[];
};

type CourseMeetingRow = {
  course: Course;
  dayOfWeek: number;
  startTime?: string;
  endTime?: string;
  location?: string;
};

type NotificationPlan = {
  title: string;
  body: string;
  data: Record<string, unknown>;
  trigger: Notifications.NotificationTriggerInput;
};

const AI_NOTIFICATION_CHANNEL = 'ai-agent';
const MAX_STORED_REPORTS = 80;
const CLASS_LEAD_MINUTES = 45;

const PRIORITY_RANK: Record<ProactiveAIReportPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function endOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function timeToMinutes(value?: string): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === 'number' || typeof value === 'string') {
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
    if (typeof seconds === 'number') {
      return new Date(seconds * 1000);
    }
  }
  return null;
}

function formatDateTime(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatMeetingTime(row: CourseMeetingRow): string {
  if (row.startTime && row.endTime) return `${row.startTime}-${row.endTime}`;
  if (row.startTime) return row.startTime;
  return '時間未提供';
}

function meetingStartDate(row: CourseMeetingRow, baseDate: Date): Date | null {
  const startMinutes = timeToMinutes(row.startTime);
  if (startMinutes == null) return null;
  const date = new Date(baseDate);
  date.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  return date;
}

function getCourseMeetingRows(courses: Course[] = []): CourseMeetingRow[] {
  return courses.flatMap((course) => {
    const rows =
      Array.isArray(course.schedule) && course.schedule.length > 0
        ? course.schedule.map((meeting) => ({
            course,
            dayOfWeek: meeting.dayOfWeek ?? course.dayOfWeek ?? 0,
            startTime: meeting.startTime ?? course.startTime,
            endTime: meeting.endTime ?? course.endTime,
            location: meeting.location ?? course.location,
          }))
        : [
            {
              course,
              dayOfWeek: course.dayOfWeek ?? 0,
              startTime: course.startTime,
              endTime: course.endTime,
              location: course.location,
            },
          ];

    return rows.filter((row) => row.dayOfWeek >= 0 && row.dayOfWeek <= 6);
  });
}

function normalizeAssignmentDueAt(
  assignment: ProactiveAIReportInput['pendingAssignments'][number],
): Date | null {
  return toDate((assignment as { dueAt?: unknown }).dueAt);
}

function reportSort(left: ProactiveAIReport, right: ProactiveAIReport): number {
  const priorityDiff = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
  if (priorityDiff !== 0) return priorityDiff;
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

function createReport(params: Omit<ProactiveAIReport, 'sourceHash'>): ProactiveAIReport {
  return {
    ...params,
    sourceHash: shortHash(
      `${params.kind}:${params.title}:${params.body}:${JSON.stringify(params.data ?? {})}`,
    ),
  };
}

function isImportantAnnouncement(announcement: Announcement): boolean {
  return /緊急|重要|停課|異動|截止|申請|報名|獎學金|停水|停電|安全|延長/.test(
    `${announcement.title} ${announcement.body ?? ''}`,
  );
}

function buildDailyBrief(input: ProactiveAIReportInput, now: Date): ProactiveAIReport | null {
  const today = now.getDay();
  const rows = getCourseMeetingRows(input.courses ?? [])
    .filter((row) => row.dayOfWeek === today)
    .sort(
      (left, right) =>
        (timeToMinutes(left.startTime) ?? 9999) - (timeToMinutes(right.startTime) ?? 9999),
    );
  const assignments = input.pendingAssignments ?? [];
  const dueSoon = assignments.filter((assignment) => {
    if (assignment.isLate) return true;
    const dueAt = normalizeAssignmentDueAt(assignment);
    if (!dueAt) return false;
    const diffHours = (dueAt.getTime() - now.getTime()) / 3_600_000;
    return diffHours >= 0 && diffHours <= 72;
  });
  const importantAnnouncements = (input.announcements ?? [])
    .filter(isImportantAnnouncement)
    .slice(0, 2);

  if (rows.length === 0 && dueSoon.length === 0 && importantAnnouncements.length === 0) {
    return null;
  }

  const lines: string[] = [];
  if (rows.length > 0) {
    lines.push(`今天有 ${rows.length} 堂課：`);
    rows.slice(0, 4).forEach((row, index) => {
      lines.push(
        `${index + 1}. ${row.course.name} ${formatMeetingTime(row)}${row.location ? `，${row.location}` : ''}`,
      );
    });
  } else {
    lines.push('今天沒有載入課程。');
  }

  if (dueSoon.length > 0) {
    lines.push('');
    lines.push(`待注意作業 ${dueSoon.length} 項：`);
    dueSoon.slice(0, 3).forEach((assignment, index) => {
      const dueAt = normalizeAssignmentDueAt(assignment);
      const dueText = assignment.isLate
        ? '已逾期'
        : dueAt
          ? `截止 ${formatDateTime(dueAt)}`
          : '截止時間未提供';
      lines.push(
        `${index + 1}. ${assignment.title}（${assignment.groupName ?? '課程'}）${dueText ? `：${dueText}` : ''}`,
      );
    });
  }

  if (importantAnnouncements.length > 0) {
    lines.push('');
    lines.push('重要公告：');
    importantAnnouncements.forEach((announcement, index) => {
      lines.push(`${index + 1}. ${announcement.title}`);
    });
  }

  return createReport({
    id: `daily-${dateKey(now)}`,
    kind: 'daily_brief',
    priority: dueSoon.some((assignment) => assignment.isLate) ? 'high' : 'medium',
    title: 'AI 今日主動回報',
    body: lines.join('\n'),
    createdAt: now.toISOString(),
    expiresAt: endOfDay(now).toISOString(),
    data: { type: 'ai_proactive', date: dateKey(now) },
    suggestions: ['今天有什麼課', '查作業截止', '查公告'],
    actions: [
      {
        label: '查看課表',
        action: 'navigate',
        params: { screen: '課程', nested: 'CourseSchedule' },
      },
      { label: '查看收件匣', action: 'navigate', params: { screen: '收件匣', nested: 'Inbox' } },
    ],
  });
}

function buildClassSoonReports(input: ProactiveAIReportInput, now: Date): ProactiveAIReport[] {
  return getCourseMeetingRows(input.courses ?? [])
    .filter((row) => row.dayOfWeek === now.getDay())
    .map((row) => ({ row, startAt: meetingStartDate(row, now) }))
    .filter((entry): entry is { row: CourseMeetingRow; startAt: Date } => !!entry.startAt)
    .map(({ row, startAt }) => {
      const minutes = Math.round((startAt.getTime() - now.getTime()) / 60_000);
      return { row, startAt, minutes };
    })
    .filter(({ minutes }) => minutes >= 0 && minutes <= CLASS_LEAD_MINUTES)
    .map(({ row, startAt, minutes }) =>
      createReport({
        id: `class-${dateKey(now)}-${row.course.id}-${row.startTime ?? 'unknown'}`,
        kind: 'class_soon',
        priority: minutes <= 15 ? 'high' : 'medium',
        title: `${minutes <= 1 ? '現在' : `${minutes} 分鐘後`}要上課`,
        body: `${row.course.name} ${formatMeetingTime(row)}${row.location ? `，地點 ${row.location}` : ''}。建議現在確認教材、路線和出門時間。`,
        createdAt: now.toISOString(),
        expiresAt: addMinutes(startAt, 30).toISOString(),
        data: {
          type: 'ai_proactive',
          courseId: row.course.id,
          courseName: row.course.name,
          startsAt: startAt.toISOString(),
        },
        suggestions: ['今天有什麼課', '幫我請假草稿', '怎麼去教室'],
        actions: [
          {
            label: '打開課表',
            action: 'navigate',
            params: { screen: '課程', nested: 'CourseSchedule' },
          },
        ],
      }),
    );
}

function buildAssignmentReports(input: ProactiveAIReportInput, now: Date): ProactiveAIReport[] {
  return (input.pendingAssignments ?? []).flatMap((assignment) => {
    const dueAt = normalizeAssignmentDueAt(assignment);
    const baseData = {
      type: 'ai_proactive',
      assignmentId: assignment.id,
      groupId: assignment.groupId,
      groupName: assignment.groupName,
    };

    if (assignment.isLate) {
      return [
        createReport({
          id: `assignment-late-${assignment.id}-${dateKey(now)}`,
          kind: 'assignment_late',
          priority: 'critical',
          title: '作業已逾期',
          body: `${assignment.title}（${assignment.groupName ?? '課程'}）已逾期。建議先確認是否仍可補交，必要時我可以幫你寫詢問老師的訊息草稿。`,
          createdAt: now.toISOString(),
          expiresAt: endOfDay(now).toISOString(),
          data: baseData,
          suggestions: ['幫我寫詢問老師訊息', '查其他作業', '整理補交流程'],
          actions: assignment.groupId
            ? [
                {
                  label: '查看作業',
                  action: 'navigate',
                  params: {
                    screen: '收件匣',
                    nested: 'AssignmentDetail',
                    groupId: assignment.groupId,
                    assignmentId: assignment.id,
                  },
                },
              ]
            : [
                {
                  label: '查看收件匣',
                  action: 'navigate',
                  params: { screen: '收件匣', nested: 'Inbox' },
                },
              ],
        }),
      ];
    }

    if (!dueAt) return [];
    const diffHours = (dueAt.getTime() - now.getTime()) / 3_600_000;
    if (diffHours < 0 || diffHours > 48) return [];

    const soonText =
      diffHours < 1
        ? '1 小時內'
        : diffHours < 24
          ? `${Math.ceil(diffHours)} 小時內`
          : `${Math.ceil(diffHours / 24)} 天內`;

    return [
      createReport({
        id: `assignment-due-${assignment.id}-${dateKey(dueAt)}`,
        kind: 'assignment_due',
        priority: diffHours <= 6 ? 'high' : 'medium',
        title: '作業快截止',
        body: `${assignment.title}（${assignment.groupName ?? '課程'}）將在 ${soonText} 截止：${formatDateTime(dueAt)}。建議現在確認需求、檔案和繳交入口。`,
        createdAt: now.toISOString(),
        expiresAt: addMinutes(dueAt, 60 * 24).toISOString(),
        data: { ...baseData, dueAt: dueAt.toISOString() },
        suggestions: ['幫我拆解待辦', '幫我寫詢問老師訊息', '查其他作業'],
        actions: assignment.groupId
          ? [
              {
                label: '查看作業',
                action: 'navigate',
                params: {
                  screen: '收件匣',
                  nested: 'AssignmentDetail',
                  groupId: assignment.groupId,
                  assignmentId: assignment.id,
                },
              },
            ]
          : [
              {
                label: '查看收件匣',
                action: 'navigate',
                params: { screen: '收件匣', nested: 'Inbox' },
              },
            ],
      }),
    ];
  });
}

function buildAnnouncementReports(input: ProactiveAIReportInput, now: Date): ProactiveAIReport[] {
  return (input.announcements ?? [])
    .filter(isImportantAnnouncement)
    .slice(0, 5)
    .map((announcement) =>
      createReport({
        id: `announcement-${announcement.id}`,
        kind: 'announcement',
        priority: /緊急|停課|安全|停水|停電/.test(
          `${announcement.title} ${announcement.body ?? ''}`,
        )
          ? 'high'
          : 'medium',
        title: '重要公告提醒',
        body: `${announcement.title}${announcement.source ? `\n來源：${announcement.source}` : ''}`,
        createdAt: now.toISOString(),
        expiresAt: addMinutes(now, 60 * 24 * 7).toISOString(),
        data: {
          type: 'ai_proactive',
          announcementId: announcement.id,
          source: announcement.source,
        },
        suggestions: ['查公告', '幫我摘要公告', '需要做什麼'],
        actions: [
          {
            label: '查看公告',
            action: 'navigate',
            params: { screen: 'Today', nested: '公告詳情', id: announcement.id },
          },
        ],
      }),
    );
}

export function buildProactiveAIReports(
  input: ProactiveAIReportInput,
  options: { now?: Date } = {},
): ProactiveAIReport[] {
  const now = options.now ?? new Date();
  const daily = buildDailyBrief(input, now);
  const reports = [
    ...(daily ? [daily] : []),
    ...buildClassSoonReports(input, now),
    ...buildAssignmentReports(input, now),
    ...buildAnnouncementReports(input, now),
  ];

  const byId = new Map<string, ProactiveAIReport>();
  reports.forEach((report) => byId.set(report.id, report));
  return Array.from(byId.values()).sort(reportSort);
}

export function getProactiveAIReportsStorageKey(
  userId?: string | null,
  schoolId?: string | null,
): string {
  return getScopedStorageKey('ai-proactive-reports', {
    uid: userId ?? null,
    schoolId: schoolId ?? null,
  });
}

function getProactiveAIStateStorageKey(userId?: string | null, schoolId?: string | null): string {
  return getScopedStorageKey('ai-proactive-state', {
    uid: userId ?? null,
    schoolId: schoolId ?? null,
  });
}

function normalizeReport(value: unknown): ProactiveAIReport | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ProactiveAIReport>;
  if (typeof raw.id !== 'string' || typeof raw.title !== 'string' || typeof raw.body !== 'string') {
    return null;
  }
  return {
    id: raw.id,
    kind: raw.kind ?? 'daily_brief',
    priority: raw.priority ?? 'medium',
    title: raw.title,
    body: raw.body,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    expiresAt: raw.expiresAt,
    sourceHash: raw.sourceHash ?? shortHash(`${raw.title}:${raw.body}`),
    seenInChat: raw.seenInChat === true,
    notifiedAt: raw.notifiedAt,
    dismissedAt: raw.dismissedAt,
    data: raw.data,
    suggestions: Array.isArray(raw.suggestions)
      ? raw.suggestions.filter((item): item is string => typeof item === 'string')
      : undefined,
    actions: Array.isArray(raw.actions) ? raw.actions : undefined,
  };
}

export async function loadProactiveAIReports(params: {
  userId?: string | null;
  schoolId?: string | null;
}): Promise<ProactiveAIReport[]> {
  try {
    const raw = await AsyncStorage.getItem(
      getProactiveAIReportsStorageKey(params.userId, params.schoolId),
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeReport)
      .filter((report): report is ProactiveAIReport => !!report)
      .sort(reportSort);
  } catch {
    return [];
  }
}

async function saveProactiveAIReports(
  params: {
    userId?: string | null;
    schoolId?: string | null;
  },
  reports: ProactiveAIReport[],
): Promise<void> {
  await AsyncStorage.setItem(
    getProactiveAIReportsStorageKey(params.userId, params.schoolId),
    JSON.stringify(reports.slice(0, MAX_STORED_REPORTS)),
  );
}

async function loadProactiveAIState(params: {
  userId?: string | null;
  schoolId?: string | null;
}): Promise<ProactiveAIState> {
  try {
    const raw = await AsyncStorage.getItem(
      getProactiveAIStateStorageKey(params.userId, params.schoolId),
    );
    if (!raw) return { scheduledNotificationIds: [] };
    const parsed = JSON.parse(raw) as Partial<ProactiveAIState>;
    return {
      lastSyncAt: parsed.lastSyncAt,
      lastScheduleHash: parsed.lastScheduleHash,
      scheduledNotificationIds: Array.isArray(parsed.scheduledNotificationIds)
        ? parsed.scheduledNotificationIds.filter((id): id is string => typeof id === 'string')
        : [],
    };
  } catch {
    return { scheduledNotificationIds: [] };
  }
}

async function saveProactiveAIState(
  params: {
    userId?: string | null;
    schoolId?: string | null;
  },
  state: ProactiveAIState,
): Promise<void> {
  await AsyncStorage.setItem(
    getProactiveAIStateStorageKey(params.userId, params.schoolId),
    JSON.stringify(state),
  );
}

function mergeReports(
  existing: ProactiveAIReport[],
  generated: ProactiveAIReport[],
  now: Date,
): ProactiveAIReport[] {
  const nowTime = now.getTime();
  const byId = new Map<string, ProactiveAIReport>();

  existing.forEach((report) => {
    const expiresAt = report.expiresAt
      ? new Date(report.expiresAt).getTime()
      : Number.POSITIVE_INFINITY;
    if (Number.isFinite(expiresAt) && expiresAt < nowTime - 7 * 24 * 3_600_000) return;
    byId.set(report.id, report);
  });

  generated.forEach((report) => {
    const previous = byId.get(report.id);
    byId.set(report.id, {
      ...previous,
      ...report,
      seenInChat: previous?.seenInChat ?? false,
      notifiedAt: previous?.notifiedAt,
      dismissedAt: previous?.dismissedAt,
    });
  });

  return Array.from(byId.values()).sort(reportSort).slice(0, MAX_STORED_REPORTS);
}

function shouldNotifyImmediately(report: ProactiveAIReport): boolean {
  return !report.notifiedAt && !report.dismissedAt && report.priority !== 'low';
}

export async function markProactiveAIReportsSeen(params: {
  userId?: string | null;
  schoolId?: string | null;
  reportIds: string[];
}): Promise<void> {
  if (params.reportIds.length === 0) return;
  const reportIds = new Set(params.reportIds);
  const reports = await loadProactiveAIReports(params);
  const updated = reports.map((report) =>
    reportIds.has(report.id) ? { ...report, seenInChat: true } : report,
  );
  await saveProactiveAIReports(params, updated);
}

function scheduleSignature(input: ProactiveAIReportInput): string {
  const courses = (input.courses ?? []).map((course) => ({
    id: course.id,
    name: course.name,
    schedule: course.schedule,
    dayOfWeek: course.dayOfWeek,
    startTime: course.startTime,
    endTime: course.endTime,
    location: course.location,
  }));
  const assignments = (input.pendingAssignments ?? []).map((assignment) => ({
    id: assignment.id,
    title: assignment.title,
    groupId: assignment.groupId,
    dueAt: normalizeAssignmentDueAt(assignment)?.toISOString() ?? null,
    isLate: assignment.isLate === true,
  }));
  return shortHash(JSON.stringify({ courses, assignments }));
}

function weeklyReminderTrigger(
  dayOfWeek: number,
  startTime: string,
  leadMinutes: number,
): Notifications.NotificationTriggerInput | null {
  const startMinutes = timeToMinutes(startTime);
  if (startMinutes == null) return null;
  let reminderMinutes = startMinutes - leadMinutes;
  let reminderDay = dayOfWeek;
  while (reminderMinutes < 0) {
    reminderMinutes += 24 * 60;
    reminderDay = (reminderDay + 6) % 7;
  }
  return {
    type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
    weekday: reminderDay + 1,
    hour: Math.floor(reminderMinutes / 60),
    minute: reminderMinutes % 60,
    channelId: AI_NOTIFICATION_CHANNEL,
  };
}

function buildScheduledNotificationPlans(input: ProactiveAIReportInput): NotificationPlan[] {
  const plans: NotificationPlan[] = [
    {
      title: 'AI 每日主動回報',
      body: '打開 AI 助理查看今天課表、作業和重要公告摘要。',
      data: { type: 'ai_proactive', kind: 'daily_brief' },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: 8,
        minute: 0,
        channelId: AI_NOTIFICATION_CHANNEL,
      },
    },
  ];

  getCourseMeetingRows(input.courses ?? [])
    .slice(0, 40)
    .forEach((row) => {
      if (!row.startTime) return;
      const trigger = weeklyReminderTrigger(row.dayOfWeek, row.startTime, 15);
      if (!trigger) return;
      plans.push({
        title: '15 分鐘後要上課',
        body: `${row.course.name}${row.location ? `，地點 ${row.location}` : ''}。`,
        data: {
          type: 'ai_proactive',
          kind: 'class_soon',
          courseId: row.course.id,
          courseName: row.course.name,
        },
        trigger,
      });
    });

  (input.pendingAssignments ?? []).slice(0, 30).forEach((assignment) => {
    const dueAt = normalizeAssignmentDueAt(assignment);
    if (!dueAt || assignment.isLate) return;
    const reminderPoints = [24 * 60, 2 * 60];
    reminderPoints.forEach((leadMinutes) => {
      const notifyAt = addMinutes(dueAt, -leadMinutes);
      if (notifyAt.getTime() <= Date.now() + 60_000) return;
      plans.push({
        title: leadMinutes >= 24 * 60 ? '作業明天截止' : '作業快截止',
        body: `${assignment.title}（${assignment.groupName ?? '課程'}）截止：${formatDateTime(dueAt)}。`,
        data: {
          type: 'ai_proactive',
          kind: 'assignment_due',
          assignmentId: assignment.id,
          groupId: assignment.groupId,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: notifyAt,
          channelId: AI_NOTIFICATION_CHANNEL,
        },
      });
    });
  });

  return plans.slice(0, 64);
}

async function syncProactiveAINotificationSchedules(
  input: ProactiveAIReportInput,
  state: ProactiveAIState,
): Promise<ProactiveAIState> {
  const permission = await checkPushPermission().catch(() => ({ granted: false }));
  if (!permission.granted) return state;

  const nextHash = scheduleSignature(input);
  if (state.lastScheduleHash === nextHash && state.scheduledNotificationIds.length > 0) {
    return state;
  }

  await Promise.all(
    state.scheduledNotificationIds.map((id) => cancelNotification(id).catch(() => void 0)),
  );

  const scheduledNotificationIds: string[] = [];
  for (const plan of buildScheduledNotificationPlans(input)) {
    const id = await scheduleLocalNotification(
      plan.title,
      plan.body,
      plan.data,
      plan.trigger,
      AI_NOTIFICATION_CHANNEL,
    ).catch(() => null);
    if (id) scheduledNotificationIds.push(id);
  }

  return {
    ...state,
    lastScheduleHash: nextHash,
    scheduledNotificationIds,
  };
}

export async function syncProactiveAIReports(
  input: ProactiveAIReportInput,
  options: {
    now?: Date;
    notify?: boolean;
    scheduleFutureNotifications?: boolean;
  } = {},
): Promise<{ reports: ProactiveAIReport[]; newReports: ProactiveAIReport[] }> {
  const now = options.now ?? new Date();
  const params = { userId: input.userId, schoolId: input.schoolId };
  const existing = await loadProactiveAIReports(params);
  const generated = buildProactiveAIReports(input, { now });
  const existingIds = new Set(existing.map((report) => report.id));
  const newReports = generated.filter((report) => !existingIds.has(report.id));
  let reports = mergeReports(existing, generated, now);
  let state = await loadProactiveAIState(params);

  if (options.notify !== false && newReports.length > 0) {
    const permission = await checkPushPermission().catch(() => ({ granted: false }));
    if (permission.granted) {
      const notifiedIds = new Set<string>();
      for (const report of newReports.filter(shouldNotifyImmediately).slice(0, 3)) {
        const notificationId = await sendImmediateNotification(
          report.title,
          report.body,
          { type: 'ai_proactive', reportId: report.id, kind: report.kind, ...(report.data ?? {}) },
          AI_NOTIFICATION_CHANNEL,
        ).catch(() => null);
        if (notificationId) notifiedIds.add(report.id);
      }
      if (notifiedIds.size > 0) {
        reports = reports.map((report) =>
          notifiedIds.has(report.id) ? { ...report, notifiedAt: now.toISOString() } : report,
        );
      }
    }
  }

  if (options.scheduleFutureNotifications !== false) {
    state = await syncProactiveAINotificationSchedules(input, state);
  }
  state.lastSyncAt = now.toISOString();

  await Promise.all([saveProactiveAIReports(params, reports), saveProactiveAIState(params, state)]);

  return { reports, newReports };
}
