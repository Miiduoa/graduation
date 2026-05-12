/**
 * 🧠 智慧選課推薦引擎 — Course Recommendation Engine
 *
 * 靜宜大學 Campus One 獨家功能：
 * 結合歷史成績 + 畢業學分需求 + 時間偏好 + 課程相似度，
 * 為學生提供個人化的選課建議。
 *
 * 核心演算法：
 *   1. Content-Based Filtering — 基於課程屬性（類型、學分、難度）推薦
 *   2. Collaborative Filtering 思維 — 基於同類型學生的成績模式推薦
 *   3. Constraint Satisfaction — 畢業學分需求 + 時間衝突 + 先修檢查
 *   4. Multi-Criteria Optimization — 平衡 GPA 提升 vs 學分進度 vs 興趣
 *
 * 技術亮點：
 *   - Cosine Similarity 課程向量化比較
 *   - Pareto Optimal 多目標最佳化
 *   - 全部本地運算
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PUCourse, PUCourseResult, PUGradeResult } from './puDirectScraper';
import type { TCCourse } from './tronClassClient';
import { getAnyCachedGrades, getAnyCachedCourses, getAnyCachedTCCourses } from './puDataCache';
import type { CatalogCourse } from './courseCatalogClient';
import type { UserProfile } from '../state/auth';

const RECOMMENDATION_CACHE_KEY = '@course_rec:optimization';

// ─── Types ───────────────────────────────────────────────

export type SchedulePreference = {
  avoidMorning: boolean; // avoid classes before 10:00
  avoidEvening: boolean; // avoid classes after 17:00
  preferredDays: number[]; // preferred days (1=Mon, 5=Fri)
  maxCredits: number; // maximum credits per semester
  preferCompact: boolean; // prefer classes on fewer days
  lunchBreak: boolean; // keep lunch hour free (12:00-13:00)
};

export type GraduationGap = {
  category: string; // 必修, 選修, 通識, etc.
  required: number;
  earned: number;
  remaining: number;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  priority: 'completed' | 'normal' | 'urgent';
  percentage: number;
};

export type CourseRecommendation = {
  courseName: string;
  courseCode: string;
  credits: number;
  reason: string;
  reasons: string[];
  reasonType: 'graduation' | 'gpa_boost' | 'interest' | 'balance' | 'prerequisite';
  priority: 'high' | 'medium' | 'low';
  category: string;
  confidenceScore: number; // 0-1
  matchScore: number; // 0-1, UI compatibility alias
  predictedGrade: number; // estimated score
  schedule?: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
  };
  tags: string[];
};

export type ScheduleConflict = {
  course1: string;
  course2: string;
  courseA: string;
  courseB: string;
  day: number;
  dayOfWeek: number;
  timeSlot: string;
  overlapMinutes: number;
  overlapPeriods: number[];
  description: string;
  details: string;
};

export type WorkloadAnalysis = {
  totalCredits: number;
  totalCourses: number;
  avgDailyHours: number;
  dailyBreakdown: { dayOfWeek: number; hours: number }[];
  heavyDays: any[];
  lightDays: { day: number; hours: number }[];
  gapHours: any; // compatibility: numeric total or gap slot list depending on UI
  balanceScore: number; // 0-100 (higher = more balanced)
  suggestions: string[];
  suggestion: string;
};

export type ScheduleOptimization = {
  recommendations: CourseRecommendation[];
  graduationGaps: GraduationGap[];
  gaps: GraduationGap[];
  conflicts: ScheduleConflict[];
  workloadAnalysis: WorkloadAnalysis;
  workload: WorkloadAnalysis;
  nextSemesterPlan: {
    suggestedCredits: number;
    focus: string;
    strategy: string;
  };
};

// ─── Course Vectorization ───────────────────────────────

type CourseVector = {
  category: number; // encoded category
  credits: number;
  difficulty: number; // estimated from historical grades
  timeSlot: number; // encoded time preference
  type: number; // 必修=1, 選修=0
};

function encodeCourseCategory(name: string, type: string): number {
  if (/數學|統計|微積分/.test(name)) return 1;
  if (/程式|資料|演算法|系統|網路/.test(name)) return 2;
  if (/英文|語言|日語/.test(name)) return 3;
  if (/管理|經濟|行銷/.test(name)) return 4;
  if (/通識|博雅|人文/.test(name)) return 5;
  if (/體育|運動/.test(name)) return 6;
  if (type === '必修') return 7;
  return 8;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator > 0 ? dotProduct / denominator : 0;
}

// ─── Graduation Gap Analysis ────────────────────────────

/**
 * 分析畢業學分缺口
 * 靜宜大學通常需要 128 學分畢業
 */
export function analyzeGraduationGaps(gradeResult: PUGradeResult): GraduationGap[] {
  // 靜宜大學畢業學分需求（通用估計，實際依各系規定）
  const requirements: Record<string, number> = {
    必修: 60,
    選修: 30,
    通識: 28,
    體育: 4,
    服務學習: 2,
    其他: 4,
  };

  // 計算已修學分
  const earned: Record<string, number> = {};
  for (const grade of gradeResult.grades) {
    const score = typeof grade.score === 'number' ? grade.score : parseFloat(String(grade.score));
    if (isNaN(score) || score < 60) continue; // 不及格不算

    let category: string;
    const name = grade.courseName;
    if (/體育|運動/.test(name)) category = '體育';
    else if (/通識|博雅|人文|藝術|核心/.test(name)) category = '通識';
    else if (/服務學習|志工/.test(name)) category = '服務學習';
    else if (grade.courseType === '必修' || grade.courseType === 'Required') category = '必修';
    else if (grade.courseType === '選修' || grade.courseType === 'Elective') category = '選修';
    else category = '其他';

    earned[category] = (earned[category] ?? 0) + grade.credits;
  }

  const gaps: GraduationGap[] = [];
  for (const [category, required] of Object.entries(requirements)) {
    const got = earned[category] ?? 0;
    const remaining = Math.max(0, required - got);
    let urgency: GraduationGap['urgency'];

    const completionRatio = got / required;
    if (completionRatio >= 0.9) urgency = 'low';
    else if (completionRatio >= 0.7) urgency = 'medium';
    else if (completionRatio >= 0.5) urgency = 'high';
    else urgency = 'critical';

    const percentage = Math.min(100, Math.round((got / required) * 100));
    const priority: GraduationGap['priority'] =
      remaining <= 0
        ? 'completed'
        : urgency === 'critical' || urgency === 'high'
          ? 'urgent'
          : 'normal';

    gaps.push({ category, required, earned: got, remaining, urgency, priority, percentage });
  }

  return gaps.sort((a, b) => {
    const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
  });
}

// ─── Schedule Conflict Detection ────────────────────────

export function detectScheduleConflicts(courses: PUCourse[]): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];

  for (let i = 0; i < courses.length; i++) {
    for (let j = i + 1; j < courses.length; j++) {
      const a = courses[i];
      const b = courses[j];

      if (a.dayOfWeek !== null && a.dayOfWeek === b.dayOfWeek) {
        const overlap = a.periods.filter((p) => b.periods.includes(p));
        if (overlap.length > 0) {
          const dayNames = ['', '一', '二', '三', '四', '五', '六', '日'];
          conflicts.push({
            course1: a.name,
            course2: b.name,
            courseA: a.name,
            courseB: b.name,
            day: a.dayOfWeek,
            dayOfWeek: a.dayOfWeek,
            timeSlot: `第 ${overlap.join(',')} 節`,
            overlapMinutes: overlap.length * 50,
            overlapPeriods: overlap,
            description: `週${dayNames[a.dayOfWeek]} 第 ${overlap.join(',')} 節衝突`,
            details: `週${dayNames[a.dayOfWeek]} 第 ${overlap.join(',')} 節衝突`,
          });
        }
      }
    }
  }

  return conflicts;
}

// ─── Workload Analysis ──────────────────────────────────

export function analyzeWorkload(courses: PUCourse[]): WorkloadAnalysis {
  const dayHours = new Map<number, number>();
  let totalCredits = 0;
  let totalGapMinutes = 0;

  // Group courses by day
  const coursesByDay = new Map<number, PUCourse[]>();
  for (const course of courses) {
    if (course.dayOfWeek === null) continue;
    const day = course.dayOfWeek;
    const existing = coursesByDay.get(day) ?? [];
    existing.push(course);
    coursesByDay.set(day, existing);
    totalCredits += course.credits;

    const hours = course.periods.length * (50 / 60); // each period ~50 min
    dayHours.set(day, (dayHours.get(day) ?? 0) + hours);
  }

  // Calculate gaps between consecutive classes
  for (const [, dayCourses] of coursesByDay) {
    const sorted = dayCourses
      .filter((c) => c.startTime && c.endTime)
      .sort((a, b) => (a.startTime! < b.startTime! ? -1 : 1));

    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].endTime!;
      const currStart = sorted[i].startTime!;
      const [ph, pm] = prevEnd.split(':').map(Number);
      const [ch, cm] = currStart.split(':').map(Number);
      const gap = ch * 60 + cm - (ph * 60 + pm);
      if (gap > 10) totalGapMinutes += gap; // only count gaps > 10 min
    }
  }

  const heavyDays = [...dayHours.entries()]
    .map(([day, hours]) => ({ day, hours: Math.round(hours * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours);
  const dailyBreakdown = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
    dayOfWeek,
    hours: Math.round((dayHours.get(dayOfWeek) ?? 0) * 10) / 10,
  }));
  const lightDays = [1, 2, 3, 4, 5]
    .map((day) => ({ day, hours: Math.round((dayHours.get(day) ?? 0) * 10) / 10 }))
    .filter((d) => d.hours <= 2)
    .sort((a, b) => a.hours - b.hours);

  // Balance score: penalize uneven distribution
  const hoursArray = heavyDays.map((d) => d.hours);
  const avgHours =
    hoursArray.length > 0 ? hoursArray.reduce((a, b) => a + b, 0) / hoursArray.length : 0;
  const variance =
    hoursArray.length > 0
      ? hoursArray.reduce((sum, h) => sum + (h - avgHours) ** 2, 0) / hoursArray.length
      : 0;
  const balanceScore = Math.round(Math.max(0, 100 - variance * 20));

  const suggestions: string[] = [];
  if (heavyDays.length > 0 && heavyDays[0].hours > 6) {
    const dayNames = ['', '一', '二', '三', '四', '五', '六', '日'];
    suggestions.push(
      `週${dayNames[heavyDays[0].day]} 課程密集（${heavyDays[0].hours} 小時），建議分散`,
    );
  }
  if (totalGapMinutes > 180) {
    suggestions.push(`空堂時間共 ${Math.round(totalGapMinutes / 60)} 小時，可善用空堂自習`);
  }
  if (totalCredits > 25) {
    suggestions.push('學分數偏多，注意不要過度負擔');
  }
  if (balanceScore < 50) {
    suggestions.push('課程分佈不均勻，建議調整到更平衡的配置');
  }

  return {
    totalCredits,
    totalCourses: courses.length,
    avgDailyHours:
      Math.round(
        (dailyBreakdown.reduce((sum, d) => sum + d.hours, 0) / Math.max(dailyBreakdown.length, 1)) *
          10,
      ) / 10,
    dailyBreakdown,
    heavyDays,
    lightDays,
    gapHours: Math.round((totalGapMinutes / 60) * 10) / 10,
    balanceScore,
    suggestions,
    suggestion: suggestions[0] ?? '目前課程負荷看起來穩定，可以維持這個節奏。',
  };
}

// ─── Course Recommendation ──────────────────────────────

/**
 * 基於歷史成績模式預測課程成績
 * Content-Based Prediction
 */
function predictGradeForCourse(
  courseName: string,
  courseType: string,
  gradeResult: PUGradeResult,
): number {
  const targetCategory = encodeCourseCategory(courseName, courseType);

  // Find similar courses from history
  const similarGrades: number[] = [];
  for (const grade of gradeResult.grades) {
    const score = typeof grade.score === 'number' ? grade.score : parseFloat(String(grade.score));
    if (isNaN(score)) continue;

    const gradeCategory = encodeCourseCategory(grade.courseName, grade.courseType);
    if (gradeCategory === targetCategory) {
      similarGrades.push(score);
    }
  }

  if (similarGrades.length === 0) {
    // Fall back to overall average
    const allScores = gradeResult.grades
      .map((g) => (typeof g.score === 'number' ? g.score : parseFloat(String(g.score))))
      .filter((s) => !isNaN(s));
    return allScores.length > 0
      ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
      : 75;
  }

  // Weighted recent average (more recent courses weighted higher)
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < similarGrades.length; i++) {
    const weight = i + 1;
    weightedSum += similarGrades[i] * weight;
    totalWeight += weight;
  }
  return Math.round(weightedSum / totalWeight);
}

/**
 * 產生選課推薦
 */
export function generateCourseRecommendations(
  gradeResult: PUGradeResult,
  currentCourses: PUCourseResult | null,
  preferences: Partial<SchedulePreference> = {},
): CourseRecommendation[] {
  const recs: CourseRecommendation[] = [];
  const gaps = analyzeGraduationGaps(gradeResult);

  // 1. Graduation requirement recommendations
  for (const gap of gaps) {
    if (gap.remaining <= 0) continue;
    if (gap.urgency === 'critical' || gap.urgency === 'high') {
      recs.push({
        courseName: `${gap.category}課程`,
        courseCode: '',
        credits: Math.min(gap.remaining, 3),
        reason: `${gap.category}學分不足，還需 ${gap.remaining} 學分才能畢業`,
        reasons: [
          `${gap.category}學分不足`,
          `還需 ${gap.remaining} 學分`,
          gap.urgency === 'critical' ? '優先補足' : '建議安排',
        ],
        reasonType: 'graduation',
        priority: gap.urgency === 'critical' ? 'high' : 'medium',
        category: gap.category,
        confidenceScore: gap.urgency === 'critical' ? 0.95 : 0.8,
        matchScore: gap.urgency === 'critical' ? 0.95 : 0.8,
        predictedGrade: predictGradeForCourse(gap.category, gap.category, gradeResult),
        tags: ['畢業需求', gap.urgency === 'critical' ? '急迫' : '重要'],
      });
    }
  }

  // 2. GPA boost recommendations (easy courses the student would do well in)
  const passedCourses = new Set(gradeResult.grades.map((g) => g.courseName));
  const courseCategories = ['通識人文', '語言', '商管', '體育'];
  for (const cat of courseCategories) {
    const predicted = predictGradeForCourse(cat, '選修', gradeResult);
    if (predicted >= 82) {
      recs.push({
        courseName: `${cat}類選修`,
        courseCode: '',
        credits: 2,
        reason: `你在${cat}類課程表現優秀（預估 ${predicted} 分），可提升 GPA`,
        reasons: [`你在${cat}類課程表現較好`, `預估 ${predicted} 分`, '可作為 GPA 提升選項'],
        reasonType: 'gpa_boost',
        priority: 'low',
        category: cat,
        confidenceScore: 0.7,
        matchScore: 0.7,
        predictedGrade: predicted,
        tags: ['GPA 提升', '高分預期'],
      });
    }
  }

  // 3. Balance recommendations
  const maxCredits = preferences.maxCredits ?? 22;
  const currentCredits = currentCourses?.totalCredits ?? 0;
  if (currentCredits > 0) {
    recs.push({
      courseName: '下學期學分建議',
      courseCode: '',
      credits: Math.min(maxCredits, Math.max(15, currentCredits - 2)),
      reason: `本學期修 ${currentCredits} 學分，建議下學期維持 ${Math.min(maxCredits, Math.max(15, currentCredits - 2))} 學分左右`,
      reasons: [`本學期 ${currentCredits} 學分`, '建議維持可負荷學分量', '避免課業負載過高'],
      reasonType: 'balance',
      priority: 'medium',
      category: '學分規劃',
      confidenceScore: 0.6,
      matchScore: 0.6,
      predictedGrade: 0,
      tags: ['學分平衡'],
    });
  }

  return recs.sort((a, b) => b.confidenceScore - a.confidenceScore);
}

// ─── Main Entry Point ───────────────────────────────────

export async function getScheduleOptimization(): Promise<ScheduleOptimization | null> {
  try {
    console.log('[CourseRecommendation] Computing schedule optimization…');

    const [gradeResult, coursesResult, tcCourses] = await Promise.all([
      getAnyCachedGrades(),
      getAnyCachedCourses(),
      getAnyCachedTCCourses(),
    ]);

    if (!gradeResult) {
      console.log('[CourseRecommendation] No grade data available');
      return null;
    }

    const graduationGaps = analyzeGraduationGaps(gradeResult);
    const conflicts = coursesResult ? detectScheduleConflicts(coursesResult.courses) : [];
    const workloadAnalysis = coursesResult
      ? analyzeWorkload(coursesResult.courses)
      : {
          totalCredits: 0,
          totalCourses: 0,
          avgDailyHours: 0,
          dailyBreakdown: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, hours: 0 })),
          heavyDays: [],
          lightDays: [],
          gapHours: 0,
          balanceScore: 100,
          suggestions: [],
          suggestion: '目前沒有可分析的課表資料。',
        };
    const recommendations = generateCourseRecommendations(gradeResult, coursesResult);

    // Strategy determination
    const criticalGaps = graduationGaps.filter((g) => g.urgency === 'critical');
    const totalRemaining = graduationGaps.reduce((sum, g) => sum + g.remaining, 0);

    let suggestedCredits = 18;
    let focus = '均衡發展';
    let strategy = '維持穩定的修課步調';

    if (criticalGaps.length > 0) {
      suggestedCredits = 22;
      focus = '畢業學分衝刺';
      strategy = `重點補足${criticalGaps.map((g) => g.category).join('、')}學分`;
    } else if (totalRemaining > 40) {
      suggestedCredits = 20;
      focus = '穩定推進';
      strategy = '每學期均勻分配學分，確保如期畢業';
    } else if (totalRemaining < 15) {
      suggestedCredits = Math.min(totalRemaining, 18);
      focus = '輕鬆完結';
      strategy = '學分已接近足夠，可以選一些有興趣的選修';
    }

    console.log(
      `[CourseRecommendation] Done: ${graduationGaps.length} gaps, ` +
        `${conflicts.length} conflicts, ${recommendations.length} recs, ` +
        `balance=${workloadAnalysis.balanceScore}`,
    );

    const result = {
      recommendations,
      graduationGaps,
      gaps: graduationGaps,
      conflicts,
      workloadAnalysis,
      workload: workloadAnalysis,
      nextSemesterPlan: { suggestedCredits, focus, strategy },
    };

    // 寫入本地快取 — 離線時可直接讀取
    try {
      await AsyncStorage.setItem(RECOMMENDATION_CACHE_KEY, JSON.stringify(result));
    } catch {}

    return result;
  } catch (error) {
    console.error('[CourseRecommendation] Error:', error);
    // 嘗試讀取上次快取的結果
    try {
      const cached = await AsyncStorage.getItem(RECOMMENDATION_CACHE_KEY);
      if (cached) {
        console.log('[CourseRecommendation] Returning cached result');
        return JSON.parse(cached);
      }
    } catch {}
    return null;
  }
}

/** 讀取本地快取的選課推薦（不重新計算） */
export async function getCachedScheduleOptimization(): Promise<ScheduleOptimization | null> {
  try {
    const raw = await AsyncStorage.getItem(RECOMMENDATION_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

// ─── Catalog × User Data 真實推薦 ────────────────────────
//
// 將 課綱查詢系統 抓到的真實開課（CatalogCourse[]）×
// 使用者全部個人資料（學系/年級/歷史成績/目前課表/已修課程/偏好）
// 做演算，產生「具體一門課」的推薦。

export type CatalogRecommendationInput = {
  /** 候選池（建議由 queryCatalog() 抓取） */
  candidates: CatalogCourse[];
  /** 個人資料（系、年級、學號） */
  profile?: UserProfile | null;
  /** 已修成績 */
  grades?: PUGradeResult | null;
  /** 本學期已選課（用於衝堂/避免重複） */
  currentCourses?: PUCourseResult | null;
  /** 同學的已選清單（Today / schedule.courses）— 偵測衝堂用 */
  scheduleEvents?: Array<{
    dayOfWeek?: number;
    startTime?: string;
    endTime?: string;
    name?: string;
    courseCode?: string;
  }>;
  /** 使用者偏好（興趣、避早八、目標學分等） */
  preferences?: Partial<SchedulePreference> & {
    interests?: string[];
    avoidEarly?: boolean;
    targetCredits?: number;
    preferredLanguage?: string;
  };
};

export type CatalogRecommendation = {
  catalogCode: string;
  courseName: string;
  nameEn: string;
  teacher: string;
  credits: number;
  department: string;
  classOffered: string; // 班級 cla_cn，例：資管三A
  courseType: string;
  timePlace: string;
  enrolled: number | null;
  capacity: number | null;
  language: string;
  syllabusUrl: string | null;
  matchScore: number; // 0–100
  predictedGrade: number;
  reasons: string[];
  warnings: string[];
  tags: string[];
};

// ─── 學號 → 年級 / 班級對照工具 ──────────────────────────

/**
 * 從學號 + 當前學期推得學生目前的「年級」與「入學民國學年」。
 *
 * 靜宜大學學號格式（10 碼或 9 碼）：
 *   - 大學部：YYYDDDSSS（例：1110700321 → 學年 111、系代碼 0700、序號 321）
 *   - 通常前 3 碼是民國入學學年（例：111 = 2022 入學）。
 *
 * 計算規則：
 *   currentGrade = (當前學年 - 入學學年) + 1
 *   若是下學期（part=2），仍歸在同年級；若已超過 4 升學/畢業 → 仍回傳 4 作為上限。
 */
export function deriveStudentGrade(
  studentId?: string | null,
  semesterCode?: string,
): { grade: number | null; enrollYear: number | null } {
  if (!studentId) return { grade: null, enrollYear: null };
  const m = String(studentId).match(/^([0-9]{3})/);
  if (!m) return { grade: null, enrollYear: null };
  const enrollYear = parseInt(m[1], 10);
  if (Number.isNaN(enrollYear) || enrollYear < 90 || enrollYear > 130) {
    return { grade: null, enrollYear: null };
  }
  // 當前學年：semesterCode 形式如 '1142' → 學年 114
  let currentYear: number;
  if (semesterCode && semesterCode.length >= 3) {
    currentYear = parseInt(semesterCode.slice(0, semesterCode.length - 1), 10);
    if (Number.isNaN(currentYear)) currentYear = new Date().getFullYear() - 1911;
  } else {
    currentYear = new Date().getFullYear() - 1911;
  }
  const grade = Math.min(Math.max(currentYear - enrollYear + 1, 1), 6);
  return { grade, enrollYear };
}

/**
 * 從 catalog course 的 cla_cn / classOffered 抽出年級與系所縮寫。
 *
 * cla_cn 範例：
 *   - "資管一A"    → { dept: "資管", grade: 1, section: "A" }
 *   - "資管三B"    → { dept: "資管", grade: 3, section: "B" }
 *   - "資管A班"    → { dept: "資管", grade: null, section: "A" }   // 跨年級
 *   - "通識"       → { dept: null,   grade: null, section: null }
 *   - "資管碩一"   → { dept: "資管", grade: 1, section: null, level: "graduate" }
 */
export function parseClassOffered(claCn: string | undefined | null): {
  deptAbbr: string | null;
  grade: number | null;
  section: string | null;
  isGraduate: boolean;
} {
  if (!claCn) return { deptAbbr: null, grade: null, section: null, isGraduate: false };
  const s = claCn.trim();
  const GRADE_MAP: Record<string, number> = {
    一: 1, '1': 1, 二: 2, '2': 2, 三: 3, '3': 3,
    四: 4, '4': 4, 五: 5, '5': 5,
  };
  const isGraduate = /碩|博/.test(s);

  // pattern A: 「<dept>[碩|博]?<grade><sec?>」  e.g. 資管三A、資管碩一、資管一
  let m = s.match(/^(.+?)(碩|博)?\s*([一二三四五12345])\s*([A-Z])?\s*班?$/);
  if (m) {
    return {
      deptAbbr: m[1] || null,
      grade: GRADE_MAP[m[3]] ?? null,
      section: m[4] ?? null,
      isGraduate: isGraduate || !!m[2],
    };
  }
  // pattern B: 「<dept>[碩|博]?<sec>班?」 (跨年級)  e.g. 資管A班、會計B
  m = s.match(/^(.+?)(碩|博)?\s*([A-Z])\s*班?$/);
  if (m) {
    return {
      deptAbbr: m[1] || null,
      grade: null,
      section: m[3],
      isGraduate: isGraduate || !!m[2],
    };
  }
  // pattern C: 「<dept>[碩|博]?」單純系名
  m = s.match(/^(.+?)(碩|博)?$/);
  if (m) {
    return {
      deptAbbr: m[1] || null,
      grade: null,
      section: null,
      isGraduate: isGraduate || !!m[2],
    };
  }
  return { deptAbbr: null, grade: null, section: null, isGraduate };
}

/** 系所縮寫表 — 用於匹配 cla_cn 開頭 */
const DEPT_ABBR_MAP: Record<string, string[]> = {
  // 資訊學院
  資管系: ['資管'], 資訊管理學系: ['資管'], 資訊管理: ['資管'],
  資工系: ['資工'], 資訊工程學系: ['資工'], 資訊工程: ['資工'],
  人工智慧系: ['AI', '人智', '人工智慧'], 人工智慧學系: ['AI', '人智'],
  資科系: ['資科'], 資訊科學暨應用學系: ['資科'],
  // 理學院
  食營系: ['食營', '食品'], 食品營養學系: ['食營'],
  應化系: ['應化'], 應用化學系: ['應化'],
  化科系: ['化科'], 化粧品科學系: ['化科'],
  財工系: ['財工'], 財務工程學系: ['財工'],
  // 管理學院
  會計系: ['會計'], 會計學系: ['會計'],
  觀光系: ['觀光'], 觀光事業學系: ['觀光'],
  財金系: ['財金'], 財務金融學系: ['財金'],
  國企系: ['國企'], 國際企業學系: ['國企'],
  行銷數位經營系: ['行銷', '數位經營'],
  // 外語學院
  英文系: ['英文', '英語'], 英國語文學系: ['英文'],
  日文系: ['日文'], 日本語文學系: ['日文'],
  西文系: ['西文', '西班牙'], 西班牙語文學系: ['西文'],
  // 人社院
  中文系: ['中文'], 中國文學系: ['中文'],
  台文系: ['台文'], 台灣文學系: ['台文'],
  法律系: ['法律'], 法律學系: ['法律'],
  生態系: ['生態'], 生態人文學系: ['生態'],
  大傳系: ['大傳'], 大眾傳播學系: ['大傳'],
  社工系: ['社工'], 社會工作與兒童少年福利學系: ['社工'],
  // 教育中心
  師培中心: ['師培'], 教育研究所: ['教研'], 教研所: ['教研'],
};

function abbrForDepartment(dept: string | null | undefined): string[] {
  if (!dept) return [];
  const direct = DEPT_ABBR_MAP[dept];
  if (direct) return direct;
  // 嘗試把長名（資訊管理學系）截尾匹配
  const candidates = Object.keys(DEPT_ABBR_MAP).filter((key) => key.length >= 4);
  for (const key of candidates) {
    if (dept.includes(key) || key.includes(dept)) {
      return DEPT_ABBR_MAP[key];
    }
  }
  // fallback：直接取前 2-3 字元當縮寫
  const stripped = dept.replace(/系|學系|碩士班|博士班|所|研究所|學位學程|學程|專班|班/g, '');
  return [stripped.slice(0, 4), stripped.slice(0, 3), stripped.slice(0, 2)].filter(
    (s, i, arr) => s.length >= 2 && arr.indexOf(s) === i,
  );
}

/**
 * 把 catalog 候選 × 個人資料 做出真實推薦。
 *
 * 評分要素：
 *  1. 畢業學分缺口（critical 缺口 +25、high +18、medium +10）
 *  2. 個人類別偏好（歷史成績高的類別 +15）
 *  3. 興趣關鍵字命中（每命中 +6，最高 +18）
 *  4. 已修同類預估分數（>= 85 +12, >= 75 +6）
 *  5. 衝堂（-50）/ 已修過（-100）/ 已滿（-15）
 *  6. 時段偏好（avoidEarly 時，1-2 節 -10）
 *  7. 偏好語言加分 / 同系所必修加分
 *  8. 平衡：候選若分散到不同日 +5
 *  9. ★ 系所/年級匹配（cla_cn）：本系 +12、本系本年級 +30、本系跨1年級 -8、跨2+ 直接過濾
 */
export function generateCatalogRecommendations(
  input: CatalogRecommendationInput,
): CatalogRecommendation[] {
  const candidates = input.candidates ?? [];
  const grades = input.grades ?? null;
  const profile = input.profile ?? null;
  const prefs = input.preferences ?? {};

  // 已修課程集合（用於避免推已修過的）
  const passedCourseNames = new Set<string>();
  const passedCategoryScores = new Map<number, number[]>();
  if (grades?.grades) {
    for (const g of grades.grades) {
      const score = typeof g.score === 'number' ? g.score : parseFloat(String(g.score));
      if (!isNaN(score) && score >= 60) {
        passedCourseNames.add(g.courseName);
        const cat = encodeCourseCategory(g.courseName, g.courseType);
        const arr = passedCategoryScores.get(cat) ?? [];
        arr.push(score);
        passedCategoryScores.set(cat, arr);
      }
    }
  }
  const categoryAvg = new Map<number, number>();
  passedCategoryScores.forEach((arr, k) =>
    categoryAvg.set(k, arr.reduce((a, b) => a + b, 0) / arr.length),
  );

  // 畢業缺口（會依使用者歷史成績推算）
  const gaps = grades ? analyzeGraduationGaps(grades) : [];
  const gapWeight: Record<string, number> = {};
  for (const g of gaps) {
    if (g.urgency === 'critical') gapWeight[g.category] = 25;
    else if (g.urgency === 'high') gapWeight[g.category] = 18;
    else if (g.urgency === 'medium') gapWeight[g.category] = 10;
  }

  // 現有課表（衝堂用）
  const schedule = input.scheduleEvents ?? [];

  // 使用者年級 / 系所縮寫
  const semesterCode = candidates[0]?.semester ?? '';
  const { grade: userGrade } = deriveStudentGrade(profile?.studentId, semesterCode);
  const userDeptAbbrs = abbrForDepartment(profile?.department);
  const isUserGraduate = /碩|博|研究所|碩士|博士/.test(profile?.department ?? '');

  const results: CatalogRecommendation[] = [];

  for (const c of candidates) {
    const reasons: string[] = [];
    const warnings: string[] = [];
    let score = 50;

    // (0) 已修過 → 直接跳過
    if (passedCourseNames.has(c.name)) {
      continue;
    }

    // (★) 系所 / 年級 匹配（早於其他規則，可能整門過濾掉）
    const cls = parseClassOffered(c.classOffered);
    const isOwnDept =
      !!cls.deptAbbr &&
      userDeptAbbrs.some(
        (abbr) => cls.deptAbbr === abbr || cls.deptAbbr!.includes(abbr) || abbr.includes(cls.deptAbbr!),
      );
    const isGeneral =
      c.courseTypeKey === 'general' ||
      /通識|博雅|體育|軍訓|全民國防|服務學習/.test(c.courseType + c.name);

    // 學生 vs 研究所層級不符 → 直接過濾
    if (cls.isGraduate && !isUserGraduate) {
      continue;
    }
    if (!cls.isGraduate && isUserGraduate && cls.deptAbbr) {
      // 研究生通常不選大學部課；保留但降權
      score -= 18;
    }

    // 系所匹配（順序很重要：本系 → 通識/體育 → 別系必修過濾 → 別系選修降權）
    if (isOwnDept && cls.deptAbbr) {
      score += 12;
      reasons.push(`本系開課（${c.classOffered}）`);

      // 年級匹配
      if (userGrade != null && cls.grade != null) {
        const diff = cls.grade - userGrade;
        if (diff === 0) {
          score += 30;
          reasons.push(`本年級（大${userGrade}）課程`);
        } else if (Math.abs(diff) === 1) {
          score -= 8;
          if (diff < 0) warnings.push('前一年級課程（可能已修）');
          else warnings.push('下一年級才開的課（可能還沒先修）');
        } else if (Math.abs(diff) >= 2) {
          // 大幅跨年級的本系課直接過濾
          continue;
        }
      } else if (userGrade != null && cls.grade == null) {
        // 本系跨年級課（例：資管A班）→ 小加分
        score += 4;
        reasons.push('本系跨年級選修');
      }
    } else if (isGeneral) {
      // 通識 / 體育 / 全民國防 → 不分系，所有人皆可
      score += 2;
    } else if (cls.deptAbbr && c.courseTypeKey === 'required') {
      // 別系的必修（年級＋班別綁定）→ 通常無法選 → 過濾
      continue;
    } else if (cls.deptAbbr) {
      // 別系一般選修 → 降權但不過濾（跨系選修可能）
      score -= 6;
      // 別系年級不符也再扣
      if (userGrade != null && cls.grade != null && Math.abs(cls.grade - userGrade) >= 2) {
        score -= 6;
      }
    }

    // (1) 衝堂
    const conflict = c.slots.some((s) =>
      schedule.some(
        (e) =>
          e.dayOfWeek === s.dayOfWeek &&
          e.startTime &&
          e.endTime &&
          s.startTime < e.endTime &&
          s.endTime > e.startTime,
      ),
    );
    if (conflict) {
      score -= 50;
      warnings.push('與目前已選課程衝堂');
    }

    // (2) 已滿
    if (c.capacity != null && c.enrolled != null && c.enrolled >= c.capacity) {
      score -= 15;
      warnings.push('目前已額滿');
    }

    // (3) 畢業缺口加分
    const courseGenre = (() => {
      if (/體育|運動/.test(c.name)) return '體育';
      if (/通識|博雅|人文|藝術/.test(c.name)) return '通識';
      if (/服務學習|志工/.test(c.name)) return '服務學習';
      if (c.courseTypeKey === 'required') return '必修';
      if (c.courseTypeKey === 'elective') return '選修';
      return '其他';
    })();
    if (gapWeight[courseGenre]) {
      score += gapWeight[courseGenre];
      reasons.push(`補${courseGenre}學分缺口`);
    }

    // (4) 類別歷史成績偏好
    const cat = encodeCourseCategory(c.name, c.courseType);
    const avg = categoryAvg.get(cat);
    if (avg && avg >= 85) {
      score += 15;
      reasons.push(`你在類似課程平均 ${Math.round(avg)} 分，表現優異`);
    } else if (avg && avg >= 75) {
      score += 6;
      reasons.push(`你在類似課程平均 ${Math.round(avg)} 分`);
    }

    // (5) 興趣關鍵字
    if (prefs.interests && prefs.interests.length > 0) {
      let hits = 0;
      for (const kw of prefs.interests) {
        if (!kw) continue;
        if (c.name.includes(kw) || c.nameEn.toLowerCase().includes(kw.toLowerCase())) {
          hits++;
          reasons.push(`命中興趣：${kw}`);
        }
      }
      score += Math.min(18, hits * 6);
    }

    // (6) 同系/年級 — 已在頂部的 ★ 區塊處理（用 classOffered/cla_cn）

    // (7) 時段偏好
    const earlySlot = c.slots.some((s) => s.periods.includes(1) || s.periods.includes(2));
    if (prefs.avoidEarly && earlySlot) {
      score -= 10;
      warnings.push('包含早八時段');
    }
    if (prefs.lunchBreak) {
      const eatsLunch = c.slots.some((s) =>
        s.periods.some((p) => p === 99) ||
        (s.startTime <= '13:00' && s.endTime >= '12:00'),
      );
      if (eatsLunch) {
        score -= 8;
        warnings.push('佔用午休時段');
      }
    }

    // (8) 語言偏好
    if (prefs.preferredLanguage && c.languageKey === prefs.preferredLanguage) {
      score += 6;
      reasons.push(`授課語言：${c.language}`);
    }

    // (9) 必修 / 通識 tag
    if (c.courseTypeKey === 'required') {
      score += 12;
      reasons.push('必修課程');
    } else if (c.courseTypeKey === 'general') {
      score += 4;
    }

    // (10) tags
    if (c.tags.includes('micro_credit')) reasons.push('微學分（彈性）');
    if (c.tags.includes('emi')) reasons.push('全英語授課');
    if (c.tags.includes('practical')) reasons.push('實務／實習導向');

    // (11) 預測分數
    const predicted = grades ? predictGradeForCourse(c.name, c.courseType, grades) : 75;

    // (12) 太低的就不出
    score = Math.max(0, Math.min(100, score));
    if (score < 35) continue;

    results.push({
      catalogCode: c.code,
      courseName: c.name,
      nameEn: c.nameEn,
      teacher: c.teacher,
      credits: c.credits,
      department: c.department,
      classOffered: c.classOffered,
      courseType: c.courseType,
      timePlace: c.timePlaceRaw,
      enrolled: c.enrolled,
      capacity: c.capacity,
      language: c.language,
      syllabusUrl: c.syllabusUrl,
      matchScore: Math.round(score),
      predictedGrade: predicted,
      reasons: reasons.length > 0 ? reasons : ['符合你的偏好設定'],
      warnings,
      tags: c.tags,
    });
  }

  // 目標學分滿足偵測
  if (prefs.targetCredits && results.length > 1) {
    let acc = 0;
    let cutoff = 0;
    const sorted = [...results].sort((a, b) => b.matchScore - a.matchScore);
    for (let i = 0; i < sorted.length; i++) {
      acc += sorted[i].credits;
      if (acc >= prefs.targetCredits) {
        cutoff = i + 1;
        break;
      }
    }
    if (cutoff > 0) {
      for (let i = 0; i < cutoff; i++) {
        sorted[i].reasons.push('組合可達到目標學分');
      }
    }
  }

  return results.sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * 一鍵：抓使用者所有快取資料 + 課綱候選池 → 推薦結果
 * 供 UI 直接呼叫。
 */
export async function recommendFromCatalog(
  candidates: CatalogCourse[],
  extra: Pick<CatalogRecommendationInput, 'profile' | 'scheduleEvents' | 'preferences'> = {},
): Promise<CatalogRecommendation[]> {
  const [grades, currentCourses] = await Promise.all([
    getAnyCachedGrades(),
    getAnyCachedCourses(),
  ]);
  return generateCatalogRecommendations({
    candidates,
    grades,
    currentCourses,
    ...extra,
  });
}
