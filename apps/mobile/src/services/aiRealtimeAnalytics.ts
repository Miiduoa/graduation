/* eslint-disable */
/**
 * AI 即時資料演算引擎 — aiRealtimeAnalytics.ts
 *
 * 即時分析使用者所有資料，產生可行動的洞察：
 * - GPA 趨勢預測 & 學期風險
 * - 學分完成進度 & 畢業倒數
 * - 出席風險分析 & 預警
 * - 課程負載平衡分析
 * - 作業截止追蹤 & 優先排序
 * - 社交活躍度評分
 * - 時間管理效率
 *
 * 所有計算結果以 RealtimeInsights 型別輸出，
 * 直接注入 AI 對話 context 供 Gemini 引用。
 */

import type { PUCourse, PUGrade, PUGradeResult } from './puDirectScraper';
import type { TCCourse, TCActivity, TCAttendance } from './tronClassClient';
import {
  getAnyCachedCourses,
  getAnyCachedGrades,
  getAnyCachedTCCourses,
  getAnyCachedTCActivities,
  getAnyCachedTCAttendance,
  getAnyCachedTCTodos,
} from './supabaseLmsCache'; // LMS v2 facade — flag OFF 時自動委派回 puDataCache

// ─── Types ───────────────────────────────────────────────

export type RiskLevel = 'safe' | 'watch' | 'warning' | 'danger' | 'critical';

export type GPAAnalysis = {
  currentGPA: number | null;
  semesterGPAs: Array<{ semester: string; gpa: number; credits: number }>;
  trend: 'rising' | 'stable' | 'declining' | 'unknown';
  trendDelta: number; // 最近兩學期差值
  predictedNextGPA: number | null;
  riskLevel: RiskLevel;
  failedCourses: Array<{ name: string; semester: string; score: number | string }>;
  lowScoreCourses: Array<{ name: string; semester: string; score: number }>;
  summary: string;
};

export type CreditProgress = {
  totalEarned: number;
  totalRequired: number; // 128 for PU
  remainingCredits: number;
  completionPercent: number;
  currentSemesterCredits: number;
  estimatedGraduationSemesters: number;
  byCategory: Array<{
    category: string;
    earned: number;
    required: number;
    percent: number;
  }>;
  onTrack: boolean;
  summary: string;
};

export type AttendanceRisk = {
  overallRate: number;
  coursesAtRisk: Array<{
    courseName: string;
    rate: number;
    absent: number;
    total: number;
    riskLevel: RiskLevel;
  }>;
  riskLevel: RiskLevel;
  summary: string;
};

export type AssignmentTracker = {
  total: number;
  overdue: number;
  dueSoon: Array<{
    title: string;
    courseName: string;
    dueAt: string;
    hoursLeft: number;
    isLate: boolean;
    priority: 'urgent' | 'high' | 'medium' | 'low';
  }>;
  upcoming: Array<{
    title: string;
    courseName: string;
    dueAt: string;
    daysLeft: number;
  }>;
  completionRate: number;
  summary: string;
};

export type CourseLoadAnalysis = {
  totalCourses: number;
  totalCredits: number;
  dailyLoad: Array<{
    day: string;
    dayIndex: number;
    courseCount: number;
    hours: number;
    courses: string[];
  }>;
  busiestDay: string;
  lightestDay: string;
  averageDaily: number;
  hasGap: boolean; // 有空堂
  summary: string;
};

export type TimeInsight = {
  currentPeriod: 'morning' | 'afternoon' | 'evening' | 'night';
  nextClass: {
    name: string;
    startTime: string;
    location: string;
    minutesUntil: number;
  } | null;
  todayCourses: Array<{
    name: string;
    startTime: string;
    endTime: string;
    location: string;
  }>;
  freeTimeToday: number; // minutes of free time remaining
  summary: string;
};

export type SocialScore = {
  conversationCount: number;
  unreadMessages: number;
  groupCount: number;
  activityScore: number; // 0-100
  level: 'inactive' | 'low' | 'moderate' | 'active' | 'very_active';
  summary: string;
};

export type ProactiveAlert = {
  id: string;
  type: 'assignment_due' | 'low_attendance' | 'grade_drop' | 'schedule_conflict' |
        'graduation_risk' | 'exam_upcoming' | 'overdue_task' | 'study_suggestion' |
        'weather_alert' | 'health_reminder';
  severity: RiskLevel;
  title: string;
  message: string;
  actionSuggestion: string;
  relatedData?: Record<string, unknown>;
  timestamp: number;
};

export type RealtimeInsights = {
  gpa: GPAAnalysis;
  credits: CreditProgress;
  attendance: AttendanceRisk;
  assignments: AssignmentTracker;
  courseLoad: CourseLoadAnalysis;
  timeInsight: TimeInsight;
  social: SocialScore;
  alerts: ProactiveAlert[];
  overallHealth: RiskLevel;
  overallSummary: string;
  computedAt: number;
};

// ─── Constants ───────────────────────────────────────────

const GRADUATION_CREDITS = 128;
const FAIL_THRESHOLD = 60;
const LOW_SCORE_THRESHOLD = 65;
const ATTENDANCE_DANGER = 60;
const ATTENDANCE_WARNING = 70;
const ATTENDANCE_WATCH = 80;

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

const PERIOD_TIMES: Record<number, { start: string; end: string }> = {
  1: { start: '08:10', end: '09:00' },
  2: { start: '09:10', end: '10:00' },
  3: { start: '10:10', end: '11:00' },
  4: { start: '11:10', end: '12:00' },
  5: { start: '12:40', end: '13:30' },
  6: { start: '13:40', end: '14:30' },
  7: { start: '14:40', end: '15:30' },
  8: { start: '15:40', end: '16:30' },
  9: { start: '16:40', end: '17:30' },
  10: { start: '17:40', end: '18:30' },
  11: { start: '18:35', end: '19:25' },
  12: { start: '19:30', end: '20:20' },
  13: { start: '20:25', end: '21:15' },
};

// ─── GPA Analysis ────────────────────────────────────────

function analyzeGPA(grades: PUGrade[], summary: PUGradeResult['summary']): GPAAnalysis {
  if (!grades || grades.length === 0) {
    return {
      currentGPA: null, semesterGPAs: [], trend: 'unknown', trendDelta: 0,
      predictedNextGPA: null, riskLevel: 'safe', failedCourses: [],
      lowScoreCourses: [], summary: '尚無成績資料',
    };
  }

  // Group by semester
  const bySemester = new Map<string, PUGrade[]>();
  for (const g of grades) {
    const sem = g.semester || '未知';
    if (!bySemester.has(sem)) bySemester.set(sem, []);
    bySemester.get(sem)!.push(g);
  }

  // Calculate per-semester GPA (weighted by credits)
  const semesterGPAs: GPAAnalysis['semesterGPAs'] = [];
  for (const [sem, semGrades] of bySemester) {
    let totalPoints = 0;
    let totalCredits = 0;
    for (const g of semGrades) {
      const score = typeof g.score === 'number' ? g.score : parseFloat(String(g.score));
      if (isNaN(score) || g.credits <= 0) continue;
      totalPoints += score * g.credits;
      totalCredits += g.credits;
    }
    if (totalCredits > 0) {
      semesterGPAs.push({
        semester: sem,
        gpa: Math.round((totalPoints / totalCredits) * 100) / 100,
        credits: totalCredits,
      });
    }
  }

  // Sort by semester string (e.g., "112-1", "112-2", "113-1")
  semesterGPAs.sort((a, b) => a.semester.localeCompare(b.semester));

  // Current GPA (latest semester)
  const currentGPA = semesterGPAs.length > 0 ? semesterGPAs[semesterGPAs.length - 1].gpa : null;

  // Trend analysis
  let trend: GPAAnalysis['trend'] = 'unknown';
  let trendDelta = 0;
  if (semesterGPAs.length >= 2) {
    const last = semesterGPAs[semesterGPAs.length - 1].gpa;
    const prev = semesterGPAs[semesterGPAs.length - 2].gpa;
    trendDelta = Math.round((last - prev) * 100) / 100;
    if (trendDelta > 2) trend = 'rising';
    else if (trendDelta < -2) trend = 'declining';
    else trend = 'stable';
  }

  // Predict next semester GPA using linear regression
  let predictedNextGPA: number | null = null;
  if (semesterGPAs.length >= 3) {
    const n = semesterGPAs.length;
    const xs = semesterGPAs.map((_, i) => i);
    const ys = semesterGPAs.map((s) => s.gpa);
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - meanX) * (ys[i] - meanY);
      den += (xs[i] - meanX) ** 2;
    }
    const slope = den !== 0 ? num / den : 0;
    const intercept = meanY - slope * meanX;
    predictedNextGPA = Math.round((slope * n + intercept) * 100) / 100;
    predictedNextGPA = Math.max(0, Math.min(100, predictedNextGPA));
  }

  // Failed & low-score courses
  const failedCourses: GPAAnalysis['failedCourses'] = [];
  const lowScoreCourses: GPAAnalysis['lowScoreCourses'] = [];
  for (const g of grades) {
    const score = typeof g.score === 'number' ? g.score : parseFloat(String(g.score));
    if (isNaN(score)) continue;
    if (score < FAIL_THRESHOLD) {
      failedCourses.push({ name: g.courseName, semester: g.semester, score: g.score });
    } else if (score < LOW_SCORE_THRESHOLD) {
      lowScoreCourses.push({ name: g.courseName, semester: g.semester, score });
    }
  }

  // Risk level
  let riskLevel: RiskLevel = 'safe';
  if (currentGPA !== null) {
    if (currentGPA < 50) riskLevel = 'critical';
    else if (currentGPA < 60) riskLevel = 'danger';
    else if (currentGPA < 70) riskLevel = 'warning';
    else if (trend === 'declining' && trendDelta < -5) riskLevel = 'warning';
    else if (trend === 'declining') riskLevel = 'watch';
  }
  if (failedCourses.length >= 3) riskLevel = 'danger';
  else if (failedCourses.length >= 1 && riskLevel === 'safe') riskLevel = 'watch';

  // Summary
  const parts: string[] = [];
  if (currentGPA !== null) parts.push(`目前GPA ${currentGPA}`);
  if (trend !== 'unknown') {
    const trendText = trend === 'rising' ? '上升中📈' : trend === 'declining' ? '下降中📉' : '穩定';
    parts.push(`趨勢${trendText}(${trendDelta > 0 ? '+' : ''}${trendDelta})`);
  }
  if (predictedNextGPA !== null) parts.push(`預測下學期 ${predictedNextGPA}`);
  if (failedCourses.length > 0) parts.push(`${failedCourses.length}門不及格`);

  return {
    currentGPA, semesterGPAs, trend, trendDelta, predictedNextGPA,
    riskLevel, failedCourses, lowScoreCourses,
    summary: parts.join('，') || '尚無成績資料',
  };
}

// ─── Credit Progress ─────────────────────────────────────

function analyzeCreditProgress(
  grades: PUGrade[],
  currentCourses: PUCourse[],
): CreditProgress {
  // Count earned credits (passed courses)
  let totalEarned = 0;
  const categoryCredits = new Map<string, number>();

  for (const g of grades) {
    const score = typeof g.score === 'number' ? g.score : parseFloat(String(g.score));
    if (!isNaN(score) && score >= FAIL_THRESHOLD && g.credits > 0) {
      totalEarned += g.credits;
      const cat = g.courseType || '其他';
      categoryCredits.set(cat, (categoryCredits.get(cat) ?? 0) + g.credits);
    }
  }

  const currentSemesterCredits = currentCourses.reduce((sum, c) => sum + (c.credits || 0), 0);
  const remaining = Math.max(0, GRADUATION_CREDITS - totalEarned);
  const percent = Math.round((totalEarned / GRADUATION_CREDITS) * 100);

  // Estimate remaining semesters (assuming 15-18 credits per semester)
  const avgCreditsPerSem = currentSemesterCredits > 0 ? currentSemesterCredits : 16;
  const estimatedSemesters = Math.ceil(remaining / avgCreditsPerSem);

  // Category breakdown
  const categoryRequirements: Record<string, number> = {
    '通識': 30, '系必修': 40, '院必修': 12, '選修': 30, '其他': 16,
  };
  const byCategory = Object.entries(categoryRequirements).map(([cat, req]) => ({
    category: cat,
    earned: categoryCredits.get(cat) ?? 0,
    required: req,
    percent: Math.round(((categoryCredits.get(cat) ?? 0) / req) * 100),
  }));

  const onTrack = remaining <= avgCreditsPerSem * 4; // 2 years left

  const summary = `已修 ${totalEarned}/${GRADUATION_CREDITS} 學分(${percent}%)，` +
    `本學期 ${currentSemesterCredits} 學分，` +
    `還需 ${remaining} 學分` +
    (estimatedSemesters > 0 ? `(約${estimatedSemesters}學期)` : '(已達畢業門檻)');

  return {
    totalEarned, totalRequired: GRADUATION_CREDITS, remainingCredits: remaining,
    completionPercent: percent, currentSemesterCredits, estimatedGraduationSemesters: estimatedSemesters,
    byCategory, onTrack, summary,
  };
}

// ─── Attendance Risk ─────────────────────────────────────

function analyzeAttendanceRisk(attendance: TCAttendance[]): AttendanceRisk {
  if (!attendance || attendance.length === 0) {
    return {
      overallRate: 100, coursesAtRisk: [], riskLevel: 'safe',
      summary: '尚無出席資料',
    };
  }

  let totalAttended = 0;
  let totalSessions = 0;
  const coursesAtRisk: AttendanceRisk['coursesAtRisk'] = [];

  for (const a of attendance) {
    totalAttended += a.attended;
    totalSessions += a.total_sessions;

    let risk: RiskLevel = 'safe';
    if (a.rate < ATTENDANCE_DANGER) risk = 'danger';
    else if (a.rate < ATTENDANCE_WARNING) risk = 'warning';
    else if (a.rate < ATTENDANCE_WATCH) risk = 'watch';

    if (risk !== 'safe') {
      coursesAtRisk.push({
        courseName: a.course_name,
        rate: a.rate,
        absent: a.absent,
        total: a.total_sessions,
        riskLevel: risk,
      });
    }
  }

  const overallRate = totalSessions > 0 ? Math.round((totalAttended / totalSessions) * 100) : 100;

  let riskLevel: RiskLevel = 'safe';
  if (coursesAtRisk.some((c) => c.riskLevel === 'danger')) riskLevel = 'danger';
  else if (coursesAtRisk.some((c) => c.riskLevel === 'warning')) riskLevel = 'warning';
  else if (coursesAtRisk.length > 0) riskLevel = 'watch';

  // Sort by risk (worst first)
  coursesAtRisk.sort((a, b) => a.rate - b.rate);

  const summary = coursesAtRisk.length > 0
    ? `整體出席率 ${overallRate}%，${coursesAtRisk.length}門課出席率偏低：` +
      coursesAtRisk.slice(0, 3).map((c) => `${c.courseName}(${c.rate}%)`).join('、')
    : `整體出席率 ${overallRate}%，表現良好`;

  return { overallRate, coursesAtRisk, riskLevel, summary };
}

// ─── Assignment Tracker ──────────────────────────────────

function analyzeAssignments(
  activities: Record<number, TCActivity[]>,
  todos: TCActivity[],
  courseMap: Map<number, string>,
): AssignmentTracker {
  const now = Date.now();
  const allTasks: Array<TCActivity & { _courseName: string }> = [];

  // Collect from activities
  for (const [courseId, acts] of Object.entries(activities)) {
    const cId = Number(courseId);
    const courseName = courseMap.get(cId) ?? `課程#${cId}`;
    for (const act of acts) {
      if (act.type === 'homework' || act.type === 'quiz' || act.type === 'exam') {
        allTasks.push({ ...act, _courseName: courseName });
      }
    }
  }

  // Add todos
  for (const todo of todos) {
    const courseName = courseMap.get(todo.course_id) ?? `課程#${todo.course_id}`;
    if (!allTasks.some((t) => t.id === todo.id)) {
      allTasks.push({ ...todo, _courseName: courseName });
    }
  }

  // Categorize
  const overdue: AssignmentTracker['dueSoon'] = [];
  const dueSoon: AssignmentTracker['dueSoon'] = [];
  const upcoming: AssignmentTracker['upcoming'] = [];
  let completedCount = 0;

  for (const task of allTasks) {
    if (task.status === 'graded' || task.status === 'submitted') {
      completedCount++;
      continue;
    }

    if (!task.end_time) continue;
    const dueDate = new Date(task.end_time).getTime();
    if (isNaN(dueDate)) continue;

    const diff = dueDate - now;
    const hoursLeft = diff / (1000 * 60 * 60);
    const daysLeft = diff / (1000 * 60 * 60 * 24);

    if (diff < 0) {
      // Overdue
      overdue.push({
        title: task.title,
        courseName: task._courseName,
        dueAt: task.end_time,
        hoursLeft: Math.round(hoursLeft),
        isLate: true,
        priority: 'urgent',
      });
    } else if (hoursLeft <= 24) {
      dueSoon.push({
        title: task.title,
        courseName: task._courseName,
        dueAt: task.end_time,
        hoursLeft: Math.round(hoursLeft),
        isLate: false,
        priority: 'urgent',
      });
    } else if (daysLeft <= 3) {
      dueSoon.push({
        title: task.title,
        courseName: task._courseName,
        dueAt: task.end_time,
        hoursLeft: Math.round(hoursLeft),
        isLate: false,
        priority: 'high',
      });
    } else if (daysLeft <= 7) {
      upcoming.push({
        title: task.title,
        courseName: task._courseName,
        dueAt: task.end_time,
        daysLeft: Math.round(daysLeft),
      });
    }
  }

  // Sort by urgency
  dueSoon.sort((a, b) => a.hoursLeft - b.hoursLeft);
  upcoming.sort((a, b) => a.daysLeft - b.daysLeft);

  const total = allTasks.length;
  const completionRate = total > 0 ? Math.round((completedCount / total) * 100) : 100;

  const urgentParts: string[] = [];
  if (overdue.length > 0) urgentParts.push(`${overdue.length}項已逾期`);
  if (dueSoon.length > 0) urgentParts.push(`${dueSoon.length}項即將到期`);

  const summary = urgentParts.length > 0
    ? `作業完成率 ${completionRate}%，${urgentParts.join('、')}！` +
      (overdue.length > 0 ? `最急：${overdue[0].title}(${overdue[0].courseName})` : '')
    : `作業完成率 ${completionRate}%，${upcoming.length > 0 ? `接下來有${upcoming.length}項作業` : '目前沒有待繳作業'}`;

  return {
    total, overdue: overdue.length,
    dueSoon: [...overdue, ...dueSoon],
    upcoming, completionRate, summary,
  };
}

// ─── Course Load Analysis ────────────────────────────────

function analyzeCourseLoad(courses: PUCourse[]): CourseLoadAnalysis {
  if (!courses || courses.length === 0) {
    return {
      totalCourses: 0, totalCredits: 0, dailyLoad: [],
      busiestDay: '無', lightestDay: '無', averageDaily: 0,
      hasGap: false, summary: '尚無課程資料',
    };
  }

  const totalCredits = courses.reduce((sum, c) => sum + (c.credits || 0), 0);

  // Analyze daily load (Mon-Fri = 1-5)
  const dailyMap = new Map<number, { courses: string[]; hours: number }>();
  for (let d = 1; d <= 5; d++) {
    dailyMap.set(d, { courses: [], hours: 0 });
  }

  for (const c of courses) {
    if (c.dayOfWeek == null || c.dayOfWeek < 1 || c.dayOfWeek > 5) continue;
    const day = dailyMap.get(c.dayOfWeek)!;
    day.courses.push(c.name);

    // Calculate hours
    const periods = c.periods?.length ?? 0;
    day.hours += periods > 0 ? periods * 50 / 60 : 1; // 50min per period
  }

  const dailyLoad: CourseLoadAnalysis['dailyLoad'] = [];
  for (const [dayIdx, data] of dailyMap) {
    dailyLoad.push({
      day: `週${DAY_NAMES[dayIdx]}`,
      dayIndex: dayIdx,
      courseCount: data.courses.length,
      hours: Math.round(data.hours * 10) / 10,
      courses: data.courses,
    });
  }

  dailyLoad.sort((a, b) => b.hours - a.hours);
  const busiestDay = dailyLoad[0]?.day ?? '無';
  const lightestDay = dailyLoad[dailyLoad.length - 1]?.day ?? '無';
  const totalHours = dailyLoad.reduce((s, d) => s + d.hours, 0);
  const activeDays = dailyLoad.filter((d) => d.courseCount > 0).length;
  const averageDaily = activeDays > 0 ? Math.round((totalHours / activeDays) * 10) / 10 : 0;

  // Check for gaps (any weekday without classes)
  const hasGap = dailyLoad.some((d) => d.courseCount === 0);

  const summary = `共 ${courses.length} 門課 ${totalCredits} 學分，` +
    `最忙${busiestDay}(${dailyLoad[0]?.courseCount ?? 0}門)，` +
    `平均每天 ${averageDaily} 小時` +
    (hasGap ? '，有空堂日' : '');

  return {
    totalCourses: courses.length, totalCredits, dailyLoad,
    busiestDay, lightestDay, averageDaily, hasGap, summary,
  };
}

// ─── Time Insight ────────────────────────────────────────

function analyzeTimeInsight(courses: PUCourse[], now: Date): TimeInsight {
  const hour = now.getHours();
  const currentPeriod: TimeInsight['currentPeriod'] =
    hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';

  const todayDow = now.getDay(); // 0=Sun
  const todayCourses: TimeInsight['todayCourses'] = [];

  for (const c of courses) {
    if (c.dayOfWeek !== todayDow) continue;
    const startTime = c.startTime ??
      (c.periods?.length ? PERIOD_TIMES[Math.min(...c.periods)]?.start : null) ?? '08:10';
    const endTime = c.endTime ??
      (c.periods?.length ? PERIOD_TIMES[Math.max(...c.periods)]?.end : null) ?? '09:00';

    todayCourses.push({
      name: c.name,
      startTime,
      endTime,
      location: c.location ?? '',
    });
  }

  // Sort by start time
  todayCourses.sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Find next class
  const nowMinutes = hour * 60 + now.getMinutes();
  let nextClass: TimeInsight['nextClass'] = null;
  for (const tc of todayCourses) {
    const [h, m] = tc.startTime.split(':').map(Number);
    const classMinutes = h * 60 + m;
    if (classMinutes > nowMinutes) {
      nextClass = {
        name: tc.name,
        startTime: tc.startTime,
        location: tc.location,
        minutesUntil: classMinutes - nowMinutes,
      };
      break;
    }
  }

  // Calculate free time remaining today (until 21:00)
  const endOfDay = 21 * 60; // 9pm
  let busyMinutes = 0;
  for (const tc of todayCourses) {
    const [sh, sm] = tc.startTime.split(':').map(Number);
    const [eh, em] = tc.endTime.split(':').map(Number);
    const start = Math.max(sh * 60 + sm, nowMinutes);
    const end = eh * 60 + em;
    if (end > nowMinutes) {
      busyMinutes += Math.max(0, end - start);
    }
  }
  const freeTimeToday = Math.max(0, endOfDay - nowMinutes - busyMinutes);

  const parts: string[] = [];
  if (todayCourses.length === 0) {
    parts.push('今天沒有課');
  } else {
    parts.push(`今天有${todayCourses.length}堂課`);
  }
  if (nextClass) {
    parts.push(`下一堂 ${nextClass.name} ${nextClass.startTime}(${nextClass.minutesUntil}分鐘後)`);
  }
  parts.push(`剩餘自由時間約${Math.round(freeTimeToday / 60)}小時`);

  return {
    currentPeriod, nextClass, todayCourses, freeTimeToday,
    summary: parts.join('，'),
  };
}

// ─── Proactive Alerts ────────────────────────────────────

function generateAlerts(
  gpa: GPAAnalysis,
  credits: CreditProgress,
  attendance: AttendanceRisk,
  assignments: AssignmentTracker,
  timeInsight: TimeInsight,
): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = [];
  const now = Date.now();

  // Assignment alerts
  for (const task of assignments.dueSoon) {
    if (task.isLate) {
      alerts.push({
        id: `overdue_${task.title}`,
        type: 'overdue_task',
        severity: 'critical',
        title: `作業已逾期：${task.title}`,
        message: `${task.courseName} 的「${task.title}」已超過截止日！`,
        actionSuggestion: '立即前往 TronClass 繳交，或聯繫老師說明情況',
        timestamp: now,
      });
    } else if (task.hoursLeft <= 24) {
      alerts.push({
        id: `urgent_${task.title}`,
        type: 'assignment_due',
        severity: 'danger',
        title: `作業即將到期：${task.title}`,
        message: `${task.courseName} 的「${task.title}」剩 ${task.hoursLeft} 小時截止！`,
        actionSuggestion: `建議現在開始準備，預計需要 2-3 小時完成`,
        timestamp: now,
      });
    }
  }

  // Attendance alerts
  for (const course of attendance.coursesAtRisk) {
    if (course.riskLevel === 'danger') {
      alerts.push({
        id: `attendance_${course.courseName}`,
        type: 'low_attendance',
        severity: 'danger',
        title: `出席率危險：${course.courseName}`,
        message: `出席率只有 ${course.rate}%，已缺席 ${course.absent} 次！再缺課可能影響成績`,
        actionSuggestion: '接下來的課務必出席，考慮找同學借筆記補進度',
        timestamp: now,
      });
    }
  }

  // GPA alerts
  if (gpa.riskLevel === 'danger' || gpa.riskLevel === 'critical') {
    alerts.push({
      id: 'gpa_risk',
      type: 'grade_drop',
      severity: gpa.riskLevel,
      title: `成績預警：GPA ${gpa.currentGPA}`,
      message: gpa.failedCourses.length > 0
        ? `有 ${gpa.failedCourses.length} 門不及格：${gpa.failedCourses.map((f) => f.name).join('、')}`
        : `成績趨勢持續下滑`,
      actionSuggestion: '建議預約諮商中心學習輔導，或找助教/同學組讀書會',
      timestamp: now,
    });
  } else if (gpa.trend === 'declining') {
    alerts.push({
      id: 'gpa_declining',
      type: 'grade_drop',
      severity: 'watch',
      title: '成績趨勢下滑',
      message: `GPA 從上學期下滑 ${Math.abs(gpa.trendDelta)} 分，注意保持學習節奏`,
      actionSuggestion: '檢視是否有特定科目拉低平均，針對弱科加強',
      timestamp: now,
    });
  }

  // Graduation risk
  if (!credits.onTrack && credits.remainingCredits > 0) {
    alerts.push({
      id: 'graduation_risk',
      type: 'graduation_risk',
      severity: credits.remainingCredits > 60 ? 'watch' : 'warning',
      title: `畢業學分：還需 ${credits.remainingCredits} 學分`,
      message: credits.summary,
      actionSuggestion: `預估還需 ${credits.estimatedGraduationSemesters} 學期，建議每學期修 ${Math.ceil(credits.remainingCredits / Math.max(1, credits.estimatedGraduationSemesters))} 學分以上`,
      timestamp: now,
    });
  }

  // Next class reminder
  if (timeInsight.nextClass && timeInsight.nextClass.minutesUntil <= 30) {
    alerts.push({
      id: 'next_class',
      type: 'study_suggestion',
      severity: 'watch',
      title: `${timeInsight.nextClass.minutesUntil}分鐘後上課`,
      message: `${timeInsight.nextClass.name}，教室：${timeInsight.nextClass.location || '未知'}`,
      actionSuggestion: '該準備出發了',
      timestamp: now,
    });
  }

  // Sort by severity
  const severityOrder: Record<RiskLevel, number> = {
    critical: 0, danger: 1, warning: 2, watch: 3, safe: 4,
  };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}

// ─── Overall Health ──────────────────────────────────────

function computeOverallHealth(
  gpa: GPAAnalysis,
  attendance: AttendanceRisk,
  assignments: AssignmentTracker,
  credits: CreditProgress,
): RiskLevel {
  const levels = [gpa.riskLevel, attendance.riskLevel];
  if (assignments.overdue > 0) levels.push('danger');
  else if (assignments.dueSoon.length > 3) levels.push('warning');
  if (!credits.onTrack) levels.push('watch');

  if (levels.includes('critical')) return 'critical';
  if (levels.includes('danger')) return 'danger';
  if (levels.includes('warning')) return 'warning';
  if (levels.includes('watch')) return 'watch';
  return 'safe';
}

// ─── Main Entry Point ────────────────────────────────────

/**
 * 從所有快取資料來源即時演算使用者的完整學業+生活洞察。
 * 結果可直接注入 AIContext 供 Gemini 引用。
 */
export async function computeRealtimeInsights(
  socialData?: { conversationCount?: number; unreadMessages?: number; groupCount?: number },
): Promise<RealtimeInsights> {
  const now = new Date();

  // ── Gather all cached data ──
  const [
    puCourseResult,
    puGradeResult,
    tcCourses,
    tcActivities,
    tcAttendance,
    tcTodos,
  ] = await Promise.all([
    getAnyCachedCourses().catch(() => null),
    getAnyCachedGrades().catch(() => null),
    getAnyCachedTCCourses().catch(() => null),
    getAnyCachedTCActivities().catch(() => null),
    getAnyCachedTCAttendance().catch(() => null),
    getAnyCachedTCTodos().catch(() => null),
  ]);

  const puCourses = puCourseResult?.courses ?? [];
  const puGrades = puGradeResult?.grades ?? [];
  const gradeSummary = puGradeResult?.summary ?? {};

  // Build course name map from TC courses
  const courseMap = new Map<number, string>();
  if (tcCourses) {
    for (const c of tcCourses) {
      courseMap.set(c.id, c.name);
    }
  }

  // ── Run all analyses ──
  const gpa = analyzeGPA(puGrades, gradeSummary);
  const credits = analyzeCreditProgress(puGrades, puCourses);
  const attendance = analyzeAttendanceRisk(tcAttendance ?? []);
  const assignments = analyzeAssignments(
    tcActivities ?? {},
    tcTodos ?? [],
    courseMap,
  );
  const courseLoad = analyzeCourseLoad(puCourses);
  const timeInsight = analyzeTimeInsight(puCourses, now);

  // Social score
  const convCount = socialData?.conversationCount ?? 0;
  const unread = socialData?.unreadMessages ?? 0;
  const groups = socialData?.groupCount ?? 0;
  const activityScore = Math.min(100, convCount * 10 + groups * 5 + (unread > 0 ? 10 : 0));
  const social: SocialScore = {
    conversationCount: convCount,
    unreadMessages: unread,
    groupCount: groups,
    activityScore,
    level: activityScore >= 80 ? 'very_active' : activityScore >= 60 ? 'active' :
           activityScore >= 40 ? 'moderate' : activityScore >= 20 ? 'low' : 'inactive',
    summary: `社交活躍度 ${activityScore}/100，${unread > 0 ? `${unread}則未讀訊息` : '無未讀訊息'}`,
  };

  // ── Alerts ──
  const alerts = generateAlerts(gpa, credits, attendance, assignments, timeInsight);

  // ── Overall ──
  const overallHealth = computeOverallHealth(gpa, attendance, assignments, credits);

  // Build overall summary
  const summaryParts: string[] = [];
  if (gpa.currentGPA !== null) summaryParts.push(`GPA ${gpa.currentGPA}`);
  summaryParts.push(`學分 ${credits.totalEarned}/${GRADUATION_CREDITS}`);
  summaryParts.push(`出席 ${attendance.overallRate}%`);
  if (assignments.overdue > 0) summaryParts.push(`${assignments.overdue}項逾期作業`);
  if (timeInsight.nextClass) {
    summaryParts.push(`下一堂${timeInsight.nextClass.name}(${timeInsight.nextClass.minutesUntil}分後)`);
  }
  if (alerts.length > 0) summaryParts.push(`${alerts.length}項提醒`);

  return {
    gpa, credits, attendance, assignments, courseLoad,
    timeInsight, social, alerts, overallHealth,
    overallSummary: summaryParts.join(' | '),
    computedAt: now.getTime(),
  };
}

/**
 * 將 RealtimeInsights 轉為簡潔的中文摘要，適合注入 AI system prompt。
 */
export function insightsToPromptText(insights: RealtimeInsights): string {
  const sections: string[] = [];

  sections.push('## 即時學業分析（AI 演算結果）');
  sections.push('');

  // GPA
  sections.push(`### 成績分析`);
  sections.push(insights.gpa.summary);
  if (insights.gpa.failedCourses.length > 0) {
    sections.push(`不及格科目：${insights.gpa.failedCourses.map((f) => `${f.name}(${f.score})`).join('、')}`);
  }
  if (insights.gpa.lowScoreCourses.length > 0) {
    sections.push(`低分預警科目：${insights.gpa.lowScoreCourses.slice(0, 5).map((f) => `${f.name}(${f.score})`).join('、')}`);
  }

  // Credits
  sections.push('');
  sections.push(`### 學分進度`);
  sections.push(insights.credits.summary);

  // Attendance
  sections.push('');
  sections.push(`### 出席分析`);
  sections.push(insights.attendance.summary);

  // Assignments
  sections.push('');
  sections.push(`### 作業追蹤`);
  sections.push(insights.assignments.summary);
  if (insights.assignments.dueSoon.length > 0) {
    sections.push('即將到期：');
    for (const t of insights.assignments.dueSoon.slice(0, 5)) {
      const tag = t.isLate ? '⚠️逾期' : `剩${t.hoursLeft}小時`;
      sections.push(`  - ${t.title}(${t.courseName}) — ${tag}`);
    }
  }

  // Course load
  sections.push('');
  sections.push(`### 課程負載`);
  sections.push(insights.courseLoad.summary);

  // Time
  sections.push('');
  sections.push(`### 今日狀態`);
  sections.push(insights.timeInsight.summary);
  if (insights.timeInsight.todayCourses.length > 0) {
    sections.push('今日課程：');
    for (const c of insights.timeInsight.todayCourses) {
      sections.push(`  - ${c.startTime}-${c.endTime} ${c.name} (${c.location || '教室未定'})`);
    }
  }

  // Alerts
  if (insights.alerts.length > 0) {
    sections.push('');
    sections.push(`### 主動提醒（${insights.alerts.length}項）`);
    for (const a of insights.alerts.slice(0, 8)) {
      const icon = a.severity === 'critical' ? '🚨' : a.severity === 'danger' ? '⚠️' :
                   a.severity === 'warning' ? '⚡' : 'ℹ️';
      sections.push(`${icon} ${a.title}：${a.message}`);
      sections.push(`   → ${a.actionSuggestion}`);
    }
  }

  // Overall
  sections.push('');
  const healthEmoji = insights.overallHealth === 'safe' ? '✅' :
    insights.overallHealth === 'watch' ? '👀' : insights.overallHealth === 'warning' ? '⚡' :
    insights.overallHealth === 'danger' ? '⚠️' : '🚨';
  sections.push(`### 整體狀態：${healthEmoji} ${insights.overallHealth.toUpperCase()}`);
  sections.push(insights.overallSummary);

  sections.push('');
  sections.push('**你必須在回答中主動引用以上分析結果。當使用者問學業相關問題時，直接引用具體數據。當偵測到風險時，主動提醒並建議行動方案。**');

  return sections.join('\n');
}
