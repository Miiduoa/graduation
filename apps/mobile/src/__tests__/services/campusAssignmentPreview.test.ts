import { runOfflineCampusTool } from '../../services/offlineCampusTools';
import type { CampusSenseSnapshot } from '../../services/campusSenseSnapshot';
import type { OnDeviceSchoolContext } from '../../services/onDeviceSchoolContext';

const checkedAt = '2026-10-27T01:00:00Z';
const context: OnDeviceSchoolContext = {
  schoolId: 'pu', schoolName: '靜宜大學', checkedAt,
  timetable: { source: 'not-available', updatedAt: null, courses: [] },
};
function snapshot(loaded: number, total = loaded): CampusSenseSnapshot {
  return {
    userId: 'A', schoolId: 'pu', checkedAt,
    schedule: { status: 'unavailable', count: null },
    announcements: { status: 'unavailable', items: [] },
    assignments: {
      status: 'available', count: total,
      items: Array.from({ length: loaded }, (_, i) => ({
        title: '課程作業 ' + i, groupName: '資料庫', dueAt: null,
      })),
    },
  };
}
const answer = (loaded: number, total = loaded) =>
  runOfflineCampusTool('我有哪些作業還沒交？', context, snapshot(loaded, total), 'A')?.content ?? '';

test('a fully synced list still discloses the eight-row text preview limit', () => {
  const content = answer(137);
  expect(content).toContain('待交作業：137 筆');
  expect(content.split('\n').filter((line) => line.startsWith('• '))).toHaveLength(8);
  expect(content).toContain('另有 129 筆已同步但未在此預覽展開');
  expect(content).toContain('逐日安排與其他作業區');
  expect(content).not.toContain('尚未同步');
});

test('hidden loaded rows are counted separately from rows never obtained', () => {
  const content = answer(50, 70);
  expect(content).toContain('另有 42 筆已同步但未在此預覽展開');
  expect(content).toContain('另有 20 筆尚未同步，未納入本機規劃');
});

test('no loaded rows is not a verified empty workload when the source total is positive', () => {
  const content = answer(0, 12);
  expect(content).toContain('另有 12 筆尚未同步');
  expect(content).not.toContain('0 筆。');
});

test('a complete short list has no phantom missing-work warning', () => {
  const content = answer(3);
  expect(content.split('\n').filter((line) => line.startsWith('• '))).toHaveLength(3);
  expect(content).not.toContain('未在此預覽展開');
  expect(content).not.toContain('尚未同步');
});
