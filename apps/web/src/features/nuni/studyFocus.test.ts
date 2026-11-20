import { expect, it } from 'vitest';
import { recommendStudyFocus, type NuniStudyTask } from '@campus/shared/src/nuniStudyAgenda';

const now = '2026-10-26T16:00:00+08:00';
function task(id: number, extra: Partial<NuniStudyTask> = {}): NuniStudyTask {
  return {
    id: `cwa_${id}`,
    kind: 'assignment',
    courseId: 'course-a',
    courseTitle: '資料庫',
    title: `任務 ${id}`,
    dueAt: '2026-10-27T12:00:00+08:00',
    state: 'open',
    submittedAt: null,
    feedback: null,
    reviewedAt: null,
    ...extra,
  };
}

it('recommends actual pending coursework by reference urgency without changing the source list', () => {
  const input = [
    task(1, { state: 'closed', dueAt: '2026-10-20T12:00:00+08:00' }),
    task(2, { dueAt: null }),
    task(3, { dueAt: '2026-10-26T15:59:00+08:00' }),
    task(4, { dueAt: '2026-10-26T20:00:00+08:00' }),
    task(5, { dueAt: '2026-11-02T12:00:00+08:00' }),
    task(6, { submittedAt: '2026-10-26T10:00:00+08:00' }),
  ];
  const result = recommendStudyFocus(input, now);
  expect(result.map(({ task: item }) => item.id)).toEqual(['cwa_3', 'cwa_4', 'cwa_5']);
  expect(result.map(({ timing }) => timing)).toEqual(['overdue', 'today', 'week']);
  expect(input[0].id).toBe('cwa_1');
});

it('distributes equal-urgency work across courses before selecting a second item from the same course', () => {
  const items = [
    task(1, { dueAt: '2026-10-25T12:00:00+08:00' }),
    task(2, { dueAt: '2026-10-25T14:00:00+08:00' }),
    task(3, { courseId: 'course-b', courseTitle: '統計', dueAt: '2026-10-25T18:00:00+08:00' }),
  ];
  expect(recommendStudyFocus(items, now).map(({ task: item }) => item.id)).toEqual(['cwa_1', 'cwa_3', 'cwa_2']);
});

it('keeps closed/submitted work out and avoids fabricated recommendations when time or limits are invalid', () => {
  const items = [task(1, { state: 'closed' }), task(2, { submittedAt: '2026-10-25T18:00:00+08:00' })];
  expect(recommendStudyFocus(items, now)).toEqual([]);
  expect(recommendStudyFocus([task(3)], 'not-a-date')).toEqual([]);
  expect(recommendStudyFocus([task(3)], now, 0)).toEqual([]);
  expect(recommendStudyFocus([task(3)], now, NaN)).toEqual([]);
});
