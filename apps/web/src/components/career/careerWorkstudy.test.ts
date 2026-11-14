import { describe, expect, it } from 'vitest';
import {
  slotLabel,
  slotValid,
  workstudyConflicts,
  transitionAllowed,
} from '@campus/shared/src/careerWorkstudy';
import { courses } from '@campus/shared/testFixtures/careerWorkstudy';
describe('work-study conflicts use the actual school period table', () => {
  it('detects partial overlap, but preserves a touching endpoint as free', () => {
    expect(
      workstudyConflicts('pu', [{ day: 1, start: '08:59', end: '09:01' }], courses).names,
    ).toEqual(['測試課程']);
    expect(workstudyConflicts('pu', [{ day: 1, start: '09:00', end: '10:00' }], courses)).toEqual({
      known: true,
      names: [],
    });
    expect(
      workstudyConflicts('pu', [{ day: 2, start: '08:10', end: '09:00' }], courses).names,
    ).toEqual([]);
  });
  it('uses NCKU period zero time instead of PU time', () => {
    expect(
      workstudyConflicts('ncku', [{ day: 1, start: '07:10', end: '07:20' }], courses).names,
    ).toEqual(['測試課程']);
    expect(
      workstudyConflicts('pu', [{ day: 1, start: '07:10', end: '07:20' }], courses).names,
    ).toEqual([]);
  });
  it('does not invent free time when course data or school times are unknown', () => {
    expect(workstudyConflicts('unknown', [], courses).known).toBe(false);
    expect(workstudyConflicts('pu', [], null).known).toBe(false);
    expect(workstudyConflicts('pu', [], []).known).toBe(false);
    expect(workstudyConflicts('pu', [], [{ ...courses[0], day: 0 }]).known).toBe(false);
    expect(workstudyConflicts('pu', [], [{ ...courses[0], start: 30 }]).known).toBe(false);
  });
  it('supports weekend slots and validates time ranges', () => {
    expect(slotLabel({ day: 7, start: '09:00', end: '10:00' })).toBe('週日 09:00–10:00');
    expect(slotValid({ day: 7, start: '24:00', end: '25:00' })).toBe(false);
    expect(slotValid({ day: 1, start: '09:00', end: '09:00' })).toBe(false);
  });
  it('requires read before decisions and never silently rewinds an outcome', () => {
    expect(transitionAllowed('submitted', 'accepted')).toBe(false);
    expect(transitionAllowed('read', 'rejected')).toBe(true);
    expect(transitionAllowed('accepted', 'interview')).toBe(false);
  });
});
