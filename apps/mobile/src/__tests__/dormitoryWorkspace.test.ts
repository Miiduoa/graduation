import {
  DORM_MILESTONE_LIMIT,
  DORM_INSPECTION_ITEMS,
  DORM_PARCEL_LIMIT,
  emptyDormWorkspace,
  dormInspectionProgress,
  isValidDormDate,
  normalizeDormWorkspace,
  sortedDormMilestones,
  sortedDormParcels,
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

test('normalizes parcel notes from older records and excludes malformed IDs', () => {
  const old = normalizeDormWorkspace({ version: 1, building: '思高學苑' });
  expect(old.parcels).toEqual([]);
  const next = normalizeDormWorkspace({
    parcels: [
      { id: 'a', title: '新包裹', dueDate: '2026-11-20', createdAt: 3 },
      { id: 'duplicate', title: '郵件', dueDate: '2026-11-01', collected: true, collectedAt: 10 },
      { id: 'duplicate', title: '重複', dueDate: '2026-11-05' },
      { id: 'bad/id', title: '不合法' },
      { id: 'other', title: '第二件', dueDate: '2026-02-30' },
    ],
  });
  expect(next.parcels).toHaveLength(3);
  expect(next.parcels[2].dueDate).toBe('');
  expect(sortedDormParcels(next).map((item) => item.id)).toEqual(['a', 'other', 'duplicate']);
  expect(normalizeDormWorkspace({
    parcels: Array.from({ length: DORM_PARCEL_LIMIT + 4 }, (_, n) => ({
      id: 'parcel_' + n, title: '包裹 ' + n,
    })),
  }).parcels).toHaveLength(DORM_PARCEL_LIMIT);
});

test('resident room inspection is scoped to known items and never represents school sign-off', () => {
  const next = normalizeDormWorkspace({
    inspection: { air: 'issue', doors: 'ok', other: 'approved', network: 'school-accepted' },
  });
  expect(next.inspection).toEqual({ air: 'issue', doors: 'ok' });
  expect(dormInspectionProgress(next)).toEqual({
    checked: 2, issues: 1, total: DORM_INSPECTION_ITEMS.length,
  });
  expect(normalizeDormWorkspace({ version: 1, room: '203' }).inspection).toEqual({});
});
