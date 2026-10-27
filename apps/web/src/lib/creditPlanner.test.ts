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
