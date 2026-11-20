import {
  mapCourseTypeDetailed,
  type DeptGradRequirement,
  type PUCreditCat,
} from '../../data/puGradRequirements';
import type { Grade } from '../../data/types';

export type CategoryBucket = {
  earned: number;
  courses: number;
  required: number;
  passedCourses: number;
  failedCourses: number;
  ungradedCourses: number;
};

export type CreditTotals = {
  byCategory: Record<PUCreditCat, CategoryBucket>;
  /** 通過且去重後的參考已修學分（非正式畢業認定） */
  totalEarned: number;
  totalCourses: number;
  passedCount: number;
  failedCount: number;
  ungradedCount: number;
  /** 若有重複修課嘗試，僅計入一次通過學分 */
  retakeCollapsed: number;
};

/** 區分數值 0 與尚未評分；字串能解析才當分數。 */
export function numericScore(grade: Grade): number | null {
  const raw: unknown = grade.grade ?? grade.score;
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return null;
}

export function scoreDisplay(grade: Grade): string {
  const n = numericScore(grade);
  if (n !== null) return String(Math.round(n * 10) / 10);
  if (typeof grade.letterGrade === 'string' && grade.letterGrade.trim()) {
    return grade.letterGrade.trim();
  }
  return '未評分';
}

/**
 * 符號通過／未通過（學則 P／通過、I／未通過等）。
 * 此類紀錄可計／不計學分，但不納入學業平均。
 */
function explicitPassResult(grade: Grade): boolean | null {
  const label = grade.letterGrade?.trim().toLowerCase();
  if (['pass', 'p', '通過', '及格', '通過(pass)'].includes(label ?? '')) return true;
  if (['fail', 'f', 'i', '未通過', '不及格', '未通過(fail)'].includes(label ?? '')) {
    return false;
  }
  return null;
}

/** 符號通過／未通過列：保留標籤與學分語意，但不進入 GPA 平均。 */
export function isSymbolicPassFailExcludedFromGpa(grade: Grade): boolean {
  return explicitPassResult(grade) !== null;
}

export function isUngraded(grade: Grade): boolean {
  return numericScore(grade) === null && explicitPassResult(grade) === null;
}

/** 有明確分數才判斷及格；未評分不算通過。數值 0 為未通過。 */
export function isPassed(grade: Grade): boolean {
  const n = numericScore(grade);
  if (n === null) return explicitPassResult(grade) === true;
  return n >= 60;
}

function courseKey(grade: Grade): string {
  const code = typeof grade.courseCode === 'string' ? grade.courseCode.trim() : '';
  if (code) return `code:${code}`;
  const id = typeof grade.courseId === 'string' ? grade.courseId.trim() : '';
  // PU 的學期＋列號只是顯示用 id，不能用來判斷兩次修課是否為同一門課。
  if (id && !/^pu-crs-/.test(id)) return `id:${id}`;
  return `name:${grade.courseName || grade.id}`;
}

/**
 * 重複修課：同一課程多次紀錄時，通過學分只計一次（取較高分數，同分取較新學期）。
 * 精確抵免／入學年度規則未知時，僅作粗估參考。
 */
export function collapseRetakeAttempts(grades: Grade[]): { kept: Grade[]; collapsed: number } {
  const best = new Map<string, Grade>();
  let collapsed = 0;
  const ordered = [...grades].sort((a, b) =>
    String(b.semester || '').localeCompare(String(a.semester || '')),
  );
  for (const grade of ordered) {
    const key = courseKey(grade);
    const prev = best.get(key);
    if (!prev) {
      best.set(key, grade);
      continue;
    }
    collapsed += 1;
    const prevScore = numericScore(prev);
    const nextScore = numericScore(grade);
    const prevPassed = isPassed(prev);
    const nextPassed = isPassed(grade);
    if (nextPassed && !prevPassed) {
      best.set(key, grade);
    } else if (nextPassed === prevPassed) {
      if ((nextScore ?? -1) > (prevScore ?? -1)) best.set(key, grade);
    }
  }
  return { kept: [...best.values()], collapsed };
}

export function emptyCategoryBuckets(
  required: Record<PUCreditCat, number> | null,
): Record<PUCreditCat, CategoryBucket> {
  const cats: PUCreditCat[] = [
    'required',
    'elective',
    'general',
    'common',
    'pe',
    'service',
    'free',
  ];
  const out = {} as Record<PUCreditCat, CategoryBucket>;
  for (const cat of cats) {
    out[cat] = {
      earned: 0,
      courses: 0,
      required: required ? required[cat] : 0,
      passedCourses: 0,
      failedCourses: 0,
      ungradedCourses: 0,
    };
  }
  return out;
}

export function computeCreditTotals(
  grades: Grade[],
  dept: DeptGradRequirement | null,
): CreditTotals {
  const { kept, collapsed } = collapseRetakeAttempts(grades);
  const byCategory = emptyCategoryBuckets(dept ? dept.credits : null);
  let totalEarned = 0;
  let totalCourses = 0;
  let passedCount = 0;
  let failedCount = 0;
  let ungradedCount = 0;

  for (const g of kept) {
    const cat = mapCourseTypeDetailed(g.courseType, g.courseName);
    const credits = Number.isFinite(g.credits) ? Math.max(0, g.credits) : 0;
    byCategory[cat].courses += 1;
    totalCourses += 1;

    if (isUngraded(g)) {
      byCategory[cat].ungradedCourses += 1;
      ungradedCount += 1;
      continue;
    }

    if (isPassed(g)) {
      byCategory[cat].earned += credits;
      byCategory[cat].passedCourses += 1;
      totalEarned += credits;
      passedCount += 1;
    } else {
      byCategory[cat].failedCourses += 1;
      failedCount += 1;
    }
  }

  return {
    byCategory,
    totalEarned,
    totalCourses,
    passedCount,
    failedCount,
    ungradedCount,
    retakeCollapsed: collapsed,
  };
}

/** 學期加權平均；學分總和為 0 時回傳 null，不捏造 0。含真實分數 0。 */
export function semesterWeightedAverage(grades: Grade[]): number | null {
  let weighted = 0;
  let creditSum = 0;
  for (const g of grades) {
    const score = numericScore(g);
    if (score === null) continue;
    const credits = Number.isFinite(g.credits) ? g.credits : 0;
    if (credits <= 0) continue;
    weighted += score * credits;
    creditSum += credits;
  }
  if (creditSum <= 0) return null;
  return weighted / creditSum;
}

/** 只讀來源列上的績點欄位，不做分數→GPA 換算。 */
export function resolveSourceGradePoint(grade: Grade): number | null {
  const raw = grade.gradePoints ?? grade.gradePoint;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return null;
}

export type ReferenceGpa = {
  gpa: number;
  totalCredits: number;
  totalPoints: number;
  /**
   * 輸入集合中因同名／同碼重複修課而多出的筆數（僅供說明；GPA 本身不剔除重修）。
   */
  retakeCollapsed: number;
  /**
   * 納入平均之列若皆宣告同一已知 gradePointScale 則回傳該值；否則 null（UI 省略分母）。
   */
  gradePointScale: number | null;
};

function resolveDeclaredScale(grade: Grade): number | null {
  const scale = grade.gradePointScale;
  if (typeof scale === 'number' && Number.isFinite(scale) && scale > 0) return scale;
  return null;
}

function isGradePointInScale(gp: number, scale: number | null): boolean {
  if (gp < 0) return false;
  if (scale === null) return true;
  return gp <= scale + 1e-9;
}

/**
 * 僅依「本頁已接受」成績列推導參考 GPA。
 * - 使用同一驗證集合的全部修習嘗試（不因重修去重）。
 * - 符號 P／Pass／通過、I／未通過排除於平均，標籤仍可顯示。
 * - 未評分／待處理且無有效績點者排除；有數值分數卻缺績點 → 整份不可用（不捏造 0）。
 * - 無百分制分數但來源已提供有限績點的等第列可計入；不自行發明對照。
 * - 績點 0 且學分 > 0 可算出 0.00；分母為 0 則不可用。
 * - 不做通用分數換算、不稱正式累計 GPA。
 */
export function computeReferenceGpa(grades: Grade[]): ReferenceGpa | null {
  const { collapsed } = collapseRetakeAttempts(grades);
  let totalPoints = 0;
  let totalCredits = 0;
  const includedScales: number[] = [];
  let sawMissingScale = false;

  for (const g of grades) {
    const credits = Number.isFinite(g.credits) ? g.credits : 0;
    if (credits <= 0) continue;

    // 符號通過／未通過：不納入平均
    if (isSymbolicPassFailExcludedFromGpa(g)) continue;

    const score = numericScore(g);
    const gp = resolveSourceGradePoint(g);

    if (gp === null) {
      // 有數值分數卻缺績點 → 集合不完整，不可用
      if (score !== null) return null;
      // 待處理／未知標籤且無績點 → 略過
      continue;
    }

    const scale = resolveDeclaredScale(g);
    if (!isGradePointInScale(gp, scale)) return null;
    if (scale === null) sawMissingScale = true;
    else includedScales.push(scale);

    totalCredits += credits;
    totalPoints += gp * credits;
  }

  if (totalCredits <= 0) return null;

  let gradePointScale: number | null = null;
  if (includedScales.length > 0) {
    const first = includedScales[0];
    // 不同尺度的績點不能直接加權；已知與未知尺度混合也無法確認可比性。
    if (sawMissingScale || includedScales.some((s) => Math.abs(s - first) >= 1e-9)) return null;
    gradePointScale = first;
  }

  return {
    gpa: totalPoints / totalCredits,
    totalCredits,
    totalPoints,
    retakeCollapsed: collapsed,
    gradePointScale,
  };
}

export function semesterLabel(sem: string): string {
  if (sem.length >= 4) {
    const year = sem.substring(0, sem.length - 1);
    const term = sem.charAt(sem.length - 1);
    return `${year} 學年 第${term}學期`;
  }
  return sem;
}
