import {
  emptyCreditPlan, type CreditPlan,
} from '@campus/shared/src/creditPlanner';
import { emptyCreditCourseForm, type CreditPlanInputs } from '../features/academics/creditPlanDrafts';
import { prepareCreditPlanBatchSave } from '../features/academics/creditPlanBatchSave';

function inputsFor(plan = emptyCreditPlan()): CreditPlanInputs {
  return { goals: { recognized: plan.recognized, target: plan.target, extra: plan.extra },
    categoryGoals: JSON.parse(JSON.stringify(plan.categoryGoals)), form: emptyCreditCourseForm(),
    editId: null, milestoneLabel: '' };
}
function existing(): CreditPlan {
  return { ...emptyCreditPlan(), recognized: '60', target: '128', courses: [
    { id: 'saved', name: '資料庫管理', credits: 3, term: 1, category: 'required', status: 'considering' },
  ] };
}
const id = (kind: 'course' | 'milestone') => `new-${kind}`;
function expectIssue(plan: CreditPlan, inputs: CreditPlanInputs, message: string) {
  const createId = jest.fn(id);
  const result = prepareCreditPlanBatchSave(plan, inputs, createId);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected invalid draft');
  expect(result.issues.join('\n')).toContain(message);
  expect(createId).not.toHaveBeenCalled();
}

test('combines four edited sections without treating planned credits as earned', () => {
  const plan = emptyCreditPlan();
  const inputs = inputsFor(plan);
  inputs.goals = { recognized: '60', target: '128', extra: '0' };
  inputs.categoryGoals.required = { recognized: '20', target: '48' };
  inputs.form = { ...inputs.form, name: '  資料庫管理  ', credits: '2.5', term: 6, status: 'registered' };
  inputs.milestoneLabel = '  英語檢定  ';
  const before = JSON.stringify({ plan, inputs });
  const result = prepareCreditPlanBatchSave(plan, inputs, id);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.issues.join('\n'));
  expect(result.plan.recognized).toBe('60');
  expect(result.plan.terms).toBe(6);
  expect(result.plan.categoryGoals.required).toEqual({ recognized: '20', target: '48' });
  expect(result.plan.courses).toEqual([{ id: 'new-course', name: '資料庫管理', credits: 2.5,
    term: 6, category: 'elective', status: 'registered' }]);
  expect(result.plan.milestones).toEqual([{ id: 'new-milestone', label: '英語檢定', done: false }]);
  expect(result.courseId).toBe('new-course');
  expect(result.milestoneAdded).toBe(true);
  expect(JSON.stringify({ plan, inputs })).toBe(before);
  expect(result.plan.categoryGoals.required).not.toBe(inputs.categoryGoals.required);
});

test('an untouched plan is a no-op and does not allocate identifiers', () => {
  const plan = existing();
  const inputs = inputsFor(plan);
  inputs.form.term = 3;
  const createId = jest.fn(id);
  const result = prepareCreditPlanBatchSave(plan, inputs, createId);
  expect(result).toEqual({ ok: true, plan, courseId: null, milestoneAdded: false });
  expect(result.ok && result.plan).toBe(plan);
  expect(createId).not.toHaveBeenCalled();
});

test('goals-only changes do not create an empty course or milestone', () => {
  const plan = emptyCreditPlan();
  const inputs = inputsFor(plan);
  inputs.goals.recognized = '0';
  const result = prepareCreditPlanBatchSave(plan, inputs, id);
  expect(result.ok && result.plan.recognized).toBe('0');
  expect(result.ok && result.plan.courses).toEqual([]);
  expect(result.ok && result.plan.milestones).toEqual([]);
});

test.each(['-1', '1e2', '1.001', '1001', '1234567890123'])('rejects invalid goal %s without allocating IDs', (value) => {
  const plan = emptyCreditPlan();
  const inputs = inputsFor(plan);
  inputs.goals.target = value;
  inputs.form.name = '資料庫管理';
  expectIssue(plan, inputs, '希望累計的學分');
});

test('collects errors from all sections without mutating either source', () => {
  const plan = existing();
  const inputs = inputsFor(plan);
  inputs.goals.target = '-1';
  inputs.categoryGoals.required.target = 'wrong';
  inputs.form.name = ' ';
  inputs.form.credits = '0';
  inputs.milestoneLabel = 'A';
  const before = JSON.stringify({ plan, inputs });
  const result = prepareCreditPlanBatchSave(plan, inputs, id);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected invalid draft');
  expect(result.issues.join('\n')).toMatch(/學分目標/);
  expect(result.issues.join('\n')).toMatch(/分類門檻/);
  expect(result.issues.join('\n')).toMatch(/課程安排/);
  expect(result.issues.join('\n')).toMatch(/非學分條件/);
  expect(JSON.stringify({ plan, inputs })).toBe(before);
});

test.each(['0', '30.01', '3.001', 'NaN'])('rejects course credits %s', (credits) => {
  const plan = emptyCreditPlan();
  const inputs = inputsFor(plan);
  inputs.form = { ...inputs.form, name: '資料庫管理', credits };
  expectIssue(plan, inputs, '學分應為');
});

test('rejects a duplicate course in the same semester after trimming and case folding', () => {
  const plan = existing();
  plan.courses[0].name = 'Database';
  const inputs = inputsFor(plan);
  inputs.form.name = '  DATABASE  ';
  expectIssue(plan, inputs, '同一學期已有同名課程');
});

test('allows the same title in a different semester', () => {
  const plan = existing();
  const inputs = inputsFor(plan);
  inputs.form = { ...inputs.form, name: '資料庫管理', term: 2 };
  const result = prepareCreditPlanBatchSave(plan, inputs, id);
  expect(result.ok && result.plan.courses).toHaveLength(2);
});

test('edits in place and preserves the course ID', () => {
  const plan = existing();
  const inputs = inputsFor(plan);
  inputs.editId = 'saved';
  inputs.form = { ...plan.courses[0], name: '資料庫系統', credits: '4', term: 2 };
  const createId = jest.fn(id);
  const result = prepareCreditPlanBatchSave(plan, inputs, createId);
  expect(result.ok && result.plan.courses).toEqual([
    { ...plan.courses[0], name: '資料庫系統', credits: 4, term: 2 },
  ]);
  expect(createId).not.toHaveBeenCalled();
});

test('rejects an edit whose original course is missing', () => {
  const plan = existing();
  const inputs = inputsFor(plan);
  inputs.editId = 'deleted'; inputs.form.name = '其他課程';
  expectIssue(plan, inputs, '原課程已不存在');
});

test('enforces the 120-course limit for new courses but still allows editing', () => {
  const plan = existing();
  plan.courses = Array.from({ length: 120 }, (_, i) => ({ ...plan.courses[0], id: `c${i}`, name: `課程${i}` }));
  const inputs = inputsFor(plan);
  inputs.form.name = '新課程';
  expectIssue(plan, inputs, '最多 120 門課');
  inputs.editId = 'c0';
  const result = prepareCreditPlanBatchSave(plan, inputs, id);
  expect(result.ok && result.plan.courses).toHaveLength(120);
});

test.each([0, 9, 1.5])('rejects invalid semester %s', (term) => {
  const plan = emptyCreditPlan();
  const inputs = inputsFor(plan);
  inputs.form = { ...inputs.form, name: '資料庫管理', term };
  expectIssue(plan, inputs, '第 1–8 學期');
});

test('rejects unknown category and status values', () => {
  const plan = emptyCreditPlan();
  const inputs = inputsFor(plan);
  inputs.form.name = '資料庫管理';
  Object.assign(inputs.form, { category: 'unverified', status: 'passed' });
  expectIssue(plan, inputs, '重新選擇課程分類');
  expectIssue(plan, inputs, '重新選擇修課狀態');
});

test.each([' ', 'A', '長'.repeat(81)])('rejects incomplete milestone %s', (label) => {
  const plan = emptyCreditPlan();
  const inputs = inputsFor(plan);
  inputs.milestoneLabel = label;
  expectIssue(plan, inputs, '名稱需要 2–80 字');
});

test('rejects a 25th milestone without dropping otherwise valid goals', () => {
  const plan = existing();
  plan.milestones = Array.from({ length: 24 }, (_, i) => ({ id: `m${i}`, label: `條件${i}`, done: i === 0 }));
  const inputs = inputsFor(plan);
  inputs.goals.target = '140'; inputs.milestoneLabel = '英語檢定';
  expectIssue(plan, inputs, '最多 24 項');
  expect(plan.target).toBe('128');
  inputs.milestoneLabel = '';
  const result = prepareCreditPlanBatchSave(plan, inputs, id);
  expect(result.ok && result.plan.target).toBe('140');
  expect(result.ok && result.plan.milestones[0].done).toBe(true);
});

test('rejects a generated identifier colliding with an existing course', () => {
  const plan = existing();
  const inputs = inputsFor(plan);
  inputs.form.name = '網路概論';
  const result = prepareCreditPlanBatchSave(plan, inputs, () => 'saved');
  expect(result.ok).toBe(false);
});

test('rejects blank generated identifiers', () => {
  const plan = emptyCreditPlan();
  const inputs = inputsFor(plan);
  inputs.milestoneLabel = '英語檢定';
  const result = prepareCreditPlanBatchSave(plan, inputs, () => ' ');
  expect(result.ok).toBe(false);
});
