import { expect, it } from 'vitest';
import {
  DORM_CHECKLISTS,
  DORM_INSPECTION_ITEMS,
  DORM_MILESTONE_LIMIT,
  DORM_PARCEL_LIMIT,
  dormChecklistProgress,
  dormInspectionProgress,
  dormStorageKey,
  emptyDormWorkspace,
  formatDormRepairForCopy,
  isValidDormDate,
  sortedDormMilestones,
  sortedDormParcels,
  normalizeDormWorkspace,
} from '@campus/shared/src/dormitory';

it('isolates personal records by account and selected school', () => {
  expect(dormStorageKey('guest', 'pu')).not.toBe(dormStorageKey('firebase:alice', 'pu'));
  expect(dormStorageKey('firebase:alice', 'pu')).not.toBe(dormStorageKey('firebase:alice', 'ncku'));
  expect(dormStorageKey('firebase:a:b', 'c')).not.toBe(dormStorageKey('firebase:a', 'b:c'));
});

it('starts with no fabricated booking, accepted repair or live laundry status', () => {
  const value = emptyDormWorkspace();
  expect(value.room).toBe('');
  expect(value.repairs).toEqual([]);
  expect(value.laundryEndAt).toBeNull();
  expect(dormChecklistProgress(value)).toEqual({
    completed: 0,
    total: DORM_CHECKLISTS.reduce((sum, group) => sum + group.items.length, 0),
  });
});

it('limits user-entered data and rejects duplicate or untrusted repair IDs', () => {
  const value = normalizeDormWorkspace({
    building: 'A'.repeat(200),
    room: '<script>stuff</script>',
    checkmarks: { 'read-announcement': true, 'invented-completion': true },
    repairs: [
      { id: 'a', title: '漏水', status: 'reported', category: 'water', createdAt: 123, updatedAt: 456 },
      { id: 'a', title: '重複', status: 'resolved' },
      { id: '../bad', title: '壞資料' },
      { id: 'b', title: '桌子', status: 'officially-approved', category: 'random' },
    ],
    laundryEndAt: -9,
  });
  expect(value.building).toHaveLength(70);
  expect(value.checkmarks).toEqual({ 'read-announcement': true });
  expect(value.repairs).toHaveLength(2);
  expect(value.repairs[0]).toMatchObject({ id: 'a', status: 'reported', category: 'water' });
  expect(value.repairs[1]).toMatchObject({ id: 'b', status: 'draft', category: 'other' });
  expect(value.laundryEndAt).toBeNull();
  expect(dormChecklistProgress(value).completed).toBe(1);
});

it('copy template explicitly says that the app did not submit a school report', () => {
  const row = normalizeDormWorkspace({
    repairs: [{ id: 'r1', title: '冷氣不冷', category: 'air', location: '寢室', description: '風扇在轉但無冷風' }],
  }).repairs[0];
  const text = formatDormRepairForCopy(row);
  expect(text).toContain('尚未透過此應用送出');
  expect(text).toContain('冷氣不冷');
  expect(text).toContain('風扇在轉但無冷風');
  expect(text).not.toContain('校方已受理');
});


it('safely normalizes locally entered dates without inventing official deadlines', () => {
  const value = normalizeDormWorkspace({
    milestones: [
      { id: 'fee', title: '  繳費截止  ', dueDate: '2026-11-15', completed: false, createdAt: 4 },
      { id: 'fee', title: '重複', dueDate: '2026-11-16' },
      { id: 'bad', title: '錯誤日', dueDate: '2026-02-30' },
      { id: '../malformed', title: '錯誤識別碼', dueDate: '2026-11-20' },
      { id: 'move', title: '搬入', dueDate: '2026-11-01', completed: true, createdAt: 1 },
      { id: 'today', title: '查房', dueDate: '2026-11-08', completed: false, createdAt: 2 },
    ],
  });
  expect(value.milestones).toHaveLength(3);
  expect(value.milestones[0].title).toBe('繳費截止');
  expect(value.milestones.map((m) => m.id)).toEqual(['fee', 'move', 'today']);
  expect(sortedDormMilestones(value).map((m) => m.id)).toEqual(['today', 'fee', 'move']);
  expect(value.milestones[0].completed).toBe(false);
  expect(emptyDormWorkspace().milestones).toEqual([]);
});

it('normalizes a resident inspection without treating unknown or malformed statuses as official', () => {
  const empty = emptyDormWorkspace();
  expect(empty.inspection).toEqual({});
  expect(dormInspectionProgress(empty)).toEqual({
    checked: 0, issues: 0, total: DORM_INSPECTION_ITEMS.length,
  });
  const next = normalizeDormWorkspace({
    inspection: { air: 'issue', lighting: 'ok', bathroom: 'reported', unknown: 'issue' },
  });
  expect(next.inspection).toEqual({ air: 'issue', lighting: 'ok' });
  expect(dormInspectionProgress(next)).toEqual({
    checked: 2, issues: 1, total: DORM_INSPECTION_ITEMS.length,
  });
  expect(normalizeDormWorkspace({ version: 1, building: '思高學苑' }).inspection).toEqual({});
});

it('keeps older data readable and validates resident-entered parcel pickups', () => {
  const previous = normalizeDormWorkspace({ version: 1, building: '思高學苑' });
  expect(previous.parcels).toEqual([]);
  const next = normalizeDormWorkspace({
    parcels: [
      { id: 'p1', title: '  包裹一  ', pickupPoint: ' 服務台 ', dueDate: '2026-12-02', createdAt: 1 },
      { id: 'p1', title: '重複資料', dueDate: '2026-11-01' },
      { id: 'p2', title: '掛號', dueDate: '2026-11-01', collected: false, createdAt: 2 },
      { id: '../no', title: '識別碼不合法' },
      { id: 'p3', title: '已領', collected: true, createdAt: 3, collectedAt: 5 },
      { id: 'p4', title: '其他', dueDate: '2026-02-30', createdAt: 4 },
    ],
  });
  expect(next.parcels).toHaveLength(4);
  expect(next.parcels[0]).toMatchObject({ title: '包裹一', pickupPoint: '服務台' });
  expect(next.parcels[3].dueDate).toBe('');
  expect(sortedDormParcels(next).map((p) => p.id)).toEqual(['p2', 'p1', 'p4', 'p3']);
  expect(sortedDormParcels(next)[3].collectedAt).toBe(5);
  expect(normalizeDormWorkspace({
    parcels: Array.from({ length: DORM_PARCEL_LIMIT + 5 }, (_, index) => ({
      id: 'p_' + index, title: '包裹 ' + index,
    })),
  }).parcels).toHaveLength(DORM_PARCEL_LIMIT);
});

it('validates leap days and caps the personal date list', () => {
  expect(isValidDormDate('2028-02-29')).toBe(true);
  expect(isValidDormDate('2026-02-29')).toBe(false);
  expect(isValidDormDate('2026-13-01')).toBe(false);
  expect(isValidDormDate('2026-11-31')).toBe(false);
  expect(isValidDormDate('2026-11-30')).toBe(true);
  expect(isValidDormDate('')).toBe(false);
  const value = normalizeDormWorkspace({
    milestones: Array.from({ length: 100 }, (_, n) => ({
      id: 'date_' + n, title: '提醒 ' + n, dueDate: '2026-12-15', completed: false,
    })),
  });
  expect(value.milestones).toHaveLength(DORM_MILESTONE_LIMIT);
});
