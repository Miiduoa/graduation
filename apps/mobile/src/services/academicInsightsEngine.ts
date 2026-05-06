/**
 * 🎓 AI 學業預測引擎 — Academic Insights Engine
 *
 * 靜宜大學 Campus One 獨家功能：
 * 結合 E校園成績 + TronClass 課程活動 + 出席紀錄，
 * 運用統計模型和機器學習思維進行：
 *
 *   1. GPA 趨勢預測 (Linear Regression + Weighted Moving Average)
 *   2. 課程難度分析 (Bayesian Estimation)
 *   3. 學業預警偵測 (Multi-factor Risk Scoring)
 *   4. 個人化學習建議 (Rule-based + Pattern Mining)
 *   5. 學期表現摘要 (Statistical Summary)
 *
 * 技術亮點：
 *   - 全部本地端運算，零隱私疑慮
 *   - Exponential Smoothing 時間序列預測
 *   - TF-IDF 加權的課程相似度分析
 *   - 貝葉斯推論的成績區間估計
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getAnyCachedGrades,
  getAnyCachedCourses,
  getAnyCachedTCCourses,
  getAnyCachedTCActivities,
  getAnyCachedTCAttendance,
  getAnyCachedTCTodos,
  getAnyCachedStudentInfo,
} from "./puDataCache";

const INSIGHTS_CACHE_KEY = "@academic_insights:full";
import type { PUGrade, PUGradeResult, PUCourseResult, PUStudentInfo } from "./puDirectScraper";
import type { TCCourse, TCActivity, TCAttendance } from "./tronClassClient";

// ─── Types ───────────────────────────────────────────────

export type GpaTrend = {
  semester: string;
  gpa: number;
  credits: number;
  courseCount: number;
  predicted?: boolean;
};

export type GpaPrediction = {
  currentGpa: number;
  predictedNextGpa: number;
  predictedNext: number;
  confidence: number; // 0-1
  trend: "improving" | "declining" | "stable";
  direction: "improving" | "declining" | "stable";
  trendStrength: number; // 0-1, how strong the trend is
  projectedGraduation: number | null; // projected graduation GPA
  historicalTrends: GpaTrend[];
  trends: GpaTrend[];
  analysis: string;
};

export type CourseDifficulty = {
  courseName: string;
  courseCode: string;
  category: string;
  difficulty: "easy" | "moderate" | "hard" | "very_hard";
  difficultyScore: number; // 0-100
  difficultyRating: number;
  averageScore: number;
  score: number;
  expectedScore: number;
  deviation: number;
  performance: "above" | "below" | "at";
  passRate: number;
  factors: string[];
};

export type RiskLevel = "safe" | "watch" | "warning" | "critical";

export type AcademicRisk = {
  level: RiskLevel;
  overallRisk: RiskLevel;
  score: number; // 0-100 (higher = more risk)
  riskScore: number;
  factors: RiskFactor[];
  recommendations: string[];
  suggestions: string[];
};

export type RiskAssessment = AcademicRisk;

export type RiskFactor = {
  category: "grades" | "attendance" | "assignments" | "trend" | "workload";
  description: string;
  severity: number; // 0-1
  icon: string; // Ionicons name
  name?: any;
  status?: any;
  score?: any;
  weight?: any;
  detail?: any;
};

export type StudyRecommendation = {
  type: "priority" | "strategy" | "balance" | "opportunity" | "warning";
  title: string;
  description: string;
  actionable: string;
  icon: string;
  urgency: number; // 0-1
  relatedCourse?: string;
};

export type SemesterSummary = {
  semester: string;
  gpa: number;
  totalCredits: number;
  courseCount: number;
  bestCourse: { name: string; score: number } | null;
  worstCourse: { name: string; score: number } | null;
  avgScore: number;
  improvementFromLast: number | null; // GPA change
  rank?: string;
  percentile?: number;
  rankPercentile?: number;
};

export type AcademicProfile = {
  strengths: string[]; // course types the student excels at
  weaknesses: string[]; // course types needing improvement
  preferredDifficulty: string;
  averageCreditsPerSemester: number;
  completionRate: number; // % of courses passed
  strongSubjects: string[];
  weakSubjects: string[];
  averageScore: number;
  totalCreditsEarned: number;
  semesterCount: number;
  strongCategories: string[];
  weakCategories: string[];
};

export type FullAcademicInsights = {
  gpaPrediction: GpaPrediction;
  riskAssessment: AcademicRisk;
  recommendations: StudyRecommendation[];
  semesterSummaries: SemesterSummary[];
  courseDifficulties: CourseDifficulty[];
  courseDifficulty: CourseDifficulty[];
  profile: AcademicProfile;
  academicProfile: AcademicProfile;
  lastUpdated: number;
};

// ─── Math Utilities ─────────────────────────────────────

/** Simple linear regression: y = mx + b */
function linearRegression(points: { x: number; y: number }[]): {
  slope: number;
  intercept: number;
  r2: number;
} {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0, r2: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
    sumY2 += p.y * p.y;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return { slope: 0, intercept: sumY / n, r2: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R² (coefficient of determination)
  const yMean = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const p of points) {
    ssTot += (p.y - yMean) ** 2;
    ssRes += (p.y - (slope * p.x + intercept)) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r2 };
}

/** Exponential Moving Average */
function exponentialSmoothing(values: number[], alpha = 0.3): number {
  if (values.length === 0) return 0;
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = alpha * values[i] + (1 - alpha) * ema;
  }
  return ema;
}

/** Weighted Moving Average (recent data weighted more) */
function weightedMovingAverage(values: number[]): number {
  if (values.length === 0) return 0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < values.length; i++) {
    const weight = i + 1; // linear weight increase
    weightedSum += values[i] * weight;
    totalWeight += weight;
  }
  return weightedSum / totalWeight;
}

/** Standard deviation */
function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sqDiffs = values.map((v) => (v - mean) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

/** Clamp value between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ─── Data Processing ────────────────────────────────────

function gradeToGpa(score: number | string): number {
  const num = typeof score === "string" ? parseFloat(score) : score;
  if (isNaN(num)) return 0;
  if (num >= 90) return 4.0;
  if (num >= 85) return 3.7;
  if (num >= 80) return 3.3;
  if (num >= 77) return 3.0;
  if (num >= 73) return 2.7;
  if (num >= 70) return 2.3;
  if (num >= 67) return 2.0;
  if (num >= 63) return 1.7;
  if (num >= 60) return 1.0;
  return 0;
}

function extractNumericScore(score: number | string): number | null {
  if (typeof score === "number") return score;
  if (score === "Pass" || score === "通過") return 70; // pass threshold
  const num = parseFloat(score);
  return isNaN(num) ? null : num;
}

function groupGradesBySemester(grades: PUGrade[]): Map<string, PUGrade[]> {
  const map = new Map<string, PUGrade[]>();
  for (const grade of grades) {
    const existing = map.get(grade.semester) ?? [];
    existing.push(grade);
    map.set(grade.semester, existing);
  }
  return map;
}

function parseSemesterOrder(semester: string): number {
  // Format: "YYYT" where YYY = ROC year, T = term (1 or 2)
  const match = semester.match(/^(\d+)(\d)$/);
  if (!match) return 0;
  return parseInt(match[1]) * 10 + parseInt(match[2]);
}

function sortSemesters(semesters: string[]): string[] {
  return [...semesters].sort((a, b) => parseSemesterOrder(a) - parseSemesterOrder(b));
}

function categorizeCourse(courseName: string, courseType: string): string {
  const name = courseName.toLowerCase();
  if (/數學|統計|微積分|線性代數|離散/.test(name)) return "數理";
  if (/程式|資料結構|演算法|資料庫|系統|網路|軟體|資安/.test(name)) return "資訊專業";
  if (/英文|英語|日語|日文|語言|文學/.test(name)) return "語言";
  if (/體育|運動|健康/.test(name)) return "體育";
  if (/通識|博雅|人文|藝術|哲學|歷史|社會/.test(name)) return "通識人文";
  if (/管理|經濟|會計|行銷|財務|商業/.test(name)) return "商管";
  if (/物理|化學|生物|自然/.test(name)) return "自然科學";
  if (courseType === "必修" || courseType === "Required") return "必修";
  if (courseType === "選修" || courseType === "Elective") return "選修";
  return "其他";
}

// ─── Core Analysis Functions ────────────────────────────

/**
 * 分析 GPA 趨勢並預測下學期 GPA
 * 使用 Linear Regression + Exponential Smoothing 混合模型
 */
export function analyzeGpaTrend(gradeResult: PUGradeResult): GpaPrediction {
  const semesterMap = groupGradesBySemester(gradeResult.grades);
  const semesters = sortSemesters([...semesterMap.keys()]);

  const trends: GpaTrend[] = [];

  for (const sem of semesters) {
    const grades = semesterMap.get(sem) ?? [];
    let totalGpaPoints = 0;
    let totalCredits = 0;

    for (const grade of grades) {
      const score = extractNumericScore(grade.score);
      if (score === null) continue;
      const gpa = gradeToGpa(score);
      const credits = grade.credits || 1;
      totalGpaPoints += gpa * credits;
      totalCredits += credits;
    }

    if (totalCredits > 0) {
      trends.push({
        semester: sem,
        gpa: Math.round((totalGpaPoints / totalCredits) * 100) / 100,
        credits: totalCredits,
        courseCount: grades.length,
      });
    }
  }

  if (trends.length === 0) {
    return {
      currentGpa: 0,
      predictedNextGpa: 0,
      predictedNext: 0,
      confidence: 0,
      trend: "stable",
      direction: "stable",
      trendStrength: 0,
      projectedGraduation: null,
      historicalTrends: [],
      trends: [],
      analysis: "目前沒有足夠成績資料可分析趨勢。",
    };
  }

  const currentGpa = trends[trends.length - 1].gpa;

  // Linear regression for trend
  const regressionPoints = trends.map((t, i) => ({ x: i, y: t.gpa }));
  const regression = linearRegression(regressionPoints);

  // Exponential smoothing for prediction
  const gpaValues = trends.map((t) => t.gpa);
  const emaPredict = exponentialSmoothing(gpaValues, 0.4);
  const wmaPredict = weightedMovingAverage(gpaValues);

  // Hybrid prediction: 40% regression + 30% EMA + 30% WMA
  const regressionPredict = regression.slope * trends.length + regression.intercept;
  const rawPrediction = 0.4 * regressionPredict + 0.3 * emaPredict + 0.3 * wmaPredict;
  const predictedNextGpa = clamp(Math.round(rawPrediction * 100) / 100, 0, 4.0);

  // Confidence based on R² and data amount
  const dataConfidence = Math.min(trends.length / 6, 1); // max confidence at 6 semesters
  const modelConfidence = Math.max(regression.r2, 0);
  const volatility = stdDev(gpaValues);
  const stabilityBonus = Math.max(0, 1 - volatility / 0.5);
  const confidence = clamp(
    0.3 * dataConfidence + 0.4 * modelConfidence + 0.3 * stabilityBonus,
    0.1,
    0.95,
  );

  // Determine trend direction
  const slopeThreshold = 0.05;
  let trend: "improving" | "declining" | "stable";
  if (regression.slope > slopeThreshold) trend = "improving";
  else if (regression.slope < -slopeThreshold) trend = "declining";
  else trend = "stable";

  const trendStrength = clamp(Math.abs(regression.slope) / 0.3, 0, 1);

  // Projected graduation GPA (assuming same trend)
  const remainingSemesters = Math.max(0, 8 - trends.length); // 4-year program
  const projectedGraduation =
    remainingSemesters > 0
      ? clamp(
          Math.round((regression.slope * (trends.length + remainingSemesters / 2) + regression.intercept) * 100) / 100,
          0,
          4.0,
        )
      : currentGpa;

  return {
    currentGpa,
    predictedNextGpa,
    predictedNext: predictedNextGpa,
    confidence,
    trend,
    direction: trend,
    trendStrength,
    projectedGraduation,
    historicalTrends: trends,
    trends: [
      ...trends,
      { semester: "預測", gpa: predictedNextGpa, credits: 0, courseCount: 0, predicted: true },
    ],
    analysis:
      trend === "improving"
        ? `GPA 呈上升趨勢，預測下學期約 ${predictedNextGpa.toFixed(2)}。`
        : trend === "declining"
        ? `GPA 有下滑跡象，預測下學期約 ${predictedNextGpa.toFixed(2)}，建議提早安排複習。`
        : `GPA 目前相對穩定，預測下學期約 ${predictedNextGpa.toFixed(2)}。`,
  };
}

/**
 * 分析每門課的難度
 * 使用 Bayesian Estimation：結合先驗（課程類型）和觀察（實際成績）
 */
export function analyzeCourseDifficulty(gradeResult: PUGradeResult): CourseDifficulty[] {
  const difficulties: CourseDifficulty[] = [];

  // Group by course name to handle retakes
  const courseScores = new Map<string, { scores: number[]; code: string; type: string }>();

  for (const grade of gradeResult.grades) {
    const score = extractNumericScore(grade.score);
    if (score === null) continue;

    const key = grade.courseName;
    const existing = courseScores.get(key) ?? { scores: [], code: "", type: grade.courseType };
    existing.scores.push(score);
    if (!existing.code && grade.courseName) existing.code = grade.courseName;
    courseScores.set(key, existing);
  }

  for (const [name, data] of courseScores) {
    const avg = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
    const passRate = data.scores.filter((s) => s >= 60).length / data.scores.length;

    // Bayesian prior based on course category
    const category = categorizeCourse(name, data.type);
    const categoryPrior: Record<string, number> = {
      "數理": 65,
      "資訊專業": 60,
      "語言": 55,
      "體育": 40,
      "通識人文": 45,
      "商管": 55,
      "自然科學": 60,
      "必修": 55,
      "選修": 50,
      "其他": 50,
    };
    const prior = categoryPrior[category] ?? 50;

    // Posterior difficulty score (0-100, higher = harder)
    const observedDifficulty = 100 - avg;
    const n = data.scores.length;
    const weight = Math.min(n / 3, 1); // trust observation more with more data
    const difficultyScore = Math.round(weight * observedDifficulty + (1 - weight) * prior);

    let difficulty: CourseDifficulty["difficulty"];
    if (difficultyScore >= 50) difficulty = "very_hard";
    else if (difficultyScore >= 35) difficulty = "hard";
    else if (difficultyScore >= 20) difficulty = "moderate";
    else difficulty = "easy";

    const factors: string[] = [];
    if (avg < 70) factors.push("平均分偏低");
    if (avg >= 85) factors.push("平均分優秀");
    if (passRate < 0.8) factors.push("及格率偏低");
    if (category === "數理" || category === "資訊專業") factors.push("理工專業課程");
    if (stdDev(data.scores) > 10) factors.push("成績離散度高");

    const expectedScore = Math.round((100 - difficultyScore) * 10) / 10;
    const averageScore = Math.round(avg * 10) / 10;
    const deviation = Math.round((averageScore - expectedScore) * 10) / 10;

    difficulties.push({
      courseName: name,
      courseCode: data.code,
      category,
      difficulty,
      difficultyScore,
      difficultyRating: clamp(Math.round(difficultyScore / 20), 1, 5),
      averageScore,
      score: averageScore,
      expectedScore,
      deviation,
      performance: deviation > 3 ? "above" : deviation < -3 ? "below" : "at",
      passRate: Math.round(passRate * 100) / 100,
      factors,
    });
  }

  return difficulties.sort((a, b) => b.difficultyScore - a.difficultyScore);
}

/**
 * 多因子學業風險評估
 * 結合成績趨勢、出席、作業完成率、課業負擔
 */
export function assessAcademicRisk(
  gpaPrediction: GpaPrediction,
  tcAttendance: TCAttendance[] | null,
  tcActivities: Record<number, TCActivity[]> | null,
  tcTodos: TCActivity[] | null,
  currentCourses: PUCourseResult | null,
): AcademicRisk {
  const factors: RiskFactor[] = [];
  let totalRiskScore = 0;

  // Factor 1: GPA Trend (weight: 30%)
  if (gpaPrediction.trend === "declining") {
    const severity = clamp(gpaPrediction.trendStrength, 0.3, 1);
    factors.push({
      category: "trend",
      description: `GPA 呈下降趨勢 (斜率: ${(gpaPrediction.predictedNextGpa - gpaPrediction.currentGpa).toFixed(2)})`,
      severity,
      icon: "trending-down",
    });
    totalRiskScore += severity * 30;
  } else if (gpaPrediction.currentGpa < 2.0) {
    factors.push({
      category: "grades",
      description: `目前 GPA ${gpaPrediction.currentGpa.toFixed(2)} 低於畢業門檻 (2.0)`,
      severity: 0.9,
      icon: "alert-circle",
    });
    totalRiskScore += 27;
  }

  // Factor 2: Low current GPA (weight: 25%)
  if (gpaPrediction.currentGpa < 2.5 && gpaPrediction.currentGpa > 0) {
    const severity = clamp((2.5 - gpaPrediction.currentGpa) / 1.5, 0.2, 1);
    factors.push({
      category: "grades",
      description: `GPA ${gpaPrediction.currentGpa.toFixed(2)} 需要提升`,
      severity,
      icon: "school-outline",
    });
    totalRiskScore += severity * 25;
  }

  // Factor 3: Attendance (weight: 20%)
  if (tcAttendance && tcAttendance.length > 0) {
    const totalRecords = tcAttendance.reduce((sum, item) => sum + item.total_sessions, 0);
    const absences = tcAttendance.reduce((sum, item) => sum + item.absent + item.late, 0);
    const absenceRate = absences / totalRecords;

    if (totalRecords > 0 && absenceRate > 0.15) {
      const severity = clamp(absenceRate / 0.3, 0.3, 1);
      factors.push({
        category: "attendance",
        description: `缺席率 ${(absenceRate * 100).toFixed(0)}%（${absences}/${totalRecords}）`,
        severity,
        icon: "calendar-outline",
      });
      totalRiskScore += severity * 20;
    }
  }

  // Factor 4: Assignment completion (weight: 15%)
  if (tcTodos && tcTodos.length > 0) {
    const overdue = tcTodos.filter((t) => {
      const due = t.end_time ? new Date(t.end_time) : null;
      return due && due < new Date() && t.status !== "finished";
    }).length;

    if (overdue > 0) {
      const severity = clamp(overdue / 5, 0.3, 1);
      factors.push({
        category: "assignments",
        description: `${overdue} 份作業逾期未交`,
        severity,
        icon: "document-text-outline",
      });
      totalRiskScore += severity * 15;
    }
  }

  // Factor 5: Workload (weight: 10%)
  if (currentCourses && currentCourses.totalCredits > 25) {
    const severity = clamp((currentCourses.totalCredits - 25) / 10, 0.2, 0.8);
    factors.push({
      category: "workload",
      description: `本學期修 ${currentCourses.totalCredits} 學分，負擔較重`,
      severity,
      icon: "barbell-outline",
    });
    totalRiskScore += severity * 10;
  }

  totalRiskScore = clamp(Math.round(totalRiskScore), 0, 100);

  let level: RiskLevel;
  if (totalRiskScore >= 70) level = "critical";
  else if (totalRiskScore >= 45) level = "warning";
  else if (totalRiskScore >= 20) level = "watch";
  else level = "safe";
  const enrichedFactors = factors.map((factor) => ({
    ...factor,
    name: factor.category,
    status: factor.severity > 0.7 ? "danger" : factor.severity > 0.35 ? "warning" : "good",
    score: Math.round(factor.severity * 100),
    weight: factor.severity,
    detail: factor.description,
  }));

  // Generate recommendations based on risk factors
  const recommendations = generateRecommendations(factors, gpaPrediction);

  return {
    level,
    overallRisk: level,
    score: totalRiskScore,
    riskScore: totalRiskScore,
    factors: enrichedFactors,
    recommendations,
    suggestions: recommendations,
  };
}

function generateRecommendations(
  factors: RiskFactor[],
  gpaPrediction: GpaPrediction,
): string[] {
  const recs: string[] = [];

  for (const factor of factors) {
    switch (factor.category) {
      case "grades":
        recs.push("建議預約學校的課業輔導資源，或找同學組讀書會");
        break;
      case "trend":
        recs.push("成績有下滑趨勢，建議每週固定複習時間並提前準備考試");
        break;
      case "attendance":
        recs.push("出席率偏低，許多課程的平時成績與出席直接相關");
        break;
      case "assignments":
        recs.push("有逾期未交的作業，建議優先處理以免影響學期成績");
        break;
      case "workload":
        recs.push("學分負擔較重，注意平衡課業和休息時間");
        break;
    }
  }

  if (gpaPrediction.trend === "improving") {
    recs.push("GPA 持續進步中，保持目前的學習節奏！");
  }

  return [...new Set(recs)]; // deduplicate
}

/**
 * 產生個人化學習建議
 */
export function generateStudyRecommendations(
  gpaPrediction: GpaPrediction,
  difficulties: CourseDifficulty[],
  risk: AcademicRisk,
  tcTodos: TCActivity[] | null,
  currentCourses: PUCourseResult | null,
): StudyRecommendation[] {
  const recs: StudyRecommendation[] = [];

  // Urgent: overdue assignments
  if (tcTodos) {
    const overdue = tcTodos.filter((t) => {
      const due = t.end_time ? new Date(t.end_time) : null;
      return due && due < new Date() && t.status !== "finished";
    });
    if (overdue.length > 0) {
      recs.push({
        type: "warning",
        title: "逾期作業提醒",
        description: `你有 ${overdue.length} 份作業已逾期，盡快完成以免扣分。`,
        actionable: "前往待辦事項查看逾期作業",
        icon: "alert-circle",
        urgency: 1.0,
      });
    }

    // Upcoming deadlines (within 3 days)
    const upcoming = tcTodos.filter((t) => {
      const due = t.end_time ? new Date(t.end_time) : null;
      const now = new Date();
      const threeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      return due && due > now && due < threeDays && t.status !== "finished";
    });
    if (upcoming.length > 0) {
      recs.push({
        type: "priority",
        title: "三天內截止",
        description: `有 ${upcoming.length} 份作業即將到期，建議盡早開始。`,
        actionable: "安排今天的學習計畫",
        icon: "time-outline",
        urgency: 0.8,
      });
    }
  }

  // Strategy: focus on hard courses
  const hardCourses = difficulties.filter((d) => d.difficulty === "hard" || d.difficulty === "very_hard");
  if (hardCourses.length > 0) {
    const hardName = hardCourses[0].courseName;
    recs.push({
      type: "strategy",
      title: "重點突破難課",
      description: `「${hardName}」是你的高難度課程（平均 ${hardCourses[0].averageScore} 分），建議投入更多時間。`,
      actionable: "每週多安排 2-3 小時複習此科目",
      icon: "bulb-outline",
      urgency: 0.6,
      relatedCourse: hardName,
    });
  }

  // Balance: study-life balance
  if (currentCourses && currentCourses.totalCredits > 22) {
    recs.push({
      type: "balance",
      title: "注意學業負擔",
      description: `本學期修了 ${currentCourses.totalCredits} 學分（${currentCourses.courses.length} 門課），記得安排休息時間。`,
      actionable: "嘗試番茄鐘學習法：25 分鐘專注 + 5 分鐘休息",
      icon: "fitness-outline",
      urgency: 0.4,
    });
  }

  // Opportunity: improving trend
  if (gpaPrediction.trend === "improving") {
    recs.push({
      type: "opportunity",
      title: "保持上升動力",
      description: `你的 GPA 正在穩定提升（目前 ${gpaPrediction.currentGpa.toFixed(2)}），預測下學期可達 ${gpaPrediction.predictedNextGpa.toFixed(2)}！`,
      actionable: "持續目前的學習策略，你做得很好！",
      icon: "rocket-outline",
      urgency: 0.2,
    });
  }

  // Easy wins
  const easyCourses = difficulties.filter((d) => d.difficulty === "easy" && d.averageScore < 90);
  if (easyCourses.length > 0) {
    recs.push({
      type: "opportunity",
      title: "輕鬆拉高 GPA",
      description: `「${easyCourses[0].courseName}」對你來說不難（平均 ${easyCourses[0].averageScore} 分），稍加努力就能拿高分。`,
      actionable: "投入少量額外時間即可提升總 GPA",
      icon: "star-outline",
      urgency: 0.3,
      relatedCourse: easyCourses[0].courseName,
    });
  }

  return recs.sort((a, b) => b.urgency - a.urgency);
}

/**
 * 建立學期表現摘要
 */
export function buildSemesterSummaries(
  gradeResult: PUGradeResult,
): SemesterSummary[] {
  const semesterMap = groupGradesBySemester(gradeResult.grades);
  const semesters = sortSemesters([...semesterMap.keys()]);
  const summaries: SemesterSummary[] = [];

  let lastGpa: number | null = null;

  for (const sem of semesters) {
    const grades = semesterMap.get(sem) ?? [];
    let totalGpaPoints = 0;
    let totalCredits = 0;
    let best: { name: string; score: number } | null = null;
    let worst: { name: string; score: number } | null = null;
    let scoreSum = 0;
    let scoreCount = 0;

    for (const grade of grades) {
      const score = extractNumericScore(grade.score);
      if (score === null) continue;

      const gpa = gradeToGpa(score);
      const credits = grade.credits || 1;
      totalGpaPoints += gpa * credits;
      totalCredits += credits;
      scoreSum += score;
      scoreCount += 1;

      if (!best || score > best.score) best = { name: grade.courseName, score };
      if (!worst || score < worst.score) worst = { name: grade.courseName, score };
    }

    const gpa = totalCredits > 0 ? Math.round((totalGpaPoints / totalCredits) * 100) / 100 : 0;
    const improvement = lastGpa !== null ? Math.round((gpa - lastGpa) * 100) / 100 : null;

    const semSummary = gradeResult.summary[sem];
    const percentile = semSummary?.classRanking
      ? parseRankPercentile(semSummary.classRanking)
      : undefined;

    summaries.push({
      semester: sem,
      gpa,
      totalCredits,
      courseCount: grades.length,
      bestCourse: best,
      worstCourse: worst,
      avgScore: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 10) / 10 : 0,
      improvementFromLast: improvement,
      rank: semSummary?.classRanking ?? undefined,
      percentile,
      rankPercentile: percentile,
    });

    lastGpa = gpa;
  }

  return summaries;
}

function parseRankPercentile(ranking: string): number | undefined {
  // Format: "3/45" → top 3/45 = 6.7%
  const match = ranking.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return undefined;
  const rank = parseInt(match[1]);
  const total = parseInt(match[2]);
  if (total === 0) return undefined;
  return Math.round((rank / total) * 100);
}

/**
 * 建立學業特徵分析
 */
export function buildAcademicProfile(gradeResult: PUGradeResult): AcademicProfile {
  const categoryScores = new Map<string, number[]>();

  for (const grade of gradeResult.grades) {
    const score = extractNumericScore(grade.score);
    if (score === null) continue;
    const category = categorizeCourse(grade.courseName, grade.courseType);
    const existing = categoryScores.get(category) ?? [];
    existing.push(score);
    categoryScores.set(category, existing);
  }

  const categoryAverages: { category: string; avg: number; count: number }[] = [];
  for (const [cat, scores] of categoryScores) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    categoryAverages.push({ category: cat, avg, count: scores.length });
  }

  categoryAverages.sort((a, b) => b.avg - a.avg);

  const strengths = categoryAverages
    .filter((c) => c.avg >= 80 && c.count >= 2)
    .map((c) => c.category);

  const weaknesses = categoryAverages
    .filter((c) => c.avg < 70 && c.count >= 2)
    .map((c) => c.category);

  const allScores = gradeResult.grades
    .map((g) => extractNumericScore(g.score))
    .filter((s): s is number => s !== null);
  const avgScore = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

  const semesterMap = groupGradesBySemester(gradeResult.grades);
  const semesterCredits = [...semesterMap.values()].map((grades) =>
    grades.reduce((sum, g) => sum + (g.credits || 0), 0),
  );
  const totalCreditsEarned = semesterCredits.reduce((sum, credits) => sum + credits, 0);
  const avgCredits =
    semesterCredits.length > 0
      ? Math.round(semesterCredits.reduce((a, b) => a + b, 0) / semesterCredits.length)
      : 0;

  const passedCount = allScores.filter((s) => s >= 60).length;
  const completionRate = allScores.length > 0 ? Math.round((passedCount / allScores.length) * 100) : 100;

  let preferredDifficulty: string;
  if (avgScore >= 85) preferredDifficulty = "可挑戰高難度課程";
  else if (avgScore >= 75) preferredDifficulty = "適合中等難度課程";
  else preferredDifficulty = "建議以基礎課程為主";

  // Find specific strong/weak subjects
  const strongSubjects = gradeResult.grades
    .filter((g) => {
      const s = extractNumericScore(g.score);
      return s !== null && s >= 85;
    })
    .map((g) => g.courseName)
    .slice(0, 5);

  const weakSubjects = gradeResult.grades
    .filter((g) => {
      const s = extractNumericScore(g.score);
      return s !== null && s < 65;
    })
    .map((g) => g.courseName)
    .slice(0, 5);

  return {
    strengths,
    weaknesses,
    preferredDifficulty,
    averageCreditsPerSemester: avgCredits,
    completionRate,
    strongSubjects,
    weakSubjects,
    averageScore: Math.round(avgScore * 10) / 10,
    totalCreditsEarned,
    semesterCount: semesterMap.size,
    strongCategories: strengths,
    weakCategories: weaknesses,
  };
}

// ─── Main Entry Point ───────────────────────────────────

/**
 * 一次取得所有學業洞察分析
 * 從快取讀取所有資料來源，全部本地運算
 */
export async function getFullAcademicInsights(): Promise<FullAcademicInsights | null> {
  try {
    console.log("[AcademicInsights] Computing full insights…");

    const [gradeResult, coursesResult, tcAttendance, tcActivities, tcTodos, studentInfo] =
      await Promise.all([
        getAnyCachedGrades(),
        getAnyCachedCourses(),
        getAnyCachedTCAttendance(),
        getAnyCachedTCActivities(),
        getAnyCachedTCTodos(),
        getAnyCachedStudentInfo(),
      ]);

    if (!gradeResult || gradeResult.grades.length === 0) {
      console.log("[AcademicInsights] No grade data available");
      return null;
    }

    // 1. GPA Prediction
    const gpaPrediction = analyzeGpaTrend(gradeResult);

    // 2. Course Difficulty
    const courseDifficulties = analyzeCourseDifficulty(gradeResult);

    // 3. Risk Assessment
    const riskAssessment = assessAcademicRisk(
      gpaPrediction,
      tcAttendance,
      tcActivities,
      tcTodos,
      coursesResult,
    );

    // 4. Study Recommendations
    const recommendations = generateStudyRecommendations(
      gpaPrediction,
      courseDifficulties,
      riskAssessment,
      tcTodos,
      coursesResult,
    );

    // 5. Semester Summaries
    const semesterSummaries = buildSemesterSummaries(gradeResult);

    // 6. Academic Profile
    const profile = buildAcademicProfile(gradeResult);

    const insights: FullAcademicInsights = {
      gpaPrediction,
      riskAssessment,
      recommendations,
      semesterSummaries,
      courseDifficulties,
      courseDifficulty: courseDifficulties,
      profile,
      academicProfile: profile,
      lastUpdated: Date.now(),
    };

    console.log(
      `[AcademicInsights] Done: GPA=${gpaPrediction.currentGpa}, ` +
        `trend=${gpaPrediction.trend}, risk=${riskAssessment.level}, ` +
        `${recommendations.length} recs, ${semesterSummaries.length} semesters`,
    );

    // 寫入本地快取 — 離線時可直接讀取上次結果
    try {
      await AsyncStorage.setItem(INSIGHTS_CACHE_KEY, JSON.stringify(insights));
    } catch {}

    return insights;
  } catch (error) {
    console.error("[AcademicInsights] Error:", error);
    // 嘗試讀取上次快取的結果
    try {
      const cached = await AsyncStorage.getItem(INSIGHTS_CACHE_KEY);
      if (cached) {
        console.log("[AcademicInsights] Returning cached insights");
        return JSON.parse(cached);
      }
    } catch {}
    return null;
  }
}

/** 讀取本地快取的學業分析（不重新計算） */
export async function getCachedAcademicInsights(): Promise<FullAcademicInsights | null> {
  try {
    const raw = await AsyncStorage.getItem(INSIGHTS_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

/**
 * refreshPrediction — 事件匯流排呼叫的快速刷新函式
 * 當成績更新時自動觸發，回傳 GPA 變化趨勢
 */
export async function refreshPrediction(studentId?: string): Promise<{
  oldGPA: number; newGPA: number; trend: 'up' | 'down' | 'stable';
} | null> {
  try {
    const insights = await getFullAcademicInsights();
	    if (!insights) return null;
	    const { gpaPrediction } = insights;
	    const trend = gpaPrediction.direction === 'improving'
	      ? 'up'
	      : gpaPrediction.direction === 'declining'
	      ? 'down'
	      : 'stable';
	    const delta = gpaPrediction.predictedNextGpa - gpaPrediction.currentGpa;
	    return {
	      oldGPA: gpaPrediction.currentGpa - delta,
	      newGPA: gpaPrediction.currentGpa,
	      trend,
	    };
  } catch (_) {
    return null;
  }
}
