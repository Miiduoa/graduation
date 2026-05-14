/**
 * Learning Risk Radar — TronClass parity P3-1
 *
 * 純函式：依出席率、作業逾期、低分測驗、不活躍天數計算學習風險等級。
 * 學生：依自身資料 → 自己看
 * 教師：依該課所有學生 → 找出高風險名單
 * AI：餵給 risk_radar AI tool 與 proactive notification。
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface CourseRiskInput {
  courseId: string;
  courseName: string;
  attendanceRate: number; // 0-1
  missedAssignments: number;
  totalAssignments: number;
  lowQuizScores: number; // 分數 < 60 的測驗次數
  daysSinceLastActivity: number; // 上次任何活動到今天的天數
  currentScore: number | null;
}

export interface CourseRiskSnapshot {
  courseId: string;
  courseName: string;
  level: RiskLevel;
  factors: string[];
  /** 建議行動（給 AI / proactive 用） */
  recommendations: Array<{
    label: string;
    target?: 'assignments' | 'attendance' | 'discussion' | 'office_hours' | 'counseling';
  }>;
  rawScore: number; // 內部使用，越高越危險
}

export interface StudentRiskRadarResult {
  overallLevel: RiskLevel;
  /** 課程列表，按風險高 → 低 排序 */
  perCourse: CourseRiskSnapshot[];
  topConcerns: string[];
}

const LEVEL_THRESHOLDS = {
  low: 0,
  medium: 25,
  high: 55,
  critical: 80,
} as const;

function levelFromScore(score: number): RiskLevel {
  if (score >= LEVEL_THRESHOLDS.critical) return 'critical';
  if (score >= LEVEL_THRESHOLDS.high) return 'high';
  if (score >= LEVEL_THRESHOLDS.medium) return 'medium';
  return 'low';
}

export function computeCourseRisk(input: CourseRiskInput): CourseRiskSnapshot {
  let score = 0;
  const factors: string[] = [];

  // 出席：< 70% 加 25；< 50% 額外 +25
  if (input.attendanceRate < 0.7) {
    score += 25;
    factors.push(`出席率僅 ${Math.round(input.attendanceRate * 100)}%`);
  }
  if (input.attendanceRate < 0.5) {
    score += 25;
  }

  // 缺交比例：> 25% +20、> 50% 額外 +20
  const missedRate =
    input.totalAssignments > 0 ? input.missedAssignments / input.totalAssignments : 0;
  if (missedRate > 0.25) {
    score += 20;
    factors.push(`漏交 ${input.missedAssignments}/${input.totalAssignments} 份作業`);
  }
  if (missedRate > 0.5) score += 20;

  // 低分測驗：≥ 2 次 +20、≥ 4 次 +15
  if (input.lowQuizScores >= 2) {
    score += 20;
    factors.push(`已有 ${input.lowQuizScores} 次測驗 < 60 分`);
  }
  if (input.lowQuizScores >= 4) score += 15;

  // 不活躍：≥ 7 天 +15、≥ 14 天 +15
  if (input.daysSinceLastActivity >= 7) {
    score += 15;
    factors.push(`已 ${input.daysSinceLastActivity} 天沒有活動`);
  }
  if (input.daysSinceLastActivity >= 14) score += 15;

  // 目前成績 < 60
  if (input.currentScore !== null && input.currentScore < 60) {
    score += 10;
    factors.push(`目前加權成績 ${input.currentScore} 分`);
  }

  const level = levelFromScore(score);
  const recommendations: CourseRiskSnapshot['recommendations'] = [];

  if (input.missedAssignments > 0) {
    recommendations.push({ label: `補交 ${input.missedAssignments} 份作業`, target: 'assignments' });
  }
  if (input.attendanceRate < 0.7) {
    recommendations.push({ label: '下次上課務必簽到', target: 'attendance' });
  }
  if (input.lowQuizScores >= 2) {
    recommendations.push({ label: '到課程討論串請教不會的題目', target: 'discussion' });
    recommendations.push({ label: '預約老師 office hours', target: 'office_hours' });
  }
  if (level === 'critical') {
    recommendations.push({ label: '評估是否需要請導師協助 / 諮商', target: 'counseling' });
  }

  return {
    courseId: input.courseId,
    courseName: input.courseName,
    level,
    factors,
    recommendations,
    rawScore: score,
  };
}

export function computeStudentRiskRadar(
  courses: CourseRiskInput[],
): StudentRiskRadarResult {
  const perCourse = courses.map(computeCourseRisk).sort((a, b) => b.rawScore - a.rawScore);
  // 整體：取最危險的等級為主，但若 ≥ 2 門 high 也算 critical
  const highOrAbove = perCourse.filter((c) => c.level === 'high' || c.level === 'critical');
  const overallLevel: RiskLevel =
    perCourse.length === 0
      ? 'low'
      : highOrAbove.length >= 2
      ? 'critical'
      : perCourse[0].level;

  const topConcerns = perCourse
    .slice(0, 3)
    .flatMap((c) => c.factors.map((f) => `${c.courseName}：${f}`));

  return { overallLevel, perCourse, topConcerns };
}
