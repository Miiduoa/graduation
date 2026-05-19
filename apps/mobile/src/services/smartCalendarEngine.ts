/* eslint-disable */
/**
 * 📅 智慧行事曆引擎 — Smart Calendar Engine
 *
 * 靜宜大學 Campus One 獨家功能：
 * 不只是行事曆，而是 AI 時間管理助手。
 *
 * 核心功能：
 *   1. 統一行事曆 — 自動整合課表 + TRONCLASS 作業 + 校園活動 + 個人事項
 *   2. AI 讀書計劃生成器 — 根據課表空檔自動安排讀書時間
 *   3. 番茄鐘專注模式 — 內建 Pomodoro 計時器 + 統計
 *   4. 截止日倒數 — 自動追蹤所有截止日
 *   5. 時間統計 — 每週/每月學習時間分析
 *
 * 心理學基礎：
 *   - Time Blocking：固定時段做固定事情，減少決策疲勞
 *   - Pomodoro Technique：25 分鐘專注 + 5 分鐘休息
 *   - Implementation Intentions：「什麼時候做什麼」比「要做什麼」更有效
 *   - Zeigarnik Effect：未完成事項持續可見
 *   - Progress Monitoring：看到進度才有動力
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAnyCachedCourses, getAnyCachedTCActivities, getAnyCachedTCTodos, getAnyCachedTCCourses } from './puDataCache';
import type { TCActivity, TCCourse as TCCourseType } from './tronClassClient';
import type { PUCourse } from './puDirectScraper';

// ─── Types ───────────────────────────────────────────────

export type CalendarEventType =
  | 'class' // 上課
  | 'assignment' // 作業截止
  | 'exam' // 考試
  | 'campus_event' // 校園活動
  | 'study_plan' // AI 排的讀書時段
  | 'pomodoro' // 番茄鐘紀錄
  | 'personal' // 個人事項
  | 'reminder'; // 提醒

export type CalendarEvent = {
  id: string;
  type: CalendarEventType;
  title: string;
  description?: string;
  startTime: number; // epoch ms
  endTime: number;
  allDay: boolean;
  location?: string;
  courseCode?: string;
  courseName?: string;
  color: string;
  icon: string;
  recurring?: {
    pattern: 'daily' | 'weekly' | 'biweekly' | 'monthly';
    dayOfWeek?: number; // 1-7
    until?: number;
  };
  reminder?: number; // minutes before
  completed: boolean;
  priority: 'high' | 'medium' | 'low';
};

export type Deadline = {
  id: string;
  title: string;
  courseName?: string;
  courseCode?: string;
  /** 與 InboxTask / listAssignments 一致時，點選可導到 HomeworkSubmit／QuizCenter 等 */
  groupId?: string;
  assignmentId?: string;
  dueAt: number; // epoch ms
  type: 'assignment' | 'exam' | 'project' | 'quiz' | 'other';
  completed: boolean;
  priority: 'high' | 'medium' | 'low';
  estimatedHours: number; // estimated time to complete
  remainingHours: number; // time left until due
  urgencyScore: number; // 0-10
  icon: string;
  color: string;
};

export type StudyPlan = {
  id: string;
  courseName: string;
  courseCode?: string;
  dayOfWeek: number; // 1=Mon, 7=Sun
  startHour: number;
  endHour: number;
  studyType: 'review' | 'homework' | 'preparation' | 'project' | 'practice';
  description: string;
  aiReason: string; // why AI chose this slot
};

export type PomodoroSession = {
  id: string;
  startTime: number;
  endTime?: number;
  duration: number; // target duration in minutes
  completed: boolean;
  subject?: string;
  courseName?: string;
  type: 'focus' | 'short_break' | 'long_break';
};

export type PomodoroStats = {
  todaySessions: number;
  todayMinutes: number;
  weekSessions: number;
  weekMinutes: number;
  totalSessions: number;
  totalMinutes: number;
  avgDailySessions: number;
  streak: number; // consecutive days with at least 1 session
  bestSubject: string;
  subjectBreakdown: { subject: string; minutes: number }[];
};

export type WeekView = {
  days: {
    date: string; // YYYY-MM-DD
    dayOfWeek: number;
    isToday: boolean;
    events: CalendarEvent[];
    studyMinutes: number;
    classMinutes: number;
    freeMinutes: number;
  }[];
  weekSummary: {
    totalClassHours: number;
    totalStudyHours: number;
    totalFreeHours: number;
    busiestDay: string;
    lightestDay: string;
    upcomingDeadlines: number;
  };
};

export type TimeStats = {
  thisWeek: { study: number; class: number; free: number };
  lastWeek: { study: number; class: number; free: number };
  trend: 'more_study' | 'less_study' | 'stable';
  dailyAvg: number;
  peakStudyHour: number;
  peakStudyDay: string;
};

// ─── Constants ──────────────────────────────────────────

const KEYS = {
  events: '@smart_cal:events',
  deadlines: '@smart_cal:deadlines',
  studyPlans: '@smart_cal:study_plans',
  pomodoro: '@smart_cal:pomodoro',
  pomodoroStats: '@smart_cal:pomodoro_stats',
  fakeCleaned: '@smart_cal:fake_cleaned_v1',
} as const;

// 一次性清除舊版假資料快取（dl_real_ 開頭的是舊版 generateDeadlinesFromRealCourses 產生的假資料）
(async () => {
  try {
    const cleaned = await AsyncStorage.getItem(KEYS.fakeCleaned);
    if (cleaned) return; // 已清除過
    const raw = await AsyncStorage.getItem(KEYS.deadlines);
    if (raw) {
      const deadlines: Array<{ id: string }> = JSON.parse(raw);
      const hasFake = deadlines.some((d) => d.id.startsWith('dl_real_'));
      if (hasFake) {
        // 只保留非假資料（手動新增或 TronClass 來源）
        const real = deadlines.filter((d) => !d.id.startsWith('dl_real_'));
        await AsyncStorage.setItem(KEYS.deadlines, JSON.stringify(real));
      }
    }
    await AsyncStorage.setItem(KEYS.fakeCleaned, 'true');
  } catch {}
})();

const TYPE_COLORS: Record<CalendarEventType, string> = {
  class: '#5856D6',
  assignment: '#FF3B30',
  exam: '#FF9500',
  campus_event: '#AF52DE',
  study_plan: '#34C759',
  pomodoro: '#FF2D55',
  personal: '#5856D6',
  reminder: '#FF9500',
};

const TYPE_ICONS: Record<CalendarEventType, string> = {
  class: 'school-outline',
  assignment: 'document-text-outline',
  exam: 'clipboard-outline',
  campus_event: 'calendar-outline',
  study_plan: 'book-outline',
  pomodoro: 'timer-outline',
  personal: 'person-outline',
  reminder: 'alarm-outline',
};

function getCourseCode(course: PUCourse): string {
  return course.code || course.name || 'course';
}

function getCourseScheduleParts(course: PUCourse): { dayNum: number; periods: number[] } | null {
  if (course.dayOfWeek !== null && course.periods.length > 0) {
    return { dayNum: course.dayOfWeek, periods: course.periods };
  }

  const timeStr = course.timePlaceRaw || '';
  const dayMap: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7 };
  const dayChar = timeStr.charAt(0);
  const dayNum = dayMap[dayChar];
  if (dayNum === undefined) return null;

  const periods = timeStr
    .slice(1)
    .split('')
    .map(Number)
    .filter((n) => !isNaN(n));

  return periods.length > 0 ? { dayNum, periods } : null;
}

// ─── Storage Helpers ────────────────────────────────────

async function loadEvents(): Promise<CalendarEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.events);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

async function saveEvents(events: CalendarEvent[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.events, JSON.stringify(events));
  } catch (e) {
    console.warn('[SmartCal] saveEvents error:', e);
  }
}

async function loadDeadlines(): Promise<Deadline[]> {
  // 優先從 TronClass 真實作業/考試取得截止日
  const realDeadlines = await syncDeadlinesFromTronClass();
  if (realDeadlines.length > 0) {
    // 合併手動新增的截止日（如果有）
    try {
      const raw = await AsyncStorage.getItem(KEYS.deadlines);
      if (raw) {
        const manual: Deadline[] = JSON.parse(raw);
        const manualOnly = manual.filter((d) => d.id.startsWith('dl_manual_'));
        if (manualOnly.length > 0) {
          return [...realDeadlines, ...manualOnly];
        }
      }
    } catch {}
    return realDeadlines;
  }
  // 無 TronClass 資料時，嘗試讀取本地存檔
  try {
    const raw = await AsyncStorage.getItem(KEYS.deadlines);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

async function saveDeadlines(deadlines: Deadline[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.deadlines, JSON.stringify(deadlines));
  } catch {}
}

async function loadPomodoroSessions(): Promise<PomodoroSession[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.pomodoro);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

async function savePomodoroSessions(sessions: PomodoroSession[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.pomodoro, JSON.stringify(sessions));
  } catch {}
}

// ─── 從 TronClass 真實資料同步截止日 ─────────────────────────

/** TronClass activity type → Deadline type 對映 */
const TC_TYPE_MAP: Record<string, Deadline['type']> = {
  homework: 'assignment',
  exam: 'exam',
  quiz: 'quiz',
  survey: 'other',
  forum: 'other',
  web_link: 'other',
  material: 'other',
};

const TC_TYPE_ICONS: Record<Deadline['type'], string> = {
  assignment: 'document-text-outline',
  exam: 'school-outline',
  quiz: 'calculator-outline',
  project: 'folder-outline',
  other: 'ellipsis-horizontal-outline',
};

const TC_TYPE_COLORS: Record<Deadline['type'], string> = {
  assignment: '#FF3B30',
  exam: '#FF9500',
  quiz: '#5856D6',
  project: '#AF52DE',
  other: '#8E8E93',
};

/**
 * 從 TronClass 真實作業/考試/測驗資料生成截止日
 * 使用 getAnyCachedTCActivities + getAnyCachedTCTodos
 * 只取有 end_time 且尚未過期太久的項目
 */
async function syncDeadlinesFromTronClass(): Promise<Deadline[]> {
  const [activitiesMap, todos, tcCourses] = await Promise.all([
    getAnyCachedTCActivities(),
    getAnyCachedTCTodos(),
    getAnyCachedTCCourses(),
  ]);

  // 建構 course_id → course name 對照表
  const courseNameMap = new Map<number, string>();
  const courseCodeMap = new Map<number, string>();
  if (tcCourses) {
    for (const c of tcCourses) {
      courseNameMap.set(c.id, c.name);
      courseCodeMap.set(c.id, c.course_code || `TC${c.id}`);
    }
  }

  const now = Date.now();
  const hour = 60 * 60 * 1000;
  // 只顯示未來 + 過期不超過 7 天的截止日
  const cutoff = now - 7 * 24 * hour;
  const seen = new Set<string>(); // 用 activity id 去重
  const deadlines: Deadline[] = [];

  /** 將單個 TCActivity 轉為 Deadline */
  function activityToDeadline(act: TCActivity): Deadline | null {
    // 需要有截止日
    if (!act.end_time) return null;

    const dueAt = new Date(act.end_time).getTime();
    if (isNaN(dueAt) || dueAt < cutoff) return null;

    const key = `tc_${act.id}`;
    if (seen.has(key)) return null;
    seen.add(key);

    const deadlineType = TC_TYPE_MAP[act.type] || 'other';
    // 跳過非任務型 activity（如 material, web_link）
    if (deadlineType === 'other' && act.type !== 'survey') return null;

    const isCompleted = act.status === 'submitted' || act.status === 'graded';
    const remainingHours = Math.max(0, (dueAt - now) / hour);

    // 根據剩餘時間推算優先級
    let priority: Deadline['priority'] = 'low';
    if (remainingHours < 24) priority = 'high';
    else if (remainingHours < 72) priority = 'medium';

    // 根據類型估算所需時間
    const estimatedHours = deadlineType === 'exam' ? 4 : deadlineType === 'quiz' ? 1 : 3;
    const prioWeight = priority === 'high' ? 1.5 : priority === 'medium' ? 1.0 : 0.7;
    const urgencyScore = remainingHours > 0
      ? Math.min(10, (estimatedHours / remainingHours) * 10 * prioWeight)
      : 10;

    const courseName = courseNameMap.get(act.course_id) || '未知課程';
    const courseCode = courseCodeMap.get(act.course_id) || `TC${act.course_id}`;

    return {
      id: key,
      title: act.title || `${courseName} ${act.type}`,
      courseName,
      courseCode,
      groupId: `tc-${act.course_id}`,
      assignmentId: `tc-activity-${act.id}`,
      dueAt,
      type: deadlineType,
      completed: isCompleted,
      priority,
      estimatedHours,
      remainingHours,
      urgencyScore,
      icon: TC_TYPE_ICONS[deadlineType],
      color: TC_TYPE_COLORS[deadlineType],
    };
  }

  // 1) 從 todos（待辦清單）取得 — 通常就是未完成的作業
  if (todos) {
    for (const act of todos) {
      const dl = activityToDeadline(act);
      if (dl) deadlines.push(dl);
    }
  }

  // 2) 從所有課程的 activities 取得（可能包含已完成的）
  if (activitiesMap) {
    for (const courseId of Object.keys(activitiesMap)) {
      const acts = activitiesMap[Number(courseId)];
      if (!acts) continue;
      for (const act of acts) {
        const dl = activityToDeadline(act);
        if (dl) deadlines.push(dl);
      }
    }
  }

  return deadlines;
}

// ─── Course Schedule → Calendar ─────────────────────────

/**
 * 從課表自動產生行事曆事件
 */
export async function syncCourseSchedule(): Promise<CalendarEvent[]> {
  const cached = await getAnyCachedCourses();
  if (!cached?.courses) return [];

  const events: CalendarEvent[] = [];
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1); // Monday
  weekStart.setHours(0, 0, 0, 0);

  for (const course of cached.courses) {
    const name = course.name || '未知課程';
    const courseCode = getCourseCode(course);
    const location = course.location || '';
    const schedule = getCourseScheduleParts(course);
    if (!schedule) continue;
    const { dayNum, periods } = schedule;

    // Period to time mapping (靜宜大學節次)
    const periodTimes: Record<number, [number, number]> = {
      1: [8, 9],
      2: [9, 10],
      3: [10, 11],
      4: [11, 12],
      5: [12, 13],
      6: [13, 14],
      7: [14, 15],
      8: [15, 16],
      9: [16, 17],
      10: [17, 18],
      11: [18, 19],
      12: [19, 20],
      13: [20, 21],
    };

    const startPeriod = Math.min(...periods);
    const endPeriod = Math.max(...periods);
    const startHour = periodTimes[startPeriod]?.[0] ?? 8;
    const endHour = periodTimes[endPeriod]?.[1] ?? startHour + 1;

    const eventDate = new Date(weekStart);
    eventDate.setDate(weekStart.getDate() + (dayNum === 7 ? 6 : dayNum - 1));

    const startTime = new Date(eventDate);
    startTime.setHours(startHour, 0, 0, 0);
    const endTime = new Date(eventDate);
    endTime.setHours(endHour, 0, 0, 0);

    events.push({
      id: `class_${courseCode}_${dayNum}`,
      type: 'class',
      title: name,
      description: `${location ? `教室：${location}` : ''}`,
      startTime: startTime.getTime(),
      endTime: endTime.getTime(),
      allDay: false,
      location,
      courseCode,
      courseName: name,
      color: TYPE_COLORS.class,
      icon: TYPE_ICONS.class,
      recurring: { pattern: 'weekly', dayOfWeek: dayNum },
      completed: false,
      priority: 'medium',
    });
  }

  // Merge with existing events
  const existing = await loadEvents();
  const nonClassEvents = existing.filter((e) => e.type !== 'class');
  const merged = [...events, ...nonClassEvents];
  await saveEvents(merged);

  return events;
}

// ─── AI Study Planner ───────────────────────────────────

/**
 * AI 自動排讀書計劃
 * 根據課表空檔 + 截止日優先度 + 個人習慣生成最佳讀書時間表
 */
export async function generateStudyPlan(): Promise<StudyPlan[]> {
  const cached = await getAnyCachedCourses();
  const courses = cached?.courses || [];
  const deadlines = await loadDeadlines();

  // Build occupied time slots (Mon-Fri, 8am-9pm)
  const occupied = new Map<string, boolean>(); // "dayOfWeek-hour" → occupied

  for (const course of courses) {
    const schedule = getCourseScheduleParts(course);
    if (!schedule || schedule.dayNum < 1 || schedule.dayNum > 5) continue;
    const { dayNum, periods } = schedule;
    const periodTimes: Record<number, number> = {
      1: 8,
      2: 9,
      3: 10,
      4: 11,
      5: 12,
      6: 13,
      7: 14,
      8: 15,
      9: 16,
      10: 17,
      11: 18,
      12: 19,
      13: 20,
    };

    for (const p of periods) {
      const hour = periodTimes[p];
      if (hour !== undefined) {
        occupied.set(`${dayNum}-${hour}`, true);
      }
    }
  }

  // Find free slots
  const freeSlots: { day: number; hour: number }[] = [];
  for (let day = 1; day <= 5; day++) {
    for (let hour = 8; hour <= 20; hour++) {
      if (!occupied.has(`${day}-${hour}`)) {
        // Skip lunch (12-13)
        if (hour === 12) continue;
        freeSlots.push({ day, hour });
      }
    }
  }
  // Add weekend slots
  for (let hour = 9; hour <= 18; hour++) {
    if (hour !== 12) {
      freeSlots.push({ day: 6, hour });
      freeSlots.push({ day: 7, hour });
    }
  }

  // Sort deadlines by urgency
  const urgentDeadlines = deadlines
    .filter((d) => !d.completed)
    .sort((a, b) => b.urgencyScore - a.urgencyScore);

  // Assign study blocks
  const plans: StudyPlan[] = [];
  let slotIdx = 0;
  const dayNames = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'];

  for (const deadline of urgentDeadlines) {
    const blocksNeeded = Math.ceil(deadline.estimatedHours);
    for (let i = 0; i < blocksNeeded && slotIdx < freeSlots.length; i++) {
      const slot = freeSlots[slotIdx++];
      plans.push({
        id: `sp_${deadline.id}_${i}`,
        courseName: deadline.courseName || deadline.title,
        courseCode: deadline.courseCode,
        dayOfWeek: slot.day,
        startHour: slot.hour,
        endHour: slot.hour + 1,
        studyType:
          deadline.type === 'exam' || deadline.type === 'quiz'
            ? 'review'
            : deadline.type === 'project'
              ? 'project'
              : 'homework',
        description: `準備「${deadline.title}」`,
        aiReason: `截止日${deadline.remainingHours < 48 ? '緊迫' : '將近'}（${Math.round(deadline.remainingHours)}h），排在${dayNames[slot.day]} ${slot.hour}:00 的空檔`,
      });
    }
  }

  // Save
  try {
    await AsyncStorage.setItem(KEYS.studyPlans, JSON.stringify(plans));
  } catch {}

  return plans;
}

// ─── Pomodoro Timer ─────────────────────────────────────

/**
 * 開始番茄鐘
 */
export async function startPomodoro(options?: {
  duration?: number; // minutes, default 25
  subject?: string;
  courseName?: string;
}): Promise<PomodoroSession> {
  const session: PomodoroSession = {
    id: `pomo_${Date.now()}`,
    startTime: Date.now(),
    duration: options?.duration || 25,
    completed: false,
    subject: options?.subject,
    courseName: options?.courseName,
    type: 'focus',
  };

  const sessions = await loadPomodoroSessions();
  sessions.push(session);
  await savePomodoroSessions(sessions);

  return session;
}

/**
 * 完成番茄鐘
 */
export async function completePomodoro(sessionId: string): Promise<void> {
  const sessions = await loadPomodoroSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (session) {
    session.completed = true;
    session.endTime = Date.now();
    await savePomodoroSessions(sessions);
  }
}

/**
 * 取得番茄鐘統計
 */
export async function getPomodoroStats(): Promise<PomodoroStats> {
  const sessions = await loadPomodoroSessions();
  const completed = sessions.filter((s) => s.completed);

  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);

  const todaySessions = completed.filter((s) => s.startTime >= todayStart.getTime());
  const weekSessions = completed.filter((s) => s.startTime >= weekStart.getTime());

  // Subject breakdown
  const subjectMap = new Map<string, number>();
  for (const s of completed) {
    const key = s.courseName || s.subject || '其他';
    subjectMap.set(key, (subjectMap.get(key) || 0) + s.duration);
  }

  const subjectBreakdown = Array.from(subjectMap.entries())
    .map(([subject, minutes]) => ({ subject, minutes }))
    .sort((a, b) => b.minutes - a.minutes);

  // Streak
  let streak = 0;
  const today = new Date().toISOString().split('T')[0];
  let checkDate = new Date();
  while (true) {
    const dateStr = checkDate.toISOString().split('T')[0];
    const hasSessions = completed.some((s) => {
      const d = new Date(s.startTime).toISOString().split('T')[0];
      return d === dateStr;
    });
    if (hasSessions) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  // Days with sessions for avg calculation
  const uniqueDays = new Set(
    completed.map((s) => new Date(s.startTime).toISOString().split('T')[0]),
  );

  return {
    todaySessions: todaySessions.length,
    todayMinutes: todaySessions.reduce((s, p) => s + p.duration, 0),
    weekSessions: weekSessions.length,
    weekMinutes: weekSessions.reduce((s, p) => s + p.duration, 0),
    totalSessions: completed.length,
    totalMinutes: completed.reduce((s, p) => s + p.duration, 0),
    avgDailySessions: uniqueDays.size > 0 ? completed.length / uniqueDays.size : 0,
    streak,
    bestSubject: subjectBreakdown[0]?.subject || '尚無紀錄',
    subjectBreakdown,
  };
}

// ─── Deadlines ──────────────────────────────────────────

/**
 * 取得所有截止日（排序 by urgency）
 */
export async function getDeadlines(): Promise<Deadline[]> {
  const deadlines = await loadDeadlines();
  const now = Date.now();

  // Recalculate urgency scores
  for (const d of deadlines) {
    d.remainingHours = Math.max(0, (d.dueAt - now) / (60 * 60 * 1000));
    // Urgency = (estimatedHours / remainingHours) * priority_weight
    const prioWeight = d.priority === 'high' ? 1.5 : d.priority === 'medium' ? 1.0 : 0.7;
    d.urgencyScore =
      d.remainingHours > 0
        ? Math.min(10, (d.estimatedHours / d.remainingHours) * 10 * prioWeight)
        : 10;
  }

  return deadlines.filter((d) => !d.completed).sort((a, b) => b.urgencyScore - a.urgencyScore);
}

/**
 * 新增截止日
 */
export async function addDeadline(data: {
  title: string;
  courseName?: string;
  courseCode?: string;
  dueAt: number;
  type: Deadline['type'];
  priority: Deadline['priority'];
  estimatedHours: number;
}): Promise<Deadline> {
  const now = Date.now();
  const deadline: Deadline = {
    id: `dl_${now}_${Math.random().toString(36).slice(2, 6)}`,
    ...data,
    completed: false,
    remainingHours: Math.max(0, (data.dueAt - now) / (60 * 60 * 1000)),
    urgencyScore: 5,
    icon:
      data.type === 'exam'
        ? 'clipboard-outline'
        : data.type === 'quiz'
          ? 'help-circle-outline'
          : data.type === 'project'
            ? 'folder-outline'
            : 'document-text-outline',
    color:
      data.priority === 'high' ? '#FF3B30' : data.priority === 'medium' ? '#FF9500' : '#5856D6',
  };

  const deadlines = await loadDeadlines();
  deadlines.push(deadline);
  await saveDeadlines(deadlines);

  return deadline;
}

/**
 * 標記截止日為完成
 */
export async function completeDeadline(deadlineId: string): Promise<void> {
  const deadlines = await loadDeadlines();
  const d = deadlines.find((dl) => dl.id === deadlineId);
  if (d) {
    d.completed = true;
    await saveDeadlines(deadlines);
  }
}

// ─── Week View ──────────────────────────────────────────

/**
 * 取得本週視圖
 */
export async function getWeekView(): Promise<WeekView> {
  const events = await loadEvents();
  if (events.length === 0) {
    await syncCourseSchedule();
  }
  const allEvents = await loadEvents();
  const deadlines = await loadDeadlines();
  const pomodoroSessions = await loadPomodoroSessions();

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);

  const days: WeekView['days'] = [];

  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    const dayStart = date.getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;

    const dayEvents = allEvents.filter((e) => {
      if (e.recurring?.pattern === 'weekly') {
        const eventDay = e.recurring.dayOfWeek;
        const currentDay = i === 6 ? 0 : i + 1; // Map to 0=Sun convention
        return eventDay === currentDay;
      }
      return e.startTime >= dayStart && e.startTime < dayEnd;
    });

    const classMinutes = dayEvents
      .filter((e) => e.type === 'class')
      .reduce((s, e) => s + (e.endTime - e.startTime) / 60000, 0);

    const studyMinutes = pomodoroSessions
      .filter((s) => s.completed && s.startTime >= dayStart && s.startTime < dayEnd)
      .reduce((s, p) => s + p.duration, 0);

    const activeDayHours = 14; // 8am-10pm
    const freeMinutes = Math.max(0, activeDayHours * 60 - classMinutes - studyMinutes);

    days.push({
      date: dateStr,
      dayOfWeek: i === 6 ? 0 : i + 1,
      isToday: dateStr === now.toISOString().split('T')[0],
      events: dayEvents,
      studyMinutes,
      classMinutes,
      freeMinutes,
    });
  }

  const totalClassHours = days.reduce((s, d) => s + d.classMinutes, 0) / 60;
  const totalStudyHours = days.reduce((s, d) => s + d.studyMinutes, 0) / 60;
  const totalFreeHours = days.reduce((s, d) => s + d.freeMinutes, 0) / 60;
  const busiestDay = days.reduce((a, b) => (a.classMinutes > b.classMinutes ? a : b));
  const lightestDay = days.reduce((a, b) => (a.classMinutes < b.classMinutes ? a : b));

  const upcomingDeadlines = deadlines.filter(
    (d) => !d.completed && d.dueAt - now.getTime() < 7 * 24 * 60 * 60 * 1000,
  ).length;

  const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];

  return {
    days,
    weekSummary: {
      totalClassHours: Math.round(totalClassHours * 10) / 10,
      totalStudyHours: Math.round(totalStudyHours * 10) / 10,
      totalFreeHours: Math.round(totalFreeHours * 10) / 10,
      busiestDay: `週${dayLabels[busiestDay.dayOfWeek]}`,
      lightestDay: `週${dayLabels[lightestDay.dayOfWeek]}`,
      upcomingDeadlines,
    },
  };
}

/**
 * 取得統一的行事曆資料
 */
export async function getCalendarData(): Promise<{
  events: CalendarEvent[];
  deadlines: Deadline[];
  studyPlans: StudyPlan[];
  pomodoroStats: PomodoroStats;
  weekView: WeekView;
}> {
  const [events, deadlines, studyPlans, pomodoroStats, weekView] = await Promise.all([
    loadEvents(),
    getDeadlines(),
    generateStudyPlan(),
    getPomodoroStats(),
    getWeekView(),
  ]);

  return { events, deadlines, studyPlans, pomodoroStats, weekView };
}

/**
 * addCalendarEvent — 事件匯流排用的快速新增函式
 * 讓其他引擎（點名、作業）可以自動寫入行事曆
 */
export async function addCalendarEvent(event: {
  id: string;
  title: string;
  type: string;
  startTime: number;
  endTime: number;
  courseId?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    const events = await loadEvents();
    const typeMap: Record<string, CalendarEventType> = {
      attendance: 'class',
      assignment_deadline: 'assignment',
    };
    const newEvent: CalendarEvent = {
      id: event.id,
      title: event.title,
      type: typeMap[event.type] || 'reminder',
      startTime: event.startTime,
      endTime: event.endTime,
      allDay: false,
      location: '',
      color:
        event.type === 'attendance'
          ? '#34C759'
          : event.type === 'assignment_deadline'
            ? '#FF3B30'
            : '#5856D6',
      icon: event.type === 'attendance' ? 'checkmark-circle' : 'document-text',
      completed: false,
      priority: 'medium',
    };
    events.push(newEvent);
    await saveEvents(events);
  } catch (e) {
    console.warn('[Calendar] addCalendarEvent failed:', e);
  }
}
