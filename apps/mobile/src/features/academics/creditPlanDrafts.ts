import {
  PLANNER_CATEGORIES, formatCredits,
  type CreditPlan, type PlannedCourse,
} from '@campus/shared/src/creditPlanner';

export type CreditCourseForm = Omit<PlannedCourse, 'id' | 'credits'> & { credits: string };
export type CreditPlanInputs = {
  goals: Pick<CreditPlan, 'recognized' | 'target' | 'extra'>;
  categoryGoals: CreditPlan['categoryGoals'];
  form: CreditCourseForm;
  editId: string | null;
  milestoneLabel: string;
};

export const emptyCreditCourseForm = (term = 1): CreditCourseForm => ({
  name: '', credits: '3', term, category: 'elective', status: 'considering',
});

export function creditCourseHasChanges(plan: CreditPlan, inputs: CreditPlanInputs): boolean {
  const saved = inputs.editId ? plan.courses.find((course) => course.id === inputs.editId) : null;
  if (inputs.editId && !saved) return true;
  // Choosing a semester for a blank form is navigation, not an unsaved course.
  const original = saved
    ? { ...saved, credits: formatCredits(saved.credits) }
    : emptyCreditCourseForm(inputs.form.term);
  return (['name', 'credits', 'term', 'category', 'status'] as const)
    .some((key) => inputs.form[key] !== original[key]);
}

export function creditPlanDirtySections(plan: CreditPlan | null, inputs: CreditPlanInputs): string[] {
  if (!plan) return [];
  const sections: string[] = [];
  if ((['recognized', 'target', 'extra'] as const).some((key) => inputs.goals[key] !== plan[key])) {
    sections.push('學分目標');
  }
  if (creditCourseHasChanges(plan, inputs)) sections.push('課程安排');
  if (PLANNER_CATEGORIES.some(({ key }) =>
    inputs.categoryGoals[key].recognized !== plan.categoryGoals[key].recognized ||
    inputs.categoryGoals[key].target !== plan.categoryGoals[key].target)) {
    sections.push('分類門檻');
  }
  if (inputs.milestoneLabel.length > 0) sections.push('非學分條件');
  return sections;
}
