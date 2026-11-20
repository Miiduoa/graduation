import { analyzeCreditPlan } from '@campus/shared/src/creditPlanInsights';
import { emptyCreditPlan, type CreditPlan } from '@campus/shared/src/creditPlanner';

test('mobile and web plans share the same conservative semester math', () => {
  const plan: CreditPlan = {
    ...emptyCreditPlan(),
    recognized: '60',
    target: '128',
    extra: '20',
    terms: 4,
    courses: [
      { id: 'db', name: '資料庫', credits: 3, term: 1, category: 'required', status: 'registered' },
      { id: 'gen', name: '跨域通識', credits: 2, term: 2, category: 'general', status: 'considering' },
    ],
    milestones: [{ id: 'english', label: '英文能力', done: false }],
  };
  const r = analyzeCreditPlan(plan);
  expect(r.averageNeededPerTerm).toBe(17);
  expect(r.creditsWithoutSemester).toBe(63);
  expect(r.remainingAfterAllPlans).toBe(43);
  expect(r.terms[0].cumulativeIfPassed).toBe(63);
  expect(r.terms[1].cumulativeIfPassed).toBe(65);
  expect(r.terms[2].cumulativeIfPassed).toBe(65);
  expect(r.terms[3].cumulativeIfPassed).toBe(65);
  expect(r.pendingMilestones).toEqual(['英文能力']);
  expect(r.guidance.some((item) => item.includes('未分配到任何未來學期'))).toBe(true);
});

test('unverified baseline never creates fake progress or official school milestones', () => {
  const r = analyzeCreditPlan({
    ...emptyCreditPlan(),
    courses: [
      { id: 'x', name: '專題', credits: 3, term: 1, category: 'required', status: 'considering' },
    ],
  });
  expect(r.averageNeededPerTerm).toBeNull();
  expect(r.remainingAfterAllPlans).toBeNull();
  expect(r.terms[0].cumulativeIfPassed).toBeNull();
  expect(r.earliestTargetTerm).toBeNull();
});

test('recognizes potentially repeated course titles as a caution, not earned credit', () => {
  const r = analyzeCreditPlan({
    ...emptyCreditPlan(),
    recognized: '12',
    target: '40',
    courses: [
      { id: 'a', name: '程式設計', credits: 3, term: 1, category: 'required', status: 'considering' },
      { id: 'b', name: '程式設計', credits: 3, term: 2, category: 'required', status: 'considering' },
    ],
  });
  expect(r.possibleRetakes.map((item) => item.name)).toEqual(['程式設計']);
  expect(r.guidance.some((item) => item.includes('重修'))).toBe(true);
});
