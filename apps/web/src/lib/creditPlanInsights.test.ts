import { describe, expect, it } from 'vitest';
import {
  analyzeCreditPlan,
} from '@campus/shared/src/creditPlanInsights';
import { emptyCreditPlan, type CreditPlan } from '@campus/shared/src/creditPlanner';

const course = (id: string, name: string, term: number, credits: number) => ({
  id,
  name,
  term,
  credits,
  category: 'required' as const,
  status: 'considering' as const,
});

describe('personal credit-feasibility insights', () => {
  it('never makes up remaining credits or a graduation date without a confirmed baseline', () => {
    const empty = analyzeCreditPlan(emptyCreditPlan());
    expect(empty.averageNeededPerTerm).toBeNull();
    expect(empty.remainingAfterAllPlans).toBeNull();
    expect(empty.creditsWithoutSemester).toBeNull();
    expect(empty.earliestTargetTerm).toBeNull();
    expect(empty.terms).toHaveLength(4);
    expect(empty.terms.every((term) => term.cumulativeIfPassed === null)).toBe(true);
    expect(empty.guidance[0]).toContain('先輸入');
  });

  it('separates unassigned extra credits from a term-by-term projection', () => {
    const plan: CreditPlan = {
      ...emptyCreditPlan(),
      recognized: '60',
      target: '128',
      extra: '20',
      courses: [
        course('a', '資料庫系統', 1, 3),
        { ...course('b', '跨域與設計', 2, 2.5), category: 'general' },
      ],
      categoryGoals: {
        ...emptyCreditPlan().categoryGoals,
        required: { recognized: '20', target: '30' },
      },
      milestones: [{ id: 'english', label: '英文能力門檻', done: false }],
    };
    const result = analyzeCreditPlan(plan);
    expect(result.averageNeededPerTerm).toBe(17);
    expect(result.creditsWithoutSemester).toBe(62.5);
    expect(result.remainingAfterAllPlans).toBe(42.5);
    expect(result.earliestTargetTerm).toBeNull();
    expect(result.terms[0]).toEqual({
      term: 1, plannedCredits: 3, cumulativeIfPassed: 63, remainingIfPassed: 65,
    });
    expect(result.terms[1].cumulativeIfPassed).toBe(65.5);
    expect(result.terms[3].cumulativeIfPassed).toBe(65.5);
    expect(result.categoryGaps).toEqual([{ key: 'required', label: '必修', remaining: 7 }]);
    expect(result.pendingMilestones).toEqual(['英文能力門檻']);
    expect(result.guidance.some((text) => text.includes('未分配到任何未來學期'))).toBe(true);
    expect(result.guidance.some((text) => text.includes('非學分條件'))).toBe(true);
  });

  it('cautions on possible retakes and heavy loads without asserting a real university cap', () => {
    const plan: CreditPlan = {
      ...emptyCreditPlan(),
      recognized: '50',
      target: '70',
      terms: 2,
      courses: [
        course('a', '程式設計', 1, 15),
        course('b', ' 程式設計 ', 2, 15),
        course('c', '資料庫', 2, 12),
      ],
    };
    const result = analyzeCreditPlan(plan);
    expect(result.possibleRetakes).toEqual([{ name: '程式設計', semesters: [1, 2] }]);
    expect(result.workloadCautions).toEqual([{ term: 2, credits: 27 }]);
    expect(result.earliestTargetTerm).toBe(2);
    expect(result.remainingAfterAllPlans).toBe(0);
    expect(result.guidance.join(' ')).toContain('校方認定');
    expect(result.guidance.join(' ')).toContain('實際修課上限');
  });

  it('rounds up only an average minimum; does not silently allocate unscheduled credits', () => {
    const result = analyzeCreditPlan({
      ...emptyCreditPlan(),
      recognized: '0',
      target: '1',
      extra: '1',
      terms: 3,
    });
    expect(result.averageNeededPerTerm).toBe(0.34);
    expect(result.creditsWithoutSemester).toBe(1);
    expect(result.remainingAfterAllPlans).toBe(0);
    expect(result.earliestTargetTerm).toBeNull();
    expect(result.terms.every((term) => term.cumulativeIfPassed === 0)).toBe(true);
  });

  it('uses 0 only for an already-met personal total target, without issuing graduation approval', () => {
    const result = analyzeCreditPlan({
      ...emptyCreditPlan(),
      recognized: '128',
      target: '128',
    });
    expect(result.earliestTargetTerm).toBe(0);
    expect(result.averageNeededPerTerm).toBe(0);
    expect(result.remainingAfterAllPlans).toBe(0);
    expect(result.guidance.join(' ')).toContain('正式畢業審查');
  });

  it('highlights conflicting manually recognized category totals without treating missing categories as passed', () => {
    const result = analyzeCreditPlan({
      ...emptyCreditPlan(),
      recognized: '10',
      target: '40',
      categoryGoals: {
        ...emptyCreditPlan().categoryGoals,
        required: { recognized: '25', target: '30' },
      },
    });
    expect(result.guidance.some((msg) => msg.includes('重複採計'))).toBe(true);
    expect(result.categoryGaps).toEqual([{ key: 'required', label: '必修', remaining: 5 }]);
  });
});
