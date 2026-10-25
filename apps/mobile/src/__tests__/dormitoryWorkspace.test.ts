import {
  DORM_MILESTONE_LIMIT,
  emptyDormWorkspace,
  isValidDormDate,
  normalizeDormWorkspace,
  sortedDormMilestones,
} from '@campus/shared/src/dormitory';
import { resolveDormitoryPublicGuide } from '@campus/shared/src/dormitoryGuide';

test('unrecognized campuses never inherit the PU hall and fee reference', () => {
  expect(resolveDormitoryPublicGuide('pu')?.halls).toHaveLength(3);
  expect(resolveDormitoryPublicGuide('tw-pu')?.halls).toHaveLength(3);
  expect(resolveDormitoryPublicGuide('ncku')).toBeNull();
  expect(resolveDormitoryPublicGuide('unknown')).toBeNull();
});

test('legacy device records stay readable and dates are not fabricated', () => {
  const legacy = normalizeDormWorkspace({ version: 1, building: '思高學苑', room: '501', repairs: [] });
  expect(legacy.milestones).toEqual([]);
  expect(emptyDormWorkspace().milestones).toEqual([]);
  expect(isValidDormDate('2026-02-30')).toBe(false);
  const milestones = Array.from({ length: DORM_MILESTONE_LIMIT + 3 }, (_, i) => ({
    id: 'event_' + i, title: '個人日期 ' + i, dueDate: '2026-12-01', completed: i === 0,
  }));
  const normalized = normalizeDormWorkspace({ milestones });
  expect(normalized.milestones).toHaveLength(DORM_MILESTONE_LIMIT);
  expect(sortedDormMilestones(normalized).at(-1)?.completed).toBe(true);
});
