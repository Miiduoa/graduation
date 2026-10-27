import type { CreditPlan, PlannedCourse, PlannerCategory } from './creditPlanner';

export type TranscriptInput = {
  id: string;
  courseName: string;
  courseCode?: string;
  semester?: string;
  courseType?: string;
  credits: unknown;
  score: unknown;
  letterGrade?: unknown;
  source: 'school' | 'school-cache' | 'course';
};
export type TranscriptReviewRow = {
  key: string;
  name: string;
  code: string;
  semester: string;
  sourceType: string;
  source: TranscriptInput['source'];
  credits: number | null;
  scoreLabel: string;
  category: PlannerCategory;
  eligible: boolean;
  reason: string;
  group: string;
  duplicateCount: number;
};
export type TranscriptSelection = { key: string; category: PlannerCategory };
export type TranscriptReview = {
  rows: TranscriptReviewRow[];
  passMark: number;
  selectable: number;
};
export type ReviewedCreditTotals = {
  credits: number;
  selectedCount: number;
  byCategory: Record<PlannerCategory, number>;
  names: string[];
};
export type TranscriptPlanChange = {
  next: CreditPlan;
  totals: ReviewedCreditTotals;
  removedCourseIds: string[];
};
const CATEGORY_KEYS: readonly PlannerCategory[] = ['required', 'elective', 'general', 'other'];
const PASS = new Set(['p', 'pass', 'passed', '及格', '通過', '通過(pass)']);
const FAIL = new Set(['f', 'fail', 'failed', '未通過', '不及格', '未通過(fail)']);
const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const text = (value: unknown, maximum: number) => typeof value === 'string' ? value.trim().slice(0, maximum) : '';
const round = (value: number) => Number(value.toFixed(2));

function creditValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 30 ||
      Math.abs(Math.round(value * 100) - value * 100) > 1e-6) return null;
  return value;
}
function numericScore(value: unknown): number | null {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(raw)) return null;
  const result = Number(raw);
  return result >= 0 && result <= 100 ? result : null;
}
function symbolic(value: unknown): boolean | null {
  const label = typeof value === 'string' ? normalize(value) : '';
  return PASS.has(label) ? true : FAIL.has(label) ? false : null;
}
function initialCategory(value: string): PlannerCategory {
  const label = normalize(value);
  if (['required', '必修', '系必修', '系定必修', '專業必修'].includes(label)) return 'required';
  if (['elective', '選修', '系選修', '系定選修', '專業選修'].includes(label)) return 'elective';
  if (['general', '通識', '通識課程', '通識選修'].includes(label)) return 'general';
  return 'other';
}

/** 只產生核對建議。及格分數由使用者明確指定，不能當作校方採計規則。 */
export function reviewTranscript(inputs: readonly TranscriptInput[], passMark: number): TranscriptReview {
  if (!Number.isInteger(passMark) || passMark < 1 || passMark > 100) throw new Error('請先選擇核對用的及格分數。');
  if (!Array.isArray(inputs) || inputs.length > 2_000) throw new Error('成績筆數超出核對範圍，沒有套用資料。');
  const parents = inputs.map((_, index) => index);
  function root(index: number): number {
    while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; }
    return index;
  }
  const names = new Map<string, number>();
  const codes = new Map<string, number>();
  const rows = inputs.map((input, index): TranscriptReviewRow => {
    const name = text(input?.courseName, 200);
    const code = text(input?.courseCode, 100);
    // 名稱或課號相同都提示核對；沒有課號時不冒稱已準確辨認重修。
    for (const [key, map] of [[name && normalize(name), names], [code && normalize(code), codes]] as const) {
      if (!key) continue;
      const previous = map.get(key);
      if (previous !== undefined) parents[root(index)] = root(previous);
      else map.set(key, index);
    }
    const credits = creditValue(input?.credits);
    const score = numericScore(input?.score);
    const flag = symbolic(input?.letterGrade);
    const rawFlag = symbolic(input?.score);
    const numericPass = score === null ? null : score >= passMark;
    const flags = [numericPass, flag, rawFlag].filter((value): value is boolean => value !== null);
    const contradictory = flags.includes(true) && flags.includes(false);
    const passed = flags.includes(true) && !contradictory;
    const eligible = Boolean(name && credits !== null && passed);
    const reason = !name ? '缺少課程名稱' : credits === null ? '零學分或學分格式需另行核對' :
      contradictory ? '分數與通過標記不一致' : !flags.length ? '未評分或等第無法直接判定' :
      !passed ? `未達目前設定的通過條件（${passMark} 分／明示通過）` : '符合目前設定，仍需本人確認可採計';
    return {
      key: `row-${index}`, name, code, semester: text(input?.semester, 60),
      sourceType: text(input?.courseType, 80), source: input?.source === 'school' ? 'school' :
        input?.source === 'school-cache' ? 'school-cache' : 'course',
      credits, scoreLabel: [text(input?.score, 40) || (typeof input?.score === 'number' ? String(input.score) : ''),
        text(input?.letterGrade, 40)].filter(Boolean).join(' / ') || '未提供',
      category: initialCategory(text(input?.courseType, 80)), eligible, reason,
      group: '', duplicateCount: 0,
    };
  });
  const counts = new Map<number, number>();
  rows.forEach((_, index) => counts.set(root(index), (counts.get(root(index)) ?? 0) + 1));
  rows.forEach((row, index) => { row.group = `group-${root(index)}`; row.duplicateCount = counts.get(root(index))!; });
  return { rows, passMark, selectable: rows.filter((row) => row.eligible).length };
}

/** 一鍵建議只含校務來源、明確通過且無同名／同課號疑義的資料。 */
export function suggestedTranscriptSelection(review: TranscriptReview): TranscriptSelection[] {
  return review.rows.filter((row) => row.eligible && row.duplicateCount === 1 && row.source !== 'course')
    .map((row) => ({ key: row.key, category: row.category }));
}

export function reviewedCreditTotals(review: TranscriptReview, selected: readonly TranscriptSelection[]): ReviewedCreditTotals {
  if (!selected.length) throw new Error('請至少核對並選取一筆可採計課程；不會用空資料清零原規劃。');
  const byKey = new Map(review.rows.map((row) => [row.key, row]));
  const seen = new Set<string>();
  const groups = new Set<string>();
  const byCategory = { required: 0, elective: 0, general: 0, other: 0 };
  const names: string[] = [];
  let units = 0;
  for (const selection of selected) {
    const row = byKey.get(selection.key);
    if (!row || !row.eligible || row.credits === null || seen.has(row.key) || !CATEGORY_KEYS.includes(selection.category)) {
      throw new Error('核對選項已失效或包含不可計入項目，請重新選取。');
    }
    if (groups.has(row.group)) throw new Error('同名或同課號課程只能選取一筆，請先核對重修與抵免。');
    seen.add(row.key); groups.add(row.group);
    const creditUnits = Math.round(row.credits * 100);
    units += creditUnits;
    byCategory[selection.category] += creditUnits;
    names.push(row.name);
  }
  if (units > 100_000) throw new Error('合計超出 1000 學分，請檢查來源。');
  for (const key of CATEGORY_KEYS) byCategory[key] = round(byCategory[key] / 100);
  return { credits: round(units / 100), selectedCount: selected.length, byCategory, names };
}

export function transcriptPlanOverlaps(plan: CreditPlan, totals: ReviewedCreditTotals): PlannedCourse[] {
  const names = new Set(totals.names.map(normalize));
  return plan.courses.filter((course) => names.has(normalize(course.name)));
}

/** 取代已確認合計，不累加；每筆與未來規劃同名的課程都須明確決定移除或保留。 */
export function applyTranscriptReview(
  plan: CreditPlan, review: TranscriptReview, selected: readonly TranscriptSelection[],
  overlapChoices: Readonly<Record<string, 'remove' | 'keep'>>,
): TranscriptPlanChange {
  const totals = reviewedCreditTotals(review, selected);
  const overlaps = transcriptPlanOverlaps(plan, totals);
  for (const course of overlaps) {
    if (overlapChoices[course.id] !== 'remove' && overlapChoices[course.id] !== 'keep') {
      throw new Error(`請先決定未來規劃中的「${course.name}」是否為同一門已修課程。`);
    }
  }
  const removedCourseIds = overlaps.filter((course) => overlapChoices[course.id] === 'remove').map((course) => course.id);
  const remove = new Set(removedCourseIds);
  const categoryGoals = { ...plan.categoryGoals };
  for (const key of CATEGORY_KEYS) categoryGoals[key] = {
    ...plan.categoryGoals[key], recognized: String(totals.byCategory[key]),
  };
  return {
    next: { ...plan, recognized: String(totals.credits), categoryGoals,
      courses: plan.courses.filter((course) => !remove.has(course.id)) },
    totals, removedCourseIds,
  };
}
