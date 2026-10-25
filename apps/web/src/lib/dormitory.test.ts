import { expect, it } from 'vitest';
import {
  DORM_CHECKLISTS,
  dormChecklistProgress,
  dormStorageKey,
  emptyDormWorkspace,
  formatDormRepairForCopy,
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
