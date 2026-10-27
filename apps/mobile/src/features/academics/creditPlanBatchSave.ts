import {
  MAX_MILESTONES, MAX_PLANNED_COURSES, PLANNER_CATEGORIES, parseCredits,
  type CreditPlan, type PlannedCourse,
} from '@campus/shared/src/creditPlanner';
import { creditCourseHasChanges, creditPlanDirtySections, type CreditPlanInputs } from './creditPlanDrafts';

export type CreditPlanBatchResult =
  | { ok: false; issues: string[] }
  | { ok: true; plan: CreditPlan; courseId: string | null; milestoneAdded: boolean };

type IdFactory = (kind: 'course' | 'milestone') => string;
const validNumber = (value: string) => value.length <= 12 &&
  (value.trim() === '' || parseCredits(value) !== null);
const validId = (id: string) => id.trim().length > 0 && id.length <= 100;

/** 先檢查所有草稿，再建立單一寫入版本；不修改輸入，也不接觸儲存空間。 */
export function prepareCreditPlanBatchSave(
  plan: CreditPlan, inputs: CreditPlanInputs, createId: IdFactory,
): CreditPlanBatchResult {
  if (!creditPlanDirtySections(plan, inputs).length) {
    return { ok: true, plan, courseId: null, milestoneAdded: false };
  }
  const issues: string[] = [];
  const goalLabels = { recognized: '已確認可採計學分', target: '希望累計的學分', extra: '其他預計學分' };
  for (const key of ['recognized', 'target', 'extra'] as const) {
    if (!validNumber(inputs.goals[key])) issues.push(`學分目標｜${goalLabels[key]}：請輸入 0–1000，最多兩位小數；可留空。`);
  }
  for (const { key, label } of PLANNER_CATEGORIES) {
    for (const field of ['recognized', 'target'] as const) {
      if (!validNumber(inputs.categoryGoals[key][field])) {
        issues.push(`分類門檻｜${label}${field === 'recognized' ? '已確認採計' : '目標門檻'}：請輸入 0–1000，最多兩位小數；可留空。`);
      }
    }
  }

  const courseChanged = creditCourseHasChanges(plan, inputs);
  const name = inputs.form.name.trim();
  const credits = parseCredits(inputs.form.credits);
  if (courseChanged) {
    if (!name || name.length > 80) issues.push('課程安排｜課程名稱需要 1–80 字。');
    if (credits === null || credits <= 0 || credits > 30) issues.push('課程安排｜學分應為 0.01–30，最多兩位小數。');
    if (!Number.isInteger(inputs.form.term) || inputs.form.term < 1 || inputs.form.term > 8) {
      issues.push('課程安排｜請選擇第 1–8 學期。');
    }
    if (!PLANNER_CATEGORIES.some(({ key }) => key === inputs.form.category)) issues.push('課程安排｜請重新選擇課程分類。');
    if (inputs.form.status !== 'considering' && inputs.form.status !== 'registered') issues.push('課程安排｜請重新選擇修課狀態。');
    if (inputs.editId && !plan.courses.some((course) => course.id === inputs.editId)) {
      issues.push('課程安排｜原課程已不存在，請重新選擇要編輯的課程。');
    }
    if (!inputs.editId && plan.courses.length >= MAX_PLANNED_COURSES) issues.push('課程安排｜每份規劃最多 120 門課，請先整理舊課程。');
    if (plan.courses.some((course) => course.id !== inputs.editId && course.term === inputs.form.term &&
      course.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      issues.push('課程安排｜同一學期已有同名課程，請編輯原課程。');
    }
  }

  const milestoneAdded = inputs.milestoneLabel.length > 0;
  const label = inputs.milestoneLabel.trim();
  if (milestoneAdded) {
    if (label.length < 2 || label.length > 80) issues.push('非學分條件｜名稱需要 2–80 字；不新增時請清空此欄。');
    if (plan.milestones.length >= MAX_MILESTONES) issues.push('非學分條件｜每份規劃最多 24 項，請先整理舊條件。');
  }
  if (issues.length) return { ok: false, issues };

  // 全部欄位通過後才分配識別碼，避免失敗重試先產生不完整的課程或條件。
  const courseId = courseChanged ? inputs.editId ?? createId('course') : null;
  const milestoneId = milestoneAdded ? createId('milestone') : null;
  if (courseId !== null && (!validId(courseId) || (!inputs.editId && plan.courses.some((course) => course.id === courseId)))) {
    issues.push('課程安排｜無法建立新的課程識別，請重新儲存。');
  }
  if (milestoneId !== null && (!validId(milestoneId) || plan.milestones.some((milestone) => milestone.id === milestoneId))) {
    issues.push('非學分條件｜無法建立新的條件識別，請重新儲存。');
  }
  if (issues.length) return { ok: false, issues };

  let courses = [...plan.courses];
  if (courseId !== null && credits !== null) {
    const course: PlannedCourse = { id: courseId, name, credits, term: inputs.form.term,
      category: inputs.form.category, status: inputs.form.status };
    courses = inputs.editId
      ? courses.map((saved) => saved.id === inputs.editId ? course : saved)
      : [...courses, course];
  }
  const categoryGoals = Object.fromEntries(PLANNER_CATEGORIES.map(({ key }) =>
    [key, { ...inputs.categoryGoals[key] }])) as CreditPlan['categoryGoals'];
  return {
    ok: true, courseId, milestoneAdded,
    plan: {
      ...plan, ...inputs.goals, categoryGoals, courses,
      terms: courseChanged ? Math.max(plan.terms, inputs.form.term) : plan.terms,
      milestones: milestoneId === null ? [...plan.milestones]
        : [...plan.milestones, { id: milestoneId, label, done: false }],
    },
  };
}
