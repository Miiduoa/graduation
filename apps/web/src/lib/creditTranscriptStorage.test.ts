import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyCreditPlan, creditPlanStorageKey } from './creditPlanner';
import { readTranscriptPlan, replaceTranscriptPlan, isCreditReviewFresh } from './creditTranscriptStorage';

beforeEach(() => window.localStorage.clear());
const old = () => ({ ...emptyCreditPlan(), recognized: '20' });
const next = () => ({ ...emptyCreditPlan(), recognized: '30' });
const key = creditPlanStorageKey('user', 'pu');

describe('reviewed transcript to Web plan', () => {
  it('reads only the named account and school and requires both', () => {
    localStorage.setItem(key, JSON.stringify(old()));
    expect(readTranscriptPlan(localStorage, 'user', 'pu')).toEqual(old());
    expect(readTranscriptPlan(localStorage, 'other', 'pu')).toEqual(emptyCreditPlan());
    expect(readTranscriptPlan(localStorage, 'user', 'nchu')).toEqual(emptyCreditPlan());
    expect(() => readTranscriptPlan(localStorage, '', 'pu')).toThrow(/帳號/);
  });
  it('does not replace malformed, missing or modified preview baselines', () => {
    for (const raw of ['{bad', JSON.stringify({ ...old(), target: '160' })]) {
      localStorage.setItem(key, raw);
      expect(() => replaceTranscriptPlan(localStorage, 'user', 'pu', old(), next(), () => true)).toThrow();
      expect(localStorage.getItem(key)).toBe(raw);
    }
    localStorage.removeItem(key);
    expect(() => replaceTranscriptPlan(localStorage, 'user', 'pu', old(), next(), () => true)).toThrow(/已更新/);
    expect(localStorage.getItem(key)).toBeNull();
  });
  it('checks active ownership twice and does not write a stale session', () => {
    localStorage.setItem(key, JSON.stringify(old()));
    const valid = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(() => replaceTranscriptPlan(localStorage, 'user', 'pu', old(), next(), valid)).toThrow(/過期/);
    expect(localStorage.getItem(key)).toBe(JSON.stringify(old()));
  });
  it('replaces only the desired plan and refuses replay of the former baseline', () => {
    localStorage.setItem(key, JSON.stringify(old()));
    const anotherKey = creditPlanStorageKey('other', 'pu');
    localStorage.setItem(anotherKey, JSON.stringify(old()));
    replaceTranscriptPlan(localStorage, 'user', 'pu', old(), next(), () => true);
    expect(JSON.parse(localStorage.getItem(key)!).recognized).toBe('30');
    expect(localStorage.getItem(anotherKey)).toBe(JSON.stringify(old()));
    expect(() => replaceTranscriptPlan(localStorage, 'user', 'pu', old(), next(), () => true)).toThrow(/已更新/);
  });
  it('storage failures propagate and do not produce false receipts', () => {
    const storage = { getItem: () => JSON.stringify(old()), setItem: () => { throw new Error('quota full'); } };
    expect(() => replaceTranscriptPlan(storage, 'user', 'pu', old(), next(), () => true)).toThrow('quota full');
  });
  it('unknown, future and expired timestamps are not considered fresh', () => {
    const now = Date.parse('2026-10-27T12:00:00Z');
    expect(isCreditReviewFresh('invalid', now)).toBe(false);
    expect(isCreditReviewFresh('2026-10-27T12:00:01Z', now)).toBe(false);
    expect(isCreditReviewFresh('2026-10-27T11:49:59Z', now)).toBe(false);
    expect(isCreditReviewFresh('2026-10-27T11:55:00Z', now)).toBe(true);
  });
});
