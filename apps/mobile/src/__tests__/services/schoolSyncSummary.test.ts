import { buildSchoolSyncSummary } from '../../services/schoolSyncSummary';
import type { SyncAllResult } from '../../services/puDataCache';

test('login success with no source receipts is incomplete, never four green checks', () => {
  const summary = buildSchoolSyncSummary(null, true);
  expect(summary.incomplete).toBe(true);
  expect(summary.items.every((item) => item.state === 'unavailable')).toBe(true);
});

test('distinguishes genuine empty responses, grades-based credits and unavailable learning data', () => {
  const summary = buildSchoolSyncSummary(
    {
      courses: { courses: [] },
      grades: { grades: [{ courseName: '資料庫', credits: 3, score: 85 }] },
      tcCourses: null,
    } as Partial<SyncAllResult>,
    true,
  );
  expect(summary.items[0]).toMatchObject({ state: 'empty', detail: '已讀取，這次沒有資料' });
  expect(summary.items[1]).toMatchObject({ state: 'received', detail: '已讀取 1 筆成績' });
  expect(summary.items[2].detail).toContain('尚未取得校方完整畢業審核');
  expect(summary.items[3].state).toBe('unavailable');
});

test('disabled learning fetch is identified without claiming zero courses', () => {
  expect(buildSchoolSyncSummary(null, false).items[3]).toMatchObject({ state: 'disabled' });
});
