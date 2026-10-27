import { describe, expect, it } from 'vitest';
import {
  creditPlanStorageKey,
  creditPlanSummary,
  emptyCreditPlan,
  exportCreditPlanCsv,
  parseCredits,
  restoreCreditPlan,
  type CreditPlan,
} from './creditPlanner';

function plan(patch: Partial<CreditPlan> = {}): CreditPlan {
  return { ...emptyCreditPlan(), ...patch };
}

describe('credit planning boundaries', () => {
  it('distinguishes blank from zero and rejects implicit conversions and unsafe values', () => {
    expect(parseCredits('')).toBeNull();
    expect(parseCredits('0')).toBe(0);
    expect(parseCredits('0.5')).toBe(0.5);
    expect(parseCredits('3.25')).toBe(3.25);
    for (const value of ['-1', '1e3', '1.234', '1000.01', 'Infinity', 'NaN', ' ', '12345']) {
      expect(parseCredits(value)).toBeNull();
    }
  });

  it('keeps confirmed credits separate from hypothetical courses and shows per-term load', () => {
    const result = creditPlanSummary(plan({
      recognized: '60',
      target: '128',
      extra: '20',
      courses: [
        { id: 'a', name: '資料庫', credits: 3, category: 'required', term: 1, status: 'registered' },
        { id: 'b', name: '通識', credits: 2.5, category: 'general', term: 2, status: 'considering' },
      ],
    }));
    expect(result.recognized).toBe(60);
    expect(result.missingBefore).toBe(68);
    expect(result.courseCredits).toBe(5.5);
    expect(result.registered).toBe(3);
    expect(result.candidate).toBe(2.5);
    expect(result.planned).toBe(25.5);
    expect(result.projected).toBe(85.5);
    expect(result.remaining).toBe(42.5);
    expect(result.perTerm[0].credits).toBe(3);
    expect(result.perTerm[1].credits).toBe(2.5);
    expect(result.byCategory.find((c) => c.key === 'general')?.credits).toBe(2.5);
  });

  it('shows unknown rather than false zero when required inputs are absent or malformed', () => {
    expect(creditPlanSummary(plan()).remaining).toBeNull();
    expect(creditPlanSummary(plan({ recognized: '80', target: '100' })).remaining).toBe(20);
    expect(creditPlanSummary(plan({ recognized: '80', target: '100', extra: '10.123' })).remaining).toBeNull();
    expect(creditPlanSummary(plan({ recognized: '130', target: '128' })).remaining).toBe(0);
  });

  it('hydrates only validated, account-scoped data and rejects ambiguous or forged records', () => {
    expect(creditPlanStorageKey('alice', 'pu')).not.toBe(creditPlanStorageKey('alice', 'nthu'));
    expect(creditPlanStorageKey('alice', 'pu')).not.toBe(creditPlanStorageKey('bob', 'pu'));
    expect(creditPlanStorageKey(null, 'pu')).not.toBe(creditPlanStorageKey('alice', 'pu'));
    const valid = plan({
      recognized: '28.5',
      target: '128',
      courses: [
        { id: 'A', name: ' 會計學 ', credits: 2.5, category: 'required', term: 3, status: 'considering' },
      ],
    });
    expect(restoreCreditPlan(JSON.stringify(valid))).toEqual(valid);
    expect(restoreCreditPlan('not json')).toBeNull();
    expect(restoreCreditPlan(JSON.stringify({ ...valid, target: '-1' }))).toBeNull();
    expect(restoreCreditPlan(JSON.stringify({ ...valid, version: 9 }))).toBeNull();
    expect(restoreCreditPlan(JSON.stringify({ ...valid, courses: [
      valid.courses[0],
      { ...valid.courses[0] },
    ] }))).toBeNull();
    expect(restoreCreditPlan(JSON.stringify({ ...valid, courses: [
      { ...valid.courses[0], category: 'unverified' },
    ] }))).toBeNull();
    expect(restoreCreditPlan(JSON.stringify({ ...valid, courses: [
      { ...valid.courses[0], credits: 80 },
    ] }))).toBeNull();
  });

  it('evaluates manual category thresholds separately and keeps conditions self-declared', () => {
    const input = plan({
      recognized: '60',
      target: '128',
      categoryGoals: {
        ...emptyCreditPlan().categoryGoals,
        required: { recognized: '20', target: '30' },
        general: { recognized: '24', target: '24' },
      },
      milestones: [
        { id: 'eng', label: '英文能力', done: false },
        { id: 'service', label: '服務學習', done: true },
      ],
      courses: [
        { id: 'r1', name: '資料庫', credits: 3, category: 'required', term: 1, status: 'considering' },
      ],
    });
    const summary = creditPlanSummary(input);
    expect(summary.remaining).toBe(65);
    expect(summary.categoryGaps.find((item) => item.key === 'required')?.remaining).toBe(7);
    expect(summary.categoryGaps.find((item) => item.key === 'general')?.remaining).toBe(0);
    expect(summary.milestonesComplete).toBe(1);
    expect(summary.categoryOvercount).toBe(false);
    expect(restoreCreditPlan(JSON.stringify(input))).toEqual(input);
    expect(exportCreditPlanCsv(input)).toContain('"英文能力"');
    expect(exportCreditPlanCsv(input)).toContain('"必修目標"');
  });

  it('rejects corrupt category thresholds and forged milestone states', () => {
    const valid = plan();
    expect(restoreCreditPlan(JSON.stringify({
      ...valid, categoryGoals: { ...valid.categoryGoals, general: { recognized: '3', target: '-6' } },
    }))).toBeNull();
    expect(restoreCreditPlan(JSON.stringify({
      ...valid, milestones: [{ id: 'x', label: '語言能力', done: 'yes' }],
    }))).toBeNull();
    expect(restoreCreditPlan(JSON.stringify({
      ...valid, milestones: [{ id: 'x', label: '語言能力', done: true }, { id: 'x', label: '服務', done: false }],
    }))).toBeNull();
    expect(creditPlanSummary(plan({
      recognized: '10',
      categoryGoals: { ...valid.categoryGoals, required: { recognized: '20', target: '30' } },
    })).categoryOvercount).toBe(true);
  });

  it('exports CSV without mistaking course names for spreadsheet formulas', () => {
    const csv = exportCreditPlanCsv(plan({
      recognized: '60',
      target: '128',
      courses: [
        { id: 'x', name: '=HYPERLINK("bad")', credits: 2, category: 'other', term: 1, status: 'considering' },
      ],
    }));
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain('"個人規劃，不代表學校正式審查或保證通過"');
  });
});
