import {
  PLANNER_CATEGORIES, creditPlanSummary, formatCredits, parseCredits, restoreCreditPlan,
  type CreditPlan, type PlannerCategory,
} from './creditPlanner';

export type CreditDeadlineOptions = { targetTerm: number; workloadLimit: number };
export type CreditDeadlineSnapshot = {
  scheduled: number;
  cumulative: number | null;
  remaining: number | null;
  remainingAfterAll: number | null;
  roomWithinLimit: number;
};
export type CreditDeadlineReport = {
  targetTerm: number;
  workloadLimit: number;
  before: CreditDeadlineSnapshot;
  after: CreditDeadlineSnapshot;
  remainingDelta: number | null;
  capacityShortfall: number | null;
  unallocated: number;
  pendingMilestones: number;
  unknownCategories: number;
  categories: Array<{ key: PlannerCategory; label: string; before: number | null; after: number | null }>;
  terms: Array<{ term: number; before: number; after: number; room: number; overBy: number }>;
  laterCourses: Array<{ id: string; name: string; term: number; credits: number }>;
  warnings: string[];
};
export type CreditDeadlineResult = { ok: true; report: CreditDeadlineReport } | { ok: false; message: string };

const units = (value: number) => Math.round(value * 100);
const credits = (value: number) => value / 100;
const total = (values: number[]) => credits(values.reduce((sum, value) => sum + units(value), 0));
const remaining = (target: number, value: number) => credits(Math.max(0, units(target) - units(value)));

/** Both inputs are copied and validated; the comparison can only move/omit future courses. */
function readPlan(input: CreditPlan): CreditPlan | null {
  try { return restoreCreditPlan(JSON.stringify(input)); } catch { return null; }
}
function sameBasis(before: CreditPlan, after: CreditPlan): boolean {
  if (before.recognized !== after.recognized || before.target !== after.target || before.extra !== after.extra ||
    PLANNER_CATEGORIES.some(({ key }) => before.categoryGoals[key].recognized !== after.categoryGoals[key].recognized ||
      before.categoryGoals[key].target !== after.categoryGoals[key].target)) return false;
  const milestones = new Map(before.milestones.map((item) => [item.id, item]));
  if (milestones.size !== after.milestones.length || after.milestones.some((item) => {
    const original = milestones.get(item.id);
    return !original || original.label !== item.label || original.done !== item.done;
  })) return false;
  const courses = new Map(before.courses.map((course) => [course.id, course]));
  return after.courses.every((course) => {
    const original = courses.get(course.id);
    return original && original.name === course.name && original.credits === course.credits &&
      original.category === course.category && original.status === course.status;
  });
}

function snapshot(plan: CreditPlan, options: CreditDeadlineOptions) {
  const summary = creditPlanSummary(plan);
  const inTime = plan.courses.filter((course) => course.term <= options.targetTerm);
  const scheduled = total(inTime.map((course) => course.credits));
  const cumulative = summary.recognized === null ? null : total([summary.recognized, scheduled]);
  const gap = cumulative === null || summary.target === null ? null : remaining(summary.target, cumulative);
  const terms = Array.from({ length: options.targetTerm }, (_, index) => {
    const planned = total(inTime.filter((course) => course.term === index + 1).map((course) => course.credits));
    return { term: index + 1, planned, room: remaining(options.workloadLimit, planned),
      overBy: remaining(planned, options.workloadLimit) };
  });
  const categories = PLANNER_CATEGORIES.map(({ key, label }) => {
    const recognized = parseCredits(plan.categoryGoals[key].recognized);
    const target = parseCredits(plan.categoryGoals[key].target);
    const planned = total(inTime.filter((course) => course.category === key).map((course) => course.credits));
    return { key, label, remaining: recognized === null || target === null ? null : remaining(target, total([recognized, planned])) };
  });
  return { summary, categories, terms, value: {
    scheduled, cumulative, remaining: gap, remainingAfterAll: summary.remaining,
    roomWithinLimit: total(terms.map((term) => term.room)),
  } satisfies CreditDeadlineSnapshot };
}

/**
 * Conditional end-of-term comparison, not a graduation decision or course recommendation.
 * Unassigned extra credits and courses after the deadline never enter deadline totals.
 * Workload room is arithmetic only: it does not prove any course is offered or eligible.
 */
export function compareCreditScenarioDeadline(
  original: CreditPlan, alternative: CreditPlan, options: CreditDeadlineOptions,
): CreditDeadlineResult {
  const beforePlan = readPlan(original);
  const afterPlan = readPlan(alternative);
  if (!beforePlan || !afterPlan) return { ok: false, message: '請先修正規劃中的無效欄位，再比較目標學期。' };
  if (!options || !Number.isInteger(options.targetTerm) || options.targetTerm < 1 || options.targetTerm > 8) {
    return { ok: false, message: '目標學期請選未來第 1～8 學期。' };
  }
  if (!Number.isFinite(options.workloadLimit) || options.workloadLimit < 1 || options.workloadLimit > 40 ||
    Math.abs(units(options.workloadLimit) - options.workloadLimit * 100) > 1e-6) {
    return { ok: false, message: '個人每學期負擔提醒請填 1～40 學分，最多兩位小數。' };
  }
  if (!sameBasis(beforePlan, afterPlan)) return { ok: false, message: '兩份方案的目標、已確認學分或課程內容不同，請以目前原規劃重新開始比較。' };
  const before = snapshot(beforePlan, options);
  const after = snapshot(afterPlan, options);
  const warnings: string[] = [];
  if (after.value.remaining === null) warnings.push('已確認學分或目標尚未設定，期限缺口保持未知，不當成零。');
  const unallocated = after.summary.extra ?? 0;
  if (unallocated > 0) warnings.push(`其他預計學分 ${formatCredits(unallocated)} 尚未排入學期，不計入這個期限。`);
  if (after.summary.categoryOvercount) warnings.push('分類已確認學分超過總已確認學分，請先排除重複採計。');
  const names = new Set<string>();
  for (const course of afterPlan.courses) {
    const name = course.name.normalize('NFKC').trim().toLocaleLowerCase('zh-TW');
    if (names.has(name)) { warnings.push('比較方案仍有同名課程；目前按逐筆輸入加總，請核對重修與重複採計。'); break; }
    names.add(name);
  }
  return { ok: true, report: {
    targetTerm: options.targetTerm, workloadLimit: options.workloadLimit,
    before: before.value, after: after.value,
    remainingDelta: before.value.remaining === null || after.value.remaining === null ? null :
      credits(units(after.value.remaining) - units(before.value.remaining)),
    capacityShortfall: after.value.remaining === null ? null : remaining(after.value.remaining, after.value.roomWithinLimit),
    unallocated,
    pendingMilestones: afterPlan.milestones.filter((item) => !item.done).length,
    unknownCategories: after.categories.filter((category) => category.remaining === null).length,
    categories: before.categories.map((category, index) => ({
      key: category.key, label: category.label, before: category.remaining, after: after.categories[index].remaining,
    })),
    terms: before.terms.map((term, index) => ({ term: term.term, before: term.planned,
      after: after.terms[index].planned, room: after.terms[index].room, overBy: after.terms[index].overBy })),
    laterCourses: afterPlan.courses.filter((course) => course.term > options.targetTerm)
      .map(({ id, name, term, credits }) => ({ id, name, term, credits })).sort((a, b) => a.term - b.term),
    warnings,
  } };
}

export function creditDeadlineConclusion(report: CreditDeadlineReport): string {
  if (report.after.remaining === null) return '目標尚未設定完整，暫時不能判斷期限缺口。';
  if (report.after.remaining > 0 && report.after.remainingAfterAll === 0) {
    // Extra is counted in remainingAfterAll but never in the deadline; do not claim unqualified sufficiency.
    if (report.unallocated > 0) {
      return `含尚未排入學期的其他預計學分後，全部修完總量可達標，但第 ${report.targetTerm} 學期末仍差 ${formatCredits(report.after.remaining)} 學分。`;
    }
    return `全部修完總量足夠，但第 ${report.targetTerm} 學期末仍差 ${formatCredits(report.after.remaining)} 學分。`;
  }
  if (report.after.remaining > 0) return `第 ${report.targetTerm} 學期末，這個方案仍差 ${formatCredits(report.after.remaining)} 學分。`;
  return `第 ${report.targetTerm} 學期末，個人總量目標在假設下可達成；仍須核對分類、必修與非學分條件。`;
}
