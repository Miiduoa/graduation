/**
 * Learning Garden Engine — 學習花園計算
 *
 * 設計：
 *  - 每門課 = 一棵植物
 *  - 出席 / 教材閱讀 / 作業 / 測驗 / 討論 → 灌溉
 *  - 植物會經歷：種子 → 發芽 → 茂葉 → 結蕾 → 開花 → 結果
 *  - 期中考週前後若維持 → 開花；期末若通過 → 結果
 *  - 結果可「採收」獲得知識點，餵養精靈或解鎖場景
 *  - 不及格 / 連續曠課 → 植物枯萎，但可在下學期「重新栽種」（重修）
 *  - 純函式，無 I/O
 */

export type PlantStage =
  | 'seed'
  | 'sprout'
  | 'leafy'
  | 'budding'
  | 'blossoming'
  | 'fruiting'
  | 'withering';

export interface CourseSignals {
  courseId: string;
  courseName: string;
  /** 0-1 出席率 */
  attendanceRate: number;
  /** 已交 / 總作業數 */
  assignmentsSubmitted: number;
  assignmentsTotal: number;
  /** 已參與 / 總測驗數 */
  quizzesAttempted: number;
  quizzesTotal: number;
  /** 已讀教材數 */
  materialsRead: number;
  materialsTotal: number;
  /** 討論發文 + 回覆 */
  discussionPosts: number;
  /** 目前加權成績（null = 尚未計算） */
  currentScore: number | null;
  /** 本學期是否結束 */
  termEnded?: boolean;
  /** 是否不及格（已結束 + score < passing） */
  failed?: boolean;
}

export interface Plant {
  courseId: string;
  courseName: string;
  stage: PlantStage;
  /** 成長進度 0-100 */
  growth: number;
  /** 健康（負面：缺席 / 漏交） */
  health: number;
  /** 是否可採收（已結果且本學期結束 + 通過） */
  harvestable: boolean;
  /** 採收可得知識點 */
  harvestPoints: number;
  /** 視覺：顯示用 emoji */
  emoji: string;
  /** UI 提示：精靈要不要去澆水 */
  needsWaterText: string | null;
}

export interface GardenSummary {
  plants: Plant[];
  totalGrowth: number;
  totalHarvestPoints: number;
  /** 班級氣象（單堂課的） */
  classWeather: 'sunny' | 'cloudy' | 'rainy' | 'storm';
}

// ─────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────

function ratio(a: number, b: number): number {
  if (b <= 0) return 0;
  return Math.max(0, Math.min(1, a / b));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

const STAGE_EMOJI: Record<PlantStage, string> = {
  seed: '🌱',
  sprout: '🌿',
  leafy: '🪴',
  budding: '🌷',
  blossoming: '🌸',
  fruiting: '🍎',
  withering: '🥀',
};

// ─────────────────────────────────────────────────────────
// 單株植物計算
// ─────────────────────────────────────────────────────────

export function computePlant(course: CourseSignals): Plant {
  // 枯萎條件最優先
  if (course.failed) {
    return {
      courseId: course.courseId,
      courseName: course.courseName,
      stage: 'withering',
      growth: 0,
      health: 0,
      harvestable: false,
      harvestPoints: 0,
      emoji: STAGE_EMOJI.withering,
      needsWaterText: '這門課這學期沒過，下學期可以重新栽種 🌱',
    };
  }

  // 成長分：四個維度合成
  const attendW = course.attendanceRate * 25;
  const submitW = ratio(course.assignmentsSubmitted, course.assignmentsTotal) * 25;
  const quizW = ratio(course.quizzesAttempted, course.quizzesTotal) * 20;
  const readW = ratio(course.materialsRead, course.materialsTotal) * 20;
  const discussW = Math.min(course.discussionPosts, 5) * 2; // 0-10
  const growth = clamp01(attendW + submitW + quizW + readW + discussW);

  // 健康：低出席或漏交扣
  let health = 100;
  if (course.attendanceRate < 0.7) health -= 30;
  if (course.attendanceRate < 0.5) health -= 30;
  const missedRate =
    course.assignmentsTotal > 0
      ? (course.assignmentsTotal - course.assignmentsSubmitted) / course.assignmentsTotal
      : 0;
  if (missedRate > 0.3) health -= 20;
  if (missedRate > 0.5) health -= 20;
  health = Math.max(0, health);

  // 階段
  let stage: PlantStage;
  if (growth < 15) stage = 'seed';
  else if (growth < 35) stage = 'sprout';
  else if (growth < 55) stage = 'leafy';
  else if (growth < 70) stage = 'budding';
  else if (growth < 85) stage = 'blossoming';
  else stage = 'fruiting';

  // 採收：本學期結束 + 結果 + 健康 ≥ 60 + 通過
  const passed = course.currentScore !== null && course.currentScore >= 60;
  const harvestable = !!course.termEnded && stage === 'fruiting' && passed && health >= 60;
  const harvestPoints = harvestable
    ? Math.round(((course.currentScore ?? 60) - 50) * 2) // 60→20, 100→100
    : 0;

  const needsWaterText = generateWaterHint({ stage, health, growth, course });

  return {
    courseId: course.courseId,
    courseName: course.courseName,
    stage,
    growth: Math.round(growth * 10) / 10,
    health,
    harvestable,
    harvestPoints,
    emoji: STAGE_EMOJI[stage],
    needsWaterText,
  };
}

function generateWaterHint(args: {
  stage: PlantStage;
  health: number;
  growth: number;
  course: CourseSignals;
}): string | null {
  if (args.health < 50) {
    return `${args.course.courseName} 的植物在掉葉子，去把缺交補完吧。`;
  }
  if (args.stage === 'seed' && args.course.attendanceRate < 0.5) {
    return `${args.course.courseName} 剛種下還沒發芽，下次上課簽到看看。`;
  }
  if (args.stage === 'budding') {
    return `${args.course.courseName} 快要開花了，再交 1 份作業就會綻放。`;
  }
  if (args.stage === 'fruiting' && !args.course.termEnded) {
    return `${args.course.courseName} 已經結果，期末考完就能採收。`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// 整座花園
// ─────────────────────────────────────────────────────────

export function computeGarden(courses: CourseSignals[]): GardenSummary {
  const plants = courses.map(computePlant);
  const totalGrowth = plants.reduce((acc, p) => acc + p.growth, 0);
  const totalHarvestPoints = plants.reduce((acc, p) => acc + p.harvestPoints, 0);

  // 班級氣象：依該課大家平均
  const avgHealth = plants.length > 0 ? plants.reduce((a, p) => a + p.health, 0) / plants.length : 0;
  let classWeather: GardenSummary['classWeather'];
  if (avgHealth >= 80) classWeather = 'sunny';
  else if (avgHealth >= 60) classWeather = 'cloudy';
  else if (avgHealth >= 40) classWeather = 'rainy';
  else classWeather = 'storm';

  return {
    plants,
    totalGrowth: Math.round(totalGrowth * 10) / 10,
    totalHarvestPoints,
    classWeather,
  };
}
