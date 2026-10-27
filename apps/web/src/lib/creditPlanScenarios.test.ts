import { describe, expect, it } from 'vitest';
import { emptyCreditPlan, restoreCreditPlan, type CreditPlan } from '@campus/shared/src/creditPlanner';
import {
  changeCreditScenario, compareCreditScenario, creditScenarioTargetLabel,
  filterCreditScenarioCourses, startCreditScenario,
  type CreditScenario, type CreditScenarioComparison,
} from '@campus/shared/src/creditPlanScenarios';

function sample(): CreditPlan {
  return {
    ...emptyCreditPlan(), recognized: '60', target: '68', extra: '2.5', terms: 2,
    categoryGoals: { ...emptyCreditPlan().categoryGoals, required: { recognized: '20', target: '26' } },
    milestones: [{ id: 'language', label: '英文檢定', done: false }],
    courses: [
      { id: 'database', name: '資料庫', credits: 3, category: 'required', term: 1, status: 'registered' },
      { id: 'stats', name: '統計學', credits: 2.5, category: 'required', term: 1, status: 'considering' },
      { id: 'ai', name: 'ＡＩ 專題', credits: 3, category: 'elective', term: 2, status: 'considering' },
    ],
  };
}
function success(plan: CreditPlan, scenario = startCreditScenario(plan)): CreditScenarioComparison {
  const result = compareCreditScenario(plan, scenario);
  if (result.ok === false) throw new Error(result.message);
  return result;
}

describe('個人學分比較方案', () => {
  it('creates an equivalent baseline without modifying the source or its nested values', () => {
    const plan = sample();
    const old = JSON.stringify(plan);
    const result = success(plan);
    expect(result.plan).toEqual(plan);
    expect(result.changed).toBe(false);
    expect(result.before.courseCredits).toBe(8.5);
    expect(result.before.projected).toBe(71);
    result.plan.categoryGoals.required.target = '99';
    result.plan.courses[0].name = 'changed';
    result.plan.milestones[0].done = true;
    expect(JSON.stringify(plan)).toBe(old);
  });

  it('omitting a candidate adjusts both the total and the relevant category, never earned credits', () => {
    const plan = sample();
    plan.target = '80';
    const result = success(plan, changeCreditScenario(startCreditScenario(plan), 'stats', null));
    expect(result.plan.recognized).toBe('60');
    expect(result.after.remaining).toBe(11.5);
    expect(result.before.remaining).toBe(9);
    expect(result.remainingDelta).toBe(2.5);
    expect(result.plannedDelta).toBe(-2.5);
    expect(result.categories.find((row) => row.key === 'required')).toMatchObject({ before: 0.5, after: 3 });
    expect(result.omitted.map((row) => row.id)).toEqual(['stats']);
    expect(result.plan.extra).toBe('2.5');
    expect(result.plan.milestones).toEqual(plan.milestones);
  });

  it('moving a course changes the term load and target timing, not the credit total or course identity', () => {
    const plan = sample();
    const result = success(plan, changeCreditScenario(startCreditScenario(plan), 'ai', 4));
    expect(result.beforeInsights.earliestTargetTerm).toBe(2);
    expect(result.afterInsights.earliestTargetTerm).toBe(4);
    expect(result.plan.terms).toBe(4);
    expect(result.plannedDelta).toBe(0);
    expect(result.remainingDelta).toBe(0);
    expect(result.terms[1]).toEqual({ term: 2, before: 3, after: 0, delta: -3 });
    expect(result.terms[3]).toEqual({ term: 4, before: 0, after: 3, delta: 3 });
    expect(result.plan.courses[2]).toEqual({ ...plan.courses[2], term: 4 });
  });

  it('registered-only is still hypothetical and does not give candidate courses or extra credits a term', () => {
    const plan = sample();
    const result = success(plan, startCreditScenario(plan, 'registered'));
    expect(result.plan.courses.map((row) => row.id)).toEqual(['database']);
    expect(result.after.remaining).toBe(2.5);
    expect(result.afterInsights.earliestTargetTerm).toBeNull();
    expect(result.afterInsights.terms[0].cumulativeIfPassed).toBe(63);
    expect(result.after.recognized).toBe(60);
    expect(result.after.milestonesComplete).toBe(0);
  });

  it('does not shorten the planning horizon when its final term course is excluded', () => {
    const plan = sample();
    plan.courses[2].term = 8;
    const result = success(plan, changeCreditScenario(startCreditScenario(plan), 'ai', null));
    expect(result.plan.terms).toBe(8);
    expect(result.terms).toHaveLength(8);
  });

  it('keeps unset target and category amounts unknown rather than claiming zero gaps', () => {
    const plan = { ...sample(), recognized: '', target: '' };
    const result = success(plan);
    expect(result.after.remaining).toBeNull();
    expect(result.remainingDelta).toBeNull();
    expect(result.categories.find((row) => row.key === 'general')?.after).toBeNull();
    expect(creditScenarioTargetLabel(null, false)).toBe('目標尚未完整設定');
    expect(creditScenarioTargetLabel(null)).toBe('已排課程尚未達目標');
    expect(creditScenarioTargetLabel(0)).toBe('手填已確認學分已達目標');
  });

  it('rejects an old snapshot even when only a goal, category or milestone has changed', () => {
    const plan = sample();
    const scenario = startCreditScenario(plan);
    expect(compareCreditScenario({ ...plan, target: '90' }, scenario)).toMatchObject({ ok: false, reason: 'stale' });
    const changed = sample();
    changed.milestones[0].done = true;
    expect(compareCreditScenario(changed, scenario)).toMatchObject({ ok: false, reason: 'stale' });
  });

  it.each([0, 9, -1, 1.5, NaN, Infinity])('rejects invalid term %s instead of silently moving the course', (term) => {
    const plan = sample();
    expect(compareCreditScenario(plan, changeCreditScenario(startCreditScenario(plan), 'stats', term)))
      .toMatchObject({ ok: false, reason: 'invalid-choice' });
  });

  it('rejects missing, repeated and unrelated course IDs', () => {
    const plan = sample();
    const initial = startCreditScenario(plan);
    for (const choices of [initial.choices.slice(1), [initial.choices[0], initial.choices[0], initial.choices[2]],
      [...initial.choices.slice(0, 2), { courseId: 'unrelated', term: 1 }]]) {
      expect(compareCreditScenario(plan, { ...initial, choices })).toMatchObject({ ok: false, reason: 'invalid-choice' });
    }
    expect(compareCreditScenario(plan, { ...initial, choices: null } as unknown as CreditScenario))
      .toMatchObject({ ok: false, reason: 'invalid-choice' });
  });

  it('refuses an invalid original credit amount before computing a tempting forecast', () => {
    const plan = { ...sample(), target: '12.345' };
    expect(compareCreditScenario(plan, startCreditScenario(plan))).toMatchObject({ ok: false, reason: 'invalid-plan' });
  });

  it('filters only visible rows using Unicode normalization without changing calculation or sorting the source', () => {
    const plan = sample();
    const original = JSON.stringify(plan);
    expect(filterCreditScenarioCourses(plan, 'ai', null).map((row) => row.id)).toEqual(['ai']);
    expect(filterCreditScenarioCourses(plan, '', 1)).toHaveLength(2);
    expect(filterCreditScenarioCourses(plan, '資料庫', 2)).toHaveLength(0);
    expect(JSON.stringify(plan)).toBe(original);
    expect(success(plan).after.courseCredits).toBe(8.5);
  });

  it('exports a compatible plan and preserves manual statuses, thresholds and checklist', () => {
    const plan = sample();
    const result = success(plan, changeCreditScenario(startCreditScenario(plan), 'database', 3));
    const restored = restoreCreditPlan(JSON.stringify(result.plan));
    expect(restored).toEqual(result.plan);
    expect(restored?.courses[0].status).toBe('registered');
    expect(restored?.recognized).toBe(plan.recognized);
    expect(restored?.target).toBe(plan.target);
    expect(restored?.categoryGoals).toEqual(plan.categoryGoals);
    expect(restored?.milestones).toEqual(plan.milestones);
  });

  it('retains duplicate-name and workload cautions instead of treating the projection as official recognition', () => {
    const plan = sample();
    plan.courses[1].name = '資料庫';
    plan.courses[1].credits = 25;
    const result = success(plan);
    expect(result.afterInsights.possibleRetakes).toHaveLength(1);
    expect(result.afterInsights.workloadCautions).toEqual([{ term: 1, credits: 28 }]);
  });
});
